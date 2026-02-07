package db

import (
	"testing"
)

// openTestDB creates an in-memory database for testing
func openTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := db.Migrate(); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// --- Project Tests ---

func TestCreateProject(t *testing.T) {
	db := openTestDB(t)

	project, err := db.CreateProject(CreateProjectInput{
		Name: "test-project",
		Path: "/tmp/test-project",
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	if project.ID == "" {
		t.Error("expected non-empty ID")
	}
	if project.Name != "test-project" {
		t.Errorf("expected name 'test-project', got %q", project.Name)
	}
	if project.Path != "/tmp/test-project" {
		t.Errorf("expected path '/tmp/test-project', got %q", project.Path)
	}
	if project.DefaultBranch != "main" {
		t.Errorf("expected default branch 'main', got %q", project.DefaultBranch)
	}
}

func TestCreateProject_CustomBranch(t *testing.T) {
	db := openTestDB(t)

	branch := "master"
	project, err := db.CreateProject(CreateProjectInput{
		Name:          "legacy-project",
		Path:          "/tmp/legacy",
		DefaultBranch: &branch,
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	if project.DefaultBranch != "master" {
		t.Errorf("expected default branch 'master', got %q", project.DefaultBranch)
	}
}

func TestCreateProject_WithSymlinkPaths(t *testing.T) {
	db := openTestDB(t)

	project, err := db.CreateProject(CreateProjectInput{
		Name:         "project-with-symlinks",
		Path:         "/tmp/symlink-test",
		SymlinkPaths: []string{".env", ".env.local", "secrets/"},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	if len(project.SymlinkPaths) != 3 {
		t.Fatalf("expected 3 symlink paths, got %d", len(project.SymlinkPaths))
	}
	if project.SymlinkPaths[0] != ".env" {
		t.Errorf("expected '.env', got %q", project.SymlinkPaths[0])
	}
}

func TestGetProject(t *testing.T) {
	db := openTestDB(t)

	created, _ := db.CreateProject(CreateProjectInput{
		Name: "get-test",
		Path: "/tmp/get-test",
	})

	got, err := db.GetProject(created.ID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}

	if got.ID != created.ID {
		t.Errorf("expected ID %q, got %q", created.ID, got.ID)
	}
	if got.Name != "get-test" {
		t.Errorf("expected name 'get-test', got %q", got.Name)
	}
}

func TestGetProject_NotFound(t *testing.T) {
	db := openTestDB(t)

	_, err := db.GetProject("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent project")
	}
}

func TestListProjects(t *testing.T) {
	db := openTestDB(t)

	db.CreateProject(CreateProjectInput{Name: "alpha", Path: "/tmp/alpha"})
	db.CreateProject(CreateProjectInput{Name: "beta", Path: "/tmp/beta"})
	db.CreateProject(CreateProjectInput{Name: "gamma", Path: "/tmp/gamma"})

	projects, err := db.ListProjects()
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}

	if len(projects) != 3 {
		t.Fatalf("expected 3 projects, got %d", len(projects))
	}

	// Should be ordered by name
	if projects[0].Name != "alpha" {
		t.Errorf("expected first project 'alpha', got %q", projects[0].Name)
	}
	if projects[1].Name != "beta" {
		t.Errorf("expected second project 'beta', got %q", projects[1].Name)
	}
}

func TestUpdateProject(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "original",
		Path: "/tmp/original",
	})

	newName := "updated"
	updated, err := db.UpdateProject(project.ID, UpdateProjectInput{
		Name: &newName,
	})
	if err != nil {
		t.Fatalf("update project: %v", err)
	}

	if updated.Name != "updated" {
		t.Errorf("expected name 'updated', got %q", updated.Name)
	}
	if updated.Path != "/tmp/original" {
		t.Errorf("path should be unchanged, got %q", updated.Path)
	}
}

func TestDeleteProject(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "to-delete",
		Path: "/tmp/to-delete",
	})

	err := db.DeleteProject(project.ID)
	if err != nil {
		t.Fatalf("delete project: %v", err)
	}

	_, err = db.GetProject(project.ID)
	if err == nil {
		t.Error("expected error after deletion")
	}
}

