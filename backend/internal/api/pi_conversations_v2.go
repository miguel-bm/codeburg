package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/miguel-bm/codeburg/internal/db"
)

type conversationPromptRequest struct {
	Message string                   `json:"message"`
	Images  []piConversationImageRef `json:"images,omitempty"`
}

type conversationModelRequest struct {
	Provider string `json:"provider"`
	ModelID  string `json:"modelId"`
}

type conversationForkMessageRequest struct {
	EntryID            string  `json:"entryId"`
	Title              *string `json:"title,omitempty"`
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
}

type conversationForkMessageResponse struct {
	Conversation db.Conversation         `json:"conversation"`
	SelectedText string                  `json:"selectedText"`
	Snapshot     *piConversationSnapshot `json:"snapshot,omitempty"`
}

func (s *Server) conversationContext(conversationID string) (*db.Conversation, string, error) {
	conversation, err := s.db.GetConversation(conversationID)
	if err != nil {
		return nil, "", err
	}

	project, err := s.db.GetProject(conversation.ProjectID)
	if err != nil {
		return nil, "", err
	}

	workDir := project.Path
	if conversation.CurrentWorkspaceID != nil && strings.TrimSpace(*conversation.CurrentWorkspaceID) != "" {
		workspace, err := s.db.GetWorkspace(strings.TrimSpace(*conversation.CurrentWorkspaceID))
		if err != nil {
			return nil, "", err
		}
		if workspace.ProjectID != conversation.ProjectID {
			return nil, "", errors.New("workspace does not belong to conversation project")
		}
		if workspace.WorktreePath != nil && strings.TrimSpace(*workspace.WorktreePath) != "" {
			workDir = strings.TrimSpace(*workspace.WorktreePath)
		} else {
			workDir = project.Path
		}
	}

	return conversation, workDir, nil
}

func (s *Server) handleGetConversationState(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	snapshot, err := s.pi.GetSnapshot(conversation, workDir)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handlePromptConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req conversationPromptRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" && len(req.Images) == 0 {
		writeError(w, http.StatusBadRequest, "message or image is required")
		return
	}

	snapshot, err := s.pi.Prompt(conversation, workDir, message, req.Images)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, snapshot)
}

func (s *Server) handleListConversationModels(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	models, err := s.pi.AvailableModels(conversation, workDir)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *Server) handleSetConversationModel(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req conversationModelRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	provider := strings.TrimSpace(req.Provider)
	modelID := strings.TrimSpace(req.ModelID)
	if provider == "" || modelID == "" {
		writeError(w, http.StatusBadRequest, "provider and modelId are required")
		return
	}

	snapshot, err := s.pi.SetModel(conversation, workDir, provider, modelID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleListConversationCommands(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	commands, err := s.pi.Commands(conversation, workDir)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"commands": commands})
}

