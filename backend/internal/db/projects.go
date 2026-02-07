package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Project struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Path           string    `json:"path"`
	GitOrigin      *string   `json:"gitOrigin,omitempty"`
	DefaultBranch  string    `json:"defaultBranch"`
	SymlinkPaths   []string  `json:"symlinkPaths,omitempty"`
	SetupScript    *string   `json:"setupScript,omitempty"`
	TeardownScript *string   `json:"teardownScript,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CreateProjectInput struct {
	Name           string   `json:"name"`
	Path           string   `json:"path"`
	GitOrigin      *string  `json:"gitOrigin,omitempty"`
	DefaultBranch  *string  `json:"defaultBranch,omitempty"`
	SymlinkPaths   []string `json:"symlinkPaths,omitempty"`
	SetupScript    *string  `json:"setupScript,omitempty"`
	TeardownScript *string  `json:"teardownScript,omitempty"`
}

type UpdateProjectInput struct {
	Name           *string  `json:"name,omitempty"`
	Path           *string  `json:"path,omitempty"`
	GitOrigin      *string  `json:"gitOrigin,omitempty"`
	DefaultBranch  *string  `json:"defaultBranch,omitempty"`
	SymlinkPaths   []string `json:"symlinkPaths,omitempty"`
	SetupScript    *string  `json:"setupScript,omitempty"`
	TeardownScript *string  `json:"teardownScript,omitempty"`
}

// CreateProject creates a new project
func (db *DB) CreateProject(input CreateProjectInput) (*Project, error) {
	id := NewID()
	now := time.Now()
	defaultBranch := "main"
	if input.DefaultBranch != nil {
		defaultBranch = *input.DefaultBranch
	}

	// Serialize symlink paths as JSON
	var symlinkPathsJSON sql.NullString
	if len(input.SymlinkPaths) > 0 {
		data, err := json.Marshal(input.SymlinkPaths)
		if err != nil {
			return nil, fmt.Errorf("marshal symlink paths: %w", err)
		}
		symlinkPathsJSON = sql.NullString{String: string(data), Valid: true}
	}

	_, err := db.conn.Exec(`
		INSERT INTO projects (id, name, path, git_origin, default_branch, symlink_paths, setup_script, teardown_script, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, input.Name, input.Path, NullString(input.GitOrigin), defaultBranch, symlinkPathsJSON, NullString(input.SetupScript), NullString(input.TeardownScript), now, now)
	if err != nil {
		return nil, fmt.Errorf("insert project: %w", err)
	}

	return db.GetProject(id)
}

// GetProject retrieves a project by ID
func (db *DB) GetProject(id string) (*Project, error) {
	row := db.conn.QueryRow(`
		SELECT id, name, path, git_origin, default_branch, symlink_paths, setup_script, teardown_script, created_at, updated_at
		FROM projects WHERE id = ?
	`, id)

	p, err := scanProject(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// ListProjects retrieves all projects
func (db *DB) ListProjects() ([]*Project, error) {
	rows, err := db.conn.Query(`
		SELECT id, name, path, git_origin, default_branch, symlink_paths, setup_script, teardown_script, created_at, updated_at
		FROM projects ORDER BY name
	`)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	projects := make([]*Project, 0)
	for rows.Next() {
		p, err := scanProject(rows.Scan)
		if err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}

	return projects, rows.Err()
}

// UpdateProject updates a project
func (db *DB) UpdateProject(id string, input UpdateProjectInput) (*Project, error) {
	// Build update query dynamically
	query := "UPDATE projects SET updated_at = ?"
	args := []any{time.Now()}

	if input.Name != nil {
		query += ", name = ?"
		args = append(args, *input.Name)
	}
	if input.Path != nil {
		query += ", path = ?"
		args = append(args, *input.Path)
	}
	if input.GitOrigin != nil {
		query += ", git_origin = ?"
		args = append(args, *input.GitOrigin)
	}
	if input.DefaultBranch != nil {
		query += ", default_branch = ?"
		args = append(args, *input.DefaultBranch)
	}
	if input.SymlinkPaths != nil {
		data, err := json.Marshal(input.SymlinkPaths)
		if err != nil {
			return nil, fmt.Errorf("marshal symlink paths: %w", err)
		}
		query += ", symlink_paths = ?"
		args = append(args, string(data))
	}
	if input.SetupScript != nil {
		query += ", setup_script = ?"
		args = append(args, *input.SetupScript)
	}
	if input.TeardownScript != nil {
		query += ", teardown_script = ?"
		args = append(args, *input.TeardownScript)
	}

	query += " WHERE id = ?"
	args = append(args, id)

	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}

	return db.GetProject(id)
}

// DeleteProject deletes a project
func (db *DB) DeleteProject(id string) error {
	result, err := db.conn.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
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

func scanProject(scan scanFunc) (*Project, error) {
	var p Project
	var gitOrigin, symlinkPathsJSON, setupScript, teardownScript sql.NullString

	err := scan(&p.ID, &p.Name, &p.Path, &gitOrigin, &p.DefaultBranch, &symlinkPathsJSON, &setupScript, &teardownScript, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}

	p.GitOrigin = StringPtr(gitOrigin)
	p.SetupScript = StringPtr(setupScript)
	p.TeardownScript = StringPtr(teardownScript)

	// Parse symlink paths from JSON
	if symlinkPathsJSON.Valid && symlinkPathsJSON.String != "" {
		if err := json.Unmarshal([]byte(symlinkPathsJSON.String), &p.SymlinkPaths); err != nil {
			return nil, fmt.Errorf("unmarshal symlink paths: %w", err)
		}
	}

	return &p, nil
}
