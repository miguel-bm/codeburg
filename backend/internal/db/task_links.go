package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type TaskLinkTargetType string

const (
	TaskLinkTargetWorkspace    TaskLinkTargetType = "workspace"
	TaskLinkTargetConversation TaskLinkTargetType = "conversation"
)

type TaskLink struct {
	ID           string             `json:"id"`
	TaskID       string             `json:"taskId"`
	ProjectID    string             `json:"projectId"`
	TargetType   TaskLinkTargetType `json:"targetType"`
	TargetID     string             `json:"targetId"`
	RelationType string             `json:"relationType"`
	CreatedAt    time.Time          `json:"createdAt"`
}

type CreateTaskLinkInput struct {
	TaskID       string
	ProjectID    string
	TargetType   TaskLinkTargetType
	TargetID     string
	RelationType string
}

type TaskLinkFilter struct {
	ProjectID  *string
	TaskID     *string
	TargetType *TaskLinkTargetType
	TargetID   *string
}

func (db *DB) CreateTaskLink(input CreateTaskLinkInput) (*TaskLink, error) {
	id := NewID()
	now := time.Now()
	relationType := strings.TrimSpace(input.RelationType)
	if relationType == "" {
		relationType = "related"
	}

	_, err := db.conn.Exec(`
		INSERT INTO task_links (id, task_id, project_id, target_type, target_id, relation_type, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(task_id, target_type, target_id) DO UPDATE SET
			relation_type = excluded.relation_type
	`, id, input.TaskID, input.ProjectID, input.TargetType, strings.TrimSpace(input.TargetID), relationType, now)
	if err != nil {
		return nil, fmt.Errorf("insert task link: %w", err)
	}

	row := db.conn.QueryRow(`
		SELECT id, task_id, project_id, target_type, target_id, relation_type, created_at
		FROM task_links
		WHERE task_id = ? AND target_type = ? AND target_id = ?
	`, input.TaskID, input.TargetType, strings.TrimSpace(input.TargetID))
	return scanTaskLink(row.Scan)
}

func (db *DB) ListTaskLinks(filter TaskLinkFilter) ([]*TaskLink, error) {
	query := `
		SELECT id, task_id, project_id, target_type, target_id, relation_type, created_at
		FROM task_links
		WHERE 1=1
	`
	args := make([]any, 0, 4)
	if filter.ProjectID != nil && strings.TrimSpace(*filter.ProjectID) != "" {
		query += " AND project_id = ?"
		args = append(args, strings.TrimSpace(*filter.ProjectID))
	}
	if filter.TaskID != nil && strings.TrimSpace(*filter.TaskID) != "" {
		query += " AND task_id = ?"
		args = append(args, strings.TrimSpace(*filter.TaskID))
	}
	if filter.TargetType != nil && strings.TrimSpace(string(*filter.TargetType)) != "" {
		query += " AND target_type = ?"
		args = append(args, *filter.TargetType)
	}
	if filter.TargetID != nil && strings.TrimSpace(*filter.TargetID) != "" {
		query += " AND target_id = ?"
		args = append(args, strings.TrimSpace(*filter.TargetID))
	}
	query += " ORDER BY created_at DESC, id DESC"

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query task links: %w", err)
	}
	defer rows.Close()

	links := make([]*TaskLink, 0)
	for rows.Next() {
		link, err := scanTaskLink(rows.Scan)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (db *DB) DeleteTaskLink(id string) error {
	result, err := db.conn.Exec("DELETE FROM task_links WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete task link: %w", err)
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

func (db *DB) GetTaskLink(id string) (*TaskLink, error) {
	row := db.conn.QueryRow(`
		SELECT id, task_id, project_id, target_type, target_id, relation_type, created_at
		FROM task_links
		WHERE id = ?
	`, id)
	link, err := scanTaskLink(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return link, err
}

func scanTaskLink(scan scanFunc) (*TaskLink, error) {
	var link TaskLink
	if err := scan(
		&link.ID,
		&link.TaskID,
		&link.ProjectID,
		&link.TargetType,
		&link.TargetID,
		&link.RelationType,
		&link.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &link, nil
}