func (s *Server) handleForkConversationFromMessage(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	current, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}

	var req conversationForkMessageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	entryID := strings.TrimSpace(req.EntryID)
	if entryID == "" {
		writeError(w, http.StatusBadRequest, "entryId is required")
		return
	}

	targetWorkspaceID := current.CurrentWorkspaceID
	if req.CurrentWorkspaceID != nil {
		targetWorkspaceID, err = s.resolveConversationWorkspaceID(current.ProjectID, req.CurrentWorkspaceID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	title := strings.TrimSpace(current.Title + " fork")
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		title = strings.TrimSpace(*req.Title)
	}

	forked, err := s.db.CreateConversation(db.CreateConversationInput{
		ProjectID:            current.ProjectID,
		CurrentWorkspaceID:   targetWorkspaceID,
		ParentConversationID: &current.ID,
		Provider:             current.Provider,
		Title:                title,
		Status:               db.ConversationStatusActive,
		PreferredSurface:     current.PreferredSurface,
		Summary:              current.Summary,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fork conversation")
		return
	}

	_, sourceWorkDir, err := s.conversationContext(current.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_, targetWorkDir, err := s.conversationContext(forked.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	selectedText, snapshot, err := s.pi.ForkFromEntry(current, forked, sourceWorkDir, targetWorkDir, entryID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, conversationForkMessageResponse{
		Conversation: *forked,
		SelectedText: selectedText,
		Snapshot:     &snapshot,
	})
}

func (s *Server) handleAbortConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.pi.Abort(conversation, workDir); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type conversationWSConn struct {
	conn           *websocket.Conn
	cancel         func()
	mu             sync.Mutex
	closed         bool
	conversationID string
	server         *Server
}

const (
	conversationPingPeriod = 30 * time.Second
	conversationPongWait   = 90 * time.Second
)

func (s *Server) handleConversationWS(w http.ResponseWriter, r *http.Request) {
	token := authTokenFromWSRequest(r)
	if token == "" || !s.auth.ValidateToken(token) {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	conversationID := r.URL.Query().Get("conversation")
	if conversationID == "" {
		http.Error(w, "conversation parameter required", http.StatusBadRequest)
		return
	}

	conversation, workDir, err := s.conversationContext(conversationID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeDBError(w, err, "conversation")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("conversation websocket upgrade error", "error", err)
		return
	}

	activateRuntime := r.URL.Query().Get("activate") == "1" || strings.EqualFold(r.URL.Query().Get("activate"), "true")
	snapshot, stream, cancel, err := s.pi.Attach(conversation, workDir, activateRuntime)
	if err != nil {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4000, "conversation runtime unavailable"))
		_ = conn.Close()
		return
	}

	ws := &conversationWSConn{
		conn:           conn,
		cancel:         cancel,
		conversationID: conversationID,
		server:         s,
	}

	go ws.writeSnapshotAndStream(snapshot, stream)
	go ws.keepAlive()
	ws.readLoop()
}

func (ws *conversationWSConn) writeSnapshotAndStream(snapshot piConversationSnapshot, stream <-chan piConversationSnapshot) {
	defer ws.close()
	if err := ws.writeJSON(map[string]any{
		"type":     "snapshot",
		"snapshot": snapshot,
	}); err != nil {
		return
	}

	for next := range stream {
		if err := ws.writeJSON(map[string]any{
			"type":     "snapshot",
			"snapshot": next,
		}); err != nil {
			return
		}
	}
}

func (ws *conversationWSConn) readLoop() {
	defer ws.close()
	_ = ws.conn.SetReadDeadline(time.Now().Add(conversationPongWait))
	ws.conn.SetPongHandler(func(string) error {
		return ws.conn.SetReadDeadline(time.Now().Add(conversationPongWait))
	})

	for {
		msgType, payload, err := ws.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Debug("conversation websocket read error", "error", err)
			}
			return
		}
		if msgType != websocket.TextMessage {
			continue
		}

		var message struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		if message.Type == "abort" {
			if conversation, workDir, err := ws.server.conversationContext(ws.conversationID); err == nil {
				_ = ws.server.pi.Abort(conversation, workDir)
			}
		}
	}
}

func (ws *conversationWSConn) keepAlive() {
	ticker := time.NewTicker(conversationPingPeriod)
	defer ticker.Stop()
	defer ws.close()

	for range ticker.C {
		if err := ws.writePing(); err != nil {
			return
		}
	}
}

func (ws *conversationWSConn) writePing() error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return websocket.ErrCloseSent
	}
	_ = ws.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.conn.WriteMessage(websocket.PingMessage, nil)
}

func (ws *conversationWSConn) writeJSON(payload any) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return websocket.ErrCloseSent
	}
	_ = ws.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.conn.WriteJSON(payload)
}

func (ws *conversationWSConn) close() {
	ws.mu.Lock()
	if ws.closed {
		ws.mu.Unlock()
		return
	}
	ws.closed = true
	cancel := ws.cancel
	conn := ws.conn
	ws.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	_ = conn.Close()
}
