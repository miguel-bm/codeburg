package api

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
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
	ID        string                            `json:"id"`
	EntryID   string                            `json:"entryId,omitempty"`
	Role      string                            `json:"role"`
	Text      string                            `json:"text,omitempty"`
	Thinking  string                            `json:"thinking,omitempty"`
	Images    []piConversationImageRef          `json:"images,omitempty"`
	ToolName  string                            `json:"toolName,omitempty"`
	ToolCalls []piConversationToolCall          `json:"toolCalls,omitempty"`
	IsError   bool                              `json:"isError,omitempty"`
	Timestamp string                            `json:"timestamp,omitempty"`
	Version   *piConversationMessageVersionInfo `json:"version,omitempty"`
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

type piSessionEntry struct {
	Type      string
	ID        string
	ParentID  string
	Timestamp time.Time
	Raw       map[string]any
}

type piSessionFile struct {
	Header  map[string]any
	Entries []piSessionEntry
	ByID    map[string]piSessionEntry
	LeafID  string
}

type piConversationTree struct {
	ActiveLeafID string                             `json:"activeLeafId,omitempty"`
	Messages     []piConversationMessageVersionInfo `json:"messages"`
}

type piConversationMessageVersionInfo struct {
	EntryID        string `json:"entryId"`
	VersionIndex   int    `json:"versionIndex"`
	VersionCount   int    `json:"versionCount"`
	PreviousLeafID string `json:"previousLeafId,omitempty"`
	NextLeafID     string `json:"nextLeafId,omitempty"`
	CanEdit        bool   `json:"canEdit"`
}

type piConversationSnapshot struct {
	ConversationID        string                  `json:"conversationId"`
	RuntimeActive         bool                    `json:"runtimeActive"`
	Streaming             bool                    `json:"streaming"`
	Compacting            bool                    `json:"compacting,omitempty"`
	WorkDir               string                  `json:"workDir"`
	Model                 *piConversationModel    `json:"model,omitempty"`
	ThinkingLevel         string                  `json:"thinkingLevel,omitempty"`
	SteeringMode          string                  `json:"steeringMode,omitempty"`
	FollowUpMode          string                  `json:"followUpMode,omitempty"`
	AutoCompactionEnabled bool                    `json:"autoCompactionEnabled,omitempty"`
	MessageCount          int                     `json:"messageCount,omitempty"`
	PendingMessageCount   int                     `json:"pendingMessageCount,omitempty"`
	SessionFile           *string                 `json:"sessionFile,omitempty"`
	SessionName           *string                 `json:"sessionName,omitempty"`
	Messages              []piConversationMessage `json:"messages"`
	Pending               *piStreamingAssistant   `json:"pending,omitempty"`
	Tools                 []piToolExecution       `json:"tools,omitempty"`
	LastError             *string                 `json:"lastError,omitempty"`
	UpdatedAt             string                  `json:"updatedAt"`
}

type piSessionStatsResponse struct {
	State piConversationSnapshot `json:"state"`
	Stats map[string]any         `json:"stats"`
}

type piExportResponse struct {
	Path string `json:"path"`
}

type piConversationManager struct {
	db *db.DB

	mu               sync.Mutex
	runtimes         map[string]*piConversationRuntime
	starts           map[string]*piRuntimeStart
	startRuntimeFn   func(*db.Conversation, string) (*piConversationRuntime, error)
	onNeedsAttention func(conversationID, reason string)
}

type piRuntimeStart struct {
	workDir string
	done    chan struct{}
	runtime *piConversationRuntime
	err     error
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
	manager := &piConversationManager{
		db:       database,
		runtimes: make(map[string]*piConversationRuntime),
		starts:   make(map[string]*piRuntimeStart),
	}
	manager.startRuntimeFn = manager.startRuntimeProcess
	return manager
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
	for {
		m.mu.Lock()
		if runtime, ok := m.runtimes[conversation.ID]; ok {
			m.mu.Unlock()
			if runtime.isCompatible(workDir) {
				return runtime, nil
			}
			runtime.stop()
			m.removeRuntime(conversation.ID, runtime)
			continue
		}

		if start, ok := m.starts[conversation.ID]; ok {
			m.mu.Unlock()
			<-start.done
			if start.workDir == workDir {
				return start.runtime, start.err
			}
			continue
		}

		start := &piRuntimeStart{
			workDir: workDir,
			done:    make(chan struct{}),
		}
		m.starts[conversation.ID] = start
		m.mu.Unlock()

		runtime, err := m.startRuntimeFn(conversation, workDir)

		m.mu.Lock()
		if err == nil {
			m.runtimes[conversation.ID] = runtime
		}
		delete(m.starts, conversation.ID)
		m.mu.Unlock()

		start.runtime = runtime
		start.err = err
		close(start.done)
		return runtime, err
	}
}

