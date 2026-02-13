package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

var (
	ErrChatSessionNotFound = errors.New("chat session not found")
	ErrChatTurnBusy        = errors.New("chat turn already running")
)

const chatSubBufferSize = 256

type ChatTurnResult struct {
	SessionID   string
	Err         error
	Interrupted bool
}

type StartChatTurnInput struct {
	SessionID string
	Provider  string
	WorkDir   string
	Prompt    string
	Model     string
}

type chatSessionState struct {
	id                string
	provider          string
	model             string
	providerSessionID string

	mu       sync.Mutex
	seq      int64
	messages []ChatMessage
	toolByID map[string]int
	subs     map[uint64]chan ChatMessage
	nextSub  uint64

	running bool
	cancel  context.CancelFunc
}

type ChatManager struct {
	db *db.DB

	mu       sync.RWMutex
	sessions map[string]*chatSessionState
}

func NewChatManager(database *db.DB) *ChatManager {
	return &ChatManager{
		db:       database,
		sessions: make(map[string]*chatSessionState),
	}
}

func (m *ChatManager) RegisterSession(sessionID, provider, model string) error {
	_, err := m.ensureSession(sessionID, provider, model)
	return err
}

func (m *ChatManager) RemoveSession(sessionID string) {
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
}

func (m *ChatManager) Interrupt(sessionID string) bool {
	state, err := m.ensureSession(sessionID, "", "")
	if err != nil {
		return false
	}

	state.mu.Lock()
	cancel := state.cancel
	running := state.running
	state.mu.Unlock()
	if !running || cancel == nil {
		return false
	}
	cancel()
	return true
}

func (m *ChatManager) Attach(sessionID string) ([]ChatMessage, <-chan ChatMessage, func(), error) {
	state, err := m.ensureSession(sessionID, "", "")
	if err != nil {
		return nil, nil, nil, err
	}

	state.mu.Lock()
	snapshot := make([]ChatMessage, len(state.messages))
	copy(snapshot, state.messages)

	subID := state.nextSub
	state.nextSub++
	ch := make(chan ChatMessage, chatSubBufferSize)
	state.subs[subID] = ch
	state.mu.Unlock()

	cancel := func() {
		state.mu.Lock()
		if existing, ok := state.subs[subID]; ok {
			close(existing)
			delete(state.subs, subID)
		}
		state.mu.Unlock()
	}

	return snapshot, ch, cancel, nil
}

func (m *ChatManager) StartTurn(input StartChatTurnInput) (<-chan ChatTurnResult, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	state, err := m.ensureSession(input.SessionID, input.Provider, input.Model)
	if err != nil {
		return nil, err
	}

	state.mu.Lock()
	if state.running {
		state.mu.Unlock()
		return nil, ErrChatTurnBusy
	}
	ctx, cancel := context.WithCancel(context.Background())
	state.running = true
	state.cancel = cancel
	state.mu.Unlock()

	m.appendMessage(state, ChatMessage{
		Kind:      ChatMessageKindUserText,
		Provider:  state.provider,
		Role:      "user",
		Text:      strings.TrimSpace(input.Prompt),
		CreatedAt: time.Now().UTC(),
	})

	resultCh := make(chan ChatTurnResult, 1)
	go m.runTurn(state, ctx, StartChatTurnInput{
		SessionID: input.SessionID,
		Provider:  state.provider,
		WorkDir:   input.WorkDir,
		Prompt:    strings.TrimSpace(input.Prompt),
		Model:     state.model,
	}, resultCh)
	return resultCh, nil
}

