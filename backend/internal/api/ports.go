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
	portSuggestionStatusSuggested            portSuggestionStatus = "suggested"
	portSuggestionStatusAlreadyTunneledTask  portSuggestionStatus = "already_tunneled_this_task"
	portSuggestionStatusAlreadyTunneledOther portSuggestionStatus = "already_tunneled_other_task"
)

type tunnelRef struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	TaskTitle string `json:"taskTitle,omitempty"`
	Port      int    `json:"port"`
	URL       string `json:"url"`
}

type taskPortSuggestion struct {
	Port           int                  `json:"port"`
	Sources        []string             `json:"sources"`
	FirstSeenAt    time.Time            `json:"firstSeenAt"`
	LastSeenAt     time.Time            `json:"lastSeenAt"`
	Status         portSuggestionStatus `json:"status"`
	ExistingTunnel *tunnelRef           `json:"existingTunnel,omitempty"`
}

// handleListTaskPortSuggestions lists detected/suggested ports for a task.
func (s *Server) handleListTaskPortSuggestions(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	_, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	raw := s.portSuggest.ListTask(taskID)
	out := make([]taskPortSuggestion, 0, len(raw))
	for _, suggestion := range raw {
		row := taskPortSuggestion{
			Port:        suggestion.Port,
			Sources:     suggestion.Sources,
			FirstSeenAt: suggestion.FirstSeenAt,
			LastSeenAt:  suggestion.LastSeenAt,
			Status:      portSuggestionStatusSuggested,
		}

		if existing := s.tunnels.FindByPort(suggestion.Port); existing != nil {
			row.ExistingTunnel = mapTunnelRef(*existing, s)
			if existing.TaskID == taskID {
				row.Status = portSuggestionStatusAlreadyTunneledTask
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

// handleScanTaskPorts triggers an on-demand listener scan.
func (s *Server) handleScanTaskPorts(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	_, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	result, err := s.portSuggest.ScanTask(ctx, taskID)
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
		ID:     info.ID,
		TaskID: info.TaskID,
		Port:   info.Port,
		URL:    info.URL,
	}

	if task, err := s.db.GetTask(info.TaskID); err == nil {
		ref.TaskTitle = task.Title
	}
	return ref
}
