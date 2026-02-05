package api

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/miguel/codeburg/internal/db"
	"github.com/miguel/codeburg/internal/executor"
	"github.com/miguel/codeburg/internal/tmux"
)

// SessionManager manages active agent sessions
type SessionManager struct {
	tmux     *tmux.Manager
	executor *executor.ClaudeExecutor
	sessions map[string]*executor.Session // sessionID -> running session
}

// NewSessionManager creates a new session manager
func NewSessionManager() *SessionManager {
	tmuxMgr := tmux.NewManager()
	return &SessionManager{
		tmux:     tmuxMgr,
		executor: executor.NewClaudeExecutor(tmuxMgr),
		sessions: make(map[string]*executor.Session),
	}
}

// StartSessionRequest contains the request body for starting a session
type StartSessionRequest struct {
	Provider string `json:"provider"` // "claude" (default)
	Prompt   string `json:"prompt"`   // Initial prompt
	Model    string `json:"model"`    // Optional model override
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "taskId")

	// Verify task exists
	_, err := s.db.GetTask(taskID)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get task")
		return
	}

	sessions, err := s.db.ListSessionsByTask(taskID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	if sessions == nil {
		sessions = []*db.AgentSession{}
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "taskId")

	// Verify task exists and get it
	task, err := s.db.GetTask(taskID)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get task")
		return
	}

	// Parse request body
	var req StartSessionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Default to claude
	provider := req.Provider
	if provider == "" {
		provider = "claude"
	}

	// Get project for worktree path
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get project")
		return
	}

	// Determine working directory (worktree if available, else project path)
	workDir := project.Path
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	}

	// Check if executor is available
	if !s.sessions.executor.Available() {
		writeError(w, http.StatusServiceUnavailable, "claude CLI not available")
		return
	}

	// Check if tmux is available
	if !s.sessions.tmux.Available() {
		writeError(w, http.StatusServiceUnavailable, "tmux not available")
		return
	}

	// Create database session first
	dbSession, err := s.db.CreateSession(db.CreateSessionInput{
		TaskID:   taskID,
		Provider: provider,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session record")
		return
	}

	// Start the agent session
	ctx := context.Background()
	execSession, err := s.sessions.executor.Start(ctx, executor.StartOptions{
		WorkDir: workDir,
		Prompt:  req.Prompt,
		Model:   req.Model,
	})
	if err != nil {
		// Clean up database record
		s.db.DeleteSession(dbSession.ID)
		writeError(w, http.StatusInternalServerError, "failed to start agent: "+err.Error())
		return
	}

	// Update database with tmux info
	runningStatus := db.SessionStatusRunning
	_, err = s.db.UpdateSession(dbSession.ID, db.UpdateSessionInput{
		Status:     &runningStatus,
		TmuxWindow: &execSession.TmuxWindow,
		TmuxPane:   &execSession.TmuxPane,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update session")
		return
	}

	// Store running session
	execSession.ID = dbSession.ID
	s.sessions.sessions[dbSession.ID] = execSession

	// Start goroutine to forward events to WebSocket
	go s.forwardSessionEvents(dbSession.ID, taskID, execSession)

	// Return updated session
	updatedSession, _ := s.db.GetSession(dbSession.ID)
	writeJSON(w, http.StatusCreated, updatedSession)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	session, err := s.db.GetSession(id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get session")
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
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get session")
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

	// Get the running session
	execSession, ok := s.sessions.sessions[id]
	if !ok {
		writeError(w, http.StatusBadRequest, "session not running on this server")
		return
	}

	// Send message via tmux
	target := ""
	if session.TmuxWindow != nil {
		target = *session.TmuxWindow
		if session.TmuxPane != nil {
			target = *session.TmuxWindow + "." + *session.TmuxPane
		}
	}
	if target == "" {
		writeError(w, http.StatusBadRequest, "session has no tmux target")
		return
	}
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

	// Return updated session
	_ = execSession // suppress unused warning
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Server) handleStopSession(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	// Get session from database
	session, err := s.db.GetSession(id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get session")
		return
	}

	// Stop the running session if it exists
	if execSession, ok := s.sessions.sessions[id]; ok {
		s.sessions.executor.Stop(execSession)
		delete(s.sessions.sessions, id)
	} else if session.TmuxWindow != nil {
		// Try to kill the tmux window directly
		s.sessions.tmux.DestroyWindow(*session.TmuxWindow)
	}

	// Update status
	completedStatus := db.SessionStatusCompleted
	s.db.UpdateSession(id, db.UpdateSessionInput{
		Status: &completedStatus,
	})

	// Broadcast to WebSocket
	s.wsHub.BroadcastToSession(id, "session_stopped", nil)

	w.WriteHeader(http.StatusNoContent)
}

// forwardSessionEvents forwards agent events to WebSocket subscribers
func (s *Server) forwardSessionEvents(sessionID, taskID string, session *executor.Session) {
	for event := range session.Events {
		// Broadcast event to session subscribers
		s.wsHub.BroadcastToSession(sessionID, "agent_event", event)

		// Also broadcast to task subscribers
		s.wsHub.BroadcastToTask(taskID, "agent_event", map[string]interface{}{
			"sessionId": sessionID,
			"event":     event,
		})

		// Update session status based on events
		if event.Type == executor.EventTypeStatus {
			var status db.SessionStatus
			switch event.Content {
			case string(executor.StatusCompleted):
				status = db.SessionStatusCompleted
			case string(executor.StatusWaitingInput):
				status = db.SessionStatusWaitingInput
			case string(executor.StatusError):
				status = db.SessionStatusError
			default:
				continue
			}
			s.db.UpdateSession(sessionID, db.UpdateSessionInput{
				Status: &status,
			})
		}
	}

	// Session ended
	<-session.Done()

	// Update final status
	completedStatus := db.SessionStatusCompleted
	s.db.UpdateSession(sessionID, db.UpdateSessionInput{
		Status: &completedStatus,
	})

	// Clean up
	delete(s.sessions.sessions, sessionID)

	// Notify subscribers
	s.wsHub.BroadcastToSession(sessionID, "session_ended", map[string]interface{}{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