func (m *ChatManager) runTurn(state *chatSessionState, ctx context.Context, input StartChatTurnInput, resultCh chan<- ChatTurnResult) {
	defer close(resultCh)

	state.mu.Lock()
	resumeProviderSessionID := state.providerSessionID
	state.mu.Unlock()

	command, args, err := buildChatTurnCommand(input.Provider, input.Prompt, input.Model, resumeProviderSessionID)
	if err != nil {
		m.finishTurn(state)
		resultCh <- ChatTurnResult{SessionID: input.SessionID, Err: err}
		return
	}

	originalCommand := command
	command, args = withShellFallback(command, args)
	if originalCommand != command {
		slog.Warn("provider command not found in service PATH, using login-shell fallback",
			"session_id", input.SessionID,
			"provider", input.Provider,
			"command", originalCommand,
		)
	}

	cmd := exec.CommandContext(ctx, command, args...)
	if input.WorkDir != "" {
		cmd.Dir = input.WorkDir
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.finishTurn(state)
		resultCh <- ChatTurnResult{SessionID: input.SessionID, Err: fmt.Errorf("stdout pipe: %w", err)}
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.finishTurn(state)
		resultCh <- ChatTurnResult{SessionID: input.SessionID, Err: fmt.Errorf("stderr pipe: %w", err)}
		return
	}

	if err := cmd.Start(); err != nil {
		m.finishTurn(state)
		resultCh <- ChatTurnResult{SessionID: input.SessionID, Err: fmt.Errorf("start process: %w", err)}
		return
	}

	var stderrBuf bytes.Buffer
	var stderrWG sync.WaitGroup
	stderrWG.Add(1)
	go func() {
		defer stderrWG.Done()
		_, _ = io.Copy(&stderrBuf, stderr)
	}()

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		m.handleProviderLine(state, input.Provider, line)
	}

	scanErr := scanner.Err()
	waitErr := cmd.Wait()
	stderrWG.Wait()

	interrupted := errors.Is(ctx.Err(), context.Canceled)
	if interrupted && waitErr != nil {
		waitErr = nil
	}
	if interrupted {
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  input.Provider,
			Text:      "Interrupted",
			Data:      map[string]any{"type": "interrupt"},
			CreatedAt: time.Now().UTC(),
		})
	}

	var turnErr error
	switch {
	case scanErr != nil && !interrupted:
		turnErr = fmt.Errorf("read output: %w", scanErr)
	case waitErr != nil && !interrupted:
		turnErr = fmt.Errorf("process exit: %w", waitErr)
	}

	if turnErr != nil {
		stderrText := strings.TrimSpace(stderrBuf.String())
		if stderrText == "" {
			stderrText = turnErr.Error()
		}
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  input.Provider,
			Text:      stderrText,
			Data:      map[string]any{"type": "error"},
			CreatedAt: time.Now().UTC(),
		})
	}

	m.finishTurn(state)
	resultCh <- ChatTurnResult{
		SessionID:   input.SessionID,
		Err:         turnErr,
		Interrupted: interrupted,
	}
}

func (m *ChatManager) finishTurn(state *chatSessionState) {
	state.mu.Lock()
	state.running = false
	state.cancel = nil
	state.mu.Unlock()
}

func (m *ChatManager) handleProviderLine(state *chatSessionState, provider string, line string) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		return
	}

	switch provider {
	case "claude":
		m.handleClaudePayload(state, payload)
	case "codex":
		m.handleCodexPayload(state, payload)
	default:
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  provider,
			Text:      line,
			CreatedAt: time.Now().UTC(),
		})
	}
}

