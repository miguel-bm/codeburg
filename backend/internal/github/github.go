package github

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Available returns true if the gh CLI is installed and authenticated.
func Available() bool {
	cmd := exec.Command("gh", "auth", "status")
	return cmd.Run() == nil
}

// IsMainProtected checks if a branch has protection rules.
// Returns true if the branch is protected, false otherwise (including on any error).
func IsMainProtected(ownerRepo, branch string) bool {
	cmd := exec.Command("gh", "api",
		fmt.Sprintf("repos/%s/branches/%s/protection", ownerRepo, branch),
		"--silent",
	)
	return cmd.Run() == nil
}

// PushBranch pushes a branch to origin with tracking.
func PushBranch(workDir, branch string) error {
	cmd := exec.Command("git", "push", "-u", "origin", branch)
	cmd.Dir = workDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git push: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}

// CreatePR creates a pull request and returns the PR URL.
func CreatePR(workDir, title, body, baseBranch, headBranch string) (string, error) {
	args := []string{"pr", "create",
		"--title", title,
		"--body", body,
		"--base", baseBranch,
		"--head", headBranch,
	}
	cmd := exec.Command("gh", args...)
	cmd.Dir = workDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("gh pr create: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return strings.TrimSpace(string(output)), nil
}

// CreateRepoInput holds parameters for creating a new GitHub repo.
type CreateRepoInput struct {
	Name        string
	Description string
	Private     bool
	CloneDir    string // parent directory (e.g. ~/.codeburg/repos/)
}

// CreateRepoResult holds the result of a successful repo creation.
type CreateRepoResult struct {
	Path          string
	HTTPSURL      string
	DefaultBranch string
}

// CreateRepo creates a new GitHub repository, clones it locally, and makes an initial commit.
func CreateRepo(input CreateRepoInput) (*CreateRepoResult, error) {
	if !Available() {
		return nil, fmt.Errorf("gh CLI is not authenticated — run 'gh auth login' first")
	}

	// Ensure clone directory exists
	if err := os.MkdirAll(input.CloneDir, 0755); err != nil {
		return nil, fmt.Errorf("create clone dir: %w", err)
	}

	// Check destination doesn't already exist
	dest := input.CloneDir + "/" + input.Name
	if _, err := os.Stat(dest); err == nil {
		return nil, fmt.Errorf("destination already exists: %s", dest)
	}

	// Build gh repo create args
	args := []string{"repo", "create", input.Name, "--clone"}
	if input.Private {
		args = append(args, "--private")
	} else {
		args = append(args, "--public")
	}
	if input.Description != "" {
		args = append(args, "--description", input.Description)
	}

	cmd := exec.Command("gh", args...)
	cmd.Dir = input.CloneDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("gh repo create: %s: %w", strings.TrimSpace(string(output)), err)
	}

	// Make an initial commit so worktrees work immediately
	initCmd := exec.Command("git", "commit", "--allow-empty", "-m", "Initial commit")
	initCmd.Dir = dest
	if out, err := initCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("initial commit: %s: %w", strings.TrimSpace(string(out)), err)
	}

	// Push the initial commit
	pushCmd := exec.Command("git", "push", "-u", "origin", "HEAD")
	pushCmd.Dir = dest
	if out, err := pushCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("initial push: %s: %w", strings.TrimSpace(string(out)), err)
	}

	// Detect default branch
	branch := detectBranch(dest)

	// Get remote URL
	remoteURL := getRemoteURL(dest)

	return &CreateRepoResult{
		Path:          dest,
		HTTPSURL:      remoteURL,
		DefaultBranch: branch,
	}, nil
}

// detectBranch returns the current branch name of a repo.
func detectBranch(repoPath string) string {
	cmd := exec.Command("git", "-C", repoPath, "symbolic-ref", "--short", "HEAD")
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return "main"
}

// getRemoteURL returns the origin remote URL for a repo.
func getRemoteURL(repoPath string) string {
	cmd := exec.Command("git", "-C", repoPath, "remote", "get-url", "origin")
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}

// MergePR merges a pull request.
// strategy should be "squash", "merge", or "rebase".
func MergePR(workDir, prURL, strategy string, deleteBranch bool) error {
	args := []string{"pr", "merge", prURL}
	switch strategy {
	case "rebase":
		args = append(args, "--rebase")
	case "merge":
		args = append(args, "--merge")
	default:
		args = append(args, "--squash")
	}
	if deleteBranch {
		args = append(args, "--delete-branch")
	}
	cmd := exec.Command("gh", args...)
	cmd.Dir = workDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if isAlreadyMergedPRFailure(trimmed) {
			return nil
		}
		// If merge succeeded but local branch deletion failed because a worktree
		// currently uses that branch, keep the workflow moving.
		if deleteBranch && isWorktreeDeleteBranchFailure(trimmed) {
			return nil
		}
		return fmt.Errorf("gh pr merge: %s: %w", trimmed, err)
	}
	return nil
}

func isWorktreeDeleteBranchFailure(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "failed to delete local branch") &&
		strings.Contains(lower, "cannot delete branch") &&
		strings.Contains(lower, "used by worktree")
}

func isAlreadyMergedPRFailure(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "pull request") &&
		(strings.Contains(lower, "already merged") || strings.Contains(lower, "was merged"))
}
