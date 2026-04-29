package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

type createConversationRequest struct {
	Title              string  `json:"title"`
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	Provider           string  `json:"provider,omitempty"`
}

type updateConversationRequest struct {
	Title              *string `json:"title,omitempty"`
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	Status             *string `json:"status,omitempty"`
	Summary            *string `json:"summary,omitempty"`
}

type forkConversationRequest struct {
	Title              *string `json:"title,omitempty"`
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
}

type conversationWorkspaceRequest struct {
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	Reason             string  `json:"reason,omitempty"`
}

type conversationLifecycleRequest struct {
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
}

type piStatusResponse struct {
	Installed       bool                   `json:"installed"`
	Version         *string                `json:"version,omitempty"`
	AgentDir        string                 `json:"agentDir"`
	AuthPath        string                 `json:"authPath"`
	ModelsPath      string                 `json:"modelsPath"`
	SettingsPath    string                 `json:"settingsPath"`
	AuthConfigured  bool                   `json:"authConfigured"`
	AuthProviders   []piAuthProvider       `json:"authProviders,omitempty"`
	CustomProviders []piCustomProviderInfo `json:"customProviders,omitempty"`
	LoadWarnings    []string               `json:"loadWarnings,omitempty"`
}

type piAuthProvider struct {
	Provider string `json:"provider"`
	Type     string `json:"type"`
}

type piCustomProviderInfo struct {
	ID         string `json:"id"`
	ModelCount int    `json:"modelCount"`
}

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	var projectID *string
	if raw := strings.TrimSpace(r.URL.Query().Get("projectId")); raw != "" {
		projectID = &raw
	}
	status, ok := parseConversationStatusQuery(w, r, "status")
	if !ok {
		return
	}
	excludeStatus, ok := parseConversationStatusQuery(w, r, "excludeStatus")
	if !ok {
		return
	}
	limit, ok := parseConversationListLimit(w, r)
	if !ok {
		return
	}
	conversations, err := s.db.ListConversationsWithOptions(db.ListConversationOptions{
		ProjectID:     projectID,
		Query:         strings.TrimSpace(r.URL.Query().Get("q")),
		Status:        status,
		ExcludeStatus: excludeStatus,
		Provider:      strings.TrimSpace(r.URL.Query().Get("provider")),
		Limit:         limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list conversations")
		return
	}
	writeJSON(w, http.StatusOK, conversations)
}

func (s *Server) handleListProjectConversations(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	if _, err := s.db.GetProject(projectID); err != nil {
		writeDBError(w, err, "project")
		return
	}
	status, ok := parseConversationStatusQuery(w, r, "status")
	if !ok {
		return
	}
	excludeStatus, ok := parseConversationStatusQuery(w, r, "excludeStatus")
	if !ok {
		return
	}
	limit, ok := parseConversationListLimit(w, r)
	if !ok {
		return
	}
	conversations, err := s.db.ListConversationsWithOptions(db.ListConversationOptions{
		ProjectID:     &projectID,
		Query:         strings.TrimSpace(r.URL.Query().Get("q")),
		Status:        status,
		ExcludeStatus: excludeStatus,
		Provider:      strings.TrimSpace(r.URL.Query().Get("provider")),
		Limit:         limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list conversations")
		return
	}
	writeJSON(w, http.StatusOK, conversations)
}

func parseConversationStatusQuery(w http.ResponseWriter, r *http.Request, key string) (*db.ConversationStatus, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil, true
	}
	parsed := db.ConversationStatus(raw)
	switch parsed {
	case db.ConversationStatusActive, db.ConversationStatusPaused, db.ConversationStatusCompleted, db.ConversationStatusArchived:
		return &parsed, true
	default:
		writeError(w, http.StatusBadRequest, "invalid conversation "+key)
		return nil, false
	}
}

func parseConversationListLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("limit"))
	if raw == "" {
		return 0, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		writeError(w, http.StatusBadRequest, "invalid conversation limit")
		return 0, false
	}
	return limit, true
}

