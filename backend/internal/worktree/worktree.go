package worktree

import (
	"context"
	"fmt"
	"io"
	"log/slog"
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
	// ProjectID is the stable project identifier used for managed secret files
	ProjectID string
	// ProjectName is the name of the project (for organizing worktrees)
	ProjectName string
	// TaskID is the task identifier
	TaskID string
	// BranchName is an explicit branch name (set by user). If empty, auto-generated from TaskTitle.
	BranchName string
	// TaskTitle is used to generate a slugified branch name when BranchName is empty.
	TaskTitle string
	// BaseBranch is the branch to create the worktree from (default: main)
	BaseBranch string
	// AdoptBranch indicates BranchName refers to a pre-existing branch to adopt
	// rather than a new branch to create from BaseBranch.
	AdoptBranch bool
	// SymlinkPaths are files/dirs to symlink from the main repo
	SymlinkPaths []string
	// SetupScript is a command to run after worktree creation
	SetupScript string
	// SecretFiles are secret file mappings to materialize into the worktree
	SecretFiles []SecretFile
}

// CreateResult holds the result of creating a worktree
type CreateResult struct {
	// WorktreePath is the full path to the created worktree
	WorktreePath string
	// BranchName is the name of the created branch
	BranchName string
	// Warnings contains non-fatal issues encountered during creation
	// (e.g. failed to fetch or fast-forward base branch)
	Warnings []string
}

// SecretFile defines how a secret file should be materialized in a worktree.
type SecretFile struct {
	Path       string
	Mode       string // "copy" | "symlink"
	SourcePath string
	Enabled    bool
}

