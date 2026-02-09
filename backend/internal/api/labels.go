package api

import (
	"net/http"

	"github.com/miguel-bm/codeburg/internal/db"
)

func (s *Server) handleListLabels(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	labels, err := s.db.ListLabels(projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list labels")
		return
	}

	writeJSON(w, http.StatusOK, labels)
}

func (s *Server) handleCreateLabel(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	// Verify project exists
	_, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	label, err := s.db.CreateLabel(db.CreateLabelInput{
		ProjectID: projectID,
		Name:      body.Name,
		Color:     body.Color,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create label")
		return
	}

	writeJSON(w, http.StatusCreated, label)
}

func (s *Server) handleDeleteLabel(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	if err := s.db.DeleteLabel(id); err != nil {
		writeDBError(w, err, "label")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAssignLabel(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")

	var body struct {
		LabelID string `json:"labelId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.LabelID == "" {
		writeError(w, http.StatusBadRequest, "labelId is required")
		return
	}

	if err := s.db.AssignLabel(taskID, body.LabelID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to assign label")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnassignLabel(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")
	labelID := urlParam(r, "labelId")

	if err := s.db.UnassignLabel(taskID, labelID); err != nil {
		writeDBError(w, err, "label assignment")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
