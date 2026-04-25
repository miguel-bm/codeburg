package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ConversationStatus string

const (
	ConversationStatusActive    ConversationStatus = "active"
	ConversationStatusPaused    ConversationStatus = "paused"
	ConversationStatusCompleted ConversationStatus = "completed"
	ConversationStatusArchived  ConversationStatus = "archived"
)

type ConversationSurface string

const (
	ConversationSurfaceChat     ConversationSurface = "chat"
	ConversationSurfaceTerminal ConversationSurface = "terminal"
)

type Conversation struct {
	ID                   string              `json:"id"`
	ProjectID            string              `json:"projectId"`
	CurrentWorkspaceID   *string             `json:"currentWorkspaceId,omitempty"`
	ParentConversationID *string             `json:"parentConversationId,omitempty"`
	Provider             string              `json:"provider"`
	Title                string              `json:"title"`
	Status               ConversationStatus  `json:"status"`
	PreferredSurface     ConversationSurface `json:"preferredSurface"`
	Summary              *string             `json:"summary,omitempty"`
	ProviderSessionID    *string             `json:"providerSessionId,omitempty"`
	LastActivityAt       time.Time           `json:"lastActivityAt"`
	CreatedAt            time.Time           `json:"createdAt"`
	UpdatedAt            time.Time           `json:"updatedAt"`
	ArchivedAt           *time.Time          `json:"archivedAt,omitempty"`
}

type CreateConversationInput struct {
	ProjectID            string
	CurrentWorkspaceID   *string
	ParentConversationID *string
	Provider             string
	Title                string
	Status               ConversationStatus
	PreferredSurface     ConversationSurface
	Summary              *string
	ProviderSessionID    *string
}

type UpdateConversationInput struct {
	CurrentWorkspaceID *string             `json:"currentWorkspaceId,omitempty"`
	Title              *string             `json:"title,omitempty"`
	Status             *ConversationStatus `json:"status,omitempty"`
	Summary            *string             `json:"summary,omitempty"`
	ProviderSessionID  *string             `json:"providerSessionId,omitempty"`
	LastActivityAt     *time.Time          `json:"lastActivityAt,omitempty"`
	ArchivedAt         *time.Time          `json:"archivedAt,omitempty"`
}

type ListConversationOptions struct {
	ProjectID *string
	Query     string
	Status    *ConversationStatus
	Provider  string
}

