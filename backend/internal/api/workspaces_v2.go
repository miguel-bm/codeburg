package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/github"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	if _, err := s.db.GetProject(projectID); err != nil {
		writeDBError(w, err, "project")
		return
	}
	workspaces, err := s.db.ListWorkspacesByProject(projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workspaces")
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (s *Server) handleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	writeJSON(w, http.StatusOK, workspace)
}

type createWorkspaceRequest struct {
	Name            string  `json:"name"`
	BranchName      *string `json:"branchName,omitempty"`
	BranchMode      *string `json:"branchMode,omitempty"` // "create" | "adopt_existing"
	BaseBranch      *string `json:"baseBranch,omitempty"`
	SourceWorkspace *string `json:"sourceWorkspaceId,omitempty"`
}

type workspaceMutationResponse struct {
	Workspace *db.Workspace `json:"workspace"`
	Warnings  []string      `json:"warnings,omitempty"`
}

type syncWorkspaceResponse struct {
	Branch     string `json:"branch"`
	BaseBranch string `json:"baseBranch"`
	Remote     string `json:"remote"`
	Updated    bool   `json:"updated"`
}

type mergeWorkspaceRequest struct {
	SyncFirst       *bool   `json:"syncFirst,omitempty"`
	PushAfterMerge  *bool   `json:"pushAfterMerge,omitempty"`
	CleanupWorktree *bool   `json:"cleanupWorktree,omitempty"`
	DeleteBranch    *bool   `json:"deleteBranch,omitempty"`
	MergeStrategy   *string `json:"mergeStrategy,omitempty"`
	TargetBranch    *string `json:"targetBranch,omitempty"`
}

type workspaceLifecycleRequest struct {
	CleanupWorktree *bool `json:"cleanupWorktree,omitempty"`
}

type workspaceGitRebaseRequest struct {
	BaseBranch string `json:"baseBranch"`
	Fetch      *bool  `json:"fetch,omitempty"`
}

type workspaceConflictContextResponse struct {
	Operation       string   `json:"operation"`
	Branch          string   `json:"branch"`
	BaseBranch      string   `json:"baseBranch"`
	ConflictedFiles []string `json:"conflictedFiles"`
	Status          string   `json:"status"`
	Unmerged        string   `json:"unmerged"`
	Prompt          string   `json:"prompt"`
}

type workspacePullRequestResponse struct {
	Exists     bool   `json:"exists"`
	URL        string `json:"url,omitempty"`
	State      string `json:"state,omitempty"`
	Title      string `json:"title,omitempty"`
	BaseBranch string `json:"baseBranch,omitempty"`
	HeadBranch string `json:"headBranch,omitempty"`
}

type createWorkspacePullRequestRequest struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
}

type workspaceMergeOptions struct {
	SyncFirst       bool
	PushAfterMerge  bool
	CleanupWorktree bool
	DeleteBranch    bool
	MergeStrategy   string
	TargetBranch    string
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req createWorkspaceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	var source *db.Workspace
	if req.SourceWorkspace != nil && strings.TrimSpace(*req.SourceWorkspace) != "" {
		source, err = s.db.GetWorkspace(strings.TrimSpace(*req.SourceWorkspace))
		if err != nil {
			writeDBError(w, err, "source workspace")
			return
		}
		if source.ProjectID != project.ID {
			writeError(w, http.StatusBadRequest, "source workspace must belong to the same project")
			return
		}
	}

	workspace, warnings, err := s.createWorkspaceFromRequest(project, source, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, workspaceMutationResponse{Workspace: workspace, Warnings: warnings})
}

func (s *Server) handleForkWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	source, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	project, err := s.db.GetProject(source.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req createWorkspaceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		req.Name = source.Name + " fork"
	}
	workspace, warnings, err := s.createWorkspaceFromRequest(project, source, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, workspaceMutationResponse{Workspace: workspace, Warnings: warnings})
}

