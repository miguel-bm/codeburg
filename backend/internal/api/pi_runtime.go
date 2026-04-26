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

const piSubBufferSize = 64

type piConversationModel struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
}

type piConversationToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments,omitempty"`
}

type piConversationImageRef struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

type piConversationMessage struct {
	ID        string                   `json:"id"`
	EntryID   string                   `json:"entryId,omitempty"`
	Role      string                   `json:"role"`
	Text      string                   `json:"text,omitempty"`
	Thinking  string                   `json:"thinking,omitempty"`
	Images    []piConversationImageRef `json:"images,omitempty"`
	ToolName  string                   `json:"toolName,omitempty"`
	ToolCalls []piConversationToolCall `json:"toolCalls,omitempty"`
	IsError   bool                     `json:"isError,omitempty"`
	Timestamp string                   `json:"timestamp,omitempty"`
}

type piStreamingAssistant struct {
	Text      string                   `json:"text,omitempty"`
	Thinking  string                   `json:"thinking,omitempty"`
	ToolCalls []piConversationToolCall `json:"toolCalls,omitempty"`
}

type piToolExecution struct {
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Status     string `json:"status"`
	Output     string `json:"output,omitempty"`
	IsError    bool   `json:"isError,omitempty"`
}

type piAvailableModel struct {
	Provider      string `json:"provider"`
	ID            string `json:"id"`
	Name          string `json:"name,omitempty"`
	Reasoning     bool   `json:"reasoning,omitempty"`
	ContextWindow int    `json:"contextWindow,omitempty"`
}

type piSlashCommand struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source,omitempty"`
}

type piForkMessage struct {
	EntryID string `json:"entryId"`
	Text    string `json:"text"`
}

type piConversationSnapshot struct {
	ConversationID string                  `json:"conversationId"`
	RuntimeActive  bool                    `json:"runtimeActive"`
	Streaming      bool                    `json:"streaming"`
	WorkDir        string                  `json:"workDir"`
	Model          *piConversationModel    `json:"model,omitempty"`
	SessionFile    *string                 `json:"sessionFile,omitempty"`
	SessionName    *string                 `json:"sessionName,omitempty"`
	Messages       []piConversationMessage `json:"messages"`
	Pending        *piStreamingAssistant   `json:"pending,omitempty"`
	Tools          []piToolExecution       `json:"tools,omitempty"`
	LastError      *string                 `json:"lastError,omitempty"`
	UpdatedAt      string                  `json:"updatedAt"`
}

type piConversationManager struct {
	db *db.DB

	mu       sync.Mutex
	runtimes map[string]*piConversationRuntime
}

type piConversationRuntime struct {
	manager        *piConversationManager
	conversationID string
	workDir        string
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	stderr         bytes.Buffer

	mu              sync.Mutex
	nextRequestID   int64
	pendingRequests map[string]chan map[string]any
	nextSubID       uint64
	subs            map[uint64]chan piConversationSnapshot
	snapshot        piConversationSnapshot
	closed          bool
}

func newPiConversationManager(database *db.DB) *piConversationManager {
	return &piConversationManager{
		db:       database,
		runtimes: make(map[string]*piConversationRuntime),
	}
}

func (m *piConversationManager) removeRuntime(conversationID string, runtime *piConversationRuntime) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current, ok := m.runtimes[conversationID]; ok && current == runtime {
		delete(m.runtimes, conversationID)
	}
}

func (m *piConversationManager) StopConversation(conversationID string) {
	m.mu.Lock()
	runtime := m.runtimes[conversationID]
	m.mu.Unlock()
	if runtime != nil {
		runtime.stop()
	}
}

func (m *piConversationManager) ensureRuntime(conversation *db.Conversation, workDir string) (*piConversationRuntime, error) {
	m.mu.Lock()
	if runtime, ok := m.runtimes[conversation.ID]; ok {
		m.mu.Unlock()
		if runtime.isCompatible(workDir) {
			return runtime, nil
		}
		runtime.stop()
	} else {
		m.mu.Unlock()
	}

	runtime, err := m.startRuntime(conversation, workDir)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.runtimes[conversation.ID] = runtime
	m.mu.Unlock()
	return runtime, nil
}

