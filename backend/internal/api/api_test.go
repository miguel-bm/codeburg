package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/gitclone"
	"github.com/miguel-bm/codeburg/internal/portsuggest"
	"github.com/miguel-bm/codeburg/internal/tunnel"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

// testEnv holds a test server with all dependencies
type testEnv struct {
	server *Server
	t      *testing.T
	token  string // auth token after setup
}

// setupTestEnv creates a fully configured test server
func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()

	// In-memory database
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}

	// Temp directory for auth config
	tmpDir := t.TempDir()

	// Create auth service with temp dir
	secret := make([]byte, 32)
	rand.Read(secret)
	auth := &AuthService{
		configPath: filepath.Join(tmpDir, "config.yaml"),
		jwtSecret:  secret,
	}

	// Create WebSocket hub
	wsHub := NewWSHub()
	wsCtx, wsCancel := context.WithCancel(context.Background())
	go wsHub.Run(wsCtx)

	// Create server
	s := &Server{
		db:             database,
		auth:           auth,
		worktree:       worktree.NewManager(worktree.DefaultConfig()),
		wsHub:          wsHub,
		sessions:       NewSessionManager(),
		chat:           NewChatManager(database),
		tunnels:        tunnel.NewManager(),
		portSuggest:    portsuggest.NewManager(nil),
		gitclone:       gitclone.Config{BaseDir: filepath.Join(tmpDir, "repos")},
		authLimiter:    newLoginRateLimiter(5, 1*time.Minute),
		allowedOrigins: []string{"http://localhost:*"},
	}
	s.setupRoutes()

	t.Cleanup(func() {
		wsCancel()
		wsHub.Stop()
		database.Close()
	})

	return &testEnv{server: s, t: t}
}

// setup runs the auth setup flow and stores the token
func (e *testEnv) setup(password string) {
	e.t.Helper()
	resp := e.post("/api/auth/setup", map[string]string{"password": password})
	if resp.Code != http.StatusOK {
		e.t.Fatalf("setup failed: %d %s", resp.Code, resp.Body.String())
	}
	var body map[string]string
	json.Unmarshal(resp.Body.Bytes(), &body)
	e.token = body["token"]
}

// request makes an HTTP request to the server
func (e *testEnv) request(method, path string, body interface{}) *httptest.ResponseRecorder {
	e.t.Helper()
	var bodyReader *strings.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = strings.NewReader(string(data))
	} else {
		bodyReader = strings.NewReader("")
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if e.token != "" {
		req.Header.Set("Authorization", "Bearer "+e.token)
	}

	w := httptest.NewRecorder()
	e.server.router.ServeHTTP(w, req)
	return w
}

func (e *testEnv) get(path string) *httptest.ResponseRecorder {
	return e.request("GET", path, nil)
}

func (e *testEnv) post(path string, body interface{}) *httptest.ResponseRecorder {
	return e.request("POST", path, body)
}

func (e *testEnv) patch(path string, body interface{}) *httptest.ResponseRecorder {
	return e.request("PATCH", path, body)
}

func (e *testEnv) delete(path string) *httptest.ResponseRecorder {
	return e.request("DELETE", path, nil)
}

// decodeResponse decodes JSON response body into v
func decodeResponse(t *testing.T, resp *httptest.ResponseRecorder, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(resp.Body.Bytes(), v); err != nil {
		t.Fatalf("decode response: %v (body: %s)", err, resp.Body.String())
	}
}

// --- Auth Tests ---

func TestAuthStatus_NotSetup(t *testing.T) {
	env := setupTestEnv(t)

	resp := env.get("/api/auth/status")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body map[string]bool
	decodeResponse(t, resp, &body)
	if body["setup"] {
		t.Error("expected setup=false")
	}
}

