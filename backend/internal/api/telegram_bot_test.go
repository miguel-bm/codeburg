package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/telegram"
)

func TestTelegramCommandCreateTaskAndList(t *testing.T) {
	env := setupTestEnv(t)

	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name: "Alpha",
		Path: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	createOut, err := env.server.handleTelegramCommand(t.Context(), telegram.IncomingMessage{
		IsCommand: true,
		Command:   "newtask",
		Args:      project.Name + " | add telegram bot",
	})
	if err != nil {
		t.Fatalf("create command failed: %v", err)
	}
	if !strings.Contains(createOut, "Created task") {
		t.Fatalf("unexpected create output: %s", createOut)
	}

	listOut, err := env.server.handleTelegramCommand(t.Context(), telegram.IncomingMessage{
		IsCommand: true,
		Command:   "tasks",
	})
	if err != nil {
		t.Fatalf("tasks command failed: %v", err)
	}
	if !strings.Contains(listOut, "add telegram bot") {
		t.Fatalf("tasks output missing created task: %s", listOut)
	}
}

func TestTelegramToolCallMoveTask(t *testing.T) {
	env := setupTestEnv(t)

	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name: "Beta",
		Path: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	task, err := env.server.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     "move me",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	result := env.server.telegramRunToolCall("move_task", `{"task_id":"`+task.ID+`","status":"in_progress"}`)
	if ok, _ := result["ok"].(bool); !ok {
		t.Fatalf("tool call failed: %#v", result)
	}

	updated, err := env.server.db.GetTask(task.ID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if updated.Status != db.TaskStatusInProgress {
		t.Fatalf("expected status in_progress, got %s", updated.Status)
	}
}

func TestFlattenResponseOutputText(t *testing.T) {
	got := flattenResponseOutputText([]openAIResponseOutput{
		{
			Type: "message",
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "output_text", Text: "line 1"},
				{Type: "output_text", Text: "line 2"},
			},
		},
	})
	if got != "line 1\nline 2" {
		t.Fatalf("unexpected flattened content: %q", got)
	}
}

func TestTelegramCommandProjectsAndSessions(t *testing.T) {
	env := setupTestEnv(t)

	repoPath := createTestGitRepoWithMain(t)
	defaultBranch := "main"
	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name:          "Gamma",
		Path:          repoPath,
		DefaultBranch: &defaultBranch,
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	task, err := env.server.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     "session list task",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	worktree := repoPath
	if _, err := env.server.db.UpdateTask(task.ID, db.UpdateTaskInput{WorktreePath: &worktree}); err != nil {
		t.Fatalf("set worktree: %v", err)
	}
	if _, err := env.server.startSessionInternal(startSessionParams{
		ProjectID: project.ID,
		TaskID:    task.ID,
		WorkDir:   repoPath,
	}, StartSessionRequest{Provider: "terminal"}); err != nil {
		t.Fatalf("start terminal session: %v", err)
	}

	projectsOut, err := env.server.handleTelegramCommand(t.Context(), telegram.IncomingMessage{
		IsCommand: true,
		Command:   "projects",
	})
	if err != nil {
		t.Fatalf("projects command failed: %v", err)
	}
	if !strings.Contains(projectsOut, "Gamma") {
		t.Fatalf("projects output missing project: %s", projectsOut)
	}

	sessionsOut, err := env.server.handleTelegramCommand(t.Context(), telegram.IncomingMessage{
		IsCommand: true,
		Command:   "sessions",
	})
	if err != nil {
		t.Fatalf("sessions command failed: %v", err)
	}
	if !strings.Contains(sessionsOut, "terminal") {
		t.Fatalf("sessions output missing terminal session: %s", sessionsOut)
	}
}

