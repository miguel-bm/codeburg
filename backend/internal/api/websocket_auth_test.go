package api

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func wsBaseURL(serverURL string) string {
	return "ws" + strings.TrimPrefix(serverURL, "http")
}

func wsDialHeaders() http.Header {
	return http.Header{
		"Origin": []string{"http://localhost:3000"},
	}
}

func TestWebSocketRejectsUnauthenticatedSubscribe(t *testing.T) {
	env := setupTestEnv(t)

	srv := httptest.NewServer(env.server.router)
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial(wsBaseURL(srv.URL)+"/ws", wsDialHeaders())
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]string{
		"type":    "subscribe",
		"channel": "task",
		"id":      "abc",
	}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatalf("expected websocket close error")
	}
	closeErr, ok := err.(*websocket.CloseError)
	if !ok {
		t.Fatalf("expected CloseError, got %T (%v)", err, err)
	}
	if closeErr.Code != wsCloseCodeAuthRequired {
		t.Fatalf("expected close code %d, got %d", wsCloseCodeAuthRequired, closeErr.Code)
	}
}

func TestWebSocketAuthMessageAllowsSubscribe(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	srv := httptest.NewServer(env.server.router)
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial(wsBaseURL(srv.URL)+"/ws", wsDialHeaders())
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]string{
		"type":  "auth",
		"token": env.token,
	}); err != nil {
		t.Fatalf("write auth message: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var authResp map[string]any
	if err := conn.ReadJSON(&authResp); err != nil {
		t.Fatalf("read auth response: %v", err)
	}
	if got, _ := authResp["type"].(string); got != "authenticated" {
		t.Fatalf("expected authenticated response, got %#v", authResp)
	}

	if err := conn.WriteJSON(map[string]string{
		"type":    "subscribe",
		"channel": "task",
		"id":      "abc",
	}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	var subResp map[string]any
	if err := conn.ReadJSON(&subResp); err != nil {
		t.Fatalf("read subscribe response: %v", err)
	}
	if got, _ := subResp["type"].(string); got != "subscribed" {
		t.Fatalf("expected subscribed response, got %#v", subResp)
	}
}

func TestWebSocketRejectsInvalidHandshakeToken(t *testing.T) {
	env := setupTestEnv(t)

	srv := httptest.NewServer(env.server.router)
	defer srv.Close()

	_, resp, err := websocket.DefaultDialer.Dial(wsBaseURL(srv.URL)+"/ws?token=bad-token", wsDialHeaders())
	if err == nil {
		t.Fatalf("expected handshake error for invalid token")
	}
	if resp == nil {
		t.Fatalf("expected HTTP response on handshake failure")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestTerminalWSRejectsMissingTokenBeforeSessionLookup(t *testing.T) {
	env := setupTestEnv(t)

	resp := env.get("/ws/terminal?session=nonexistent")
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
}

func TestTerminalWSAcceptsQueryToken(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	u := "/ws/terminal?session=nonexistent&token=" + url.QueryEscape(env.token)
	resp := env.requestWithToken("GET", u, nil, "")
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing session after auth, got %d", resp.Code)
	}
}
