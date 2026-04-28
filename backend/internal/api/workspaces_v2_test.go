package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

func createProjectAndWorkspace(t *testing.T, env *testEnv, repoPath string) (db.Project, db.Workspace) {
	t.Helper()

	resp := env.post("/api/projects", map[string]string{
		"name": "v2-workspace-" + db.NewID(),
		"path": repoPath,
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", resp.Code, resp.Body.String())
	}

	var project db.Project
	decodeResponse(t, resp, &project)

	wsResp := env.get("/api/projects/" + project.ID + "/workspaces")
	if wsResp.Code != http.StatusOK {
		t.Fatalf("list workspaces: %d %s", wsResp.Code, wsResp.Body.String())
	}

	var workspaces []db.Workspace
	decodeResponse(t, wsResp, &workspaces)
	if len(workspaces) != 1 {
		t.Fatalf("expected 1 canonical workspace, got %d", len(workspaces))
	}

	return project, workspaces[0]
}

func createTestGitRepoWithOrigin(t *testing.T) (string, string) {
	t.Helper()

	repoPath := createTestGitRepoWithMain(t)
	remoteRoot := t.TempDir()
	remotePath := filepath.Join(remoteRoot, "origin.git")
	gitExecHelper(t, remoteRoot, "init", "--bare", remotePath)
	gitExecHelper(t, repoPath, "remote", "add", "origin", remotePath)
	gitExecHelper(t, repoPath, "push", "-u", "origin", "main")
	gitExecHelper(t, remotePath, "symbolic-ref", "HEAD", "refs/heads/main")
	return repoPath, remotePath
}

func TestWorkspaceTerminalLifecycle(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	_, workspace := createProjectAndWorkspace(t, env, repoPath)

	t.Setenv("SHELL", "/definitely/missing-shell")

	resp := env.post("/api/workspaces/"+workspace.ID+"/terminals", map[string]any{
		"initialCommand": "printf bootstrapped > .terminal-bootstrap",
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create terminal: %d %s", resp.Code, resp.Body.String())
	}

	var session db.TerminalSession
	decodeResponse(t, resp, &session)
	if session.Status != db.TerminalSessionStatusRunning {
		t.Fatalf("expected running terminal, got %s", session.Status)
	}
	if session.Shell == nil || *session.Shell == "" {
		t.Fatal("expected resolved shell path")
	}
	if !env.server.sessions.runtime.Exists(session.ID) {
		t.Fatal("expected terminal runtime to exist")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(repoPath, ".terminal-bootstrap")); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(filepath.Join(repoPath, ".terminal-bootstrap")); err != nil {
		t.Fatalf("expected initial terminal command to run, stat err=%v", err)
	}

	listResp := env.get("/api/workspaces/" + workspace.ID + "/terminals")
	if listResp.Code != http.StatusOK {
		t.Fatalf("list terminals: %d %s", listResp.Code, listResp.Body.String())
	}
	var sessions []db.TerminalSession
	decodeResponse(t, listResp, &sessions)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 terminal session, got %d", len(sessions))
	}

	deleteResp := env.delete("/api/terminals/" + session.ID)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete terminal: %d %s", deleteResp.Code, deleteResp.Body.String())
	}

	deadline = time.Now().Add(2 * time.Second)
	for env.server.sessions.runtime.Exists(session.ID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if env.server.sessions.runtime.Exists(session.ID) {
		t.Fatal("expected terminal runtime to stop after deletion")
	}
}

func TestWorkspaceLifecycleTransitions(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, mainWorkspace := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Lifecycle workspace",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var createBody workspaceMutationResponse
	decodeResponse(t, createResp, &createBody)

	terminalResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/terminals", map[string]any{})
	if terminalResp.Code != http.StatusCreated {
		t.Fatalf("create workspace terminal: %d %s", terminalResp.Code, terminalResp.Body.String())
	}
	var terminal db.TerminalSession
	decodeResponse(t, terminalResp, &terminal)

	conversationResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Workspace lifecycle thread",
		"currentWorkspaceId": createBody.Workspace.ID,
	})
	if conversationResp.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", conversationResp.Code, conversationResp.Body.String())
	}
	var conversation db.Conversation
	decodeResponse(t, conversationResp, &conversation)

	mergeResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/merge", map[string]any{})
	if mergeResp.Code != http.StatusOK {
		t.Fatalf("merge workspace: %d %s", mergeResp.Code, mergeResp.Body.String())
	}
	var merged db.Workspace
	decodeResponse(t, mergeResp, &merged)
	if merged.Status != db.WorkspaceStatusMerged {
		t.Fatalf("expected merged status, got %s", merged.Status)
	}
	if merged.ClosedAt == nil {
		t.Fatal("expected merged workspace to set closed_at")
	}

	deadline := time.Now().Add(2 * time.Second)
	for env.server.sessions.runtime.Exists(terminal.ID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if env.server.sessions.runtime.Exists(terminal.ID) {
		t.Fatal("expected workspace merge to stop runtime terminals")
	}

	conversationAfterMerge, err := env.server.db.GetConversation(conversation.ID)
	if err != nil {
		t.Fatalf("load conversation after merge: %v", err)
	}
	if conversationAfterMerge.CurrentWorkspaceID != nil {
		t.Fatalf("expected merged workspace to detach conversation, got %v", conversationAfterMerge.CurrentWorkspaceID)
	}

	links, err := env.server.db.ListConversationWorkspaceLinks(conversation.ID)
	if err != nil {
		t.Fatalf("list conversation workspace links: %v", err)
	}
	if len(links) == 0 || links[0].Reason != "workspace merged" {
		t.Fatalf("expected latest workspace link to record merge reason, got %+v", links)
	}

	conflictResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/terminals", map[string]any{})
	if conflictResp.Code != http.StatusConflict {
		t.Fatalf("expected merged workspace terminal creation conflict, got %d %s", conflictResp.Code, conflictResp.Body.String())
	}

	activateResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/activate", map[string]any{})
	if activateResp.Code != http.StatusOK {
		t.Fatalf("reactivate workspace: %d %s", activateResp.Code, activateResp.Body.String())
	}
	var reactivated db.Workspace
	decodeResponse(t, activateResp, &reactivated)
	if reactivated.Status != db.WorkspaceStatusActive {
		t.Fatalf("expected active status after reactivation, got %s", reactivated.Status)
	}
	if reactivated.ClosedAt != nil {
		t.Fatalf("expected reactivated workspace to clear closed_at, got %v", reactivated.ClosedAt)
	}

	restartedTerminalResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/terminals", map[string]any{})
	if restartedTerminalResp.Code != http.StatusCreated {
		t.Fatalf("expected reactivated workspace to allow terminals, got %d %s", restartedTerminalResp.Code, restartedTerminalResp.Body.String())
	}

	mainMergeResp := env.post("/api/workspaces/"+mainWorkspace.ID+"/merge", map[string]any{})
	if mainMergeResp.Code != http.StatusBadRequest {
		t.Fatalf("expected canonical workspace merge to fail, got %d %s", mainMergeResp.Code, mainMergeResp.Body.String())
	}
}

