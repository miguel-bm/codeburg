package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/tunnel"
	"github.com/oklog/ulid/v2"
)

// handleListTunnels lists all tunnels for a task
func (s *Server) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	tunnels := s.tunnels.ListForTask(taskID)
	infos := make([]tunnel.TunnelInfo, len(tunnels))
	for i, t := range tunnels {
		infos[i] = t.Info()
	}

	writeJSON(w, http.StatusOK, infos)
}

// handleCreateTunnel creates a new tunnel
func (s *Server) handleCreateTunnel(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	var input struct {
		Port int `json:"port"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Port <= 0 || input.Port > 65535 {
		writeError(w, http.StatusBadRequest, "invalid port")
		return
	}

	// Generate tunnel ID
	id := ulid.Make().String()

	t, err := s.tunnels.Create(id, taskID, input.Port)
	if err != nil {
		var conflict *tunnel.PortConflictError
		if errors.As(err, &conflict) {
			writeJSON(w, http.StatusConflict, map[string]interface{}{
				"error":          conflict.Error(),
				"existingTunnel": conflict.Existing,
			})
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, t.Info())
}

// handleListProjectTunnels lists all tunnels for a project
func (s *Server) handleListProjectTunnels(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	tunnels := s.tunnels.ListForProject(projectID)
	infos := make([]tunnel.TunnelInfo, len(tunnels))
	for i, t := range tunnels {
		infos[i] = t.Info()
	}

	writeJSON(w, http.StatusOK, infos)
}

// handleCreateProjectTunnel creates a tunnel for a project
func (s *Server) handleCreateProjectTunnel(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	var input struct {
		Port int `json:"port"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Port <= 0 || input.Port > 65535 {
		writeError(w, http.StatusBadRequest, "invalid port")
		return
	}

	id := ulid.Make().String()

	t, err := s.tunnels.Create(id, "", input.Port, projectID)
	if err != nil {
		var conflict *tunnel.PortConflictError
		if errors.As(err, &conflict) {
			writeJSON(w, http.StatusConflict, map[string]interface{}{
				"error":          conflict.Error(),
				"existingTunnel": conflict.Existing,
			})
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, t.Info())
}

// handleStopTunnel stops a tunnel
func (s *Server) handleStopTunnel(w http.ResponseWriter, r *http.Request) {
	tunnelID := chi.URLParam(r, "id")

	if err := s.tunnels.Stop(tunnelID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}
