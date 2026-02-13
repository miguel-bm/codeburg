package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/ptyruntime"
)

// TerminalSession manages a single terminal websocket viewer attached to a runtime session.
type TerminalSession struct {
	conn      *websocket.Conn
	cancel    func()
	mu        sync.Mutex
	closed    bool
	sessionID string
	server    *Server
	lastInput time.Time
}

const (
	terminalPingPeriod = 30 * time.Second
	terminalPongWait   = 90 * time.Second
)

// handleTerminalWS handles websocket connections for terminal access.
// Query params:
//   - session: codeburg session ID (required)
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
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

	// Verify session exists before upgrading.
	if _, err := s.db.GetSession(sessionID); err != nil {
		writeDBError(w, err, "session")
		return
	}

	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("terminal websocket upgrade error", "error", err)
		return
	}

	snapshot, stream, cancel, err := s.sessions.runtime.Attach(sessionID)
	if err != nil {
		code := websocket.CloseInternalServerErr
		if err == ptyruntime.ErrSessionNotFound {
			code = 4000
		}
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, "session runtime unavailable"))
		_ = conn.Close()
		return
	}

	ts := &TerminalSession{
		conn:      conn,
		cancel:    cancel,
		sessionID: sessionID,
		server:    s,
	}

	go ts.readFromRuntime(snapshot, stream)
	go ts.keepAlive()
	ts.readFromWS()
}

func (ts *TerminalSession) readFromRuntime(snapshot []ptyruntime.OutputEvent, stream <-chan ptyruntime.OutputEvent) {
	defer ts.close()

	for _, ev := range snapshot {
		if err := ts.writeBinary(ev.Data); err != nil {
			return
		}
		ts.trackActivity()
	}

	for ev := range stream {
		if err := ts.writeBinary(ev.Data); err != nil {
			return
		}
		ts.trackActivity()
	}
}

func (ts *TerminalSession) writeBinary(data []byte) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.closed {
		return nil
	}
	_ = ts.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ts.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (ts *TerminalSession) readFromWS() {
	defer ts.close()
	_ = ts.conn.SetReadDeadline(time.Now().Add(terminalPongWait))
	ts.conn.SetPongHandler(func(string) error {
		return ts.conn.SetReadDeadline(time.Now().Add(terminalPongWait))
	})

	for {
		msgType, message, err := ts.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Debug("websocket read error", "error", err)
			}
			return
		}

		switch msgType {
		case websocket.BinaryMessage, websocket.TextMessage:
			if len(message) > 0 && message[0] == '{' {
				ts.handleControlMessage(message)
				continue
			}

			if len(message) > 0 {
				ts.handleUserInput(message)
			}
			if err := ts.server.sessions.runtime.Write(ts.sessionID, message); err != nil {
				slog.Debug("runtime write error", "session_id", ts.sessionID, "error", err)
				return
			}
		}
	}
}

func (ts *TerminalSession) keepAlive() {
	ticker := time.NewTicker(terminalPingPeriod)
	defer ticker.Stop()
	defer ts.close()

	for range ticker.C {
		if err := ts.writePing(); err != nil {
			return
		}
	}
}

func (ts *TerminalSession) writePing() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.closed {
		return websocket.ErrCloseSent
	}
	_ = ts.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ts.conn.WriteMessage(websocket.PingMessage, nil)
}

func (ts *TerminalSession) handleUserInput(message []byte) {
	if len(message) == 0 {
		return
	}
	if len(message) >= 3 && message[0] == 0x1b && message[1] == '[' {
		switch message[2] {
		case 'M', '<':
			return
		case 'I', 'O':
			return
		}
	}
	if time.Since(ts.lastInput) < 2*time.Second {
		return
	}
	ts.lastInput = time.Now()
	go ts.server.sessions.setSessionRunning(ts.sessionID, ts.server)
}

func (ts *TerminalSession) trackActivity() {
	session := ts.server.sessions.getOrRestore(ts.sessionID, ts.server.db)
	if session == nil {
		return
	}
	lastActivity := session.GetLastActivity()
	if time.Since(lastActivity) < 5*time.Second {
		return
	}

	now := time.Now()
	session.SetLastActivity(now)
	go ts.server.db.UpdateSession(ts.sessionID, db.UpdateSessionInput{
		LastActivityAt: &now,
	})
}

func (ts *TerminalSession) handleControlMessage(message []byte) {
	var msg struct {
		Type string `json:"type"`
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}
	if err := json.Unmarshal(message, &msg); err != nil {
		return
	}
	if msg.Type == "resize" && msg.Cols > 0 && msg.Rows > 0 {
		_ = ts.server.sessions.runtime.Resize(ts.sessionID, msg.Cols, msg.Rows)
	}
}

func (ts *TerminalSession) close() {
	ts.mu.Lock()
	if ts.closed {
		ts.mu.Unlock()
		return
	}
	ts.closed = true
	cancel := ts.cancel
	conn := ts.conn
	ts.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	_ = conn.Close()
}
