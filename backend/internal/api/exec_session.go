package api

import (
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

// Session represents a running agent session in memory (all sessions are terminal-based).
type Session struct {
	ID                string
	TaskID            string
	ProviderSessionID string
	Provider          string
	Status            db.SessionStatus
	WorkDir           string
	LastActivityAt    time.Time
	FallbackStarted   bool
	mu                sync.Mutex
}

// GetStatus returns the session status (thread-safe)
func (s *Session) GetStatus() db.SessionStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Status
}

// SetStatus updates the session status (thread-safe)
func (s *Session) SetStatus(status db.SessionStatus) {
	s.mu.Lock()
	s.Status = status
	s.mu.Unlock()
}

// CompareAndSetStatus atomically sets status to new if current equals expected.
// Returns true if the swap happened.
func (s *Session) CompareAndSetStatus(expected, new db.SessionStatus) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Status != expected {
		return false
	}
	s.Status = new
	return true
}

// SetLastActivity updates the last activity timestamp (thread-safe)
func (s *Session) SetLastActivity(t time.Time) {
	s.mu.Lock()
	s.LastActivityAt = t
	s.mu.Unlock()
}

// GetLastActivity returns the last activity timestamp (thread-safe)
func (s *Session) GetLastActivity() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.LastActivityAt
}

// MarkFallbackStarted marks that this session has already been handed off to a
// fallback terminal once. Returns false if it was already marked.
func (s *Session) MarkFallbackStarted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.FallbackStarted {
		return false
	}
	s.FallbackStarted = true
	return true
}

// ClearFallbackStarted clears the fallback marker.
func (s *Session) ClearFallbackStarted() {
	s.mu.Lock()
	s.FallbackStarted = false
	s.mu.Unlock()
}

// FallbackWasStarted reports whether fallback handoff has been used.
func (s *Session) FallbackWasStarted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.FallbackStarted
}