func (m *piConversationManager) startRuntime(conversation *db.Conversation, workDir string) (*piConversationRuntime, error) {
	cmd := exec.Command("pi", "--mode", "rpc")
	cmd.Dir = workDir

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("pi stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("pi stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("pi stderr pipe: %w", err)
	}

	runtime := &piConversationRuntime{
		manager:         m,
		conversationID:  conversation.ID,
		workDir:         workDir,
		cmd:             cmd,
		stdin:           stdin,
		pendingRequests: make(map[string]chan map[string]any),
		subs:            make(map[uint64]chan piConversationSnapshot),
		snapshot: piConversationSnapshot{
			ConversationID: conversation.ID,
			RuntimeActive:  false,
			Streaming:      false,
			WorkDir:        workDir,
			Messages:       []piConversationMessage{},
			Tools:          []piToolExecution{},
			UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		},
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi rpc: %w", err)
	}

	go runtime.readStdout(stdout)
	go func() {
		_, _ = io.Copy(&runtime.stderr, stderr)
	}()
	go func() {
		err := cmd.Wait()
		runtime.handleExit(err)
	}()

	if conversation.ProviderSessionID != nil && strings.TrimSpace(*conversation.ProviderSessionID) != "" {
		if _, err := runtime.sendCommand(map[string]any{
			"type":        "switch_session",
			"sessionPath": strings.TrimSpace(*conversation.ProviderSessionID),
		}); err != nil {
			runtime.stop()
			return nil, fmt.Errorf("switch pi session: %w", err)
		}
	}
	if strings.TrimSpace(conversation.Title) != "" {
		if _, err := runtime.sendCommand(map[string]any{
			"type": "set_session_name",
			"name": conversation.Title,
		}); err != nil {
			slog.Warn("failed to set pi session name", "conversation_id", conversation.ID, "error", err)
		}
	}
	if err := runtime.refreshState(conversation); err != nil {
		runtime.stop()
		return nil, err
	}
	if err := runtime.refreshMessages(); err != nil {
		runtime.stop()
		return nil, err
	}
	return runtime, nil
}

func (m *piConversationManager) Attach(conversation *db.Conversation, workDir string) (piConversationSnapshot, <-chan piConversationSnapshot, func(), error) {
	if conversation.Status != db.ConversationStatusActive {
		snapshot := staticPiConversationSnapshot(conversation, workDir)
		stream := make(chan piConversationSnapshot)
		cancel := func() { close(stream) }
		return snapshot, stream, cancel, nil
	}

	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, nil, nil, err
	}

	runtime.mu.Lock()
	snapshot := runtime.snapshot
	subID := runtime.nextSubID
	runtime.nextSubID++
	stream := make(chan piConversationSnapshot, piSubBufferSize)
	runtime.subs[subID] = stream
	runtime.mu.Unlock()

	cancel := func() {
		runtime.mu.Lock()
		if existing, ok := runtime.subs[subID]; ok {
			close(existing)
			delete(runtime.subs, subID)
		}
		runtime.mu.Unlock()
	}

	return snapshot, stream, cancel, nil
}

