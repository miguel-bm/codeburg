package api

import (
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

func TestFlattenAssistantContent(t *testing.T) {
	got := flattenAssistantContent([]any{
		map[string]any{"type": "text", "text": "line 1"},
		map[string]any{"type": "text", "text": "line 2"},
	})
	if got != "line 1\nline 2" {
		t.Fatalf("unexpected flattened content: %q", got)
	}
}
