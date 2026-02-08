package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/tmux"
)

// SessionManager manages active agent sessions
type SessionManager struct {
	tmux     *tmux.Manager
	sessions map[string]*Session // sessionID -> running session
	mu       sync.RWMutex
}

// NewSessionManager creates a new session manager
func NewSessionManager() *SessionManager {
	return &SessionManager{
		tmux:     tmux.NewManager(),
		sessions: make(map[string]*Session),
	}
}

// getOrRestore looks up a session in the in-memory map, falling back to the DB.
// If the DB session has a live tmux window, it is restored to the in-memory map.
func (sm *SessionManager) getOrRestore(sessionID string, database *db.DB) *Session {
	// Fast path: check in-memory map
	sm.mu.RLock()
	session, ok := sm.sessions[sessionID]
	sm.mu.RUnlock()
	if ok {
		return session
	}

	// Slow path: check DB
	dbSession, err := database.GetSession(sessionID)
	if err != nil {
		return nil
	}

	if dbSession.TmuxWindow == nil {
		return nil
	}

	if !sm.tmux.WindowExists(*dbSession.TmuxWindow) {
		return nil
	}

	// Restore to in-memory map
	pane := ""
	if dbSession.TmuxPane != nil {
		pane = *dbSession.TmuxPane
	}
	restored := &Session{
		ID:         dbSession.ID,
		Provider:   dbSession.Provider,
		Status:     dbSession.Status,
		TmuxWindow: *dbSession.TmuxWindow,
		TmuxPane:   pane,
	}
	sm.mu.Lock()
	sm.sessions[dbSession.ID] = restored
	sm.mu.Unlock()

	slog.Info("session restored from DB", "session_id", sessionID, "provider", dbSession.Provider)
	return restored
}

// Reconcile restores in-memory session state from the database on startup.
// Sessions with live tmux windows are restored; stale sessions are marked completed.
func (sm *SessionManager) Reconcile(database *db.DB) {
	sessions, err := database.ListActiveSessions()
	if err != nil {
		slog.Error("session reconciliation failed", "error", err)
		return
	}

	var restored, cleaned int
	for _, s := range sessions {
		if s.TmuxWindow == nil {
			// No tmux window recorded — mark completed
			completedStatus := db.SessionStatusCompleted
			database.UpdateSession(s.ID, db.UpdateSessionInput{Status: &completedStatus})
			cleaned++
			continue
		}

		if sm.tmux.WindowExists(*s.TmuxWindow) {
			// Tmux window still alive — restore to in-memory map
			pane := ""
			if s.TmuxPane != nil {
				pane = *s.TmuxPane
			}
			execSession := &Session{
				ID:         s.ID,
				Provider:   s.Provider,
				Status:     s.Status,
				TmuxWindow: *s.TmuxWindow,
				TmuxPane:   pane,
			}
			sm.mu.Lock()
			sm.sessions[s.ID] = execSession
			sm.mu.Unlock()
			slog.Info("session restored", "session_id", s.ID, "provider", s.Provider, "tmux_window", *s.TmuxWindow)
			restored++
		} else {
			// Tmux window gone — mark completed
			completedStatus := db.SessionStatusCompleted
			database.UpdateSession(s.ID, db.UpdateSessionInput{Status: &completedStatus})
			slog.Info("stale session cleaned up", "session_id", s.ID, "provider", s.Provider)
			cleaned++
		}
	}

	slog.Info("session reconciliation complete", "restored", restored, "cleaned", cleaned)
}

// StartSessionRequest contains the request body for starting a session
type StartSessionRequest struct {
	Provider        string `json:"provider"`        // "claude", "codex", "terminal" (default: "claude")
	Prompt          string `json:"prompt"`           // Initial prompt (claude/codex sessions)
	Model           string `json:"model"`            // Optional model override
	ResumeSessionID string `json:"resumeSessionId"`  // Codeburg session ID to resume (claude only)
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "taskId")

	// Verify task exists
	_, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	sessions, err := s.db.ListSessionsByTask(taskID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "taskId")

	// Verify task exists and get it
	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Parse request body
	var req StartSessionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Default provider to "claude"
	if req.Provider == "" {
		req.Provider = "claude"
	}

	// Validate provider
	if req.Provider != "claude" && req.Provider != "codex" && req.Provider != "terminal" {
		writeError(w, http.StatusBadRequest, "invalid provider: "+req.Provider)
		return
	}

	// Validate model name if provided (interpolated into shell commands)
	if req.Model != "" && !isValidModelName(req.Model) {
		writeError(w, http.StatusBadRequest, "invalid model name: must start with a letter and contain only letters, digits, hyphens, dots, and colons")
		return
	}

	session, err := s.startSessionInternal(task, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, session)
}