func TestWorkspaceSyncRebasesOntoUpdatedBase(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath, remotePath := createTestGitRepoWithOrigin(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Sync workspace",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var workspaceBody workspaceMutationResponse
	decodeResponse(t, createResp, &workspaceBody)
	worktreePath := *workspaceBody.Workspace.WorktreePath

	if err := os.WriteFile(filepath.Join(worktreePath, "feature.txt"), []byte("feature\n"), 0644); err != nil {
		t.Fatalf("write feature file: %v", err)
	}
	gitExecHelper(t, worktreePath, "add", "feature.txt")
	gitExecHelper(t, worktreePath, "commit", "-m", "feature commit")

	clonePath := filepath.Join(t.TempDir(), "clone")
	gitExecHelper(t, filepath.Dir(clonePath), "clone", remotePath, clonePath)
	gitExecHelper(t, clonePath, "config", "user.email", "test@test.com")
	gitExecHelper(t, clonePath, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(clonePath, "remote.txt"), []byte("remote\n"), 0644); err != nil {
		t.Fatalf("write remote file: %v", err)
	}
	gitExecHelper(t, clonePath, "add", "remote.txt")
	gitExecHelper(t, clonePath, "commit", "-m", "remote commit")
	gitExecHelper(t, clonePath, "push", "origin", "main")

	syncResp := env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/sync", map[string]any{})
	if syncResp.Code != http.StatusOK {
		t.Fatalf("sync workspace: %d %s", syncResp.Code, syncResp.Body.String())
	}

	mergeBaseOut, err := runGit(worktreePath, "merge-base", "HEAD", "main")
	if err != nil {
		t.Fatalf("merge-base after sync: %v", err)
	}
	mainOut, err := runGit(worktreePath, "rev-parse", "main")
	if err != nil {
		t.Fatalf("rev-parse main after sync: %v", err)
	}
	if strings.TrimSpace(mergeBaseOut) != strings.TrimSpace(mainOut) {
		t.Fatalf("expected workspace HEAD to be rebased onto updated main")
	}

	logOut, err := runGit(worktreePath, "log", "--oneline", "main..HEAD")
	if err != nil {
		t.Fatalf("read feature log after sync: %v", err)
	}
	if !strings.Contains(logOut, "feature commit") {
		t.Fatalf("expected rebased branch to keep feature commit, got %q", logOut)
	}
	if _, err := os.Stat(filepath.Join(worktreePath, "remote.txt")); err != nil {
		t.Fatalf("expected synced workspace to contain remote update: %v", err)
	}
}

func TestWorkspaceMergeCleanupAndReactivation(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Merge workspace",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var workspaceBody workspaceMutationResponse
	decodeResponse(t, createResp, &workspaceBody)
	worktreePath := *workspaceBody.Workspace.WorktreePath

	if err := os.WriteFile(filepath.Join(worktreePath, "merged.txt"), []byte("merged\n"), 0644); err != nil {
		t.Fatalf("write merge file: %v", err)
	}
	gitExecHelper(t, worktreePath, "add", "merged.txt")
	gitExecHelper(t, worktreePath, "commit", "-m", "workspace merge commit")

	mergeResp := env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/merge", map[string]any{
		"cleanupWorktree": true,
		"deleteBranch":    false,
		"pushAfterMerge":  false,
		"syncFirst":       false,
	})
	if mergeResp.Code != http.StatusOK {
		t.Fatalf("merge workspace: %d %s", mergeResp.Code, mergeResp.Body.String())
	}
	var merged db.Workspace
	decodeResponse(t, mergeResp, &merged)
	if merged.Status != db.WorkspaceStatusMerged {
		t.Fatalf("expected merged status, got %s", merged.Status)
	}
	if merged.WorktreePath != nil {
		t.Fatalf("expected merged workspace cleanup to clear worktree path, got %v", merged.WorktreePath)
	}
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Fatalf("expected merged workspace worktree to be removed, stat err=%v", err)
	}
	logOut, err := runGit(repoPath, "log", "--oneline", "main", "-1")
	if err != nil {
		t.Fatalf("read main log after merge: %v", err)
	}
	if !strings.Contains(logOut, "Merge branch") {
		t.Fatalf("expected main branch to record merge commit, got %q", logOut)
	}

	activateResp := env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/activate", map[string]any{})
	if activateResp.Code != http.StatusOK {
		t.Fatalf("reactivate merged workspace: %d %s", activateResp.Code, activateResp.Body.String())
	}
	var reactivated db.Workspace
	decodeResponse(t, activateResp, &reactivated)
	if reactivated.Status != db.WorkspaceStatusActive {
		t.Fatalf("expected active status after reactivation, got %s", reactivated.Status)
	}
	if reactivated.WorktreePath == nil || *reactivated.WorktreePath == "" {
		t.Fatal("expected reactivation to recreate worktree path")
	}
	if _, err := os.Stat(*reactivated.WorktreePath); err != nil {
		t.Fatalf("expected recreated worktree path to exist: %v", err)
	}
}

func TestInactiveWorkspaceIsReadOnlyForMutations(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Read only workspace",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var workspaceBody workspaceMutationResponse
	decodeResponse(t, createResp, &workspaceBody)

	if err := os.WriteFile(filepath.Join(*workspaceBody.Workspace.WorktreePath, "README.md"), []byte("changed\n"), 0644); err != nil {
		t.Fatalf("write workspace file: %v", err)
	}

	archiveResp := env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/archive", map[string]any{})
	if archiveResp.Code != http.StatusOK {
		t.Fatalf("archive workspace: %d %s", archiveResp.Code, archiveResp.Body.String())
	}

	checkConflict := func(name string, resp *httptest.ResponseRecorder) {
		t.Helper()
		if resp.Code != http.StatusConflict {
			t.Fatalf("%s: expected 409 conflict, got %d %s", name, resp.Code, resp.Body.String())
		}
	}

	checkConflict("write file", env.request("PUT", "/api/workspaces/"+workspaceBody.Workspace.ID+"/file", map[string]any{
		"path":    "notes.txt",
		"content": "blocked",
	}))
	checkConflict("create file", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/files", map[string]any{
		"path": "new.txt",
		"type": "file",
	}))
	checkConflict("delete file", env.request("DELETE", "/api/workspaces/"+workspaceBody.Workspace.ID+"/file?path=README.md", nil))
	checkConflict("rename file", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/file/rename", map[string]any{
		"from": "README.md",
		"to":   "README-2.md",
	}))
	checkConflict("duplicate file", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/file/duplicate", map[string]any{
		"path": "README.md",
	}))
	checkConflict("git stage", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/git/stage", map[string]any{
		"files": []string{"README.md"},
	}))
	checkConflict("git commit", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/git/commit", map[string]any{
		"message": "blocked",
	}))
	checkConflict("git push", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/git/push", map[string]any{}))
	checkConflict("git stash", env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/git/stash", map[string]any{
		"action": "push",
	}))
}

func TestWorkspaceCreateForkAndDelete(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	secretPath := filepath.Join(repoPath, ".env")
	if err := os.WriteFile(secretPath, []byte("API_KEY=test-value\n"), 0644); err != nil {
		t.Fatalf("write secret file: %v", err)
	}

	resp := env.post("/api/projects", map[string]any{
		"name":        "workspace-flow-" + db.NewID(),
		"path":        repoPath,
		"setupScript": "printf ready > .workspace-ready",
		"secretFiles": []map[string]any{
			{"path": ".env", "mode": "copy", "enabled": true},
		},
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", resp.Code, resp.Body.String())
	}

	var project db.Project
	decodeResponse(t, resp, &project)

	wsResp := env.get("/api/projects/" + project.ID + "/workspaces")
	if wsResp.Code != http.StatusOK {
		t.Fatalf("list workspaces: %d %s", wsResp.Code, wsResp.Body.String())
	}
	var workspaces []db.Workspace
	decodeResponse(t, wsResp, &workspaces)
	mainWorkspace := workspaces[0]

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Parser experiment",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var createBody workspaceMutationResponse
	decodeResponse(t, createResp, &createBody)
	if createBody.Workspace.Kind != db.WorkspaceKindWorktree {
		t.Fatalf("expected worktree kind, got %s", createBody.Workspace.Kind)
	}
	if createBody.Workspace.WorktreePath == nil || *createBody.Workspace.WorktreePath == "" {
		t.Fatal("expected worktree path")
	}
	if _, err := os.Stat(filepath.Join(*createBody.Workspace.WorktreePath, ".workspace-ready")); err != nil {
		t.Fatalf("expected setup script marker: %v", err)
	}
	secretCopy, err := os.ReadFile(filepath.Join(*createBody.Workspace.WorktreePath, ".env"))
	if err != nil {
		t.Fatalf("read copied secret: %v", err)
	}
	if string(secretCopy) != "API_KEY=test-value\n" {
		t.Fatalf("unexpected secret copy content: %q", string(secretCopy))
	}

	forkResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/fork", map[string]any{
		"name": "Parser experiment fork",
	})
	if forkResp.Code != http.StatusCreated {
		t.Fatalf("fork workspace: %d %s", forkResp.Code, forkResp.Body.String())
	}
	var forkBody workspaceMutationResponse
	decodeResponse(t, forkResp, &forkBody)
	if forkBody.Workspace.ParentWorkspaceID == nil || *forkBody.Workspace.ParentWorkspaceID != createBody.Workspace.ID {
		t.Fatalf("expected fork parent %s, got %v", createBody.Workspace.ID, forkBody.Workspace.ParentWorkspaceID)
	}

	deleteResp := env.delete("/api/workspaces/" + forkBody.Workspace.ID)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete forked workspace: %d %s", deleteResp.Code, deleteResp.Body.String())
	}
	if forkBody.Workspace.WorktreePath != nil && *forkBody.Workspace.WorktreePath != "" {
		if _, err := os.Stat(*forkBody.Workspace.WorktreePath); !os.IsNotExist(err) {
			t.Fatalf("expected fork worktree to be removed, stat err=%v", err)
		}
	}

	mainDeleteResp := env.delete("/api/workspaces/" + mainWorkspace.ID)
	if mainDeleteResp.Code != http.StatusBadRequest {
		t.Fatalf("expected deleting main workspace to fail, got %d %s", mainDeleteResp.Code, mainDeleteResp.Body.String())
	}
}

