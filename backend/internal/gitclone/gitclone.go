package gitclone

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Config holds configuration for git clone operations.
type Config struct {
	// BaseDir is the base directory for cloned repos (default: ~/.codeburg/repos)
	BaseDir string
}

// DefaultConfig returns the default clone configuration.
func DefaultConfig() Config {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return Config{
		BaseDir: filepath.Join(home, ".codeburg", "repos"),
	}
}

// CloneResult holds the result of a successful clone.
type CloneResult struct {
	Path          string
	DefaultBranch string
}

// IsGitHubURL returns true if s looks like a GitHub URL.
func IsGitHubURL(s string) bool {
	s = strings.TrimSpace(s)
	return strings.HasPrefix(s, "https://github.com/") ||
		strings.HasPrefix(s, "http://github.com/") ||
		strings.HasPrefix(s, "git@github.com:")
}

// ParseRepoName extracts the repository name from a GitHub URL.
// e.g. "https://github.com/user/repo.git" -> "repo"
func ParseRepoName(url string) string {
	url = strings.TrimSpace(url)
	url = strings.TrimSuffix(url, "/")
	url = strings.TrimSuffix(url, ".git")

	// Handle git@github.com:user/repo
	if strings.HasPrefix(url, "git@github.com:") {
		url = strings.TrimPrefix(url, "git@github.com:")
	}

	parts := strings.Split(url, "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

// NormalizeGitHubURL ensures a GitHub HTTPS URL has the .git suffix.
func NormalizeGitHubURL(url string) string {
	url = strings.TrimSpace(url)
	url = strings.TrimSuffix(url, "/")
	if !strings.HasSuffix(url, ".git") {
		url += ".git"
	}
	return url
}

// Clone clones a GitHub repository into cfg.BaseDir/name.
func Clone(cfg Config, url, name string) (*CloneResult, error) {
	dest := filepath.Join(cfg.BaseDir, name)

	// Ensure base directory exists
	if err := os.MkdirAll(cfg.BaseDir, 0755); err != nil {
		return nil, fmt.Errorf("create base dir: %w", err)
	}

	// Check destination doesn't already exist
	if _, err := os.Stat(dest); err == nil {
		return nil, fmt.Errorf("destination already exists: %s", dest)
	}

	normalized := NormalizeGitHubURL(url)

	cmd := exec.Command("git", "clone", normalized, dest)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git clone: %w", err)
	}

	branch := detectDefaultBranch(dest)

	return &CloneResult{
		Path:          dest,
		DefaultBranch: branch,
	}, nil
}

// detectDefaultBranch figures out the default branch of a cloned repo.
func detectDefaultBranch(repoPath string) string {
	// Try symbolic-ref for origin HEAD
	cmd := exec.Command("git", "-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD")
	out, err := cmd.Output()
	if err == nil {
		ref := strings.TrimSpace(string(out))
		// refs/remotes/origin/main -> main
		parts := strings.Split(ref, "/")
		if len(parts) > 0 {
			return parts[len(parts)-1]
		}
	}

	// Fallback: check if main or master branch exists
	for _, branch := range []string{"main", "master"} {
		cmd := exec.Command("git", "-C", repoPath, "rev-parse", "--verify", branch)
		if cmd.Run() == nil {
			return branch
		}
	}

	return "main"
}
