package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

// --- Helpers ---

// createTestGitRepoWithMain creates a temp git repo with explicit "main" branch.
func createTestGitRepoWithMain(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	gitExecHelper(t, dir, "init")
	gitExecHelper(t, dir, "config", "user.email", "test@test.com")
	gitExecHelper(t, dir, "config", "user.name", "Test")

	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Test\n"), 0644); err != nil {
		t.Fatal(err)
	}
	gitExecHelper(t, dir, "add", ".")
	gitExecHelper(t, dir, "commit", "-m", "init")
	gitExecHelper(t, dir, "branch", "-M", "main")

	return dir
}

func gitExecHelper(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %s: %v", args, out, err)
	}
}

// createTaskWithWorktree creates a project + task via API, then sets WorktreePath
// directly in the DB to point at a real git repo. Returns the task ID and repo path.
func createTaskWithWorktree(t *testing.T, env *testEnv) (string, string) {
	t.Helper()

	repoPath := createTestGitRepoWithMain(t)

	projResp := env.post("/api/projects", map[string]string{
		"name": "git-test-proj",
		"path": repoPath,
	})
	if projResp.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", projResp.Code, projResp.Body.String())
	}
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Git Test Task",
	})
	if taskResp.Code != http.StatusCreated {
		t.Fatalf("create task: %d %s", taskResp.Code, taskResp.Body.String())
	}
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Set worktree path directly in DB
	env.server.db.UpdateTask(task.ID, db.UpdateTaskInput{
		WorktreePath: &repoPath,
	})

	return task.ID, repoPath
}

// --- Pure parsing tests (table-driven, no HTTP) ---

func TestParseGitStatus(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantBranch  string
		wantStaged  int
		wantUnstg   int
		wantUntrack int
	}{
		{
			name:       "branch header only",
			input:      "## main...origin/main\n",
			wantBranch: "main",
		},
		{
			name:        "staged and unstaged",
			input:       "## main\nM  staged.go\n M unstaged.go\n",
			wantBranch:  "main",
			wantStaged:  1,
			wantUnstg:   1,
			wantUntrack: 0,
		},
		{
			name:        "untracked files",
			input:       "## main\n?? newfile.txt\n?? another.txt\n",
			wantBranch:  "main",
			wantUntrack: 2,
		},
		{
			name:       "rename",
			input:      "## main\nR  old.go -> new.go\n",
			wantBranch: "main",
			wantStaged: 1,
		},
		{
			name:        "mixed",
			input:       "## feat...origin/feat\nMM both.go\nA  added.go\n D deleted.go\n?? untracked.go\n",
			wantBranch:  "feat",
			wantStaged:  2, // MM (staged M) + A
			wantUnstg:   2, // MM (unstaged M) + D
			wantUntrack: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := parseGitStatus(tt.input)
			if resp.Branch != tt.wantBranch {
				t.Errorf("branch: got %q, want %q", resp.Branch, tt.wantBranch)
			}
			if len(resp.Staged) != tt.wantStaged {
				t.Errorf("staged: got %d, want %d", len(resp.Staged), tt.wantStaged)
			}
			if len(resp.Unstaged) != tt.wantUnstg {
				t.Errorf("unstaged: got %d, want %d", len(resp.Unstaged), tt.wantUnstg)
			}
			if len(resp.Untracked) != tt.wantUntrack {
				t.Errorf("untracked: got %d, want %d", len(resp.Untracked), tt.wantUntrack)
			}
		})
	}
}