func TestWorkspaceFileCRUDAndSearch(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	_, workspace := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/workspaces/"+workspace.ID+"/files", map[string]any{
		"path": "notes/todo.txt",
		"type": "file",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create file: %d %s", createResp.Code, createResp.Body.String())
	}

	writeResp := env.request("PUT", "/api/workspaces/"+workspace.ID+"/file", map[string]any{
		"path":    "notes/todo.txt",
		"content": "alpha\nbeta search target\n",
	})
	if writeResp.Code != http.StatusOK {
		t.Fatalf("write file: %d %s", writeResp.Code, writeResp.Body.String())
	}

	readResp := env.get("/api/workspaces/" + workspace.ID + "/file?path=notes%2Ftodo.txt")
	if readResp.Code != http.StatusOK {
		t.Fatalf("read file: %d %s", readResp.Code, readResp.Body.String())
	}

	searchResp := env.post("/api/workspaces/"+workspace.ID+"/files/search", map[string]any{
		"query": "search target",
	})
	if searchResp.Code != http.StatusOK {
		t.Fatalf("search files: %d %s", searchResp.Code, searchResp.Body.String())
	}

	renameResp := env.post("/api/workspaces/"+workspace.ID+"/file/rename", map[string]any{
		"from": "notes/todo.txt",
		"to":   "notes/todo-renamed.txt",
	})
	if renameResp.Code != http.StatusOK {
		t.Fatalf("rename file: %d %s", renameResp.Code, renameResp.Body.String())
	}

	dupResp := env.post("/api/workspaces/"+workspace.ID+"/file/duplicate", map[string]any{
		"path": "notes/todo-renamed.txt",
	})
	if dupResp.Code != http.StatusCreated {
		t.Fatalf("duplicate file: %d %s", dupResp.Code, dupResp.Body.String())
	}

	deleteResp := env.request("DELETE", "/api/workspaces/"+workspace.ID+"/file?path=notes%2Ftodo-renamed.txt", nil)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete file: %d %s", deleteResp.Code, deleteResp.Body.String())
	}
}

func TestWorkspaceGitOperations(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, workspace := createProjectAndWorkspace(t, env, repoPath)

	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Updated\n\nworkspace diff\n"), 0644); err != nil {
		t.Fatalf("write repo file: %v", err)
	}

	statusResp := env.get("/api/workspaces/" + workspace.ID + "/git/status")
	if statusResp.Code != http.StatusOK {
		t.Fatalf("git status: %d %s", statusResp.Code, statusResp.Body.String())
	}
	var status GitStatusResponse
	decodeResponse(t, statusResp, &status)
	if len(status.Unstaged) == 0 {
		t.Fatal("expected unstaged changes")
	}

	stageResp := env.post("/api/workspaces/"+workspace.ID+"/git/stage", GitStageRequest{
		Files: []string{"README.md"},
	})
	if stageResp.Code != http.StatusNoContent {
		t.Fatalf("git stage: %d %s", stageResp.Code, stageResp.Body.String())
	}

	commitResp := env.post("/api/workspaces/"+workspace.ID+"/git/commit", GitCommitRequest{
		Message: "workspace update",
	})
	if commitResp.Code != http.StatusOK {
		t.Fatalf("git commit: %d %s", commitResp.Code, commitResp.Body.String())
	}

	diffResp := env.get("/api/workspaces/" + workspace.ID + "/git/diff?base=true")
	if diffResp.Code != http.StatusOK {
		t.Fatalf("git diff base: %d %s", diffResp.Code, diffResp.Body.String())
	}

	logResp := env.get("/api/workspaces/" + workspace.ID + "/git/log")
	if logResp.Code != http.StatusOK {
		t.Fatalf("git log: %d %s", logResp.Code, logResp.Body.String())
	}
	var log GitLogResponse
	decodeResponse(t, logResp, &log)
	if len(log.Commits) == 0 {
		t.Fatal("expected at least one commit")
	}

	diffContentResp := env.get("/api/workspaces/" + workspace.ID + "/git/diff-content?file=README.md&base=true")
	if diffContentResp.Code != http.StatusOK {
		t.Fatalf("git diff content: %d %s", diffContentResp.Code, diffContentResp.Body.String())
	}
	var diffContent GitDiffContentResponse
	decodeResponse(t, diffContentResp, &diffContent)
	if !strings.Contains(diffContent.Original, "# Test") || !strings.Contains(diffContent.Modified, "workspace diff") {
		t.Fatalf("expected default-branch base diff content to compare previous HEAD with current HEAD, got original=%q modified=%q", diffContent.Original, diffContent.Modified)
	}

	// Canonical workspace should still point at the project root.
	if workspace.WorktreePath != nil {
		t.Fatalf("expected canonical workspace to use project root, got worktree path %q", *workspace.WorktreePath)
	}
	if project.Path != repoPath {
		t.Fatalf("expected project path %q, got %q", repoPath, project.Path)
	}
}

func TestWorkspaceEndStateCleanup(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "cleanup candidate",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var createBody workspaceMutationResponse
	decodeResponse(t, createResp, &createBody)
	worktreePath := *createBody.Workspace.WorktreePath

	abandonResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/abandon", map[string]any{
		"cleanupWorktree": true,
	})
	if abandonResp.Code != http.StatusOK {
		t.Fatalf("abandon workspace with cleanup: %d %s", abandonResp.Code, abandonResp.Body.String())
	}
	var abandoned db.Workspace
	decodeResponse(t, abandonResp, &abandoned)
	if abandoned.Status != db.WorkspaceStatusAbandoned {
		t.Fatalf("expected abandoned status, got %s", abandoned.Status)
	}
	if abandoned.WorktreePath != nil {
		t.Fatalf("expected cleanup to clear worktree path, got %v", abandoned.WorktreePath)
	}
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Fatalf("expected abandoned workspace worktree to be removed, stat err=%v", err)
	}

	activateResp := env.post("/api/workspaces/"+createBody.Workspace.ID+"/activate", map[string]any{})
	if activateResp.Code != http.StatusOK {
		t.Fatalf("reactivate cleaned workspace: %d %s", activateResp.Code, activateResp.Body.String())
	}
	var reactivated db.Workspace
	decodeResponse(t, activateResp, &reactivated)
	if reactivated.WorktreePath == nil || *reactivated.WorktreePath == "" {
		t.Fatal("expected reactivation to recreate worktree")
	}

	archiveResp := env.post("/api/workspaces/"+reactivated.ID+"/archive", map[string]any{})
	if archiveResp.Code != http.StatusOK {
		t.Fatalf("archive workspace: %d %s", archiveResp.Code, archiveResp.Body.String())
	}
	var archived db.Workspace
	decodeResponse(t, archiveResp, &archived)
	archivedPath := *archived.WorktreePath

	cleanupResp := env.post("/api/workspaces/"+archived.ID+"/cleanup", map[string]any{})
	if cleanupResp.Code != http.StatusOK {
		t.Fatalf("cleanup archived workspace: %d %s", cleanupResp.Code, cleanupResp.Body.String())
	}
	var cleaned db.Workspace
	decodeResponse(t, cleanupResp, &cleaned)
	if cleaned.Status != db.WorkspaceStatusArchived {
		t.Fatalf("expected archived status to be preserved, got %s", cleaned.Status)
	}
	if cleaned.WorktreePath != nil {
		t.Fatalf("expected explicit cleanup to clear worktree path, got %v", cleaned.WorktreePath)
	}
	if _, err := os.Stat(archivedPath); !os.IsNotExist(err) {
		t.Fatalf("expected archived workspace worktree to be removed, stat err=%v", err)
	}
}

