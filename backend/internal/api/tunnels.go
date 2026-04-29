package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/tunnel"
	"github.com/oklog/ulid/v2"
)

// handleListWorkspaceTunnels lists active public shares owned by a workspace.
func (s *Server) handleListWorkspaceTunnels(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	if _, err := s.db.GetWorkspace(workspaceID); err != nil {
		writeDBError(w, err, "workspace")
		return
	}

	active := s.tunnels.ListForWorkspace(workspaceID)
	infos := make([]tunnel.TunnelInfo, len(active))
	for i, t := range active {
		infos[i] = t.Info()
	}

	writeJSON(w, http.StatusOK, infos)
}

// handleCreateWorkspaceTunnel creates a Cloudflare quick tunnel for a workspace.
func (s *Server) handleCreateWorkspaceTunnel(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	workspace, err := s.db.GetWorkspace(workspaceID)
	if err != nil {
		writeDBError(w, err, "workspace")
		return
	}
	if workspace.Status != db.WorkspaceStatusActive {
		writeError(w, http.StatusConflict, "tunnels can only be started for active workspaces")
		return
	}

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
	t, err := s.tunnels.Create(id, workspace.ID, workspace.ProjectID, input.Port)
	if err != nil {
		var conflict *tunnel.PortConflictError
		if errors.As(err, &conflict) {
			writeJSON(w, http.StatusConflict, map[string]interface{}{
				"error":          conflict.Error(),
				"existingTunnel": mapTunnelRef(conflict.Existing, s),
			})
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, t.Info())
}

// handleStopWorkspaceTunnel stops a tunnel. The route validates the current
// workspace, but the tunnel itself may belong to another workspace so port
// conflicts can be resolved without forcing navigation.
func (s *Server) handleStopWorkspaceTunnel(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	if _, err := s.db.GetWorkspace(workspaceID); err != nil {
		writeDBError(w, err, "workspace")
		return
	}

	tunnelID := chi.URLParam(r, "tunnelId")
	if err := s.tunnels.Stop(tunnelID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}
