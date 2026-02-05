package executor

import (
	"context"
	"encoding/json"
	"time"
)

// Provider represents an AI agent provider
type Provider string

const (
	ProviderClaude Provider = "claude"
	ProviderCodex  Provider = "codex" // Future
)

// SessionStatus represents the current state of an agent session
type SessionStatus string

const (
	StatusIdle         SessionStatus = "idle"
	StatusRunning      SessionStatus = "running"
	StatusWaitingInput SessionStatus = "waiting_input"
	StatusCompleted    SessionStatus = "completed"
	StatusError        SessionStatus = "error"
)

// AgentEvent represents a parsed event from the agent's output stream
type AgentEvent struct {
	Type      EventType       `json:"type"`
	Timestamp time.Time       `json:"timestamp"`
	Content   string          `json:"content,omitempty"`
	ToolUse   *ToolUseEvent   `json:"tool_use,omitempty"`
	ToolResult *ToolResultEvent `json:"tool_result,omitempty"`
	Error     string          `json:"error,omitempty"`
	Raw       json.RawMessage `json:"raw,omitempty"`
}

// EventType categorizes agent events
type EventType string

const (
	EventTypeSystem     EventType = "system"
	EventTypeAssistant  EventType = "assistant"
	EventTypeUser       EventType = "user"
	EventTypeToolUse    EventType = "tool_use"
	EventTypeToolResult EventType = "tool_result"
	EventTypeError      EventType = "error"
	EventTypeStatus     EventType = "status"
)

// ToolUseEvent contains details about a tool being used
type ToolUseEvent struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// ToolResultEvent contains the result of a tool use
type ToolResultEvent struct {
	ToolUseID string `json:"tool_use_id"`
	Content   string `json:"content"`
	IsError   bool   `json:"is_error"`
}

// StartOptions contains options for starting an agent session
type StartOptions struct {
	WorkDir   string   // Working directory for the agent
	Prompt    string   // Initial prompt/message
	Model     string   // Model to use (provider-specific)
	SessionID string   // For resuming sessions
	ExtraArgs []string // Additional CLI arguments
}

// Executor defines the interface for AI agent executors
type Executor interface {
	// Provider returns the provider type
	Provider() Provider

	// Available checks if the executor's CLI is installed
	Available() bool

	// Start begins a new agent session
	Start(ctx context.Context, opts StartOptions) (*Session, error)

	// Resume resumes an existing session
	Resume(ctx context.Context, sessionID string, workDir string, message string) (*Session, error)

	// Stop terminates a running session
	Stop(session *Session) error
}

// Session represents a running agent session
type Session struct {
	// ID is the Codeburg session ID
	ID string

	// ProviderSessionID is the provider's session ID (for resume)
	ProviderSessionID string

	// Provider is the agent provider
	Provider Provider

	// Status is the current session status
	Status SessionStatus

	// TmuxWindow is the tmux window ID
	TmuxWindow string

	// TmuxPane is the tmux pane ID
	TmuxPane string

	// Events is a channel for receiving agent events
	Events <-chan AgentEvent

	// done is closed when the session ends
	done chan struct{}
}

// Done returns a channel that's closed when the session ends
func (s *Session) Done() <-chan struct{} {
	return s.done
}
