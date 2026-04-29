package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/portsuggest"
	"github.com/miguel-bm/codeburg/internal/tunnel"
)

type portSuggestionStatus string

const (
	portSuggestionStatusSuggested                portSuggestionStatus = "suggested"
	portSuggestionStatusAlreadyTunneledWorkspace portSuggestionStatus = "already_tunneled_this_workspace"
	portSuggestionStatusAlreadyTunneledOther     portSuggestionStatus = "already_tunneled_other_workspace"
)

type tunnelRef struct {
	ID            string `json:"id"`
	WorkspaceID   string `json:"workspaceId"`
	WorkspaceName string `json:"workspaceName,omitempty"`
	ProjectID     string `json:"projectId"`
	Port          int    `json:"port"`
	URL           string `json:"url"`
	Status        string `json:"status"`
}

type workspacePortSuggestion struct {
	Port           int                  `json:"port"`
	Sources        []string             `json:"sources"`
	FirstSeenAt    time.Time            `json:"firstSeenAt"`
	LastSeenAt     time.Time            `json:"lastSeenAt"`
	Status         portSuggestionStatus `json:"status"`
	ExistingTunnel *tunnelRef           `json:"existingTunnel,omitempty"`
}

func (s *Server) handleListWorkspacePortSuggestions(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	if _, err := s.db.GetWorkspace(workspaceID); err != nil {
		writeDBError(w, err, "workspace")
		return
	}

	raw := s.portSuggest.ListWorkspace(workspaceID)
	out := make([]workspacePortSuggestion, 0, len(raw))
	for _, suggestion := range raw {
		row := workspacePortSuggestion{
			Port:        suggestion.Port,
			Sources:     suggestion.Sources,
			FirstSeenAt: suggestion.FirstSeenAt,
			LastSeenAt:  suggestion.LastSeenAt,
			Status:      portSuggestionStatusSuggested,
		}

		if existing := s.tunnels.FindByPort(suggestion.Port); existing != nil {
			row.ExistingTunnel = mapTunnelRef(*existing, s)
			if existing.WorkspaceID == workspaceID {
				row.Status = portSuggestionStatusAlreadyTunneledWorkspace
			} else {
				row.Status = portSuggestionStatusAlreadyTunneledOther
			}
		}

		out = append(out, row)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"suggestions": out,
	})
}

func (s *Server) handleScanWorkspacePorts(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	if _, err := s.db.GetWorkspace(workspaceID); err != nil {
		writeDBError(w, err, "workspace")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	result, err := s.portSuggest.ScanWorkspace(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, portsuggest.ErrRateLimited) {
			writeError(w, http.StatusTooManyRequests, "scan rate limited")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func mapTunnelRef(info tunnel.TunnelInfo, s *Server) *tunnelRef {
	ref := &tunnelRef{
		ID:          info.ID,
		WorkspaceID: info.WorkspaceID,
		ProjectID:   info.ProjectID,
		Port:        info.Port,
		URL:         info.URL,
		Status:      string(info.Status),
	}

	if workspace, err := s.db.GetWorkspace(info.WorkspaceID); err == nil {
		ref.WorkspaceName = workspace.Name
	}
	return ref
}