func (m *ChatManager) handleClaudePayload(state *chatSessionState, payload map[string]any) {
	msgType := asString(payload["type"])
	switch msgType {
	case "system":
		if sessionID := asString(payload["session_id"]); sessionID != "" {
			m.updateProviderSessionID(state, sessionID)
		}
		msg := ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  "claude",
			Text:      asString(payload["subtype"]),
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		}
		m.appendMessage(state, msg)

	case "assistant":
		content := claudeBlocks(payload)
		for _, block := range content {
			blockType := asString(block["type"])
			switch blockType {
			case "text":
				text := asString(block["text"])
				if text == "" {
					continue
				}
				m.appendMessage(state, ChatMessage{
					Kind:      ChatMessageKindAgentText,
					Provider:  "claude",
					Role:      "assistant",
					Text:      text,
					CreatedAt: time.Now().UTC(),
				})
			case "thinking":
				thinking := asString(block["thinking"])
				if thinking == "" {
					thinking = asString(block["text"])
				}
				if thinking == "" {
					continue
				}
				m.appendMessage(state, ChatMessage{
					Kind:       ChatMessageKindAgentText,
					Provider:   "claude",
					Role:       "assistant",
					Text:       thinking,
					IsThinking: true,
					CreatedAt:  time.Now().UTC(),
				})
			case "tool_use":
				callID := asString(block["id"])
				if callID == "" {
					callID = db.NewID()
				}
				name := asString(block["name"])
				title := name
				m.startToolCall(state, "claude", callID, name, title, "", block["input"])
			}
		}

	case "user":
		content := payload["message"]
		msgObj, _ := content.(map[string]any)
		if msgObj == nil {
			return
		}

		switch blocks := msgObj["content"].(type) {
		case string:
			text := strings.TrimSpace(blocks)
			if text != "" {
				m.appendMessage(state, ChatMessage{
					Kind:      ChatMessageKindUserText,
					Provider:  "claude",
					Role:      "user",
					Text:      text,
					CreatedAt: time.Now().UTC(),
				})
			}
		case []any:
			for _, raw := range blocks {
				block, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				switch asString(block["type"]) {
				case "text":
					text := asString(block["text"])
					if text == "" {
						continue
					}
					m.appendMessage(state, ChatMessage{
						Kind:      ChatMessageKindUserText,
						Provider:  "claude",
						Role:      "user",
						Text:      text,
						CreatedAt: time.Now().UTC(),
					})
				case "tool_result":
					callID := asString(block["tool_use_id"])
					if callID == "" {
						continue
					}
					result := block["content"]
					isErr := asBool(block["is_error"])
					m.finishToolCall(state, "claude", callID, result, isErr)
				}
			}
		}

	case "result":
		if sessionID := asString(payload["session_id"]); sessionID != "" {
			m.updateProviderSessionID(state, sessionID)
		}
		isErr := asBool(payload["is_error"])
		// Claude result envelopes commonly repeat the assistant text on success.
		// Keep them only for explicit errors.
		if !isErr {
			return
		}
		text := firstNonEmpty(asString(payload["result"]), asString(payload["subtype"]), "error")
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindResult,
			Provider:  "claude",
			Text:      text,
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})

	case "control_request":
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  "claude",
			Text:      "Permission request",
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})
	}
}

