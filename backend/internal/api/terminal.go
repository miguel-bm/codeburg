package api

import (
	"bufio"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/miguel-bm/codeburg/internal/db"
)

// TerminalSession manages a single terminal WebSocket connection
type TerminalSession struct {
	conn      *websocket.Conn
	reader    *bufio.Reader
	cleanup   func()
	mu        sync.Mutex
	closed    bool
	sessionID string  // Codeburg session ID (optional)
	server    *Server // For DB/WS access (optional)
	lastInput time.Time
	target    string
}

// handleTerminalWS handles WebSocket connections for terminal access
// Query params:
//   - target: tmux target (e.g., "codeburg:@1.%1")
//   - session: codeburg session ID (optional, for activity tracking)
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("target")
	if target == "" {
		http.Error(w, "target parameter required", http.StatusBadRequest)
		return
	}

	sessionID := r.URL.Query().Get("session")

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("terminal websocket upgrade error", "error", err)
		return
	}

	// Check if the tmux target exists before starting PTY
	if !s.sessions.tmux.TargetExists(target) {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4000, "tmux window gone"))
		conn.Close()
		return
	}

	// Create terminal session
	ts := &TerminalSession{
		conn:      conn,
		sessionID: sessionID,
		server:    s,
		target:    target,
	}

	// Start the terminal
	if err := ts.start(); err != nil {
		slog.Error("failed to start terminal", "target", target, "error", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
		conn.Close()
		return
	}

	// Handle I/O
	go ts.readFromPipe()
	ts.readFromWS()
}

// start begins the tmux pipe-pane stream
func (ts *TerminalSession) start() error {
	reader, cleanup, err := ts.server.sessions.tmux.PipeOutput(ts.target)
	if err != nil {
		return err
	}
	ts.reader = reader
	ts.cleanup = cleanup
	return nil
}

// readFromPipe reads from the tmux pipe and sends to WebSocket
func (ts *TerminalSession) readFromPipe() {
	defer ts.close()

	buf := make([]byte, 4096)
	for {
		n, err := ts.reader.Read(buf)
		if err != nil {
			if err != io.EOF {
				slog.Debug("pipe read error", "error", err)
			}
			return
		}

		// Track activity for this session
		if ts.sessionID != "" && ts.server != nil {
			ts.trackActivity()
		}

		ts.mu.Lock()
		if ts.closed {
			ts.mu.Unlock()
			return
		}
		ts.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		err = ts.conn.WriteMessage(websocket.BinaryMessage, buf[:n])
		ts.mu.Unlock()

		if err != nil {
			slog.Debug("websocket write error", "error", err)
			return
		}
	}
}

// readFromWS reads from WebSocket and writes to tmux pane
func (ts *TerminalSession) readFromWS() {
	defer ts.close()

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
			// Check for resize message (JSON)
			if len(message) > 0 && message[0] == '{' {
				ts.handleControlMessage(message)
				continue
			}

			// User input detected - reset session to running if waiting
			if ts.sessionID != "" && ts.server != nil && len(message) > 0 {
				ts.handleUserInput(message)
			}

			// Write input to tmux pane
			if err := ts.server.sessions.tmux.SendKeysRaw(ts.target, string(message)); err != nil {
				slog.Debug("tmux send-keys error", "error", err)
				return
			}
		}
	}
}

// handleUserInput resets session status to running when user types actual input.
// Ignores mouse events, focus events, and other terminal control sequences
// that fire when clicking into the terminal without actually typing.
func (ts *TerminalSession) handleUserInput(message []byte) {
	if len(message) == 0 {
		return
	}
	// Skip mouse event sequences: ESC[M..., ESC[<...
	if len(message) >= 3 && message[0] == 0x1b && message[1] == '[' {
		switch message[2] {
		case 'M', '<': // mouse events (normal/SGR mode)
			return
		case 'I', 'O': // focus in/out events
			return
		}
	}
	if time.Since(ts.lastInput) < 2*time.Second {
		return
	}
	ts.lastInput = time.Now()
	go ts.server.sessions.setSessionRunning(ts.sessionID, ts.server.db, ts.server.wsHub)
}

// trackActivity updates the last activity timestamp (debounced to every 5 seconds)
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

	// Update DB periodically (debounced by the 5s check above)
	go ts.server.db.UpdateSession(ts.sessionID, db.UpdateSessionInput{
		LastActivityAt: &now,
	})
}

// handleControlMessage handles JSON control messages (e.g., resize)
func (ts *TerminalSession) handleControlMessage(message []byte) {
	// Simple JSON parsing for resize
	// Format: {"type":"resize","cols":80,"rows":24}
	var msg struct {
		Type string `json:"type"`
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}

	if err := json.Unmarshal(message, &msg); err != nil {
		return
	}

	if msg.Type == "resize" && msg.Cols > 0 && msg.Rows > 0 {
		// No-op: tmux panes handle their own size.
	}
}

// close cleans up the terminal session
func (ts *TerminalSession) close() {
	ts.mu.Lock()
	if ts.closed {
		ts.mu.Unlock()
		return
	}
	ts.closed = true
	conn := ts.conn
	cleanup := ts.cleanup
	ts.mu.Unlock()

	// Perform blocking I/O outside the lock
	if cleanup != nil {
		cleanup()
	}

	conn.Close()
}
