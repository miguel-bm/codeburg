package github

import (
	"fmt"
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
		return fmt.Errorf("gh pr merge: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}
