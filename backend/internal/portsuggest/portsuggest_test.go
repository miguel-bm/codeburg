package portsuggest

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeScanner struct {
	ports []int
	err   error
}

func (f *fakeScanner) ListListeningPorts(_ context.Context) ([]int, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make([]int, len(f.ports))
	copy(out, f.ports)
	return out, nil
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(1200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func TestManagerIngestOutput_AddsSuggestionWhenPortListening(t *testing.T) {
	m := NewManager(&fakeScanner{ports: []int{5173}})
	m.IngestOutput("task-1", "sess-1", []byte("Local: http://localhost:5173/\n"))

	waitFor(t, func() bool {
		suggestions := m.ListTask("task-1")
		return len(suggestions) == 1 && suggestions[0].Port == 5173
	})
}

func TestManagerIngestOutput_IgnoresPortWhenNotListening(t *testing.T) {
	m := NewManager(&fakeScanner{ports: []int{}})
	m.IngestOutput("task-1", "sess-1", []byte("Listening on http://127.0.0.1:3000\n"))

	time.Sleep(80 * time.Millisecond)
	suggestions := m.ListTask("task-1")
	if len(suggestions) != 0 {
		t.Fatalf("expected no suggestions, got %#v", suggestions)
	}
}

func TestScanTask_RateLimited(t *testing.T) {
	m := NewManager(&fakeScanner{ports: []int{3000}})

	if _, err := m.ScanTask(context.Background(), "task-1"); err != nil {
		t.Fatalf("unexpected first scan error: %v", err)
	}
	if _, err := m.ScanTask(context.Background(), "task-1"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected ErrRateLimited, got %v", err)
	}
}

func TestSourcesMergeFromScanAndOutput(t *testing.T) {
	m := NewManager(&fakeScanner{ports: []int{3000}})

	if _, err := m.ScanTask(context.Background(), "task-1"); err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	m.IngestOutput("task-1", "sess-1", []byte("Listening on localhost:3000\n"))

	waitFor(t, func() bool {
		suggestions := m.ListTask("task-1")
		if len(suggestions) != 1 {
			return false
		}
		if len(suggestions[0].Sources) != 2 {
			return false
		}
		return suggestions[0].Sources[0] == sourceOutput && suggestions[0].Sources[1] == sourceScan
	})
}

func TestExtractPorts(t *testing.T) {
	line := "Server started. Local: http://0.0.0.0:8080, port=9090, listening on localhost:3000"
	ports := extractPorts(line)
	want := map[int]bool{8080: true, 9090: true, 3000: true}
	for _, p := range ports {
		delete(want, p)
	}
	if len(want) != 0 {
		t.Fatalf("missing expected ports: %#v (got=%#v)", want, ports)
	}
}
