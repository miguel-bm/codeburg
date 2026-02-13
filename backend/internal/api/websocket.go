package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	wsReadBufferSize        = 1024
	wsWriteBufferSize       = 1024
	wsCloseCodeAuthRequired = 4001
	wsAuthTimeout           = 10 * time.Second
)

func (s *Server) wsUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  wsReadBufferSize,
		WriteBufferSize: wsWriteBufferSize,
		CheckOrigin: func(r *http.Request) bool {
			return isAllowedOrigin(s.allowedOrigins, r.Header.Get("Origin"))
		},
	}
}

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// WSClient represents a WebSocket client connection
type WSClient struct {
	hub  *WSHub
	conn *websocket.Conn
	send chan []byte
	subs map[string]bool // Subscribed channels (e.g., "session:123")
	mu   sync.Mutex
	auth bool
}

// WSHub manages all WebSocket connections
type WSHub struct {
	clients    map[*WSClient]bool
	broadcast  chan []byte
	register   chan *WSClient
	unregister chan *WSClient
	done       chan struct{}
	stopOnce   sync.Once
	mu         sync.RWMutex
}

// NewWSHub creates a new WebSocket hub
func NewWSHub() *WSHub {
	return &WSHub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
		done:       make(chan struct{}),
	}
}

// Run starts the hub's event loop
func (h *WSHub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			h.Stop()
			h.shutdownClients()
			return
		case <-h.done:
			h.shutdownClients()
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				_ = client.conn.Close()
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Skip slow client — its own goroutine will handle cleanup via unregister
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *WSHub) shutdownClients() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		delete(h.clients, client)
		_ = client.conn.Close()
	}
}

func (h *WSHub) Stop() {
	h.stopOnce.Do(func() {
		close(h.done)
	})
}

func (h *WSHub) isStopped() bool {
	select {
	case <-h.done:
		return true
	default:
		return false
	}
}

func (h *WSHub) Register(client *WSClient) bool {
	if h.isStopped() {
		return false
	}
	select {
	case h.register <- client:
		return true
	case <-h.done:
		return false
	}
}

func (h *WSHub) Unregister(client *WSClient) {
	if h.isStopped() {
		return
	}
	select {
	case h.unregister <- client:
	case <-h.done:
	}
}

// BroadcastToSession sends a message to all clients subscribed to a session
func (h *WSHub) BroadcastToSession(sessionID string, msgType string, data interface{}) {
	if h.isStopped() {
		return
	}
	channel := "session:" + sessionID

	payload := map[string]interface{}{
		"type":      msgType,
		"sessionId": sessionID,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	message, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal websocket message", "error", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.mu.Lock()
		authed := client.auth
		subscribed := client.subs[channel]
		client.mu.Unlock()

		if authed && subscribed {
			select {
			case client.send <- message:
			default:
				// Client buffer full, skip
			}
		}
	}
}

// BroadcastToTask sends a message to all clients subscribed to a task
func (h *WSHub) BroadcastToTask(taskID string, msgType string, data interface{}) {
	if h.isStopped() {
		return
	}
	channel := "task:" + taskID

	payload := map[string]interface{}{
		"type":      msgType,
		"taskId":    taskID,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	message, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal websocket message", "error", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.mu.Lock()
		authed := client.auth
		subscribed := client.subs[channel]
		client.mu.Unlock()

		if authed && subscribed {
			select {
			case client.send <- message:
			default:
			}
		}
	}
}

// BroadcastGlobal sends a message to all connected clients (no subscription required)
func (h *WSHub) BroadcastGlobal(msgType string, data interface{}) {
	payload := map[string]interface{}{
		"type":      msgType,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	message, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal global websocket message", "error", err)
		return
	}

	select {
	case h.broadcast <- message:
	case <-h.done:
		return
	default:
		slog.Warn("broadcast channel full, dropping global message", "type", msgType)
	}
}

func authTokenFromWSRequest(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if token != "" {
			return token
		}
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

// handleWebSocket handles WebSocket connection upgrade and message handling
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := authTokenFromWSRequest(r)
	preAuthed := false
	if token != "" {
		if !s.auth.ValidateToken(token) {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		preAuthed = true
	}

	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade error", "error", err)
		return
	}

	client := &WSClient{
		hub:  s.wsHub,
		conn: conn,
		send: make(chan []byte, 256),
		subs: make(map[string]bool),
		auth: preAuthed,
	}

	if preAuthed {
		if !s.wsHub.Register(client) {
			_ = conn.Close()
			return
		}
		client.sendJSON(map[string]string{"type": "authenticated"})
	}

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump(s)

	if !preAuthed {
		go func() {
			timer := time.NewTimer(wsAuthTimeout)
			defer timer.Stop()
			<-timer.C
			if !client.isAuthenticated() {
				client.closeUnauthorized("authentication timeout")
			}
		}()
	}
}