// startSessionInternal creates and starts a session for the given task.
// It handles tmux window creation, hook setup, and command injection.
func (s *Server) startSessionInternal(task *db.Task, req StartSessionRequest) (*db.AgentSession, error) {
	provider := req.Provider

	// Get project for worktree path
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// Determine working directory (worktree if available, else project path)
	workDir := project.Path
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	}

	// Check tmux availability
	if !s.sessions.tmux.Available() {
		return nil, fmt.Errorf("tmux not available")
	}

	// Ensure tmux session exists
	if err := s.sessions.tmux.EnsureSession(); err != nil {
		return nil, fmt.Errorf("failed to ensure tmux session: %w", err)
	}

	// Create tmux window
	windowName := fmt.Sprintf("%s-%d", provider, time.Now().Unix())
	windowInfo, err := s.sessions.tmux.CreateWindow(windowName, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to create terminal window: %w", err)
	}

	// Create database session (all sessions are terminal type now)
	dbSession, err := s.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		Provider:    provider,
		SessionType: "terminal",
		TmuxWindow:  &windowInfo.Window,
		TmuxPane:    &windowInfo.Pane,
	})
	if err != nil {
		s.sessions.tmux.DestroyWindow(windowInfo.Window)
		return nil, fmt.Errorf("failed to create session record")
	}

	// Generate a scoped JWT token for hook callbacks
	hookToken, err := s.auth.GenerateHookToken(dbSession.ID)
	if err != nil {
		s.sessions.tmux.DestroyWindow(windowInfo.Window)
		s.db.DeleteSession(dbSession.ID)
		return nil, fmt.Errorf("failed to generate hook token")
	}

	// Write token to ~/.codeburg/tokens/{sessionID}
	tokenPath, err := writeHookToken(dbSession.ID, hookToken)
	if err != nil {
		slog.Warn("failed to write hook token file", "session_id", dbSession.ID, "error", err)
		// Fall through — scripts will fail but session still works
	}

	// Get API base URL
	apiURL := os.Getenv("CODEBURG_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080"
	}

	target := windowInfo.Target

	switch provider {
	case "claude":
		// Write Claude Code hooks config to workDir
		if err := writeClaudeHooks(workDir, dbSession.ID, tokenPath, apiURL); err != nil {
			slog.Warn("failed to write Claude hooks", "session_id", dbSession.ID, "error", err)
		}

		// Build claude command
		var cmd string
		if req.ResumeSessionID != "" {
			// Resuming a previous session
			oldSession, err := s.db.GetSession(req.ResumeSessionID)
			if err == nil && oldSession.ProviderSessionID != nil && *oldSession.ProviderSessionID != "" {
				cmd = fmt.Sprintf("claude --dangerously-skip-permissions --resume %s", *oldSession.ProviderSessionID)
				slog.Info("resuming claude session", "session_id", dbSession.ID, "provider_session_id", *oldSession.ProviderSessionID)
			} else {
				cmd = "claude --dangerously-skip-permissions --continue"
				slog.Info("resuming claude session with --continue", "session_id", dbSession.ID)
			}
		} else if req.Prompt != "" {
			cmd = fmt.Sprintf("claude --dangerously-skip-permissions %q", req.Prompt)
			if req.Model != "" {
				cmd = fmt.Sprintf("claude --dangerously-skip-permissions --model %s %q", req.Model, req.Prompt)
			}
		} else {
			cmd = "claude --dangerously-skip-permissions"
			if req.Model != "" {
				cmd = fmt.Sprintf("claude --dangerously-skip-permissions --model %s", req.Model)
			}
		}
		if err := s.sessions.tmux.SendKeys(target, cmd, true); err != nil {
			slog.Error("failed to inject claude command", "session_id", dbSession.ID, "error", err)
		}

	case "codex":
		// Write codex notify script
		if err := writeCodexNotifyScript(workDir, dbSession.ID, tokenPath, apiURL); err != nil {
			slog.Warn("failed to write codex notify script", "session_id", dbSession.ID, "error", err)
		}

		// Inject codex command using -c to set notify via config override
		notifyScript := filepath.Join(workDir, ".codeburg-notify.sh")
		notifyFlag := fmt.Sprintf(`-c 'notify=["%s"]'`, notifyScript)
		var cmd string
		if req.Prompt != "" {
			cmd = fmt.Sprintf("codex --full-auto %s %q", notifyFlag, req.Prompt)
			if req.Model != "" {
				cmd = fmt.Sprintf("codex --full-auto --model %s %s %q", req.Model, notifyFlag, req.Prompt)
			}
		} else {
			cmd = fmt.Sprintf("codex --full-auto %s", notifyFlag)
			if req.Model != "" {
				cmd = fmt.Sprintf("codex --full-auto --model %s %s", req.Model, notifyFlag)
			}
		}
		if err := s.sessions.tmux.SendKeys(target, cmd, true); err != nil {
			slog.Error("failed to inject codex command", "session_id", dbSession.ID, "error", err)
		}

	case "terminal":
		// Inject command if provided (e.g. justfile recipe execution)
		if req.Prompt != "" {
			if err := s.sessions.tmux.SendKeys(target, req.Prompt, true); err != nil {
				slog.Error("failed to inject terminal command", "session_id", dbSession.ID, "error", err)
			}
		}
	}

	// Update status to running
	runningStatus := db.SessionStatusRunning
	s.db.UpdateSession(dbSession.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// Store in-memory session
	execSession := &Session{
		ID:         dbSession.ID,
		Provider:   provider,
		Status:     db.SessionStatusRunning,
		TmuxWindow: windowInfo.Window,
		TmuxPane:   windowInfo.Pane,
	}
	s.sessions.mu.Lock()
	s.sessions.sessions[dbSession.ID] = execSession
	s.sessions.mu.Unlock()

	updatedSession, err := s.db.GetSession(dbSession.ID)
	if err != nil {
		slog.Warn("failed to reload session after start", "session_id", dbSession.ID, "error", err)
		return dbSession, nil
	}
	return updatedSession, nil
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	session, err := s.db.GetSession(id)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	writeJSON(w, http.StatusOK, session)
}