func (db *DB) CreateConversation(input CreateConversationInput) (*Conversation, error) {
	id := NewID()
	now := time.Now()
	provider := strings.TrimSpace(input.Provider)
	if provider == "" {
		provider = "pi"
	}
	status := input.Status
	if status == "" {
		status = ConversationStatusActive
	}
	surface := input.PreferredSurface
	if surface == "" {
		surface = ConversationSurfaceChat
	}

	tx, err := db.conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO conversations (
			id, project_id, current_workspace_id, parent_conversation_id,
			provider, title, status, preferred_surface, summary, provider_session_id,
			last_activity_at, created_at, updated_at, archived_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, input.ProjectID, NullString(normalizeOptionalID(input.CurrentWorkspaceID)), NullString(input.ParentConversationID),
		provider, input.Title, status, surface, NullString(input.Summary), NullString(input.ProviderSessionID),
		now, now, now, NullTime(nil))
	if err != nil {
		return nil, fmt.Errorf("insert conversation: %w", err)
	}
	if err := createConversationWorkspaceLinkTx(tx, id, input.CurrentWorkspaceID, "created", now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return db.GetConversation(id)
}

func (db *DB) GetConversation(id string) (*Conversation, error) {
	row := db.conn.QueryRow(`
		SELECT id, project_id, current_workspace_id, parent_conversation_id, provider, title, status, preferred_surface,
		       summary, provider_session_id, last_activity_at, created_at, updated_at, archived_at
		FROM conversations WHERE id = ?
	`, id)
	conversation, err := scanConversation(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return conversation, err
}

func (db *DB) ListConversations(projectID *string) ([]*Conversation, error) {
	return db.ListConversationsWithOptions(ListConversationOptions{ProjectID: projectID})
}

func (db *DB) ListConversationsWithOptions(opts ListConversationOptions) ([]*Conversation, error) {
	query := `
		SELECT id, project_id, current_workspace_id, parent_conversation_id, provider, title, status, preferred_surface,
		       summary, provider_session_id, last_activity_at, created_at, updated_at, archived_at
		FROM conversations
	`
	args := make([]any, 0, 6)
	clauses := make([]string, 0, 4)
	if opts.ProjectID != nil && strings.TrimSpace(*opts.ProjectID) != "" {
		clauses = append(clauses, "project_id = ?")
		args = append(args, strings.TrimSpace(*opts.ProjectID))
	}
	if trimmedQuery := strings.TrimSpace(opts.Query); trimmedQuery != "" {
		like := "%" + strings.ToLower(trimmedQuery) + "%"
		clauses = append(clauses, "(LOWER(title) LIKE ? OR LOWER(COALESCE(summary, '')) LIKE ?)")
		args = append(args, like, like)
	}
	if opts.Status != nil && strings.TrimSpace(string(*opts.Status)) != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, strings.TrimSpace(string(*opts.Status)))
	}
	if trimmedProvider := strings.TrimSpace(opts.Provider); trimmedProvider != "" {
		clauses = append(clauses, "provider = ?")
		args = append(args, trimmedProvider)
	}
	if len(clauses) > 0 {
		query += ` WHERE ` + strings.Join(clauses, " AND ")
	}
	query += ` ORDER BY last_activity_at DESC, created_at DESC`

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query conversations: %w", err)
	}
	defer rows.Close()

	var conversations []*Conversation
	for rows.Next() {
		conversation, err := scanConversation(rows.Scan)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

func (db *DB) UpdateConversation(id string, input UpdateConversationInput) (*Conversation, error) {
	query := "UPDATE conversations SET updated_at = ?"
	args := []any{time.Now()}

	if input.CurrentWorkspaceID != nil {
		query += ", current_workspace_id = ?"
		args = append(args, nullableTrimmedString(input.CurrentWorkspaceID))
	}
	if input.Title != nil {
		query += ", title = ?"
		args = append(args, *input.Title)
	}
	if input.Status != nil {
		query += ", status = ?"
		args = append(args, *input.Status)
	}
	if input.Summary != nil {
		query += ", summary = ?"
		args = append(args, nullableTrimmedString(input.Summary))
	}
	if input.ProviderSessionID != nil {
		query += ", provider_session_id = ?"
		args = append(args, nullableTrimmedString(input.ProviderSessionID))
	}
	if input.LastActivityAt != nil {
		query += ", last_activity_at = ?"
		args = append(args, *input.LastActivityAt)
	}
	if input.ArchivedAt != nil {
		query += ", archived_at = ?"
		args = append(args, *input.ArchivedAt)
	}

	query += " WHERE id = ?"
	args = append(args, id)

	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update conversation: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}
	return db.GetConversation(id)
}

func nullableTrimmedString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: trimmed, Valid: true}
}

func scanConversation(scan scanFunc) (*Conversation, error) {
	var conversation Conversation
	var currentWorkspaceID, parentConversationID, summary, providerSessionID sql.NullString
	var archivedAt sql.NullTime
	err := scan(
		&conversation.ID,
		&conversation.ProjectID,
		&currentWorkspaceID,
		&parentConversationID,
		&conversation.Provider,
		&conversation.Title,
		&conversation.Status,
		&conversation.PreferredSurface,
		&summary,
		&providerSessionID,
		&conversation.LastActivityAt,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
		&archivedAt,
	)
	if err != nil {
		return nil, err
	}
	conversation.CurrentWorkspaceID = StringPtr(currentWorkspaceID)
	conversation.ParentConversationID = StringPtr(parentConversationID)
	conversation.Summary = StringPtr(summary)
	conversation.ProviderSessionID = StringPtr(providerSessionID)
	conversation.ArchivedAt = TimePtr(archivedAt)
	return &conversation, nil
}