func TestConversationLifecycleAndPiStatus(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, workspace := createProjectAndWorkspace(t, env, repoPath)

	homeDir := t.TempDir()
	agentDir := filepath.Join(homeDir, ".pi", "agent")
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		t.Fatalf("mkdir agent dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "auth.json"), []byte(`{"openai":{"type":"oauth"},"anthropic":{"type":"api-key"}}`), 0644); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "models.json"), []byte(`{"providers":{"openrouter":{"models":[{"id":"one"},{"id":"two"}]}}}`), 0644); err != nil {
		t.Fatalf("write models.json: %v", err)
	}

	binDir := filepath.Join(homeDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}
	piPath := filepath.Join(binDir, "pi")
	piScript := "#!/usr/bin/env bash\nif [[ \"$1\" == \"--version\" ]]; then\n  echo \"pi 0.67.68\"\n  exit 0\nfi\necho \"pi stub\"\n"
	if err := os.WriteFile(piPath, []byte(piScript), 0755); err != nil {
		t.Fatalf("write pi stub: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("PATH", fmt.Sprintf("%s:%s", binDir, os.Getenv("PATH")))

	statusResp := env.get("/api/pi/status")
	if statusResp.Code != http.StatusOK {
		t.Fatalf("pi status: %d %s", statusResp.Code, statusResp.Body.String())
	}
	var piStatus piStatusResponse
	decodeResponse(t, statusResp, &piStatus)
	if !piStatus.Installed {
		t.Fatal("expected pi to be installed")
	}
	if !piStatus.AuthConfigured {
		t.Fatal("expected pi auth to be configured")
	}
	if piStatus.Version == nil || *piStatus.Version != "pi 0.67.68" {
		t.Fatalf("unexpected pi version: %v", piStatus.Version)
	}
	if len(piStatus.AuthProviders) != 2 {
		t.Fatalf("expected 2 auth providers, got %d", len(piStatus.AuthProviders))
	}
	if len(piStatus.CustomProviders) != 1 || piStatus.CustomProviders[0].ID != "openrouter" || piStatus.CustomProviders[0].ModelCount != 2 {
		t.Fatalf("unexpected custom providers: %+v", piStatus.CustomProviders)
	}

	createResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Investigate parser edge cases",
		"currentWorkspaceId": workspace.ID,
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", createResp.Code, createResp.Body.String())
	}

	var conversation db.Conversation
	decodeResponse(t, createResp, &conversation)
	if conversation.Provider != "pi" {
		t.Fatalf("expected provider pi, got %s", conversation.Provider)
	}
	if conversation.CurrentWorkspaceID == nil || *conversation.CurrentWorkspaceID != workspace.ID {
		t.Fatalf("expected workspace %s, got %v", workspace.ID, conversation.CurrentWorkspaceID)
	}

	listResp := env.get("/api/projects/" + project.ID + "/conversations")
	if listResp.Code != http.StatusOK {
		t.Fatalf("list conversations: %d %s", listResp.Code, listResp.Body.String())
	}
	var conversations []db.Conversation
	decodeResponse(t, listResp, &conversations)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(conversations))
	}

	summary := "Needs a provider-backed runtime next."
	updateResp := env.patch("/api/conversations/"+conversation.ID, map[string]any{
		"status":  "paused",
		"summary": summary,
	})
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update conversation: %d %s", updateResp.Code, updateResp.Body.String())
	}

	var updated db.Conversation
	decodeResponse(t, updateResp, &updated)
	if updated.Status != db.ConversationStatusPaused {
		t.Fatalf("expected paused status, got %s", updated.Status)
	}
	if updated.Summary == nil || *updated.Summary != summary {
		t.Fatalf("unexpected summary: %v", updated.Summary)
	}
}

func TestPiConversationStateAndPrompt(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, workspace := createProjectAndWorkspace(t, env, repoPath)

	homeDir := t.TempDir()
	binDir := filepath.Join(homeDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}

	piPath := filepath.Join(binDir, "pi")
	piScript := `#!/usr/bin/env python3
import json
import os
import sys
import time

session_file = os.path.join(os.environ.get("HOME", "."), ".pi-session-test.jsonl")
messages = []
session_name = None

if len(sys.argv) > 1 and sys.argv[1] == "--version":
    print("pi 0.67.68")
    sys.exit(0)

def write(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    cmd = json.loads(line)
    cmd_id = cmd.get("id")
    cmd_type = cmd.get("type")

    if cmd_type == "switch_session":
        session_file = cmd.get("sessionPath") or session_file
        write({"id": cmd_id, "type": "response", "command": "switch_session", "success": True, "data": {"cancelled": False}})
    elif cmd_type == "set_session_name":
        session_name = cmd.get("name")
        write({"id": cmd_id, "type": "response", "command": "set_session_name", "success": True})
    elif cmd_type == "get_state":
        write({
            "id": cmd_id,
            "type": "response",
            "command": "get_state",
            "success": True,
            "data": {
                "model": {"provider": "openai", "id": "gpt-5.4"},
                "thinkingLevel": "medium",
                "isStreaming": False,
                "isCompacting": False,
                "steeringMode": "one-at-a-time",
                "followUpMode": "one-at-a-time",
                "sessionFile": session_file,
                "sessionId": "pi-test-session",
                "sessionName": session_name,
                "autoCompactionEnabled": True,
                "messageCount": len(messages),
                "pendingMessageCount": 0
            }
        })
    elif cmd_type == "get_messages":
        write({"id": cmd_id, "type": "response", "command": "get_messages", "success": True, "data": {"messages": messages}})
    elif cmd_type == "abort":
        write({"id": cmd_id, "type": "response", "command": "abort", "success": True})
    elif cmd_type == "prompt":
        prompt = cmd.get("message", "")
        now_ms = int(time.time() * 1000)
        messages.append({"role": "user", "content": prompt, "timestamp": now_ms})
        assistant = {
            "role": "assistant",
            "content": [{"type": "text", "text": "Echo: " + prompt}],
            "api": "responses",
            "provider": "openai",
            "model": "gpt-5.4",
            "usage": {"input": 1, "output": 1, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 2, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}},
            "stopReason": "stop",
            "timestamp": now_ms + 1
        }
        write({"id": cmd_id, "type": "response", "command": "prompt", "success": True})
        write({"type": "agent_start"})
        write({
            "type": "message_update",
            "message": assistant,
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "Echo: " + prompt}
        })
        messages.append(assistant)
        write({"type": "agent_end", "messages": [messages[-2], messages[-1]]})
    else:
        write({"id": cmd_id, "type": "response", "command": cmd_type, "success": False, "error": "unsupported"})
`
	if err := os.WriteFile(piPath, []byte(piScript), 0755); err != nil {
		t.Fatalf("write pi stub: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("PATH", fmt.Sprintf("%s:%s", binDir, os.Getenv("PATH")))

	createResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Prompt bridge",
		"currentWorkspaceId": workspace.ID,
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", createResp.Code, createResp.Body.String())
	}
	var conversation db.Conversation
	decodeResponse(t, createResp, &conversation)

	stateResp := env.get("/api/conversations/" + conversation.ID + "/state")
	if stateResp.Code != http.StatusOK {
		t.Fatalf("get state: %d %s", stateResp.Code, stateResp.Body.String())
	}
	var state piConversationSnapshot
	decodeResponse(t, stateResp, &state)
	if state.RuntimeActive {
		t.Fatal("expected passive state read not to start runtime")
	}

	promptResp := env.post("/api/conversations/"+conversation.ID+"/prompt", map[string]any{
		"message": "hello pi",
	})
	if promptResp.Code != http.StatusAccepted {
		t.Fatalf("prompt conversation: %d %s", promptResp.Code, promptResp.Body.String())
	}

	var promptState piConversationSnapshot
	decodeResponse(t, promptResp, &promptState)
	if !promptState.RuntimeActive {
		t.Fatal("expected prompt to activate runtime")
	}
	if promptState.SessionFile == nil || *promptState.SessionFile == "" {
		t.Fatal("expected session file")
	}
	if promptState.Model == nil || promptState.Model.ID != "gpt-5.4" {
		t.Fatalf("unexpected model: %+v", promptState.Model)
	}
	if len(promptState.Messages) < 2 {
		t.Fatalf("expected at least 2 messages, got %d", len(promptState.Messages))
	}
	if promptState.Messages[0].Role != "user" || promptState.Messages[0].Text != "hello pi" {
		t.Fatalf("unexpected first message: %+v", promptState.Messages[0])
	}
	last := promptState.Messages[len(promptState.Messages)-1]
	if last.Role != "assistant" || last.Text != "Echo: hello pi" {
		t.Fatalf("unexpected assistant message: %+v", last)
	}

	getResp := env.get("/api/conversations/" + conversation.ID)
	if getResp.Code != http.StatusOK {
		t.Fatalf("get conversation: %d %s", getResp.Code, getResp.Body.String())
	}
	var stored db.Conversation
	decodeResponse(t, getResp, &stored)
	if stored.ProviderSessionID == nil || *stored.ProviderSessionID == "" {
		t.Fatal("expected provider session id to be stored")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		getResp = env.get("/api/conversations/" + conversation.ID)
		if getResp.Code != http.StatusOK {
			t.Fatalf("get conversation unread state: %d %s", getResp.Code, getResp.Body.String())
		}
		decodeResponse(t, getResp, &stored)
		if stored.UnreadAt != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if stored.UnreadAt == nil {
		t.Fatal("expected agent completion to mark conversation unread")
	}

	readResp := env.post("/api/conversations/"+conversation.ID+"/read", map[string]any{})
	if readResp.Code != http.StatusOK {
		t.Fatalf("mark conversation read: %d %s", readResp.Code, readResp.Body.String())
	}
	var readStored db.Conversation
	decodeResponse(t, readResp, &readStored)
	if readStored.UnreadAt != nil {
		t.Fatalf("expected read conversation to clear unread state, got %v", readStored.UnreadAt)
	}

	unreadResp := env.post("/api/conversations/"+conversation.ID+"/unread", map[string]any{})
	if unreadResp.Code != http.StatusOK {
		t.Fatalf("mark conversation unread: %d %s", unreadResp.Code, unreadResp.Body.String())
	}
	var unreadStored db.Conversation
	decodeResponse(t, unreadResp, &unreadStored)
	if unreadStored.UnreadAt == nil {
		t.Fatal("expected manual unread marker")
	}
}

func TestConversationSearchForkAndWorkspaceReassignment(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, mainWorkspace := createProjectAndWorkspace(t, env, repoPath)

	forkResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name":       "Parser investigation",
		"branchName": "feat/parser-investigation",
	})
	if forkResp.Code != http.StatusCreated {
		t.Fatalf("create worktree workspace: %d %s", forkResp.Code, forkResp.Body.String())
	}
	var workspaceMutation workspaceMutationResponse
	decodeResponse(t, forkResp, &workspaceMutation)
	worktreeWorkspace := workspaceMutation.Workspace

	firstResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Investigate parser edge cases",
		"currentWorkspaceId": mainWorkspace.ID,
	})
	if firstResp.Code != http.StatusCreated {
		t.Fatalf("create first conversation: %d %s", firstResp.Code, firstResp.Body.String())
	}
	var first db.Conversation
	decodeResponse(t, firstResp, &first)

	secondResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Review tokenizer perf",
		"currentWorkspaceId": worktreeWorkspace.ID,
	})
	if secondResp.Code != http.StatusCreated {
		t.Fatalf("create second conversation: %d %s", secondResp.Code, secondResp.Body.String())
	}
	var second db.Conversation
	decodeResponse(t, secondResp, &second)

	summary := "Focus on parser regressions before forking."
	updateResp := env.patch("/api/conversations/"+first.ID, map[string]any{
		"summary": summary,
	})
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update summary: %d %s", updateResp.Code, updateResp.Body.String())
	}

	searchResp := env.get("/api/conversations?projectId=" + project.ID + "&q=regressions")
	if searchResp.Code != http.StatusOK {
		t.Fatalf("search conversations: %d %s", searchResp.Code, searchResp.Body.String())
	}
	var searchResults []db.Conversation
	decodeResponse(t, searchResp, &searchResults)
	if len(searchResults) != 1 || searchResults[0].ID != first.ID {
		t.Fatalf("unexpected search results: %+v", searchResults)
	}

	forkConversationResp := env.post("/api/conversations/"+first.ID+"/fork", map[string]any{
		"title":              "Investigate parser edge cases deeper",
		"currentWorkspaceId": worktreeWorkspace.ID,
	})
	if forkConversationResp.Code != http.StatusCreated {
		t.Fatalf("fork conversation: %d %s", forkConversationResp.Code, forkConversationResp.Body.String())
	}
	var forked db.Conversation
	decodeResponse(t, forkConversationResp, &forked)
	if forked.ParentConversationID == nil || *forked.ParentConversationID != first.ID {
		t.Fatalf("expected parent conversation %s, got %v", first.ID, forked.ParentConversationID)
	}
	if forked.CurrentWorkspaceID == nil || *forked.CurrentWorkspaceID != worktreeWorkspace.ID {
		t.Fatalf("expected forked workspace %s, got %v", worktreeWorkspace.ID, forked.CurrentWorkspaceID)
	}
	if forked.ProviderSessionID != nil {
		t.Fatalf("expected forked conversation to start without provider session, got %v", forked.ProviderSessionID)
	}

	detachResp := env.patch("/api/conversations/"+forked.ID, map[string]any{
		"currentWorkspaceId": "",
	})
	if detachResp.Code != http.StatusOK {
		t.Fatalf("detach workspace: %d %s", detachResp.Code, detachResp.Body.String())
	}
	var detached db.Conversation
	decodeResponse(t, detachResp, &detached)
	if detached.CurrentWorkspaceID != nil {
		t.Fatalf("expected detached conversation, got %v", detached.CurrentWorkspaceID)
	}

	statusResp := env.get("/api/conversations?projectId=" + project.ID + "&status=active&provider=pi")
	if statusResp.Code != http.StatusOK {
		t.Fatalf("filter conversations: %d %s", statusResp.Code, statusResp.Body.String())
	}
	var filtered []db.Conversation
	decodeResponse(t, statusResp, &filtered)
	if len(filtered) != 3 {
		t.Fatalf("expected 3 active pi conversations, got %d", len(filtered))
	}
}