func (m *piConversationManager) GetSnapshot(conversation *db.Conversation, workDir string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return staticPiConversationSnapshot(conversation, workDir), nil
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) Prompt(conversation *db.Conversation, workDir, prompt string, images []piConversationImageRef) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before prompting")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	command := map[string]any{
		"type":    "prompt",
		"message": prompt,
	}
	if len(images) > 0 {
		command["images"] = normalizePiPromptImages(images)
	}
	if _, err := runtime.sendCommand(command); err != nil {
		return piConversationSnapshot{}, err
	}
	if _, err := m.db.UpdateConversation(conversation.ID, db.UpdateConversationInput{
		LastActivityAt: timePtr(time.Now().UTC()),
	}); err != nil {
		slog.Warn("failed to update conversation activity", "conversation_id", conversation.ID, "error", err)
	}
	if err := runtime.refreshMessages(); err != nil {
		slog.Warn("failed to refresh pi messages after prompt", "conversation_id", conversation.ID, "error", err)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func normalizePiPromptImages(images []piConversationImageRef) []piConversationImageRef {
	normalized := make([]piConversationImageRef, 0, len(images))
	for _, image := range images {
		data := strings.TrimSpace(image.Data)
		mimeType := strings.TrimSpace(image.MimeType)
		if data == "" || mimeType == "" {
			continue
		}
		normalized = append(normalized, piConversationImageRef{
			Type:     "image",
			Data:     data,
			MimeType: mimeType,
		})
	}
	return normalized
}

func (m *piConversationManager) AvailableModels(conversation *db.Conversation, workDir string) ([]piAvailableModel, error) {
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return nil, err
	}
	response, err := runtime.sendCommand(map[string]any{"type": "get_available_models"})
	if err != nil {
		return nil, err
	}
	data, _ := response["data"].(map[string]any)
	rawModels, _ := data["models"].([]any)
	models := make([]piAvailableModel, 0, len(rawModels))
	for _, raw := range rawModels {
		modelMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		models = append(models, piAvailableModel{
			Provider:      stringFromMap(modelMap, "provider"),
			ID:            stringFromMap(modelMap, "id"),
			Name:          stringFromMap(modelMap, "name"),
			Reasoning:     boolFromMap(modelMap, "reasoning"),
			ContextWindow: intFromMap(modelMap, "contextWindow"),
		})
	}
	return models, nil
}

func (m *piConversationManager) Commands(conversation *db.Conversation, workDir string) ([]piSlashCommand, error) {
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return nil, err
	}
	response, err := runtime.sendCommand(map[string]any{"type": "get_commands"})
	if err != nil {
		return nil, err
	}
	data, _ := response["data"].(map[string]any)
	rawCommands, _ := data["commands"].([]any)
	commands := make([]piSlashCommand, 0, len(rawCommands))
	for _, raw := range rawCommands {
		commandMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := stringFromMap(commandMap, "name")
		if name == "" {
			continue
		}
		commands = append(commands, piSlashCommand{
			Name:        name,
			Description: stringFromMap(commandMap, "description"),
			Source:      stringFromMap(commandMap, "source"),
		})
	}
	return commands, nil
}

