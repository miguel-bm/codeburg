package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/db"
)

func (s *Server) handleGetPreference(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")

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
