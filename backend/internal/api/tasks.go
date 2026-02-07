package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	filter := db.TaskFilter{}

	// Parse query parameters
	if projectID := r.URL.Query().Get("project"); projectID != "" {
		filter.ProjectID = &projectID
	}
	if status := r.URL.Query().Get("status"); status != "" {
		taskStatus := db.TaskStatus(status)
		filter.Status = &taskStatus
	}

	tasks, err := s.db.ListTasks(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tasks")
		return
	}

	writeJSON(w, http.StatusOK, tasks)
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "projectId")

	// Verify project exists
	_, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var input db.CreateTaskInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	input.ProjectID = projectID

	// Validate required fields
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	task, err := s.db.CreateTask(input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create task")
		return
	}

	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	task, err := s.db.GetTask(id)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	var input db.UpdateTaskInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate status if provided
	if input.Status != nil {
		validStatuses := map[db.TaskStatus]bool{
			db.TaskStatusBacklog:    true,
			db.TaskStatusInProgress: true,
			db.TaskStatusInReview:   true,
			db.TaskStatusDone:       true,
		}
		if !validStatuses[*input.Status] {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
	}

	// Get current task to check status transition
	currentTask, err := s.db.GetTask(id)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Auto-create worktree when moving to in_progress
	if input.Status != nil && *input.Status == db.TaskStatusInProgress {
		// Only create if no worktree exists yet
		if currentTask.WorktreePath == nil || *currentTask.WorktreePath == "" {
			if err := s.autoCreateWorktree(currentTask, &input); err != nil {
				// Log error but don't fail the status update
				fmt.Printf("warning: failed to auto-create worktree: %v\n", err)
			}
		}
	}

	task, err := s.db.UpdateTask(id, input)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Check for workflow automation on status transitions
	resp := updateTaskResponse{Task: task}
	if input.Status != nil && *input.Status != currentTask.Status {
		s.dispatchWorkflow(currentTask, task, &resp)
	}

	writeJSON(w, http.StatusOK, resp)
}

// updateTaskResponse wraps a Task with optional workflow automation hints.
type updateTaskResponse struct {
	*db.Task
	WorkflowAction *string `json:"workflowAction,omitempty"` // "ask" when user should pick provider
	SessionStarted *string `json:"sessionStarted,omitempty"` // session ID if auto-started
}

// dispatchWorkflow checks the project's workflow config and acts on status transitions.
func (s *Server) dispatchWorkflow(oldTask, newTask *db.Task, resp *updateTaskResponse) {
	project, err := s.db.GetProject(newTask.ProjectID)
	if err != nil || project.Workflow == nil {
		return
	}
	wf := project.Workflow

	// backlog → in_progress
	if oldTask.Status == db.TaskStatusBacklog && newTask.Status == db.TaskStatusInProgress {
		if wf.BacklogToProgress == nil {
			return
		}
		cfg := wf.BacklogToProgress
		switch cfg.Action {
		case "auto_claude", "auto_codex":
			provider := "claude"
			if cfg.Action == "auto_codex" {
				provider = "codex"
			}
			prompt := buildPromptFromTemplate(cfg.PromptTemplate, newTask.Title, ptrToString(newTask.Description))
			session, err := s.startSessionInternal(newTask, StartSessionRequest{
				Provider: provider,
				Prompt:   prompt,
				Model:    cfg.DefaultModel,
			})
			if err != nil {
				slog.Error("workflow auto-start failed", "task_id", newTask.ID, "error", err)
				return
			}
			resp.SessionStarted = &session.ID
		case "ask":
			action := "ask"
			resp.WorkflowAction = &action
		}
	}

	// in_progress → in_review (stub for future)
	if oldTask.Status == db.TaskStatusInProgress && newTask.Status == db.TaskStatusInReview {
		if wf.ProgressToReview != nil {
			slog.Info("workflow: progress→review stub", "task_id", newTask.ID, "action", wf.ProgressToReview.Action)
		}
	}

	// in_review → done (stub for future)
	if oldTask.Status == db.TaskStatusInReview && newTask.Status == db.TaskStatusDone {
		if wf.ReviewToDone != nil {
			slog.Info("workflow: review→done stub", "task_id", newTask.ID, "action", wf.ReviewToDone.Action)
		}
	}
}

// buildPromptFromTemplate replaces {title} and {description} placeholders in a template.
func buildPromptFromTemplate(tmpl, title, description string) string {
	if tmpl == "" {
		return ""
	}
	r := strings.NewReplacer("{title}", title, "{description}", description)
	return r.Replace(tmpl)
}

// autoCreateWorktree creates a worktree for a task and updates the input with worktree info
func (s *Server) autoCreateWorktree(task *db.Task, input *db.UpdateTaskInput) error {
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}

	result, err := s.worktree.Create(worktree.CreateOptions{
		ProjectPath:  project.Path,
		ProjectName:  project.Name,
		TaskID:       task.ID,
		BaseBranch:   project.DefaultBranch,
		SymlinkPaths: project.SymlinkPaths,
		SetupScript:  ptrToString(project.SetupScript),
	})
	if err != nil {
		return fmt.Errorf("create worktree: %w", err)
	}

	// Add worktree info to the update input
	input.WorktreePath = &result.WorktreePath
	input.Branch = &result.BranchName

	return nil
}

func (s *Server) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	if err := s.db.DeleteTask(id); err != nil {
		writeDBError(w, err, "task")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ptrToString safely dereferences a string pointer
func ptrToString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
