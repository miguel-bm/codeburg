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
	Message string `json:"message"`
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
	if message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	snapshot, err := s.pi.Prompt(conversation, workDir, message)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, snapshot)
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

	snapshot, stream, cancel, err := s.pi.Attach(conversation, workDir)
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
