package api

import (
	"errors"
	"net/http"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
	"github.com/miguel-bm/codeburg/internal/sessionlifecycle"
)

func createRunningTaskSession(t *testing.T, env *testEnv, provider string) (*db.Task, *db.AgentSession) {
	t.Helper()

	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name: "session-race-project",
		Path: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	task, err := env.server.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     "session race task",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    provider,
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	if _, err := env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{Status: &runningStatus}); err != nil {
		t.Fatalf("set running status: %v", err)
	}

	return task, session
}

func TestSessionInterleaving_HookAndRuntimeExit_CompletedInBothOrders(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	taskA, sessionA := createRunningTaskSession(t, env, "claude")
	if _, _, _, err := env.server.applySessionTransitionByID(sessionA.ID, sessionlifecycle.EventSessionEnded, "test_hook"); err != nil {
		t.Fatalf("apply session end transition: %v", err)
	}
	env.server.handleRuntimeExit(taskA.ID, ptyruntime.ExitResult{
		SessionID: sessionA.ID,
		ExitCode:  1,
	})
	updatedA, err := env.server.db.GetSession(sessionA.ID)
	if err != nil {
		t.Fatalf("get session A: %v", err)
	}
	if updatedA.Status != db.SessionStatusCompleted {
		t.Fatalf("expected session A status completed, got %q", updatedA.Status)
	}

	taskB, sessionB := createRunningTaskSession(t, env, "claude")
	env.server.handleRuntimeExit(taskB.ID, ptyruntime.ExitResult{
		SessionID: sessionB.ID,
		ExitCode:  1,
	})
	if _, _, _, err := env.server.applySessionTransitionByID(sessionB.ID, sessionlifecycle.EventSessionEnded, "test_hook"); err != nil {
		t.Fatalf("apply session end transition after runtime exit: %v", err)
	}
	updatedB, err := env.server.db.GetSession(sessionB.ID)
	if err != nil {
		t.Fatalf("get session B: %v", err)
	}
	if updatedB.Status != db.SessionStatusCompleted {
		t.Fatalf("expected session B status completed, got %q", updatedB.Status)
	}
}

func TestSessionRace_StopThenLateHook_DoesNotReopen(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	_, session := createRunningTaskSession(t, env, "claude")

	stopResp := env.post("/api/sessions/"+session.ID+"/stop", nil)
	if stopResp.Code != http.StatusNoContent {
		t.Fatalf("expected stop 204, got %d: %s", stopResp.Code, stopResp.Body.String())
	}

	hookResp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "Notification",
	})
	if hookResp.Code != http.StatusOK {
		t.Fatalf("expected hook 200, got %d: %s", hookResp.Code, hookResp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusCompleted {
		t.Fatalf("expected status completed after late hook, got %q", updated.Status)
	}
}

func TestSessionInterleaving_CleanupAndStop_NoReopen(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	taskA, sessionA := createRunningTaskSession(t, env, "claude")

	env.server.sessions.mu.Lock()
	env.server.sessions.sessions[sessionA.ID] = &Session{
		ID:       sessionA.ID,
		TaskID:   taskA.ID,
		Provider: "claude",
		Status:   db.SessionStatusRunning,
	}
	env.server.sessions.mu.Unlock()

	env.server.sessions.cleanupZombieSessions(env.server)
	if _, _, _, err := env.server.applySessionTransitionByID(sessionA.ID, sessionlifecycle.EventStopRequested, "test_stop"); err != nil {
		t.Fatalf("apply stop transition after cleanup: %v", err)
	}

	updatedA, err := env.server.db.GetSession(sessionA.ID)
	if err != nil {
		t.Fatalf("get session A: %v", err)
	}
	if updatedA.Status != db.SessionStatusCompleted {
		t.Fatalf("expected session A status completed, got %q", updatedA.Status)
	}

	taskB, sessionB := createRunningTaskSession(t, env, "claude")
	env.server.sessions.mu.Lock()
	env.server.sessions.sessions[sessionB.ID] = &Session{
		ID:       sessionB.ID,
		TaskID:   taskB.ID,
		Provider: "claude",
		Status:   db.SessionStatusRunning,
	}
	env.server.sessions.mu.Unlock()

	if _, _, _, err := env.server.applySessionTransitionByID(sessionB.ID, sessionlifecycle.EventStopRequested, "test_stop"); err != nil {
		t.Fatalf("apply stop transition before cleanup: %v", err)
	}
	env.server.sessions.cleanupZombieSessions(env.server)

	updatedB, err := env.server.db.GetSession(sessionB.ID)
	if err != nil {
		t.Fatalf("get session B: %v", err)
	}
	if updatedB.Status != db.SessionStatusCompleted {
		t.Fatalf("expected session B status completed, got %q", updatedB.Status)
	}
}

func TestRuntimeExitAfterSessionDelete_DoesNotRecreateSession(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	task, session := createRunningTaskSession(t, env, "claude")

	deleteResp := env.delete("/api/sessions/" + session.ID)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d: %s", deleteResp.Code, deleteResp.Body.String())
	}

	env.server.handleRuntimeExit(task.ID, ptyruntime.ExitResult{
		SessionID: session.ID,
		ExitCode:  1,
	})

	_, err := env.server.db.GetSession(session.ID)
	if !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected session to remain deleted, got err=%v", err)
	}
}
