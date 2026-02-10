package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/github"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

// taskWithDiffStats extends a Task with optional diff stats for the response.
type taskWithDiffStats struct {
	*db.Task
	DiffStats *DiffStats `json:"diffStats,omitempty"`
}

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

	// Batch-load labels for all tasks
	taskIDs := make([]string, len(tasks))
	for i, t := range tasks {
		taskIDs[i] = t.ID
	}
	labelsMap, _ := s.db.GetTasksLabels(taskIDs)

	// Enrich tasks that have worktrees with diff stats
	result := make([]taskWithDiffStats, len(tasks))
	for i, t := range tasks {
		if labels, ok := labelsMap[t.ID]; ok {
			t.Labels = labels
		}
		result[i] = taskWithDiffStats{Task: t}
		if t.WorktreePath == nil || *t.WorktreePath == "" {
			continue
		}
		if stats := s.getCachedDiffStats(t); stats != nil {
			result[i].DiffStats = stats
		}
	}

	writeJSON(w, http.StatusOK, result)
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

	// Load labels for this task
	if labels, err := s.db.GetTaskLabels(id); err == nil {
		task.Labels = labels
	}

	result := taskWithDiffStats{Task: task}
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		if stats := s.getCachedDiffStats(task); stats != nil {
			result.DiffStats = stats
		}
	}

	writeJSON(w, http.StatusOK, result)
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
	var worktreeWarnings []string
	if input.Status != nil && *input.Status == db.TaskStatusInProgress {
		// Only create if no worktree exists yet
		if currentTask.WorktreePath == nil || *currentTask.WorktreePath == "" {
			warnings, err := s.autoCreateWorktree(currentTask, &input)
			if err != nil {
				slog.Warn("failed to auto-create worktree", "task_id", id, "error", err)
			}
			worktreeWarnings = warnings
		}
	}

	task, err := s.db.UpdateTask(id, input)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Load labels
	if labels, err := s.db.GetTaskLabels(id); err == nil {
		task.Labels = labels
	}

	// Check for workflow automation on status transitions
	resp := updateTaskResponse{Task: task, WorktreeWarning: worktreeWarnings}
	if input.Status != nil && *input.Status != currentTask.Status {
		s.dispatchWorkflow(currentTask, task, &resp)
	}

	writeJSON(w, http.StatusOK, resp)
}

// updateTaskResponse wraps a Task with optional workflow automation hints.
type updateTaskResponse struct {
	*db.Task
	WorkflowAction  *string  `json:"workflowAction,omitempty"`  // "ask" when user should pick provider
	SessionStarted  *string  `json:"sessionStarted,omitempty"`  // session ID if auto-started
	PRCreated       *string  `json:"prCreated,omitempty"`       // PR URL if auto-created
	WorkflowError   *string  `json:"workflowError,omitempty"`   // non-fatal workflow error message
	WorktreeWarning []string `json:"worktreeWarning,omitempty"` // non-fatal worktree creation warnings
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

	// in_progress → in_review
	if oldTask.Status == db.TaskStatusInProgress && newTask.Status == db.TaskStatusInReview {
		s.handleProgressToReview(newTask, project, wf.ProgressToReview, resp)
	}

	// in_review → done
	if oldTask.Status == db.TaskStatusInReview && newTask.Status == db.TaskStatusDone {
		s.handleReviewToDone(newTask, project, wf.ReviewToDone, resp)
	}
}

const defaultPromptTemplate = "Work on: {title}\n\n{description}"

// buildPromptFromTemplate replaces {title} and {description} placeholders in a template.
// Falls back to a sensible default when no template is configured.
func buildPromptFromTemplate(tmpl, title, description string) string {
	if tmpl == "" {
		tmpl = defaultPromptTemplate
	}
	r := strings.NewReplacer("{title}", title, "{description}", description)
	return r.Replace(tmpl)
}