func TestAuthSetup(t *testing.T) {
	env := setupTestEnv(t)

	resp := env.post("/api/auth/setup", map[string]string{
		"password": "testpass123",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]string
	decodeResponse(t, resp, &body)
	if body["token"] == "" {
		t.Error("expected token in response")
	}

	// Status should now show setup=true
	statusResp := env.get("/api/auth/status")
	var status map[string]bool
	decodeResponse(t, statusResp, &status)
	if !status["setup"] {
		t.Error("expected setup=true after setup")
	}
}

func TestAuthSetup_ShortPassword(t *testing.T) {
	env := setupTestEnv(t)

	resp := env.post("/api/auth/setup", map[string]string{
		"password": "short",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestAuthSetup_AlreadySetup(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/auth/setup", map[string]string{
		"password": "anotherpass123",
	})
	if resp.Code != http.StatusConflict {
		t.Errorf("expected 409 for already setup, got %d", resp.Code)
	}
}

func TestAuthLogin(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	env.token = "" // Clear token to test login

	resp := env.post("/api/auth/login", map[string]string{
		"password": "testpass123",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body map[string]string
	decodeResponse(t, resp, &body)
	if body["token"] == "" {
		t.Error("expected token in response")
	}
}

func TestAuthLogin_WrongPassword(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	env.token = "" // Clear token

	resp := env.post("/api/auth/login", map[string]string{
		"password": "wrongpassword",
	})
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

func TestAuthMe(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.get("/api/auth/me")
	if resp.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.Code)
	}
}

func TestAuthMe_NoToken(t *testing.T) {
	env := setupTestEnv(t)
	env.token = ""

	resp := env.get("/api/auth/me")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

func TestAuthMe_InvalidToken(t *testing.T) {
	env := setupTestEnv(t)
	env.token = "invalid-token"

	resp := env.get("/api/auth/me")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

// --- Protected Routes Without Auth ---

func TestProtectedRoute_NoAuth(t *testing.T) {
	env := setupTestEnv(t)

	routes := []struct {
		method string
		path   string
	}{
		{"GET", "/api/projects"},
		{"GET", "/api/tasks"},
	}

	for _, r := range routes {
		resp := env.request(r.method, r.path, nil)
		if resp.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", r.method, r.path, resp.Code)
		}
	}
}

// --- Project API Tests ---

// createTestGitRepo creates a temporary git repository for testing
func createTestGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Initialize git repo
	cmd := exec.Command("git", "init", dir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("git init: %v", err)
	}

	// Configure git user (required for commits)
	cmd = exec.Command("git", "-C", dir, "config", "user.email", "test@test.com")
	cmd.Run()
	cmd = exec.Command("git", "-C", dir, "config", "user.name", "Test")
	cmd.Run()

	// Create initial commit
	testFile := filepath.Join(dir, "README.md")
	os.WriteFile(testFile, []byte("# Test"), 0644)
	cmd = exec.Command("git", "-C", dir, "add", ".")
	cmd.Run()
	cmd = exec.Command("git", "-C", dir, "commit", "-m", "init")
	if err := cmd.Run(); err != nil {
		t.Fatalf("git commit: %v", err)
	}

	return dir
}

type fakePortScanner struct {
	ports []int
	err   error
}

func (f *fakePortScanner) ListListeningPorts(_ context.Context) ([]int, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make([]int, len(f.ports))
	copy(out, f.ports)
	return out, nil
}

func TestCreateProject(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)

	resp := env.post("/api/projects", map[string]string{
		"name": "test-project",
		"path": repoPath,
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.Code, resp.Body.String())
	}

	var project db.Project
	decodeResponse(t, resp, &project)

	if project.Name != "test-project" {
		t.Errorf("expected name 'test-project', got %q", project.Name)
	}
	if project.Path != repoPath {
		t.Errorf("expected path %q, got %q", repoPath, project.Path)
	}
}

func TestCreateProject_NoName(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/projects", map[string]string{
		"path": "/tmp/whatever",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestCreateProject_InvalidPath(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/projects", map[string]string{
		"name": "bad-path",
		"path": "/nonexistent/path/that/doesnt/exist",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestCreateProject_NotGitRepo(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	dir := t.TempDir() // Not a git repo

	resp := env.post("/api/projects", map[string]string{
		"name": "not-git",
		"path": dir,
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestListProjects(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repo1 := createTestGitRepo(t)
	repo2 := createTestGitRepo(t)

	env.post("/api/projects", map[string]string{"name": "alpha", "path": repo1})
	env.post("/api/projects", map[string]string{"name": "beta", "path": repo2})

	resp := env.get("/api/projects")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var projects []db.Project
	decodeResponse(t, resp, &projects)

	if len(projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(projects))
	}
}

func TestGetProject(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	createResp := env.post("/api/projects", map[string]string{
		"name": "get-test",
		"path": repoPath,
	})

	var created db.Project
	decodeResponse(t, createResp, &created)

	resp := env.get("/api/projects/" + created.ID)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var project db.Project
	decodeResponse(t, resp, &project)
	if project.Name != "get-test" {
		t.Errorf("expected 'get-test', got %q", project.Name)
	}
}

func TestDeleteProject(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	createResp := env.post("/api/projects", map[string]string{
		"name": "to-delete",
		"path": repoPath,
	})

	var created db.Project
	decodeResponse(t, createResp, &created)

	resp := env.delete("/api/projects/" + created.ID)
	if resp.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", resp.Code)
	}

	// Verify it's gone
	getResp := env.get("/api/projects/" + created.ID)
	if getResp.Code != http.StatusNotFound {
		t.Errorf("expected 404 after delete, got %d", getResp.Code)
	}
}

// --- Task API Tests ---

func TestCreateTask(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "task-proj",
		"path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	resp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Test Task",
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.Code, resp.Body.String())
	}

	var task db.Task
	decodeResponse(t, resp, &task)

	if task.Title != "Test Task" {
		t.Errorf("expected 'Test Task', got %q", task.Title)
	}
	if task.ProjectID != project.ID {
		t.Errorf("expected project ID %q, got %q", project.ID, task.ProjectID)
	}
	if task.Status != "backlog" {
		t.Errorf("expected status 'backlog', got %q", task.Status)
	}
}

func TestCreateTask_NoTitle(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	resp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestCreateTask_InvalidProject(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/projects/nonexistent/tasks", map[string]string{
		"title": "Orphan Task",
	})
	if resp.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.Code)
	}
}