func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Kind == db.WorkspaceKindMain {
		writeError(w, http.StatusBadRequest, "canonical main workspace cannot be deleted")
		return
	}

	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	if err := s.stopWorkspaceTerminals(workspace.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stop workspace terminals")
		return
	}
	if err := s.detachWorkspaceConversations(workspace.ID, "workspace deleted"); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to detach conversation from deleted workspace")
		return
	}

	if workspace.WorktreePath != nil && *workspace.WorktreePath != "" && s.worktree.Exists(*workspace.WorktreePath) {
		if err := s.worktree.Delete(worktree.DeleteOptions{
			ProjectPath:    project.Path,
			WorktreePath:   *workspace.WorktreePath,
			DeleteBranch:   true,
			TeardownScript: ptrToString(project.TeardownScript),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete workspace worktree: "+err.Error())
			return
		}
	}

	if err := s.db.DeleteWorkspace(workspace.ID); err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createWorkspaceFromRequest(project *db.Project, source *db.Workspace, req createWorkspaceRequest) (*db.Workspace, []string, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, nil, fmt.Errorf("workspace name is required")
	}

	branchName := normalizeWorkspaceBranchInput(ptrToString(req.BranchName))
	baseBranch := project.DefaultBranch
	origin := db.WorkspaceOriginDirect
	var parentWorkspaceID *string

	if source != nil {
		baseBranch = source.BranchName
		origin = db.WorkspaceOriginForked
		parentWorkspaceID = &source.ID
	}
	if rawBaseBranch := strings.TrimSpace(ptrToString(req.BaseBranch)); rawBaseBranch != "" {
		baseBranch = rawBaseBranch
	}

	workspace, err := s.db.CreateWorkspace(db.CreateWorkspaceInput{
		ProjectID:         project.ID,
		Name:              name,
		Kind:              db.WorkspaceKindWorktree,
		Status:            db.WorkspaceStatusActive,
		BranchName:        defaultString(branchName, slugCandidate(name)),
		BaseBranch:        &baseBranch,
		ParentWorkspaceID: parentWorkspaceID,
		Origin:            origin,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create workspace record: %w", err)
	}

	adoptBranch := false
	if branchName != "" || req.BranchMode != nil {
		adoptBranch, err = resolveWorkspaceBranchMode(project.Path, branchName, req.BranchMode)
		if err != nil {
			_ = s.db.DeleteWorkspace(workspace.ID)
			return nil, nil, err
		}
	}

	result, err := s.worktree.Create(worktree.CreateOptions{
		ProjectPath:  project.Path,
		ProjectID:    project.ID,
		ProjectName:  project.Name,
		TaskID:       workspace.ID,
		TaskTitle:    workspace.Name,
		BranchName:   branchName,
		BaseBranch:   baseBranch,
		AdoptBranch:  adoptBranch,
		SymlinkPaths: project.SymlinkPaths,
		SecretFiles:  mapSecretFiles(project.SecretFiles),
		SetupScript:  ptrToString(project.SetupScript),
	})
	if err != nil {
		_ = s.db.DeleteWorkspace(workspace.ID)
		return nil, nil, fmt.Errorf("create workspace worktree: %w", err)
	}

	storedBaseBranch := defaultString(result.BaseBranch, baseBranch)
	workspace, err = s.db.UpdateWorkspace(workspace.ID, db.UpdateWorkspaceInput{
		BranchName:   &result.BranchName,
		BaseBranch:   &storedBaseBranch,
		WorktreePath: &result.WorktreePath,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("update workspace record: %w", err)
	}
	return workspace, result.Warnings, nil
}

func normalizeWorkspaceBranchInput(branchName string) string {
	branchName = strings.TrimSpace(branchName)
	branchName = strings.TrimPrefix(branchName, "refs/heads/")
	branchName = strings.TrimPrefix(branchName, "refs/remotes/origin/")
	branchName = strings.TrimPrefix(branchName, "origin/")
	return branchName
}

func resolveWorkspaceBranchMode(repoPath, branchName string, mode *string) (bool, error) {
	branchName = strings.TrimSpace(branchName)
	if mode == nil || strings.TrimSpace(*mode) == "" {
		// Backward-compatible behavior: an explicitly supplied branch name adopts
		// an existing local/origin branch when one is found, otherwise creates it.
		return resolveAdoptMode(repoPath, branchName, nil)
	}

	switch strings.TrimSpace(*mode) {
	case "create":
		return false, nil
	case "adopt_existing":
		adopt := db.TaskBranchModeAdoptExisting
		return resolveAdoptMode(repoPath, branchName, &adopt)
	default:
		return false, fmt.Errorf("invalid branchMode")
	}
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func slugCandidate(name string) string {
	slug := worktree.Slugify(name)
	if slug == "" {
		return "workspace"
	}
	return slug
}

func (s *Server) resolveWorkspaceResources(w http.ResponseWriter, workspaceID string) (*db.Workspace, *db.Project, string, bool) {
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return nil, nil, "", false
	}
	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return nil, nil, "", false
	}
	root := project.Path
	if workspace.WorktreePath != nil && *workspace.WorktreePath != "" {
		root = *workspace.WorktreePath
	}
	return workspace, project, root, true
}

func (s *Server) resolveWorkspaceRoot(w http.ResponseWriter, workspaceID string) (string, bool) {
	_, _, root, ok := s.resolveWorkspaceResources(w, workspaceID)
	return root, ok
}

func (s *Server) requireMutableWorkspace(w http.ResponseWriter, workspaceID string) (*db.Workspace, *db.Project, string, bool) {
	workspace, project, root, ok := s.resolveWorkspaceResources(w, workspaceID)
	if !ok {
		return nil, nil, "", false
	}
	if workspace.Status != db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "workspace is read-only while inactive")
		return nil, nil, "", false
	}
	return workspace, project, root, true
}

type createTerminalSessionRequest struct {
	Title          *string `json:"title,omitempty"`
	Cwd            *string `json:"cwd,omitempty"`
	Shell          *string `json:"shell,omitempty"`
	ProviderHint   *string `json:"providerHint,omitempty"`
	InitialCommand *string `json:"initialCommand,omitempty"`
}