// autoCreateWorktree creates a worktree for a task and updates the input with worktree info.
// Returns non-fatal warnings (e.g. stale base branch) and an error if creation failed entirely.
func (s *Server) autoCreateWorktree(task *db.Task, input *db.UpdateTaskInput) (warnings []string, err error) {
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	adoptBranch := task.Branch != nil && *task.Branch != ""

	result, err := s.worktree.Create(worktree.CreateOptions{
		ProjectPath:  project.Path,
		ProjectID:    project.ID,
		ProjectName:  project.Name,
		TaskID:       task.ID,
		TaskTitle:    task.Title,
		BranchName:   ptrToString(task.Branch),
		BaseBranch:   project.DefaultBranch,
		AdoptBranch:  adoptBranch,
		SymlinkPaths: project.SymlinkPaths,
		SecretFiles:  mapSecretFiles(project.SecretFiles),
		SetupScript:  ptrToString(project.SetupScript),
	})
	if err != nil {
		return nil, fmt.Errorf("create worktree: %w", err)
	}

	// Add worktree info to the update input
	input.WorktreePath = &result.WorktreePath
	input.Branch = &result.BranchName

	return result.Warnings, nil
}

// handleProgressToReview implements the in_progress → in_review workflow.
func (s *Server) handleProgressToReview(task *db.Task, project *db.Project, cfg *db.ProgressToReviewConfig, resp *updateTaskResponse) {
	if cfg == nil {
		return
	}

	branch := ptrToString(task.Branch)
	if branch == "" {
		return
	}

	workDir := ptrToString(task.WorktreePath)
	if workDir == "" {
		workDir = project.Path
	}

	// Guard: skip PR workflow if there are no changes on this branch
	logOut, err := runGit(workDir, "log", "--oneline", project.DefaultBranch+"..HEAD")
	if err == nil && strings.TrimSpace(logOut) == "" {
		wfErr := "no changes on branch " + branch + " compared to " + project.DefaultBranch
		resp.WorkflowError = &wfErr
		return
	}

	switch cfg.Action {
	case "pr_auto":
		if !github.Available() {
			wfErr := "gh CLI not available, skipping PR creation"
			resp.WorkflowError = &wfErr
			slog.Warn("workflow: pr_auto skipped", "task_id", task.ID, "reason", wfErr)
			return
		}
		// Push the branch first
		if err := github.PushBranch(workDir, branch); err != nil {
			wfErr := fmt.Sprintf("failed to push branch: %v", err)
			resp.WorkflowError = &wfErr
			slog.Error("workflow: push branch failed", "task_id", task.ID, "error", err)
			return
		}
		// Create the PR
		baseBranch := cfg.PRBaseBranch
		if baseBranch == "" {
			baseBranch = project.DefaultBranch
		}
		body := ptrToString(task.Description)
		prURL, err := github.CreatePR(workDir, task.Title, body, baseBranch, branch)
		if err != nil {
			wfErr := fmt.Sprintf("failed to create PR: %v", err)
			resp.WorkflowError = &wfErr
			slog.Error("workflow: create PR failed", "task_id", task.ID, "error", err)
			return
		}
		// Store PR URL on task
		s.db.UpdateTask(task.ID, db.UpdateTaskInput{PRURL: &prURL})
		resp.PRCreated = &prURL
		resp.PRURL = &prURL
		slog.Info("workflow: PR created", "task_id", task.ID, "pr_url", prURL)

	case "pr_manual":
		if !github.Available() {
			wfErr := "gh CLI not available, skipping branch push"
			resp.WorkflowError = &wfErr
			return
		}
		if err := github.PushBranch(workDir, branch); err != nil {
			wfErr := fmt.Sprintf("failed to push branch: %v", err)
			resp.WorkflowError = &wfErr
			slog.Error("workflow: push branch failed", "task_id", task.ID, "error", err)
			return
		}
		action := "branch_pushed"
		resp.WorkflowAction = &action
		slog.Info("workflow: branch pushed (manual PR)", "task_id", task.ID, "branch", branch)
	}
}

