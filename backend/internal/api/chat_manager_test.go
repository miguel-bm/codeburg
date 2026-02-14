package api

import (
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

func setupChatManagerState(t *testing.T, provider string) (*ChatManager, *chatSessionState) {
	t.Helper()

	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	project, err := database.CreateProject(db.CreateProjectInput{
		Name: "chat-test",
		Path: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	row, err := database.CreateSession(db.CreateSessionInput{
		ProjectID:   project.ID,
		Provider:    provider,
		SessionType: "chat",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	manager := NewChatManager(database)
	state, err := manager.ensureSession(row.ID, provider, "")
	if err != nil {
		t.Fatalf("ensure session: %v", err)
	}
	return manager, state
}

func TestChatManager_ClaudeInitSystemStoredAsMetadata(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")

	manager.handleClaudePayload(state, map[string]any{
		"type":           "system",
		"subtype":        "init",
		"session_id":     "claude-provider-id",
		"slash_commands": []any{"help", "review"},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected init metadata message, got %d", len(state.messages))
	}
	msg := state.messages[0]
	if msg.Kind != ChatMessageKindSystem {
		t.Fatalf("expected system message, got %q", msg.Kind)
	}
	if msg.Text != "init" {
		t.Fatalf("expected init text, got %q", msg.Text)
	}
	if msg.Data == nil {
		t.Fatalf("expected metadata payload on init message")
	}
	if state.providerSessionID != "claude-provider-id" {
		t.Fatalf("expected provider session id to update")
	}
}

func TestChatManager_ClaudeResultSuccessIsIgnored(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")

	manager.handleClaudePayload(state, map[string]any{
		"type":       "result",
		"subtype":    "success",
		"is_error":   false,
		"result":     "duplicate assistant text",
		"session_id": "claude-provider-id",
	})

	if len(state.messages) != 0 {
		t.Fatalf("expected no result message for non-error envelope, got %d", len(state.messages))
	}
}

func TestChatManager_ClaudeUserStringWithoutSubagentIgnored(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")

	manager.handleClaudePayload(state, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": "This is provider-side text, not human input",
		},
	})

	if len(state.messages) != 0 {
		t.Fatalf("expected provider user string to be ignored, got %d messages", len(state.messages))
	}
}

func TestChatManager_ClaudeTaskSidechainPromptIsAgentSubagentMessage(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")
	prompt := "Search for TypeScript 5.6 features"

	manager.handleClaudePayload(state, map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []any{
				map[string]any{
					"type": "tool_use",
					"id":   "task-call-1",
					"name": "Task",
					"input": map[string]any{
						"prompt":        prompt,
						"description":   "Search TypeScript docs",
						"subagent_type": "general-purpose",
					},
				},
			},
		},
	})

	if len(state.messages) != 0 {
		t.Fatalf("expected hidden parent Task tool call, got %d messages", len(state.messages))
	}

	manager.handleClaudePayload(state, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": prompt,
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected one sidechain message, got %d", len(state.messages))
	}

	msg := state.messages[0]
	if msg.Kind != ChatMessageKindAgentText {
		t.Fatalf("expected agent-text, got %q", msg.Kind)
	}
	if msg.Role != "assistant" {
		t.Fatalf("expected assistant role, got %q", msg.Role)
	}
	if msg.Text != prompt {
		t.Fatalf("unexpected text: %q", msg.Text)
	}
	if msg.Data == nil {
		t.Fatalf("expected subagent metadata")
	}
	subagentID, _ := msg.Data["subagentId"].(string)
	if subagentID == "" {
		t.Fatalf("expected subagent id metadata")
	}
	subagentTitle, _ := msg.Data["subagentTitle"].(string)
	if subagentTitle != "Search TypeScript docs" {
		t.Fatalf("expected subagent title from Task description, got %q", subagentTitle)
	}
}

func TestChatManager_ClaudeTaskParentToolResultDoesNotEmitToolEndCard(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")
	prompt := "Run side task"

	manager.handleClaudePayload(state, map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []any{
				map[string]any{
					"type": "tool_use",
					"id":   "task-call-2",
					"name": "Task",
					"input": map[string]any{
						"prompt": prompt,
					},
				},
			},
		},
	})
	manager.handleClaudePayload(state, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": prompt,
		},
	})
	manager.handleClaudePayload(state, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"tool_use_id": "task-call-2",
					"content":     "done",
				},
			},
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected no extra Task parent tool messages, got %d", len(state.messages))
	}
	if state.messages[0].Kind != ChatMessageKindAgentText {
		t.Fatalf("expected only subagent text message, got %q", state.messages[0].Kind)
	}
}

