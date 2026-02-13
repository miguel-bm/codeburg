package api

import (
	"context"
	"testing"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

func TestWSHubRunStopsOnContextCancel(t *testing.T) {
	hub := NewWSHub()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		hub.Run(ctx)
		close(done)
	}()

	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for websocket hub to stop")
	}

	client := &WSClient{
		hub:  hub,
		send: make(chan []byte, 1),
		subs: make(map[string]bool),
	}
	if hub.Register(client) {
		t.Fatal("expected register to fail after hub shutdown")
	}
}

func TestSessionCleanupLoopStopsOnContextCancel(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	sm := NewSessionManager()
	hub := NewWSHub()
	server := &Server{
		db:       database,
		wsHub:    hub,
		sessions: sm,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		sm.StartCleanupLoop(ctx, server)
		close(done)
	}()

	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for session cleanup loop to stop")
	}
}
