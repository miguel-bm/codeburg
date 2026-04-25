package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ConversationWorkspaceLink struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversationId"`
	WorkspaceID    *string    `json:"workspaceId,omitempty"`
	Reason         string     `json:"reason"`
	Active         bool       `json:"active"`
	CreatedAt      time.Time  `json:"createdAt"`
	DetachedAt     *time.Time `json:"detachedAt,omitempty"`
}

func (db *DB) ListConversationWorkspaceLinks(conversationID string) ([]*ConversationWorkspaceLink, error) {
	rows, err := db.conn.Query(`
		SELECT id, conversation_id, workspace_id, reason, active, created_at, detached_at
		FROM conversation_workspace_links
		WHERE conversation_id = ?
		ORDER BY active DESC, created_at DESC, id DESC
	`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("query conversation workspace links: %w", err)
	}
	defer rows.Close()

	links := make([]*ConversationWorkspaceLink, 0)
	for rows.Next() {
		link, err := scanConversationWorkspaceLink(rows.Scan)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (db *DB) SetConversationWorkspace(conversationID string, workspaceID *string, reason string) (*Conversation, error) {
	tx, err := db.conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	conversation, err := getConversationTx(tx, conversationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	normalizedWorkspaceID := normalizeOptionalID(workspaceID)
	currentWorkspaceID := normalizeOptionalID(conversation.CurrentWorkspaceID)
	if optionalStringEqual(currentWorkspaceID, normalizedWorkspaceID) {
		return conversation, tx.Commit()
	}

	now := time.Now().UTC()
	if _, err := tx.Exec(`
		UPDATE conversation_workspace_links
		SET active = 0, detached_at = ?
		WHERE conversation_id = ? AND active = 1
	`, now, conversationID); err != nil {
		return nil, fmt.Errorf("close active workspace links: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO conversation_workspace_links (
			id, conversation_id, workspace_id, reason, active, created_at
		) VALUES (?, ?, ?, ?, ?, ?)
	`, NewID(), conversationID, NullString(normalizedWorkspaceID), fallbackString(strings.TrimSpace(reason), "switched"), true, now); err != nil {
		return nil, fmt.Errorf("insert workspace link: %w", err)
	}

	if _, err := tx.Exec(`
		UPDATE conversations
		SET current_workspace_id = ?, updated_at = ?, last_activity_at = ?
		WHERE id = ?
	`, NullString(normalizedWorkspaceID), now, now, conversationID); err != nil {
		return nil, fmt.Errorf("update conversation workspace: %w", err)
	}

	updated, err := getConversationTx(tx, conversationID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return updated, nil
}

func (db *DB) ListConversationsByCurrentWorkspace(workspaceID string) ([]*Conversation, error) {
	rows, err := db.conn.Query(`
		SELECT id, project_id, current_workspace_id, parent_conversation_id, provider, title, status, preferred_surface,
		       summary, provider_session_id, last_activity_at, created_at, updated_at, archived_at
		FROM conversations
		WHERE current_workspace_id = ?
		ORDER BY last_activity_at DESC, created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("query conversations by workspace: %w", err)
	}
	defer rows.Close()

	conversations := make([]*Conversation, 0)
	for rows.Next() {
		conversation, err := scanConversation(rows.Scan)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

func createConversationWorkspaceLinkTx(tx *sql.Tx, conversationID string, workspaceID *string, reason string, createdAt time.Time) error {
	_, err := tx.Exec(`
		INSERT INTO conversation_workspace_links (
			id, conversation_id, workspace_id, reason, active, created_at
		) VALUES (?, ?, ?, ?, ?, ?)
	`, NewID(), conversationID, NullString(normalizeOptionalID(workspaceID)), fallbackString(strings.TrimSpace(reason), "created"), true, createdAt)
	if err != nil {
		return fmt.Errorf("insert conversation workspace link: %w", err)
	}
	return nil
}

func getConversationTx(tx *sql.Tx, id string) (*Conversation, error) {
	row := tx.QueryRow(`
		SELECT id, project_id, current_workspace_id, parent_conversation_id, provider, title, status, preferred_surface,
		       summary, provider_session_id, last_activity_at, created_at, updated_at, archived_at
		FROM conversations WHERE id = ?
	`, id)
	return scanConversation(row.Scan)
}

func scanConversationWorkspaceLink(scan scanFunc) (*ConversationWorkspaceLink, error) {
	var link ConversationWorkspaceLink
	var workspaceID sql.NullString
	var detachedAt sql.NullTime
	if err := scan(
		&link.ID,
		&link.ConversationID,
		&workspaceID,
		&link.Reason,
		&link.Active,
		&link.CreatedAt,
		&detachedAt,
	); err != nil {
		return nil, err
	}
	link.WorkspaceID = StringPtr(workspaceID)
	link.DetachedAt = TimePtr(detachedAt)
	return &link, nil
}

func normalizeOptionalID(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func optionalStringEqual(left, right *string) bool {
	if left == nil && right == nil {
		return true
	}
	if left == nil || right == nil {
		return false
	}
	return *left == *right
}

func fallbackString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