// --- Task Tests ---

func TestCreateTask(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "task-project",
		Path: "/tmp/task-project",
	})

	task, err := db.CreateTask(CreateTaskInput{
		ProjectID: project.ID,
		Title:     "Test Task",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	if task.ID == "" {
		t.Error("expected non-empty ID")
	}
	if task.Title != "Test Task" {
		t.Errorf("expected title 'Test Task', got %q", task.Title)
	}
	if task.Status != TaskStatusBacklog {
		t.Errorf("expected status 'backlog', got %q", task.Status)
	}
	if task.Pinned {
		t.Error("expected not pinned by default")
	}
}

func TestCreateTask_WithDescription(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "p", Path: "/tmp/p",
	})

	desc := "A detailed description"
	task, err := db.CreateTask(CreateTaskInput{
		ProjectID:   project.ID,
		Title:       "Described Task",
		Description: &desc,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	if task.Description == nil || *task.Description != "A detailed description" {
		t.Errorf("expected description, got %v", task.Description)
	}
}

func TestUpdateTask_StatusTransitions(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "p", Path: "/tmp/p",
	})
	task, _ := db.CreateTask(CreateTaskInput{
		ProjectID: project.ID,
		Title:     "Status Task",
	})

	// Move to in_progress - should set startedAt
	inProgress := TaskStatusInProgress
	updated, err := db.UpdateTask(task.ID, UpdateTaskInput{
		Status: &inProgress,
	})
	if err != nil {
		t.Fatalf("update to in_progress: %v", err)
	}
	if updated.Status != TaskStatusInProgress {
		t.Errorf("expected in_progress, got %q", updated.Status)
	}
	if updated.StartedAt == nil {
		t.Error("expected startedAt to be set")
	}

	// Move to done - should set completedAt
	done := TaskStatusDone
	updated, err = db.UpdateTask(task.ID, UpdateTaskInput{
		Status: &done,
	})
	if err != nil {
		t.Fatalf("update to done: %v", err)
	}
	if updated.Status != TaskStatusDone {
		t.Errorf("expected done, got %q", updated.Status)
	}
	if updated.CompletedAt == nil {
		t.Error("expected completedAt to be set")
	}
}

func TestUpdateTask_Pin(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{
		Name: "p", Path: "/tmp/p",
	})
	task, _ := db.CreateTask(CreateTaskInput{
		ProjectID: project.ID,
		Title:     "Pin Task",
	})

	pinned := true
	updated, err := db.UpdateTask(task.ID, UpdateTaskInput{
		Pinned: &pinned,
	})
	if err != nil {
		t.Fatalf("update pin: %v", err)
	}
	if !updated.Pinned {
		t.Error("expected task to be pinned")
	}
}

func TestListTasks_FilterByProject(t *testing.T) {
	db := openTestDB(t)

	p1, _ := db.CreateProject(CreateProjectInput{Name: "p1", Path: "/tmp/p1"})
	p2, _ := db.CreateProject(CreateProjectInput{Name: "p2", Path: "/tmp/p2"})

	db.CreateTask(CreateTaskInput{ProjectID: p1.ID, Title: "Task 1A"})
	db.CreateTask(CreateTaskInput{ProjectID: p1.ID, Title: "Task 1B"})
	db.CreateTask(CreateTaskInput{ProjectID: p2.ID, Title: "Task 2A"})

	// Filter by project 1
	tasks, err := db.ListTasks(TaskFilter{ProjectID: &p1.ID})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Errorf("expected 2 tasks for p1, got %d", len(tasks))
	}

	// Filter by project 2
	tasks, err = db.ListTasks(TaskFilter{ProjectID: &p2.ID})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Errorf("expected 1 task for p2, got %d", len(tasks))
	}
}

