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
)

type chatWSConn struct {
	conn      *websocket.Conn
	cancel    func()
	mu        sync.Mutex
	closed    bool
	sessionID string
	server    *Server
}

type chatClientMessage struct {
	Type    string `json:"type"`
	Content string `json:"content,omitempty"`
}

const (
	chatPingPeriod = 30 * time.Second
	chatPongWait   = 90 * time.Second
)

func (s *Server) handleChatWS(w http.ResponseWriter, r *http.Request) {
	token := authTokenFromWSRequest(r)
	if token == "" || !s.auth.ValidateToken(token) {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		http.Error(w, "session parameter required", http.StatusBadRequest)
		return
	}

	session, err := s.db.GetSession(sessionID)
	if err != nil {
		writeDBError(w, err, "session")
		return
	}
	if session.SessionType != "chat" {
		http.Error(w, "session is not chat-capable", http.StatusBadRequest)
		return
	}

	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("chat websocket upgrade error", "error", err)
		return
	}

	snapshot, stream, cancel, err := s.chat.Attach(sessionID)
	if err != nil {
		code := websocket.CloseInternalServerErr
		if errors.Is(err, ErrChatSessionNotFound) {
			code = 4000
		}
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, "chat session unavailable"))
		_ = conn.Close()
		return
	}

	ws := &chatWSConn{
		conn:      conn,
		cancel:    cancel,
		sessionID: sessionID,
		server:    s,
	}

	go ws.writeSnapshotAndStream(snapshot, stream)
	go ws.keepAlive()
	ws.readLoop()
}

func (ws *chatWSConn) writeSnapshotAndStream(snapshot []ChatMessage, stream <-chan ChatMessage) {
	defer ws.close()

	if err := ws.writeJSON(map[string]any{
		"type":     "snapshot",
		"messages": snapshot,
	}); err != nil {
		return
	}

	for msg := range stream {
		if err := ws.writeJSON(map[string]any{
			"type":    "message",
			"message": msg,
		}); err != nil {
			return
		}
	}
}

func (ws *chatWSConn) readLoop() {
	defer ws.close()
	_ = ws.conn.SetReadDeadline(time.Now().Add(chatPongWait))
	ws.conn.SetPongHandler(func(string) error {
		return ws.conn.SetReadDeadline(time.Now().Add(chatPongWait))
	})

	for {
		msgType, payload, err := ws.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Debug("chat websocket read error", "error", err)
			}
			return
		}

		if msgType != websocket.TextMessage {
			continue
		}

		var in chatClientMessage
		if err := json.Unmarshal(payload, &in); err != nil {
			continue
		}

		switch in.Type {
		case "interrupt":
			_ = ws.server.chat.Interrupt(ws.sessionID)
		case "user_message":
			if strings.TrimSpace(in.Content) == "" {
				continue
			}
			if err := ws.server.startChatTurn(ws.sessionID, in.Content, "chat_ws"); err != nil {
				_ = ws.writeJSON(map[string]any{
					"type":  "error",
					"error": err.Error(),
				})
			}
		}
	}
}

func (ws *chatWSConn) keepAlive() {
	ticker := time.NewTicker(chatPingPeriod)
	defer ticker.Stop()
	defer ws.close()

	for range ticker.C {
		if err := ws.writePing(); err != nil {
			return
		}
	}
}

func (ws *chatWSConn) writePing() error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return websocket.ErrCloseSent
	}
	_ = ws.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.conn.WriteMessage(websocket.PingMessage, nil)
}

func (ws *chatWSConn) writeJSON(payload any) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return websocket.ErrCloseSent
	}
	_ = ws.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.conn.WriteJSON(payload)
}

func (ws *chatWSConn) close() {
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
