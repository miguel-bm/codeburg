package worktree

import (
	"regexp"
	"strings"
)

var nonAlphanumeric = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify converts a title into a git-safe branch name.
// Lowercase, replaces non-alphanumeric runs with hyphens, trims, truncates to 50 chars.
func Slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlphanumeric.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 50 {
		s = s[:50]
		s = strings.TrimRight(s, "-")
	}
	if s == "" {
		return "task"
	}
	return s
}

// shortID returns the last 6 characters of a ULID for use as a collision suffix.
func shortID(taskID string) string {
	if len(taskID) <= 6 {
		return taskID
	}
	return taskID[len(taskID)-6:]
}