func (m *piConversationManager) SetModel(conversation *db.Conversation, workDir, provider, modelID string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before switching models")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	if _, err := runtime.sendCommand(map[string]any{
		"type":     "set_model",
		"provider": provider,
		"modelId":  modelID,
	}); err != nil {
		return piConversationSnapshot{}, err
	}
	if err := runtime.refreshState(conversation); err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) ForkFromEntry(source *db.Conversation, forked *db.Conversation, sourceWorkDir, targetWorkDir, entryID string) (string, piConversationSnapshot, error) {
	sourceSession := ""
	if source.ProviderSessionID != nil {
		sourceSession = strings.TrimSpace(*source.ProviderSessionID)
	}
	if sourceSession == "" {
		sourceRuntime, err := m.ensureRuntime(source, sourceWorkDir)
		if err != nil {
			return "", piConversationSnapshot{}, err
		}
		if err := sourceRuntime.refreshState(source); err != nil {
			return "", piConversationSnapshot{}, err
		}
		sourceRuntime.mu.Lock()
		if sourceRuntime.snapshot.SessionFile != nil {
			sourceSession = strings.TrimSpace(*sourceRuntime.snapshot.SessionFile)
		}
		sourceRuntime.mu.Unlock()
	}
	if sourceSession == "" {
		return "", piConversationSnapshot{}, fmt.Errorf("conversation has no pi session to fork")
	}

	runtime, err := m.ensureRuntime(forked, targetWorkDir)
	if err != nil {
		return "", piConversationSnapshot{}, err
	}
	if _, err := runtime.sendCommand(map[string]any{
		"type":        "switch_session",
		"sessionPath": sourceSession,
	}); err != nil {
		return "", piConversationSnapshot{}, err
	}
	response, err := runtime.sendCommand(map[string]any{
		"type":    "fork",
		"entryId": entryID,
	})
	if err != nil {
		return "", piConversationSnapshot{}, err
	}
	data, _ := response["data"].(map[string]any)
	if boolFromMap(data, "cancelled") {
		return "", piConversationSnapshot{}, fmt.Errorf("fork cancelled")
	}
	selectedText := stringFromMap(data, "text")
	if strings.TrimSpace(forked.Title) != "" {
		if _, err := runtime.sendCommand(map[string]any{
			"type": "set_session_name",
			"name": forked.Title,
		}); err != nil {
			slog.Warn("failed to set forked pi session name", "conversation_id", forked.ID, "error", err)
		}
	}
	if err := runtime.refreshState(forked); err != nil {
		return "", piConversationSnapshot{}, err
	}
	if err := runtime.refreshMessages(); err != nil {
		return "", piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return selectedText, runtime.snapshot, nil
}

func (m *piConversationManager) Abort(conversation *db.Conversation, workDir string) error {
	if conversation.Status != db.ConversationStatusActive {
		return fmt.Errorf("conversation is not active")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return err
	}
	_, err = runtime.sendCommand(map[string]any{"type": "abort"})
	return err
}

func staticPiConversationSnapshot(conversation *db.Conversation, workDir string) piConversationSnapshot {
	snapshot := piConversationSnapshot{
		ConversationID: conversation.ID,
		RuntimeActive:  false,
		Streaming:      false,
		WorkDir:        workDir,
		Messages:       []piConversationMessage{},
		Tools:          []piToolExecution{},
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	if conversation.ProviderSessionID != nil && strings.TrimSpace(*conversation.ProviderSessionID) != "" {
		snapshot.SessionFile = conversation.ProviderSessionID
	}
	if strings.TrimSpace(conversation.Title) != "" {
		snapshot.SessionName = stringPtr(conversation.Title)
	}
	return snapshot
}

func (rt *piConversationRuntime) isCompatible(workDir string) bool {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return !rt.closed && rt.workDir == workDir
}

func (rt *piConversationRuntime) stop() {
	rt.mu.Lock()
	if rt.closed {
		rt.mu.Unlock()
		return
	}
	stdin := rt.stdin
	cmd := rt.cmd
	rt.closed = true
	rt.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func (rt *piConversationRuntime) handleExit(err error) {
	rt.mu.Lock()
	if rt.closed {
		for id, stream := range rt.subs {
			close(stream)
			delete(rt.subs, id)
		}
		rt.mu.Unlock()
		rt.manager.removeRuntime(rt.conversationID, rt)
		return
	}
	rt.closed = true
	errMsg := "pi runtime exited"
	if err != nil && !errors.Is(err, context.Canceled) {
		errMsg = fmt.Sprintf("pi runtime exited: %v", err)
		if stderr := strings.TrimSpace(rt.stderr.String()); stderr != "" {
			errMsg = fmt.Sprintf("%s\n%s", errMsg, stderr)
		}
	}
	rt.snapshot.RuntimeActive = false
	rt.snapshot.Streaming = false
	rt.snapshot.Pending = nil
	rt.snapshot.Tools = nil
	rt.snapshot.LastError = &errMsg
	rt.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	subs := make([]chan piConversationSnapshot, 0, len(rt.subs))
	for _, sub := range rt.subs {
		subs = append(subs, sub)
	}
	pendingResponses := make([]chan map[string]any, 0, len(rt.pendingRequests))
	for _, pending := range rt.pendingRequests {
		pendingResponses = append(pendingResponses, pending)
	}
	for id, sub := range rt.subs {
		close(sub)
		delete(rt.subs, id)
	}
	for id := range rt.pendingRequests {
		delete(rt.pendingRequests, id)
	}
	rt.mu.Unlock()

	for _, pending := range pendingResponses {
		close(pending)
	}
	_ = subs
	rt.manager.removeRuntime(rt.conversationID, rt)
}

func (rt *piConversationRuntime) readStdout(stdout io.ReadCloser) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			slog.Warn("failed to parse pi rpc line", "conversation_id", rt.conversationID, "error", err)
			continue
		}
		if rawType, _ := payload["type"].(string); rawType == "response" {
			rt.resolvePending(payload)
			continue
		}
		rt.handleEvent(payload)
	}
	if err := scanner.Err(); err != nil {
		rt.mu.Lock()
		closed := rt.closed
		rt.mu.Unlock()
		if closed {
			return
		}
		slog.Warn("pi rpc scanner stopped", "conversation_id", rt.conversationID, "error", err)
	}
}

