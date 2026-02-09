package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type TaskStatus string

const (
	TaskStatusBacklog    TaskStatus = "backlog"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusInReview   TaskStatus = "in_review"
	TaskStatusDone       TaskStatus = "done"
)

type Task struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"projectId"`
	Title        string     `json:"title"`
	Description  *string    `json:"description,omitempty"`
	Status       TaskStatus `json:"status"`
	TaskType     string     `json:"taskType"`
	Priority     *string    `json:"priority,omitempty"`
	Branch       *string    `json:"branch,omitempty"`
	WorktreePath *string    `json:"worktreePath,omitempty"`
	PRURL        *string    `json:"prUrl,omitempty"`
	Pinned       bool       `json:"pinned"`
	Position     int        `json:"position"`
	Labels       []*Label   `json:"labels"`
	CreatedAt    time.Time  `json:"createdAt"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
}

type CreateTaskInput struct {
	ProjectID   string  `json:"projectId"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	TaskType    *string `json:"taskType,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	Branch      *string `json:"branch,omitempty"`
}

type UpdateTaskInput struct {
	Title        *string     `json:"title,omitempty"`
	Description  *string     `json:"description,omitempty"`
	Status       *TaskStatus `json:"status,omitempty"`
	TaskType     *string     `json:"taskType,omitempty"`
	Priority     *string     `json:"priority,omitempty"`
	Branch       *string     `json:"branch,omitempty"`
	WorktreePath *string     `json:"worktreePath,omitempty"`
	PRURL        *string     `json:"prUrl,omitempty"`
	Pinned       *bool       `json:"pinned,omitempty"`
	Position     *int        `json:"position,omitempty"`
}

type TaskFilter struct {
	ProjectID *string
	Status    *TaskStatus
	Statuses  []TaskStatus
}

// CreateTask creates a new task
func (db *DB) CreateTask(input CreateTaskInput) (*Task, error) {
	id := NewID()
	now := time.Now()

	taskType := "task"
	if input.TaskType != nil {
		taskType = *input.TaskType
	}

	_, err := db.conn.Exec(`
		INSERT INTO tasks (id, project_id, title, description, task_type, priority, branch, status, position, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) FROM tasks WHERE status = ?), -1) + 1, ?)
	`, id, input.ProjectID, input.Title, NullString(input.Description), taskType, NullString(input.Priority), NullString(input.Branch), TaskStatusBacklog, TaskStatusBacklog, now)
	if err != nil {
		return nil, fmt.Errorf("insert task: %w", err)
	}

	return db.GetTask(id)
}

// GetTask retrieves a task by ID
func (db *DB) GetTask(id string) (*Task, error) {
	row := db.conn.QueryRow(`
		SELECT id, project_id, title, description, status, task_type, priority,
		       branch, worktree_path, pr_url, pinned, position,
		       created_at, started_at, completed_at
		FROM tasks WHERE id = ?
	`, id)

	t, err := scanTask(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// ListTasks retrieves tasks with optional filtering
func (db *DB) ListTasks(filter TaskFilter) ([]*Task, error) {
	query := `
		SELECT id, project_id, title, description, status, task_type, priority,
		       branch, worktree_path, pr_url, pinned, position,
		       created_at, started_at, completed_at
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
	if len(filter.Statuses) > 0 {
		placeholders := make([]string, len(filter.Statuses))
		for i, s := range filter.Statuses {
			placeholders[i] = "?"
			args = append(args, s)
		}
		query += " AND status IN (" + strings.Join(placeholders, ", ") + ")"
	}

	query += " ORDER BY position ASC"

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query tasks: %w", err)
	}
	defer rows.Close()

	tasks := make([]*Task, 0)
	for rows.Next() {
		t, err := scanTask(rows.Scan)
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

	tx, err := db.conn.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	statusChanging := input.Status != nil && *input.Status != current.Status
	positionChanging := input.Position != nil && *input.Position != current.Position

	// Handle position shifting
	if statusChanging {
		// Close gap in old column
		_, err = tx.Exec(
			"UPDATE tasks SET position = position - 1 WHERE status = ? AND position > ?",
			current.Status, current.Position,
		)
		if err != nil {
			return nil, fmt.Errorf("close gap in old column: %w", err)
		}

		if input.Position != nil {
			// Make room at target position in new column
			_, err = tx.Exec(
				"UPDATE tasks SET position = position + 1 WHERE status = ? AND position >= ?",
				*input.Status, *input.Position,
			)
			if err != nil {
				return nil, fmt.Errorf("make room in new column: %w", err)
			}
		}
	} else if positionChanging {
		// Same-column reorder
		oldPos := current.Position
		newPos := *input.Position
		if newPos < oldPos {
			_, err = tx.Exec(
				"UPDATE tasks SET position = position + 1 WHERE status = ? AND position >= ? AND position < ? AND id != ?",
				current.Status, newPos, oldPos, id,
			)
		} else {
			_, err = tx.Exec(
				"UPDATE tasks SET position = position - 1 WHERE status = ? AND position > ? AND position <= ? AND id != ?",
				current.Status, oldPos, newPos, id,
			)
		}
		if err != nil {
			return nil, fmt.Errorf("shift positions: %w", err)
		}
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
	if input.TaskType != nil {
		query += ", task_type = ?"
		args = append(args, *input.TaskType)
	}
	if input.Priority != nil {
		query += ", priority = ?"
		args = append(args, NullString(input.Priority))
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
	if input.PRURL != nil {
		query += ", pr_url = ?"
		args = append(args, *input.PRURL)
	}
	if input.Pinned != nil {
		query += ", pinned = ?"
		args = append(args, *input.Pinned)
	}

	// Set position
	if input.Position != nil {
		query += ", position = ?"
		args = append(args, *input.Position)
	} else if statusChanging {
		// Append to end of target column
		query += ", position = COALESCE((SELECT MAX(position) FROM tasks WHERE status = ? AND id != ?), -1) + 1"
		args = append(args, *input.Status, id)
	}

	query += " WHERE id = ?"
	args = append(args, id)

	result, err := tx.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update task: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
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
		return ErrNotFound
	}

	return nil
}

func scanTask(scan scanFunc) (*Task, error) {
	var t Task
	var description, taskType, priority, branch, worktreePath, prURL sql.NullString
	var position sql.NullInt64
	var startedAt, completedAt sql.NullTime

	err := scan(
		&t.ID, &t.ProjectID, &t.Title, &description, &t.Status, &taskType, &priority,
		&branch, &worktreePath, &prURL, &t.Pinned, &position,
		&t.CreatedAt, &startedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}

	t.Description = StringPtr(description)
	t.TaskType = "task"
	if taskType.Valid && taskType.String != "" {
		t.TaskType = taskType.String
	}
	t.Priority = StringPtr(priority)
	t.Branch = StringPtr(branch)
	t.WorktreePath = StringPtr(worktreePath)
	t.PRURL = StringPtr(prURL)
	if position.Valid {
		t.Position = int(position.Int64)
	}
	t.Labels = make([]*Label, 0)
	t.StartedAt = TimePtr(startedAt)
	t.CompletedAt = TimePtr(completedAt)

	return &t, nil
}
