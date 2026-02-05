package api

import (
	"database/sql"
	"net/http"
	"os"

	"github.com/miguel/codeburg/internal/db"
)

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.db.ListProjects()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}

	if projects == nil {
		projects = []*db.Project{}
	}

	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var input db.CreateProjectInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if input.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if input.Path == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	// Validate path exists
	info, err := os.Stat(input.Path)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusBadRequest, "path does not exist")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a directory")
		return
	}

	// Check if it's a git repo
	gitPath := input.Path + "/.git"
	if _, err := os.Stat(gitPath); os.IsNotExist(err) {
		writeError(w, http.StatusBadRequest, "path is not a git repository")
		return
	}

	project, err := s.db.CreateProject(input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create project")
		return
	}

	writeJSON(w, http.StatusCreated, project)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	project, err := s.db.GetProject(id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get project")
		return
	}

	writeJSON(w, http.StatusOK, project)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	var input db.UpdateProjectInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate path if provided
	if input.Path != nil {
		info, err := os.Stat(*input.Path)
		if err != nil {
			if os.IsNotExist(err) {
				writeError(w, http.StatusBadRequest, "path does not exist")
				return
			}
			writeError(w, http.StatusBadRequest, "invalid path")
			return
		}
		if !info.IsDir() {
			writeError(w, http.StatusBadRequest, "path must be a directory")
			return
		}
	}

	project, err := s.db.UpdateProject(id, input)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update project")
		return
	}

	writeJSON(w, http.StatusOK, project)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	if err := s.db.DeleteProject(id); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
