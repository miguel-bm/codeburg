package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/miguel-bm/codeburg/internal/db"
)

// codeburgUser implements webauthn.User for the single Codeburg user.
type codeburgUser struct {
	db *db.DB
}

func (u *codeburgUser) WebAuthnID() []byte {
	return []byte("default")
}

func (u *codeburgUser) WebAuthnName() string {
	return "codeburg"
}

func (u *codeburgUser) WebAuthnDisplayName() string {
	return "Codeburg User"
}

func (u *codeburgUser) WebAuthnCredentials() []webauthn.Credential {
	passkeys, err := u.db.ListPasskeys()
	if err != nil {
		slog.Error("failed to load passkeys for WebAuthn", "error", err)
		return nil
	}
	creds := make([]webauthn.Credential, 0, len(passkeys))
	for _, p := range passkeys {
		creds = append(creds, dbPasskeyToCredential(p))
	}
	return creds
}

func dbPasskeyToCredential(p db.Passkey) webauthn.Credential {
	cred := webauthn.Credential{
		ID:              p.CredentialID,
		PublicKey:       p.PublicKey,
		AttestationType: p.AttestationType,
		Authenticator: webauthn.Authenticator{
			AAGUID:    p.AAGUID,
			SignCount: p.SignCount,
		},
	}
	if p.Transports != nil {
		var transports []protocol.AuthenticatorTransport
		if err := json.Unmarshal([]byte(*p.Transports), &transports); err == nil {
			cred.Transport = transports
		}
	}
	return cred
}

// challengeStore holds WebAuthn session data in memory with a TTL.
type challengeStore struct {
	mu       sync.Mutex
	sessions map[string]challengeEntry // key: "register" or "login"
}

type challengeEntry struct {
	data    *webauthn.SessionData
	expires time.Time
}

func newChallengeStore() *challengeStore {
	return &challengeStore{
		sessions: make(map[string]challengeEntry),
	}
}

func (cs *challengeStore) Save(key string, data *webauthn.SessionData) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.sessions[key] = challengeEntry{
		data:    data,
		expires: time.Now().Add(5 * time.Minute),
	}
}

func (cs *challengeStore) Get(key string) *webauthn.SessionData {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	entry, ok := cs.sessions[key]
	if !ok || time.Now().After(entry.expires) {
		delete(cs.sessions, key)
		return nil
	}
	delete(cs.sessions, key) // one-time use
	return entry.data
}

// Handlers

func (s *Server) handlePasskeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if s.webauthn == nil {
		writeError(w, http.StatusNotFound, "passkeys not configured (set origin in config)")
		return
	}

	user := &codeburgUser{db: s.db}

	creation, session, err := s.webauthn.BeginRegistration(user,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
	)
	if err != nil {
		slog.Error("passkey register begin failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to begin registration")
		return
	}

	s.challenges.Save("register", session)
	writeJSON(w, http.StatusOK, creation)
}

func (s *Server) handlePasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if s.webauthn == nil {
		writeError(w, http.StatusNotFound, "passkeys not configured")
		return
	}

	session := s.challenges.Get("register")
	if session == nil {
		writeError(w, http.StatusBadRequest, "no registration in progress or challenge expired")
		return
	}

	user := &codeburgUser{db: s.db}
	cred, err := s.webauthn.FinishRegistration(user, *session, r)
	if err != nil {
		slog.Error("passkey register finish failed", "error", err)
		writeError(w, http.StatusBadRequest, "registration verification failed")
		return
	}

	// Marshal transports to JSON
	var transports *string
	if len(cred.Transport) > 0 {
		b, _ := json.Marshal(cred.Transport)
		s := string(b)
		transports = &s
	}

	passkey := &db.Passkey{
		CredentialID:    cred.ID,
		PublicKey:       cred.PublicKey,
		AttestationType: cred.AttestationType,
		AAGUID:          cred.Authenticator.AAGUID,
		SignCount:       cred.Authenticator.SignCount,
		Name:            "Passkey",
		Transports:      transports,
	}

	if err := s.db.CreatePasskey(passkey); err != nil {
		slog.Error("failed to save passkey", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save passkey")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"id":   passkey.ID,
		"name": passkey.Name,
	})
}

func (s *Server) handlePasskeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	if s.webauthn == nil {
		writeError(w, http.StatusNotFound, "passkeys not configured")
		return
	}

	ip := clientIP(r)
	if !s.authLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	assertion, session, err := s.webauthn.BeginDiscoverableLogin()
	if err != nil {
		slog.Error("passkey login begin failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to begin login")
		return
	}

	s.challenges.Save("login", session)
	writeJSON(w, http.StatusOK, assertion)
}

func (s *Server) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	if s.webauthn == nil {
		writeError(w, http.StatusNotFound, "passkeys not configured")
		return
	}

	ip := clientIP(r)
	if !s.authLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	session := s.challenges.Get("login")
	if session == nil {
		s.authLimiter.record(ip)
		writeError(w, http.StatusBadRequest, "no login in progress or challenge expired")
		return
	}

	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		return &codeburgUser{db: s.db}, nil
	}

	_, cred, err := s.webauthn.FinishPasskeyLogin(handler, *session, r)
	if err != nil {
		s.authLimiter.record(ip)
		slog.Error("passkey login finish failed", "error", err)
		writeError(w, http.StatusUnauthorized, "passkey verification failed")
		return
	}

	// Update sign count and last used time for the passkey
	pk, dbErr := s.db.GetPasskeyByCredentialID(cred.ID)
	if dbErr == nil {
		s.db.UpdatePasskeySignCount(pk.ID, cred.Authenticator.SignCount)
		s.db.UpdatePasskeyLastUsed(pk.ID)
	}

	s.authLimiter.reset(ip)

	token, err := s.auth.GenerateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}

func (s *Server) handleListPasskeys(w http.ResponseWriter, r *http.Request) {
	passkeys, err := s.db.ListPasskeys()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list passkeys")
		return
	}

	type passkeyInfo struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		CreatedAt  string  `json:"createdAt"`
		LastUsedAt *string `json:"lastUsedAt,omitempty"`
	}

	result := make([]passkeyInfo, 0, len(passkeys))
	for _, p := range passkeys {
		info := passkeyInfo{
			ID:        p.ID,
			Name:      p.Name,
			CreatedAt: p.CreatedAt.Format(time.RFC3339),
		}
		if p.LastUsedAt != nil {
			s := p.LastUsedAt.Format(time.RFC3339)
			info.LastUsedAt = &s
		}
		result = append(result, info)
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRenamePasskey(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	var input struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &input); err != nil || input.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	if err := s.db.RenamePasskey(id, input.Name); err != nil {
		writeDBError(w, err, "passkey")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeletePasskey(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	if err := s.db.DeletePasskey(id); err != nil {
		writeDBError(w, err, "passkey")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
