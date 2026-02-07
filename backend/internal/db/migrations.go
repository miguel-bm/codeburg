package db

import (
	"fmt"
)

// Migrate runs all database migrations
func (db *DB) Migrate() error {
	// Create migrations table if not exists
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS migrations (
			id INTEGER PRIMARY KEY,
			version INTEGER NOT NULL UNIQUE,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	// Get current version
	var currentVersion int
	row := db.conn.QueryRow("SELECT COALESCE(MAX(version), 0) FROM migrations")
	if err := row.Scan(&currentVersion); err != nil {
		return fmt.Errorf("get current version: %w", err)
	}

	// Run pending migrations
	for _, m := range migrations {
		if m.version > currentVersion {
			if err := db.runMigration(m); err != nil {
				return fmt.Errorf("migration %d: %w", m.version, err)
			}
		}
	}

	return nil
}

type migration struct {
	version int
	sql     string
}

func (db *DB) runMigration(m migration) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(m.sql); err != nil {
		return err
	}

	if _, err := tx.Exec("INSERT INTO migrations (version) VALUES (?)", m.version); err != nil {
		return err
	}

	return tx.Commit()
}

var migrations = []migration{
	{
		version: 1,
		sql: `
			-- Projects imported from GitHub or local filesystem
			CREATE TABLE projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				path TEXT NOT NULL,
				git_origin TEXT,
				default_branch TEXT DEFAULT 'main',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

			-- Tasks in the kanban board
			CREATE TABLE tasks (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				title TEXT NOT NULL,
				description TEXT,
				status TEXT DEFAULT 'backlog',
				branch TEXT,
				worktree_path TEXT,
				pinned BOOLEAN DEFAULT FALSE,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				started_at DATETIME,
				completed_at DATETIME,

				-- Future extensibility fields (nullable, unused in MVP)
				parent_id TEXT REFERENCES tasks(id),
				task_type TEXT DEFAULT 'task',
				due_date DATETIME,
				position INTEGER,
				metadata JSON
			);

			-- Task dependencies (for future use)
			CREATE TABLE task_dependencies (
				id TEXT PRIMARY KEY,
				blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				blocked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(blocker_id, blocked_id)
			);

			-- Task labels (for future use)
			CREATE TABLE task_labels (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				color TEXT,
				UNIQUE(project_id, name)
			);

			CREATE TABLE task_label_assignments (
				task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				label_id TEXT NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
				PRIMARY KEY (task_id, label_id)
			);

			-- Agent sessions within a task
			CREATE TABLE agent_sessions (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				provider TEXT NOT NULL,
				provider_session_id TEXT,
				status TEXT DEFAULT 'idle',
				tmux_window TEXT,
				tmux_pane TEXT,
				log_file TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

			-- Indexes for common queries
			CREATE INDEX idx_tasks_project ON tasks(project_id);
			CREATE INDEX idx_tasks_status ON tasks(status);
			CREATE INDEX idx_tasks_parent ON tasks(parent_id);
			CREATE INDEX idx_sessions_task ON agent_sessions(task_id);
			CREATE INDEX idx_dependencies_blocker ON task_dependencies(blocker_id);
			CREATE INDEX idx_dependencies_blocked ON task_dependencies(blocked_id);
		`,
	},
	{
		version: 2,
		sql: `
			-- Add worktree configuration to projects
			ALTER TABLE projects ADD COLUMN symlink_paths TEXT;
			ALTER TABLE projects ADD COLUMN setup_script TEXT;
			ALTER TABLE projects ADD COLUMN teardown_script TEXT;
		`,
	},
	{
		version: 3,
		sql: `
			-- Add session type to distinguish claude agent sessions from terminal sessions
			ALTER TABLE agent_sessions ADD COLUMN session_type TEXT DEFAULT 'claude';
		`,
	},
	{
		version: 4,
		sql: `
			-- All sessions are now terminal-based (rendered via xterm.js)
			UPDATE agent_sessions SET session_type = 'terminal' WHERE session_type = 'claude';
			-- Add activity tracking for terminal sessions
			ALTER TABLE agent_sessions ADD COLUMN last_activity_at TIMESTAMP;
		`,
	},
}