func TestUpdateTask_Status(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Status Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Update status to in_review
	resp := env.patch("/api/tasks/"+task.ID, map[string]string{
		"status": "in_review",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var updated map[string]interface{}
	decodeResponse(t, resp, &updated)
	if updated["status"] != "in_review" {
		t.Errorf("expected status 'in_review', got %v", updated["status"])
	}
}

func TestUpdateTask_InvalidStatus(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Invalid Status",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.patch("/api/tasks/"+task.ID, map[string]string{
		"status": "invalid_status",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.Code)
	}
}

func TestListTasks(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	env.post("/api/projects/"+project.ID+"/tasks", map[string]string{"title": "Task 1"})
	env.post("/api/projects/"+project.ID+"/tasks", map[string]string{"title": "Task 2"})
	env.post("/api/projects/"+project.ID+"/tasks", map[string]string{"title": "Task 3"})

	resp := env.get("/api/tasks")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var tasks []db.Task
	decodeResponse(t, resp, &tasks)
	if len(tasks) != 3 {
		t.Errorf("expected 3 tasks, got %d", len(tasks))
	}
}

func TestListTasks_FilterByProject(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repo1 := createTestGitRepo(t)
	repo2 := createTestGitRepo(t)

	projResp1 := env.post("/api/projects", map[string]string{"name": "p1", "path": repo1})
	projResp2 := env.post("/api/projects", map[string]string{"name": "p2", "path": repo2})

	var p1, p2 db.Project
	decodeResponse(t, projResp1, &p1)
	decodeResponse(t, projResp2, &p2)

	env.post("/api/projects/"+p1.ID+"/tasks", map[string]string{"title": "P1 Task"})
	env.post("/api/projects/"+p2.ID+"/tasks", map[string]string{"title": "P2 Task 1"})
	env.post("/api/projects/"+p2.ID+"/tasks", map[string]string{"title": "P2 Task 2"})

	resp := env.get("/api/tasks?project=" + p2.ID)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var tasks []db.Task
	decodeResponse(t, resp, &tasks)
	if len(tasks) != 2 {
		t.Errorf("expected 2 tasks for p2, got %d", len(tasks))
	}
}