// handleReviewToDone implements the in_review → done workflow.
func (s *Server) handleReviewToDone(task *db.Task, project *db.Project, cfg *db.ReviewToDoneConfig, resp *updateTaskResponse) {
	if cfg == nil {
		return
	}

	switch cfg.Action {
	case "merge_pr":
		prURL := ptrToString(task.PRURL)
		if prURL == "" {
			wfErr := "no PR URL on task, skipping merge"
			resp.WorkflowError = &wfErr
			return
		}
		if !github.Available() {
			wfErr := "gh CLI not available, skipping PR merge"
			resp.WorkflowError = &wfErr
			return
		}
		strategy := cfg.MergeStrategy
		if strategy == "" {
			strategy = "squash"
		}
		deleteBranch := cfg.DeleteBranch == nil || *cfg.DeleteBranch
		if err := github.MergePR(project.Path, prURL, strategy, deleteBranch); err != nil {
			wfErr := fmt.Sprintf("failed to merge PR: %v", err)
			resp.WorkflowError = &wfErr
			slog.Error("workflow: merge PR failed", "task_id", task.ID, "error", err)
			return
		}
		slog.Info("workflow: PR merged", "task_id", task.ID, "pr_url", prURL)

	case "merge_branch":
		branch := ptrToString(task.Branch)
		if branch == "" {
			wfErr := "no branch on task, skipping merge"
			resp.WorkflowError = &wfErr
			return
		}
		baseBranch := project.DefaultBranch
		if err := directMergeBranch(project.Path, baseBranch, branch); err != nil {
			wfErr := fmt.Sprintf("failed to merge branch: %v", err)
			resp.WorkflowError = &wfErr
			slog.Error("workflow: merge branch failed", "task_id", task.ID, "error", err)
			return
		}
		// Delete branch if configured
		deleteBranch := cfg.DeleteBranch == nil || *cfg.DeleteBranch
		if deleteBranch {
			delCmd := exec.Command("git", "branch", "-d", branch)
			delCmd.Dir = project.Path
			delCmd.Run() // best-effort
		}
		slog.Info("workflow: branch merged directly", "task_id", task.ID, "branch", branch)

	default:
		return
	}

	// Cleanup worktree if configured
	cleanupWorktree := cfg.CleanupWorktree == nil || *cfg.CleanupWorktree
	if cleanupWorktree && task.WorktreePath != nil && *task.WorktreePath != "" {
		err := s.worktree.Delete(worktree.DeleteOptions{
			ProjectPath:    project.Path,
			WorktreePath:   *task.WorktreePath,
			DeleteBranch:   false, // branch already handled above
			TeardownScript: ptrToString(project.TeardownScript),
		})
		if err != nil {
			slog.Error("workflow: cleanup worktree failed", "task_id", task.ID, "error", err)
		} else {
			emptyStr := ""
			s.db.UpdateTask(task.ID, db.UpdateTaskInput{WorktreePath: &emptyStr})
			resp.WorktreePath = &emptyStr
			slog.Info("workflow: worktree cleaned up", "task_id", task.ID)
		}
	}
}

// directMergeBranch merges a feature branch into the base branch using --no-ff in the main repo.
func directMergeBranch(repoPath, baseBranch, featureBranch string) error {
	// Checkout base branch
	checkout := exec.Command("git", "checkout", baseBranch)
	checkout.Dir = repoPath
	if output, err := checkout.CombinedOutput(); err != nil {
		return fmt.Errorf("checkout %s: %s: %w", baseBranch, strings.TrimSpace(string(output)), err)
	}

	// Merge with --no-ff
	merge := exec.Command("git", "merge", "--no-ff", featureBranch, "-m", fmt.Sprintf("Merge branch '%s'", featureBranch))
	merge.Dir = repoPath
	if output, err := merge.CombinedOutput(); err != nil {
		return fmt.Errorf("merge %s: %s: %w", featureBranch, strings.TrimSpace(string(output)), err)
	}

	return nil
}

// handleCreatePR manually pushes the branch and creates a PR for a task.
func (s *Server) handleCreatePR(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	task, err := s.db.GetTask(id)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	branch := ptrToString(task.Branch)
	if branch == "" {
		writeError(w, http.StatusBadRequest, "task has no branch")
		return
	}

	if !github.Available() {
		writeError(w, http.StatusServiceUnavailable, "gh CLI not available")
		return
	}

	workDir := ptrToString(task.WorktreePath)
	if workDir == "" {
		workDir = project.Path
	}

	// Check for changes
	logOut, err := runGit(workDir, "log", "--oneline", project.DefaultBranch+"..HEAD")
	if err == nil && strings.TrimSpace(logOut) == "" {
		writeError(w, http.StatusBadRequest, "no changes on branch "+branch+" compared to "+project.DefaultBranch)
		return
	}

	// Push branch
	if err := github.PushBranch(workDir, branch); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to push branch: %v", err))
		return
	}

	// Create PR
	body := ptrToString(task.Description)
	prURL, err := github.CreatePR(workDir, task.Title, body, project.DefaultBranch, branch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create PR: %v", err))
		return
	}

	// Store PR URL
	s.db.UpdateTask(task.ID, db.UpdateTaskInput{PRURL: &prURL})

	writeJSON(w, http.StatusOK, map[string]string{"prUrl": prURL})
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
