package db

import (
	"fmt"
	"strings"
)

type Label struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
}

type CreateLabelInput struct {
	ProjectID string
	Name      string
	Color     string
}

// CreateLabel creates a new label for a project.
func (db *DB) CreateLabel(input CreateLabelInput) (*Label, error) {
	id := NewID()
	_, err := db.conn.Exec(
		`INSERT INTO task_labels (id, project_id, name, color) VALUES (?, ?, ?, ?)`,
		id, input.ProjectID, input.Name, input.Color,
	)
	if err != nil {
		return nil, fmt.Errorf("insert label: %w", err)
	}
	return &Label{ID: id, ProjectID: input.ProjectID, Name: input.Name, Color: input.Color}, nil
}

// ListLabels returns all labels for a project.
func (db *DB) ListLabels(projectID string) ([]*Label, error) {
	rows, err := db.conn.Query(
		`SELECT id, project_id, name, COALESCE(color, '') FROM task_labels WHERE project_id = ? ORDER BY name`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query labels: %w", err)
	}
	defer rows.Close()

	labels := make([]*Label, 0)
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.ProjectID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		labels = append(labels, &l)
	}
	return labels, rows.Err()
}

// DeleteLabel deletes a label by ID. Cascade deletes assignments.
func (db *DB) DeleteLabel(id string) error {
	result, err := db.conn.Exec(`DELETE FROM task_labels WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete label: %w", err)
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

// AssignLabel assigns a label to a task.
func (db *DB) AssignLabel(taskID, labelID string) error {
	_, err := db.conn.Exec(
		`INSERT OR IGNORE INTO task_label_assignments (task_id, label_id) VALUES (?, ?)`,
		taskID, labelID,
	)
	if err != nil {
		return fmt.Errorf("assign label: %w", err)
	}
	return nil
}

// UnassignLabel removes a label from a task.
func (db *DB) UnassignLabel(taskID, labelID string) error {
	result, err := db.conn.Exec(
		`DELETE FROM task_label_assignments WHERE task_id = ? AND label_id = ?`,
		taskID, labelID,
	)
	if err != nil {
		return fmt.Errorf("unassign label: %w", err)
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

// GetTaskLabels returns all labels assigned to a task.
func (db *DB) GetTaskLabels(taskID string) ([]*Label, error) {
	rows, err := db.conn.Query(`
		SELECT tl.id, tl.project_id, tl.name, COALESCE(tl.color, '')
		FROM task_labels tl
		JOIN task_label_assignments tla ON tla.label_id = tl.id
		WHERE tla.task_id = ?
		ORDER BY tl.name
	`, taskID)
	if err != nil {
		return nil, fmt.Errorf("query task labels: %w", err)
	}
	defer rows.Close()

	labels := make([]*Label, 0)
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.ProjectID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		labels = append(labels, &l)
	}
	return labels, rows.Err()
}

// GetTasksLabels returns labels for multiple tasks (batch).
func (db *DB) GetTasksLabels(taskIDs []string) (map[string][]*Label, error) {
	result := make(map[string][]*Label, len(taskIDs))
	if len(taskIDs) == 0 {
		return result, nil
	}

	placeholders := make([]string, len(taskIDs))
	args := make([]any, len(taskIDs))
	for i, id := range taskIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	rows, err := db.conn.Query(`
		SELECT tla.task_id, tl.id, tl.project_id, tl.name, COALESCE(tl.color, '')
		FROM task_labels tl
		JOIN task_label_assignments tla ON tla.label_id = tl.id
		WHERE tla.task_id IN (`+strings.Join(placeholders, ", ")+`)
		ORDER BY tl.name
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query tasks labels: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var taskID string
		var l Label
		if err := rows.Scan(&taskID, &l.ID, &l.ProjectID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		result[taskID] = append(result[taskID], &l)
	}
	return result, rows.Err()
}
