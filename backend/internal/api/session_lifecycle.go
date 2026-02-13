package api

import (
	"errors"
	"log/slog"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/sessionlifecycle"
)

func (s *Server) applySessionTransition(sessionID string, current db.SessionStatus, event sessionlifecycle.Event, taskID, source string) (db.SessionStatus, bool, error) {
	tr, err := sessionlifecycle.Apply(current, event)
	if err != nil {
		return current, false, err
	}
	if !tr.Changed {
		slog.Debug("session_transition_noop",
			"session_id", sessionID,
			"task_id", taskID,
			"source", source,
			"event", event,
			"status", tr.To,
			"changed", false,
		)
		return tr.To, false, nil
	}

	if _, err := s.db.UpdateSession(sessionID, db.UpdateSessionInput{Status: &tr.To}); err != nil {
		slog.Warn("session_transition_persist_failed",
			"session_id", sessionID,
			"task_id", taskID,
			"source", source,
			"event", event,
			"from_status", tr.From,
			"to_status", tr.To,
			"error", err,
		)
		return current, false, err
	}

	slog.Info("session_transition_applied",
		"session_id", sessionID,
		"task_id", taskID,
		"source", source,
		"event", event,
		"from_status", tr.From,
		"to_status", tr.To,
		"changed", true,
	)

	return tr.To, true, nil
}

func (s *Server) applySessionTransitionByID(sessionID string, event sessionlifecycle.Event, source string) (taskID string, status db.SessionStatus, changed bool, err error) {
	session, err := s.db.GetSession(sessionID)
	if err != nil {
		return "", "", false, err
	}

	newStatus, changed, err := s.applySessionTransition(sessionID, session.Status, event, session.TaskID, source)
	if err != nil {
		return session.TaskID, session.Status, false, err
	}
	return session.TaskID, newStatus, changed, nil
}

func (s *Server) applySessionTransitionWithFallback(sessionID string, fallbackCurrent db.SessionStatus, event sessionlifecycle.Event, source string) (taskID string, status db.SessionStatus, changed bool, err error) {
	session, err := s.db.GetSession(sessionID)
	switch {
	case err == nil:
		newStatus, changed, applyErr := s.applySessionTransition(sessionID, session.Status, event, session.TaskID, source)
		if applyErr != nil {
			return session.TaskID, session.Status, false, applyErr
		}
		return session.TaskID, newStatus, changed, nil
	case errors.Is(err, db.ErrNotFound):
		return "", fallbackCurrent, false, db.ErrNotFound
	default:
		newStatus, changed, applyErr := s.applySessionTransition(sessionID, fallbackCurrent, event, "", source)
		if applyErr != nil {
			return "", fallbackCurrent, false, applyErr
		}
		return "", newStatus, changed, nil
	}
}

func (s *Server) broadcastSessionStatus(taskID, sessionID string, status db.SessionStatus) {
	s.wsHub.BroadcastToSession(sessionID, "status_changed", map[string]string{
		"status": string(status),
	})
	if taskID != "" {
		s.wsHub.BroadcastToTask(taskID, "session_status_changed", map[string]string{
			"sessionId": sessionID,
			"status":    string(status),
		})
	}
	s.wsHub.BroadcastGlobal("sidebar_update", map[string]string{
		"taskId":    taskID,
		"sessionId": sessionID,
		"status":    string(status),
	})
}

func logInvalidSessionTransition(sessionID string, current db.SessionStatus, event sessionlifecycle.Event, source string, err error) {
	slog.Warn("invalid session lifecycle transition",
		"session_id", sessionID,
		"source", source,
		"current_status", current,
		"event", event,
		"error", err,
	)
}