func TestDeleteTask(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "To Delete",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.delete("/api/tasks/" + task.ID)
	if resp.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", resp.Code)
	}

	getResp := env.get("/api/tasks/" + task.ID)
	if getResp.Code != http.StatusNotFound {
		t.Errorf("expected 404 after delete, got %d", getResp.Code)
	}
}

// --- Session API Tests (limited - no tmux/claude in CI) ---

func TestListSessions_EmptyTask(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Session Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/sessions")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var sessions []db.AgentSession
	decodeResponse(t, resp, &sessions)
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestListSessions_InvalidTask(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.get("/api/tasks/nonexistent/sessions")
	if resp.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.Code)
	}
}

func TestStartSession_ChatResumeCopiesHistory(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Resume Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	source, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "chat",
	})
	if err != nil {
		t.Fatalf("create source session: %v", err)
	}

	providerSessionID := "claude-provider-xyz"
	if _, err := env.server.db.UpdateSession(source.ID, db.UpdateSessionInput{
		ProviderSessionID: &providerSessionID,
	}); err != nil {
		t.Fatalf("update provider session id: %v", err)
	}

	if _, err := env.server.db.CreateAgentMessage(db.CreateAgentMessageInput{
		SessionID:   source.ID,
		Seq:         1,
		Kind:        "user-text",
		PayloadJSON: `{"id":"m1","sessionId":"old-session-id","kind":"user-text","text":"hello"}`,
	}); err != nil {
		t.Fatalf("create source message 1: %v", err)
	}
	if _, err := env.server.db.CreateAgentMessage(db.CreateAgentMessageInput{
		SessionID:   source.ID,
		Seq:         2,
		Kind:        "agent-text",
		PayloadJSON: `{"id":"m2","sessionId":"old-session-id","kind":"agent-text","text":"hi there"}`,
	}); err != nil {
		t.Fatalf("create source message 2: %v", err)
	}

	resp := env.post("/api/tasks/"+task.ID+"/sessions", map[string]any{
		"provider":        "claude",
		"sessionType":     "chat",
		"resumeSessionId": source.ID,
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", resp.Code, resp.Body.String())
	}

	var resumed db.AgentSession
	decodeResponse(t, resp, &resumed)
	if resumed.ProviderSessionID == nil || *resumed.ProviderSessionID != providerSessionID {
		t.Fatalf("expected provider session id %q, got %v", providerSessionID, resumed.ProviderSessionID)
	}

	copied, err := env.server.db.ListAgentMessagesBySession(resumed.ID)
	if err != nil {
		t.Fatalf("list copied messages: %v", err)
	}
	if len(copied) != 2 {
		t.Fatalf("expected 2 copied messages, got %d", len(copied))
	}

	snapshot, _, cancel, err := env.server.chat.Attach(resumed.ID)
	if err != nil {
		t.Fatalf("attach chat session: %v", err)
	}
	defer cancel()
	if len(snapshot) != 2 {
		t.Fatalf("expected 2 messages in chat snapshot, got %d", len(snapshot))
	}
	for _, msg := range snapshot {
		if msg.SessionID != resumed.ID {
			t.Fatalf("expected normalized session id %q, got %q", resumed.ID, msg.SessionID)
		}
	}
}

// --- Justfile API Tests ---

func TestListJustRecipes_NoJustfile(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "no-justfile", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	resp := env.get("/api/projects/" + project.ID + "/justfile")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body map[string]interface{}
	decodeResponse(t, resp, &body)

	if body["hasJustfile"].(bool) {
		t.Error("expected hasJustfile=false")
	}
}

