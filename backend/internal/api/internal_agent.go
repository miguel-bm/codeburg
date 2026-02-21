package api

import (
	"errors"
	"net/http"
	"net/netip"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
)

type internalAgentProjectRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type internalAgentTaskCreateRequest struct {
	Project     string `json:"project"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Dedupe      bool   `json:"dedupe,omitempty"`
}

type internalAgentTaskCreateResponse struct {
	Deduped bool                    `json:"deduped"`
	Task    *db.Task                `json:"task"`
	Project internalAgentProjectRef `json:"project"`
}

func (s *Server) loopbackOnlyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remote := parseRemoteIP(r.RemoteAddr)
		if remote == "" {
			writeError(w, http.StatusForbidden, "internal endpoint requires loopback client")
			return
		}
		addr, err := netip.ParseAddr(remote)
		if err != nil || !addr.IsLoopback() {
			writeError(w, http.StatusForbidden, "internal endpoint requires loopback client")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleInternalAgentListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.db.ListProjects()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleInternalAgentCreateTask(w http.ResponseWriter, r *http.Request) {
	var req internalAgentTaskCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(req.Project) == "" {
		writeError(w, http.StatusBadRequest, "project is required")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	projects, err := s.db.ListProjects()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}
	project, err := resolveProjectBySelector(projects, req.Project)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	if req.Dedupe {
		filter := db.TaskFilter{ProjectID: &project.ID}
		tasks, err := s.db.ListTasks(filter)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list tasks")
			return
		}
		incoming := normalizeTitle(req.Title)
		for _, task := range tasks {
			if normalizeTitle(task.Title) == incoming {
				writeJSON(w, http.StatusOK, internalAgentTaskCreateResponse{
					Deduped: true,
					Task:    task,
					Project: internalAgentProjectRef{ID: project.ID, Name: project.Name},
				})
				return
			}
		}
	}

	createInput := db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     strings.TrimSpace(req.Title),
	}
	if desc := strings.TrimSpace(req.Description); desc != "" {
		createInput.Description = &desc
	}

	task, err := s.db.CreateTask(createInput)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create task")
		return
	}

	writeJSON(w, http.StatusCreated, internalAgentTaskCreateResponse{
		Deduped: false,
		Task:    task,
		Project: internalAgentProjectRef{ID: project.ID, Name: project.Name},
	})
}

func resolveProjectBySelector(projects []*db.Project, selector string) (*db.Project, error) {
	sel := strings.TrimSpace(selector)
	if sel == "" {
		return nil, db.ErrNotFound
	}

	for _, project := range projects {
		if project.ID == sel {
			return project, nil
		}
	}

	lowered := strings.ToLower(sel)
	exact := make([]*db.Project, 0, 2)
	for _, project := range projects {
		if strings.EqualFold(project.Name, lowered) || strings.EqualFold(project.Path, lowered) {
			exact = append(exact, project)
		}
	}
	if len(exact) == 1 {
		return exact[0], nil
	}
	if len(exact) > 1 {
		return nil, errors.New("project selector matches multiple projects")
	}

	fuzzy := make([]*db.Project, 0, 2)
	for _, project := range projects {
		name := strings.ToLower(project.Name)
		path := strings.ToLower(project.Path)
		if strings.Contains(name, lowered) || strings.Contains(path, lowered) {
			fuzzy = append(fuzzy, project)
		}
	}
	if len(fuzzy) == 1 {
		return fuzzy[0], nil
	}
	if len(fuzzy) > 1 {
		return nil, errors.New("project selector matches multiple projects")
	}

	return nil, db.ErrNotFound
}

func normalizeTitle(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
