package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// SessionStatus represents the current state of an agent session
type SessionStatus string

const (
	SessionStatusIdle         SessionStatus = "idle"
	SessionStatusRunning      SessionStatus = "running"
	SessionStatusWaitingInput SessionStatus = "waiting_input"
	SessionStatusCompleted    SessionStatus = "completed"
	SessionStatusError        SessionStatus = "error"
)

// AgentSession represents an AI agent session for a task.
// Provider indicates *what* is running (claude, codex, terminal).
// SessionType indicates *how* the session is delivered:
// - "terminal": PTY + xterm.js
// - "chat": structured message stream rendered in the chat UI
// Reserved for future modes like "headless" (background/no UI) or "api" (direct API).
type AgentSession struct {
	ID                string        `json:"id"`
	TaskID            string        `json:"taskId,omitempty"`
	ProjectID         string        `json:"projectId"`
	Provider          string        `json:"provider"`
	SessionType       string        `json:"sessionType"`
	ProviderSessionID *string       `json:"providerSessionId,omitempty"`
	Status            SessionStatus `json:"status"`
	TmuxWindow        *string       `json:"tmuxWindow,omitempty"`
	TmuxPane          *string       `json:"tmuxPane,omitempty"`
	LogFile           *string       `json:"logFile,omitempty"`
	LastActivityAt    *time.Time    `json:"lastActivityAt,omitempty"`
	CreatedAt         time.Time     `json:"createdAt"`
	UpdatedAt         time.Time     `json:"updatedAt"`
}

// CreateSessionInput contains fields for creating a new session
type CreateSessionInput struct {
	TaskID            string
	ProjectID         string
	Provider          string
	SessionType       string
	ProviderSessionID *string
	TmuxWindow        *string
	TmuxPane          *string
}

// UpdateSessionInput contains fields for updating a session
type UpdateSessionInput struct {
	ProviderSessionID *string        `json:"providerSessionId,omitempty"`
	Status            *SessionStatus `json:"status,omitempty"`
	TmuxWindow        *string        `json:"tmuxWindow,omitempty"`
	TmuxPane          *string        `json:"tmuxPane,omitempty"`
	LogFile           *string        `json:"logFile,omitempty"`
	LastActivityAt    *time.Time     `json:"lastActivityAt,omitempty"`
}

