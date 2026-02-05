package api

import (
	"database/sql"
	"net/http"

	"github.com/miguel/codeburg/internal/db"
	"github.com/miguel/codeburg/internal/worktree"
)

// WorktreeResponse is the response for worktree operations
type WorktreeResponse struct {
	WorktreePath string `json:"worktreePath"`
	BranchName   string `json:"branchName"`
}

func (s *Server) handleCreateWorktree(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")

	// Get task
	task, err := s.db.GetTask(taskID)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get task")
		return
	}

	// Check if worktree already exists
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		if s.worktree.Exists(*task.WorktreePath) {
			writeJSON(w, http.StatusOK, WorktreeResponse{
				WorktreePath: *task.WorktreePath,
				BranchName:   *task.Branch,
			})
			return
		}
	}

	// Get project
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get project")
		return
	}

	// Create worktree
	result, err := s.worktree.Create(worktree.CreateOptions{
		ProjectPath:  project.Path,
		ProjectName:  project.Name,
		TaskID:       task.ID,
		BaseBranch:   project.DefaultBranch,
		SymlinkPaths: project.SymlinkPaths,
		SetupScript:  ptrToString(project.SetupScript),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create worktree: "+err.Error())
		return
	}

	// Update task with worktree info
	_, err = s.db.UpdateTask(taskID, db.UpdateTaskInput{
		WorktreePath: &result.WorktreePath,
		Branch:       &result.BranchName,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update task with worktree info")
		return
	}

	writeJSON(w, http.StatusCreated, WorktreeResponse{
		WorktreePath: result.WorktreePath,
		BranchName:   result.BranchName,
	})
}

func (s *Server) handleDeleteWorktree(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")

	// Get task
	task, err := s.db.GetTask(taskID)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get task")
		return
	}

	// Check if worktree exists
	if task.WorktreePath == nil || *task.WorktreePath == "" {
		writeError(w, http.StatusBadRequest, "task has no worktree")
		return
	}

	// Get project for teardown script
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get project")
		return
	}

	// Delete worktree
	err = s.worktree.Delete(worktree.DeleteOptions{
		ProjectPath:    project.Path,
		WorktreePath:   *task.WorktreePath,
		DeleteBranch:   false, // Don't delete branch by default
		TeardownScript: ptrToString(project.TeardownScript),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete worktree: "+err.Error())
		return
	}

	// Clear worktree info from task
	emptyStr := ""
	_, err = s.db.UpdateTask(taskID, db.UpdateTaskInput{
		WorktreePath: &emptyStr,
		Branch:       &emptyStr,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update task")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
