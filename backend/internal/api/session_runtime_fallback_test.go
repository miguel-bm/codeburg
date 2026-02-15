package api

import (
	"testing"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
)

func waitForCondition(t *testing.T, timeout time.Duration, cond func() bool, desc string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", desc)
}

func TestRuntimeExit_TerminalProvidersFallbackToShell(t *testing.T) {
	for _, provider := range []string{"claude", "codex"} {
		t.Run(provider, func(t *testing.T) {
			env := setupTestEnv(t)
			env.setup("testpass123")

			task, session := createRunningTaskSession(t, env, provider)
			workDir := t.TempDir()
			execSession := &Session{
				ID:       session.ID,
				TaskID:   task.ID,
				Provider: provider,
				Status:   db.SessionStatusRunning,
				WorkDir:  workDir,
			}

			env.server.sessions.mu.Lock()
			env.server.sessions.sessions[session.ID] = execSession
			env.server.sessions.mu.Unlock()

			env.server.handleRuntimeExit(task.ID, ptyruntime.ExitResult{
				SessionID: session.ID,
				ExitCode:  0,
			})

			waitForCondition(t, 2*time.Second, func() bool {
				return execSession.FallbackWasStarted()
			}, "fallback runtime marker")

			waitForCondition(t, 2*time.Second, func() bool {
				s, err := env.server.db.GetSession(session.ID)
				if err != nil {
					return false
				}
				return s.Status == db.SessionStatusWaitingInput || s.Status == db.SessionStatusCompleted
			}, "fallback session status update")

			_ = env.server.sessions.runtime.Stop(session.ID)
		})
	}
}

func TestHookSessionEnd_TerminalSessionDoesNotComplete(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	_, session := createRunningTaskSession(t, env, "claude")

	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "SessionEnd",
	})
	if resp.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusWaitingInput {
		t.Fatalf("expected waiting_input after SessionEnd hook, got %q", updated.Status)
	}
}
