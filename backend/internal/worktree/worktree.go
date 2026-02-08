package worktree

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Config holds the configuration for worktree operations
type Config struct {
	// BaseDir is the base directory for worktrees (default: ~/.codeburg/worktrees)
	BaseDir string
}

// DefaultConfig returns the default worktree configuration
func DefaultConfig() Config {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return Config{
		BaseDir: filepath.Join(home, ".codeburg", "worktrees"),
	}
}

// Manager handles git worktree operations
type Manager struct {
	config Config
}

// NewManager creates a new worktree manager
func NewManager(config Config) *Manager {
	return &Manager{config: config}
}

// CreateOptions holds options for creating a worktree
type CreateOptions struct {
	// ProjectPath is the path to the main git repository
	ProjectPath string
	// ProjectName is the name of the project (for organizing worktrees)
	ProjectName string
	// TaskID is the task identifier
	TaskID string
	// BaseBranch is the branch to create the worktree from (default: main)
	BaseBranch string
	// SymlinkPaths are files/dirs to symlink from the main repo
	SymlinkPaths []string
	// SetupScript is a command to run after worktree creation
	SetupScript string
}

// CreateResult holds the result of creating a worktree
type CreateResult struct {
	// WorktreePath is the full path to the created worktree
	WorktreePath string
	// BranchName is the name of the created branch
	BranchName string
}

// Create creates a new git worktree for a task
func (m *Manager) Create(opts CreateOptions) (*CreateResult, error) {
	if opts.BaseBranch == "" {
		opts.BaseBranch = "main"
	}

	branchName := fmt.Sprintf("task-%s", opts.TaskID)
	worktreePath := filepath.Join(m.config.BaseDir, opts.ProjectName, branchName)

	// Ensure worktree base directory exists
	if err := os.MkdirAll(filepath.Dir(worktreePath), 0755); err != nil {
		return nil, fmt.Errorf("create worktree directory: %w", err)
	}

	// Check if worktree already exists
	if _, err := os.Stat(worktreePath); err == nil {
		return nil, fmt.Errorf("worktree already exists at %s", worktreePath)
	}

	// Check if repository has any commits
	if !m.hasCommits(opts.ProjectPath) {
		return nil, fmt.Errorf("repository has no commits - please make an initial commit before creating worktrees")
	}

	// Verify the base branch exists
	if !m.branchExists(opts.ProjectPath, opts.BaseBranch) {
		return nil, fmt.Errorf("base branch '%s' does not exist - check project's default branch setting", opts.BaseBranch)
	}

	// Fetch latest from remote to ensure we have up-to-date refs
	if err := m.gitFetch(opts.ProjectPath); err != nil {
		// Non-fatal: continue even if fetch fails (might be offline)
		fmt.Fprintf(os.Stderr, "warning: git fetch failed: %v\n", err)
	}

	// Create the branch and worktree
	// First, try to create a new branch from the base
	if err := m.createBranchAndWorktree(opts.ProjectPath, worktreePath, branchName, opts.BaseBranch); err != nil {
		return nil, fmt.Errorf("create worktree: %w", err)
	}

	// Create symlinks for configured paths
	for _, symlinkPath := range opts.SymlinkPaths {
		srcPath := filepath.Join(opts.ProjectPath, symlinkPath)
		dstPath := filepath.Join(worktreePath, symlinkPath)

		if err := m.createSymlink(srcPath, dstPath); err != nil {
			// Log but don't fail - symlink target might not exist
			fmt.Fprintf(os.Stderr, "warning: failed to create symlink %s -> %s: %v\n", dstPath, srcPath, err)
		}
	}

	// Run setup script if provided
	if opts.SetupScript != "" {
		if err := m.runScript(worktreePath, opts.SetupScript); err != nil {
			// Log but don't fail - setup script failure shouldn't prevent worktree creation
			fmt.Fprintf(os.Stderr, "warning: setup script failed: %v\n", err)
		}
	}

	return &CreateResult{
		WorktreePath: worktreePath,
		BranchName:   branchName,
	}, nil
}

// Delete removes a worktree and optionally its branch
type DeleteOptions struct {
	// ProjectPath is the path to the main git repository
	ProjectPath string
	// WorktreePath is the path to the worktree to delete
	WorktreePath string
	// DeleteBranch also deletes the associated branch
	DeleteBranch bool
	// TeardownScript is a command to run before deletion
	TeardownScript string
}