// Create creates a new git worktree for a task
func (m *Manager) Create(opts CreateOptions) (*CreateResult, error) {
	if opts.BaseBranch == "" {
		opts.BaseBranch = "main"
	}

	branchName := opts.BranchName
	if branchName == "" {
		branchName = Slugify(opts.TaskTitle)
	}

	// Check for collision — if branch or worktree dir already exists, append short ID.
	// Skip this when adopting an existing branch (we *want* it to exist).
	dirName := branchName
	worktreePath := filepath.Join(m.config.BaseDir, opts.ProjectName, dirName)
	if !opts.AdoptBranch {
		if m.branchExists(opts.ProjectPath, branchName) || dirExists(worktreePath) {
			suffix := shortID(opts.TaskID)
			branchName = branchName + "-" + suffix
			dirName = branchName
			worktreePath = filepath.Join(m.config.BaseDir, opts.ProjectName, dirName)
		}
	}

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

	var warnings []string

	// Fetch latest from remote to ensure we have up-to-date refs
	fetchFailed := false
	if err := m.gitFetch(opts.ProjectPath); err != nil {
		fetchFailed = true
		warnings = append(warnings, fmt.Sprintf("could not fetch from remote: %v — worktree may be based on stale %s", err, opts.BaseBranch))
	}

	// Fast-forward the base branch to match origin (so new worktrees start fresh)
	if !fetchFailed {
		if err := m.fastForwardBase(opts.ProjectPath, opts.BaseBranch); err != nil {
			warnings = append(warnings, fmt.Sprintf("could not fast-forward %s to match origin: %v — worktree may be based on stale %s", opts.BaseBranch, err, opts.BaseBranch))
		}
	}

	// When adopting a pre-existing branch, ensure it exists locally.
	// If it only exists on the remote, create a local tracking branch.
	if opts.AdoptBranch {
		if !m.branchExists(opts.ProjectPath, branchName) {
			remote := "origin/" + branchName
			if m.branchExists(opts.ProjectPath, remote) {
				cmd := exec.Command("git", "branch", branchName, remote)
				cmd.Dir = opts.ProjectPath
				if output, err := cmd.CombinedOutput(); err != nil {
					return nil, fmt.Errorf("create local tracking branch: %s: %w", strings.TrimSpace(string(output)), err)
				}
			} else {
				return nil, fmt.Errorf("branch '%s' does not exist locally or on remote", branchName)
			}
		}
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
			slog.Warn("failed to create symlink", "dst", dstPath, "src", srcPath, "error", err)
		}
	}

	// Materialize configured secret files (copy/symlink).
	for _, sf := range opts.SecretFiles {
		if !sf.Enabled {
			continue
		}

		relPath, err := cleanRelativePath(sf.Path)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("invalid secret path %q: %v", sf.Path, err))
			continue
		}

		mode := sf.Mode
		if mode == "" {
			mode = "copy"
		}
		if mode != "copy" && mode != "symlink" {
			warnings = append(warnings, fmt.Sprintf("invalid secret mode %q for %s", sf.Mode, relPath))
			continue
		}

		sourcePath, _, err := m.ResolveSecretSource(opts.ProjectPath, opts.ProjectID, SecretFile{
			Path:       relPath,
			Mode:       mode,
			SourcePath: sf.SourcePath,
			Enabled:    true,
		})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("failed to resolve source for %s: %v", relPath, err))
			continue
		}

		dstPath := filepath.Join(worktreePath, relPath)
		if sourcePath == "" {
			if err := writeEmptyFile(dstPath); err != nil {
				warnings = append(warnings, fmt.Sprintf("failed to create empty %s: %v", relPath, err))
			} else {
				warnings = append(warnings, fmt.Sprintf("no source found for %s; created empty file", relPath))
			}
			continue
		}

		if mode == "symlink" {
			if err := m.createSymlink(sourcePath, dstPath); err != nil {
				warnings = append(warnings, fmt.Sprintf("failed to symlink %s: %v", relPath, err))
			}
			continue
		}

		if err := copyFile(sourcePath, dstPath); err != nil {
			warnings = append(warnings, fmt.Sprintf("failed to copy %s: %v", relPath, err))
		}
	}

	// Run setup script if provided
	if opts.SetupScript != "" {
		if err := m.runScript(worktreePath, opts.SetupScript); err != nil {
			slog.Warn("setup script failed", "worktree", worktreePath, "error", err)
		}
	}

	return &CreateResult{
		WorktreePath: worktreePath,
		BranchName:   branchName,
		Warnings:     warnings,
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
			slog.Warn("teardown script failed", "worktree", opts.WorktreePath, "error", err)
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
			slog.Warn("failed to delete branch", "branch", branchName, "error", err)
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

// fastForwardBase updates the local base branch to match origin without checkout.
// Uses git merge --ff-only so it's safe — it will fail (harmlessly) if the local
// branch has diverged rather than silently losing commits.
func (m *Manager) fastForwardBase(repoPath, baseBranch string) error {
	remote := "origin/" + baseBranch
	// Check that the remote tracking branch exists
	check := exec.Command("git", "rev-parse", "--verify", remote)
	check.Dir = repoPath
	if check.Run() != nil {
		return nil // no remote tracking branch, nothing to do
	}
	// Use git fetch . to update the local ref without needing checkout.
	// "git fetch . origin/main:main" updates local main to match origin/main, ff-only.
	cmd := exec.Command("git", "fetch", ".", fmt.Sprintf("%s:%s", remote, baseBranch))
	cmd.Dir = repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
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
// compared to the base branch, including uncommitted and staged changes.
// Returns 0,0 on error (non-fatal).
func (m *Manager) DiffStats(worktreePath, baseBranch string) (additions, deletions int, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Find merge base between base branch and HEAD
	mergeBaseCmd := exec.CommandContext(ctx, "git", "merge-base", baseBranch, "HEAD")
	mergeBaseCmd.Dir = worktreePath
	mergeBaseOutput, err := mergeBaseCmd.Output()
	if err != nil {
		return 0, 0, err
	}
	mergeBase := strings.TrimSpace(string(mergeBaseOutput))

	// Diff working tree (including uncommitted changes) against merge base
	cmd := exec.CommandContext(ctx, "git", "diff", "--shortstat", mergeBase)
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

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
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

// ManagedSecretPath returns ~/.codeburg/projects/{projectID}/secrets/{relPath}.
func (m *Manager) ManagedSecretPath(projectID, relPath string) (string, error) {
	if projectID == "" {
		return "", fmt.Errorf("project id is required")
	}
	cleanRel, err := cleanRelativePath(relPath)
	if err != nil {
		return "", err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, ".codeburg", "projects", projectID, "secrets", cleanRel), nil
}

// ResolveSecretSource finds the best available source path for a configured secret.
// Returns (sourcePath, sourceKind, nil). sourcePath is empty when no source is found.
func (m *Manager) ResolveSecretSource(projectPath, projectID string, sf SecretFile) (string, string, error) {
	relPath, err := cleanRelativePath(sf.Path)
	if err != nil {
		return "", "", err
	}

	// 1. Managed source file.
	if projectID != "" {
		managedPath, err := m.ManagedSecretPath(projectID, relPath)
		if err == nil && fileExists(managedPath) {
			return managedPath, "managed", nil
		}
	}

	// 2. Explicit sourcePath in project root.
	if strings.TrimSpace(sf.SourcePath) != "" {
		sourceRel, err := cleanRelativePath(sf.SourcePath)
		if err != nil {
			return "", "", fmt.Errorf("invalid sourcePath for %s: %w", relPath, err)
		}
		source := filepath.Join(projectPath, sourceRel)
		if fileExists(source) {
			return source, "sourcePath", nil
		}
	}

	// 3. Exact destination path in project root.
	exact := filepath.Join(projectPath, relPath)
	if fileExists(exact) {
		return exact, "projectPath", nil
	}

	// 4. Heuristics.
	for _, candidate := range secretHeuristicCandidates(relPath) {
		source := filepath.Join(projectPath, candidate)
		if fileExists(source) {
			return source, "heuristic", nil
		}
	}

	return "", "", nil
}

func cleanRelativePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("path is required")
	}
	if filepath.IsAbs(p) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}
	clean := filepath.Clean(p)
	if clean == "." || clean == "" {
		return "", fmt.Errorf("path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path traversal is not allowed")
	}
	return clean, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func secretHeuristicCandidates(relPath string) []string {
	candidates := []string{
		relPath + ".local",
		relPath + ".development.local",
		relPath + ".dev",
		relPath + ".example",
		relPath + ".sample",
		".env.local",
		".dev.vars",
	}
	seen := make(map[string]struct{}, len(candidates))
	out := make([]string, 0, len(candidates))
	for _, c := range candidates {
		clean, err := cleanRelativePath(c)
		if err != nil {
			continue
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out
}

func writeEmptyFile(dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("create parent directory: %w", err)
	}
	if info, err := os.Lstat(dst); err == nil {
		if info.IsDir() {
			if err := os.RemoveAll(dst); err != nil {
				return fmt.Errorf("remove existing directory: %w", err)
			}
		} else if err := os.Remove(dst); err != nil {
			return fmt.Errorf("remove existing file: %w", err)
		}
	}
	return os.WriteFile(dst, []byte{}, 0600)
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("create parent directory: %w", err)
	}
	if info, err := os.Lstat(dst); err == nil {
		if info.IsDir() {
			if err := os.RemoveAll(dst); err != nil {
				return fmt.Errorf("remove existing directory: %w", err)
			}
		} else if err := os.Remove(dst); err != nil {
			return fmt.Errorf("remove existing file: %w", err)
		}
	}

	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("open destination: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
}