// SendMessageRequest contains the request body for sending a message
type SendMessageRequest struct {
	Content string `json:"content"`
}

func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	// Get session from database
	session, err := s.db.GetSession(id)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	// Check if session is active
	if session.Status != db.SessionStatusRunning && session.Status != db.SessionStatusWaitingInput {
		writeError(w, http.StatusBadRequest, "session is not active")
		return
	}

	// Parse request body
	var req SendMessageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	// Get the running session (with DB fallback)
	execSession := s.sessions.getOrRestore(id, s.db)
	if execSession == nil {
		writeError(w, http.StatusBadRequest, "session not running on this server")
		return
	}

	// All sessions use tmux for message delivery
	target := fmt.Sprintf("%s:%s.%s", tmux.SessionName, execSession.TmuxWindow, execSession.TmuxPane)
	if err := s.sessions.tmux.SendKeys(target, req.Content, true); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send message: "+err.Error())
		return
	}

	// Update status to running
	runningStatus := db.SessionStatusRunning
	s.db.UpdateSession(id, db.UpdateSessionInput{
		Status: &runningStatus,
	})

	// Broadcast to WebSocket subscribers
	s.wsHub.BroadcastToSession(id, "message_sent", map[string]string{
		"content": req.Content,
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Server) handleStopSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	// Get session from database
	dbSession, err := s.db.GetSession(id)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	// Try to get from in-memory map (with DB fallback)
	execSession := s.sessions.getOrRestore(id, s.db)
	if execSession != nil {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, id)
		s.sessions.mu.Unlock()
		s.sessions.tmux.DestroyWindow(execSession.TmuxWindow)
	} else if dbSession.TmuxWindow != nil {
		// Best-effort cleanup: try killing tmux window from DB record
		if err := s.sessions.tmux.DestroyWindow(*dbSession.TmuxWindow); err != nil {
			slog.Debug("best-effort tmux window cleanup failed", "session_id", id, "tmux_window", *dbSession.TmuxWindow, "error", err)
		}
	}

	// Update status
	completedStatus := db.SessionStatusCompleted
	s.db.UpdateSession(id, db.UpdateSessionInput{
		Status: &completedStatus,
	})

	// Clean up token file
	removeHookToken(id)

	// Broadcast to WebSocket
	s.wsHub.BroadcastToSession(id, "session_stopped", nil)
	s.wsHub.BroadcastToTask(dbSession.TaskID, "session_status_changed", map[string]string{
		"sessionId": id,
		"status":    string(db.SessionStatusCompleted),
	})

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	// Get session from database
	dbSession, err := s.db.GetSession(id)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	// Stop if still active (destroy tmux window, clean up in-memory state)
	execSession := s.sessions.getOrRestore(id, s.db)
	if execSession != nil {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, id)
		s.sessions.mu.Unlock()
		s.sessions.tmux.DestroyWindow(execSession.TmuxWindow)
	} else if dbSession.TmuxWindow != nil {
		if err := s.sessions.tmux.DestroyWindow(*dbSession.TmuxWindow); err != nil {
			slog.Debug("best-effort tmux window cleanup failed", "session_id", id, "error", err)
		}
	}

	// Clean up token file
	removeHookToken(id)

	// Remove session log file
	removeSessionLog(id)

	// Delete from database
	if err := s.db.DeleteSession(id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete session")
		return
	}

	// Broadcast to WebSocket
	s.wsHub.BroadcastToSession(id, "session_deleted", nil)
	s.wsHub.BroadcastToTask(dbSession.TaskID, "session_deleted", map[string]string{
		"sessionId": id,
	})

	w.WriteHeader(http.StatusNoContent)
}

