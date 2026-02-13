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
