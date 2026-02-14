package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// --- Helpers ---

// createTestGitRepo creates a temp git repo with an initial commit and explicit "main" branch.
func createTestGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	gitExec(t, dir, "init")
	gitExec(t, dir, "config", "user.email", "test@test.com")
	gitExec(t, dir, "config", "user.name", "Test")

	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Test"), 0644); err != nil {
		t.Fatal(err)
	}
	gitExec(t, dir, "add", ".")
	gitExec(t, dir, "commit", "-m", "init")
	gitExec(t, dir, "branch", "-M", "main")

	return dir
}

func gitExec(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %s: %v", args, out, err)
	}
}

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	return NewManager(Config{BaseDir: t.TempDir()})
}

// --- parseShortStat ---

func TestParseShortStat(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantAdd    int
		wantDelete int
	}{
		{"empty", "", 0, 0},
		{"whitespace only", "   ", 0, 0},
		{"insertions only", " 1 file changed, 10 insertions(+)", 10, 0},
		{"deletions only", " 1 file changed, 5 deletions(-)", 0, 5},
		{"both", " 3 files changed, 42 insertions(+), 15 deletions(-)", 42, 15},
		{"single file singular", " 1 file changed, 1 insertion(+), 1 deletion(-)", 1, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, d := parseShortStat(tt.input)
			if a != tt.wantAdd {
				t.Errorf("additions: got %d, want %d", a, tt.wantAdd)
			}
			if d != tt.wantDelete {
				t.Errorf("deletions: got %d, want %d", d, tt.wantDelete)
			}
		})
	}
}

// --- GetWorktreePath ---

