package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// ProjectArchive contains all data associated with a project for export/import.
type ProjectArchive struct {
	Version          int                   `json:"version"`
	ArchivedAt       time.Time             `json:"archivedAt"`
	Project          *Project              `json:"project"`
	Tasks            []*ArchiveTask        `json:"tasks"`
	Labels           []*Label              `json:"labels"`
	LabelAssignments []LabelAssignment     `json:"labelAssignments"`
	TaskDependencies []TaskDependency      `json:"taskDependencies"`
	Sessions         []*ArchiveSession     `json:"sessions"`
}

// ArchiveTask is a Task with all fields serialized for archival (no Labels slice—assignments stored separately).
type ArchiveTask struct {
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
	CreatedAt    time.Time  `json:"createdAt"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
}

// ArchiveSession is a minimal session snapshot for archival.
type ArchiveSession struct {
	ID                string        `json:"id"`
	TaskID            string        `json:"taskId"`
	Provider          string        `json:"provider"`
	SessionType       string        `json:"sessionType"`
	ProviderSessionID *string       `json:"providerSessionId,omitempty"`
	Status            SessionStatus `json:"status"`
	LogFile           *string       `json:"logFile,omitempty"`
	CreatedAt         time.Time     `json:"createdAt"`
	UpdatedAt         time.Time     `json:"updatedAt"`
}

// LabelAssignment links a task to a label.
type LabelAssignment struct {
	TaskID  string `json:"taskId"`
	LabelID string `json:"labelId"`
}

// TaskDependency links a blocker task to a blocked task.
type TaskDependency struct {
	ID        string `json:"id"`
	BlockerID string `json:"blockerId"`
	BlockedID string `json:"blockedId"`
}

// ExportProjectArchive gathers all data related to a project into an archive struct.
func (db *DB) ExportProjectArchive(projectID string) (*ProjectArchive, error) {
	project, err := db.GetProject(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// Fetch tasks
	tasks, err := db.listAllTasksForProject(projectID)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}

	// Fetch labels
	labels, err := db.ListLabels(projectID)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}

	// Collect task IDs for related queries
	taskIDs := make([]string, len(tasks))
	for i, t := range tasks {
		taskIDs[i] = t.ID
	}

	// Fetch label assignments
	assignments, err := db.listLabelAssignmentsForTasks(taskIDs)
	if err != nil {
		return nil, fmt.Errorf("list label assignments: %w", err)
	}

	// Fetch task dependencies
	deps, err := db.listTaskDependenciesForTasks(taskIDs)
	if err != nil {
		return nil, fmt.Errorf("list task dependencies: %w", err)
	}

	// Fetch sessions
	sessions, err := db.listAllSessionsForTasks(taskIDs)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}

	return &ProjectArchive{
		Version:          1,
		ArchivedAt:       time.Now(),
		Project:          project,
		Tasks:            tasks,
		Labels:           labels,
		LabelAssignments: assignments,
		TaskDependencies: deps,
		Sessions:         sessions,
	}, nil
}

// ImportProjectArchive inserts all archive data back into the database within a transaction.
func (db *DB) ImportProjectArchive(archive *ProjectArchive) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	p := archive.Project

	// Serialize JSON fields
	symlinkJSON := marshalJSONOrNull(p.SymlinkPaths)
	secretJSON := marshalJSONOrNull(p.SecretFiles)
	workflowJSON := marshalJSONOrNull(p.Workflow)

	// Insert project
	_, err = tx.Exec(`
		INSERT INTO projects (id, name, path, git_origin, default_branch, symlink_paths, secret_files, setup_script, teardown_script, workflow, hidden, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.ID, p.Name, p.Path, NullString(p.GitOrigin), p.DefaultBranch,
		symlinkJSON, secretJSON, NullString(p.SetupScript), NullString(p.TeardownScript),
		workflowJSON, p.Hidden, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert project: %w", err)
	}

	// Insert tasks
	for _, t := range archive.Tasks {
		_, err = tx.Exec(`
			INSERT INTO tasks (id, project_id, title, description, status, task_type, priority, branch, worktree_path, pr_url, pinned, position, created_at, started_at, completed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, t.ID, t.ProjectID, t.Title, NullString(t.Description), t.Status, t.TaskType,
			NullString(t.Priority), NullString(t.Branch), NullString(t.WorktreePath),
			NullString(t.PRURL), t.Pinned, t.Position, t.CreatedAt,
			NullTime(t.StartedAt), NullTime(t.CompletedAt))
		if err != nil {
			return fmt.Errorf("insert task %s: %w", t.ID, err)
		}
	}

	// Insert labels
	for _, l := range archive.Labels {
		_, err = tx.Exec(`
			INSERT INTO task_labels (id, project_id, name, color) VALUES (?, ?, ?, ?)
		`, l.ID, l.ProjectID, l.Name, l.Color)
		if err != nil {
			return fmt.Errorf("insert label %s: %w", l.ID, err)
		}
	}

	// Insert label assignments
	for _, a := range archive.LabelAssignments {
		_, err = tx.Exec(`
			INSERT OR IGNORE INTO task_label_assignments (task_id, label_id) VALUES (?, ?)
		`, a.TaskID, a.LabelID)
		if err != nil {
			return fmt.Errorf("insert label assignment: %w", err)
		}
	}

	// Insert task dependencies
	for _, d := range archive.TaskDependencies {
		_, err = tx.Exec(`
			INSERT OR IGNORE INTO task_dependencies (id, blocker_id, blocked_id) VALUES (?, ?, ?)
		`, d.ID, d.BlockerID, d.BlockedID)
		if err != nil {
			return fmt.Errorf("insert task dependency: %w", err)
		}
	}

	// Insert sessions
	for _, s := range archive.Sessions {
		_, err = tx.Exec(`
			INSERT INTO agent_sessions (id, task_id, provider, session_type, provider_session_id, status, log_file, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, s.ID, s.TaskID, s.Provider, s.SessionType,
			NullString(s.ProviderSessionID), s.Status, NullString(s.LogFile),
			s.CreatedAt, s.UpdatedAt)
		if err != nil {
			return fmt.Errorf("insert session %s: %w", s.ID, err)
		}
	}

	return tx.Commit()
}

// --- helper queries ---

func (db *DB) listAllTasksForProject(projectID string) ([]*ArchiveTask, error) {
	rows, err := db.conn.Query(`
		SELECT id, project_id, title, description, status, COALESCE(task_type, 'task'), priority,
		       branch, worktree_path, pr_url, pinned, COALESCE(position, 0), created_at, started_at, completed_at
		FROM tasks WHERE project_id = ? ORDER BY created_at
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := make([]*ArchiveTask, 0)
	for rows.Next() {
		var t ArchiveTask
		var desc, priority, branch, wt, prURL sql.NullString
		var startedAt, completedAt sql.NullTime
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Title, &desc, &t.Status, &t.TaskType, &priority,
			&branch, &wt, &prURL, &t.Pinned, &t.Position, &t.CreatedAt, &startedAt, &completedAt); err != nil {
			return nil, err
		}
		t.Description = StringPtr(desc)
		t.Priority = StringPtr(priority)
		t.Branch = StringPtr(branch)
		t.WorktreePath = StringPtr(wt)
		t.PRURL = StringPtr(prURL)
		t.StartedAt = TimePtr(startedAt)
		t.CompletedAt = TimePtr(completedAt)
		tasks = append(tasks, &t)
	}
	return tasks, rows.Err()
}

func (db *DB) listLabelAssignmentsForTasks(taskIDs []string) ([]LabelAssignment, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	query := `SELECT task_id, label_id FROM task_label_assignments WHERE task_id IN (?` + repeatPlaceholders(len(taskIDs)-1) + `)`
	args := toAnySlice(taskIDs)
	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []LabelAssignment
	for rows.Next() {
		var a LabelAssignment
		if err := rows.Scan(&a.TaskID, &a.LabelID); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

func (db *DB) listTaskDependenciesForTasks(taskIDs []string) ([]TaskDependency, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	query := `SELECT id, blocker_id, blocked_id FROM task_dependencies WHERE blocker_id IN (?` + repeatPlaceholders(len(taskIDs)-1) + `) OR blocked_id IN (?` + repeatPlaceholders(len(taskIDs)-1) + `)`
	args := append(toAnySlice(taskIDs), toAnySlice(taskIDs)...)
	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TaskDependency
	for rows.Next() {
		var d TaskDependency
		if err := rows.Scan(&d.ID, &d.BlockerID, &d.BlockedID); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

func (db *DB) listAllSessionsForTasks(taskIDs []string) ([]*ArchiveSession, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	query := `SELECT id, task_id, provider, session_type, provider_session_id, status, log_file, created_at, updated_at
		FROM agent_sessions WHERE task_id IN (?` + repeatPlaceholders(len(taskIDs)-1) + `) ORDER BY created_at`
	rows, err := db.conn.Query(query, toAnySlice(taskIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]*ArchiveSession, 0)
	for rows.Next() {
		var s ArchiveSession
		var providerSessID, logFile sql.NullString
		if err := rows.Scan(&s.ID, &s.TaskID, &s.Provider, &s.SessionType, &providerSessID, &s.Status, &logFile, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.ProviderSessionID = StringPtr(providerSessID)
		s.LogFile = StringPtr(logFile)
		sessions = append(sessions, &s)
	}
	return sessions, rows.Err()
}

func repeatPlaceholders(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += ", ?"
	}
	return s
}

func toAnySlice(ss []string) []any {
	result := make([]any, len(ss))
	for i, s := range ss {
		result[i] = s
	}
	return result
}

func marshalJSONOrNull(v any) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	// Check for nil-ish values
	switch val := v.(type) {
	case []string:
		if len(val) == 0 {
			return sql.NullString{}
		}
	case []SecretFileConfig:
		if len(val) == 0 {
			return sql.NullString{}
		}
	case *ProjectWorkflow:
		if val == nil {
			return sql.NullString{}
		}
	}
	data, _ := json.Marshal(v)
	return sql.NullString{String: string(data), Valid: true}
}