// setSessionRunning updates a session's status to running if it's currently waiting_input
func (sm *SessionManager) setSessionRunning(sessionID string, database *db.DB, wsHub *WSHub) {
	session := sm.getOrRestore(sessionID, database)
	if session == nil {
		return
	}

	if session.CompareAndSetStatus(db.SessionStatusWaitingInput, db.SessionStatusRunning) {
		runningStatus := db.SessionStatusRunning
		database.UpdateSession(sessionID, db.UpdateSessionInput{
			Status: &runningStatus,
		})
		wsHub.BroadcastToSession(sessionID, "status_changed", map[string]string{
			"status": "running",
		})
	}
}

// StartCleanupLoop runs a background goroutine that detects zombie sessions
// (sessions in-memory whose tmux windows have disappeared) and marks them completed.
func (sm *SessionManager) StartCleanupLoop(database *db.DB, wsHub *WSHub) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Copy session IDs under read lock
		sm.mu.RLock()
		ids := make([]string, 0, len(sm.sessions))
		for id := range sm.sessions {
			ids = append(ids, id)
		}
		sm.mu.RUnlock()

		var cleaned int
		for _, id := range ids {
			sm.mu.RLock()
			session, ok := sm.sessions[id]
			sm.mu.RUnlock()
			if !ok {
				continue
			}

			if !sm.tmux.WindowExists(session.TmuxWindow) {
				// Window gone — clean up
				sm.mu.Lock()
				delete(sm.sessions, id)
				sm.mu.Unlock()

				completedStatus := db.SessionStatusCompleted
				database.UpdateSession(id, db.UpdateSessionInput{Status: &completedStatus})
				removeHookToken(id)

				// Get task ID for broadcast
				if dbSession, err := database.GetSession(id); err == nil {
					wsHub.BroadcastToTask(dbSession.TaskID, "session_status_changed", map[string]string{
						"sessionId": id,
						"status":    string(db.SessionStatusCompleted),
					})
				}
				wsHub.BroadcastToSession(id, "session_stopped", nil)

				slog.Info("zombie session cleaned up", "session_id", id, "provider", session.Provider)
				cleaned++
			}
		}

		slog.Debug("cleanup tick", "checked", len(ids), "cleaned", cleaned)
	}
}

// writeHookToken writes a scoped token to ~/.codeburg/tokens/{sessionID} and returns the path.
func writeHookToken(sessionID, token string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	dir := filepath.Join(home, ".codeburg", "tokens")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create tokens dir: %w", err)
	}
	tokenPath := filepath.Join(dir, sessionID)
	if err := os.WriteFile(tokenPath, []byte(token), 0600); err != nil {
		return "", fmt.Errorf("write token file: %w", err)
	}
	return tokenPath, nil
}