// readPump handles incoming messages from the client
func (c *WSClient) readPump(s *Server) {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512 * 1024) // 512KB max message size
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Warn("websocket error", "error", err)
			}
			break
		}

		c.handleMessage(s, message)
	}
}

// writePump sends messages to the client
func (c *WSClient) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Send any queued messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleMessage processes an incoming WebSocket message
func (c *WSClient) handleMessage(s *Server, message []byte) {
	var msg struct {
		Type      string `json:"type"`
		Channel   string `json:"channel"`
		ID        string `json:"id"`
		SessionID string `json:"sessionId"`
		Content   string `json:"content"`
		Token     string `json:"token"`
	}

	if err := json.Unmarshal(message, &msg); err != nil {
		slog.Warn("invalid websocket message", "error", err)
		return
	}

	switch msg.Type {
	case "auth":
		if !s.auth.ValidateToken(strings.TrimSpace(msg.Token)) {
			c.closeUnauthorized("invalid token")
			return
		}
		wasAuthed := c.setAuthenticated()
		if !wasAuthed {
			if !c.hub.Register(c) {
				c.closeUnauthorized("server unavailable")
				return
			}
		}
		c.sendJSON(map[string]string{"type": "authenticated"})

	case "subscribe":
		if !c.isAuthenticated() {
			c.closeUnauthorized("authentication required")
			return
		}
		// Subscribe to a channel (e.g., "session" or "task")
		channel := msg.Channel + ":" + msg.ID
		c.mu.Lock()
		c.subs[channel] = true
		c.mu.Unlock()

		// Send confirmation
		c.sendJSON(map[string]interface{}{
			"type":    "subscribed",
			"channel": msg.Channel,
			"id":      msg.ID,
		})

	case "unsubscribe":
		if !c.isAuthenticated() {
			c.closeUnauthorized("authentication required")
			return
		}
		channel := msg.Channel + ":" + msg.ID
		c.mu.Lock()
		delete(c.subs, channel)
		c.mu.Unlock()

		c.sendJSON(map[string]interface{}{
			"type":    "unsubscribed",
			"channel": msg.Channel,
			"id":      msg.ID,
		})

	case "message":
		if !c.isAuthenticated() {
			c.closeUnauthorized("authentication required")
			return
		}
		// Send message to agent session
		if msg.SessionID != "" && msg.Content != "" {
			s.handleWSMessage(msg.SessionID, msg.Content)
		}

	case "ping":
		c.sendJSON(map[string]string{"type": "pong"})
	}
}

func (c *WSClient) isAuthenticated() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.auth
}

// setAuthenticated marks a client as authenticated and returns whether it was already authenticated.
func (c *WSClient) setAuthenticated() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	already := c.auth
	c.auth = true
	return already
}

func (c *WSClient) closeUnauthorized(reason string) {
	_ = c.conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(wsCloseCodeAuthRequired, reason),
		time.Now().Add(1*time.Second),
	)
	_ = c.conn.Close()
}

// sendJSON sends a JSON message to the client
func (c *WSClient) sendJSON(v interface{}) {
	message, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case c.send <- message:
	default:
	}
}

// handleWSMessage handles sending a message to an agent session via WebSocket
func (s *Server) handleWSMessage(sessionID string, content string) {
	execSession := s.sessions.getOrRestore(sessionID, s.db)
	if execSession == nil {
		slog.Warn("websocket message for unknown session", "session_id", sessionID)
		return
	}

	if err := s.sessions.runtime.Write(sessionID, []byte(content+"\n")); err != nil {
		slog.Error("failed to send websocket message to session", "session_id", sessionID, "error", err)
		s.wsHub.BroadcastToSession(sessionID, "error", map[string]string{
			"message": "Failed to deliver message: " + err.Error(),
		})
		return
	}

	// Notify subscribers the message was delivered
	s.wsHub.BroadcastToSession(sessionID, "message_sent", map[string]string{
		"content": content,
	})
}
