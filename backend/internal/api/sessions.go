package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
)

// SessionManager manages active agent sessions
type SessionManager struct {
	runtime  *ptyruntime.Manager
	sessions map[string]*Session // sessionID -> running session
	mu       sync.RWMutex
}

// NewSessionManager creates a new session manager
func NewSessionManager() *SessionManager {
	return &SessionManager{
		runtime:  ptyruntime.NewManager(),
		sessions: make(map[string]*Session),
	}
}

// getOrRestore looks up a session in memory, falling back to DB if runtime is alive.
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

	if !sm.runtime.Exists(sessionID) {
		return nil
	}

	// Restore to in-memory map
	restored := &Session{
		ID:       dbSession.ID,
		TaskID:   dbSession.TaskID,
		Provider: dbSession.Provider,
		Status:   dbSession.Status,
	}
	sm.mu.Lock()
	sm.sessions[dbSession.ID] = restored
	sm.mu.Unlock()

	slog.Info("session restored from DB", "session_id", sessionID, "provider", dbSession.Provider)
	return restored
}

// Reconcile restores in-memory session state from the database on startup.
// PTY runtimes are in-process and don't survive restart, so active sessions are marked completed.
func (sm *SessionManager) Reconcile(database *db.DB) {
	sessions, err := database.ListActiveSessions()
	if err != nil {
		slog.Error("session reconciliation failed", "error", err)
		return
	}

	var cleaned int
	for _, s := range sessions {
		completedStatus := db.SessionStatusCompleted
		_, _ = database.UpdateSession(s.ID, db.UpdateSessionInput{Status: &completedStatus})
		removeHookToken(s.ID)
		removeNotifyScript(s.ID)
		cleaned++
	}

	slog.Info("session reconciliation complete", "restored", 0, "cleaned", cleaned)
}

