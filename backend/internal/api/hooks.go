package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
	"github.com/miguel-bm/codeburg/internal/sessionlifecycle"
)

// HookPayload represents the JSON data from a Claude Code hook or Codex notify callback.
// Claude Code sends the event name as "hook_event_name"; Codex sends it as "type".
type HookPayload struct {
	HookEventName      string `json:"hook_event_name"`
	HookEventNameCamel string `json:"hookEventName,omitempty"`
	Type               string `json:"type,omitempty"`
	Event              string `json:"event,omitempty"`
	SessionID          string `json:"session_id,omitempty"`
	CWD                string `json:"cwd,omitempty"`
	NotificationType   string `json:"notification_type,omitempty"`
	StopHookActive     *bool  `json:"stop_hook_active,omitempty"`
}

// EventName returns the hook event name, preferring hook_event_name over type.
func (p HookPayload) EventName() string {
	if p.HookEventName != "" {
		return p.HookEventName
	}
	if p.HookEventNameCamel != "" {
		return p.HookEventNameCamel
	}
	return p.Type
}

func normalizeEventName(name string) string {
	n := strings.TrimSpace(strings.ToLower(name))
	n = strings.ReplaceAll(n, " ", "_")
	n = strings.ReplaceAll(n, "-", "_")
	return n
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
	if eventName == "" {
		eventName = payload.Event
	}
	normalizedEvent := normalizeEventName(eventName)
	var transitionEvent sessionlifecycle.Event
	switch normalizedEvent {
	case "notification":
		// Notification events include multiple types. We treat these as "waiting for user":
		// - permission_prompt
		// - idle_prompt
		// - elicitation_dialog
		//
		// If no type is provided, keep compatibility by assuming waiting_input.
		switch strings.TrimSpace(strings.ToLower(payload.NotificationType)) {
		case "", "permission_prompt", "idle_prompt", "elicitation_dialog":
			transitionEvent = sessionlifecycle.EventNotificationWaiting
		default:
			// Non-interruptive notifications (e.g. auth_success) should not flip session state.
			w.WriteHeader(http.StatusOK)
			return
		}
	case "stop":
		// Stop fires when Claude finishes responding.
		// If stop_hook_active is true, Claude is already continuing due to a stop hook.
		if payload.StopHookActive != nil && *payload.StopHookActive {
			transitionEvent = sessionlifecycle.EventStopHookContinue
		} else {
			transitionEvent = sessionlifecycle.EventStopHookWaiting
		}
	case "sessionend":
		transitionEvent = sessionlifecycle.EventSessionEnded
	case "agent_turn_complete":
		// Codex notify: agent finished a turn, waiting for user
		transitionEvent = sessionlifecycle.EventAgentTurnComplete
	default:
		// Unknown event, just acknowledge
		slog.Warn("unknown hook event", "event", eventName, "normalized_event", normalizedEvent, "session_id", sessionID)
		w.WriteHeader(http.StatusOK)
		return
	}

	newStatus, changed, err := s.applySessionTransition(sessionID, session.Status, transitionEvent, session.TaskID, "hook")
	if err != nil {
		if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(sessionID, session.Status, transitionEvent, "hook", err)
			w.WriteHeader(http.StatusOK)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update session status")
		return
	}
	if !changed {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Capture provider session ID if present
	if payload.SessionID != "" {
		if session.ProviderSessionID == nil || *session.ProviderSessionID == "" {
			if _, err := s.db.UpdateSession(sessionID, db.UpdateSessionInput{
				ProviderSessionID: &payload.SessionID,
			}); err != nil {
				slog.Warn("failed to capture provider session ID", "session_id", sessionID, "provider_session_id", payload.SessionID, "error", err)
			} else {
				slog.Info("captured provider session ID", "session_id", sessionID, "provider_session_id", payload.SessionID)
			}
		}
	}

	// Update in-memory session (with DB fallback)
	execSession := s.sessions.getOrRestore(sessionID, s.db)
	if execSession != nil {
		execSession.SetStatus(newStatus)
	}

	// If session ended, clean up in-memory session and token/script files
	if newStatus == db.SessionStatusCompleted {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, sessionID)
		s.sessions.mu.Unlock()
		if err := s.sessions.runtime.Stop(sessionID); err != nil && !errors.Is(err, ptyruntime.ErrSessionNotFound) {
			slog.Debug("runtime stop failed on hook completion", "session_id", sessionID, "error", err)
		}
		removeHookToken(sessionID)
		removeNotifyScript(sessionID)
	}

	// Broadcast status transition
	s.broadcastSessionStatus(session.TaskID, sessionID, newStatus)

	// Invalidate diff stats cache when agent finishes work
	if newStatus == db.SessionStatusWaitingInput || newStatus == db.SessionStatusCompleted {
		s.diffStatsCache.Delete(session.TaskID)
	}

	w.WriteHeader(http.StatusOK)
}