func TestParseBranchLine(t *testing.T) {
	tests := []struct {
		name       string
		line       string
		wantBranch string
		wantAhead  int
		wantBehind int
	}{
		{
			name:       "simple",
			line:       "## main",
			wantBranch: "main",
		},
		{
			name:       "with tracking",
			line:       "## main...origin/main",
			wantBranch: "main",
		},
		{
			name:       "ahead",
			line:       "## feat...origin/feat [ahead 3]",
			wantBranch: "feat",
			wantAhead:  3,
		},
		{
			name:       "behind",
			line:       "## feat...origin/feat [behind 2]",
			wantBranch: "feat",
			wantBehind: 2,
		},
		{
			name:       "ahead and behind",
			line:       "## dev...origin/dev [ahead 5, behind 3]",
			wantBranch: "dev",
			wantAhead:  5,
			wantBehind: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var resp GitStatusResponse
			parseBranchLine(tt.line, &resp)
			if resp.Branch != tt.wantBranch {
				t.Errorf("branch: got %q, want %q", resp.Branch, tt.wantBranch)
			}
			if resp.Ahead != tt.wantAhead {
				t.Errorf("ahead: got %d, want %d", resp.Ahead, tt.wantAhead)
			}
			if resp.Behind != tt.wantBehind {
				t.Errorf("behind: got %d, want %d", resp.Behind, tt.wantBehind)
			}
		})
	}
}

func TestParseNumstat(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantKeys []string
		wantAdd  map[string]int
		wantDel  map[string]int
	}{
		{
			name:     "single file",
			input:    "10\t2\tmain.go\n",
			wantKeys: []string{"main.go"},
			wantAdd:  map[string]int{"main.go": 10},
			wantDel:  map[string]int{"main.go": 2},
		},
		{
			name:     "multiple files",
			input:    "5\t0\ta.go\n0\t3\tb.go\n",
			wantKeys: []string{"a.go", "b.go"},
			wantAdd:  map[string]int{"a.go": 5, "b.go": 0},
			wantDel:  map[string]int{"a.go": 0, "b.go": 3},
		},
		{
			name:     "binary skipped",
			input:    "-\t-\timage.png\n5\t1\tcode.go\n",
			wantKeys: []string{"code.go"},
			wantAdd:  map[string]int{"code.go": 5},
			wantDel:  map[string]int{"code.go": 1},
		},
		{
			name:     "rename",
			input:    "3\t0\told.go => new.go\n",
			wantKeys: []string{"new.go"},
			wantAdd:  map[string]int{"new.go": 3},
			wantDel:  map[string]int{"new.go": 0},
		},
		{
			name:     "empty",
			input:    "",
			wantKeys: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stats := parseNumstat(tt.input)
			if len(stats) != len(tt.wantKeys) {
				t.Errorf("got %d entries, want %d", len(stats), len(tt.wantKeys))
			}
			for _, k := range tt.wantKeys {
				s, ok := stats[k]
				if !ok {
					t.Errorf("missing key %q", k)
					continue
				}
				if s[0] != tt.wantAdd[k] {
					t.Errorf("%s additions: got %d, want %d", k, s[0], tt.wantAdd[k])
				}
				if s[1] != tt.wantDel[k] {
					t.Errorf("%s deletions: got %d, want %d", k, s[1], tt.wantDel[k])
				}
			}
		})
	}
}

