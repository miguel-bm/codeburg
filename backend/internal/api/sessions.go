package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
	"github.com/miguel-bm/codeburg/internal/sessionlifecycle"
)

// Guards Claude startup sequence per worktree so hook file write + process start
// cannot race across concurrent session launches.
var claudeSessionStartLocks sync.Map // workDir (clean path) -> *sync.Mutex

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
func (sm *SessionManager) Reconcile(server *Server) {
	sessions, err := server.db.ListActiveSessions()
	if err != nil {
		slog.Error("session reconciliation failed", "error", err)
		return
	}

	var cleaned int
	for _, s := range sessions {
		if _, _, err := server.applySessionTransition(s.ID, s.Status, sessionlifecycle.EventReconcileOrphan, s.TaskID, "reconcile"); err != nil {
			if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
				logInvalidSessionTransition(s.ID, s.Status, sessionlifecycle.EventReconcileOrphan, "reconcile", err)
				continue
			}
			slog.Warn("failed to update session during reconciliation", "session_id", s.ID, "error", err)
		}
		removeHookToken(s.ID)
		removeNotifyScript(s.ID)
		cleaned++
	}

	slog.Info("session reconciliation complete", "restored", 0, "cleaned", cleaned)
}

// StartSessionRequest contains the request body for starting a session
type StartSessionRequest struct {
	Provider        string `json:"provider"`        // "claude", "codex", "terminal" (default: "claude")
	SessionType     string `json:"sessionType"`     // "chat" or "terminal" (default: chat for claude/codex, terminal for terminal provider)
	Prompt          string `json:"prompt"`          // Initial prompt (claude/codex sessions)
	Model           string `json:"model"`           // Optional model override
	ResumeSessionID string `json:"resumeSessionId"` // Codeburg session ID to resume
	AutoApprove     *bool  `json:"autoApprove"`     // Skip permission prompts (nil = true)
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

	if err := validateSessionRequest(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Get project for worktree path
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get project: "+err.Error())
		return
	}

	// Determine working directory (worktree if available, else project path)
	workDir := project.Path
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	}

	session, err := s.startSessionInternal(startSessionParams{
		ProjectID: task.ProjectID,
		TaskID:    task.ID,
		WorkDir:   workDir,
	}, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) handleListProjectSessions(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	// Verify project exists
	_, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	sessions, err := s.db.ListSessionsByProject(projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleStartProjectSession(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req StartSessionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := validateSessionRequest(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	session, err := s.startSessionInternal(startSessionParams{
		ProjectID: project.ID,
		WorkDir:   project.Path,
	}, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, session)
}

func validateSessionRequest(req *StartSessionRequest) error {
	if req.Provider == "" {
		req.Provider = "claude"
	}
	if req.Provider != "claude" && req.Provider != "codex" && req.Provider != "terminal" {
		return fmt.Errorf("invalid provider: %s", req.Provider)
	}
	if req.Model != "" && !isValidModelName(req.Model) {
		return fmt.Errorf("invalid model name: must start with a letter and contain only letters, digits, hyphens, dots, and colons")
	}
	if req.SessionType != "" && req.SessionType != "terminal" && req.SessionType != "chat" {
		return fmt.Errorf("invalid session type: %s", req.SessionType)
	}
	if req.Provider == "terminal" && req.SessionType == "chat" {
		return fmt.Errorf("terminal provider only supports terminal session type")
	}
	return nil
}

func resolveAutoApprove(req StartSessionRequest) bool {
	if req.AutoApprove != nil {
		return *req.AutoApprove
	}
	return true
}

func resolveSessionType(req StartSessionRequest) string {
	if req.SessionType != "" {
		return req.SessionType
	}
	if req.Provider == "terminal" {
		return "terminal"
	}
	return "chat"
}

// startSessionParams encapsulates the resolved parameters for starting a session.
type startSessionParams struct {
	ProjectID string
	TaskID    string // empty for project-level sessions
	WorkDir   string
}

// startSessionInternal creates and starts a session.
// It handles hook setup and process launch in the PTY runtime.
func (s *Server) startSessionInternal(params startSessionParams, req StartSessionRequest) (*db.AgentSession, error) {
	provider := req.Provider
	sessionType := resolveSessionType(req)
	workDir := params.WorkDir
	taskID := params.TaskID

	// Create database session.
	dbSession, err := s.db.CreateSession(db.CreateSessionInput{
		TaskID:      params.TaskID,
		ProjectID:   params.ProjectID,
		Provider:    provider,
		SessionType: sessionType,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create session record: %w", err)
	}

	var resumeSource *db.AgentSession
	if req.ResumeSessionID != "" {
		oldSession, resumeErr := s.db.GetSession(req.ResumeSessionID)
		if resumeErr == nil {
			resumeSource = oldSession
		}
		if resumeSource != nil &&
			resumeSource.Provider == provider &&
			resumeSource.ProviderSessionID != nil &&
			*resumeSource.ProviderSessionID != "" {
			if _, updateErr := s.db.UpdateSession(dbSession.ID, db.UpdateSessionInput{
				ProviderSessionID: resumeSource.ProviderSessionID,
			}); updateErr != nil {
				slog.Warn("failed to copy provider session id for resume", "session_id", dbSession.ID, "error", updateErr)
			} else {
				dbSession.ProviderSessionID = resumeSource.ProviderSessionID
			}
		}
	}

	if sessionType == "chat" && resumeSource != nil {
		if resumeSource.Provider != provider {
			slog.Warn("resume source provider mismatch; skipping chat history copy",
				"session_id", dbSession.ID,
				"resume_session_id", resumeSource.ID,
				"resume_provider", resumeSource.Provider,
				"provider", provider,
			)
		} else if copied, copyErr := s.db.CopyAgentMessages(resumeSource.ID, dbSession.ID); copyErr != nil {
			slog.Warn("failed to copy chat history for resume",
				"session_id", dbSession.ID,
				"resume_session_id", resumeSource.ID,
				"error", copyErr,
			)
		} else {
			slog.Info("copied chat history for resume",
				"session_id", dbSession.ID,
				"resume_session_id", resumeSource.ID,
				"message_count", copied,
			)
		}
	}

	autoApprove := resolveAutoApprove(req)

	if sessionType == "chat" {
		if err := s.chat.RegisterSession(dbSession.ID, provider, req.Model, autoApprove); err != nil {
			_ = s.db.DeleteSession(dbSession.ID)
			return nil, fmt.Errorf("failed to initialize chat session: %w", err)
		}

		runningStatus, changed, err := s.applySessionTransition(dbSession.ID, dbSession.Status, sessionlifecycle.EventSessionStarted, taskID, "session_start")
		if err != nil {
			s.chat.RemoveSession(dbSession.ID)
			_ = s.db.DeleteSession(dbSession.ID)
			return nil, fmt.Errorf("failed to update chat session status: %w", err)
		}
		if changed {
			s.broadcastSessionStatus(taskID, dbSession.ID, runningStatus)
		}

		initialPrompt := strings.TrimSpace(req.Prompt)
		if initialPrompt != "" {
			if err := s.startChatTurn(dbSession.ID, initialPrompt, "session_start"); err != nil {
				s.chat.RemoveSession(dbSession.ID)
				_ = s.db.DeleteSession(dbSession.ID)
				return nil, err
			}
		} else {
			waitingStatus, waitingChanged, waitErr := s.applySessionTransition(dbSession.ID, runningStatus, sessionlifecycle.EventNotificationWaiting, taskID, "session_start")
			if waitErr != nil {
				slog.Warn("failed to set chat session waiting_input", "session_id", dbSession.ID, "error", waitErr)
			} else if waitingChanged {
				s.broadcastSessionStatus(taskID, dbSession.ID, waitingStatus)
			}
		}

		updatedSession, err := s.db.GetSession(dbSession.ID)
		if err != nil {
			slog.Warn("failed to reload chat session after start", "session_id", dbSession.ID, "error", err)
			return dbSession, nil
		}
		return updatedSession, nil
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
	case "codex":
		// Write codex notify script (outside worktree to avoid git noise)
		notifyScript, err = writeCodexNotifyScript(dbSession.ID, tokenPath, apiURL)
		if err != nil {
			slog.Warn("failed to write codex notify script", "session_id", dbSession.ID, "error", err)
		}
	}

	var resumeProviderSessionID string
	if req.Provider == "claude" && resumeSource != nil {
		if resumeSource.ProviderSessionID != nil && *resumeSource.ProviderSessionID != "" {
			resumeProviderSessionID = *resumeSource.ProviderSessionID
			slog.Info("resuming claude session", "session_id", dbSession.ID, "provider_session_id", resumeProviderSessionID)
		} else {
			slog.Info("resuming claude session with --continue", "session_id", dbSession.ID)
		}
	}

	command, args := buildSessionCommand(req, notifyScript, resumeProviderSessionID, autoApprove)
	originalCommand := command
	command, args = withShellFallback(command, args)
	if originalCommand != command {
		slog.Warn("provider command not found in service PATH, using login-shell fallback", "session_id", dbSession.ID, "provider", req.Provider, "command", originalCommand)
	}

	startRuntime := func() error {
		return s.sessions.runtime.Start(dbSession.ID, ptyruntime.StartOptions{
			WorkDir: workDir,
			Command: command,
			Args:    args,
			OnOutput: func(sessionID string, chunk []byte) {
				if taskID != "" {
					s.portSuggest.IngestOutput(taskID, sessionID, chunk)
				}
			},
			OnExit: func(result ptyruntime.ExitResult) {
				s.handleRuntimeExit(taskID, result)
			},
		})
	}

	var startErr error
	if provider == "claude" {
		startErr = withClaudeSessionStartLock(workDir, func() error {
			// Write Claude Code hooks config immediately before start.
			// Claude snapshots hooks at startup, so this must be serialized per worktree.
			if err := writeClaudeHooks(workDir, dbSession.ID, tokenPath, apiURL); err != nil {
				slog.Warn("failed to write Claude hooks", "session_id", dbSession.ID, "error", err)
			}
			return startRuntime()
		})
	} else {
		startErr = startRuntime()
	}
	if startErr != nil {
		removeHookToken(dbSession.ID)
		removeNotifyScript(dbSession.ID)
		if err := s.db.DeleteSession(dbSession.ID); err != nil {
			slog.Warn("failed to delete session after runtime start failure", "session_id", dbSession.ID, "error", err)
		}
		return nil, fmt.Errorf("failed to start runtime process: %w", startErr)
	}

	// Transition idle -> running after successful runtime start.
	runningStatus, changed, err := s.applySessionTransition(dbSession.ID, dbSession.Status, sessionlifecycle.EventSessionStarted, taskID, "session_start")
	if err != nil {
		if stopErr := s.sessions.runtime.Stop(dbSession.ID); stopErr != nil {
			slog.Warn("failed to stop session runtime after status update failure", "session_id", dbSession.ID, "error", stopErr)
		}
		removeHookToken(dbSession.ID)
		removeNotifyScript(dbSession.ID)
		if delErr := s.db.DeleteSession(dbSession.ID); delErr != nil {
			slog.Warn("failed to delete session after status update failure", "session_id", dbSession.ID, "error", delErr)
		}
		return nil, fmt.Errorf("failed to update session status: %w", err)
	}
	if !changed {
		if stopErr := s.sessions.runtime.Stop(dbSession.ID); stopErr != nil {
			slog.Warn("failed to stop session runtime after no-op status transition", "session_id", dbSession.ID, "error", stopErr)
		}
		removeHookToken(dbSession.ID)
		removeNotifyScript(dbSession.ID)
		if delErr := s.db.DeleteSession(dbSession.ID); delErr != nil {
			slog.Warn("failed to delete session after no-op status transition", "session_id", dbSession.ID, "error", delErr)
		}
		return nil, fmt.Errorf("failed to update session status: no status change from %s", dbSession.Status)
	}

	// Store in-memory session
	execSession := &Session{
		ID:       dbSession.ID,
		TaskID:   taskID,
		Provider: provider,
		Status:   runningStatus,
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

	// Broadcast status transition so clients reflect session state immediately.
	s.broadcastSessionStatus(taskID, dbSession.ID, runningStatus)

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

	if session.SessionType == "chat" {
		if err := s.startChatTurn(session.ID, strings.TrimSpace(req.Content), "send_message"); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrChatTurnBusy) {
				status = http.StatusConflict
			}
			writeError(w, status, "failed to send message: "+err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
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

	// Transition waiting_input -> running when user sends a message.
	runningStatus, changed, err := s.applySessionTransition(id, session.Status, sessionlifecycle.EventUserMessage, session.TaskID, "send_message")
	if err != nil {
		if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(id, session.Status, sessionlifecycle.EventUserMessage, "send_message", err)
		} else {
			slog.Warn("failed to update session status after send message", "session_id", id, "error", err)
		}
	} else if changed {
		execSession.SetStatus(runningStatus)
		s.broadcastSessionStatus(session.TaskID, id, runningStatus)
	}

	// Broadcast to WebSocket subscribers
	s.wsHub.BroadcastToSession(id, "message_sent", map[string]string{
		"content": req.Content,
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Server) resolveSessionWorkDir(session *db.AgentSession) (string, error) {
	if session.TaskID != "" {
		task, err := s.db.GetTask(session.TaskID)
		if err != nil {
			return "", fmt.Errorf("get task: %w", err)
		}
		project, err := s.db.GetProject(task.ProjectID)
		if err != nil {
			return "", fmt.Errorf("get project: %w", err)
		}
		workDir := project.Path
		if task.WorktreePath != nil && *task.WorktreePath != "" {
			workDir = *task.WorktreePath
		}
		return workDir, nil
	}

	project, err := s.db.GetProject(session.ProjectID)
	if err != nil {
		return "", fmt.Errorf("get project: %w", err)
	}
	return project.Path, nil
}

func (s *Server) startChatTurn(sessionID, content, source string) error {
	content = strings.TrimSpace(content)
	if content == "" {
		return fmt.Errorf("content is required")
	}

	session, err := s.db.GetSession(sessionID)
	if err != nil {
		return err
	}
	if session.SessionType != "chat" {
		return fmt.Errorf("session is not a chat session")
	}

	workDir, err := s.resolveSessionWorkDir(session)
	if err != nil {
		return err
	}

	runningStatus, changed, err := s.applySessionTransition(sessionID, session.Status, sessionlifecycle.EventUserMessage, session.TaskID, source)
	if err != nil {
		if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(sessionID, session.Status, sessionlifecycle.EventUserMessage, source, err)
		} else {
			return err
		}
	} else if changed {
		s.broadcastSessionStatus(session.TaskID, sessionID, runningStatus)
	}

	resultCh, err := s.chat.StartTurn(StartChatTurnInput{
		SessionID: sessionID,
		Provider:  session.Provider,
		WorkDir:   workDir,
		Prompt:    content,
		Model:     "",
	})
	if err != nil {
		return err
	}

	go s.awaitChatTurnResult(sessionID, source, resultCh)

	s.wsHub.BroadcastToSession(sessionID, "message_sent", map[string]string{
		"content": content,
	})
	return nil
}

func (s *Server) awaitChatTurnResult(sessionID, source string, resultCh <-chan ChatTurnResult) {
	result, ok := <-resultCh
	if !ok {
		return
	}

	session, err := s.db.GetSession(sessionID)
	if err != nil {
		return
	}

	if result.Interrupted {
		waitingStatus, changed, waitErr := s.applySessionTransition(sessionID, session.Status, sessionlifecycle.EventNotificationWaiting, session.TaskID, source+"_interrupt")
		if waitErr != nil {
			if errors.Is(waitErr, sessionlifecycle.ErrInvalidTransition) {
				logInvalidSessionTransition(sessionID, session.Status, sessionlifecycle.EventNotificationWaiting, source+"_interrupt", waitErr)
			} else {
				slog.Warn("failed to update chat session status on interrupt", "session_id", sessionID, "error", waitErr)
			}
			return
		}
		if changed {
			s.broadcastSessionStatus(session.TaskID, sessionID, waitingStatus)
		}
		return
	}

	if result.Err != nil {
		errorStatus, changed, applyErr := s.applySessionTransition(sessionID, session.Status, sessionlifecycle.EventRuntimeExitFailure, session.TaskID, source+"_error")
		if applyErr != nil {
			if errors.Is(applyErr, sessionlifecycle.ErrInvalidTransition) {
				logInvalidSessionTransition(sessionID, session.Status, sessionlifecycle.EventRuntimeExitFailure, source+"_error", applyErr)
			} else {
				slog.Warn("failed to update chat session status on error", "session_id", sessionID, "error", applyErr)
			}
			return
		}
		if changed {
			s.broadcastSessionStatus(session.TaskID, sessionID, errorStatus)
		}
		return
	}

	waitingStatus, changed, waitErr := s.applySessionTransition(sessionID, session.Status, sessionlifecycle.EventAgentTurnComplete, session.TaskID, source+"_complete")
	if waitErr != nil {
		if errors.Is(waitErr, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(sessionID, session.Status, sessionlifecycle.EventAgentTurnComplete, source+"_complete", waitErr)
		} else {
			slog.Warn("failed to update chat session status on completion", "session_id", sessionID, "error", waitErr)
		}
		return
	}
	if changed {
		s.broadcastSessionStatus(session.TaskID, sessionID, waitingStatus)
	}
}

func (s *Server) handleStopSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	// Get session from database
	dbSession, err := s.db.GetSession(id)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}

	// Transition session to completed on explicit stop.
	completedStatus, changed, err := s.applySessionTransition(id, dbSession.Status, sessionlifecycle.EventStopRequested, dbSession.TaskID, "stop_session")
	if err != nil {
		if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(id, dbSession.Status, sessionlifecycle.EventStopRequested, "stop_session", err)
		} else {
			slog.Warn("failed to update session status on stop", "session_id", id, "error", err)
		}
		completedStatus = db.SessionStatusCompleted
	}

	if dbSession.SessionType == "chat" {
		_ = s.chat.Interrupt(id)
	} else {
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
	}

	// Clean up token and script files
	removeHookToken(id)
	removeNotifyScript(id)
	s.portSuggest.ForgetSession(id)

	// Broadcast to WebSocket
	if changed {
		s.broadcastSessionStatus(dbSession.TaskID, id, completedStatus)
	}
	s.wsHub.BroadcastToSession(id, "session_stopped", nil)

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
	if _, _, err := s.applySessionTransition(id, dbSession.Status, sessionlifecycle.EventDeleteRequested, dbSession.TaskID, "delete_session"); err != nil {
		if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(id, dbSession.Status, sessionlifecycle.EventDeleteRequested, "delete_session", err)
		} else {
			slog.Warn("failed to pre-mark session completed before delete", "session_id", id, "error", err)
		}
	}

	if dbSession.SessionType == "chat" {
		_ = s.chat.Interrupt(id)
		s.chat.RemoveSession(id)
	} else {
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
	if dbSession.TaskID != "" {
		s.wsHub.BroadcastToTask(dbSession.TaskID, "session_deleted", map[string]string{
			"sessionId": id,
		})
	}
	s.wsHub.BroadcastGlobal("sidebar_update", map[string]string{
		"taskId":    dbSession.TaskID,
		"sessionId": id,
	})

	w.WriteHeader(http.StatusNoContent)
}

// setSessionRunning updates a session's status to running if it's currently waiting_input
func (sm *SessionManager) setSessionRunning(sessionID string, server *Server) {
	session := sm.getOrRestore(sessionID, server.db)
	if session == nil {
		return
	}

	for {
		current := session.GetStatus()
		tr, err := sessionlifecycle.Apply(current, sessionlifecycle.EventUserActivity)
		if err != nil {
			logInvalidSessionTransition(sessionID, current, sessionlifecycle.EventUserActivity, "terminal_input", err)
			return
		}
		if !tr.Changed {
			return
		}
		if !session.CompareAndSetStatus(current, tr.To) {
			continue
		}

		taskID, newStatus, changed, err := server.applySessionTransitionByID(sessionID, sessionlifecycle.EventUserActivity, "terminal_input")
		if err != nil {
			if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
				logInvalidSessionTransition(sessionID, current, sessionlifecycle.EventUserActivity, "terminal_input", err)
			} else {
				slog.Warn("failed to persist session running status", "session_id", sessionID, "error", err)
			}
			return
		}
		session.SetStatus(newStatus)
		if changed {
			server.broadcastSessionStatus(taskID, sessionID, newStatus)
		}
		return
	}
}

// StartCleanupLoop runs a background goroutine that detects zombie sessions
// (sessions in-memory whose runtime process has disappeared) and marks them completed.
func (sm *SessionManager) StartCleanupLoop(ctx context.Context, server *Server) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		checked, cleaned := sm.cleanupZombieSessions(server)
		slog.Debug("cleanup tick", "checked", checked, "cleaned", cleaned)
	}
}