func (m *ChatManager) handleCodexPayload(state *chatSessionState, payload map[string]any) {
	msgType := asString(payload["type"])
	switch msgType {
	case "event_msg":
		eventPayload, _ := payload["payload"].(map[string]any)
		if eventPayload == nil {
			return
		}
		m.handleCodexPayload(state, eventPayload)
		return
	case "response_item":
		// response_item envelopes can duplicate event_msg content; use event_msg payloads.
		return
	case "session_meta", "turn_context", "token_count":
		return
	}

	if id := firstNonEmpty(
		asString(payload["session_id"]),
		asString(payload["sessionId"]),
		asString(payload["conversation_id"]),
		asString(payload["conversationId"]),
	); id != "" {
		m.updateProviderSessionID(state, id)
	}

	switch msgType {
	case "thread.started":
		return

	case "turn.started":
		return

	case "turn.completed":
		return

	case "item.started":
		item, _ := payload["item"].(map[string]any)
		if item == nil {
			return
		}
		itemType := asString(item["type"])
		if itemType != "command_execution" {
			return
		}
		callID := firstNonEmpty(asString(item["id"]), db.NewID())
		command := asString(item["command"])
		title := "Run command"
		if command != "" {
			title = "Run `" + command + "`"
		}
		m.startToolCall(state, "codex", callID, "CodexBash", title, command, cloneMap(item))

	case "item.completed":
		item, _ := payload["item"].(map[string]any)
		if item == nil {
			return
		}
		itemType := asString(item["type"])
		switch itemType {
		case "agent_message":
			text := codexItemText(item)
			if text == "" {
				return
			}
			m.appendMessage(state, ChatMessage{
				Kind:      ChatMessageKindAgentText,
				Provider:  "codex",
				Role:      "assistant",
				Text:      text,
				CreatedAt: time.Now().UTC(),
			})
		case "reasoning":
			text := codexItemText(item)
			if text == "" {
				return
			}
			m.appendMessage(state, ChatMessage{
				Kind:       ChatMessageKindAgentText,
				Provider:   "codex",
				Role:       "assistant",
				Text:       text,
				IsThinking: true,
				CreatedAt:  time.Now().UTC(),
			})
		case "command_execution":
			callID := firstNonEmpty(asString(item["id"]), asString(payload["call_id"]), asString(payload["callId"]))
			if callID == "" {
				return
			}
			isErr := false
			if code, ok := item["exit_code"].(float64); ok && code != 0 {
				isErr = true
			}
			status := asString(item["status"])
			if status == "failed" || status == "error" {
				isErr = true
			}
			result := map[string]any{
				"output":    item["aggregated_output"],
				"exit_code": item["exit_code"],
				"status":    item["status"],
				"command":   item["command"],
			}
			m.finishToolCall(state, "codex", callID, result, isErr)
		}

	case "task_started":
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  "codex",
			Text:      "Task started",
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})

	case "agent_message":
		text := asString(payload["message"])
		if text == "" {
			return
		}
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindAgentText,
			Provider:  "codex",
			Role:      "assistant",
			Text:      text,
			CreatedAt: time.Now().UTC(),
		})

	case "agent_reasoning", "agent_reasoning_delta":
		text := asString(payload["text"])
		if text == "" {
			text = asString(payload["delta"])
		}
		if text == "" {
			return
		}
		m.appendMessage(state, ChatMessage{
			Kind:       ChatMessageKindAgentText,
			Provider:   "codex",
			Role:       "assistant",
			Text:       text,
			IsThinking: true,
			CreatedAt:  time.Now().UTC(),
		})

	case "exec_command_begin", "exec_approval_request":
		callID := firstNonEmpty(asString(payload["call_id"]), asString(payload["callId"]))
		if callID == "" {
			callID = db.NewID()
		}
		cmdSummary := codexCommandSummary(payload["command"])
		title := "Run command"
		if cmdSummary != "" {
			title = "Run `" + cmdSummary + "`"
		}
		description := asString(payload["description"])
		if description == "" {
			description = cmdSummary
		}
		m.startToolCall(state, "codex", callID, "CodexBash", title, description, cloneMap(payload))

	case "exec_command_end":
		callID := firstNonEmpty(asString(payload["call_id"]), asString(payload["callId"]))
		if callID == "" {
			return
		}
		isErr := false
		if code, ok := payload["exit_code"].(float64); ok && code != 0 {
			isErr = true
		}
		if asString(payload["error"]) != "" {
			isErr = true
		}
		m.finishToolCall(state, "codex", callID, cloneMap(payload), isErr)

	case "patch_apply_begin":
		callID := firstNonEmpty(asString(payload["call_id"]), asString(payload["callId"]))
		if callID == "" {
			callID = db.NewID()
		}
		description := "Applying patch"
		if changes, ok := payload["changes"].(map[string]any); ok {
			fileCount := len(changes)
			if fileCount == 1 {
				description = "Applying patch to 1 file"
			} else if fileCount > 1 {
				description = fmt.Sprintf("Applying patch to %d files", fileCount)
			}
		}
		m.startToolCall(state, "codex", callID, "CodexPatch", "Apply patch", description, cloneMap(payload))

	case "patch_apply_end":
		callID := firstNonEmpty(asString(payload["call_id"]), asString(payload["callId"]))
		if callID == "" {
			return
		}
		isErr := false
		if success, ok := payload["success"].(bool); ok && !success {
			isErr = true
		}
		if asString(payload["stderr"]) != "" {
			isErr = true
		}
		m.finishToolCall(state, "codex", callID, cloneMap(payload), isErr)

	case "turn_diff":
		diff := asString(payload["unified_diff"])
		if diff == "" {
			return
		}
		m.appendMessage(state, ChatMessage{
			Kind:     ChatMessageKindToolCall,
			Provider: "codex",
			Tool: &ChatToolCall{
				CallID:  "diff-" + db.NewID(),
				Name:    "CodexDiff",
				Title:   "Diff",
				State:   ChatToolStateCompleted,
				Input:   map[string]any{"unified_diff": diff},
				Result:  map[string]any{"status": "completed"},
				IsError: false,
			},
			CreatedAt: time.Now().UTC(),
		})

	case "task_complete":
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindResult,
			Provider:  "codex",
			Text:      firstNonEmpty(asString(payload["message"]), "Task complete"),
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})

	case "turn_aborted":
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  "codex",
			Text:      "Turn aborted",
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})

	case "token_count":
		return

	default:
		message := asString(payload["message"])
		if message == "" {
			return
		}
		m.appendMessage(state, ChatMessage{
			Kind:      ChatMessageKindSystem,
			Provider:  "codex",
			Text:      message,
			Data:      cloneMap(payload),
			CreatedAt: time.Now().UTC(),
		})
	}
}

