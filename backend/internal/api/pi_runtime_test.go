package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

func TestPiConversationManagerEnsureRuntimeSingleflight(t *testing.T) {
	manager := newPiConversationManager(nil)
	conversation := &db.Conversation{
		ID:     "conversation-1",
		Status: db.ConversationStatusActive,
	}
	releaseStart := make(chan struct{})
	var starts int32
	manager.startRuntimeFn = func(conversation *db.Conversation, workDir string) (*piConversationRuntime, error) {
		atomic.AddInt32(&starts, 1)
		<-releaseStart
		return testPiRuntime(manager, conversation.ID, workDir), nil
	}

	const callers = 8
	results := make(chan *piConversationRuntime, callers)
	errs := make(chan error, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			runtime, err := manager.ensureRuntime(conversation, "/tmp/project")
			if err != nil {
				errs <- err
				return
			}
			results <- runtime
		}()
	}

	deadline := time.After(2 * time.Second)
	for atomic.LoadInt32(&starts) == 0 {
		select {
		case <-deadline:
			t.Fatal("runtime start did not begin")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	close(releaseStart)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatalf("ensure runtime: %v", err)
	}
	if got := atomic.LoadInt32(&starts); got != 1 {
		t.Fatalf("expected one runtime start, got %d", got)
	}

	var first *piConversationRuntime
	for runtime := range results {
		if first == nil {
			first = runtime
			continue
		}
		if runtime != first {
			t.Fatal("expected all callers to receive the same runtime")
		}
	}
}

func TestPiConversationPassiveReadsDoNotStartRuntime(t *testing.T) {
	manager := newPiConversationManager(nil)
	conversation := &db.Conversation{
		ID:     "conversation-1",
		Status: db.ConversationStatusActive,
	}
	var starts int32
	manager.startRuntimeFn = func(conversation *db.Conversation, workDir string) (*piConversationRuntime, error) {
		atomic.AddInt32(&starts, 1)
		return testPiRuntime(manager, conversation.ID, workDir), nil
	}

	snapshot := manager.PassiveSnapshot(conversation, "/tmp/project")
	if snapshot.RuntimeActive {
		t.Fatal("expected passive snapshot to be inactive when no runtime exists")
	}

	models, err := manager.AvailableModels(conversation, "/tmp/project")
	if err != nil {
		t.Fatalf("available models: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("expected no passive models, got %d", len(models))
	}

	commands, err := manager.Commands(conversation, "/tmp/project", false)
	if err != nil {
		t.Fatalf("commands: %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("expected no passive commands, got %d", len(commands))
	}

	if err := manager.Abort(conversation, "/tmp/project"); err != nil {
		t.Fatalf("abort without runtime: %v", err)
	}

	if got := atomic.LoadInt32(&starts); got != 0 {
		t.Fatalf("expected passive reads not to start runtime, got %d starts", got)
	}
}

func TestPiConversationStreamingDeltasPreserveWhitespace(t *testing.T) {
	runtime := testPiRuntime(newPiConversationManager(nil), "conversation-1", "/tmp/project")

	runtime.handleEvent(map[string]any{"type": "agent_start"})
	runtime.handleEvent(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": "Hello",
		},
	})
	runtime.handleEvent(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": " world",
		},
	})
	runtime.handleEvent(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": "\n\n- item",
		},
	})

	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.snapshot.Pending == nil {
		t.Fatal("expected pending assistant text")
	}
	if got := runtime.snapshot.Pending.Text; got != "Hello world\n\n- item" {
		t.Fatalf("expected streaming text whitespace to be preserved, got %q", got)
	}
}