func (s *Server) handleListWorkspaceTerminals(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	sessions, err := s.db.ListTerminalSessionsByWorkspace(workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list terminals")
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleCreateWorkspaceTerminal(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, project, workspaceRoot, ok := s.resolveWorkspaceResources(w, workspaceID)
	if !ok {
		return
	}
	if workspace.Status != db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "terminals can only be started for active workspaces")
		return
	}

	var req createTerminalSessionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	cwd := workspaceRoot
	if req.Cwd != nil && strings.TrimSpace(*req.Cwd) != "" {
		requested := strings.TrimSpace(*req.Cwd)
		if !filepath.IsAbs(requested) {
			requested = filepath.Join(cwd, requested)
		}
		info, err := os.Stat(requested)
		if err != nil || !info.IsDir() {
			writeError(w, http.StatusBadRequest, "cwd must be an existing directory")
			return
		}
		cwd = requested
	}

	command, args, err := resolveWorkspaceTerminalCommand(req.Shell)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	title := cleanOptionalString(req.Title)
	if title == nil {
		title = strPtr(defaultTerminalTitle(s.db, workspaceID))
	}

	session, err := s.db.CreateTerminalSession(db.CreateTerminalSessionInput{
		WorkspaceID:  workspaceID,
		Title:        title,
		Shell:        strPtr(command),
		Cwd:          &cwd,
		ProviderHint: req.ProviderHint,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create terminal session")
		return
	}

	startedAt := time.Now()
	if _, err := s.db.UpdateTerminalSession(session.ID, db.UpdateTerminalSessionInput{
		Status:    ptrTerminalStatus(db.TerminalSessionStatusRunning),
		Shell:     &command,
		Cwd:       &cwd,
		StartedAt: &startedAt,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to initialize terminal session")
		return
	}

	err = s.sessions.runtime.Start(session.ID, ptyruntime.StartOptions{
		WorkDir: cwd,
		Command: command,
		Args:    args,
		Env: []string{
			"PATH=" + os.Getenv("PATH"),
			"CODEBURG_PROJECT_ID=" + project.ID,
			"CODEBURG_WORKSPACE_ID=" + workspace.ID,
		},
		OnExit: func(result ptyruntime.ExitResult) {
			now := time.Now()
			status := db.TerminalSessionStatusStopped
			if result.Err != nil || result.ExitCode != 0 {
				status = db.TerminalSessionStatusFailed
			}
			_, _ = s.db.UpdateTerminalSession(result.SessionID, db.UpdateTerminalSessionInput{
				Status:         &status,
				EndedAt:        &now,
				LastActivityAt: &now,
			})
		},
		OnOutput: func(sessionID string, chunk []byte) {
			now := time.Now()
			s.portSuggest.IngestWorkspaceOutput(workspaceID, sessionID, chunk)
			_, _ = s.db.UpdateTerminalSession(sessionID, db.UpdateTerminalSessionInput{
				LastActivityAt: &now,
			})
		},
	})
	if err != nil {
		failed := db.TerminalSessionStatusFailed
		now := time.Now()
		_, _ = s.db.UpdateTerminalSession(session.ID, db.UpdateTerminalSessionInput{
			Status:         &failed,
			EndedAt:        &now,
			LastActivityAt: &now,
		})
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start terminal: %v", err))
		return
	}

	if req.InitialCommand != nil && strings.TrimSpace(*req.InitialCommand) != "" {
		initialCommand := strings.TrimSpace(*req.InitialCommand) + "\n"
		if err := s.sessions.runtime.Write(session.ID, []byte(initialCommand)); err != nil {
			_ = s.sessions.runtime.Stop(session.ID)
			failed := db.TerminalSessionStatusFailed
			now := time.Now()
			_, _ = s.db.UpdateTerminalSession(session.ID, db.UpdateTerminalSessionInput{
				Status:         &failed,
				EndedAt:        &now,
				LastActivityAt: &now,
			})
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to initialize terminal command: %v", err))
			return
		}
	}

	session, err = s.db.GetTerminalSession(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load terminal session")
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) handleMergeWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Kind == db.WorkspaceKindMain {
		writeError(w, http.StatusBadRequest, "canonical main workspace cannot be merged")
		return
	}
	if workspace.Status != db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "only active workspaces can be merged")
		return
	}

	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req mergeWorkspaceRequest
	if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	options, err := resolveWorkspaceMergeOptions(project, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if options.DeleteBranch && !options.CleanupWorktree {
		writeError(w, http.StatusBadRequest, "deleteBranch requires cleanupWorktree")
		return
	}

	root, err := s.ensureWorkspaceGitRoot(project, workspace)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := requireCleanGitWorktree(root); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	baseBranch := workspaceBaseBranch(project, workspace)
	if strings.TrimSpace(options.TargetBranch) != "" {
		baseBranch = strings.TrimSpace(options.TargetBranch)
	}
	if options.SyncFirst {
		if _, _, err := s.syncWorkspaceBranch(project, workspace, root); err != nil {
			writeError(w, http.StatusConflict, "failed to sync workspace before merge: "+err.Error())
			return
		}
	}

	if err := mergeWorkspaceBranch(project.Path, root, baseBranch, workspace.BranchName, options.MergeStrategy); err != nil {
		writeError(w, http.StatusConflict, "failed to merge workspace branch: "+err.Error())
		return
	}

	var warnings []string
	if options.PushAfterMerge {
		if _, err := runGit(project.Path, "push", "origin", baseBranch); err != nil {
			warnings = append(warnings, fmt.Sprintf("failed to push %s after merge: %v", baseBranch, err))
		}
	}

	update := db.UpdateWorkspaceInput{
		Status: ptrWorkspaceStatus(db.WorkspaceStatusMerged),
	}
	now := time.Now().UTC()
	update.ClosedAt = &now

	if err := s.stopWorkspaceTerminals(workspace.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stop workspace terminals")
		return
	}
	if err := s.detachWorkspaceConversations(workspace.ID, workspaceLifecycleReason(db.WorkspaceStatusMerged)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to detach workspace conversations")
		return
	}

	if options.CleanupWorktree && workspace.WorktreePath != nil && *workspace.WorktreePath != "" && s.worktree.Exists(*workspace.WorktreePath) {
		if err := s.worktree.Delete(worktree.DeleteOptions{
			ProjectPath:    project.Path,
			WorktreePath:   *workspace.WorktreePath,
			DeleteBranch:   false,
			TeardownScript: ptrToString(project.TeardownScript),
		}); err != nil {
			warnings = append(warnings, "failed to cleanup workspace worktree: "+err.Error())
		} else {
			update.ClearWorktree = true
		}
	}

	if options.DeleteBranch {
		if err := deleteMergedBranch(project.Path, workspace.BranchName); err != nil {
			warnings = append(warnings, "workspace merged but branch cleanup failed: "+err.Error())
		}
	}

	updated, err := s.db.UpdateWorkspace(workspace.ID, update)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace")
		return
	}
	if len(warnings) > 0 {
		w.Header().Set("X-Codeburg-Workspace-Warnings", strings.Join(warnings, "; "))
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleAbandonWorkspace(w http.ResponseWriter, r *http.Request) {
	s.transitionWorkspaceStatus(w, r, db.WorkspaceStatusAbandoned)
}

func (s *Server) handleArchiveWorkspace(w http.ResponseWriter, r *http.Request) {
	s.transitionWorkspaceStatus(w, r, db.WorkspaceStatusArchived)
}

func (s *Server) handleCleanupWorkspaceWorktree(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Kind == db.WorkspaceKindMain {
		writeError(w, http.StatusBadRequest, "canonical main workspace has no removable worktree")
		return
	}
	if workspace.Status == db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "active workspace must be ended before cleanup")
		return
	}

	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var warnings []string
	update := db.UpdateWorkspaceInput{ClearWorktree: true}
	if err := s.cleanupWorkspaceWorktree(project, workspace); err != nil {
		warnings = append(warnings, "failed to cleanup workspace worktree: "+err.Error())
	}

	updated, err := s.db.UpdateWorkspace(workspace.ID, update)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace")
		return
	}
	if len(warnings) > 0 {
		w.Header().Set("X-Codeburg-Workspace-Warnings", strings.Join(warnings, "; "))
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleActivateWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if !isAllowedWorkspaceTransition(workspace.Status, db.WorkspaceStatusActive) {
		writeError(w, http.StatusConflict, "invalid workspace lifecycle transition")
		return
	}
	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	update := db.UpdateWorkspaceInput{
		Status:        ptrWorkspaceStatus(db.WorkspaceStatusActive),
		ClearClosedAt: true,
	}

	if workspace.Kind == db.WorkspaceKindWorktree && !workspaceHasUsableWorktree(workspace, s.worktree) {
		recreated, warnings, err := s.ensureWorkspaceWorktree(project, workspace)
		if err != nil {
			writeError(w, http.StatusConflict, "failed to recreate workspace worktree: "+err.Error())
			return
		}
		update.WorktreePath = &recreated.WorktreePath
		update.BranchName = &recreated.BranchName
		if len(warnings) > 0 {
			// Surface as a header to keep the response shape stable for the thin frontend.
			w.Header().Set("X-Codeburg-Workspace-Warnings", strings.Join(warnings, "; "))
		}
	}

	updated, err := s.db.UpdateWorkspace(workspace.ID, update)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleSyncWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Status != db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "only active workspaces can be synced")
		return
	}
	project, err := s.db.GetProject(workspace.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	root, err := s.ensureWorkspaceGitRoot(project, workspace)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	baseBranch, updated, err := s.syncWorkspaceBranch(project, workspace, root)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, syncWorkspaceResponse{
		Branch:     workspace.BranchName,
		BaseBranch: baseBranch,
		Remote:     "origin/" + baseBranch,
		Updated:    updated,
	})
}