func (sm *SessionManager) cleanupZombieSessions(server *Server) (checked int, cleaned int) {
	// Copy session IDs under read lock.
	sm.mu.RLock()
	ids := make([]string, 0, len(sm.sessions))
	for id := range sm.sessions {
		ids = append(ids, id)
	}
	sm.mu.RUnlock()

	for _, id := range ids {
		checked++

		sm.mu.RLock()
		session, ok := sm.sessions[id]
		sm.mu.RUnlock()
		if !ok || sm.runtime.Exists(id) {
			continue
		}

		// Process gone — clean up.
		sm.mu.Lock()
		delete(sm.sessions, id)
		sm.mu.Unlock()

		taskID, status, changed, err := server.applySessionTransitionByID(id, sessionlifecycle.EventZombieRuntimeMissing, "cleanup")
		if err != nil {
			if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
				logInvalidSessionTransition(id, session.GetStatus(), sessionlifecycle.EventZombieRuntimeMissing, "cleanup", err)
			} else {
				slog.Warn("failed to persist cleaned zombie session status", "session_id", id, "error", err)
			}
		}

		removeHookToken(id)
		removeNotifyScript(id)

		if changed {
			server.broadcastSessionStatus(taskID, id, status)
		}
		server.wsHub.BroadcastToSession(id, "session_stopped", nil)

		slog.Info("zombie session cleaned up", "session_id", id, "provider", session.Provider)
		cleaned++
	}

	return checked, cleaned
}

