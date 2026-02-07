package api

import (
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

// Session represents a running agent session in memory (all sessions are terminal-based).
type Session struct {
	ID                string
	ProviderSessionID string
	Provider          string
	Status            db.SessionStatus
	TmuxWindow        string
	TmuxPane          string
	LastActivityAt    time.Time
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