func (s *Server) transitionWorkspaceStatus(w http.ResponseWriter, r *http.Request, nextStatus db.WorkspaceStatus) {
	workspaceID := urlParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Kind == db.WorkspaceKindMain && nextStatus != db.WorkspaceStatusActive {
		writeError(w, http.StatusBadRequest, "canonical main workspace cannot leave active state")
		return
	}
	if !isAllowedWorkspaceTransition(workspace.Status, nextStatus) {
		writeError(w, http.StatusConflict, "invalid workspace lifecycle transition")
		return
	}

	var req workspaceLifecycleRequest
	if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	update := db.UpdateWorkspaceInput{
		Status: &nextStatus,
	}
	if nextStatus == db.WorkspaceStatusActive {
		update.ClearClosedAt = true
	} else {
		now := time.Now().UTC()
		update.ClosedAt = &now
	}

	if nextStatus != db.WorkspaceStatusActive {
		if err := s.stopWorkspaceTerminals(workspace.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to stop workspace terminals")
			return
		}
		if err := s.detachWorkspaceConversations(workspace.ID, workspaceLifecycleReason(nextStatus)); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to detach workspace conversations")
			return
		}
	}

	if nextStatus != db.WorkspaceStatusActive && req.CleanupWorktree != nil && *req.CleanupWorktree {
		project, err := s.db.GetProject(workspace.ProjectID)
		if err != nil {
			writeDBError(w, err, "project")
			return
		}
		if err := s.cleanupWorkspaceWorktree(project, workspace); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to cleanup workspace worktree: "+err.Error())
			return
		}
		update.ClearWorktree = true
	}

	updated, err := s.db.UpdateWorkspace(workspace.ID, update)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) cleanupWorkspaceWorktree(project *db.Project, workspace *db.Workspace) error {
	if workspace.Kind == db.WorkspaceKindMain {
		return nil
	}
	if workspace.WorktreePath == nil || strings.TrimSpace(*workspace.WorktreePath) == "" {
		return nil
	}
	worktreePath := strings.TrimSpace(*workspace.WorktreePath)
	if !s.worktree.Exists(worktreePath) {
		return nil
	}
	return s.worktree.Delete(worktree.DeleteOptions{
		ProjectPath:    project.Path,
		WorktreePath:   worktreePath,
		DeleteBranch:   false,
		TeardownScript: ptrToString(project.TeardownScript),
	})
}

func ptrWorkspaceStatus(status db.WorkspaceStatus) *db.WorkspaceStatus {
	return &status
}

func workspaceBaseBranch(project *db.Project, workspace *db.Workspace) string {
	if workspace.BaseBranch != nil && strings.TrimSpace(*workspace.BaseBranch) != "" {
		return strings.TrimSpace(*workspace.BaseBranch)
	}
	if strings.TrimSpace(project.DefaultBranch) != "" {
		return strings.TrimSpace(project.DefaultBranch)
	}
	return "main"
}

func workspaceHasUsableWorktree(workspace *db.Workspace, manager *worktree.Manager) bool {
	return workspace.WorktreePath != nil && strings.TrimSpace(*workspace.WorktreePath) != "" && manager.Exists(*workspace.WorktreePath)
}

func (s *Server) ensureWorkspaceGitRoot(project *db.Project, workspace *db.Workspace) (string, error) {
	if workspace.Kind == db.WorkspaceKindMain {
		return project.Path, nil
	}
	if workspaceHasUsableWorktree(workspace, s.worktree) {
		return strings.TrimSpace(*workspace.WorktreePath), nil
	}
	return "", fmt.Errorf("workspace worktree is not available")
}

func (s *Server) ensureWorkspaceWorktree(project *db.Project, workspace *db.Workspace) (*worktree.CreateResult, []string, error) {
	result, err := s.worktree.Create(worktree.CreateOptions{
		ProjectPath:  project.Path,
		ProjectID:    project.ID,
		ProjectName:  project.Name,
		TaskID:       workspace.ID,
		TaskTitle:    workspace.Name,
		BranchName:   workspace.BranchName,
		BaseBranch:   workspaceBaseBranch(project, workspace),
		AdoptBranch:  true,
		SymlinkPaths: project.SymlinkPaths,
		SecretFiles:  mapSecretFiles(project.SecretFiles),
		SetupScript:  ptrToString(project.SetupScript),
	})
	if err != nil {
		return nil, nil, err
	}
	return result, result.Warnings, nil
}

func (s *Server) syncWorkspaceBranch(project *db.Project, workspace *db.Workspace, root string) (string, bool, error) {
	baseBranch := workspaceBaseBranch(project, workspace)
	updated, err := syncLocalBranchWithRemoteIfPresent(project.Path, baseBranch)
	if err != nil {
		return "", false, err
	}
	if workspace.Kind == db.WorkspaceKindMain {
		return baseBranch, updated, nil
	}
	if err := requireCleanGitWorktree(root); err != nil {
		return "", false, err
	}
	if _, err := runGit(root, "rebase", baseBranch); err != nil {
		return "", false, err
	}
	return baseBranch, updated, nil
}

func syncLocalBranchWithRemote(repoPath, branch string) (bool, error) {
	_, updated, err := syncLocalBranchWithRemoteDetails(repoPath, branch)
	return updated, err
}

func syncLocalBranchWithRemoteIfPresent(repoPath, branch string) (bool, error) {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	remoteRef := "origin/" + branch
	if _, err := runGit(repoPath, "fetch", "--prune"); err != nil {
		return false, fmt.Errorf("failed to fetch remote: %w", err)
	}
	if _, err := runGit(repoPath, "rev-parse", "--verify", remoteRef); err != nil {
		return false, nil
	}
	_, updated, err := syncLocalBranchWithRemoteDetails(repoPath, branch)
	return updated, err
}

func syncLocalBranchWithRemoteDetails(repoPath, branch string) (string, bool, error) {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	remoteRef := "origin/" + branch

	if _, err := runGit(repoPath, "fetch", "--prune"); err != nil {
		return "", false, fmt.Errorf("failed to fetch remote: %w", err)
	}
	if _, err := runGit(repoPath, "rev-parse", "--verify", remoteRef); err != nil {
		return remoteRef, false, fmt.Errorf("remote tracking branch %q not found", remoteRef)
	}

	beforeHash := ""
	if out, err := runGit(repoPath, "rev-parse", "--verify", branch); err == nil {
		beforeHash = strings.TrimSpace(out)
	}

	if _, err := runGit(repoPath, "fetch", ".", fmt.Sprintf("%s:%s", remoteRef, branch)); err != nil {
		checkedOutPath := checkedOutPathFromFetchError(err.Error())
		if checkedOutPath == "" {
			return remoteRef, false, fmt.Errorf("failed to fast-forward %s to %s: %v", branch, remoteRef, err)
		}
		currentBranchOut, currentBranchErr := runGit(checkedOutPath, "branch", "--show-current")
		if currentBranchErr != nil {
			return remoteRef, false, fmt.Errorf("failed to inspect checked-out branch at %s: %v", checkedOutPath, currentBranchErr)
		}
		currentBranch := strings.TrimSpace(currentBranchOut)
		if currentBranch != branch {
			return remoteRef, false, fmt.Errorf("cannot sync %s: it is checked out at %s on branch %s", branch, checkedOutPath, currentBranch)
		}
		if _, pullErr := runGit(checkedOutPath, "pull", "--ff-only", "origin", branch); pullErr != nil {
			return remoteRef, false, fmt.Errorf("failed to fast-forward %s in checked-out worktree at %s: %v", branch, checkedOutPath, pullErr)
		}
	}

	afterOut, err := runGit(repoPath, "rev-parse", "--verify", branch)
	if err != nil {
		return remoteRef, false, fmt.Errorf("failed to read updated %s revision: %v", branch, err)
	}
	afterHash := strings.TrimSpace(afterOut)
	return remoteRef, beforeHash == "" || beforeHash != afterHash, nil
}

