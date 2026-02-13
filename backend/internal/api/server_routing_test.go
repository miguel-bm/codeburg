package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestUnknownAPIRouteReturnsJSON404(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")

	resp := env.get("/api/does-not-exist")
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.Code)
	}
	if ct := resp.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected JSON content type, got %q", ct)
	}

	var body map[string]string
	decodeResponse(t, resp, &body)
	if body["error"] == "" {
		t.Fatalf("expected structured error body, got %s", resp.Body.String())
	}
}