func (rt *piConversationRuntime) resolvePending(response map[string]any) {
	id, _ := response["id"].(string)
	if id == "" {
		return
	}
	rt.mu.Lock()
	ch, ok := rt.pendingRequests[id]
	if ok {
		delete(rt.pendingRequests, id)
	}
	rt.mu.Unlock()
	if ok {
		ch <- response
		close(ch)
	}
}

func (rt *piConversationRuntime) sendCommand(command map[string]any) (map[string]any, error) {
	rt.mu.Lock()
	if rt.closed {
		rt.mu.Unlock()
		return nil, fmt.Errorf("pi runtime is not available")
	}
	rt.nextRequestID++
	id := fmt.Sprintf("req-%d", rt.nextRequestID)
	command["id"] = id
	responseCh := make(chan map[string]any, 1)
	rt.pendingRequests[id] = responseCh
	stdin := rt.stdin
	rt.mu.Unlock()

	data, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	if _, err := stdin.Write(append(data, '\n')); err != nil {
		return nil, fmt.Errorf("write pi command: %w", err)
	}

	select {
	case response, ok := <-responseCh:
		if !ok {
			return nil, fmt.Errorf("pi runtime closed while waiting for response")
		}
		if success, _ := response["success"].(bool); !success {
			if errorText, _ := response["error"].(string); errorText != "" {
				return nil, errors.New(errorText)
			}
			return nil, errors.New("pi command failed")
		}
		return response, nil
	case <-time.After(10 * time.Second):
		rt.mu.Lock()
		delete(rt.pendingRequests, id)
		rt.mu.Unlock()
		return nil, fmt.Errorf("pi command timed out")
	}
}

func (rt *piConversationRuntime) refreshState(conversation *db.Conversation) error {
	response, err := rt.sendCommand(map[string]any{"type": "get_state"})
	if err != nil {
		return fmt.Errorf("get pi state: %w", err)
	}
	data, _ := response["data"].(map[string]any)
	sessionFile := stringFromMap(data, "sessionFile")
	sessionName := stringFromMap(data, "sessionName")
	model := modelFromMap(data)
	rt.mu.Lock()
	rt.snapshot.RuntimeActive = true
	rt.snapshot.Streaming = boolFromMap(data, "isStreaming")
	rt.snapshot.Model = model
	rt.snapshot.SessionFile = nilIfEmpty(sessionFile)
	rt.snapshot.SessionName = nilIfEmpty(sessionName)
	rt.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	rt.mu.Unlock()
	rt.broadcast()

	if sessionFile != "" && (conversation.ProviderSessionID == nil || strings.TrimSpace(*conversation.ProviderSessionID) != sessionFile) {
		if _, err := rt.manager.db.UpdateConversation(conversation.ID, db.UpdateConversationInput{
			ProviderSessionID: stringPtr(sessionFile),
		}); err != nil {
			slog.Warn("failed to persist pi session file", "conversation_id", conversation.ID, "error", err)
		}
	}
	return nil
}