func TestConversationLifecycleAndWorkspaceHistory(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, mainWorkspace := createProjectAndWorkspace(t, env, repoPath)

	homeDir := t.TempDir()
	binDir := filepath.Join(homeDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}

	piPath := filepath.Join(binDir, "pi")
	piScript := `#!/usr/bin/env python3
import json
import os
import sys
import time

session_file = os.path.join(os.environ.get("HOME", "."), ".pi-lifecycle-test.jsonl")
messages = []

if len(sys.argv) > 1 and sys.argv[1] == "--version":
    print("pi 0.67.68")
    sys.exit(0)

def write(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    cmd = json.loads(line)
    cmd_id = cmd.get("id")
    cmd_type = cmd.get("type")
    if cmd_type == "switch_session":
        session_file = cmd.get("sessionPath") or session_file
        write({"id": cmd_id, "type": "response", "command": "switch_session", "success": True, "data": {"cancelled": False}})
    elif cmd_type == "set_session_name":
        write({"id": cmd_id, "type": "response", "command": "set_session_name", "success": True})
    elif cmd_type == "get_state":
        write({"id": cmd_id, "type": "response", "command": "get_state", "success": True, "data": {
            "model": {"provider": "openai", "id": "gpt-5.4"},
            "isStreaming": False,
            "sessionFile": session_file,
            "sessionId": "pi-lifecycle-session",
            "sessionName": "Lifecycle"
        }})
    elif cmd_type == "get_messages":
        write({"id": cmd_id, "type": "response", "command": "get_messages", "success": True, "data": {"messages": messages}})
    elif cmd_type == "abort":
        write({"id": cmd_id, "type": "response", "command": "abort", "success": True})
    elif cmd_type == "prompt":
        prompt = cmd.get("message", "")
        now_ms = int(time.time() * 1000)
        messages.append({"role": "user", "content": prompt, "timestamp": now_ms})
        messages.append({"role": "assistant", "content": [{"type": "text", "text": "Handled: " + prompt}], "timestamp": now_ms + 1})
        write({"id": cmd_id, "type": "response", "command": "prompt", "success": True})
    else:
        write({"id": cmd_id, "type": "response", "command": cmd_type, "success": False, "error": "unsupported"})
`
	if err := os.WriteFile(piPath, []byte(piScript), 0755); err != nil {
		t.Fatalf("write pi stub: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("PATH", fmt.Sprintf("%s:%s", binDir, os.Getenv("PATH")))

	forkResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name":       "Lifecycle branch",
		"branchName": "feat/lifecycle",
	})
	if forkResp.Code != http.StatusCreated {
		t.Fatalf("create worktree workspace: %d %s", forkResp.Code, forkResp.Body.String())
	}
	var forkBody workspaceMutationResponse
	decodeResponse(t, forkResp, &forkBody)

	createResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Lifecycle thread",
		"currentWorkspaceId": mainWorkspace.ID,
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", createResp.Code, createResp.Body.String())
	}
	var conversation db.Conversation
	decodeResponse(t, createResp, &conversation)

	stateResp := env.get("/api/conversations/" + conversation.ID + "/state")
	if stateResp.Code != http.StatusOK {
		t.Fatalf("get state: %d %s", stateResp.Code, stateResp.Body.String())
	}
	var activeState piConversationSnapshot
	decodeResponse(t, stateResp, &activeState)
	if activeState.RuntimeActive {
		t.Fatal("expected passive state read not to start runtime")
	}

	switchResp := env.post("/api/conversations/"+conversation.ID+"/workspace", map[string]any{
		"currentWorkspaceId": forkBody.Workspace.ID,
		"reason":             "branching deeper implementation work",
	})
	if switchResp.Code != http.StatusOK {
		t.Fatalf("switch workspace: %d %s", switchResp.Code, switchResp.Body.String())
	}

	historyResp := env.get("/api/conversations/" + conversation.ID + "/workspaces")
	if historyResp.Code != http.StatusOK {
		t.Fatalf("workspace history: %d %s", historyResp.Code, historyResp.Body.String())
	}
	var history []db.ConversationWorkspaceLink
	decodeResponse(t, historyResp, &history)
	if len(history) < 2 {
		t.Fatalf("expected at least 2 workspace history entries, got %d", len(history))
	}
	if history[0].WorkspaceID == nil || *history[0].WorkspaceID != forkBody.Workspace.ID {
		t.Fatalf("expected latest history entry for workspace %s, got %+v", forkBody.Workspace.ID, history[0])
	}

	pauseResp := env.post("/api/conversations/"+conversation.ID+"/pause", map[string]any{})
	if pauseResp.Code != http.StatusOK {
		t.Fatalf("pause conversation: %d %s", pauseResp.Code, pauseResp.Body.String())
	}
	promptWhilePaused := env.post("/api/conversations/"+conversation.ID+"/prompt", map[string]any{
		"message": "should fail",
	})
	if promptWhilePaused.Code != http.StatusBadRequest {
		t.Fatalf("expected prompt while paused to fail with 400, got %d %s", promptWhilePaused.Code, promptWhilePaused.Body.String())
	}

	pausedStateResp := env.get("/api/conversations/" + conversation.ID + "/state")
	if pausedStateResp.Code != http.StatusOK {
		t.Fatalf("get paused state: %d %s", pausedStateResp.Code, pausedStateResp.Body.String())
	}
	var pausedState piConversationSnapshot
	decodeResponse(t, pausedStateResp, &pausedState)
	if pausedState.RuntimeActive {
		t.Fatal("expected paused conversation state to avoid starting runtime")
	}

	resumeResp := env.post("/api/conversations/"+conversation.ID+"/resume", map[string]any{})
	if resumeResp.Code != http.StatusOK {
		t.Fatalf("resume conversation: %d %s", resumeResp.Code, resumeResp.Body.String())
	}

	promptResp := env.post("/api/conversations/"+conversation.ID+"/prompt", map[string]any{
		"message": "after resume",
	})
	if promptResp.Code != http.StatusAccepted {
		t.Fatalf("prompt after resume: %d %s", promptResp.Code, promptResp.Body.String())
	}

	completeResp := env.post("/api/conversations/"+conversation.ID+"/complete", map[string]any{})
	if completeResp.Code != http.StatusOK {
		t.Fatalf("complete conversation: %d %s", completeResp.Code, completeResp.Body.String())
	}
	archiveResp := env.post("/api/conversations/"+conversation.ID+"/archive", map[string]any{})
	if archiveResp.Code != http.StatusOK {
		t.Fatalf("archive conversation: %d %s", archiveResp.Code, archiveResp.Body.String())
	}
	resumeArchived := env.post("/api/conversations/"+conversation.ID+"/resume", map[string]any{})
	if resumeArchived.Code != http.StatusConflict {
		t.Fatalf("expected archived conversation resume conflict, got %d %s", resumeArchived.Code, resumeArchived.Body.String())
	}
}