func (m *piConversationManager) startRuntimeProcess(conversation *db.Conversation, workDir string) (*piConversationRuntime, error) {
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

func (m *piConversationManager) Attach(conversation *db.Conversation, workDir string, activate bool) (piConversationSnapshot, <-chan piConversationSnapshot, func(), error) {
	if conversation.Status != db.ConversationStatusActive {
		snapshot := staticPiConversationSnapshot(conversation, workDir)
		stream := make(chan piConversationSnapshot)
		cancel := func() { close(stream) }
		return snapshot, stream, cancel, nil
	}

	runtime := m.existingRuntime(conversation.ID, workDir)
	if runtime == nil && activate {
		var err error
		runtime, err = m.ensureRuntime(conversation, workDir)
		if err != nil {
			return piConversationSnapshot{}, nil, nil, err
		}
	}
	if runtime == nil {
		snapshot := staticPiConversationSnapshot(conversation, workDir)
		stream := make(chan piConversationSnapshot)
		cancel := func() { close(stream) }
		return snapshot, stream, cancel, nil
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
	return m.PassiveSnapshot(conversation, workDir), nil
}

func (m *piConversationManager) PassiveSnapshot(conversation *db.Conversation, workDir string) piConversationSnapshot {
	runtime := m.existingRuntime(conversation.ID, workDir)
	if conversation.Status != db.ConversationStatusActive || runtime == nil {
		return staticPiConversationSnapshot(conversation, workDir)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot
}

func (m *piConversationManager) ExistingSnapshotSummary(conversation *db.Conversation) piConversationSnapshot {
	m.mu.Lock()
	runtime := m.runtimes[conversation.ID]
	m.mu.Unlock()

	if runtime == nil {
		return staticPiConversationSummary(conversation, "")
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.closed {
		return staticPiConversationSummary(conversation, runtime.workDir)
	}

	snapshot := runtime.snapshot
	snapshot.Messages = []piConversationMessage{}
	snapshot.Pending = nil
	snapshot.Tools = nil
	return snapshot
}

func (m *piConversationManager) existingRuntime(conversationID string, workDir string) *piConversationRuntime {
	m.mu.Lock()
	runtime := m.runtimes[conversationID]
	m.mu.Unlock()
	if runtime == nil || !runtime.isCompatible(workDir) {
		return nil
	}
	return runtime
}

func (m *piConversationManager) Prompt(conversation *db.Conversation, workDir, prompt string, images []piConversationImageRef, streamingBehavior string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before prompting")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	streaming := runtime.snapshot.Streaming
	runtime.mu.Unlock()
	streamingBehavior = strings.TrimSpace(streamingBehavior)
	if streaming && streamingBehavior != "steer" && streamingBehavior != "followUp" {
		return piConversationSnapshot{}, fmt.Errorf("conversation is already streaming")
	}
	commandType := "prompt"
	if streamingBehavior == "steer" {
		commandType = "steer"
	}
	if streamingBehavior == "followUp" {
		commandType = "follow_up"
	}
	command := map[string]any{
		"type":    commandType,
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
	if conversation.Status != db.ConversationStatusActive {
		return []piAvailableModel{}, nil
	}
	runtime := m.existingRuntime(conversation.ID, workDir)
	if runtime == nil {
		return []piAvailableModel{}, nil
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

func (m *piConversationManager) Commands(conversation *db.Conversation, workDir string, activate bool) ([]piSlashCommand, error) {
	if conversation.Status != db.ConversationStatusActive {
		return []piSlashCommand{}, nil
	}
	runtime := m.existingRuntime(conversation.ID, workDir)
	if runtime == nil {
		if !activate {
			return []piSlashCommand{}, nil
		}
		var err error
		runtime, err = m.ensureRuntime(conversation, workDir)
		if err != nil {
			return nil, err
		}
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

func (m *piConversationManager) SetSessionName(conversationID, name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	m.mu.Lock()
	runtime := m.runtimes[conversationID]
	m.mu.Unlock()
	if runtime == nil {
		return
	}
	if _, err := runtime.sendCommand(map[string]any{
		"type": "set_session_name",
		"name": name,
	}); err != nil {
		slog.Warn("failed to update pi session name", "conversation_id", conversationID, "error", err)
		return
	}
	runtime.mu.Lock()
	runtime.snapshot.SessionName = stringPtr(name)
	runtime.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	runtime.mu.Unlock()
	runtime.broadcast()
}

func (m *piConversationManager) SetThinkingLevel(conversation *db.Conversation, workDir, level string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before changing thinking level")
	}
	level = strings.TrimSpace(level)
	switch level {
	case "off", "minimal", "low", "medium", "high", "xhigh":
	default:
		return piConversationSnapshot{}, fmt.Errorf("unsupported thinking level")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	if _, err := runtime.sendCommand(map[string]any{
		"type":  "set_thinking_level",
		"level": level,
	}); err != nil {
		return piConversationSnapshot{}, err
	}
	if err := runtime.refreshState(conversation); err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	runtime.snapshot.ThinkingLevel = level
	runtime.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) SetAutoCompaction(conversation *db.Conversation, workDir string, enabled bool) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before changing compaction settings")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	if _, err := runtime.sendCommand(map[string]any{
		"type":    "set_auto_compaction",
		"enabled": enabled,
	}); err != nil {
		return piConversationSnapshot{}, err
	}
	if err := runtime.refreshState(conversation); err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	runtime.snapshot.AutoCompactionEnabled = enabled
	runtime.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) Compact(conversation *db.Conversation, workDir, customInstructions string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before compacting")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	command := map[string]any{"type": "compact"}
	if strings.TrimSpace(customInstructions) != "" {
		command["customInstructions"] = strings.TrimSpace(customInstructions)
	}
	if _, err := runtime.sendCommand(command); err != nil {
		return piConversationSnapshot{}, err
	}
	if err := runtime.refreshState(conversation); err != nil {
		return piConversationSnapshot{}, err
	}
	if err := runtime.refreshMessages(); err != nil {
		slog.Warn("failed to refresh pi messages after compaction", "conversation_id", conversation.ID, "error", err)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) SessionStats(conversation *db.Conversation, workDir string) (piSessionStatsResponse, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piSessionStatsResponse{
			State: staticPiConversationSnapshot(conversation, workDir),
			Stats: map[string]any{},
		}, nil
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piSessionStatsResponse{}, err
	}
	response, err := runtime.sendCommand(map[string]any{"type": "get_session_stats"})
	if err != nil {
		return piSessionStatsResponse{}, err
	}
	if err := runtime.refreshState(conversation); err != nil {
		return piSessionStatsResponse{}, err
	}
	data, _ := response["data"].(map[string]any)
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return piSessionStatsResponse{
		State: runtime.snapshot,
		Stats: data,
	}, nil
}

func (m *piConversationManager) ExportHTML(conversation *db.Conversation, workDir, outputPath string) (piExportResponse, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piExportResponse{}, fmt.Errorf("conversation must be active before exporting")
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piExportResponse{}, err
	}
	command := map[string]any{"type": "export_html"}
	if strings.TrimSpace(outputPath) != "" {
		command["outputPath"] = strings.TrimSpace(outputPath)
	}
	response, err := runtime.sendCommand(command)
	if err != nil {
		return piExportResponse{}, err
	}
	data, _ := response["data"].(map[string]any)
	return piExportResponse{Path: stringFromMap(data, "path")}, nil
}

func (m *piConversationManager) Reload(conversation *db.Conversation, workDir string) (piConversationSnapshot, error) {
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation must be active before reloading pi resources")
	}
	if runtime := m.existingRuntime(conversation.ID, workDir); runtime != nil {
		runtime.mu.Lock()
		streaming := runtime.snapshot.Streaming
		runtime.mu.Unlock()
		if streaming {
			return piConversationSnapshot{}, fmt.Errorf("cannot reload while pi is streaming")
		}
		runtime.stop()
	}
	runtime, err := m.ensureRuntime(conversation, workDir)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, nil
}

func (m *piConversationManager) ForkCurrent(source *db.Conversation, forked *db.Conversation, sourceWorkDir, targetWorkDir string) (piConversationSnapshot, bool, error) {
	sourceSession, err := m.sourceSessionFile(source, sourceWorkDir)
	if err != nil {
		return piConversationSnapshot{}, false, err
	}
	if sourceSession == "" {
		return piConversationSnapshot{}, false, nil
	}

	sessionFile, err := clonePiSessionFile(sourceSession, targetWorkDir)
	if err != nil {
		return piConversationSnapshot{}, false, err
	}
	if _, err := m.db.UpdateConversation(forked.ID, db.UpdateConversationInput{
		ProviderSessionID: stringPtr(sessionFile),
	}); err != nil {
		return piConversationSnapshot{}, false, err
	}
	forked.ProviderSessionID = stringPtr(sessionFile)

	runtime, err := m.ensureRuntime(forked, targetWorkDir)
	if err != nil {
		return piConversationSnapshot{}, false, err
	}
	if err := runtime.refreshState(forked); err != nil {
		return piConversationSnapshot{}, false, err
	}
	if err := runtime.refreshMessages(); err != nil {
		return piConversationSnapshot{}, false, err
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.snapshot, true, nil
}

func (m *piConversationManager) sourceSessionFile(source *db.Conversation, sourceWorkDir string) (string, error) {
	sourceSession := ""
	if source.ProviderSessionID != nil {
		sourceSession = strings.TrimSpace(*source.ProviderSessionID)
	}
	if sourceSession == "" {
		sourceRuntime, err := m.ensureRuntime(source, sourceWorkDir)
		if err != nil {
			return "", err
		}
		if err := sourceRuntime.refreshState(source); err != nil {
			return "", err
		}
		sourceRuntime.mu.Lock()
		if sourceRuntime.snapshot.SessionFile != nil {
			sourceSession = strings.TrimSpace(*sourceRuntime.snapshot.SessionFile)
		}
		sourceRuntime.mu.Unlock()
	}
	return sourceSession, nil
}

func (m *piConversationManager) ForkFromEntry(source *db.Conversation, forked *db.Conversation, sourceWorkDir, targetWorkDir, entryID, position string) (string, piConversationSnapshot, error) {
	sourceSession, err := m.sourceSessionFile(source, sourceWorkDir)
	if err != nil {
		return "", piConversationSnapshot{}, err
	}
	if sourceSession == "" {
		return "", piConversationSnapshot{}, fmt.Errorf("conversation has no pi session to fork")
	}

	selectedText, sessionFile, err := forkPiSessionFileFromEntry(sourceSession, targetWorkDir, entryID, position)
	if err != nil {
		return "", piConversationSnapshot{}, err
	}
	if _, err := m.db.UpdateConversation(forked.ID, db.UpdateConversationInput{
		ProviderSessionID: stringPtr(sessionFile),
	}); err != nil {
		return "", piConversationSnapshot{}, err
	}
	forked.ProviderSessionID = stringPtr(sessionFile)

	runtime, err := m.ensureRuntime(forked, targetWorkDir)
	if err != nil {
		return "", piConversationSnapshot{}, err
	}
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

func (m *piConversationManager) ConversationTree(conversation *db.Conversation) (piConversationTree, error) {
	sessionFile := ""
	if conversation.ProviderSessionID != nil {
		sessionFile = strings.TrimSpace(*conversation.ProviderSessionID)
	}
	if sessionFile == "" {
		return piConversationTree{Messages: []piConversationMessageVersionInfo{}}, nil
	}
	return piSessionTree(sessionFile)
}

func (m *piConversationManager) SelectTreeLeaf(conversation *db.Conversation, workDir, leafID string) (piConversationSnapshot, error) {
	leafID = strings.TrimSpace(leafID)
	if leafID == "" {
		return piConversationSnapshot{}, fmt.Errorf("leafId is required")
	}
	sessionFile := ""
	if conversation.ProviderSessionID != nil {
		sessionFile = strings.TrimSpace(*conversation.ProviderSessionID)
	}
	if sessionFile == "" {
		return piConversationSnapshot{}, fmt.Errorf("conversation has no pi session tree")
	}
	if runtime := m.existingRuntime(conversation.ID, workDir); runtime != nil {
		runtime.mu.Lock()
		streaming := runtime.snapshot.Streaming
		runtime.mu.Unlock()
		if streaming {
			return piConversationSnapshot{}, fmt.Errorf("cannot switch branches while pi is streaming")
		}
		runtime.stop()
		m.removeRuntime(conversation.ID, runtime)
	}
	if err := selectPiSessionLeaf(sessionFile, leafID); err != nil {
		return piConversationSnapshot{}, err
	}
	return staticPiConversationSnapshot(conversation, workDir), nil
}

func (m *piConversationManager) EditFromEntry(conversation *db.Conversation, workDir, entryID, message string, images []piConversationImageRef) (piConversationSnapshot, error) {
	entryID = strings.TrimSpace(entryID)
	message = strings.TrimSpace(message)
	if entryID == "" {
		return piConversationSnapshot{}, fmt.Errorf("entryId is required")
	}
	if message == "" && len(images) == 0 {
		return piConversationSnapshot{}, fmt.Errorf("message or image is required")
	}
	if conversation.Status != db.ConversationStatusActive {
		return piConversationSnapshot{}, fmt.Errorf("conversation is not active")
	}
	sessionFile := ""
	if conversation.ProviderSessionID != nil {
		sessionFile = strings.TrimSpace(*conversation.ProviderSessionID)
	}
	if sessionFile == "" {
		return piConversationSnapshot{}, fmt.Errorf("conversation has no pi session tree")
	}
	session, err := loadPiSessionFile(sessionFile)
	if err != nil {
		return piConversationSnapshot{}, err
	}
	entry, ok := session.ByID[entryID]
	if !ok {
		return piConversationSnapshot{}, fmt.Errorf("entry %s not found", entryID)
	}
	if entry.Type != "message" {
		return piConversationSnapshot{}, fmt.Errorf("entry %s cannot be edited", entryID)
	}
	messageMap, _ := entry.Raw["message"].(map[string]any)
	if stringFromMap(messageMap, "role") != "user" {
		return piConversationSnapshot{}, fmt.Errorf("only user messages can be edited")
	}
	targetLeafID := session.logicalConversationParentID(entry.ParentID)
	if strings.TrimSpace(targetLeafID) == "" {
		return piConversationSnapshot{}, fmt.Errorf("editing the first message in a pi tree is not available yet")
	}
	if runtime := m.existingRuntime(conversation.ID, workDir); runtime != nil {
		runtime.mu.Lock()
		streaming := runtime.snapshot.Streaming
		runtime.mu.Unlock()
		if streaming {
			return piConversationSnapshot{}, fmt.Errorf("cannot edit while pi is streaming")
		}
		runtime.stop()
		m.removeRuntime(conversation.ID, runtime)
	}
	if err := selectPiSessionLeaf(sessionFile, targetLeafID); err != nil {
		return piConversationSnapshot{}, err
	}
	return m.Prompt(conversation, workDir, message, images, "")
}

func (m *piConversationManager) Abort(conversation *db.Conversation, workDir string) error {
	if conversation.Status != db.ConversationStatusActive {
		return fmt.Errorf("conversation is not active")
	}
	runtime := m.existingRuntime(conversation.ID, workDir)
	if runtime == nil {
		return nil
	}
	if _, err := runtime.sendCommand(map[string]any{"type": "abort"}); err != nil {
		return err
	}
	runtime.mu.Lock()
	runtime.snapshot.Streaming = false
	runtime.snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	runtime.mu.Unlock()
	runtime.broadcast()
	return nil
}

func staticPiConversationSnapshot(conversation *db.Conversation, workDir string) piConversationSnapshot {
	snapshot := staticPiConversationSummary(conversation, workDir)
	if conversation.ProviderSessionID != nil && strings.TrimSpace(*conversation.ProviderSessionID) != "" {
		if messages, err := piSessionMessages(strings.TrimSpace(*conversation.ProviderSessionID)); err == nil {
			snapshot.Messages = messages
			snapshot.MessageCount = len(messages)
		}
	}
	return snapshot
}

func staticPiConversationSummary(conversation *db.Conversation, workDir string) piConversationSnapshot {
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
	rt.mu.Lock()
	streaming := rt.snapshot.Streaming
	sessionFile := ""
	if rt.snapshot.SessionFile != nil {
		sessionFile = strings.TrimSpace(*rt.snapshot.SessionFile)
	}
	rt.mu.Unlock()
	if !streaming && sessionFile != "" {
		if sessionMessages, err := piSessionMessages(sessionFile); err == nil && len(sessionMessages) >= len(messages) {
			messages = sessionMessages
		}
	} else if forkMessages, err := rt.forkMessages(); err == nil {
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

func clonePiSessionFile(sourceSession string, targetWorkDir string) (string, error) {
	session, err := loadPiSessionFile(sourceSession)
	if err != nil {
		return "", err
	}
	return writePiBranchSessionFile(session, sourceSession, targetWorkDir, session.LeafID)
}

func forkPiSessionFileFromEntry(sourceSession, targetWorkDir, entryID, position string) (string, string, error) {
	session, err := loadPiSessionFile(sourceSession)
	if err != nil {
		return "", "", err
	}
	entry, ok := session.ByID[entryID]
	if !ok {
		return "", "", fmt.Errorf("entry %s not found", entryID)
	}

	selectedText := ""
	targetLeafID := entry.ID
	if strings.TrimSpace(position) != "at" {
		if entry.Type != "message" {
			return "", "", fmt.Errorf("entry %s cannot be forked before", entryID)
		}
		message, _ := entry.Raw["message"].(map[string]any)
		if stringFromMap(message, "role") != "user" {
			return "", "", fmt.Errorf("entry %s cannot be forked before", entryID)
		}
		selectedText, _ = userContent(message["content"])
		targetLeafID = entry.ParentID
	}

	sessionFile, err := writePiBranchSessionFile(session, sourceSession, targetWorkDir, targetLeafID)
	if err != nil {
		return "", "", err
	}
	return selectedText, sessionFile, nil
}

func writePiBranchSessionFile(source *piSessionFile, sourceSession string, targetWorkDir string, targetLeafID string) (string, error) {
	entries, err := source.branchEntries(targetLeafID)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	timestamp := now.Format("2006-01-02T15:04:05.000Z")
	sessionID, err := randomSessionID()
	if err != nil {
		return "", err
	}
	sessionDir := filepath.Join(piAgentDir(), "sessions", piSessionDirName(targetWorkDir))
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		return "", fmt.Errorf("create pi session dir: %w", err)
	}
	sessionFile := filepath.Join(sessionDir, strings.NewReplacer(":", "-", ".", "-").Replace(timestamp)+"_"+sessionID+".jsonl")

	version := any(float64(3))
	if source.Header != nil && source.Header["version"] != nil {
		version = source.Header["version"]
	}
	header := map[string]any{
		"type":          "session",
		"version":       version,
		"id":            sessionID,
		"timestamp":     timestamp,
		"cwd":           targetWorkDir,
		"parentSession": sourceSession,
	}
	headerRaw, err := json.Marshal(header)
	if err != nil {
		return "", err
	}

	out := make([]string, 0, len(entries)+1)
	out = append(out, string(headerRaw))
	for _, entry := range entries {
		raw, err := json.Marshal(entry.Raw)
		if err != nil {
			return "", fmt.Errorf("marshal pi session entry: %w", err)
		}
		out = append(out, string(raw))
	}
	if err := os.WriteFile(sessionFile, []byte(strings.Join(out, "\n")+"\n"), 0644); err != nil {
		return "", fmt.Errorf("write forked pi session: %w", err)
	}
	return sessionFile, nil
}

func loadPiSessionFile(path string) (*piSessionFile, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read source pi session: %w", err)
	}
	defer file.Close()

	session := &piSessionFile{
		Entries: []piSessionEntry{},
		ByID:    make(map[string]piSessionEntry),
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			return nil, fmt.Errorf("parse pi session: %w", err)
		}
		entryType := stringFromMap(raw, "type")
		if entryType == "session" {
			session.Header = raw
			continue
		}
		id := stringFromMap(raw, "id")
		if id == "" {
			continue
		}
		entry := piSessionEntry{
			Type:      entryType,
			ID:        id,
			ParentID:  stringFromMap(raw, "parentId"),
			Timestamp: timestampFromValue(raw["timestamp"]),
			Raw:       raw,
		}
		session.Entries = append(session.Entries, entry)
		session.ByID[id] = entry
		session.LeafID = id
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read source pi session: %w", err)
	}
	if session.Header == nil {
		return nil, fmt.Errorf("source pi session has no header")
	}
	return session, nil
}

func (session *piSessionFile) branchEntries(leafID string) ([]piSessionEntry, error) {
	if strings.TrimSpace(leafID) == "" {
		return []piSessionEntry{}, nil
	}

	entries := make([]piSessionEntry, 0)
	seen := make(map[string]bool)
	currentID := leafID
	for currentID != "" {
		if seen[currentID] {
			return nil, fmt.Errorf("pi session branch contains a cycle at %s", currentID)
		}
		seen[currentID] = true
		entry, ok := session.ByID[currentID]
		if !ok {
			return nil, fmt.Errorf("pi session entry %s not found", currentID)
		}
		entries = append(entries, entry)
		currentID = entry.ParentID
	}
	for left, right := 0, len(entries)-1; left < right; left, right = left+1, right-1 {
		entries[left], entries[right] = entries[right], entries[left]
	}
	return entries, nil
}

func piSessionTree(sessionFile string) (piConversationTree, error) {
	session, err := loadPiSessionFile(sessionFile)
	if err != nil {
		return piConversationTree{}, err
	}
	return piSessionTreeFromSession(session)
}

func piSessionTreeFromSession(session *piSessionFile) (piConversationTree, error) {
	branch, err := session.branchEntries(session.LeafID)
	if err != nil {
		return piConversationTree{}, err
	}
	userSiblingsByParent := make(map[string][]piSessionEntry)
	for _, entry := range session.Entries {
		messageMap, _ := entry.Raw["message"].(map[string]any)
		if entry.Type != "message" || stringFromMap(messageMap, "role") != "user" {
			continue
		}
		parentID := session.logicalConversationParentID(entry.ParentID)
		userSiblingsByParent[parentID] = append(userSiblingsByParent[parentID], entry)
	}
	infos := make([]piConversationMessageVersionInfo, 0)
	for _, entry := range branch {
		messageMap, ok := entry.Raw["message"].(map[string]any)
		if entry.Type != "message" || !ok || stringFromMap(messageMap, "role") != "user" {
			continue
		}
		logicalParentID := session.logicalConversationParentID(entry.ParentID)
		userSiblings := userSiblingsByParent[logicalParentID]
		info := piConversationMessageVersionInfo{
			EntryID:      entry.ID,
			VersionIndex: 1,
			VersionCount: max(1, len(userSiblings)),
			CanEdit:      strings.TrimSpace(logicalParentID) != "",
		}
		if len(userSiblings) > 1 {
			activeIndex := 0
			for index, sibling := range userSiblings {
				if sibling.ID == entry.ID {
					activeIndex = index
					break
				}
			}
			info.VersionIndex = activeIndex + 1
			if activeIndex > 0 {
				info.PreviousLeafID = session.latestLeafForAncestor(userSiblings[activeIndex-1].ID)
			}
			if activeIndex < len(userSiblings)-1 {
				info.NextLeafID = session.latestLeafForAncestor(userSiblings[activeIndex+1].ID)
			}
		}
		infos = append(infos, info)
	}
	return piConversationTree{
		ActiveLeafID: session.LeafID,
		Messages:     infos,
	}, nil
}

func piSessionVersionInfoByEntryID(session *piSessionFile) map[string]piConversationMessageVersionInfo {
	tree, err := piSessionTreeFromSession(session)
	if err != nil {
		return map[string]piConversationMessageVersionInfo{}
	}
	byEntryID := make(map[string]piConversationMessageVersionInfo, len(tree.Messages))
	for _, info := range tree.Messages {
		byEntryID[info.EntryID] = info
	}
	return byEntryID
}

func (session *piSessionFile) logicalConversationParentID(parentID string) string {
	currentID := strings.TrimSpace(parentID)
	seen := make(map[string]bool)
	for currentID != "" {
		if seen[currentID] {
			return ""
		}
		seen[currentID] = true
		entry, ok := session.ByID[currentID]
		if !ok {
			return currentID
		}
		if !isTransparentPiTreeEntry(entry) {
			return currentID
		}
		currentID = strings.TrimSpace(entry.ParentID)
	}
	return ""
}

func isTransparentPiTreeEntry(entry piSessionEntry) bool {
	switch entry.Type {
	case "session_info", "model_change", "thinking_level_change", "label":
		return true
	default:
		return false
	}
}

func (session *piSessionFile) latestLeafForAncestor(ancestorID string) string {
	ancestorID = strings.TrimSpace(ancestorID)
	if ancestorID == "" {
		return ""
	}
	latest := ""
	var latestTimestamp time.Time
	hasChild := make(map[string]bool)
	for _, entry := range session.Entries {
		if strings.TrimSpace(entry.ParentID) != "" {
			hasChild[entry.ParentID] = true
		}
	}
	for _, entry := range session.Entries {
		if session.entryHasAncestor(entry.ID, ancestorID) {
			if hasChild[entry.ID] && entry.ID != ancestorID {
				continue
			}
			if latest == "" || entry.Timestamp.After(latestTimestamp) || (entry.Timestamp.IsZero() && latestTimestamp.IsZero()) {
				latest = entry.ID
				latestTimestamp = entry.Timestamp
			}
		}
	}
	if latest == "" {
		return ancestorID
	}
	return latest
}

func (session *piSessionFile) entryHasAncestor(entryID, ancestorID string) bool {
	seen := make(map[string]bool)
	currentID := entryID
	for currentID != "" {
		if currentID == ancestorID {
			return true
		}
		if seen[currentID] {
			return false
		}
		seen[currentID] = true
		entry, ok := session.ByID[currentID]
		if !ok {
			return false
		}
		currentID = entry.ParentID
	}
	return false
}

func selectPiSessionLeaf(sessionFile string, leafID string) error {
	leafID = strings.TrimSpace(leafID)
	if leafID == "" {
		return fmt.Errorf("leafId is required")
	}
	session, err := loadPiSessionFile(sessionFile)
	if err != nil {
		return err
	}
	selected, ok := session.ByID[leafID]
	if !ok {
		return fmt.Errorf("pi session leaf %s not found", leafID)
	}
	entries := make([]piSessionEntry, 0, len(session.Entries))
	for _, entry := range session.Entries {
		if entry.ID == leafID {
			continue
		}
		entries = append(entries, entry)
	}
	entries = append(entries, selected)
	return writePiSessionFile(sessionFile, session.Header, entries)
}

func writePiSessionFile(path string, header map[string]any, entries []piSessionEntry) error {
	if header == nil {
		return fmt.Errorf("pi session has no header")
	}
	out := make([]string, 0, len(entries)+1)
	headerRaw, err := json.Marshal(header)
	if err != nil {
		return fmt.Errorf("marshal pi session header: %w", err)
	}
	out = append(out, string(headerRaw))
	for _, entry := range entries {
		raw, err := json.Marshal(entry.Raw)
		if err != nil {
			return fmt.Errorf("marshal pi session entry: %w", err)
		}
		out = append(out, string(raw))
	}
	if err := os.WriteFile(path, []byte(strings.Join(out, "\n")+"\n"), 0644); err != nil {
		return fmt.Errorf("write pi session: %w", err)
	}
	return nil
}

func piSessionMessages(sessionFile string) ([]piConversationMessage, error) {
	session, err := loadPiSessionFile(sessionFile)
	if err != nil {
		return nil, err
	}
	entries, err := session.branchEntries(session.LeafID)
	if err != nil {
		return nil, err
	}
	messages := make([]piConversationMessage, 0, len(entries))
	versionInfoByEntryID := piSessionVersionInfoByEntryID(session)
	for _, entry := range entries {
		message, ok := piMessageFromSessionEntry(entry, len(messages))
		if ok {
			if info, hasInfo := versionInfoByEntryID[entry.ID]; hasInfo {
				message.Version = &info
			}
			messages = append(messages, message)
		}
	}
	return messages, nil
}

func piMessageFromSessionEntry(entry piSessionEntry, index int) (piConversationMessage, bool) {
	var message piConversationMessage
	switch entry.Type {
	case "message":
		messageMap, _ := entry.Raw["message"].(map[string]any)
		if messageMap == nil {
			return piConversationMessage{}, false
		}
		message = normalizePiMessage(messageMap, index)
	case "custom_message":
		message = piConversationMessage{
			Role: "custom",
		}
		message.Text, message.Images = userContent(entry.Raw["content"])
	case "branch_summary":
		message = piConversationMessage{
			Role: "branchSummary",
			Text: stringFromMap(entry.Raw, "summary"),
		}
	case "compaction":
		message = piConversationMessage{
			Role: "compactionSummary",
			Text: stringFromMap(entry.Raw, "summary"),
		}
	default:
		return piConversationMessage{}, false
	}
	message.ID = entry.ID
	message.EntryID = entry.ID
	message.Timestamp = entry.Timestamp.UTC().Format(time.RFC3339)
	return message, true
}

func piSessionDirName(cwd string) string {
	safe := strings.TrimPrefix(cwd, "/")
	safe = strings.TrimPrefix(safe, "\\")
	safe = strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(safe)
	return "--" + safe + "--"
}

func randomSessionID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate pi session id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4],
		b[4:6],
		b[6:8],
		b[8:10],
		b[10:16],
	), nil
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
			rt.snapshot.Pending.Text += rawStringFromMap(assistantEvent, "delta")
		case "thinking_delta":
			rt.snapshot.Pending.Thinking += rawStringFromMap(assistantEvent, "delta")
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
		} else if rt.manager.onNeedsAttention != nil {
			rt.manager.onNeedsAttention(rt.conversationID, "pi agent turn completed")
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

func rawStringFromMap(value map[string]any, key string) string {
	raw, _ := value[key].(string)
	return raw
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