func (rt *piConversationRuntime) refreshMessages() error {
	response, err := rt.sendCommand(map[string]any{"type": "get_messages"})
	if err != nil {
		return fmt.Errorf("get pi messages: %w", err)
	}
	data, _ := response["data"].(map[string]any)
	rawMessages, _ := data["messages"].([]any)
	messages := make([]piConversationMessage, 0, len(rawMessages))
	for index, raw := range rawMessages {
		rawMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		messages = append(messages, normalizePiMessage(rawMap, index))
	}
	if forkMessages, err := rt.forkMessages(); err == nil {
		assignForkEntryIDs(messages, forkMessages)
	}

	rt.mu.Lock()
	rt.snapshot.Messages = messages
	rt.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	rt.mu.Unlock()
	rt.broadcast()
	return nil
}

func (rt *piConversationRuntime) forkMessages() ([]piForkMessage, error) {
	response, err := rt.sendCommand(map[string]any{"type": "get_fork_messages"})
	if err != nil {
		return nil, err
	}
	data, _ := response["data"].(map[string]any)
	rawMessages, _ := data["messages"].([]any)
	messages := make([]piForkMessage, 0, len(rawMessages))
	for _, raw := range rawMessages {
		messageMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		entryID := stringFromMap(messageMap, "entryId")
		text := stringFromMap(messageMap, "text")
		if entryID == "" || text == "" {
			continue
		}
		messages = append(messages, piForkMessage{EntryID: entryID, Text: text})
	}
	return messages, nil
}

func assignForkEntryIDs(messages []piConversationMessage, forkMessages []piForkMessage) {
	cursor := 0
	for i := range messages {
		if messages[i].Role != "user" {
			continue
		}
		text := strings.TrimSpace(messages[i].Text)
		for cursor < len(forkMessages) {
			candidate := forkMessages[cursor]
			cursor++
			if strings.TrimSpace(candidate.Text) == text {
				messages[i].EntryID = candidate.EntryID
				if messages[i].ID == "" {
					messages[i].ID = candidate.EntryID
				}
				break
			}
		}
	}
}

