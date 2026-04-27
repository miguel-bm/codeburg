package api

import (
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