func (s *Server) handleRuntimeExit(taskID string, result ptyruntime.ExitResult) {
	event := sessionlifecycle.EventRuntimeExitSuccess
	fallbackStatus := db.SessionStatusCompleted
	if result.ExitCode != 0 {
		event = sessionlifecycle.EventRuntimeExitFailure
		fallbackStatus = db.SessionStatusError
	}

	resolvedTaskID, status, changed, err := s.applySessionTransitionWithFallback(result.SessionID, fallbackStatus, event, "runtime_exit")
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			changed = false
		} else if errors.Is(err, sessionlifecycle.ErrInvalidTransition) {
			logInvalidSessionTransition(result.SessionID, fallbackStatus, event, "runtime_exit", err)
			status = fallbackStatus
			changed = false
		} else {
			slog.Warn("failed to update session status on runtime exit", "session_id", result.SessionID, "error", err)
			changed = false
		}
	}

	s.sessions.mu.Lock()
	delete(s.sessions.sessions, result.SessionID)
	s.sessions.mu.Unlock()

	removeHookToken(result.SessionID)
	removeNotifyScript(result.SessionID)
	s.portSuggest.ForgetSession(result.SessionID)

	if resolvedTaskID != "" {
		taskID = resolvedTaskID
	}
	if changed {
		s.broadcastSessionStatus(taskID, result.SessionID, status)
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

func withClaudeSessionStartLock(workDir string, fn func() error) error {
	key := filepath.Clean(workDir)
	lock, _ := claudeSessionStartLocks.LoadOrStore(key, &sync.Mutex{})
	mu := lock.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	return fn()
}

// writeClaudeHooks writes .claude/settings.local.json with hooks that call back to Codeburg.
// Existing user hooks on other events (and other matcher entries on the same events) are preserved.
func writeClaudeHooks(workDir, sessionID, tokenPath, apiURL string) error {
	claudeDir := filepath.Join(workDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		return fmt.Errorf("create .claude dir: %w", err)
	}

	settingsPath := filepath.Join(claudeDir, "settings.local.json")

	settings := make(map[string]interface{})
	if data, err := os.ReadFile(settingsPath); err == nil {
		if len(bytes.TrimSpace(data)) > 0 {
			if err := json.Unmarshal(data, &settings); err != nil {
				return fmt.Errorf("parse existing settings.local.json: %w", err)
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read settings.local.json: %w", err)
	}

	hookURL := fmt.Sprintf("%s/api/sessions/%s/hook", apiURL, sessionID)
	curlCmd := fmt.Sprintf(
		"curl -sS --connect-timeout 1 --max-time 4 --retry 1 -X POST -H \"Authorization: Bearer $(cat '%s')\" -H 'Content-Type: application/json' -d @- '%s' >/dev/null 2>&1 || true",
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

	return writeFileAtomic(settingsPath, data, 0644)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
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
curl -sS --connect-timeout 1 --max-time 4 --retry 1 -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw "$1" \
  '%s' >/dev/null 2>&1 || true
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