func (rt *piConversationRuntime) handleEvent(event map[string]any) {
	eventType, _ := event["type"].(string)
	now := time.Now().UTC().Format(time.RFC3339)

	rt.mu.Lock()
	switch eventType {
	case "agent_start":
		rt.snapshot.Streaming = true
		rt.snapshot.Pending = &piStreamingAssistant{}
	case "agent_end":
		rt.snapshot.Streaming = false
		rt.snapshot.Pending = nil
		rt.snapshot.Tools = nil
	case "message_update":
		if rt.snapshot.Pending == nil {
			rt.snapshot.Pending = &piStreamingAssistant{}
		}
		assistantEvent, _ := event["assistantMessageEvent"].(map[string]any)
		deltaType, _ := assistantEvent["type"].(string)
		switch deltaType {
		case "text_delta":
			rt.snapshot.Pending.Text += stringFromMap(assistantEvent, "delta")
		case "thinking_delta":
			rt.snapshot.Pending.Thinking += stringFromMap(assistantEvent, "delta")
		case "toolcall_end":
			if toolCall, ok := assistantEvent["toolCall"].(map[string]any); ok {
				rt.snapshot.Pending.ToolCalls = append(rt.snapshot.Pending.ToolCalls, piConversationToolCall{
					ID:        stringFromMap(toolCall, "id"),
					Name:      stringFromMap(toolCall, "name"),
					Arguments: compactJSON(toolCall["arguments"]),
				})
			}
		}
	case "tool_execution_start":
		rt.snapshot.Tools = appendOrReplaceTool(rt.snapshot.Tools, piToolExecution{
			ToolCallID: stringFromMap(event, "toolCallId"),
			ToolName:   stringFromMap(event, "toolName"),
			Status:     "running",
		})
	case "tool_execution_update":
		partial, _ := event["partialResult"].(map[string]any)
		rt.snapshot.Tools = appendOrReplaceTool(rt.snapshot.Tools, piToolExecution{
			ToolCallID: stringFromMap(event, "toolCallId"),
			ToolName:   stringFromMap(event, "toolName"),
			Status:     "running",
			Output:     textFromContent(partial["content"]),
		})
	case "tool_execution_end":
		result, _ := event["result"].(map[string]any)
		rt.snapshot.Tools = appendOrReplaceTool(rt.snapshot.Tools, piToolExecution{
			ToolCallID: stringFromMap(event, "toolCallId"),
			ToolName:   stringFromMap(event, "toolName"),
			Status:     "completed",
			Output:     textFromContent(result["content"]),
			IsError:    boolFromMap(event, "isError"),
		})
	case "extension_ui_request":
		method, _ := event["method"].(string)
		if method != "" {
			message := fmt.Sprintf("pi requested UI interaction via %s. Use a workspace terminal for /login or interactive setup.", method)
			rt.snapshot.LastError = &message
		}
	}
	rt.snapshot.UpdatedAt = now
	rt.mu.Unlock()
	if eventType == "agent_end" {
		if _, err := rt.manager.db.MarkConversationUnread(rt.conversationID, time.Now().UTC()); err != nil {
			slog.Warn("failed to mark pi conversation unread after agent end", "conversation_id", rt.conversationID, "error", err)
		}
	}
	rt.broadcast()

	switch eventType {
	case "agent_end":
		go func() {
			if err := rt.refreshMessages(); err != nil {
				slog.Warn("failed to refresh pi messages after agent end", "conversation_id", rt.conversationID, "error", err)
			}
		}()
	case "message_end":
		go func() {
			// Keep session file/state reasonably current after message completions.
			response, err := rt.sendCommand(map[string]any{"type": "get_state"})
			if err == nil {
				if data, ok := response["data"].(map[string]any); ok {
					rt.mu.Lock()
					rt.snapshot.RuntimeActive = true
					rt.snapshot.Streaming = boolFromMap(data, "isStreaming")
					rt.snapshot.Model = modelFromMap(data)
					rt.snapshot.SessionFile = nilIfEmpty(stringFromMap(data, "sessionFile"))
					rt.snapshot.SessionName = nilIfEmpty(stringFromMap(data, "sessionName"))
					rt.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
					rt.mu.Unlock()
					rt.broadcast()
				}
			}
		}()
	}
}

func (rt *piConversationRuntime) broadcast() {
	rt.mu.Lock()
	snapshot := rt.snapshot
	subs := make([]chan piConversationSnapshot, 0, len(rt.subs))
	for _, sub := range rt.subs {
		subs = append(subs, sub)
	}
	rt.mu.Unlock()

	for _, sub := range subs {
		select {
		case sub <- snapshot:
		default:
		}
	}
}

func normalizePiMessage(message map[string]any, index int) piConversationMessage {
	role := stringFromMap(message, "role")
	timestamp := timestampFromValue(message["timestamp"])
	id := fmt.Sprintf("%s-%d-%d", role, timestamp.UnixMilli(), index)
	result := piConversationMessage{
		ID:        id,
		Role:      role,
		Timestamp: timestamp.UTC().Format(time.RFC3339),
	}

	switch role {
	case "user":
		result.Text, result.Images = userContent(message["content"])
	case "assistant":
		result.Text, result.Thinking, result.ToolCalls = assistantContent(message["content"])
	case "toolResult":
		result.ToolName = stringFromMap(message, "toolName")
		result.IsError = boolFromMap(message, "isError")
		result.Text = textFromContent(message["content"])
	case "bashExecution":
		command := stringFromMap(message, "command")
		output := stringFromMap(message, "output")
		result.Text = strings.TrimSpace(fmt.Sprintf("Ran `%s`\n\n%s", command, output))
	case "branchSummary", "compactionSummary":
		result.Text = stringFromMap(message, "summary")
	case "custom":
		result.Text, result.Images = userContent(message["content"])
	default:
		result.Text = compactJSON(message)
	}
	return result
}