func (m *ChatManager) startToolCall(state *chatSessionState, provider, callID, name, title, description string, input any) {
	msg, _ := m.appendMessage(state, ChatMessage{
		Kind:     ChatMessageKindToolCall,
		Provider: provider,
		Tool: &ChatToolCall{
			CallID:      callID,
			Name:        name,
			Title:       title,
			Description: description,
			State:       ChatToolStateRunning,
			Input:       input,
		},
		CreatedAt: time.Now().UTC(),
	})

	state.mu.Lock()
	for i := range state.messages {
		if state.messages[i].ID == msg.ID {
			state.toolByID[callID] = i
			break
		}
	}
	state.mu.Unlock()
}

func (m *ChatManager) finishToolCall(state *chatSessionState, provider, callID string, result any, isErr bool) {
	state.mu.Lock()
	idx, ok := state.toolByID[callID]
	state.mu.Unlock()
	if !ok {
		toolState := ChatToolStateCompleted
		if isErr {
			toolState = ChatToolStateError
		}
		m.appendMessage(state, ChatMessage{
			Kind:     ChatMessageKindToolCall,
			Provider: provider,
			Tool: &ChatToolCall{
				CallID:  callID,
				Name:    "tool",
				Title:   "Tool call",
				State:   toolState,
				Result:  result,
				IsError: isErr,
			},
			CreatedAt: time.Now().UTC(),
		})
		return
	}

	state.mu.Lock()
	if idx < 0 || idx >= len(state.messages) {
		state.mu.Unlock()
		return
	}
	msg := state.messages[idx]
	if msg.Tool == nil {
		msg.Tool = &ChatToolCall{
			CallID: callID,
			Name:   "tool",
			Title:  "Tool call",
		}
	}
	if isErr {
		msg.Tool.State = ChatToolStateError
	} else {
		msg.Tool.State = ChatToolStateCompleted
	}
	msg.Tool.Result = result
	msg.Tool.IsError = isErr
	state.messages[idx] = msg
	subs := make([]chan ChatMessage, 0, len(state.subs))
	for _, ch := range state.subs {
		subs = append(subs, ch)
	}
	state.mu.Unlock()

	if payload, err := json.Marshal(msg); err == nil {
		if err := m.db.UpdateAgentMessagePayload(msg.ID, string(msg.Kind), string(payload)); err != nil && !errors.Is(err, db.ErrNotFound) {
			slog.Warn("failed to persist tool call update", "session_id", state.id, "message_id", msg.ID, "error", err)
		}
	}

	for _, ch := range subs {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (m *ChatManager) appendMessage(state *chatSessionState, msg ChatMessage) (ChatMessage, error) {
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now().UTC()
	}
	msg.Provider = firstNonEmpty(msg.Provider, state.provider)
	msg.SessionID = state.id

	state.mu.Lock()
	state.seq++
	msg.Seq = state.seq
	snapshotID := msg.ID
	subs := make([]chan ChatMessage, 0, len(state.subs))
	for _, ch := range state.subs {
		subs = append(subs, ch)
	}
	state.mu.Unlock()

	payload, err := json.Marshal(msg)
	if err != nil {
		return ChatMessage{}, err
	}

	row, err := m.db.CreateAgentMessage(db.CreateAgentMessageInput{
		SessionID:   state.id,
		Seq:         msg.Seq,
		Kind:        string(msg.Kind),
		PayloadJSON: string(payload),
	})
	if err != nil {
		slog.Warn("failed to persist chat message", "session_id", state.id, "seq", msg.Seq, "error", err)
		if snapshotID == "" {
			msg.ID = db.NewID()
		}
	} else {
		msg.ID = row.ID
	}

	state.mu.Lock()
	state.messages = append(state.messages, msg)
	idx := len(state.messages) - 1
	if msg.Tool != nil && msg.Tool.CallID != "" {
		state.toolByID[msg.Tool.CallID] = idx
	}
	state.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- msg:
		default:
		}
	}
	return msg, nil
}