// CreateSession creates a new agent session
func (db *DB) CreateSession(input CreateSessionInput) (*AgentSession, error) {
	id := NewID()
	now := time.Now()

	sessionType := input.SessionType
	if sessionType == "" {
		sessionType = "terminal"
	}

	var taskID interface{} = input.TaskID
	if input.TaskID == "" {
		taskID = nil
	}

	_, err := db.conn.Exec(`
		INSERT INTO agent_sessions (id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, taskID, input.ProjectID, input.Provider, sessionType, NullString(input.ProviderSessionID), SessionStatusIdle, NullString(input.TmuxWindow), NullString(input.TmuxPane), now, now)
	if err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}

	return db.GetSession(id)
}

// GetSession retrieves a session by ID
func (db *DB) GetSession(id string) (*AgentSession, error) {
	row := db.conn.QueryRow(`
		SELECT id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, log_file, last_activity_at, created_at, updated_at
		FROM agent_sessions WHERE id = ?
	`, id)

	s, err := scanSession(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// ListSessionsByTask retrieves all sessions for a task
func (db *DB) ListSessionsByTask(taskID string) ([]*AgentSession, error) {
	rows, err := db.conn.Query(`
		SELECT id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, log_file, last_activity_at, created_at, updated_at
		FROM agent_sessions WHERE task_id = ? ORDER BY created_at DESC
	`, taskID)
	if err != nil {
		return nil, fmt.Errorf("query sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]*AgentSession, 0)
	for rows.Next() {
		s, err := scanSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}

	return sessions, rows.Err()
}

// ListActiveSessions returns all sessions with active statuses (running, waiting_input, idle)
func (db *DB) ListActiveSessions() ([]*AgentSession, error) {
	rows, err := db.conn.Query(`
		SELECT id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, log_file, last_activity_at, created_at, updated_at
		FROM agent_sessions WHERE status IN (?, ?, ?) ORDER BY created_at
	`, SessionStatusRunning, SessionStatusWaitingInput, SessionStatusIdle)
	if err != nil {
		return nil, fmt.Errorf("query active sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]*AgentSession, 0)
	for rows.Next() {
		s, err := scanSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}

	return sessions, rows.Err()
}

// UpdateSession updates a session
func (db *DB) UpdateSession(id string, input UpdateSessionInput) (*AgentSession, error) {
	query := "UPDATE agent_sessions SET updated_at = ?"
	args := []any{time.Now()}

	if input.ProviderSessionID != nil {
		query += ", provider_session_id = ?"
		args = append(args, *input.ProviderSessionID)
	}
	if input.Status != nil {
		query += ", status = ?"
		args = append(args, *input.Status)
	}
	if input.TmuxWindow != nil {
		query += ", tmux_window = ?"
		args = append(args, *input.TmuxWindow)
	}
	if input.TmuxPane != nil {
		query += ", tmux_pane = ?"
		args = append(args, *input.TmuxPane)
	}
	if input.LogFile != nil {
		query += ", log_file = ?"
		args = append(args, *input.LogFile)
	}
	if input.LastActivityAt != nil {
		query += ", last_activity_at = ?"
		args = append(args, *input.LastActivityAt)
	}

	query += " WHERE id = ?"
	args = append(args, id)

	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update session: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}

	return db.GetSession(id)
}

// DeleteSession deletes a session
func (db *DB) DeleteSession(id string) error {
	result, err := db.conn.Exec("DELETE FROM agent_sessions WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}

	return nil
}

// GetActiveSessionForTask returns the most recent active session for a task
func (db *DB) GetActiveSessionForTask(taskID string) (*AgentSession, error) {
	row := db.conn.QueryRow(`
		SELECT id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, log_file, last_activity_at, created_at, updated_at
		FROM agent_sessions
		WHERE task_id = ? AND status IN (?, ?, ?)
		ORDER BY created_at DESC LIMIT 1
	`, taskID, SessionStatusRunning, SessionStatusWaitingInput, SessionStatusIdle)

	session, err := scanSession(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return session, err
}

// ListSessionsByProject retrieves all sessions for a project (project-level only, no task)
func (db *DB) ListSessionsByProject(projectID string) ([]*AgentSession, error) {
	rows, err := db.conn.Query(`
		SELECT id, task_id, project_id, provider, session_type, provider_session_id, status, tmux_window, tmux_pane, log_file, last_activity_at, created_at, updated_at
		FROM agent_sessions WHERE project_id = ? AND task_id IS NULL ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query project sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]*AgentSession, 0)
	for rows.Next() {
		s, err := scanSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}

	return sessions, rows.Err()
}

func scanSession(scan scanFunc) (*AgentSession, error) {
	var s AgentSession
	var taskID, projectID sql.NullString
	var sessionType sql.NullString
	var providerSessionID, tmuxWindow, tmuxPane, logFile sql.NullString
	var lastActivityAt sql.NullTime

	err := scan(
		&s.ID, &taskID, &projectID, &s.Provider, &sessionType, &providerSessionID, &s.Status,
		&tmuxWindow, &tmuxPane, &logFile, &lastActivityAt, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if taskID.Valid {
		s.TaskID = taskID.String
	}
	if projectID.Valid {
		s.ProjectID = projectID.String
	}
	s.SessionType = "terminal"
	if sessionType.Valid && sessionType.String != "" {
		s.SessionType = sessionType.String
	}
	s.ProviderSessionID = StringPtr(providerSessionID)
	s.TmuxWindow = StringPtr(tmuxWindow)
	s.TmuxPane = StringPtr(tmuxPane)
	s.LogFile = StringPtr(logFile)
	if lastActivityAt.Valid {
		s.LastActivityAt = &lastActivityAt.Time
	}

	return &s, nil
}