func (s *Server) handleForkConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	current, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}

	var req forkConversationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	targetWorkspaceID := current.CurrentWorkspaceID
	if req.CurrentWorkspaceID != nil {
		targetWorkspaceID, err = s.resolveConversationWorkspaceID(current.ProjectID, req.CurrentWorkspaceID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	title := strings.TrimSpace(current.Title + " fork")
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		title = strings.TrimSpace(*req.Title)
	}

	forked, err := s.db.CreateConversation(db.CreateConversationInput{
		ProjectID:            current.ProjectID,
		CurrentWorkspaceID:   targetWorkspaceID,
		ParentConversationID: &current.ID,
		Provider:             current.Provider,
		Title:                title,
		Status:               db.ConversationStatusActive,
		PreferredSurface:     current.PreferredSurface,
		Summary:              current.Summary,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fork conversation")
		return
	}
	if current.Provider == "pi" && current.ProviderSessionID != nil && strings.TrimSpace(*current.ProviderSessionID) != "" {
		_, sourceWorkDir, err := s.conversationContext(current.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		_, targetWorkDir, err := s.conversationContext(forked.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, forkedPiSession, err := s.pi.ForkCurrent(current, forked, sourceWorkDir, targetWorkDir); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		} else if forkedPiSession {
			if refreshed, err := s.db.GetConversation(forked.ID); err == nil {
				forked = refreshed
			}
		}
	}
	writeJSON(w, http.StatusCreated, forked)
}

func (s *Server) handleCreateProjectConversation(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	if _, err := s.db.GetProject(projectID); err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req createConversationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	workspaceID, err := s.resolveConversationWorkspaceID(projectID, req.CurrentWorkspaceID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	conversation, err := s.db.CreateConversation(db.CreateConversationInput{
		ProjectID:          projectID,
		CurrentWorkspaceID: workspaceID,
		Provider:           defaultProvider(req.Provider),
		Title:              title,
		Status:             db.ConversationStatusActive,
		PreferredSurface:   db.ConversationSurfaceChat,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create conversation")
		return
	}
	writeJSON(w, http.StatusCreated, conversation)
}

func (s *Server) handleGetConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	writeJSON(w, http.StatusOK, conversation)
}

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	if _, err := s.db.GetConversation(conversationID); err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	s.pi.StopConversation(conversationID)
	if err := s.db.DeleteConversation(conversationID); err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListConversationWorkspaceLinks(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	if _, err := s.db.GetConversation(conversationID); err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	links, err := s.db.ListConversationWorkspaceLinks(conversationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list conversation workspace history")
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleUpdateConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	current, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}

	var req updateConversationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	input := db.UpdateConversationInput{
		Title:   req.Title,
		Summary: req.Summary,
	}
	if req.Status != nil {
		status := db.ConversationStatus(strings.TrimSpace(*req.Status))
		switch status {
		case db.ConversationStatusActive, db.ConversationStatusPaused, db.ConversationStatusCompleted, db.ConversationStatusArchived:
			if !isAllowedConversationTransition(current.Status, status) && current.Status != status {
				writeError(w, http.StatusConflict, "invalid conversation lifecycle transition")
				return
			}
			input.Status = &status
			if status == db.ConversationStatusArchived {
				now := time.Now().UTC()
				input.ArchivedAt = &now
			} else {
				input.ArchivedAt = nil
			}
		default:
			writeError(w, http.StatusBadRequest, "invalid conversation status")
			return
		}
	}

	var workspaceID *string
	if req.CurrentWorkspaceID != nil {
		workspaceID, err = s.resolveConversationWorkspaceID(current.ProjectID, req.CurrentWorkspaceID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	updated, err := s.db.UpdateConversation(conversationID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update conversation")
		return
	}
	if req.CurrentWorkspaceID != nil {
		updated, err = s.db.SetConversationWorkspace(conversationID, workspaceID, "updated")
		if err != nil {
			writeDBError(w, err, "conversation")
			return
		}
	}
	if req.CurrentWorkspaceID != nil || (input.Status != nil && *input.Status != db.ConversationStatusActive) {
		s.pi.StopConversation(conversationID)
	} else if req.Title != nil {
		s.pi.SetSessionName(conversationID, updated.Title)
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleSwitchConversationWorkspace(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	conversation, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}

	var req conversationWorkspaceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	workspaceID, err := s.resolveConversationWorkspaceID(conversation.ProjectID, req.CurrentWorkspaceID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, err := s.db.SetConversationWorkspace(conversationID, workspaceID, fallbackReason(req.Reason))
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	s.pi.StopConversation(conversationID)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handlePauseConversation(w http.ResponseWriter, r *http.Request) {
	s.transitionConversationStatus(w, r, db.ConversationStatusPaused)
}

func (s *Server) handleResumeConversation(w http.ResponseWriter, r *http.Request) {
	s.transitionConversationStatus(w, r, db.ConversationStatusActive)
}

func (s *Server) handleMarkConversationRead(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	updated, err := s.db.MarkConversationRead(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleMarkConversationUnread(w http.ResponseWriter, r *http.Request) {
	conversationID := urlParam(r, "id")
	updated, err := s.db.MarkConversationUnread(conversationID, time.Now().UTC())
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleCompleteConversation(w http.ResponseWriter, r *http.Request) {
	s.transitionConversationStatus(w, r, db.ConversationStatusCompleted)
}

func (s *Server) handleArchiveConversation(w http.ResponseWriter, r *http.Request) {
	s.transitionConversationStatus(w, r, db.ConversationStatusArchived)
}

func (s *Server) handlePiStatus(w http.ResponseWriter, r *http.Request) {
	status := inspectPiStatus()
	writeJSON(w, http.StatusOK, status)
}

func defaultProvider(value string) string {
	if strings.TrimSpace(value) == "" {
		return "pi"
	}
	return strings.TrimSpace(value)
}

func (s *Server) transitionConversationStatus(w http.ResponseWriter, r *http.Request, nextStatus db.ConversationStatus) {
	conversationID := urlParam(r, "id")
	conversation, err := s.db.GetConversation(conversationID)
	if err != nil {
		writeDBError(w, err, "conversation")
		return
	}

	var req conversationLifecycleRequest
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	if !isAllowedConversationTransition(conversation.Status, nextStatus) {
		writeError(w, http.StatusConflict, "invalid conversation lifecycle transition")
		return
	}

	if req.CurrentWorkspaceID != nil {
		workspaceID, err := s.resolveConversationWorkspaceID(conversation.ProjectID, req.CurrentWorkspaceID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := s.db.SetConversationWorkspace(conversationID, workspaceID, lifecycleWorkspaceReason(nextStatus)); err != nil {
			writeDBError(w, err, "conversation")
			return
		}
	}

	input := db.UpdateConversationInput{
		Status: &nextStatus,
	}
	now := time.Now().UTC()
	if nextStatus == db.ConversationStatusArchived {
		input.ArchivedAt = &now
	}
	if nextStatus == db.ConversationStatusActive {
		input.ArchivedAt = nil
	}

	updated, err := s.db.UpdateConversation(conversationID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update conversation")
		return
	}

	if nextStatus != db.ConversationStatusActive {
		s.pi.StopConversation(conversationID)
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) resolveConversationWorkspaceID(projectID string, workspaceID *string) (*string, error) {
	if workspaceID == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*workspaceID)
	if trimmed == "" {
		return nil, nil
	}
	workspace, err := s.db.GetWorkspace(trimmed)
	if err != nil {
		return nil, fmt.Errorf("workspace not found")
	}
	if workspace.ProjectID != projectID {
		return nil, fmt.Errorf("workspace must belong to the same project")
	}
	if workspace.Status != db.WorkspaceStatusActive {
		return nil, fmt.Errorf("workspace must be active")
	}
	return &workspace.ID, nil
}

func isAllowedConversationTransition(current, next db.ConversationStatus) bool {
	switch current {
	case db.ConversationStatusActive:
		return next == db.ConversationStatusPaused || next == db.ConversationStatusCompleted || next == db.ConversationStatusArchived
	case db.ConversationStatusPaused:
		return next == db.ConversationStatusActive || next == db.ConversationStatusCompleted || next == db.ConversationStatusArchived
	case db.ConversationStatusCompleted:
		return next == db.ConversationStatusActive || next == db.ConversationStatusArchived
	case db.ConversationStatusArchived:
		return false
	default:
		return false
	}
}

func lifecycleWorkspaceReason(status db.ConversationStatus) string {
	switch status {
	case db.ConversationStatusActive:
		return "resumed"
	case db.ConversationStatusPaused:
		return "paused"
	case db.ConversationStatusCompleted:
		return "completed"
	case db.ConversationStatusArchived:
		return "archived"
	default:
		return "switched"
	}
}

func fallbackReason(value string) string {
	if strings.TrimSpace(value) == "" {
		return "switched"
	}
	return strings.TrimSpace(value)
}

func inspectPiStatus() piStatusResponse {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	agentDir := filepath.Join(home, ".pi", "agent")
	authPath := filepath.Join(agentDir, "auth.json")
	modelsPath := filepath.Join(agentDir, "models.json")
	settingsPath := filepath.Join(agentDir, "settings.json")

	status := piStatusResponse{
		Installed:    false,
		AgentDir:     agentDir,
		AuthPath:     authPath,
		ModelsPath:   modelsPath,
		SettingsPath: settingsPath,
		LoadWarnings: []string{},
	}

	if piPath, err := exec.LookPath("pi"); err == nil {
		status.Installed = true
		cmd := exec.Command(piPath, "--version")
		if output, err := cmd.CombinedOutput(); err == nil {
			version := strings.TrimSpace(string(output))
			if version != "" {
				status.Version = &version
			}
		} else {
			status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to read pi version: %v", err))
		}
	}

	if authRaw, err := os.ReadFile(authPath); err == nil {
		var authData map[string]map[string]any
		if err := json.Unmarshal(authRaw, &authData); err != nil {
			status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to parse auth.json: %v", err))
		} else {
			providers := make([]piAuthProvider, 0, len(authData))
			for provider, value := range authData {
				credType := "unknown"
				if rawType, ok := value["type"].(string); ok && rawType != "" {
					credType = rawType
				}
				providers = append(providers, piAuthProvider{Provider: provider, Type: credType})
			}
			sort.Slice(providers, func(i, j int) bool {
				return providers[i].Provider < providers[j].Provider
			})
			status.AuthProviders = providers
			status.AuthConfigured = len(providers) > 0
		}
	} else if !os.IsNotExist(err) {
		status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to read auth.json: %v", err))
	}

	if modelsRaw, err := os.ReadFile(modelsPath); err == nil {
		var modelsData struct {
			Providers map[string]struct {
				Models []map[string]any `json:"models"`
			} `json:"providers"`
		}
		if err := json.Unmarshal(modelsRaw, &modelsData); err != nil {
			status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to parse models.json: %v", err))
		} else {
			customProviders := make([]piCustomProviderInfo, 0, len(modelsData.Providers))
			for providerID, provider := range modelsData.Providers {
				customProviders = append(customProviders, piCustomProviderInfo{
					ID:         providerID,
					ModelCount: len(provider.Models),
				})
			}
			sort.Slice(customProviders, func(i, j int) bool {
				return customProviders[i].ID < customProviders[j].ID
			})
			status.CustomProviders = customProviders
		}
	} else if !os.IsNotExist(err) {
		status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to read models.json: %v", err))
	}

	if len(status.LoadWarnings) == 0 {
		status.LoadWarnings = nil
	}
	return status
}
