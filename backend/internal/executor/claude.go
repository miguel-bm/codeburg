package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/miguel/codeburg/internal/tmux"
)

// ClaudeExecutor implements the Executor interface for Claude Code CLI
type ClaudeExecutor struct {
	tmux *tmux.Manager
}

// NewClaudeExecutor creates a new Claude executor
func NewClaudeExecutor(tmuxMgr *tmux.Manager) *ClaudeExecutor {
	return &ClaudeExecutor{
		tmux: tmuxMgr,
	}
}

// Provider returns the provider type
func (e *ClaudeExecutor) Provider() Provider {
	return ProviderClaude
}

// Available checks if claude CLI is installed
func (e *ClaudeExecutor) Available() bool {
	cmd := exec.Command("claude", "--version")
	return cmd.Run() == nil
}

// Start begins a new Claude session
func (e *ClaudeExecutor) Start(ctx context.Context, opts StartOptions) (*Session, error) {
	// Ensure tmux session exists
	if err := e.tmux.EnsureSession(); err != nil {
		return nil, fmt.Errorf("ensure tmux session: %w", err)
	}

	// Build claude command
	args := e.buildArgs(opts)

	// Generate window name
	windowName := fmt.Sprintf("claude-%d", time.Now().Unix())

	// Create tmux window
	windowInfo, err := e.tmux.CreateWindow(windowName, opts.WorkDir)
	if err != nil {
		return nil, fmt.Errorf("create tmux window: %w", err)
	}

	// Build command string
	cmdStr := "claude " + strings.Join(args, " ")

	// Send command to window
	if err := e.tmux.SendKeys(windowInfo.Target, cmdStr, true); err != nil {
		e.tmux.DestroyWindow(windowInfo.Window)
		return nil, fmt.Errorf("send command: %w", err)
	}

	// Create event channel
	events := make(chan AgentEvent, 100)
	done := make(chan struct{})

	// Start output parser goroutine
	go e.parseOutput(ctx, windowInfo.Target, events, done)

	session := &Session{
		Provider:   ProviderClaude,
		Status:     StatusRunning,
		TmuxWindow: windowInfo.Window,
		TmuxPane:   windowInfo.Pane,
		Events:     events,
		done:       done,
	}

	return session, nil
}

// Resume resumes an existing Claude session
func (e *ClaudeExecutor) Resume(ctx context.Context, sessionID string, workDir string, message string) (*Session, error) {
	opts := StartOptions{
		WorkDir:   workDir,
		SessionID: sessionID,
		Prompt:    message,
	}
	return e.Start(ctx, opts)
}

// Stop terminates a running session
func (e *ClaudeExecutor) Stop(session *Session) error {
	// Send Ctrl+C to stop the agent
	if err := e.tmux.SendSignal(fmt.Sprintf("%s:%s", tmux.SessionName, session.TmuxWindow), "INT"); err != nil {
		// Try to kill the window instead
		return e.tmux.DestroyWindow(session.TmuxWindow)
	}
	return nil
}

// SendMessage sends a message to a running session
func (e *ClaudeExecutor) SendMessage(session *Session, message string) error {
	target := fmt.Sprintf("%s:%s.%s", tmux.SessionName, session.TmuxWindow, session.TmuxPane)
	return e.tmux.SendKeys(target, message, true)
}

// buildArgs constructs the claude CLI arguments
func (e *ClaudeExecutor) buildArgs(opts StartOptions) []string {
	args := []string{
		"--output-format", "stream-json",
	}

	// Resume existing session
	if opts.SessionID != "" {
		args = append(args, "--resume", opts.SessionID)
	}

	// Specify model
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}

	// Add extra args
	args = append(args, opts.ExtraArgs...)

	// Add prompt (using -p for non-interactive prompt)
	if opts.Prompt != "" && opts.SessionID == "" {
		args = append(args, "-p", fmt.Sprintf("%q", opts.Prompt))
	}

	return args
}

// parseOutput reads and parses the agent's output stream
func (e *ClaudeExecutor) parseOutput(ctx context.Context, target string, events chan<- AgentEvent, done chan struct{}) {
	defer close(events)
	defer close(done)

	// Poll for output using capture-pane
	// In production, we'd use pipe-pane for real streaming
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	lastContent := ""
	var lineBuffer strings.Builder

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			content, err := e.tmux.CapturePane(target, 500)
			if err != nil {
				// Pane might be closed
				events <- AgentEvent{
					Type:      EventTypeStatus,
					Timestamp: time.Now(),
					Content:   string(StatusCompleted),
				}
				return
			}

			// Only process new content
			if len(content) > len(lastContent) {
				newContent := content[len(lastContent):]
				lastContent = content

				// Process line by line
				lineBuffer.WriteString(newContent)
				lines := strings.Split(lineBuffer.String(), "\n")

				// Keep incomplete line in buffer
				if !strings.HasSuffix(newContent, "\n") && len(lines) > 0 {
					lineBuffer.Reset()
					lineBuffer.WriteString(lines[len(lines)-1])
					lines = lines[:len(lines)-1]
				} else {
					lineBuffer.Reset()
				}

				for _, line := range lines {
					if line == "" {
						continue
					}
					event := e.parseLine(line)
					if event != nil {
						events <- *event
					}
				}
			}
		}
	}
}

// parseLine parses a single line of output into an AgentEvent
func (e *ClaudeExecutor) parseLine(line string) *AgentEvent {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	// Try to parse as JSON (stream-json format)
	if strings.HasPrefix(line, "{") {
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			return e.parseClaudeJSON(line, raw)
		}
	}

	// Non-JSON output (system messages, errors, etc.)
	return &AgentEvent{
		Type:      EventTypeSystem,
		Timestamp: time.Now(),
		Content:   line,
	}
}

// parseClaudeJSON parses Claude's stream-json format
func (e *ClaudeExecutor) parseClaudeJSON(line string, raw map[string]interface{}) *AgentEvent {
	event := &AgentEvent{
		Timestamp: time.Now(),
		Raw:       json.RawMessage(line),
	}

	// Detect event type from Claude's output format
	// Claude CLI stream-json format varies, so we handle common patterns

	if msgType, ok := raw["type"].(string); ok {
		switch msgType {
		case "assistant":
			event.Type = EventTypeAssistant
			if content, ok := raw["content"].(string); ok {
				event.Content = content
			}
		case "user":
			event.Type = EventTypeUser
			if content, ok := raw["content"].(string); ok {
				event.Content = content
			}
		case "tool_use":
			event.Type = EventTypeToolUse
			event.ToolUse = &ToolUseEvent{
				ID:   getString(raw, "id"),
				Name: getString(raw, "name"),
			}
			if input, ok := raw["input"]; ok {
				if inputBytes, err := json.Marshal(input); err == nil {
					event.ToolUse.Input = inputBytes
				}
			}
		case "tool_result":
			event.Type = EventTypeToolResult
			event.ToolResult = &ToolResultEvent{
				ToolUseID: getString(raw, "tool_use_id"),
				Content:   getString(raw, "content"),
				IsError:   getBool(raw, "is_error"),
			}
		case "error":
			event.Type = EventTypeError
			event.Error = getString(raw, "message")
		case "result":
			// Session result/completion
			event.Type = EventTypeStatus
			event.Content = string(StatusCompleted)
			if sessionID, ok := raw["session_id"].(string); ok {
				event.Content = sessionID
			}
		default:
			event.Type = EventTypeSystem
			event.Content = line
		}
	} else {
		// Fallback for unrecognized format
		event.Type = EventTypeSystem
		event.Content = line
	}

	return event
}

// Helper functions for JSON parsing
func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}
