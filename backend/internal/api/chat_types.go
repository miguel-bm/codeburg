package api

import "time"

type ChatMessageKind string

const (
	ChatMessageKindUserText  ChatMessageKind = "user-text"
	ChatMessageKindAgentText ChatMessageKind = "agent-text"
	ChatMessageKindToolCall  ChatMessageKind = "tool-call"
	ChatMessageKindSystem    ChatMessageKind = "system"
	ChatMessageKindResult    ChatMessageKind = "result"
)

type ChatToolState string

const (
	ChatToolStateRunning   ChatToolState = "running"
	ChatToolStateCompleted ChatToolState = "completed"
	ChatToolStateError     ChatToolState = "error"
)

type ChatToolCall struct {
	CallID      string        `json:"callId"`
	Name        string        `json:"name"`
	Title       string        `json:"title,omitempty"`
	Description string        `json:"description,omitempty"`
	State       ChatToolState `json:"state"`
	Input       any           `json:"input,omitempty"`
	Result      any           `json:"result,omitempty"`
	IsError     bool          `json:"isError,omitempty"`
}

type ChatMessage struct {
	ID         string          `json:"id"`
	SessionID  string          `json:"sessionId,omitempty"`
	Seq        int64           `json:"seq,omitempty"`
	Kind       ChatMessageKind `json:"kind"`
	Provider   string          `json:"provider"`
	Role       string          `json:"role,omitempty"`
	Text       string          `json:"text,omitempty"`
	IsThinking bool            `json:"isThinking,omitempty"`
	Tool       *ChatToolCall   `json:"tool,omitempty"`
	Data       map[string]any  `json:"data,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}