// StartSessionRequest contains the request body for starting a session
type StartSessionRequest struct {
	Provider        string `json:"provider"`        // "claude", "codex", "terminal" (default: "claude")
	Prompt          string `json:"prompt"`          // Initial prompt (claude/codex sessions)
	Model           string `json:"model"`           // Optional model override
	ResumeSessionID string `json:"resumeSessionId"` // Codeburg session ID to resume (claude only)
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
// It handles hook setup and process launch in the PTY runtime.
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

	// Create database session (terminal transport)
	dbSession, err := s.db.CreateSession(db.CreateSessionInput{
		TaskID:      task.ID,
		Provider:    provider,
		SessionType: "terminal",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create session record")
	}

	// Generate a scoped JWT token for hook callbacks
	hookToken, err := s.auth.GenerateHookToken(dbSession.ID)
	if err != nil {
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

	var notifyScript string
	switch provider {
	case "claude":
		// Write Claude Code hooks config to workDir
		if err := writeClaudeHooks(workDir, dbSession.ID, tokenPath, apiURL); err != nil {
			slog.Warn("failed to write Claude hooks", "session_id", dbSession.ID, "error", err)
		}

	case "codex":
		// Write codex notify script (outside worktree to avoid git noise)
		notifyScript, err = writeCodexNotifyScript(dbSession.ID, tokenPath, apiURL)
		if err != nil {
			slog.Warn("failed to write codex notify script", "session_id", dbSession.ID, "error", err)
		}
	}

	var resumeProviderSessionID string
	if req.Provider == "claude" && req.ResumeSessionID != "" {
		oldSession, err := s.db.GetSession(req.ResumeSessionID)
		if err == nil && oldSession.ProviderSessionID != nil && *oldSession.ProviderSessionID != "" {
			resumeProviderSessionID = *oldSession.ProviderSessionID
			slog.Info("resuming claude session", "session_id", dbSession.ID, "provider_session_id", resumeProviderSessionID)
		} else {
			slog.Info("resuming claude session with --continue", "session_id", dbSession.ID)
		}
	}

	command, args := buildSessionCommand(req, notifyScript, resumeProviderSessionID)
	originalCommand := command
	command, args = withShellFallback(command, args)
	if originalCommand != command {
		slog.Warn("provider command not found in service PATH, using login-shell fallback", "session_id", dbSession.ID, "provider", req.Provider, "command", originalCommand)
	}
	startErr := s.sessions.runtime.Start(dbSession.ID, ptyruntime.StartOptions{
		WorkDir: workDir,
		Command: command,
		Args:    args,
		OnOutput: func(sessionID string, chunk []byte) {
			s.portSuggest.IngestOutput(task.ID, sessionID, chunk)
		},
		OnExit: func(result ptyruntime.ExitResult) {
			s.handleRuntimeExit(task.ID, result)
		},
	})
	if startErr != nil {
		removeHookToken(dbSession.ID)
		removeNotifyScript(dbSession.ID)
		s.db.DeleteSession(dbSession.ID)
		return nil, fmt.Errorf("failed to start runtime process: %w", startErr)
	}

	// Update status to running
	runningStatus := db.SessionStatusRunning
	if _, err := s.db.UpdateSession(dbSession.ID, db.UpdateSessionInput{
		Status: &runningStatus,
	}); err != nil {
		_ = s.sessions.runtime.Stop(dbSession.ID)
		removeHookToken(dbSession.ID)
		removeNotifyScript(dbSession.ID)
		_ = s.db.DeleteSession(dbSession.ID)
		return nil, fmt.Errorf("failed to update session status: %w", err)
	}

	// Store in-memory session
	execSession := &Session{
		ID:       dbSession.ID,
		TaskID:   task.ID,
		Provider: provider,
		Status:   db.SessionStatusRunning,
		WorkDir:  workDir,
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

func withShellFallback(command string, args []string) (string, []string) {
	if command == "" {
		return command, args
	}
	if _, err := exec.LookPath(command); err == nil {
		return command, args
	}

	// Use login shell so user-level PATH customizations are applied.
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, shellQuote(command))
	for _, arg := range args {
		parts = append(parts, shellQuote(arg))
	}
	return shell, []string{"-lc", strings.Join(parts, " ")}
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
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

	// Deliver message to runtime process
	if err := s.sessions.runtime.Write(id, []byte(req.Content+"\n")); err != nil {
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

	// Update status
	completedStatus := db.SessionStatusCompleted
	s.db.UpdateSession(id, db.UpdateSessionInput{
		Status: &completedStatus,
	})

	// Try to get from in-memory map (with DB fallback)
	execSession := s.sessions.getOrRestore(id, s.db)
	if execSession != nil {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, id)
		s.sessions.mu.Unlock()
	}
	if err := s.sessions.runtime.Stop(id); err != nil && !errors.Is(err, ptyruntime.ErrSessionNotFound) {
		slog.Debug("runtime stop failed", "session_id", id, "error", err)
	}

	// Clean up token and script files
	removeHookToken(id)
	removeNotifyScript(id)
	s.portSuggest.ForgetSession(id)

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

	// Mark completed before stopping to avoid race with exit callback status.
	completedStatus := db.SessionStatusCompleted
	_, _ = s.db.UpdateSession(id, db.UpdateSessionInput{Status: &completedStatus})

	// Stop if still active
	execSession := s.sessions.getOrRestore(id, s.db)
	if execSession != nil {
		s.sessions.mu.Lock()
		delete(s.sessions.sessions, id)
		s.sessions.mu.Unlock()
	}
	if err := s.sessions.runtime.Stop(id); err != nil && !errors.Is(err, ptyruntime.ErrSessionNotFound) {
		slog.Debug("runtime stop failed", "session_id", id, "error", err)
	}

	// Clean up token and script files
	removeHookToken(id)
	removeNotifyScript(id)
	s.portSuggest.ForgetSession(id)

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
// (sessions in-memory whose runtime process has disappeared) and marks them completed.
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

			if !sm.runtime.Exists(id) {
				// Process gone — clean up
				sm.mu.Lock()
				delete(sm.sessions, id)
				sm.mu.Unlock()

				completedStatus := db.SessionStatusCompleted
				database.UpdateSession(id, db.UpdateSessionInput{Status: &completedStatus})
				removeHookToken(id)
				removeNotifyScript(id)

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

func buildSessionCommand(req StartSessionRequest, notifyScript, resumeProviderSessionID string) (string, []string) {
	switch req.Provider {
	case "claude":
		args := []string{"--dangerously-skip-permissions"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		if req.ResumeSessionID != "" {
			if resumeProviderSessionID != "" {
				args = append(args, "--resume", resumeProviderSessionID)
			} else {
				args = append(args, "--continue")
			}
		}
		if req.Prompt != "" {
			args = append(args, req.Prompt)
		}
		return "claude", args

	case "codex":
		args := []string{"--full-auto"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		if notifyScript != "" {
			args = append(args, "-c", fmt.Sprintf(`notify=["%s"]`, notifyScript))
		}
		if req.Prompt != "" {
			args = append(args, req.Prompt)
		}
		return "codex", args

	default: // terminal
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		if req.Prompt != "" {
			return shell, []string{"-lc", req.Prompt}
		}
		return shell, []string{"-i"}
	}
}

func (s *Server) handleRuntimeExit(taskID string, result ptyruntime.ExitResult) {
	status := db.SessionStatusCompleted
	if result.ExitCode != 0 {
		status = db.SessionStatusError
	}
	existing, err := s.db.GetSession(result.SessionID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			s.sessions.mu.Lock()
			delete(s.sessions.sessions, result.SessionID)
			s.sessions.mu.Unlock()
			return
		}
		slog.Warn("failed to load session on runtime exit", "session_id", result.SessionID, "error", err)
	}
	if existing != nil && existing.Status == db.SessionStatusCompleted {
		status = db.SessionStatusCompleted
	}

	if _, err := s.db.UpdateSession(result.SessionID, db.UpdateSessionInput{Status: &status}); err != nil {
		slog.Warn("failed to update session status on runtime exit", "session_id", result.SessionID, "error", err)
	}

	s.sessions.mu.Lock()
	delete(s.sessions.sessions, result.SessionID)
	s.sessions.mu.Unlock()

	removeHookToken(result.SessionID)
	removeNotifyScript(result.SessionID)
	s.portSuggest.ForgetSession(result.SessionID)

	s.wsHub.BroadcastToSession(result.SessionID, "status_changed", map[string]string{
		"status": string(status),
	})
	s.wsHub.BroadcastToTask(taskID, "session_status_changed", map[string]string{
		"sessionId": result.SessionID,
		"status":    string(status),
	})
	s.wsHub.BroadcastGlobal("sidebar_update", map[string]string{
		"taskId":    taskID,
		"sessionId": result.SessionID,
		"status":    string(status),
	})
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

// writeCodexNotifyScript writes a notify script to ~/.codeburg/scripts/{sessionID}-notify.sh.
// Codex invokes the notify script with the event JSON as the last positional argument ($1).
// Returns the absolute path to the script.
func writeCodexNotifyScript(sessionID, tokenPath, apiURL string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	dir := filepath.Join(home, ".codeburg", "scripts")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create scripts dir: %w", err)
	}

	hookURL := fmt.Sprintf("%s/api/sessions/%s/hook", apiURL, sessionID)
	scriptPath := filepath.Join(dir, sessionID+"-notify.sh")

	script := fmt.Sprintf(`#!/bin/bash
TOKEN=$(cat '%s')
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw "$1" \
  '%s'
`, tokenPath, hookURL)

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return "", fmt.Errorf("write notify script: %w", err)
	}

	return scriptPath, nil
}

// removeNotifyScript deletes the notify script for a session.
func removeNotifyScript(sessionID string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	os.Remove(filepath.Join(home, ".codeburg", "scripts", sessionID+"-notify.sh"))
}

// validModelName matches model names safe to interpolate into shell commands.
// Must start with a letter, then letters, digits, hyphens, dots, colons, or slashes.
// e.g. "claude-sonnet-4-5-20250929", "gpt-5.2-codex", "o3", "anthropic/claude-3"
var validModelName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9\-.:\/_]*$`)

func isValidModelName(name string) bool {
	return validModelName.MatchString(name)
}
