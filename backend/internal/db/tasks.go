package db

import (
	"database/sql"
	"fmt"
	"time"
)

type TaskStatus string

const (
	TaskStatusBacklog    TaskStatus = "backlog"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusBlocked    TaskStatus = "blocked"
	TaskStatusDone       TaskStatus = "done"
)

type Task struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"projectId"`
	Title        string     `json:"title"`
	Description  *string    `json:"description,omitempty"`
	Status       TaskStatus `json:"status"`
	Branch       *string    `json:"branch,omitempty"`
	WorktreePath *string    `json:"worktreePath,omitempty"`
	Pinned       bool       `json:"pinned"`
	CreatedAt    time.Time  `json:"createdAt"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
}

type CreateTaskInput struct {
	ProjectID   string  `json:"projectId"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
}

type UpdateTaskInput struct {
	Title        *string     `json:"title,omitempty"`
	Description  *string     `json:"description,omitempty"`
	Status       *TaskStatus `json:"status,omitempty"`
	Branch       *string     `json:"branch,omitempty"`
	WorktreePath *string     `json:"worktreePath,omitempty"`
	Pinned       *bool       `json:"pinned,omitempty"`
}

type TaskFilter struct {
	ProjectID *string
	Status    *TaskStatus
}

// CreateTask creates a new task
func (db *DB) CreateTask(input CreateTaskInput) (*Task, error) {
	id := NewID()
	now := time.Now()

	_, err := db.conn.Exec(`
		INSERT INTO tasks (id, project_id, title, description, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, input.ProjectID, input.Title, NullString(input.Description), TaskStatusBacklog, now)
	if err != nil {
		return nil, fmt.Errorf("insert task: %w", err)
	}

	return db.GetTask(id)
}

// GetTask retrieves a task by ID
func (db *DB) GetTask(id string) (*Task, error) {
	row := db.conn.QueryRow(`
		SELECT id, project_id, title, description, status, branch, worktree_path,
		       pinned, created_at, started_at, completed_at
		FROM tasks WHERE id = ?
	`, id)

	return scanTask(row)
}

// ListTasks retrieves tasks with optional filtering
func (db *DB) ListTasks(filter TaskFilter) ([]*Task, error) {
	query := `
		SELECT id, project_id, title, description, status, branch, worktree_path,
		       pinned, created_at, started_at, completed_at
		FROM tasks WHERE 1=1
	`
	var args []any

	if filter.ProjectID != nil {
		query += " AND project_id = ?"
		args = append(args, *filter.ProjectID)
	}
	if filter.Status != nil {
		query += " AND status = ?"
		args = append(args, *filter.Status)
	}

	query += " ORDER BY pinned DESC, created_at DESC"

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query tasks: %w", err)
	}
	defer rows.Close()

	var tasks []*Task
	for rows.Next() {
		t, err := scanTaskRows(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}

	return tasks, rows.Err()
}

// UpdateTask updates a task
func (db *DB) UpdateTask(id string, input UpdateTaskInput) (*Task, error) {
	// Get current task to handle status transitions
	current, err := db.GetTask(id)
	if err != nil {
		return nil, err
	}

	query := "UPDATE tasks SET id = id" // No-op to start the SET clause
	args := []any{}

	if input.Title != nil {
		query += ", title = ?"
		args = append(args, *input.Title)
	}
	if input.Description != nil {
		query += ", description = ?"
		args = append(args, *input.Description)
	}
	if input.Status != nil {
		query += ", status = ?"
		args = append(args, *input.Status)

		// Handle status transition timestamps
		now := time.Now()
		if *input.Status == TaskStatusInProgress && current.Status == TaskStatusBacklog {
			query += ", started_at = ?"
			args = append(args, now)
		}
		if *input.Status == TaskStatusDone && current.Status != TaskStatusDone {
			query += ", completed_at = ?"
			args = append(args, now)
		}
	}
	if input.Branch != nil {
		query += ", branch = ?"
		args = append(args, *input.Branch)
	}
	if input.WorktreePath != nil {
		query += ", worktree_path = ?"
		args = append(args, *input.WorktreePath)
	}
	if input.Pinned != nil {
		query += ", pinned = ?"
		args = append(args, *input.Pinned)
	}

	query += " WHERE id = ?"
	args = append(args, id)

	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update task: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, sql.ErrNoRows
	}

	return db.GetTask(id)
}

// DeleteTask deletes a task
func (db *DB) DeleteTask(id string) error {
	result, err := db.conn.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func scanTask(row *sql.Row) (*Task, error) {
	var t Task
	var description, branch, worktreePath sql.NullString
	var startedAt, completedAt sql.NullTime

	err := row.Scan(
		&t.ID, &t.ProjectID, &t.Title, &description, &t.Status,
		&branch, &worktreePath, &t.Pinned, &t.CreatedAt, &startedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}

	t.Description = StringPtr(description)
	t.Branch = StringPtr(branch)
	t.WorktreePath = StringPtr(worktreePath)
	t.StartedAt = TimePtr(startedAt)
	t.CompletedAt = TimePtr(completedAt)

	return &t, nil
}

func scanTaskRows(rows *sql.Rows) (*Task, error) {
	var t Task
	var description, branch, worktreePath sql.NullString
	var startedAt, completedAt sql.NullTime

	err := rows.Scan(
		&t.ID, &t.ProjectID, &t.Title, &description, &t.Status,
		&branch, &worktreePath, &t.Pinned, &t.CreatedAt, &startedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}

	t.Description = StringPtr(description)
	t.Branch = StringPtr(branch)
	t.WorktreePath = StringPtr(worktreePath)
	t.StartedAt = TimePtr(startedAt)
	t.CompletedAt = TimePtr(completedAt)

	return &t, nil
}