func TestConversationRejectsInactiveWorkspaceAttachments(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, mainWorkspace := createProjectAndWorkspace(t, env, repoPath)

	createResp := env.post("/api/projects/"+project.ID+"/workspaces", map[string]any{
		"name": "Inactive target",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", createResp.Code, createResp.Body.String())
	}
	var workspaceBody workspaceMutationResponse
	decodeResponse(t, createResp, &workspaceBody)

	mergeResp := env.post("/api/workspaces/"+workspaceBody.Workspace.ID+"/merge", map[string]any{})
	if mergeResp.Code != http.StatusOK {
		t.Fatalf("merge workspace: %d %s", mergeResp.Code, mergeResp.Body.String())
	}

	createConversationResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Active conversation",
		"currentWorkspaceId": mainWorkspace.ID,
	})
	if createConversationResp.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", createConversationResp.Code, createConversationResp.Body.String())
	}
	var conversation db.Conversation
	decodeResponse(t, createConversationResp, &conversation)

	createOnMergedResp := env.post("/api/projects/"+project.ID+"/conversations", map[string]any{
		"title":              "Should fail",
		"currentWorkspaceId": workspaceBody.Workspace.ID,
	})
	if createOnMergedResp.Code != http.StatusBadRequest {
		t.Fatalf("expected create conversation on merged workspace to fail, got %d %s", createOnMergedResp.Code, createOnMergedResp.Body.String())
	}

	switchResp := env.post("/api/conversations/"+conversation.ID+"/workspace", map[string]any{
		"currentWorkspaceId": workspaceBody.Workspace.ID,
	})
	if switchResp.Code != http.StatusBadRequest {
		t.Fatalf("expected switching to merged workspace to fail, got %d %s", switchResp.Code, switchResp.Body.String())
	}

	patchResp := env.patch("/api/conversations/"+conversation.ID, map[string]any{
		"currentWorkspaceId": workspaceBody.Workspace.ID,
	})
	if patchResp.Code != http.StatusBadRequest {
		t.Fatalf("expected patching merged workspace to fail, got %d %s", patchResp.Code, patchResp.Body.String())
	}

	detachResp := env.patch("/api/conversations/"+conversation.ID, map[string]any{
		"currentWorkspaceId": "",
	})
	if detachResp.Code != http.StatusOK {
		t.Fatalf("detach conversation workspace: %d %s", detachResp.Code, detachResp.Body.String())
	}

	linksResp := env.get("/api/conversations/" + conversation.ID + "/workspaces")
	if linksResp.Code != http.StatusOK {
		t.Fatalf("list workspace links: %d %s", linksResp.Code, linksResp.Body.String())
	}
	var links []db.ConversationWorkspaceLink
	decodeResponse(t, linksResp, &links)
	if len(links) == 0 || links[0].WorkspaceID != nil || links[0].Reason != "updated" {
		t.Fatalf("expected detached workspace history entry, got %+v", links)
	}
}

