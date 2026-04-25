package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type WorkspaceKind string

const (
	WorkspaceKindMain     WorkspaceKind = "main"
	WorkspaceKindWorktree WorkspaceKind = "worktree"
)

type WorkspaceStatus string

const (
	WorkspaceStatusActive    WorkspaceStatus = "active"
	WorkspaceStatusMerged    WorkspaceStatus = "merged"
	WorkspaceStatusAbandoned WorkspaceStatus = "abandoned"
	WorkspaceStatusArchived  WorkspaceStatus = "archived"
)

type WorkspaceOrigin string

const (
	WorkspaceOriginDirect   WorkspaceOrigin = "direct"
	WorkspaceOriginPromoted WorkspaceOrigin = "promoted"
	WorkspaceOriginForked   WorkspaceOrigin = "forked"
)

type Workspace struct {
	ID                string          `json:"id"`
	ProjectID         string          `json:"projectId"`
	Name              string          `json:"name"`
	Kind              WorkspaceKind   `json:"kind"`
	Status            WorkspaceStatus `json:"status"`
	BranchName        string          `json:"branchName"`
	BaseBranch        *string         `json:"baseBranch,omitempty"`
	WorktreePath      *string         `json:"worktreePath,omitempty"`
	ParentWorkspaceID *string         `json:"parentWorkspaceId,omitempty"`
	Origin            WorkspaceOrigin `json:"origin"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	ClosedAt          *time.Time      `json:"closedAt,omitempty"`
}

type CreateWorkspaceInput struct {
	ProjectID         string
	Name              string
	Kind              WorkspaceKind
	Status            WorkspaceStatus
	BranchName        string
	BaseBranch        *string
	WorktreePath      *string
	ParentWorkspaceID *string
	Origin            WorkspaceOrigin
}

type UpdateWorkspaceInput struct {
	Name          *string          `json:"name,omitempty"`
	Status        *WorkspaceStatus `json:"status,omitempty"`
	BranchName    *string          `json:"branchName,omitempty"`
	BaseBranch    *string          `json:"baseBranch,omitempty"`
	WorktreePath  *string          `json:"worktreePath,omitempty"`
	ClearWorktree bool             `json:"-"`
	ClosedAt      *time.Time       `json:"closedAt,omitempty"`
	ClearClosedAt bool             `json:"-"`
}

func (db *DB) CreateWorkspace(input CreateWorkspaceInput) (*Workspace, error) {
	id := NewID()
	now := time.Now()
	kind := input.Kind
	if kind == "" {
		kind = WorkspaceKindMain
	}
	status := input.Status
	if status == "" {
		status = WorkspaceStatusActive
	}
	origin := input.Origin
	if origin == "" {
		origin = WorkspaceOriginDirect
	}

	_, err := db.conn.Exec(`
		INSERT INTO workspaces (
			id, project_id, name, kind, status, branch_name, base_branch, worktree_path, parent_workspace_id, origin, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, input.ProjectID, input.Name, kind, status, input.BranchName, NullString(input.BaseBranch), NullString(input.WorktreePath), NullString(input.ParentWorkspaceID), origin, now, now)
	if err != nil {
		return nil, fmt.Errorf("insert workspace: %w", err)
	}
	return db.GetWorkspace(id)
}

func (db *DB) createDefaultWorkspaceTx(tx *sql.Tx, projectID, defaultBranch string) error {
	if defaultBranch == "" {
		defaultBranch = "main"
	}
	id := NewID()
	now := time.Now()
	_, err := tx.Exec(`
		INSERT INTO workspaces (
			id, project_id, name, kind, status, branch_name, origin, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, projectID, defaultBranch, WorkspaceKindMain, WorkspaceStatusActive, defaultBranch, WorkspaceOriginDirect, now, now)
	if err != nil {
		return fmt.Errorf("insert default workspace: %w", err)
	}
	return nil
}

func (db *DB) GetWorkspace(id string) (*Workspace, error) {
	row := db.conn.QueryRow(`
		SELECT id, project_id, name, kind, status, branch_name, base_branch, worktree_path, parent_workspace_id, origin, created_at, updated_at, closed_at
		FROM workspaces WHERE id = ?
	`, id)
	w, err := scanWorkspace(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (db *DB) GetCanonicalWorkspaceForProject(projectID string) (*Workspace, error) {
	row := db.conn.QueryRow(`
		SELECT id, project_id, name, kind, status, branch_name, base_branch, worktree_path, parent_workspace_id, origin, created_at, updated_at, closed_at
		FROM workspaces
		WHERE project_id = ? AND kind = ?
		ORDER BY created_at ASC
		LIMIT 1
	`, projectID, WorkspaceKindMain)
	w, err := scanWorkspace(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (db *DB) ListWorkspacesByProject(projectID string) ([]*Workspace, error) {
	rows, err := db.conn.Query(`
		SELECT id, project_id, name, kind, status, branch_name, base_branch, worktree_path, parent_workspace_id, origin, created_at, updated_at, closed_at
		FROM workspaces
		WHERE project_id = ?
		ORDER BY created_at ASC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query workspaces: %w", err)
	}
	defer rows.Close()

	var workspaces []*Workspace
	for rows.Next() {
		w, err := scanWorkspace(rows.Scan)
		if err != nil {
			return nil, err
		}
		workspaces = append(workspaces, w)
	}
	return workspaces, rows.Err()
}

func (db *DB) UpdateWorkspace(id string, input UpdateWorkspaceInput) (*Workspace, error) {
	query := "UPDATE workspaces SET updated_at = ?"
	args := []any{time.Now()}

	if input.Name != nil {
		query += ", name = ?"
		args = append(args, *input.Name)
	}
	if input.Status != nil {
		query += ", status = ?"
		args = append(args, *input.Status)
	}
	if input.BranchName != nil {
		query += ", branch_name = ?"
		args = append(args, *input.BranchName)
	}
	if input.BaseBranch != nil {
		query += ", base_branch = ?"
		args = append(args, *input.BaseBranch)
	}
	if input.WorktreePath != nil {
		query += ", worktree_path = ?"
		args = append(args, *input.WorktreePath)
	} else if input.ClearWorktree {
		query += ", worktree_path = NULL"
	}
	if input.ClosedAt != nil {
		query += ", closed_at = ?"
		args = append(args, *input.ClosedAt)
	} else if input.ClearClosedAt {
		query += ", closed_at = NULL"
	}
	query += " WHERE id = ?"
	args = append(args, id)

	result, err := db.conn.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update workspace: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, ErrNotFound
	}
	return db.GetWorkspace(id)
}

func (db *DB) DeleteWorkspace(id string) error {
	result, err := db.conn.Exec(`DELETE FROM workspaces WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete workspace: %w", err)
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

func scanWorkspace(scan scanFunc) (*Workspace, error) {
	var w Workspace
	var baseBranch, worktreePath, parentWorkspaceID sql.NullString
	var closedAt sql.NullTime
	err := scan(
		&w.ID,
		&w.ProjectID,
		&w.Name,
		&w.Kind,
		&w.Status,
		&w.BranchName,
		&baseBranch,
		&worktreePath,
		&parentWorkspaceID,
		&w.Origin,
		&w.CreatedAt,
		&w.UpdatedAt,
		&closedAt,
	)
	if err != nil {
		return nil, err
	}
	w.BaseBranch = StringPtr(baseBranch)
	w.WorktreePath = StringPtr(worktreePath)
	w.ParentWorkspaceID = StringPtr(parentWorkspaceID)
	w.ClosedAt = TimePtr(closedAt)
	return &w, nil
}