func TestListTasks_FilterByStatus(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})

	t1, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "Task 1"})
	db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "Task 2"})

	inProgress := TaskStatusInProgress
	db.UpdateTask(t1.ID, UpdateTaskInput{Status: &inProgress})

	status := TaskStatusInProgress
	tasks, err := db.ListTasks(TaskFilter{Status: &status})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Errorf("expected 1 in_progress task, got %d", len(tasks))
	}
}

func TestDeleteTask(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})
	task, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "To Delete"})

	err := db.DeleteTask(task.ID)
	if err != nil {
		t.Fatalf("delete task: %v", err)
	}

	_, err = db.GetTask(task.ID)
	if err == nil {
		t.Error("expected error after deletion")
	}
}

// --- Session Tests ---

func TestCreateSession(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})
	task, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "Session Task"})

	session, err := db.CreateSession(CreateSessionInput{
		TaskID:   task.ID,
		Provider: "claude",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	if session.ID == "" {
		t.Error("expected non-empty ID")
	}
	if session.TaskID != task.ID {
		t.Errorf("expected task ID %q, got %q", task.ID, session.TaskID)
	}
	if session.Provider != "claude" {
		t.Errorf("expected provider 'claude', got %q", session.Provider)
	}
	if session.Status != SessionStatusIdle {
		t.Errorf("expected status 'idle', got %q", session.Status)
	}
}

func TestListSessionsByTask(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})
	task, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "T"})

	db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "claude"})
	db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "claude"})

	sessions, err := db.ListSessionsByTask(task.ID)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestUpdateSession(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})
	task, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "T"})
	session, _ := db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "claude"})

	running := SessionStatusRunning
	window := "@1"
	pane := "%1"
	updated, err := db.UpdateSession(session.ID, UpdateSessionInput{
		Status:     &running,
		TmuxWindow: &window,
		TmuxPane:   &pane,
	})
	if err != nil {
		t.Fatalf("update session: %v", err)
	}

	if updated.Status != SessionStatusRunning {
		t.Errorf("expected status 'running', got %q", updated.Status)
	}
	if updated.TmuxWindow == nil || *updated.TmuxWindow != "@1" {
		t.Errorf("expected tmux window '@1', got %v", updated.TmuxWindow)
	}
}

func TestListActiveSessions(t *testing.T) {
	db := openTestDB(t)

	project, _ := db.CreateProject(CreateProjectInput{Name: "p", Path: "/tmp/p"})
	task, _ := db.CreateTask(CreateTaskInput{ProjectID: project.ID, Title: "T"})

	// Create sessions with various statuses
	s1, _ := db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "claude"})
	s2, _ := db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "terminal"})
	s3, _ := db.CreateSession(CreateSessionInput{TaskID: task.ID, Provider: "claude"})

	// s1: running, s2: completed, s3: waiting_input
	runningStatus := SessionStatusRunning
	completedStatus := SessionStatusCompleted
	waitingStatus := SessionStatusWaitingInput
	db.UpdateSession(s1.ID, UpdateSessionInput{Status: &runningStatus})
	db.UpdateSession(s2.ID, UpdateSessionInput{Status: &completedStatus})
	db.UpdateSession(s3.ID, UpdateSessionInput{Status: &waitingStatus})

	active, err := db.ListActiveSessions()
	if err != nil {
		t.Fatalf("list active sessions: %v", err)
	}

	// Should return s1 (running) and s3 (waiting_input), not s2 (completed)
	if len(active) != 2 {
		t.Fatalf("expected 2 active sessions, got %d", len(active))
	}

	ids := map[string]bool{}
	for _, s := range active {
		ids[s.ID] = true
	}
	if !ids[s1.ID] {
		t.Error("expected running session to be included")
	}
	if ids[s2.ID] {
		t.Error("expected completed session to be excluded")
	}
	if !ids[s3.ID] {
		t.Error("expected waiting_input session to be included")
	}
}
