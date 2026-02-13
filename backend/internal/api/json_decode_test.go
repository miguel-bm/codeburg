package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsUnknownFields(t *testing.T) {
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"ok","extra":1}`))

	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err == nil {
		t.Fatal("expected unknown field error")
	}
}

func TestDecodeJSONRejectsTrailingJSON(t *testing.T) {
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"ok"}{"name":"again"}`))

	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err == nil {
		t.Fatal("expected trailing JSON error")
	}
}

func TestDecodeJSONRejectsOversizedBody(t *testing.T) {
	oversized := `{"payload":"` + strings.Repeat("a", maxJSONBodyBytes) + `"}`
	r := httptest.NewRequest("POST", "/", strings.NewReader(oversized))

	var body struct {
		Payload string `json:"payload"`
	}
	if err := decodeJSON(r, &body); err == nil {
		t.Fatal("expected oversized body error")
	}
}