func requireCleanGitWorktree(root string) error {
	statusOut, err := runGit(root, "status", "--porcelain")
	if err != nil {
		return fmt.Errorf("failed to inspect workspace status: %w", err)
	}
	if strings.TrimSpace(statusOut) != "" {
		return fmt.Errorf("workspace has uncommitted changes")
	}
	return nil
}

func resolveWorkspaceMergeOptions(project *db.Project, req mergeWorkspaceRequest) (workspaceMergeOptions, error) {
	options := workspaceMergeOptions{
		SyncFirst:       true,
		PushAfterMerge:  false,
		CleanupWorktree: true,
		DeleteBranch:    false,
		MergeStrategy:   "merge",
	}
	if project.Workflow != nil && project.Workflow.ReviewToDone != nil {
		cfg := project.Workflow.ReviewToDone
		if cfg.PushAfterMerge != nil {
			options.PushAfterMerge = *cfg.PushAfterMerge
		}
		if cfg.CleanupWorktree != nil {
			options.CleanupWorktree = *cfg.CleanupWorktree
		}
		if cfg.DeleteBranch != nil {
			options.DeleteBranch = *cfg.DeleteBranch
		}
		if strings.TrimSpace(cfg.MergeStrategy) != "" {
			options.MergeStrategy = strings.TrimSpace(cfg.MergeStrategy)
		}
	}
	if req.SyncFirst != nil {
		options.SyncFirst = *req.SyncFirst
	}
	if req.PushAfterMerge != nil {
		options.PushAfterMerge = *req.PushAfterMerge
	}
	if req.CleanupWorktree != nil {
		options.CleanupWorktree = *req.CleanupWorktree
	}
	if req.DeleteBranch != nil {
		options.DeleteBranch = *req.DeleteBranch
	}
	if req.MergeStrategy != nil && strings.TrimSpace(*req.MergeStrategy) != "" {
		options.MergeStrategy = strings.TrimSpace(*req.MergeStrategy)
	}
	if req.TargetBranch != nil && strings.TrimSpace(*req.TargetBranch) != "" {
		options.TargetBranch = strings.TrimSpace(*req.TargetBranch)
	}
	switch options.MergeStrategy {
	case "merge", "squash", "rebase":
		return options, nil
	default:
		return workspaceMergeOptions{}, fmt.Errorf("invalid merge strategy")
	}
}

func mergeWorkspaceBranch(repoPath, worktreePath, baseBranch, featureBranch, strategy string) error {
	switch strategy {
	case "merge":
		return directMergeBranch(repoPath, baseBranch, featureBranch)
	case "squash":
		if _, err := runGit(repoPath, "checkout", baseBranch); err != nil {
			return fmt.Errorf("checkout %s: %w", baseBranch, err)
		}
		if _, err := runGit(repoPath, "merge", "--squash", featureBranch); err != nil {
			return fmt.Errorf("squash merge %s: %w", featureBranch, err)
		}
		if _, err := runGit(repoPath, "commit", "-m", fmt.Sprintf("Squash merge branch '%s'", featureBranch)); err != nil {
			return fmt.Errorf("commit squash merge %s: %w", featureBranch, err)
		}
		return nil
	case "rebase":
		if err := requireCleanGitWorktree(worktreePath); err != nil {
			return err
		}
		if _, err := runGit(worktreePath, "rebase", baseBranch); err != nil {
			return fmt.Errorf("rebase %s onto %s: %w", featureBranch, baseBranch, err)
		}
		if _, err := runGit(repoPath, "checkout", baseBranch); err != nil {
			return fmt.Errorf("checkout %s: %w", baseBranch, err)
		}
		if _, err := runGit(repoPath, "merge", "--ff-only", featureBranch); err != nil {
			return fmt.Errorf("fast-forward merge %s: %w", featureBranch, err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported merge strategy %q", strategy)
	}
}

func (s *Server) stopWorkspaceTerminals(workspaceID string) error {
	s.tunnels.StopForWorkspace(workspaceID)

	terminals, err := s.db.ListTerminalSessionsByWorkspace(workspaceID)
	if err != nil {
		return err
	}
	for _, terminal := range terminals {
		_ = s.sessions.runtime.Stop(terminal.ID)
	}
	return nil
}

func (s *Server) detachWorkspaceConversations(workspaceID, reason string) error {
	attachedConversations, err := s.db.ListConversationsByCurrentWorkspace(workspaceID)
	if err != nil {
		return err
	}
	for _, conversation := range attachedConversations {
		if _, err := s.db.SetConversationWorkspace(conversation.ID, nil, reason); err != nil {
			return err
		}
		s.pi.StopConversation(conversation.ID)
	}
	return nil
}

func isAllowedWorkspaceTransition(current, next db.WorkspaceStatus) bool {
	if current == next {
		return true
	}
	switch current {
	case db.WorkspaceStatusActive:
		return next == db.WorkspaceStatusMerged || next == db.WorkspaceStatusAbandoned || next == db.WorkspaceStatusArchived
	case db.WorkspaceStatusMerged, db.WorkspaceStatusAbandoned:
		return next == db.WorkspaceStatusActive || next == db.WorkspaceStatusArchived
	case db.WorkspaceStatusArchived:
		return next == db.WorkspaceStatusActive
	default:
		return false
	}
}

func workspaceLifecycleReason(status db.WorkspaceStatus) string {
	switch status {
	case db.WorkspaceStatusMerged:
		return "workspace merged"
	case db.WorkspaceStatusAbandoned:
		return "workspace abandoned"
	case db.WorkspaceStatusArchived:
		return "workspace archived"
	case db.WorkspaceStatusActive:
		return "workspace reactivated"
	default:
		return "workspace status changed"
	}
}

func (s *Server) handleListWorkspaceFiles(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	root, ok := s.resolveWorkspaceRoot(w, workspaceID)
	if !ok {
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	depth := 2
	if rawDepth := strings.TrimSpace(r.URL.Query().Get("depth")); rawDepth != "" {
		n, err := strconv.Atoi(rawDepth)
		if err != nil || n < 1 || n > 32 {
			writeError(w, http.StatusBadRequest, "depth must be between 1 and 32")
			return
		}
		depth = n
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "path not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a directory")
		return
	}
	entries, err := listProjectFiles(root, relPath, depth)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    filepath.ToSlash(relPath),
		"entries": entries,
	})
}