func TestTelegramToolCallStompRequiresConfirm(t *testing.T) {
	env := setupTestEnv(t)
	repoPath := createTestGitRepoWithMain(t)
	defaultBranch := "main"
	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name:          "Stomp Tool",
		Path:          repoPath,
		DefaultBranch: &defaultBranch,
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	task, err := env.server.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     "stomp tool task",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := env.server.db.UpdateTask(task.ID, db.UpdateTaskInput{WorktreePath: &repoPath}); err != nil {
		t.Fatalf("set worktree: %v", err)
	}

	if err := os.WriteFile(filepath.Join(repoPath, "bot.txt"), []byte("one"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := runGit(repoPath, "add", "-A"); err != nil {
		t.Fatalf("git add: %v", err)
	}
	if _, err := runGit(repoPath, "commit", "-m", "first"); err != nil {
		t.Fatalf("git commit: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "bot.txt"), []byte("two"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	rejected := env.server.telegramRunToolCall("stomp_task_branch", `{"task_id":"`+task.ID+`","confirm":false}`)
	if ok, _ := rejected["ok"].(bool); ok {
		t.Fatalf("expected stomp to be rejected without confirm=true: %#v", rejected)
	}
}

func TestTelegramToolCallStageCommitPush(t *testing.T) {
	env := setupTestEnv(t)
	repoPath := createTestGitRepoWithMain(t)
	defaultBranch := "main"
	project, err := env.server.db.CreateProject(db.CreateProjectInput{
		Name:          "Push Tool",
		Path:          repoPath,
		DefaultBranch: &defaultBranch,
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	task, err := env.server.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     "push tool task",
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := env.server.db.UpdateTask(task.ID, db.UpdateTaskInput{WorktreePath: &repoPath}); err != nil {
		t.Fatalf("set worktree: %v", err)
	}

	remotePath := t.TempDir()
	if _, err := runGit(remotePath, "init", "--bare"); err != nil {
		t.Fatalf("init bare remote: %v", err)
	}
	if _, err := runGit(repoPath, "remote", "add", "origin", remotePath); err != nil {
		t.Fatalf("add remote: %v", err)
	}

	if err := os.WriteFile(filepath.Join(repoPath, "bot-stage.txt"), []byte("hello"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	stageRes := env.server.telegramRunToolCall("stage_task_files", `{"task_id":"`+task.ID+`","files":["bot-stage.txt"]}`)
	if ok, _ := stageRes["ok"].(bool); !ok {
		t.Fatalf("stage tool failed: %#v", stageRes)
	}

	commitRes := env.server.telegramRunToolCall("commit_task_branch", `{"task_id":"`+task.ID+`","message":"telegram commit"}`)
	if ok, _ := commitRes["ok"].(bool); !ok {
		t.Fatalf("commit tool failed: %#v", commitRes)
	}

	pushRes := env.server.telegramRunToolCall("push_task_branch", `{"task_id":"`+task.ID+`"}`)
	if ok, _ := pushRes["ok"].(bool); !ok {
		t.Fatalf("push tool failed: %#v", pushRes)
	}
}

func TestTelegramCommandsDoNotEnterAssistantMemory(t *testing.T) {
	env := setupTestEnv(t)
	_, err := env.server.handleTelegramCommand(t.Context(), telegram.IncomingMessage{
		ChatID:    123,
		IsCommand: true,
		Command:   "help",
	})
	if err != nil {
		t.Fatalf("handle command: %v", err)
	}
	got := env.server.telegramAssistantMemorySnapshot(123)
	if len(got) != 0 {
		t.Fatalf("expected no command memory turns, got %d", len(got))
	}
}

func TestTelegramAssistantMemoryPersistAndLoad(t *testing.T) {
	env := setupTestEnv(t)
	env.server.telegramAssistantMemoryAppend(321, "hello", "world")

	env.server.telegramMemoryMu.Lock()
	env.server.telegramMemory = make(map[int64][]telegramAssistantMemoryTurn)
	env.server.telegramMemoryMu.Unlock()

	env.server.telegramLoadAssistantMemory()
	got := env.server.telegramAssistantMemorySnapshot(321)
	if len(got) != 1 {
		t.Fatalf("expected 1 restored turn, got %d", len(got))
	}
	if got[0].User != "hello" || got[0].Assistant != "world" {
		t.Fatalf("unexpected restored turn: %#v", got[0])
	}
}