func assistantContent(value any) (string, string, []piConversationToolCall) {
	items, _ := value.([]any)
	textParts := make([]string, 0, len(items))
	thinkingParts := make([]string, 0, len(items))
	toolCalls := make([]piConversationToolCall, 0)
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch stringFromMap(item, "type") {
		case "text":
			textParts = append(textParts, stringFromMap(item, "text"))
		case "thinking":
			thinkingParts = append(thinkingParts, stringFromMap(item, "thinking"))
		case "toolCall":
			toolCalls = append(toolCalls, piConversationToolCall{
				ID:        stringFromMap(item, "id"),
				Name:      stringFromMap(item, "name"),
				Arguments: compactJSON(item["arguments"]),
			})
		}
	}
	return strings.TrimSpace(strings.Join(textParts, "\n\n")), strings.TrimSpace(strings.Join(thinkingParts, "\n\n")), toolCalls
}

func userContent(value any) (string, []piConversationImageRef) {
	switch typed := value.(type) {
	case string:
		return typed, nil
	case []any:
		return contentTextAndImages(typed)
	default:
		return compactJSON(value), nil
	}
}

func textFromContent(value any) string {
	items, ok := value.([]any)
	if !ok {
		if text, ok := value.(string); ok {
			return text
		}
		return compactJSON(value)
	}
	parts := make([]string, 0, len(items))
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch stringFromMap(item, "type") {
		case "text":
			parts = append(parts, stringFromMap(item, "text"))
		case "image":
			parts = append(parts, "[image]")
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func contentTextAndImages(items []any) (string, []piConversationImageRef) {
	parts := make([]string, 0, len(items))
	images := make([]piConversationImageRef, 0)
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch stringFromMap(item, "type") {
		case "text":
			parts = append(parts, stringFromMap(item, "text"))
		case "image":
			data := stringFromMap(item, "data")
			mimeType := stringFromMap(item, "mimeType")
			if data != "" && mimeType != "" {
				images = append(images, piConversationImageRef{
					Type:     "image",
					Data:     data,
					MimeType: mimeType,
				})
			} else {
				parts = append(parts, "[image]")
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n")), images
}

func appendOrReplaceTool(existing []piToolExecution, next piToolExecution) []piToolExecution {
	for i := range existing {
		if existing[i].ToolCallID == next.ToolCallID {
			existing[i] = next
			return existing
		}
	}
	return append(existing, next)
}

func stringFromMap(value map[string]any, key string) string {
	raw, _ := value[key].(string)
	return strings.TrimSpace(raw)
}

func boolFromMap(value map[string]any, key string) bool {
	raw, _ := value[key].(bool)
	return raw
}

func intFromMap(value map[string]any, key string) int {
	switch raw := value[key].(type) {
	case float64:
		return int(raw)
	case int:
		return raw
	default:
		return 0
	}
}

func compactJSON(value any) string {
	if value == nil {
		return ""
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func modelFromMap(data map[string]any) *piConversationModel {
	modelRaw, _ := data["model"].(map[string]any)
	if modelRaw == nil {
		return nil
	}
	provider := stringFromMap(modelRaw, "provider")
	id := stringFromMap(modelRaw, "id")
	if provider == "" && id == "" {
		return nil
	}
	return &piConversationModel{Provider: provider, ID: id}
}

func timestampFromValue(value any) time.Time {
	switch typed := value.(type) {
	case float64:
		return time.UnixMilli(int64(typed))
	case int64:
		return time.UnixMilli(typed)
	case string:
		parsed, err := time.Parse(time.RFC3339, typed)
		if err == nil {
			return parsed
		}
	}
	return time.Now().UTC()
}

func nilIfEmpty(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func stringPtr(value string) *string {
	return &value
}

func timePtr(value time.Time) *time.Time {
	return &value
}