func (s *Server) handlePutWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	_, _, root, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}

	var req writeProjectFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}
	if len(req.Content) > maxProjectFileWriteBytes {
		writeError(w, http.StatusBadRequest, "content exceeds 1 MiB limit")
		return
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	fileMode := os.FileMode(0644)
	if info, err := os.Stat(absPath); err == nil {
		if info.IsDir() {
			writeError(w, http.StatusBadRequest, "path is a directory")
			return
		}
		fileMode = info.Mode().Perm()
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}
	if err := os.WriteFile(absPath, []byte(req.Content), fileMode); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"size":      info.Size(),
		"modTime":   info.ModTime(),
		"binary":    false,
		"truncated": false,
		"content":   req.Content,
	})
}

func (s *Server) handleReadWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	root, ok := s.resolveWorkspaceRoot(w, workspaceID)
	if !ok {
		return
	}
	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is a directory")
		return
	}
	f, err := os.Open(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer f.Close()
	buf, err := io.ReadAll(io.LimitReader(f, maxProjectFilePreviewBytes+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}
	truncated := len(buf) > maxProjectFilePreviewBytes
	if truncated {
		buf = buf[:maxProjectFilePreviewBytes]
	}
	isBinary := bytes.IndexByte(buf, 0) >= 0 || !utf8.Valid(buf)
	content := ""
	if !isBinary {
		content = string(buf)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"size":      info.Size(),
		"modTime":   info.ModTime(),
		"binary":    isBinary,
		"truncated": truncated,
		"content":   content,
	})
}

