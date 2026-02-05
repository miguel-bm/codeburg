package tunnel

import (
	"regexp"
	"testing"
)

// The regex used by the tunnel manager to extract cloudflared URLs
var urlRegex = regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)

func TestURLRegex_StandardURL(t *testing.T) {
	line := "2024-01-15T10:00:00Z INF | https://abc123.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "https://abc123.trycloudflare.com" {
		t.Errorf("expected standard URL match, got %q", match)
	}
}

func TestURLRegex_HyphenatedSubdomain(t *testing.T) {
	line := "INF https://my-tunnel-name-123.trycloudflare.com connected"
	match := urlRegex.FindString(line)
	if match != "https://my-tunnel-name-123.trycloudflare.com" {
		t.Errorf("expected hyphenated URL match, got %q", match)
	}
}

func TestURLRegex_URLInMiddleOfLine(t *testing.T) {
	line := "INFO connector connected connectorID=abc url=https://test-tunnel.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "https://test-tunnel.trycloudflare.com" {
		t.Errorf("expected URL in middle of line, got %q", match)
	}
}

func TestURLRegex_NoMatch_HTTP(t *testing.T) {
	line := "http://abc123.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "" {
		t.Errorf("expected no match for http URL, got %q", match)
	}
}

func TestURLRegex_NoMatch_WrongDomain(t *testing.T) {
	line := "https://abc123.cloudflare.com"
	match := urlRegex.FindString(line)
	if match != "" {
		t.Errorf("expected no match for wrong domain, got %q", match)
	}
}

func TestURLRegex_NoMatch_EmptySubdomain(t *testing.T) {
	line := "https://.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "" {
		t.Errorf("expected no match for empty subdomain, got %q", match)
	}
}

func TestURLRegex_NoMatch_UnderscoreInSubdomain(t *testing.T) {
	line := "https://my_tunnel.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "" {
		t.Errorf("expected no match for underscore in subdomain, got %q", match)
	}
}

func TestURLRegex_FirstMatchWins(t *testing.T) {
	line := "first: https://aaa.trycloudflare.com second: https://bbb.trycloudflare.com"
	match := urlRegex.FindString(line)
	if match != "https://aaa.trycloudflare.com" {
		t.Errorf("expected first URL, got %q", match)
	}
}

func TestTunnelInfo(t *testing.T) {
	tunnel := &Tunnel{
		ID:     "test-id",
		TaskID: "task-id",
		Port:   3000,
		URL:    "https://test.trycloudflare.com",
	}

	info := tunnel.Info()

	if info.ID != "test-id" {
		t.Errorf("expected ID 'test-id', got %q", info.ID)
	}
	if info.TaskID != "task-id" {
		t.Errorf("expected TaskID 'task-id', got %q", info.TaskID)
	}
	if info.Port != 3000 {
		t.Errorf("expected Port 3000, got %d", info.Port)
	}
	if info.URL != "https://test.trycloudflare.com" {
		t.Errorf("expected URL, got %q", info.URL)
	}
}
