package api

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsRemoteBranchMissingError(t *testing.T) {
	tests := []struct {
		name string
		msg  string
		want bool
	}{
		{
			name: "remote ref does not exist",
			msg:  "error: unable to delete 'feature': remote ref does not exist",
			want: true,
		},
		{
			name: "could not find remote ref",
			msg:  "fatal: couldn't find remote ref feature",
			want: true,
		},
		{
			name: "generic not found",
			msg:  "not found",
			want: true,
		},
		{
			name: "other git failure",
			msg:  "permission denied",
			want: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isRemoteBranchMissingError(tc.msg)
			if got != tc.want {
				t.Fatalf("isRemoteBranchMissingError()=%v want %v", got, tc.want)
			}
		})
	}
}

func TestDeleteMergedBranchDeletesLocalBranchWithoutRemote(t *testing.T) {
	repo := t.TempDir()
	runGitCmd(t, repo, "init")
	runGitCmd(t, repo, "config", "user.name", "Test User")
	runGitCmd(t, repo, "config", "user.email", "test@example.com")

	readme := filepath.Join(repo, "README.md")
	writeFile(t, readme, "base\n")
	runGitCmd(t, repo, "add", "README.md")
	runGitCmd(t, repo, "commit", "-m", "base")

	baseBranch := strings.TrimSpace(runGitCmd(t, repo, "symbolic-ref", "--short", "HEAD"))

	runGitCmd(t, repo, "checkout", "-b", "feature")
	writeFile(t, readme, "feature\n")
	runGitCmd(t, repo, "add", "README.md")
	runGitCmd(t, repo, "commit", "-m", "feature commit")

	runGitCmd(t, repo, "checkout", baseBranch)
	runGitCmd(t, repo, "merge", "--squash", "feature")
	runGitCmd(t, repo, "commit", "-m", "squash merge")

	if err := deleteMergedBranch(repo, "feature"); err != nil {
		t.Fatalf("deleteMergedBranch returned error: %v", err)
	}

	if _, err := runGit(repo, "rev-parse", "--verify", "feature"); err == nil {
		t.Fatalf("expected local branch feature to be deleted")
	}
}

func TestDeleteMergedBranchFailsWhenBranchCheckedOut(t *testing.T) {
	repo := t.TempDir()
	runGitCmd(t, repo, "init")
	runGitCmd(t, repo, "config", "user.name", "Test User")
	runGitCmd(t, repo, "config", "user.email", "test@example.com")

	readme := filepath.Join(repo, "README.md")
	writeFile(t, readme, "base\n")
	runGitCmd(t, repo, "add", "README.md")
	runGitCmd(t, repo, "commit", "-m", "base")

	runGitCmd(t, repo, "checkout", "-b", "feature")

	err := deleteMergedBranch(repo, "feature")
	if err == nil {
		t.Fatalf("expected error when deleting checked-out branch")
	}
	if !strings.Contains(err.Error(), "delete local branch") {
		t.Fatalf("expected local branch deletion error, got: %v", err)
	}
}

func runGitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write file %s: %v", path, err)
	}
}
