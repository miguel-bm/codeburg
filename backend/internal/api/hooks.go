package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
)

// HookPayload represents the JSON data from a Claude Code hook or Codex notify callback.
// Claude Code sends the event name as "hook_event_name"; Codex sends it as "type".
type HookPayload struct {
	HookEventName string `json:"hook_event_name"`
	Type          string `json:"type,omitempty"`
	SessionID     string `json:"session_id,omitempty"`
	CWD           string `json:"cwd,omitempty"`
}

// EventName returns the hook event name, preferring hook_event_name over type.
func (p HookPayload) EventName() string {
	if p.HookEventName != "" {
		return p.HookEventName
	}
	return p.Type
}

// handleSessionHook processes hook callbacks from Claude Code hooks or Codex notify
func (s *Server) handleSessionHook(w http.ResponseWriter, r *http.Request) {
	sessionID := urlParam(r, "id")

	// Inline auth: accept scoped hook token OR full user JWT
	auth := r.Header.Get("Authorization")
	if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
		writeError(w, http.StatusUnauthorized, "missing or invalid authorization header")
		return
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	if !s.auth.ValidateHookToken(token, sessionID) && !s.auth.ValidateToken(token) {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// Verify session exists
	session, err := s.db.GetSession(sessionID)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	// Parse hook payload
	var payload HookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid hook payload")
		return
	}

	// Map hook event to session status
	eventName := payload.EventName()
	var newStatus db.SessionStatus
	switch eventName {
	case "Notification":
		newStatus = db.SessionStatusWaitingInput
	case "Stop":
		newStatus = db.SessionStatusRunning
	case "SessionEnd":
		newStatus = db.SessionStatusCompleted
	case "agent-turn-complete":
		// Codex notify: agent finished a turn, waiting for user
		newStatus = db.SessionStatusWaitingInput
	default:
		// Unknown event, just acknowledge
		slog.Warn("unknown hook event", "event", eventName, "session_id", sessionID)
		w.WriteHeader(http.StatusOK)
		return
	}

	// Skip if status hasn't changed
	if session.Status == newStatus {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Capture provider session ID if present
	if payload.SessionID != "" {
		if session.ProviderSessionID == nil || *session.ProviderSessionID == "" {
			s.db.UpdateSession(sessionID, db.UpdateSessionInput{
				ProviderSessionID: &payload.SessionID,
			})
			slog.Info("captured provider session ID", "session_id", sessionID, "provider_session_id", payload.SessionID)
		}
	}

	// Update DB
	s.db.UpdateSession(sessionID, db.UpdateSessionInput{
		Status: &newStatus,
	})

	// Update in-memory session (with DB fallback)
	execSession := s.sessions.getOrRestore(sessionID, s.db)
	if execSession != nil {
		execSession.SetStatus(newStatus)
	}

	// If session ended, clean up in-memory session and token file
	if newStatus == db.SessionStatusCompleted {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, sessionID)
		s.sessions.mu.Unlock()
		removeHookToken(sessionID)
	}

	// Broadcast status change
	s.wsHub.BroadcastToSession(sessionID, "status_changed", map[string]string{
		"status": string(newStatus),
	})
	s.wsHub.BroadcastToTask(session.TaskID, "session_status_changed", map[string]string{
		"sessionId": sessionID,
		"status":    string(newStatus),
	})

	// Broadcast sidebar update to all clients
	s.wsHub.BroadcastGlobal("sidebar_update", map[string]string{
		"taskId":    session.TaskID,
		"sessionId": sessionID,
		"status":    string(newStatus),
	})

	// Invalidate diff stats cache when agent finishes work
	if newStatus == db.SessionStatusWaitingInput || newStatus == db.SessionStatusCompleted {
		s.diffStatsCache.Delete(session.TaskID)
	}

	w.WriteHeader(http.StatusOK)
}
