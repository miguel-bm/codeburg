package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/miguel/codeburg/internal/db"
)

// TerminalSession manages a single terminal WebSocket connection
type TerminalSession struct {
	conn      *websocket.Conn
	ptmx      *os.File
	cmd       *exec.Cmd
	mu        sync.Mutex
	closed    bool
	sessionID string  // Codeburg session ID (optional)
	server    *Server // For DB/WS access (optional)
	lastInput time.Time
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

	// Create terminal session
	ts := &TerminalSession{
		conn:      conn,
		sessionID: sessionID,
		server:    s,
	}

	// Start the terminal
	if err := ts.start(target); err != nil {
		slog.Error("failed to start terminal", "target", target, "error", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
		conn.Close()
		return
	}

	// Handle I/O
	go ts.readFromPTY()
	ts.readFromWS()
}

// start begins the tmux attach session
func (ts *TerminalSession) start(target string) error {
	// Create command to attach to tmux
	ts.cmd = exec.Command("tmux", "attach-session", "-t", target)

	// Create PTY
	ptmx, err := pty.Start(ts.cmd)
	if err != nil {
		return err
	}
	ts.ptmx = ptmx

	// Set initial size (can be updated via resize message)
	pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
	})

	return nil
}

// readFromPTY reads from the PTY and sends to WebSocket
func (ts *TerminalSession) readFromPTY() {
	defer ts.close()

	buf := make([]byte, 4096)
	for {
		n, err := ts.ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				slog.Debug("pty read error", "error", err)
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

// readFromWS reads from WebSocket and writes to PTY
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
				ts.handleUserInput()
			}

			// Write input to PTY
			_, err := ts.ptmx.Write(message)
			if err != nil {
				slog.Debug("pty write error", "error", err)
				return
			}
		}
	}
}

// handleUserInput resets session status to running when user types
func (ts *TerminalSession) handleUserInput() {
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
		pty.Setsize(ts.ptmx, &pty.Winsize{
			Rows: msg.Rows,
			Cols: msg.Cols,
		})
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
	ptmx := ts.ptmx
	cmd := ts.cmd
	conn := ts.conn
	ts.mu.Unlock()

	// Perform blocking I/O outside the lock
	if ptmx != nil {
		ptmx.Close()
	}

	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
		cmd.Wait()
	}

	conn.Close()
}