func (m *ChatManager) updateProviderSessionID(state *chatSessionState, providerSessionID string) {
	if providerSessionID == "" {
		return
	}

	state.mu.Lock()
	if state.providerSessionID == providerSessionID {
		state.mu.Unlock()
		return
	}
	state.providerSessionID = providerSessionID
	state.mu.Unlock()

	if _, err := m.db.UpdateSession(state.id, db.UpdateSessionInput{
		ProviderSessionID: &providerSessionID,
	}); err != nil && !errors.Is(err, db.ErrNotFound) {
		slog.Warn("failed to update provider session id", "session_id", state.id, "provider_session_id", providerSessionID, "error", err)
	}
}

func (m *ChatManager) ensureSession(sessionID, provider, model string) (*chatSessionState, error) {
	m.mu.RLock()
	if state, ok := m.sessions[sessionID]; ok {
		m.mu.RUnlock()
		state.mu.Lock()
		if state.provider == "" && provider != "" {
			state.provider = provider
		}
		if model != "" {
			state.model = model
		}
		state.mu.Unlock()
		return state, nil
	}
	m.mu.RUnlock()

	dbSession, err := m.db.GetSession(sessionID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, ErrChatSessionNotFound
		}
		return nil, err
	}

	messages, err := m.db.ListAgentMessagesBySession(sessionID)
	if err != nil {
		return nil, err
	}

	state := &chatSessionState{
		id:                sessionID,
		provider:          firstNonEmpty(provider, dbSession.Provider),
		model:             model,
		toolByID:          make(map[string]int),
		subs:              make(map[uint64]chan ChatMessage),
		providerSessionID: firstNonEmpty(stringPtrValue(dbSession.ProviderSessionID), ""),
	}

	for _, row := range messages {
		var msg ChatMessage
		if err := json.Unmarshal([]byte(row.PayloadJSON), &msg); err != nil {
			continue
		}
		if msg.ID == "" {
			msg.ID = row.ID
		}
		if msg.Seq == 0 {
			msg.Seq = row.Seq
		}
		msg.SessionID = sessionID
		if msg.Provider == "" {
			msg.Provider = state.provider
		}
		if msg.CreatedAt.IsZero() {
			msg.CreatedAt = row.CreatedAt
		}
		state.messages = append(state.messages, msg)
		if msg.Tool != nil && msg.Tool.CallID != "" {
			state.toolByID[msg.Tool.CallID] = len(state.messages) - 1
		}
		if msg.Seq > state.seq {
			state.seq = msg.Seq
		}
	}

	m.mu.Lock()
	if existing, ok := m.sessions[sessionID]; ok {
		m.mu.Unlock()
		return existing, nil
	}
	m.sessions[sessionID] = state
	m.mu.Unlock()
	return state, nil
}

func codexCommandSummary(raw any) string {
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, p := range v {
			parts = append(parts, strings.TrimSpace(asString(p)))
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	default:
		return ""
	}
}

func codexItemText(item map[string]any) string {
	if text := asString(item["text"]); text != "" {
		return text
	}
	content, _ := item["content"].([]any)
	if len(content) == 0 {
		return ""
	}
	parts := make([]string, 0, len(content))
	for _, raw := range content {
		block, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if asString(block["type"]) != "output_text" {
			continue
		}
		text := asString(block["text"])
		if text == "" {
			continue
		}
		parts = append(parts, text)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func claudeBlocks(payload map[string]any) []map[string]any {
	msgObj, _ := payload["message"].(map[string]any)
	if msgObj == nil {
		return nil
	}
	content, _ := msgObj["content"].([]any)
	if len(content) == 0 {
		return nil
	}
	blocks := make([]map[string]any, 0, len(content))
	for _, raw := range content {
		block, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		blocks = append(blocks, block)
	}
	return blocks
}

func asString(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