// Delete removes a git worktree
func (m *Manager) Delete(opts DeleteOptions) error {
	// Run teardown script if provided
	if opts.TeardownScript != "" {
		if err := m.runScript(opts.WorktreePath, opts.TeardownScript); err != nil {
			fmt.Fprintf(os.Stderr, "warning: teardown script failed: %v\n", err)
		}
	}

	// Get the branch name before removing the worktree
	branchName := ""
	if opts.DeleteBranch {
		branchName = m.getWorktreeBranch(opts.WorktreePath)
	}

	// Remove the worktree using git
	cmd := exec.Command("git", "worktree", "remove", "--force", opts.WorktreePath)
	cmd.Dir = opts.ProjectPath
	if output, err := cmd.CombinedOutput(); err != nil {
		// If git worktree remove fails, try to remove the directory manually
		if rmErr := os.RemoveAll(opts.WorktreePath); rmErr != nil {
			return fmt.Errorf("remove worktree: git error: %s, manual remove error: %w", string(output), rmErr)
		}
		// Also prune stale worktrees
		pruneCmd := exec.Command("git", "worktree", "prune")
		pruneCmd.Dir = opts.ProjectPath
		pruneCmd.Run() // Ignore errors
	}

	// Delete the branch if requested
	if opts.DeleteBranch && branchName != "" {
		if err := m.deleteBranch(opts.ProjectPath, branchName); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to delete branch %s: %v\n", branchName, err)
		}
	}

	return nil
}

// Exists checks if a worktree exists at the given path
func (m *Manager) Exists(worktreePath string) bool {
	info, err := os.Stat(worktreePath)
	return err == nil && info.IsDir()
}

// GetWorktreePath returns the worktree path for a given project and task
func (m *Manager) GetWorktreePath(projectName, taskID string) string {
	branchName := fmt.Sprintf("task-%s", taskID)
	return filepath.Join(m.config.BaseDir, projectName, branchName)
}

// Internal helper methods

func (m *Manager) gitFetch(repoPath string) error {
	cmd := exec.Command("git", "fetch", "--prune")
	cmd.Dir = repoPath
	return cmd.Run()
}

func (m *Manager) hasCommits(repoPath string) bool {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	return cmd.Run() == nil
}

func (m *Manager) branchExists(repoPath, branchName string) bool {
	cmd := exec.Command("git", "rev-parse", "--verify", branchName)
	cmd.Dir = repoPath
	return cmd.Run() == nil
}

func (m *Manager) createBranchAndWorktree(repoPath, worktreePath, branchName, baseBranch string) error {
	// Check if branch already exists
	checkCmd := exec.Command("git", "rev-parse", "--verify", branchName)
	checkCmd.Dir = repoPath
	branchExists := checkCmd.Run() == nil

	if branchExists {
		// Branch exists, create worktree using existing branch
		cmd := exec.Command("git", "worktree", "add", worktreePath, branchName)
		cmd.Dir = repoPath
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("add worktree with existing branch: %s: %w", string(output), err)
		}
	} else {
		// Create new branch and worktree in one command
		cmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath, baseBranch)
		cmd.Dir = repoPath
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("add worktree with new branch: %s: %w", string(output), err)
		}
	}

	return nil
}

func (m *Manager) createSymlink(src, dst string) error {
	// Check if source exists
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return fmt.Errorf("source does not exist: %s", src)
	}

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("create parent directory: %w", err)
	}

	// Remove existing file/symlink at destination
	os.Remove(dst)

	// Create symlink
	if err := os.Symlink(src, dst); err != nil {
		return fmt.Errorf("create symlink: %w", err)
	}

	return nil
}

func (m *Manager) runScript(workDir, script string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", script)
	cmd.Dir = workDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

func (m *Manager) getWorktreeBranch(worktreePath string) string {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = worktreePath
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// DiffStats returns the number of additions and deletions in a worktree
// compared to the base branch. Returns 0,0 on error (non-fatal).
func (m *Manager) DiffStats(worktreePath, baseBranch string) (additions, deletions int, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "diff", "--shortstat", baseBranch+"...HEAD")
	cmd.Dir = worktreePath
	output, err := cmd.Output()
	if err != nil {
		return 0, 0, err
	}

	a, d := parseShortStat(string(output))
	return a, d, nil
}

// parseShortStat parses git diff --shortstat output like:
// " 3 files changed, 42 insertions(+), 15 deletions(-)"
func parseShortStat(s string) (additions, deletions int) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0
	}

	parts := strings.Split(s, ", ")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "insertion") {
			fmt.Sscanf(part, "%d", &additions)
		} else if strings.Contains(part, "deletion") {
			fmt.Sscanf(part, "%d", &deletions)
		}
	}
	return additions, deletions
}

func (m *Manager) deleteBranch(repoPath, branchName string) error {
	// Force delete the branch (it may have unmerged changes)
	cmd := exec.Command("git", "branch", "-D", branchName)
	cmd.Dir = repoPath
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("delete branch: %s: %w", string(output), err)
	}
	return nil
}