func TestSelectPushRemoteFromOutput(t *testing.T) {
	tests := []struct {
		name string
		out  string
		want string
	}{
		{name: "empty", out: "", want: ""},
		{name: "origin only", out: "origin\n", want: "origin"},
		{name: "multiple includes origin", out: "upstream\norigin\n", want: "origin"},
		{name: "multiple without origin", out: "upstream\nbackup\n", want: "upstream"},
		{name: "whitespace lines", out: "\n origin \n\n", want: "origin"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectPushRemoteFromOutput(tt.out)
			if got != tt.want {
				t.Fatalf("selectPushRemoteFromOutput() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- Handler integration tests (httptest + real git) ---

func TestGitStatus_Basic(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, _ := createTaskWithWorktree(t, env)

	resp := env.get("/api/tasks/" + taskID + "/git/status")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var status GitStatusResponse
	decodeResponse(t, resp, &status)

	if status.Branch == "" {
		t.Error("expected non-empty branch name")
	}
	if len(status.Staged) != 0 {
		t.Errorf("expected 0 staged, got %d", len(status.Staged))
	}
	if len(status.Unstaged) != 0 {
		t.Errorf("expected 0 unstaged, got %d", len(status.Unstaged))
	}
	if len(status.Untracked) != 0 {
		t.Errorf("expected 0 untracked, got %d", len(status.Untracked))
	}
}

func TestGitStatus_WithChanges(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create a new untracked file
	os.WriteFile(filepath.Join(repoPath, "new.txt"), []byte("new"), 0644)

	// Modify an existing tracked file
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Modified\n"), 0644)

	resp := env.get("/api/tasks/" + taskID + "/git/status")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var status GitStatusResponse
	decodeResponse(t, resp, &status)

	if len(status.Untracked) == 0 {
		t.Error("expected untracked files")
	}
	if len(status.Unstaged) == 0 {
		t.Error("expected unstaged changes")
	}
}

func TestGitStatus_NoWorktree(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	// Create a task without worktree
	repoPath := createTestGitRepoWithMain(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "no-wt", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "No WT",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/git/status")
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestGitStage_Basic(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create a new file
	os.WriteFile(filepath.Join(repoPath, "stage-me.txt"), []byte("hello"), 0644)

	// Stage it
	resp := env.post("/api/tasks/"+taskID+"/git/stage", GitStageRequest{
		Files: []string{"stage-me.txt"},
	})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify it's staged
	statusResp := env.get("/api/tasks/" + taskID + "/git/status")
	var status GitStatusResponse
	decodeResponse(t, statusResp, &status)

	if len(status.Staged) == 0 {
		t.Error("expected file to be staged")
	}
	found := false
	for _, f := range status.Staged {
		if f.Path == "stage-me.txt" {
			found = true
		}
	}
	if !found {
		t.Error("stage-me.txt not found in staged files")
	}
}

func TestGitStage_NoFiles(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, _ := createTaskWithWorktree(t, env)

	resp := env.post("/api/tasks/"+taskID+"/git/stage", GitStageRequest{
		Files: []string{},
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestGitUnstage_Basic(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create and stage a file
	os.WriteFile(filepath.Join(repoPath, "unstage-me.txt"), []byte("hello"), 0644)
	gitExecHelper(t, repoPath, "add", "unstage-me.txt")

	// Unstage it
	resp := env.post("/api/tasks/"+taskID+"/git/unstage", GitStageRequest{
		Files: []string{"unstage-me.txt"},
	})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify it's no longer staged (should be untracked now)
	statusResp := env.get("/api/tasks/" + taskID + "/git/status")
	var status GitStatusResponse
	decodeResponse(t, statusResp, &status)

	for _, f := range status.Staged {
		if f.Path == "unstage-me.txt" {
			t.Error("file should not be staged after unstage")
		}
	}
}

func TestGitCommit_Basic(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create and stage a file
	os.WriteFile(filepath.Join(repoPath, "commit-me.txt"), []byte("hello"), 0644)
	gitExecHelper(t, repoPath, "add", "commit-me.txt")

	resp := env.post("/api/tasks/"+taskID+"/git/commit", GitCommitRequest{
		Message: "test commit",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var commitResp GitCommitResponse
	decodeResponse(t, resp, &commitResp)

	if commitResp.Hash == "" {
		t.Error("expected non-empty commit hash")
	}
	if commitResp.Message != "test commit" {
		t.Errorf("message = %q, want %q", commitResp.Message, "test commit")
	}
}

func TestGitCommit_NoMessage(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, _ := createTaskWithWorktree(t, env)

	resp := env.post("/api/tasks/"+taskID+"/git/commit", GitCommitRequest{
		Message: "",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestGitCommit_Amend(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create and commit a file
	os.WriteFile(filepath.Join(repoPath, "amend-me.txt"), []byte("hello"), 0644)
	gitExecHelper(t, repoPath, "add", "amend-me.txt")
	gitExecHelper(t, repoPath, "commit", "-m", "original message")

	// Amend with new message
	resp := env.post("/api/tasks/"+taskID+"/git/commit", GitCommitRequest{
		Message: "amended message",
		Amend:   true,
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var commitResp GitCommitResponse
	decodeResponse(t, resp, &commitResp)
	if commitResp.Message != "amended message" {
		t.Errorf("message = %q, want %q", commitResp.Message, "amended message")
	}
}

func TestGitDiff_Unstaged(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Modify a tracked file
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Changed\n"), 0644)

	resp := env.get("/api/tasks/" + taskID + "/git/diff")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var diffResp GitDiffResponse
	decodeResponse(t, resp, &diffResp)

	if diffResp.Diff == "" {
		t.Error("expected non-empty diff for modified file")
	}
}

func TestGitDiff_Staged(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Modify and stage
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Staged Change\n"), 0644)
	gitExecHelper(t, repoPath, "add", "README.md")

	resp := env.get("/api/tasks/" + taskID + "/git/diff?staged=true")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var diffResp GitDiffResponse
	decodeResponse(t, resp, &diffResp)

	if diffResp.Diff == "" {
		t.Error("expected non-empty staged diff")
	}
}

func TestGitDiff_SpecificFile(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Modify README and create another file
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Changed\n"), 0644)
	os.WriteFile(filepath.Join(repoPath, "other.txt"), []byte("other"), 0644)
	gitExecHelper(t, repoPath, "add", "other.txt")

	resp := env.get("/api/tasks/" + taskID + "/git/diff?file=README.md")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var diffResp GitDiffResponse
	decodeResponse(t, resp, &diffResp)

	if diffResp.Diff == "" {
		t.Error("expected diff for README.md")
	}
}

func TestGitStash_PushAndPop(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Modify a tracked file
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Stashed\n"), 0644)

	// Stash push
	resp := env.post("/api/tasks/"+taskID+"/git/stash", GitStashRequest{Action: "push"})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("stash push: expected 204, got %d: %s", resp.Code, resp.Body.String())
	}

	// Working dir should be clean now
	statusResp := env.get("/api/tasks/" + taskID + "/git/status")
	var status GitStatusResponse
	decodeResponse(t, statusResp, &status)
	if len(status.Unstaged) != 0 {
		t.Error("expected clean working tree after stash push")
	}

	// Stash pop
	resp = env.post("/api/tasks/"+taskID+"/git/stash", GitStashRequest{Action: "pop"})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("stash pop: expected 204, got %d: %s", resp.Code, resp.Body.String())
	}

	// Changes should be back
	statusResp = env.get("/api/tasks/" + taskID + "/git/status")
	decodeResponse(t, statusResp, &status)
	if len(status.Unstaged) == 0 {
		t.Error("expected unstaged changes after stash pop")
	}
}

func TestGitStash_List(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, repoPath := createTaskWithWorktree(t, env)

	// Create a stash
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# To stash\n"), 0644)
	gitExecHelper(t, repoPath, "stash", "push")

	resp := env.post("/api/tasks/"+taskID+"/git/stash", GitStashRequest{Action: "list"})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var stashResp GitStashResponse
	decodeResponse(t, resp, &stashResp)

	if len(stashResp.Entries) == 0 {
		t.Error("expected at least one stash entry")
	}
}

func TestGitStash_InvalidAction(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	taskID, _ := createTaskWithWorktree(t, env)

	resp := env.post("/api/tasks/"+taskID+"/git/stash", GitStashRequest{Action: "invalid"})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}

	var body map[string]string
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body["error"] != "invalid action: must be push, pop, or list" {
		t.Errorf("unexpected error: %q", body["error"])
	}
}