func TestPiSessionBranchMessagesAndForksUseActiveBranch(t *testing.T) {
	sourceSession := writeTestPiSession(t, t.TempDir(), []map[string]any{
		{"type": "session", "version": 3, "id": "session-1", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/source"},
		{"type": "message", "id": "u1", "parentId": nil, "timestamp": "2026-01-01T00:00:01Z", "message": map[string]any{"role": "user", "content": "start"}},
		{"type": "message", "id": "a1", "parentId": "u1", "timestamp": "2026-01-01T00:00:02Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "answer"}}}},
		{"type": "message", "id": "u2", "parentId": "a1", "timestamp": "2026-01-01T00:00:03Z", "message": map[string]any{"role": "user", "content": "abandoned"}},
		{"type": "message", "id": "a2", "parentId": "u2", "timestamp": "2026-01-01T00:00:04Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "old branch"}}}},
		{"type": "message", "id": "u3", "parentId": "a1", "timestamp": "2026-01-01T00:00:05Z", "message": map[string]any{"role": "user", "content": "branch"}},
		{"type": "message", "id": "a3", "parentId": "u3", "timestamp": "2026-01-01T00:00:06Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "new branch"}}}},
	})

	messages, err := piSessionMessages(sourceSession)
	if err != nil {
		t.Fatalf("piSessionMessages: %v", err)
	}
	if got := messageEntryIDs(messages); got != "u1,a1,u3,a3" {
		t.Fatalf("expected active branch message IDs, got %s", got)
	}

	cloned, err := clonePiSessionFile(sourceSession, "/target")
	if err != nil {
		t.Fatalf("clonePiSessionFile: %v", err)
	}
	clonedMessages, err := piSessionMessages(cloned)
	if err != nil {
		t.Fatalf("cloned piSessionMessages: %v", err)
	}
	if got := messageEntryIDs(clonedMessages); got != "u1,a1,u3,a3" {
		t.Fatalf("expected cloned active branch IDs, got %s", got)
	}

	selected, assistantFork, err := forkPiSessionFileFromEntry(sourceSession, "/target", "a1", "at")
	if err != nil {
		t.Fatalf("fork assistant entry: %v", err)
	}
	if selected != "" {
		t.Fatalf("assistant fork should not return editor text, got %q", selected)
	}
	assistantForkMessages, err := piSessionMessages(assistantFork)
	if err != nil {
		t.Fatalf("assistant fork messages: %v", err)
	}
	if got := messageEntryIDs(assistantForkMessages); got != "u1,a1" {
		t.Fatalf("expected assistant fork through selected assistant, got %s", got)
	}

	selected, userFork, err := forkPiSessionFileFromEntry(sourceSession, "/target", "u3", "before")
	if err != nil {
		t.Fatalf("fork user entry: %v", err)
	}
	if selected != "branch" {
		t.Fatalf("expected selected user text, got %q", selected)
	}
	userForkMessages, err := piSessionMessages(userFork)
	if err != nil {
		t.Fatalf("user fork messages: %v", err)
	}
	if got := messageEntryIDs(userForkMessages); got != "u1,a1" {
		t.Fatalf("expected user fork before selected message, got %s", got)
	}

	tree, err := piSessionTree(sourceSession)
	if err != nil {
		t.Fatalf("piSessionTree: %v", err)
	}
	if tree.ActiveLeafID != "a3" {
		t.Fatalf("expected active leaf a3, got %s", tree.ActiveLeafID)
	}
	info := treeInfoByEntryID(tree, "u3")
	if info == nil {
		t.Fatal("expected tree info for active user message")
	}
	if info.VersionIndex != 2 || info.VersionCount != 2 || info.PreviousLeafID != "a2" || info.NextLeafID != "" || !info.CanEdit {
		t.Fatalf("unexpected u3 tree info: %+v", *info)
	}

	if err := selectPiSessionLeaf(sourceSession, "a2"); err != nil {
		t.Fatalf("selectPiSessionLeaf: %v", err)
	}
	selectedMessages, err := piSessionMessages(sourceSession)
	if err != nil {
		t.Fatalf("selected piSessionMessages: %v", err)
	}
	if got := messageEntryIDs(selectedMessages); got != "u1,a1,u2,a2" {
		t.Fatalf("expected selected previous branch, got %s", got)
	}
}

func TestPiSessionTreeGroupsUserVersionsAcrossSessionInfoEntries(t *testing.T) {
	sourceSession := writeTestPiSession(t, t.TempDir(), []map[string]any{
		{"type": "session", "version": 3, "id": "session-1", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/source"},
		{"type": "message", "id": "u1", "parentId": nil, "timestamp": "2026-01-01T00:00:01Z", "message": map[string]any{"role": "user", "content": "start"}},
		{"type": "message", "id": "a1", "parentId": "u1", "timestamp": "2026-01-01T00:00:02Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "answer"}}}},
		{"type": "message", "id": "u2", "parentId": "a1", "timestamp": "2026-01-01T00:00:03Z", "message": map[string]any{"role": "user", "content": "first version"}},
		{"type": "message", "id": "a2", "parentId": "u2", "timestamp": "2026-01-01T00:00:04Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "old"}}}},
		{"type": "session_info", "id": "info1", "parentId": "a1", "timestamp": "2026-01-01T00:00:05Z"},
		{"type": "message", "id": "u3", "parentId": "info1", "timestamp": "2026-01-01T00:00:06Z", "message": map[string]any{"role": "user", "content": "edited version"}},
		{"type": "message", "id": "a3", "parentId": "u3", "timestamp": "2026-01-01T00:00:07Z", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "new"}}}},
	})

	tree, err := piSessionTree(sourceSession)
	if err != nil {
		t.Fatalf("piSessionTree: %v", err)
	}
	info := treeInfoByEntryID(tree, "u3")
	if info == nil {
		t.Fatal("expected tree info for edited user message")
	}
	if info.VersionIndex != 2 || info.VersionCount != 2 || info.PreviousLeafID != "a2" || info.NextLeafID != "" || !info.CanEdit {
		t.Fatalf("unexpected u3 tree info: %+v", *info)
	}

	session, err := loadPiSessionFile(sourceSession)
	if err != nil {
		t.Fatalf("loadPiSessionFile: %v", err)
	}
	if got := session.logicalConversationParentID("info1"); got != "a1" {
		t.Fatalf("expected logical parent a1, got %s", got)
	}
}

func testPiRuntime(manager *piConversationManager, conversationID string, workDir string) *piConversationRuntime {
	return &piConversationRuntime{
		manager:         manager,
		conversationID:  conversationID,
		workDir:         workDir,
		pendingRequests: make(map[string]chan map[string]any),
		subs:            make(map[uint64]chan piConversationSnapshot),
		snapshot: piConversationSnapshot{
			ConversationID: conversationID,
			RuntimeActive:  true,
			WorkDir:        workDir,
			Messages:       []piConversationMessage{},
			Tools:          []piToolExecution{},
			UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		},
	}
}

func writeTestPiSession(t *testing.T, dir string, entries []map[string]any) string {
	t.Helper()
	path := filepath.Join(dir, "session.jsonl")
	lines := make([]byte, 0)
	for _, entry := range entries {
		raw, err := json.Marshal(entry)
		if err != nil {
			t.Fatalf("marshal session entry: %v", err)
		}
		lines = append(lines, raw...)
		lines = append(lines, '\n')
	}
	if err := os.WriteFile(path, lines, 0644); err != nil {
		t.Fatalf("write session: %v", err)
	}
	return path
}

func messageEntryIDs(messages []piConversationMessage) string {
	result := ""
	for _, message := range messages {
		if result != "" {
			result += ","
		}
		result += message.EntryID
	}
	return result
}

func treeInfoByEntryID(tree piConversationTree, entryID string) *piConversationMessageVersionInfo {
	for i := range tree.Messages {
		if tree.Messages[i].EntryID == entryID {
			return &tree.Messages[i]
		}
	}
	return nil
}
