package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/db"
)

var privatePreferenceKeys = map[string]struct{}{
	"telegram_bot_token":      {},
	"telegram_openai_api_key": {},
	"telegram_llm_api_key":    {},
}

func isPrivatePreferenceKey(key string) bool {
	_, ok := privatePreferenceKeys[strings.TrimSpace(key)]
	return ok
}

func (s *Server) handleGetPreferenceConfigured(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	pref, err := s.db.GetPreference(db.DefaultUserID, key)
	if err != nil {
		if err == db.ErrNotFound {
			writeJSON(w, http.StatusOK, map[string]bool{"configured": false})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get preference")
		return
	}

	configured := strings.TrimSpace(unquotePreference(pref.Value)) != ""
	writeJSON(w, http.StatusOK, map[string]bool{"configured": configured})
}

func (s *Server) handleGetPreference(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if isPrivatePreferenceKey(key) {
		writeError(w, http.StatusForbidden, "preference is private")
		return
	}

	pref, err := s.db.GetPreference(db.DefaultUserID, key)
	if err != nil {
		writeDBError(w, err, "preference")
		return
	}

	// Return the raw JSON value directly
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(pref.Value))
}

func (s *Server) handleSetPreference(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "body must be valid JSON")
		return
	}

	pref, err := s.db.SetPreference(db.DefaultUserID, key, string(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to set preference")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(pref.Value))
}

func (s *Server) handleDeletePreference(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")

	if err := s.db.DeletePreference(db.DefaultUserID, key); err != nil {
		writeDBError(w, err, "preference")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
