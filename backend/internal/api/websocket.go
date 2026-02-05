package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins in development
		// TODO: Restrict in production
		return true
	},
}

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// WSClient represents a WebSocket client connection
type WSClient struct {
	hub     *WSHub
	conn    *websocket.Conn
	send    chan []byte
	subs    map[string]bool // Subscribed channels (e.g., "session:123")
	mu      sync.Mutex
}

// WSHub manages all WebSocket connections
type WSHub struct {
	clients    map[*WSClient]bool
	broadcast  chan []byte
	register   chan *WSClient
	unregister chan *WSClient
	mu         sync.RWMutex
}

// NewWSHub creates a new WebSocket hub
func NewWSHub() *WSHub {
	return &WSHub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
	}
}

// Run starts the hub's event loop
func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastToSession sends a message to all clients subscribed to a session
func (h *WSHub) BroadcastToSession(sessionID string, msgType string, data interface{}) {
	channel := "session:" + sessionID

	payload := map[string]interface{}{
		"type":      msgType,
		"sessionId": sessionID,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	message, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Error marshaling WebSocket message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.mu.Lock()
		subscribed := client.subs[channel]
		client.mu.Unlock()

		if subscribed {
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
	channel := "task:" + taskID

	payload := map[string]interface{}{
		"type":      msgType,
		"taskId":    taskID,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	message, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Error marshaling WebSocket message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.mu.Lock()
		subscribed := client.subs[channel]
		client.mu.Unlock()

		if subscribed {
			select {
			case client.send <- message:
			default:
			}
		}
	}
}

// handleWebSocket handles WebSocket connection upgrade and message handling
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &WSClient{
		hub:  s.wsHub,
		conn: conn,
		send: make(chan []byte, 256),
		subs: make(map[string]bool),
	}

	s.wsHub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump(s)
}

// readPump handles incoming messages from the client
func (c *WSClient) readPump(s *Server) {
	defer func() {
		c.hub.unregister <- c
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
				log.Printf("WebSocket error: %v", err)
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
	}

	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("Invalid WebSocket message: %v", err)
		return
	}

	switch msg.Type {
	case "subscribe":
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
		// Send message to agent session
		if msg.SessionID != "" && msg.Content != "" {
			s.handleWSMessage(msg.SessionID, msg.Content)
		}

	case "ping":
		c.sendJSON(map[string]string{"type": "pong"})
	}
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

// handleWSMessage handles sending a message to an agent session
func (s *Server) handleWSMessage(sessionID string, content string) {
	// This will be implemented when we integrate with the executor
	// For now, log it
	log.Printf("WebSocket message for session %s: %s", sessionID, content)
}