func TestGetWorktreePath(t *testing.T) {
	m := NewManager(Config{BaseDir: "/base"})
	got := m.GetWorktreePath("myproject", "abc123")
	want := "/base/myproject/task-abc123"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// --- Exists ---

func TestExists(t *testing.T) {
	m := newTestManager(t)
	dir := t.TempDir()

	if !m.Exists(dir) {
		t.Error("expected Exists=true for existing directory")
	}
	if m.Exists(filepath.Join(dir, "nope")) {
		t.Error("expected Exists=false for missing directory")
	}
}

// --- Create ---

func TestCreate_Basic(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK001",
		TaskTitle:   "My New Feature",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Worktree directory should exist
	if _, err := os.Stat(result.WorktreePath); os.IsNotExist(err) {
		t.Fatal("worktree directory does not exist")
	}

	// Branch name should be slugified title
	if result.BranchName != "my-new-feature" {
		t.Errorf("branch = %q, want %q", result.BranchName, "my-new-feature")
	}

	// HEAD in worktree should resolve
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = result.WorktreePath
	if err := cmd.Run(); err != nil {
		t.Errorf("HEAD not valid in worktree: %v", err)
	}
}

func TestCreate_ExplicitBranchName(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK002",
		BranchName:  "custom-branch",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.BranchName != "custom-branch" {
		t.Errorf("branch = %q, want %q", result.BranchName, "custom-branch")
	}
}

func TestCreate_SlashBranchName_UsesFlatWorktreeDir(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK002A",
		BranchName:  "foo/bar",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.BranchName != "foo/bar" {
		t.Fatalf("branch = %q, want %q", result.BranchName, "foo/bar")
	}
	if filepath.Dir(result.WorktreePath) != filepath.Join(m.config.BaseDir, "proj") {
		t.Fatalf("worktree path should be one level under project dir, got %q", result.WorktreePath)
	}
	if !strings.Contains(filepath.Base(result.WorktreePath), "%2F") {
		t.Fatalf("worktree dir should encode slash in branch name, got %q", filepath.Base(result.WorktreePath))
	}
}

func TestCreate_NoFalseCollisionAfterSlashBranchDelete(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	first, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK002B",
		BranchName:  "foo/bar",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := m.Delete(DeleteOptions{
		ProjectPath:  repo,
		WorktreePath: first.WorktreePath,
		DeleteBranch: true,
	}); err != nil {
		t.Fatal(err)
	}

	second, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK002C",
		BranchName:  "foo",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.BranchName != "foo" {
		t.Fatalf("branch should not be suffixed by false dir collision: got %q", second.BranchName)
	}
}

func TestCreate_BranchCollision(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	// Create a branch that will collide
	gitExec(t, repo, "branch", "my-feature")

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "01ABCDEFGHIJKLMNOP", // shortID = "LMNOP" (last 6)
		BranchName:  "my-feature",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Should have suffix appended
	want := "my-feature-KLMNOP"
	if result.BranchName != want {
		t.Errorf("branch = %q, want %q", result.BranchName, want)
	}
}

func TestCreate_NoCommits(t *testing.T) {
	m := newTestManager(t)
	dir := t.TempDir()

	gitExec(t, dir, "init")

	_, err := m.Create(CreateOptions{
		ProjectPath: dir,
		ProjectName: "proj",
		TaskID:      "TASK003",
		TaskTitle:   "something",
		BaseBranch:  "main",
	})
	if err == nil {
		t.Fatal("expected error for repo with no commits")
	}
	if got := err.Error(); got != "repository has no commits - please make an initial commit before creating worktrees" {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestCreate_InvalidBaseBranch(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	_, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK004",
		TaskTitle:   "something",
		BaseBranch:  "nonexistent",
	})
	if err == nil {
		t.Fatal("expected error for nonexistent base branch")
	}
	want := "base branch 'nonexistent' does not exist"
	if got := err.Error(); got != want+" - check project's default branch setting" {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestCreate_DefaultBaseBranch(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	// Leave BaseBranch empty — should default to "main"
	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK005",
		TaskTitle:   "default base",
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(result.WorktreePath); os.IsNotExist(err) {
		t.Fatal("worktree not created with default base branch")
	}
}

func TestCreate_RemoteBaseDoesNotInheritUpstreamTracking(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)
	remote := t.TempDir()

	gitExec(t, remote, "init", "--bare")
	gitExec(t, repo, "remote", "add", "origin", remote)
	gitExec(t, repo, "push", "-u", "origin", "main")
	gitExec(t, repo, "config", "branch.autoSetupMerge", "always")

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK009",
		BranchName:  "task-no-upstream-inherit",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	// New task branch should not implicitly track origin/main.
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	cmd.Dir = result.WorktreePath
	if out, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("expected no upstream branch, got %q", string(out))
	}
}

func TestCreate_WithSymlinks(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	// Create a .env file in the main repo
	envContent := "SECRET=abc"
	if err := os.WriteFile(filepath.Join(repo, ".env"), []byte(envContent), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := m.Create(CreateOptions{
		ProjectPath:  repo,
		ProjectName:  "proj",
		TaskID:       "TASK006",
		TaskTitle:    "symlink test",
		BaseBranch:   "main",
		SymlinkPaths: []string{".env"},
	})
	if err != nil {
		t.Fatal(err)
	}

	// .env in worktree should be a symlink
	linkPath := filepath.Join(result.WorktreePath, ".env")
	target, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("expected symlink at %s: %v", linkPath, err)
	}
	if target != filepath.Join(repo, ".env") {
		t.Errorf("symlink target = %q, want %q", target, filepath.Join(repo, ".env"))
	}

	// Should be readable and have correct content
	data, err := os.ReadFile(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != envContent {
		t.Errorf("symlink content = %q, want %q", string(data), envContent)
	}
}

func TestCreate_SymlinkMissing(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	// Request symlink for a file that doesn't exist — should not fail
	result, err := m.Create(CreateOptions{
		ProjectPath:  repo,
		ProjectName:  "proj",
		TaskID:       "TASK007",
		TaskTitle:    "missing symlink",
		BaseBranch:   "main",
		SymlinkPaths: []string{".env.missing"},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	// Worktree should still be created
	if _, err := os.Stat(result.WorktreePath); os.IsNotExist(err) {
		t.Fatal("worktree should exist despite missing symlink source")
	}
}

func TestCreate_WithSetupScript(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK008",
		TaskTitle:   "setup script",
		BaseBranch:  "main",
		SetupScript: "touch setup-ran",
	})
	if err != nil {
		t.Fatal(err)
	}

	markerPath := filepath.Join(result.WorktreePath, "setup-ran")
	if _, err := os.Stat(markerPath); os.IsNotExist(err) {
		t.Fatal("setup script did not run: marker file missing")
	}
}

// --- Delete ---

func TestDelete_Basic(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK010",
		TaskTitle:   "to delete",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	err = m.Delete(DeleteOptions{
		ProjectPath:  repo,
		WorktreePath: result.WorktreePath,
		DeleteBranch: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Worktree directory should be gone
	if _, err := os.Stat(result.WorktreePath); !os.IsNotExist(err) {
		t.Error("worktree directory should not exist after delete")
	}

	// Branch should be deleted
	cmd := exec.Command("git", "rev-parse", "--verify", result.BranchName)
	cmd.Dir = repo
	if cmd.Run() == nil {
		t.Error("branch should not exist after delete with DeleteBranch=true")
	}
}

func TestDelete_KeepBranch(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK011",
		TaskTitle:   "keep branch",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	err = m.Delete(DeleteOptions{
		ProjectPath:  repo,
		WorktreePath: result.WorktreePath,
		DeleteBranch: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Directory gone
	if _, err := os.Stat(result.WorktreePath); !os.IsNotExist(err) {
		t.Error("worktree directory should not exist after delete")
	}

	// Branch should still exist
	cmd := exec.Command("git", "rev-parse", "--verify", result.BranchName)
	cmd.Dir = repo
	if cmd.Run() != nil {
		t.Error("branch should still exist when DeleteBranch=false")
	}
}

func TestDelete_WithTeardownScript(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)
	externalDir := t.TempDir()

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK012",
		TaskTitle:   "teardown",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	markerPath := filepath.Join(externalDir, "teardown-ran")
	err = m.Delete(DeleteOptions{
		ProjectPath:    repo,
		WorktreePath:   result.WorktreePath,
		DeleteBranch:   true,
		TeardownScript: "touch " + markerPath,
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(markerPath); os.IsNotExist(err) {
		t.Fatal("teardown script did not run: marker file missing")
	}
}

// --- DiffStats ---

func TestDiffStats_NoChanges(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK020",
		TaskTitle:   "no changes",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	adds, dels, err := m.DiffStats(result.WorktreePath, "main")
	if err != nil {
		t.Fatal(err)
	}
	if adds != 0 || dels != 0 {
		t.Errorf("expected 0,0 got %d,%d", adds, dels)
	}
}

func TestDiffStats_WithChanges(t *testing.T) {
	m := newTestManager(t)
	repo := createTestGitRepo(t)

	result, err := m.Create(CreateOptions{
		ProjectPath: repo,
		ProjectName: "proj",
		TaskID:      "TASK021",
		TaskTitle:   "with changes",
		BaseBranch:  "main",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Modify the README in the worktree
	readme := filepath.Join(result.WorktreePath, "README.md")
	if err := os.WriteFile(readme, []byte("# Modified\nNew line\n"), 0644); err != nil {
		t.Fatal(err)
	}

	adds, dels, err := m.DiffStats(result.WorktreePath, "main")
	if err != nil {
		t.Fatal(err)
	}
	if adds == 0 && dels == 0 {
		t.Error("expected non-zero additions or deletions after modifying a file")
	}
}
