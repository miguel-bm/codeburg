package tunnel

import (
	"errors"
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
		ID:          "test-id",
		WorkspaceID: "workspace-id",
		ProjectID:   "project-id",
		Port:        3000,
		URL:         "https://test.trycloudflare.com",
		Status:      StatusActive,
	}

	info := tunnel.Info()

	if info.ID != "test-id" {
		t.Errorf("expected ID 'test-id', got %q", info.ID)
	}
	if info.WorkspaceID != "workspace-id" {
		t.Errorf("expected WorkspaceID 'workspace-id', got %q", info.WorkspaceID)
	}
	if info.ProjectID != "project-id" {
		t.Errorf("expected ProjectID 'project-id', got %q", info.ProjectID)
	}
	if info.Port != 3000 {
		t.Errorf("expected Port 3000, got %d", info.Port)
	}
	if info.URL != "https://test.trycloudflare.com" {
		t.Errorf("expected URL, got %q", info.URL)
	}
}

func TestFindByPort(t *testing.T) {
	mgr := NewManager()
	mgr.tunnels["t-1"] = &Tunnel{
		ID:          "t-1",
		WorkspaceID: "workspace-1",
		ProjectID:   "project-1",
		Port:        3000,
		URL:         "https://a.trycloudflare.com",
		Status:      StatusActive,
	}
	mgr.ports[3000] = "t-1"

	info := mgr.FindByPort(3000)
	if info == nil {
		t.Fatal("expected tunnel info for port 3000")
	}
	if info.ID != "t-1" {
		t.Fatalf("expected tunnel id t-1, got %q", info.ID)
	}
}

func TestCreate_PortConflict(t *testing.T) {
	mgr := NewManager()
	mgr.tunnels["existing"] = &Tunnel{
		ID:          "existing",
		WorkspaceID: "workspace-other",
		ProjectID:   "project-1",
		Port:        5173,
		URL:         "https://existing.trycloudflare.com",
		Status:      StatusActive,
	}
	mgr.ports[5173] = "existing"

	_, err := mgr.Create("new", "workspace-1", "project-1", 5173)
	if err == nil {
		t.Fatal("expected conflict error")
	}

	var conflict *PortConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected PortConflictError, got %T", err)
	}
	if conflict.Existing.ID != "existing" {
		t.Fatalf("expected existing tunnel id, got %q", conflict.Existing.ID)
	}
}
