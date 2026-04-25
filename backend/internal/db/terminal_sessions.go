package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type TerminalSessionStatus string

const (
	TerminalSessionStatusStarting     TerminalSessionStatus = "starting"
	TerminalSessionStatusRunning      TerminalSessionStatus = "running"
	TerminalSessionStatusWaitingInput TerminalSessionStatus = "waiting_input"
	TerminalSessionStatusStopped      TerminalSessionStatus = "stopped"
	TerminalSessionStatusFailed       TerminalSessionStatus = "failed"
)

type TerminalSession struct {
	ID             string                `json:"id"`
	WorkspaceID    string                `json:"workspaceId"`
	Title          *string               `json:"title,omitempty"`
	Status         TerminalSessionStatus `json:"status"`
	Shell          *string               `json:"shell,omitempty"`
	Cwd            *string               `json:"cwd,omitempty"`
	ProviderHint   *string               `json:"providerHint,omitempty"`
	CreatedAt      time.Time             `json:"createdAt"`
	StartedAt      *time.Time            `json:"startedAt,omitempty"`
	EndedAt        *time.Time            `json:"endedAt,omitempty"`
	LastActivityAt time.Time             `json:"lastActivityAt"`
}

type CreateTerminalSessionInput struct {
	WorkspaceID  string
	Title        *string
	Shell        *string
	Cwd          *string
	ProviderHint *string
}

type UpdateTerminalSessionInput struct {
	Title          *string                `json:"title,omitempty"`
	Status         *TerminalSessionStatus `json:"status,omitempty"`
	Shell          *string                `json:"shell,omitempty"`
	Cwd            *string                `json:"cwd,omitempty"`
	ProviderHint   *string                `json:"providerHint,omitempty"`
	StartedAt      *time.Time             `json:"startedAt,omitempty"`
	EndedAt        *time.Time             `json:"endedAt,omitempty"`
	LastActivityAt *time.Time             `json:"lastActivityAt,omitempty"`
}

func (db *DB) CreateTerminalSession(input CreateTerminalSessionInput) (*TerminalSession, error) {
	id := NewID()
	now := time.Now()
	_, err := db.conn.Exec(`
		INSERT INTO terminal_sessions (
			id, workspace_id, title, status, shell, cwd, provider_hint, created_at, started_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, input.WorkspaceID, NullString(input.Title), TerminalSessionStatusStarting, NullString(input.Shell), NullString(input.Cwd), NullString(input.ProviderHint), now, now, now)
	if err != nil {
		return nil, fmt.Errorf("insert terminal session: %w", err)
	}
	return db.GetTerminalSession(id)
}

func (db *DB) GetTerminalSession(id string) (*TerminalSession, error) {
	row := db.conn.QueryRow(`
		SELECT id, workspace_id, title, status, shell, cwd, provider_hint, created_at, started_at, ended_at, last_activity_at
		FROM terminal_sessions WHERE id = ?
	`, id)
	t, err := scanTerminalSession(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func (db *DB) ListTerminalSessionsByWorkspace(workspaceID string) ([]*TerminalSession, error) {
	rows, err := db.conn.Query(`
		SELECT id, workspace_id, title, status, shell, cwd, provider_hint, created_at, started_at, ended_at, last_activity_at
		FROM terminal_sessions
		WHERE workspace_id = ?
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("query terminal sessions: %w", err)
	}
	defer rows.Close()
	var sessions []*TerminalSession
	for rows.Next() {
		t, err := scanTerminalSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, t)
	}
	return sessions, rows.Err()
}

func (db *DB) UpdateTerminalSession(id string, input UpdateTerminalSessionInput) (*TerminalSession, error) {
	query := "UPDATE terminal_sessions SET id = id"
	args := []any{}
	if input.Title != nil {
		query += ", title = ?"
		args = append(args, *input.Title)
	}
	if input.Status != nil {
		query += ", status = ?"
		args = append(args, *input.Status)
	}
	if input.Shell != nil {
		query += ", shell = ?"
		args = append(args, *input.Shell)
	}
	if input.Cwd != nil {
		query += ", cwd = ?"
		args = append(args, *input.Cwd)
	}
	if input.ProviderHint != nil {
		query += ", provider_hint = ?"
		args = append(args, *input.ProviderHint)
	}
	if input.StartedAt != nil {
		query += ", started_at = ?"
		args = append(args, *input.StartedAt)
	}
	if input.EndedAt != nil {
		query += ", ended_at = ?"
		args = append(args, *input.EndedAt)
	}
	if input.LastActivityAt != nil {
		query += ", last_activity_at = ?"
		args = append(args, *input.LastActivityAt)
	}
	query += " WHERE id = ?"
	args = append(args, id)
	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update terminal session: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}
	return db.GetTerminalSession(id)
}

func (db *DB) DeleteTerminalSession(id string) error {
	result, err := db.conn.Exec(`DELETE FROM terminal_sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete terminal session: %w", err)
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

func scanTerminalSession(scan scanFunc) (*TerminalSession, error) {
	var t TerminalSession
	var title, shell, cwd, providerHint sql.NullString
	var startedAt, endedAt sql.NullTime
	err := scan(&t.ID, &t.WorkspaceID, &title, &t.Status, &shell, &cwd, &providerHint, &t.CreatedAt, &startedAt, &endedAt, &t.LastActivityAt)
	if err != nil {
		return nil, err
	}
	t.Title = StringPtr(title)
	t.Shell = StringPtr(shell)
	t.Cwd = StringPtr(cwd)
	t.ProviderHint = StringPtr(providerHint)
	t.StartedAt = TimePtr(startedAt)
	t.EndedAt = TimePtr(endedAt)
	return &t, nil
}
