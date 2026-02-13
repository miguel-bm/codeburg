package api

import (
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

func TestChallengeStoreOneTimeUse(t *testing.T) {
	cs := newChallengeStore()
	data := &webauthn.SessionData{}

	cs.Save("login", data)

	got := cs.Get("login")
	if got != data {
		t.Fatalf("expected stored session data pointer, got %v", got)
	}
	if again := cs.Get("login"); again != nil {
		t.Fatalf("expected one-time challenge to be removed, got %v", again)
	}
}

func TestChallengeStoreExpiresEntries(t *testing.T) {
	cs := newChallengeStore()
	data := &webauthn.SessionData{}
	cs.Save("register", data)

	cs.mu.Lock()
	entry := cs.sessions["register"]
	entry.expires = time.Now().Add(-1 * time.Second)
	cs.sessions["register"] = entry
	cs.mu.Unlock()

	if got := cs.Get("register"); got != nil {
		t.Fatalf("expected expired challenge to be nil, got %v", got)
	}
}