func TestListTaskJustRecipes_NoJustfile(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Just Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/justfile")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body map[string]interface{}
	decodeResponse(t, resp, &body)
	if body["hasJustfile"].(bool) {
		t.Error("expected hasJustfile=false for task without justfile")
	}
}

func TestListTaskRecipes_MultiSource(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)

	if err := os.WriteFile(filepath.Join(repoPath, "justfile"), []byte(`fmt:
	@echo "fmt"`), 0644); err != nil {
		t.Fatalf("write justfile: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "Makefile"), []byte(`lint: ## Lint code
	@echo lint

build test: ## Build and test
	@echo build

.PHONY: lint build test`), 0644); err != nil {
		t.Fatalf("write Makefile: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "package.json"), []byte(`{
  "name": "recipes-test",
  "scripts": {
    "dev": "vite",
    "test": "vitest",
    "build": "tsc -b"
  }
}`), 0644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "Taskfile.yml"), []byte(`version: "3"
tasks:
  deploy:
    desc: Deploy app
    cmds:
      - ./deploy.sh`), 0644); err != nil {
		t.Fatalf("write Taskfile.yml: %v", err)
	}

	projResp := env.post("/api/projects", map[string]string{
		"name": "recipes", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Recipe Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/recipes")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body struct {
		Recipes []struct {
			Name        string `json:"name"`
			Command     string `json:"command"`
			Source      string `json:"source"`
			Description string `json:"description"`
		} `json:"recipes"`
		Sources []string `json:"sources"`
	}
	decodeResponse(t, resp, &body)

	if len(body.Recipes) == 0 {
		t.Fatal("expected recipes, got none")
	}

	byKey := make(map[string]string, len(body.Recipes))
	for _, recipe := range body.Recipes {
		byKey[recipe.Source+":"+recipe.Name] = recipe.Command
	}

	expectedCommands := map[string]string{
		"justfile:fmt":       "just fmt",
		"makefile:lint":      "make lint",
		"package.json:test":  "npm run test",
		"taskfile:deploy":    "task deploy",
		"package.json:build": "npm run build",
	}
	for key, command := range expectedCommands {
		got, ok := byKey[key]
		if !ok {
			t.Errorf("missing recipe %q", key)
			continue
		}
		if got != command {
			t.Errorf("recipe %q: expected command %q, got %q", key, command, got)
		}
	}

	sourceSet := make(map[string]struct{}, len(body.Sources))
	for _, source := range body.Sources {
		sourceSet[source] = struct{}{}
	}
	for _, source := range []string{"justfile", "makefile", "package.json", "taskfile"} {
		if _, ok := sourceSet[source]; !ok {
			t.Errorf("expected source %q in response", source)
		}
	}
}

func TestListTaskRecipes_Empty(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "recipes-empty", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "No Recipes",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/recipes")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body struct {
		Recipes []map[string]interface{} `json:"recipes"`
		Sources []string                 `json:"sources"`
	}
	decodeResponse(t, resp, &body)

	if len(body.Recipes) != 0 {
		t.Errorf("expected 0 recipes, got %d", len(body.Recipes))
	}
	if len(body.Sources) != 0 {
		t.Errorf("expected 0 sources, got %d", len(body.Sources))
	}
}

// --- Tunnel API Tests ---

func TestListTunnels_Empty(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Tunnel Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/tunnels")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var tunnels []map[string]interface{}
	decodeResponse(t, resp, &tunnels)
	if len(tunnels) != 0 {
		t.Errorf("expected 0 tunnels, got %d", len(tunnels))
	}
}

func TestListTaskPortSuggestions_Empty(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Ports Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.get("/api/tasks/" + task.ID + "/port-suggestions")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body struct {
		Suggestions []map[string]interface{} `json:"suggestions"`
	}
	decodeResponse(t, resp, &body)
	if len(body.Suggestions) != 0 {
		t.Errorf("expected 0 suggestions, got %d", len(body.Suggestions))
	}
}

func TestScanTaskPorts_WithFakeScanner(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	env.server.portSuggest = portsuggest.NewManager(&fakePortScanner{ports: []int{5173, 5432}})

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Ports Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	scanResp := env.post("/api/tasks/"+task.ID+"/ports/scan", map[string]interface{}{})
	if scanResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", scanResp.Code, scanResp.Body.String())
	}

	resp := env.get("/api/tasks/" + task.ID + "/port-suggestions")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var body struct {
		Suggestions []struct {
			Port    int      `json:"port"`
			Status  string   `json:"status"`
			Sources []string `json:"sources"`
		} `json:"suggestions"`
	}
	decodeResponse(t, resp, &body)

	if len(body.Suggestions) != 2 {
		t.Fatalf("expected 2 suggestions, got %d", len(body.Suggestions))
	}
	for _, suggestion := range body.Suggestions {
		if suggestion.Status != "suggested" {
			t.Errorf("expected status suggested, got %q", suggestion.Status)
		}
		if len(suggestion.Sources) == 0 || suggestion.Sources[0] != "scan" {
			t.Errorf("expected scan source, got %#v", suggestion.Sources)
		}
	}
}

func TestCreateTunnel_InvalidPort(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Tunnel Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.post("/api/tasks/"+task.ID+"/tunnels", map[string]int{
		"port": -1,
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid port, got %d", resp.Code)
	}

	resp = env.post("/api/tasks/"+task.ID+"/tunnels", map[string]int{
		"port": 99999,
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for port > 65535, got %d", resp.Code)
	}
}

// --- GitHub URL Project Tests ---

func TestCreateProject_InvalidGitHubURL(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/projects", map[string]string{
		"githubUrl": "https://gitlab.com/user/repo",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-GitHub URL, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]string
	decodeResponse(t, resp, &body)
	if body["error"] != "invalid GitHub URL" {
		t.Errorf("expected 'invalid GitHub URL' error, got %q", body["error"])
	}
}

// --- Hook Endpoint Tests ---

func TestSessionHook_Notification(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Create a session directly in the DB
	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// Set session to running
	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// POST Notification hook -> should set status to waiting_input
	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "Notification",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify status changed
	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusWaitingInput {
		t.Errorf("expected status waiting_input, got %q", updated.Status)
	}
}

func TestSessionHook_SessionEnd(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Create a session directly in the DB
	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// Set session to running
	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// POST SessionEnd hook -> should set status to completed
	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "SessionEnd",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify status changed
	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusCompleted {
		t.Errorf("expected status completed, got %q", updated.Status)
	}
}

func TestSessionHook_Stop(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Create a session and set it to running
	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// POST Stop hook -> should set status to waiting_input
	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "Stop",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify status changed
	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusWaitingInput {
		t.Errorf("expected status waiting_input, got %q", updated.Status)
	}
}

func TestSessionHook_StopWhileContinuing(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// If stop_hook_active is true, Claude is already continuing.
	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]interface{}{
		"hook_event_name":  "Stop",
		"stop_hook_active": true,
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusRunning {
		t.Errorf("expected status running, got %q", updated.Status)
	}
}

func TestSessionHook_NotificationAuthSuccessDoesNotFlipWaiting(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]interface{}{
		"hook_event_name":   "Notification",
		"notification_type": "auth_success",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusRunning {
		t.Errorf("expected status running, got %q", updated.Status)
	}
}

func TestSessionHook_AgentTurnComplete(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Codex Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "codex",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// POST agent-turn-complete -> should set status to waiting_input
	resp := env.post("/api/sessions/"+session.ID+"/hook", map[string]string{
		"hook_event_name": "agent-turn-complete",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusWaitingInput {
		t.Errorf("expected status waiting_input, got %q", updated.Status)
	}
}

func TestSessionHook_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.post("/api/sessions/nonexistent/hook", map[string]string{
		"hook_event_name": "Notification",
	})
	if resp.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.Code)
	}
}

// --- Scoped Hook Token Tests ---

// requestWithToken makes a request using a specific token (not the env default)
func (e *testEnv) requestWithToken(method, path string, body interface{}, token string) *httptest.ResponseRecorder {
	e.t.Helper()
	var bodyReader *strings.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = strings.NewReader(string(data))
	} else {
		bodyReader = strings.NewReader("")
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	w := httptest.NewRecorder()
	e.server.router.ServeHTTP(w, req)
	return w
}

func TestSessionHook_ScopedToken(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "scoped-hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Scoped Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// Generate scoped hook token for this session
	scopedToken, err := env.server.auth.GenerateHookToken(session.ID)
	if err != nil {
		t.Fatalf("generate hook token: %v", err)
	}

	// Scoped token for correct session → 200
	resp := env.requestWithToken("POST", "/api/sessions/"+session.ID+"/hook",
		map[string]string{"hook_event_name": "Notification"}, scopedToken)
	if resp.Code != http.StatusOK {
		t.Errorf("expected 200 with scoped token, got %d: %s", resp.Code, resp.Body.String())
	}

	// Verify status changed
	updated, err := env.server.db.GetSession(session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if updated.Status != db.SessionStatusWaitingInput {
		t.Errorf("expected status waiting_input, got %q", updated.Status)
	}
}

func TestSessionHook_ScopedTokenWrongSession(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "scoped-hook-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Scoped Hook Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	runningStatus := db.SessionStatusRunning
	env.server.db.UpdateSession(session.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// Generate scoped token for a DIFFERENT session ID
	wrongToken, err := env.server.auth.GenerateHookToken("wrong-session-id")
	if err != nil {
		t.Fatalf("generate hook token: %v", err)
	}

	// Scoped token for wrong session → 401
	resp := env.requestWithToken("POST", "/api/sessions/"+session.ID+"/hook",
		map[string]string{"hook_event_name": "Notification"}, wrongToken)
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with wrong-session scoped token, got %d", resp.Code)
	}
}

func TestSessionHook_NoToken(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "no-token-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "No Token Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	session, err := env.server.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		ProjectID:   project.ID,
		Provider:    "claude",
		SessionType: "terminal",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// No token → 401
	resp := env.requestWithToken("POST", "/api/sessions/"+session.ID+"/hook",
		map[string]string{"hook_event_name": "Notification"}, "")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with no token, got %d", resp.Code)
	}
}

// --- Workflow Tests ---

func TestUpdateTask_BlockedStatus_Rejected(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Blocked Status Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.patch("/api/tasks/"+task.ID, map[string]string{
		"status": "blocked",
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for blocked status, got %d", resp.Code)
	}
}

func TestUpdateTask_WorkflowAsk(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "workflow-ask-project", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	// Set workflow to "ask" on backlog→in_progress
	env.server.db.UpdateProject(project.ID, db.UpdateProjectInput{
		Workflow: &db.ProjectWorkflow{
			BacklogToProgress: &db.BacklogToProgressConfig{
				Action: "ask",
			},
		},
	})

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Ask Workflow Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	// Move to in_progress — should get workflowAction="ask"
	resp := env.patch("/api/tasks/"+task.ID, map[string]string{
		"status": "in_progress",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]interface{}
	decodeResponse(t, resp, &body)

	if body["workflowAction"] != "ask" {
		t.Errorf("expected workflowAction 'ask', got %v", body["workflowAction"])
	}
}

func TestUpdateTask_StatusInReview(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	repoPath := createTestGitRepo(t)
	projResp := env.post("/api/projects", map[string]string{
		"name": "p", "path": repoPath,
	})
	var project db.Project
	decodeResponse(t, projResp, &project)

	taskResp := env.post("/api/projects/"+project.ID+"/tasks", map[string]string{
		"title": "Review Task",
	})
	var task db.Task
	decodeResponse(t, taskResp, &task)

	resp := env.patch("/api/tasks/"+task.ID, map[string]string{
		"status": "in_review",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]interface{}
	decodeResponse(t, resp, &body)
	if body["status"] != "in_review" {
		t.Errorf("expected status 'in_review', got %v", body["status"])
	}
}

func TestWriteClaudeHooks_InvalidExistingJSON(t *testing.T) {
	workDir := t.TempDir()
	claudeDir := filepath.Join(workDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		t.Fatalf("mkdir .claude: %v", err)
	}
	settingsPath := filepath.Join(claudeDir, "settings.local.json")
	original := []byte(`{"hooks": invalid-json}`)
	if err := os.WriteFile(settingsPath, original, 0644); err != nil {
		t.Fatalf("write invalid settings file: %v", err)
	}

	err := writeClaudeHooks(workDir, "session-new", "/tmp/token", "http://localhost:8080")
	if err == nil {
		t.Fatal("expected parse error, got nil")
	}

	got, readErr := os.ReadFile(settingsPath)
	if readErr != nil {
		t.Fatalf("read settings file: %v", readErr)
	}
	if string(got) != string(original) {
		t.Fatalf("expected invalid settings to remain unchanged")
	}
}

func TestWriteClaudeHooks_ReplacesOnlyCodeburgEntries(t *testing.T) {
	workDir := t.TempDir()
	claudeDir := filepath.Join(workDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		t.Fatalf("mkdir .claude: %v", err)
	}
	settingsPath := filepath.Join(claudeDir, "settings.local.json")

	initial := map[string]interface{}{
		"hooks": map[string]interface{}{
			"Notification": []interface{}{
				map[string]interface{}{
					"matcher": "",
					"hooks": []interface{}{
						map[string]interface{}{
							"type":    "command",
							"command": "curl -s -X POST 'http://localhost:8080/api/sessions/old-session/hook'",
						},
					},
				},
				map[string]interface{}{
					"matcher": "",
					"hooks": []interface{}{
						map[string]interface{}{
							"type":    "command",
							"command": "echo user-notification",
						},
					},
				},
			},
		},
	}
	data, err := json.MarshalIndent(initial, "", "  ")
	if err != nil {
		t.Fatalf("marshal initial settings: %v", err)
	}
	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("write initial settings: %v", err)
	}

	if err := writeClaudeHooks(workDir, "new-session", "/tmp/token", "http://localhost:8080"); err != nil {
		t.Fatalf("writeClaudeHooks: %v", err)
	}

	updatedData, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("read updated settings: %v", err)
	}

	var updated map[string]interface{}
	if err := json.Unmarshal(updatedData, &updated); err != nil {
		t.Fatalf("unmarshal updated settings: %v", err)
	}

	hooksObj, ok := updated["hooks"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected hooks object")
	}

	checkEvent := func(event string, expectUser bool) {
		t.Helper()
		entries, ok := hooksObj[event].([]interface{})
		if !ok {
			t.Fatalf("expected %s hooks array", event)
		}

		var hasOldCodeburg bool
		var hasNewCodeburg bool
		var hasUser bool

		for _, entry := range entries {
			m, ok := entry.(map[string]interface{})
			if !ok {
				continue
			}
			hooks, ok := m["hooks"].([]interface{})
			if !ok {
				continue
			}
			for _, h := range hooks {
				hook, ok := h.(map[string]interface{})
				if !ok {
					continue
				}
				cmd, _ := hook["command"].(string)
				if strings.Contains(cmd, "/api/sessions/old-session/hook") {
					hasOldCodeburg = true
				}
				if strings.Contains(cmd, "/api/sessions/new-session/hook") {
					hasNewCodeburg = true
				}
				if strings.Contains(cmd, "echo user-notification") {
					hasUser = true
				}
			}
		}

		if hasOldCodeburg {
			t.Fatalf("event %s still contains old codeburg hook", event)
		}
		if !hasNewCodeburg {
			t.Fatalf("event %s missing new codeburg hook", event)
		}
		if expectUser && !hasUser {
			t.Fatalf("event %s missing preserved user hook", event)
		}
		if !expectUser && hasUser {
			t.Fatalf("event %s should not include user hook", event)
		}
	}

	checkEvent("Notification", true)
	checkEvent("Stop", false)
	checkEvent("SessionEnd", false)
}

// --- Helper to suppress unused import ---
var _ = hex.EncodeToString