func TestChatManager_ClaudeNonTaskToolCallStillCompletes(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")

	manager.handleClaudePayload(state, map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []any{
				map[string]any{
					"type": "tool_use",
					"id":   "tool-1",
					"name": "Bash",
					"input": map[string]any{
						"command": "echo hi",
					},
				},
			},
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected one tool-call message, got %d", len(state.messages))
	}
	if state.messages[0].Kind != ChatMessageKindToolCall {
		t.Fatalf("expected tool-call, got %q", state.messages[0].Kind)
	}
	if state.messages[0].Tool == nil || state.messages[0].Tool.State != ChatToolStateRunning {
		t.Fatalf("expected running tool-call")
	}

	manager.handleClaudePayload(state, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"tool_use_id": "tool-1",
					"content":     "ok",
				},
			},
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected tool-call update in place, got %d messages", len(state.messages))
	}
	if state.messages[0].Tool == nil || state.messages[0].Tool.State != ChatToolStateCompleted {
		t.Fatalf("expected completed tool-call")
	}
}

func TestChatManager_CodexItemCompletedAgentMessage(t *testing.T) {
	manager, state := setupChatManagerState(t, "codex")

	manager.handleCodexPayload(state, map[string]any{
		"type": "item.completed",
		"item": map[string]any{
			"type": "agent_message",
			"text": "Hello from codex",
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(state.messages))
	}
	msg := state.messages[0]
	if msg.Kind != ChatMessageKindAgentText {
		t.Fatalf("expected agent-text message, got %q", msg.Kind)
	}
	if msg.Text != "Hello from codex" {
		t.Fatalf("unexpected message text: %q", msg.Text)
	}
}

func TestChatManager_CodexItemCompletedAgentMessageContentFallback(t *testing.T) {
	manager, state := setupChatManagerState(t, "codex")

	manager.handleCodexPayload(state, map[string]any{
		"type": "item.completed",
		"item": map[string]any{
			"type": "agent_message",
			"content": []any{
				map[string]any{"type": "output_text", "text": "Part one"},
				map[string]any{"type": "output_text", "text": "Part two"},
			},
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(state.messages))
	}
	if state.messages[0].Text != "Part one\n\nPart two" {
		t.Fatalf("unexpected fallback text: %q", state.messages[0].Text)
	}
}

func TestChatManager_CodexEventEnvelope(t *testing.T) {
	manager, state := setupChatManagerState(t, "codex")

	manager.handleCodexPayload(state, map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type":    "agent_message",
			"message": "Hello from event envelope",
		},
	})

	if len(state.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(state.messages))
	}
	if state.messages[0].Kind != ChatMessageKindAgentText {
		t.Fatalf("expected agent-text, got %q", state.messages[0].Kind)
	}
	if state.messages[0].Text != "Hello from event envelope" {
		t.Fatalf("unexpected message text: %q", state.messages[0].Text)
	}
}

func TestChatManager_EnsureSessionRewritesSessionIDFromStoredPayload(t *testing.T) {
	manager, state := setupChatManagerState(t, "claude")

	_, err := manager.db.CreateAgentMessage(db.CreateAgentMessageInput{
		SessionID: state.id,
		Seq:       1,
		Kind:      string(ChatMessageKindAgentText),
		PayloadJSON: `{
			"id":"stored-1",
			"kind":"agent-text",
			"provider":"claude",
			"sessionId":"old-session-id",
			"text":"from history"
		}`,
	})
	if err != nil {
		t.Fatalf("create stored message: %v", err)
	}

	manager.RemoveSession(state.id)
	restored, err := manager.ensureSession(state.id, "claude", "")
	if err != nil {
		t.Fatalf("ensure session: %v", err)
	}
	if len(restored.messages) != 1 {
		t.Fatalf("expected 1 restored message, got %d", len(restored.messages))
	}
	if restored.messages[0].SessionID != state.id {
		t.Fatalf("expected restored sessionId %q, got %q", state.id, restored.messages[0].SessionID)
	}
}
