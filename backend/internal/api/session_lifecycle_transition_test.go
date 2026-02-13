package api

import (
	"net/http"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

func TestSessionHookDoesNotReopenCompletedSession(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-completed-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Completed Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	completedStatus := db.SessionStatusCompleted
	if _, err := env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &completedStatus,
	}); err != nil {
		t.Fatalf("set completed status: %v", err)
	}

	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "Notification",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusCompleted {
		t.Fatalf("expected status completed, got %q", updated.Status)
	}
}
