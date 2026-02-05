package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// TerminalSession manages a single terminal WebSocket connection
type TerminalSession struct {
	conn   *websocket.Conn
	ptmx   *os.File
	cmd    *exec.Cmd
	mu     sync.Mutex
	closed bool
}

// handleTerminalWS handles WebSocket connections for terminal access
// Query params:
//   - target: tmux target (e.g., "codeburg:@1.%1")
//   - cols: terminal columns (default 80)
//   - rows: terminal rows (default 24)
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("target")
	if target == "" {
		http.Error(w, "target parameter required", http.StatusBadRequest)
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Terminal WebSocket upgrade error: %v", err)
		return
	}

	// Create terminal session
	ts := &TerminalSession{
		conn: conn,
	}

	// Start the terminal
	if err := ts.start(target); err != nil {
		log.Printf("Failed to start terminal: %v", err)
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
				log.Printf("PTY read error: %v", err)
			}
			return
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
			log.Printf("WebSocket write error: %v", err)
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
				log.Printf("WebSocket read error: %v", err)
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

			// Write input to PTY
			_, err := ts.ptmx.Write(message)
			if err != nil {
				log.Printf("PTY write error: %v", err)
				return
			}
		}
	}
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
	defer ts.mu.Unlock()

	if ts.closed {
		return
	}
	ts.closed = true

	if ts.ptmx != nil {
		ts.ptmx.Close()
	}

	if ts.cmd != nil && ts.cmd.Process != nil {
		ts.cmd.Process.Kill()
		ts.cmd.Wait()
	}

	ts.conn.Close()
}
