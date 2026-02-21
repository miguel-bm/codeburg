package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

func requestWithRemote(t *testing.T, server *Server, method, path, remoteAddr string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reader *strings.Reader
	if body == nil {
		reader = strings.NewReader("")
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = strings.NewReader(string(data))
	}

	req := httptest.NewRequest(method, path, reader)
	req.RemoteAddr = remoteAddr
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	server.router.ServeHTTP(w, req)
	return w
}

func TestInternalAgentListProjects_LoopbackAllowed(t *testing.T) {
	env := setupTestEnv(t)

	_, err := env.server.db.CreateProject(db.CreateProjectInput{Name: "alpha", Path: "/tmp/alpha"})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	resp := requestWithRemote(t, env.server, "GET", "/api/internal/agent/projects", "127.0.0.1:12345", nil)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var projects []db.Project
	decodeResponse(t, resp, &projects)
	if len(projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(projects))
	}
	if projects[0].Name != "alpha" {
		t.Fatalf("expected project alpha, got %q", projects[0].Name)
	}
}

func TestInternalAgentCreateTask_Dedupe(t *testing.T) {
	env := setupTestEnv(t)

	project, err := env.server.db.CreateProject(db.CreateProjectInput{Name: "alpha", Path: "/tmp/alpha"})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	body := map[string]any{
		"project": project.ID,
		"title":   "Add internal task API",
		"dedupe":  true,
	}

	first := requestWithRemote(t, env.server, "POST", "/api/internal/agent/tasks", "127.0.0.1:43210", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", first.Code, first.Body.String())
	}

	var firstResp map[string]any
	decodeResponse(t, first, &firstResp)
	if deduped, _ := firstResp["deduped"].(bool); deduped {
		t.Fatalf("expected first create to not dedupe")
	}

	second := requestWithRemote(t, env.server, "POST", "/api/internal/agent/tasks", "127.0.0.1:43211", body)
	if second.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", second.Code, second.Body.String())
	}

	var secondResp map[string]any
	decodeResponse(t, second, &secondResp)
	if deduped, _ := secondResp["deduped"].(bool); !deduped {
		t.Fatalf("expected second create to dedupe")
	}
}

func TestInternalAgentEndpoints_RejectNonLoopback(t *testing.T) {
	env := setupTestEnv(t)

	resp := requestWithRemote(t, env.server, "GET", "/api/internal/agent/projects", "192.0.2.10:12345", nil)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", resp.Code, resp.Body.String())
	}
}
