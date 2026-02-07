package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/miguel/codeburg/internal/db"
	"github.com/miguel/codeburg/internal/gitclone"
)

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.db.ListProjects()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}

	writeJSON(w, http.StatusOK, projects)
}

// createProjectRequest extends db.CreateProjectInput with an optional GitHub URL.
type createProjectRequest struct {
	Name           string   `json:"name"`
	Path           string   `json:"path"`
	GitHubURL      string   `json:"githubUrl"`
	GitOrigin      *string  `json:"gitOrigin,omitempty"`
	DefaultBranch  *string  `json:"defaultBranch,omitempty"`
	SymlinkPaths   []string `json:"symlinkPaths,omitempty"`
	SetupScript    *string  `json:"setupScript,omitempty"`
	TeardownScript *string  `json:"teardownScript,omitempty"`
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var input db.CreateProjectInput

	if req.GitHubURL != "" {
		// Clone from GitHub URL
		if !gitclone.IsGitHubURL(req.GitHubURL) {
			writeError(w, http.StatusBadRequest, "invalid GitHub URL")
			return
		}

		name := req.Name
		if name == "" {
			name = gitclone.ParseRepoName(req.GitHubURL)
		}
		if name == "" {
			writeError(w, http.StatusBadRequest, "could not determine project name from URL")
			return
		}

		result, err := gitclone.Clone(s.gitclone, req.GitHubURL, name)
		if err != nil {
			if strings.Contains(err.Error(), "destination already exists") {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "clone failed: "+err.Error())
			return
		}

		normalized := gitclone.NormalizeGitHubURL(req.GitHubURL)
		input = db.CreateProjectInput{
			Name:           name,
			Path:           result.Path,
			GitOrigin:      &normalized,
			DefaultBranch:  &result.DefaultBranch,
			SymlinkPaths:   req.SymlinkPaths,
			SetupScript:    req.SetupScript,
			TeardownScript: req.TeardownScript,
		}
	} else {
		// Local path flow (existing behavior)
		if req.Name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		if req.Path == "" {
			writeError(w, http.StatusBadRequest, "path is required")
			return
		}

		info, err := os.Stat(req.Path)
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

		gitPath := req.Path + "/.git"
		if _, err := os.Stat(gitPath); os.IsNotExist(err) {
			writeError(w, http.StatusBadRequest, "path is not a git repository")
			return
		}

		input = db.CreateProjectInput{
			Name:           req.Name,
			Path:           req.Path,
			GitOrigin:      req.GitOrigin,
			DefaultBranch:  req.DefaultBranch,
			SymlinkPaths:   req.SymlinkPaths,
			SetupScript:    req.SetupScript,
			TeardownScript: req.TeardownScript,
		}
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
		writeDBError(w, err, "project")
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
		writeDBError(w, err, "project")
		return
	}

	writeJSON(w, http.StatusOK, project)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")

	if err := s.db.DeleteProject(id); err != nil {
		writeDBError(w, err, "project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
