package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestPrivatePreferenceIsNotReadable(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("secret-password")

	if _, err := env.server.db.SetPreference("default", "telegram_openai_api_key", `"sk-test-secret"`); err != nil {
		t.Fatalf("set preference: %v", err)
	}

	resp := env.get("/api/preferences/telegram_openai_api_key")
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for private preference read, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestPrivatePreferenceConfiguredEndpoint(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("secret-password")

	if _, err := env.server.db.SetPreference("default", "telegram_openai_api_key", `"sk-test-secret"`); err != nil {
		t.Fatalf("set preference: %v", err)
	}

	resp := env.get("/api/preferences/telegram_openai_api_key/configured")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body struct {
		Configured bool `json:"configured"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Configured {
		t.Fatalf("expected configured=true")
	}
}