// removeHookToken deletes the token file for a session.
func removeHookToken(sessionID string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	os.Remove(filepath.Join(home, ".codeburg", "tokens", sessionID))
}

// removeSessionLog deletes the log file for a session.
func removeSessionLog(sessionID string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	os.Remove(filepath.Join(home, ".codeburg", "logs", "sessions", sessionID+".jsonl"))
}

// writeClaudeHooks writes .claude/settings.local.json with hooks that call back to Codeburg.
// Existing user hooks on other events (and other matcher entries on the same events) are preserved.
func writeClaudeHooks(workDir, sessionID, tokenPath, apiURL string) error {
	claudeDir := filepath.Join(workDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		return fmt.Errorf("create .claude dir: %w", err)
	}

	settingsPath := filepath.Join(claudeDir, "settings.local.json")

	// Read existing settings if present
	var settings map[string]interface{}
	if data, err := os.ReadFile(settingsPath); err == nil {
		json.Unmarshal(data, &settings)
	}
	if settings == nil {
		settings = make(map[string]interface{})
	}

	hookURL := fmt.Sprintf("%s/api/sessions/%s/hook", apiURL, sessionID)
	curlCmd := fmt.Sprintf(
		"curl -s -X POST -H \"Authorization: Bearer $(cat '%s')\" -H 'Content-Type: application/json' -d @- '%s'",
		tokenPath, hookURL,
	)

	codeburgEntry := map[string]interface{}{
		"matcher": "",
		"hooks": []interface{}{
			map[string]interface{}{
				"type":    "command",
				"command": curlCmd,
			},
		},
	}

	// Get or create the top-level hooks object
	hooksObj, _ := settings["hooks"].(map[string]interface{})
	if hooksObj == nil {
		hooksObj = make(map[string]interface{})
	}

	// For each event Codeburg needs, strip old Codeburg entries then append the new one
	for _, event := range []string{"Notification", "Stop", "SessionEnd"} {
		var kept []interface{}

		// Preserve existing non-Codeburg matcher entries
		if existing, ok := hooksObj[event].([]interface{}); ok {
			for _, entry := range existing {
				if !isCodeburgHookEntry(entry) {
					kept = append(kept, entry)
				}
			}
		}

		hooksObj[event] = append(kept, codeburgEntry)
	}

	settings["hooks"] = hooksObj

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}

	return os.WriteFile(settingsPath, data, 0644)
}

// isCodeburgHookEntry returns true if a matcher entry was written by Codeburg.
// Identified by a command hook containing "/api/sessions/" and "/hook".
func isCodeburgHookEntry(entry interface{}) bool {
	m, ok := entry.(map[string]interface{})
	if !ok {
		return false
	}
	hooks, ok := m["hooks"].([]interface{})
	if !ok {
		return false
	}
	for _, h := range hooks {
		hook, ok := h.(map[string]interface{})
		if !ok {
			continue
		}
		cmd, _ := hook["command"].(string)
		if strings.Contains(cmd, "/api/sessions/") && strings.Contains(cmd, "/hook") {
			return true
		}
	}
	return false
}

// writeCodexNotifyScript writes a .codeburg-notify.sh script that calls back to Codeburg.
// Codex invokes the notify script with the event JSON as the last positional argument ($1).
func writeCodexNotifyScript(workDir, sessionID, tokenPath, apiURL string) error {
	hookURL := fmt.Sprintf("%s/api/sessions/%s/hook", apiURL, sessionID)
	scriptPath := filepath.Join(workDir, ".codeburg-notify.sh")

	script := fmt.Sprintf(`#!/bin/bash
TOKEN=$(cat '%s')
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$1" \
  '%s'
`, tokenPath, hookURL)

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("write notify script: %w", err)
	}

	return nil
}

// validModelName matches model names safe to interpolate into shell commands.
// Must start with a letter, then letters, digits, hyphens, dots, colons, or slashes.
// e.g. "claude-sonnet-4-5-20250929", "gpt-5.2-codex", "o3", "anthropic/claude-3"
var validModelName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9\-.:\/_]*$`)

func isValidModelName(name string) bool {
	return validModelName.MatchString(name)
}
