package ptyruntime

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestManagerStartEmitsOutputAndExit(t *testing.T) {
	m := NewManager()

	var (
		mu  sync.Mutex
		out strings.Builder
	)
	exitCh := make(chan ExitResult, 1)

	err := m.Start("s1", StartOptions{
		Command: "/bin/sh",
		Args:    []string{"-lc", "printf 'hello-from-pty\\n'"},
		OnOutput: func(_ string, chunk []byte) {
			mu.Lock()
			out.Write(chunk)
			mu.Unlock()
		},
		OnExit: func(result ExitResult) {
			exitCh <- result
		},
	})
	if err != nil {
		t.Fatalf("start session: %v", err)
	}

	select {
	case result := <-exitCh:
		if result.ExitCode != 0 {
			t.Fatalf("expected exit code 0, got %d (err=%v)", result.ExitCode, result.Err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for process exit")
	}

	mu.Lock()
	got := out.String()
	mu.Unlock()
	if !strings.Contains(got, "hello-from-pty") {
		t.Fatalf("expected output to contain marker, got %q", got)
	}
	if m.Exists("s1") {
		t.Fatal("expected session to be removed after exit")
	}
}

func TestManagerStopUnknownSession(t *testing.T) {
	m := NewManager()
	err := m.Stop("missing")
	if !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
}