func (s *Server) handleCreateWorkspaceFileEntry(w http.ResponseWriter, r *http.Request) {
	_, _, root, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}

	var req createProjectFileEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}

	entryType := strings.TrimSpace(strings.ToLower(req.Type))
	if entryType == "" {
		entryType = "file"
	}
	if entryType != "file" && entryType != "dir" {
		writeError(w, http.StatusBadRequest, "type must be \"file\" or \"dir\"")
		return
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Stat(absPath); err == nil {
		writeError(w, http.StatusConflict, "path already exists")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	if entryType == "dir" {
		if err := os.MkdirAll(absPath, 0755); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create directory")
			return
		}
	} else {
		f, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
		if err := f.Close(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat created entry")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(relPath),
		"path":    filepath.ToSlash(relPath),
		"type":    entryType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handleDeleteWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	_, _, root, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "path not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if info.IsDir() {
		if err := os.RemoveAll(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete directory")
			return
		}
	} else {
		if err := os.Remove(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete file")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRenameWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	_, _, root, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}

	var req renameFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if status, msg := renameFileInRoot(root, req); status != 0 {
		writeError(w, status, msg)
		return
	}

	toRel, _ := normalizeRelativePath(req.To, false)
	absPath, _ := safeJoin(root, toRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat renamed entry")
		return
	}

	fileType := "file"
	if info.IsDir() {
		fileType = "dir"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"name":    filepath.Base(toRel),
		"path":    filepath.ToSlash(toRel),
		"type":    fileType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handleDuplicateWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	_, _, root, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}

	var req duplicateFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	copyRel, status, msg := duplicateFileInRoot(root, req.Path)
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	absPath, _ := safeJoin(root, copyRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat copy")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(copyRel),
		"path":    filepath.ToSlash(copyRel),
		"type":    "file",
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handleSearchWorkspaceFiles(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveWorkspaceRoot(w, urlParam(r, "id"))
	if !ok {
		return
	}

	var req fileSearchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}

	results, err := searchFiles(root, req.Query, req.Regex, req.CaseSensitive, req.MaxResults)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to search files")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleWorkspaceGitStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	root, ok := s.resolveWorkspaceRoot(w, workspaceID)
	if !ok {
		return
	}
	resp, err := gitStatus(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleWorkspaceGitDiff(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, project, root, ok := s.resolveWorkspaceResources(w, workspaceID)
	if !ok {
		return
	}
	file := strings.TrimSpace(r.URL.Query().Get("file"))
	staged := r.URL.Query().Get("staged") == "true"
	base := r.URL.Query().Get("base") == "true"
	commitHash := r.URL.Query().Get("commit")
	baseBranch := workspaceBaseBranch(project, workspace)
	if base && workspace.Kind == db.WorkspaceKindMain {
		base = false
	}

	out, err := workspaceGitDiff(root, file, staged, base, commitHash, baseBranch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, GitDiffResponse{Diff: out})
}

func (s *Server) handleWorkspaceGitDiffContent(w http.ResponseWriter, r *http.Request) {
	workspaceID := urlParam(r, "id")
	workspace, project, root, ok := s.resolveWorkspaceResources(w, workspaceID)
	if !ok {
		return
	}
	file := strings.TrimSpace(r.URL.Query().Get("file"))
	if file == "" {
		writeError(w, http.StatusBadRequest, "file parameter required")
		return
	}
	staged := r.URL.Query().Get("staged") == "true"
	base := r.URL.Query().Get("base") == "true"
	commitHash := r.URL.Query().Get("commit")
	baseBranch := workspaceBaseBranch(project, workspace)
	if base && workspace.Kind == db.WorkspaceKindMain {
		base = false
	}
	resp, err := gitDiffContent(root, file, staged, base, baseBranch, commitHash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleWorkspaceGitStage(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitStageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files is required")
		return
	}
	args := append([]string{"add", "--"}, req.Files...)
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitUnstage(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitStageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files is required")
		return
	}
	args := append([]string{"reset", "HEAD", "--"}, req.Files...)
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitRevert(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitRevertRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Tracked) == 0 && len(req.Untracked) == 0 {
		writeError(w, http.StatusBadRequest, "tracked or untracked files are required")
		return
	}
	if len(req.Tracked) > 0 {
		args := append([]string{"restore", "--staged", "--worktree", "--"}, req.Tracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if len(req.Untracked) > 0 {
		args := append([]string{"clean", "-f", "-d", "--"}, req.Untracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitCommit(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitCommitRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Message == "" && !req.Amend {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}
	args := []string{"commit"}
	if req.Amend {
		args = append(args, "--amend")
		if req.Message == "" {
			args = append(args, "--no-edit")
		}
	}
	if req.Message != "" {
		args = append(args, "-m", req.Message)
	}
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	hashOut, err := runGit(workDir, "rev-parse", "--short", "HEAD")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	msgOut, err := runGit(workDir, "log", "-1", "--format=%s")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, GitCommitResponse{
		Hash:    strings.TrimSpace(hashOut),
		Message: strings.TrimSpace(msgOut),
	})
}

func (s *Server) handleWorkspaceGitPull(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	if _, err := runGit(workDir, "pull", "--ff-only"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitPush(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitPushRequest
	_ = decodeJSON(r, &req)
	if err := gitPushCurrentBranch(workDir, req.Force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitRebase(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req workspaceGitRebaseRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	baseBranch := strings.TrimSpace(req.BaseBranch)
	if baseBranch == "" {
		writeError(w, http.StatusBadRequest, "baseBranch is required")
		return
	}
	fetch := true
	if req.Fetch != nil {
		fetch = *req.Fetch
	}
	if fetch {
		if _, err := runGit(workDir, "fetch", "--prune"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	}
	if err := requireCleanGitWorktree(workDir); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if _, err := runGit(workDir, "rebase", baseBranch); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitOperationContinue(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	status, err := gitStatus(workDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	switch status.Operation {
	case "rebase":
		if _, err := runGitWithEnv(workDir, []string{"GIT_EDITOR=true"}, "rebase", "--continue"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	case "merge":
		if _, err := runGitWithEnv(workDir, []string{"GIT_EDITOR=true"}, "merge", "--continue"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	case "cherry-pick":
		if _, err := runGitWithEnv(workDir, []string{"GIT_EDITOR=true"}, "cherry-pick", "--continue"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	default:
		writeError(w, http.StatusConflict, "no paused git operation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitOperationAbort(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	status, err := gitStatus(workDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	switch status.Operation {
	case "rebase":
		if _, err := runGit(workDir, "rebase", "--abort"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	case "merge":
		if _, err := runGit(workDir, "merge", "--abort"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	case "cherry-pick":
		if _, err := runGit(workDir, "cherry-pick", "--abort"); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	default:
		writeError(w, http.StatusConflict, "no paused git operation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWorkspaceGitConflictContext(w http.ResponseWriter, r *http.Request) {
	workspace, project, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	status, err := gitStatus(workDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	statusText, _ := runGit(workDir, "status", "--short", "--branch")
	unmerged, _ := runGit(workDir, "ls-files", "-u")
	baseBranch := workspaceBaseBranch(project, workspace)
	conflictedFiles := make([]string, 0, len(status.Conflicted))
	for _, file := range status.Conflicted {
		conflictedFiles = append(conflictedFiles, file.Path)
	}
	operation := status.Operation
	if operation == "" && status.HasConflicts {
		operation = "conflict"
	}
	prompt := workspaceConflictPrompt(operation, workspace.BranchName, baseBranch, conflictedFiles, statusText, unmerged)
	writeJSON(w, http.StatusOK, workspaceConflictContextResponse{
		Operation:       operation,
		Branch:          workspace.BranchName,
		BaseBranch:      baseBranch,
		ConflictedFiles: conflictedFiles,
		Status:          strings.TrimSpace(statusText),
		Unmerged:        strings.TrimSpace(unmerged),
		Prompt:          prompt,
	})
}

func (s *Server) handleWorkspacePullRequest(w http.ResponseWriter, r *http.Request) {
	workspace, _, workDir, ok := s.resolveWorkspaceResources(w, urlParam(r, "id"))
	if !ok {
		return
	}
	pr, err := lookupWorkspacePullRequest(workDir, workspace.BranchName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (s *Server) handleCreateWorkspacePullRequest(w http.ResponseWriter, r *http.Request) {
	workspace, project, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	if workspace.Kind == db.WorkspaceKindMain {
		writeError(w, http.StatusBadRequest, "canonical main workspace cannot create a pull request")
		return
	}
	var req createWorkspacePullRequestRequest
	if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = workspace.Name
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		body = fmt.Sprintf("Created from Codeburg workspace `%s`.", workspace.Name)
	}
	if err := gitPushCurrentBranch(workDir, false); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	baseBranch := workspaceBaseBranch(project, workspace)
	prURL, err := github.CreatePR(workDir, title, body, baseBranch, workspace.BranchName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, workspacePullRequestResponse{
		Exists:     true,
		URL:        prURL,
		State:      "OPEN",
		Title:      title,
		BaseBranch: baseBranch,
		HeadBranch: workspace.BranchName,
	})
}

func (s *Server) handleWorkspaceGitStash(w http.ResponseWriter, r *http.Request) {
	_, _, workDir, ok := s.requireMutableWorkspace(w, urlParam(r, "id"))
	if !ok {
		return
	}
	var req GitStashRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	switch req.Action {
	case "push":
		if _, err := runGit(workDir, "stash", "push"); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "pop":
		if _, err := runGit(workDir, "stash", "pop"); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "list":
		out, err := runGit(workDir, "stash", "list")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		entries := []GitStashEntry{}
		scanner := bufio.NewScanner(strings.NewReader(out))
		idx := 0
		for scanner.Scan() {
			line := scanner.Text()
			if colonIdx := strings.Index(line, ": "); colonIdx >= 0 {
				entries = append(entries, GitStashEntry{
					Index:   idx,
					Message: line[colonIdx+2:],
				})
			}
			idx++
		}
		writeJSON(w, http.StatusOK, GitStashResponse{Entries: entries})
	default:
		writeError(w, http.StatusBadRequest, "invalid action: must be push, pop, or list")
	}
}

func (s *Server) handleWorkspaceGitLog(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveWorkspaceRoot(w, urlParam(r, "id"))
	if !ok {
		return
	}
	limit := 20
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	commits, err := gitLog(workDir, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, GitLogResponse{Commits: commits})
}

func (s *Server) handleGetTerminalSession(w http.ResponseWriter, r *http.Request) {
	sessionID := urlParam(r, "id")
	session, err := s.db.GetTerminalSession(sessionID)
	if err != nil {
		writeDBError(w, err, "terminal session")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

type updateTerminalSessionRequest struct {
	Title *string `json:"title,omitempty"`
}

func (s *Server) handleUpdateTerminalSession(w http.ResponseWriter, r *http.Request) {
	sessionID := urlParam(r, "id")
	var req updateTerminalSessionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	title := cleanOptionalString(req.Title)
	if title == nil {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	session, err := s.db.UpdateTerminalSession(sessionID, db.UpdateTerminalSessionInput{Title: title})
	if err != nil {
		writeDBError(w, err, "terminal session")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleDeleteTerminalSession(w http.ResponseWriter, r *http.Request) {
	sessionID := urlParam(r, "id")
	if _, err := s.db.GetTerminalSession(sessionID); err != nil {
		writeDBError(w, err, "terminal session")
		return
	}
	_ = s.sessions.runtime.Stop(sessionID)
	if err := s.db.DeleteTerminalSession(sessionID); err != nil {
		writeDBError(w, err, "terminal session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func defaultTerminalTitle(database *db.DB, workspaceID string) string {
	terminals, err := database.ListTerminalSessionsByWorkspace(workspaceID)
	if err != nil {
		return "Terminal #1"
	}
	maxNumber := 0
	for _, terminal := range terminals {
		if terminal.Title == nil {
			continue
		}
		var number int
		if _, err := fmt.Sscanf(strings.TrimSpace(*terminal.Title), "Terminal #%d", &number); err == nil && number > maxNumber {
			maxNumber = number
		}
	}
	return fmt.Sprintf("Terminal #%d", maxNumber+1)
}

func cleanOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func resolveWorkspaceTerminalCommand(shellOverride *string) (string, []string, error) {
	candidates := []string{}
	if shellOverride != nil && strings.TrimSpace(*shellOverride) != "" {
		candidates = append(candidates, strings.TrimSpace(*shellOverride))
	}
	if shellEnv := strings.TrimSpace(os.Getenv("SHELL")); shellEnv != "" {
		candidates = append(candidates, shellEnv)
	}
	candidates = append(candidates, "/bin/bash", "/bin/zsh", "/bin/sh", "bash", "zsh", "sh")

	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true

		resolved := candidate
		if filepath.IsAbs(candidate) {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return resolved, interactiveArgsForShell(resolved), nil
			}
			continue
		}

		path, err := exec.LookPath(candidate)
		if err == nil {
			resolved = path
			return resolved, interactiveArgsForShell(resolved), nil
		}
	}

	return "", nil, fmt.Errorf("failed to resolve an interactive shell for terminal startup")
}

func interactiveArgsForShell(shell string) []string {
	base := filepath.Base(shell)
	switch base {
	case "bash", "zsh":
		return []string{"-il"}
	case "sh":
		return []string{"-i"}
	default:
		return []string{"-i"}
	}
}

func ptrTerminalStatus(s db.TerminalSessionStatus) *db.TerminalSessionStatus {
	return &s
}

func strPtr(v string) *string {
	return &v
}

func workspaceGitDiff(workDir, file string, staged, base bool, commitHash, baseBranch string) (string, error) {
	var args []string
	switch {
	case commitHash != "":
		_, err := runGit(workDir, "rev-parse", "--verify", commitHash+"^")
		if err != nil {
			args = []string{"diff-tree", "--patch", "--no-commit-id", "-r", commitHash}
		} else {
			args = []string{"diff", commitHash + "^", commitHash}
		}
	case base:
		if strings.TrimSpace(baseBranch) == "" {
			baseBranch = "main"
		}
		compareTarget := resolveBaseDiffRef(workDir, baseBranch)
		mbOut, err := runGit(workDir, "merge-base", compareTarget, "HEAD")
		if err != nil {
			args = []string{"diff", compareTarget + "...HEAD"}
		} else {
			mergeBase := strings.TrimSpace(mbOut)
			args = []string{"diff", mergeBase, "HEAD"}
		}
	case staged:
		args = []string{"diff", "--cached"}
	default:
		args = []string{"diff"}
	}

	if file != "" {
		args = append(args, "--", file)
	}
	return runGit(workDir, args...)
}

func workspaceConflictPrompt(operation, branch, baseBranch string, conflictedFiles []string, statusText, unmerged string) string {
	if strings.TrimSpace(operation) == "" {
		operation = "git operation"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "The workspace is currently paused during a %s.\n\n", operation)
	b.WriteString("Goal:\nResolve the Git conflicts without changing unrelated behavior.\n\n")
	b.WriteString("Operation context:\n")
	fmt.Fprintf(&b, "- Current branch: %s\n", branch)
	fmt.Fprintf(&b, "- Base branch: %s\n", baseBranch)
	if len(conflictedFiles) > 0 {
		b.WriteString("\nConflicted files:\n")
		for _, file := range conflictedFiles {
			fmt.Fprintf(&b, "- %s\n", file)
		}
	}
	if trimmed := strings.TrimSpace(statusText); trimmed != "" {
		b.WriteString("\nGit status:\n```text\n")
		b.WriteString(trimmed)
		b.WriteString("\n```\n")
	}
	if trimmed := strings.TrimSpace(unmerged); trimmed != "" {
		b.WriteString("\nUnmerged index entries:\n```text\n")
		b.WriteString(trimmed)
		b.WriteString("\n```\n")
	}
	b.WriteString("\nInstructions:\n")
	b.WriteString("Open each conflicted file, resolve conflict markers, preserve the intended workspace changes unless the base branch clearly supersedes them, run the relevant checks, then stage the resolved files. Do not continue or abort the Git operation yourself unless explicitly asked; leave that final step to the UI after review.")
	return b.String()
}

func lookupWorkspacePullRequest(workDir, branch string) (workspacePullRequestResponse, error) {
	if _, err := exec.LookPath("gh"); err != nil {
		return workspacePullRequestResponse{Exists: false}, nil
	}
	cmd := exec.Command("gh", "pr", "view", branch, "--json", "url,state,title,baseRefName,headRefName")
	cmd.Dir = workDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.ToLower(strings.TrimSpace(string(output)))
		if strings.Contains(message, "no pull requests found") ||
			strings.Contains(message, "could not resolve to a pull request") ||
			strings.Contains(message, "not found") {
			return workspacePullRequestResponse{Exists: false}, nil
		}
		return workspacePullRequestResponse{}, fmt.Errorf("gh pr view: %s: %w", strings.TrimSpace(string(output)), err)
	}
	var payload struct {
		URL         string `json:"url"`
		State       string `json:"state"`
		Title       string `json:"title"`
		BaseRefName string `json:"baseRefName"`
		HeadRefName string `json:"headRefName"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return workspacePullRequestResponse{}, fmt.Errorf("parse gh pr view: %w", err)
	}
	if strings.TrimSpace(payload.URL) == "" {
		return workspacePullRequestResponse{Exists: false}, nil
	}
	return workspacePullRequestResponse{
		Exists:     true,
		URL:        payload.URL,
		State:      payload.State,
		Title:      payload.Title,
		BaseBranch: payload.BaseRefName,
		HeadBranch: payload.HeadRefName,
	}, nil
}