func TestPiConfigReadAndWrite(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	agentDir := filepath.Join(homeDir, ".pi", "agent")
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		t.Fatalf("mkdir agent dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "settings.json"), []byte("{\"defaultProvider\":\"openai\"}\n"), 0644); err != nil {
		t.Fatalf("write settings.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "models.json"), []byte("{\"providers\":{\"openai\":{\"models\":[{\"id\":\"gpt-5.4\"}]}}}\n"), 0644); err != nil {
		t.Fatalf("write models.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "auth.json"), []byte("{\"openai\":{\"type\":\"oauth\"}}\n"), 0644); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}

	binDir := filepath.Join(homeDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}
	piScript := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 1.2.3\n  exit 0\nfi\necho unsupported >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(binDir, "pi"), []byte(piScript), 0755); err != nil {
		t.Fatalf("write fake pi: %v", err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	globalResp := env.get("/api/pi/config")
	if globalResp.Code != http.StatusOK {
		t.Fatalf("get global pi config: %d %s", globalResp.Code, globalResp.Body.String())
	}
	var globalConfig piConfigResponse
	decodeResponse(t, globalResp, &globalConfig)
	if !globalConfig.Status.AuthConfigured {
		t.Fatal("expected pi auth to be configured")
	}
	if !globalConfig.GlobalSettings.Exists || !globalConfig.GlobalSettings.Valid {
		t.Fatalf("expected readable global settings, got %+v", globalConfig.GlobalSettings)
	}
	if !strings.Contains(globalConfig.Models.Content, "gpt-5.4") {
		t.Fatalf("expected models content, got %q", globalConfig.Models.Content)
	}

	projectResp := env.get("/api/projects/" + project.ID + "/pi/config")
	if projectResp.Code != http.StatusOK {
		t.Fatalf("get project pi config: %d %s", projectResp.Code, projectResp.Body.String())
	}
	var projectConfig piConfigResponse
	decodeResponse(t, projectResp, &projectConfig)
	if projectConfig.ProjectSettings == nil {
		t.Fatal("expected project settings document")
	}
	if projectConfig.ProjectSettings.Exists {
		t.Fatalf("expected no project settings yet, got %+v", projectConfig.ProjectSettings)
	}

	writeGlobalSettingsResp := env.request("PUT", "/api/pi/settings", map[string]any{
		"content": "{\"defaultProvider\":\"anthropic\",\"defaultThinkingLevel\":\"medium\"}",
	})
	if writeGlobalSettingsResp.Code != http.StatusOK {
		t.Fatalf("put global pi settings: %d %s", writeGlobalSettingsResp.Code, writeGlobalSettingsResp.Body.String())
	}

	writeModelsResp := env.request("PUT", "/api/pi/models", map[string]any{
		"content": "{\"providers\":{\"local\":{\"baseUrl\":\"http://localhost:11434/v1\",\"api\":\"openai-completions\",\"apiKey\":\"ollama\",\"models\":[{\"id\":\"llama3.1:8b\"}]}}}",
	})
	if writeModelsResp.Code != http.StatusOK {
		t.Fatalf("put pi models: %d %s", writeModelsResp.Code, writeModelsResp.Body.String())
	}

	writeProjectSettingsResp := env.request("PUT", "/api/projects/"+project.ID+"/pi/settings", map[string]any{
		"content": "{\"defaultModel\":\"gpt-5.4\",\"theme\":\"light\"}",
	})
	if writeProjectSettingsResp.Code != http.StatusOK {
		t.Fatalf("put project pi settings: %d %s", writeProjectSettingsResp.Code, writeProjectSettingsResp.Body.String())
	}

	globalSettingsRaw, err := os.ReadFile(filepath.Join(agentDir, "settings.json"))
	if err != nil {
		t.Fatalf("read written settings.json: %v", err)
	}
	if !strings.HasSuffix(string(globalSettingsRaw), "\n") || !strings.Contains(string(globalSettingsRaw), "\"defaultThinkingLevel\": \"medium\"") {
		t.Fatalf("unexpected global settings content: %q", string(globalSettingsRaw))
	}

	modelsRaw, err := os.ReadFile(filepath.Join(agentDir, "models.json"))
	if err != nil {
		t.Fatalf("read written models.json: %v", err)
	}
	if !strings.Contains(string(modelsRaw), "\"local\"") || !strings.Contains(string(modelsRaw), "\"llama3.1:8b\"") {
		t.Fatalf("unexpected models content: %q", string(modelsRaw))
	}

	projectSettingsPath := filepath.Join(repoPath, ".pi", "settings.json")
	projectSettingsRaw, err := os.ReadFile(projectSettingsPath)
	if err != nil {
		t.Fatalf("read project settings.json: %v", err)
	}
	if !strings.Contains(string(projectSettingsRaw), "\"defaultModel\": \"gpt-5.4\"") {
		t.Fatalf("unexpected project settings content: %q", string(projectSettingsRaw))
	}

	invalidResp := env.request("PUT", "/api/pi/settings", map[string]any{
		"content": "{\"broken\":",
	})
	if invalidResp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid json to fail, got %d %s", invalidResp.Code, invalidResp.Body.String())
	}
}

func TestPiPackagesAndExtensionsManagement(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	agentDir := filepath.Join(homeDir, ".pi", "agent")
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		t.Fatalf("mkdir agent dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "settings.json"), []byte("{\"packages\":[\"npm:global-pkg\"],\"extensions\":[\"~/.pi/agent/extensions/global.ts\"]}\n"), 0644); err != nil {
		t.Fatalf("write global settings.json: %v", err)
	}

	binDir := filepath.Join(homeDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}
	piScript := `#!/bin/sh
scope="global"
cmd="$1"
shift
if [ "$1" = "-l" ]; then
  scope="project"
  shift
fi
settings_path="$HOME/.pi/agent/settings.json"
if [ "$scope" = "project" ]; then
  mkdir -p .pi
  settings_path=".pi/settings.json"
fi
source_arg="$1"
case "$cmd" in
  install)
    printf '{"packages":["%s"]}\n' "$source_arg" > "$settings_path"
    ;;
  remove)
    printf '{"packages":[]}\n' > "$settings_path"
    ;;
  update)
    exit 0
    ;;
  --version)
    echo 9.9.9
    ;;
  *)
    echo "unsupported" >&2
    exit 1
    ;;
esac
`
	if err := os.WriteFile(filepath.Join(binDir, "pi"), []byte(piScript), 0755); err != nil {
		t.Fatalf("write fake pi: %v", err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	installPkgResp := env.post("/api/projects/"+project.ID+"/pi/packages/install", map[string]any{
		"source": "git:github.com/example/project-tools@v1",
	})
	if installPkgResp.Code != http.StatusOK {
		t.Fatalf("install project pi package: %d %s", installPkgResp.Code, installPkgResp.Body.String())
	}

	addExtResp := env.post("/api/projects/"+project.ID+"/pi/extensions", map[string]any{
		"path": ".pi/extensions/project-tool.ts",
	})
	if addExtResp.Code != http.StatusOK {
		t.Fatalf("add project pi extension: %d %s", addExtResp.Code, addExtResp.Body.String())
	}

	projectConfigResp := env.get("/api/projects/" + project.ID + "/pi/config")
	if projectConfigResp.Code != http.StatusOK {
		t.Fatalf("get project pi config: %d %s", projectConfigResp.Code, projectConfigResp.Body.String())
	}
	var projectConfig piConfigResponse
	decodeResponse(t, projectConfigResp, &projectConfig)
	if len(projectConfig.GlobalPackages) != 1 || projectConfig.GlobalPackages[0].Source != "npm:global-pkg" {
		t.Fatalf("unexpected global packages: %+v", projectConfig.GlobalPackages)
	}
	if len(projectConfig.ProjectPackages) != 1 || projectConfig.ProjectPackages[0].Source != "git:github.com/example/project-tools@v1" {
		t.Fatalf("unexpected project packages: %+v", projectConfig.ProjectPackages)
	}
	if !projectConfig.ProjectPackages[0].Pinned {
		t.Fatalf("expected pinned project package, got %+v", projectConfig.ProjectPackages[0])
	}
	if len(projectConfig.GlobalExtensions) != 1 || projectConfig.GlobalExtensions[0].Path != "~/.pi/agent/extensions/global.ts" {
		t.Fatalf("unexpected global extensions: %+v", projectConfig.GlobalExtensions)
	}
	if len(projectConfig.ProjectExtensions) != 1 || projectConfig.ProjectExtensions[0].Path != ".pi/extensions/project-tool.ts" {
		t.Fatalf("unexpected project extensions: %+v", projectConfig.ProjectExtensions)
	}

	removeExtResp := env.post("/api/projects/"+project.ID+"/pi/extensions/remove", map[string]any{
		"path": ".pi/extensions/project-tool.ts",
	})
	if removeExtResp.Code != http.StatusOK {
		t.Fatalf("remove project pi extension: %d %s", removeExtResp.Code, removeExtResp.Body.String())
	}

	removePkgResp := env.post("/api/projects/"+project.ID+"/pi/packages/remove", map[string]any{
		"source": "git:github.com/example/project-tools@v1",
	})
	if removePkgResp.Code != http.StatusOK {
		t.Fatalf("remove project pi package: %d %s", removePkgResp.Code, removePkgResp.Body.String())
	}

	updateResp := env.post("/api/projects/"+project.ID+"/pi/packages/update", map[string]any{})
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update project pi packages: %d %s", updateResp.Code, updateResp.Body.String())
	}

	projectSettingsRaw, err := os.ReadFile(filepath.Join(repoPath, ".pi", "settings.json"))
	if err != nil {
		t.Fatalf("read project settings after package management: %v", err)
	}
	if strings.Contains(string(projectSettingsRaw), "project-tool.ts") {
		t.Fatalf("expected extension to be removed, got %q", string(projectSettingsRaw))
	}
	if !strings.Contains(string(projectSettingsRaw), "\"packages\":[]") {
		t.Fatalf("expected project packages to be removed, got %q", string(projectSettingsRaw))
	}
}

func TestProjectSkillsDiscoveryInstallAndDelete(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	globalSkillDir := filepath.Join(homeDir, ".codex", "skills", "global-helper")
	if err := os.MkdirAll(globalSkillDir, 0755); err != nil {
		t.Fatalf("mkdir global skill dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(globalSkillDir, "SKILL.md"), []byte("---\nname: global-helper\ndescription: global helper skill\n---\n"), 0644); err != nil {
		t.Fatalf("write global skill: %v", err)
	}

	globalResp := env.get("/api/skills")
	if globalResp.Code != http.StatusOK {
		t.Fatalf("list global skills: %d %s", globalResp.Code, globalResp.Body.String())
	}
	var globalSkills []managedSkill
	decodeResponse(t, globalResp, &globalSkills)
	if len(globalSkills) != 1 || globalSkills[0].Name != "global-helper" {
		t.Fatalf("unexpected global skills: %+v", globalSkills)
	}

	sourceSkillDir := filepath.Join(t.TempDir(), "lint-helper")
	if err := os.MkdirAll(sourceSkillDir, 0755); err != nil {
		t.Fatalf("mkdir source skill dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceSkillDir, "SKILL.md"), []byte("# Lint Helper\n\nKeeps linting tidy.\n"), 0644); err != nil {
		t.Fatalf("write source skill: %v", err)
	}

	installResp := env.post("/api/projects/"+project.ID+"/skills", map[string]any{
		"sourcePath": sourceSkillDir,
		"target":     "agents",
		"mode":       "symlink",
	})
	if installResp.Code != http.StatusCreated {
		t.Fatalf("install project skill: %d %s", installResp.Code, installResp.Body.String())
	}

	projectSkillsResp := env.get("/api/projects/" + project.ID + "/skills")
	if projectSkillsResp.Code != http.StatusOK {
		t.Fatalf("list project skills: %d %s", projectSkillsResp.Code, projectSkillsResp.Body.String())
	}
	var projectSkills projectSkillsResponse
	decodeResponse(t, projectSkillsResp, &projectSkills)
	if len(projectSkills.Installed) != 1 || projectSkills.Installed[0].Name != "lint-helper" {
		t.Fatalf("unexpected installed project skills: %+v", projectSkills.Installed)
	}
	if len(projectSkills.Available) != 1 || projectSkills.Available[0].Name != "global-helper" {
		t.Fatalf("unexpected available skills: %+v", projectSkills.Available)
	}

	globalInstallResp := env.post("/api/skills", map[string]any{
		"sourcePath": sourceSkillDir,
		"target":     "agents",
		"mode":       "copy",
	})
	if globalInstallResp.Code != http.StatusCreated {
		t.Fatalf("install global skill: %d %s", globalInstallResp.Code, globalInstallResp.Body.String())
	}
	if _, err := os.Stat(filepath.Join(homeDir, ".agents", "skills", "lint-helper", "SKILL.md")); err != nil {
		t.Fatalf("expected copied global skill: %v", err)
	}

	globalDeleteResp := env.delete("/api/skills/agents/lint-helper")
	if globalDeleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete global skill: %d %s", globalDeleteResp.Code, globalDeleteResp.Body.String())
	}
	if _, err := os.Lstat(filepath.Join(homeDir, ".agents", "skills", "lint-helper")); !os.IsNotExist(err) {
		t.Fatalf("expected global skill to be removed, err=%v", err)
	}

	deleteResp := env.delete("/api/projects/" + project.ID + "/skills/agents/lint-helper")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete project skill: %d %s", deleteResp.Code, deleteResp.Body.String())
	}
	if _, err := os.Lstat(filepath.Join(repoPath, ".agents", "skills", "lint-helper")); !os.IsNotExist(err) {
		t.Fatalf("expected skill installation to be removed, err=%v", err)
	}
}

func TestCuratedSkillCatalogDiscoveryAndInstall(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	repoPath := createTestGitRepoWithMain(t)
	project, _ := createProjectAndWorkspace(t, env, repoPath)

	catalogRoot := t.TempDir()

	openAISource := filepath.Join(catalogRoot, "openai")
	if err := os.MkdirAll(filepath.Join(openAISource, "skills", ".curated", "frontend-skill"), 0755); err != nil {
		t.Fatalf("mkdir openai catalog: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openAISource, "skills", ".curated", "frontend-skill", "SKILL.md"), []byte("---\nname: frontend-skill\ndescription: Makes frontend work better\n---\n"), 0644); err != nil {
		t.Fatalf("write openai skill: %v", err)
	}

	cloudflareSource := filepath.Join(catalogRoot, "cloudflare")
	if err := os.MkdirAll(filepath.Join(cloudflareSource, "skills", "workers-best-practices"), 0755); err != nil {
		t.Fatalf("mkdir cloudflare catalog: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cloudflareSource, "skills", "workers-best-practices", "SKILL.md"), []byte("# Workers Best Practices\n\nFor Cloudflare workers.\n"), 0644); err != nil {
		t.Fatalf("write cloudflare skill: %v", err)
	}

	originalSources := curatedSkillCatalogSources
	curatedSkillCatalogSources = []curatedSkillCatalogSource{
		{
			ID:            "openai-curated",
			Name:          "OpenAI Curated Skills",
			RepoURL:       openAISource,
			RepoRef:       "",
			SkillPrefixes: []string{"skills/.curated/"},
		},
		{
			ID:            "cloudflare",
			Name:          "Cloudflare Skills",
			RepoURL:       cloudflareSource,
			RepoRef:       "",
			SkillPrefixes: []string{"skills/"},
		},
	}
	t.Cleanup(func() {
		curatedSkillCatalogSources = originalSources
	})

	catalogResp := env.get("/api/skills/catalog")
	if catalogResp.Code != http.StatusOK {
		t.Fatalf("list skill catalog: %d %s", catalogResp.Code, catalogResp.Body.String())
	}
	var catalog []curatedSkillCatalogEntry
	decodeResponse(t, catalogResp, &catalog)
	if len(catalog) != 2 {
		t.Fatalf("expected 2 catalog skills, got %+v", catalog)
	}

	customSourceRoot := filepath.Join(catalogRoot, "custom")
	if err := os.MkdirAll(filepath.Join(customSourceRoot, "skills", "team-review"), 0755); err != nil {
		t.Fatalf("mkdir custom catalog: %v", err)
	}
	if err := os.WriteFile(filepath.Join(customSourceRoot, "skills", "team-review", "SKILL.md"), []byte("---\nname: team-review\ndescription: Team review conventions\n---\n"), 0644); err != nil {
		t.Fatalf("write custom skill: %v", err)
	}
	createSourceResp := env.post("/api/skills/catalog/sources", map[string]any{
		"name":          "Team Skills",
		"repoUrl":       customSourceRoot,
		"skillPrefixes": []string{"skills/"},
	})
	if createSourceResp.Code != http.StatusCreated {
		t.Fatalf("create custom catalog source: %d %s", createSourceResp.Code, createSourceResp.Body.String())
	}
	var customSource curatedSkillCatalogSource
	decodeResponse(t, createSourceResp, &customSource)
	if customSource.ID == "" || customSource.BuiltIn {
		t.Fatalf("unexpected custom source: %+v", customSource)
	}

	sourcesResp := env.get("/api/skills/catalog/sources")
	if sourcesResp.Code != http.StatusOK {
		t.Fatalf("list catalog sources: %d %s", sourcesResp.Code, sourcesResp.Body.String())
	}
	var sources []curatedSkillCatalogSource
	decodeResponse(t, sourcesResp, &sources)
	if len(sources) != 3 {
		t.Fatalf("expected 3 catalog sources, got %+v", sources)
	}

	catalogResp = env.get("/api/skills/catalog")
	if catalogResp.Code != http.StatusOK {
		t.Fatalf("list skill catalog with custom source: %d %s", catalogResp.Code, catalogResp.Body.String())
	}
	decodeResponse(t, catalogResp, &catalog)
	if len(catalog) != 3 {
		t.Fatalf("expected 3 catalog skills after custom source, got %+v", catalog)
	}

	installResp := env.post("/api/projects/"+project.ID+"/skills/catalog", map[string]any{
		"sourceId":  "openai-curated",
		"skillPath": "skills/.curated/frontend-skill",
		"target":    "agents",
		"name":      "frontend-skill",
	})
	if installResp.Code != http.StatusCreated {
		t.Fatalf("install catalog skill: %d %s", installResp.Code, installResp.Body.String())
	}

	installedSkillPath := filepath.Join(repoPath, ".agents", "skills", "frontend-skill", "SKILL.md")
	installedRaw, err := os.ReadFile(installedSkillPath)
	if err != nil {
		t.Fatalf("read installed catalog skill: %v", err)
	}
	if !strings.Contains(string(installedRaw), "Makes frontend work better") {
		t.Fatalf("unexpected installed skill content: %q", string(installedRaw))
	}

	customInstallResp := env.post("/api/projects/"+project.ID+"/skills/catalog", map[string]any{
		"sourceId":  customSource.ID,
		"skillPath": "skills/team-review",
		"target":    "agents",
		"name":      "team-review",
	})
	if customInstallResp.Code != http.StatusCreated {
		t.Fatalf("install custom catalog skill: %d %s", customInstallResp.Code, customInstallResp.Body.String())
	}
	if _, err := os.Stat(filepath.Join(repoPath, ".agents", "skills", "team-review", "SKILL.md")); err != nil {
		t.Fatalf("expected custom catalog skill: %v", err)
	}

	deleteSourceResp := env.delete("/api/skills/catalog/sources/" + customSource.ID)
	if deleteSourceResp.Code != http.StatusNoContent {
		t.Fatalf("delete custom catalog source: %d %s", deleteSourceResp.Code, deleteSourceResp.Body.String())
	}

	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	globalInstallResp := env.post("/api/skills/catalog", map[string]any{
		"sourceId":  "cloudflare",
		"skillPath": "skills/workers-best-practices",
		"target":    "agents",
		"name":      "workers-best-practices",
	})
	if globalInstallResp.Code != http.StatusCreated {
		t.Fatalf("install global catalog skill: %d %s", globalInstallResp.Code, globalInstallResp.Body.String())
	}
	if _, err := os.Stat(filepath.Join(homeDir, ".agents", "skills", "workers-best-practices", "SKILL.md")); err != nil {
		t.Fatalf("expected global catalog skill: %v", err)
	}
}
