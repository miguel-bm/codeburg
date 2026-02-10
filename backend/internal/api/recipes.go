package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/recipes"
)

var recipesMgr = recipes.NewManager()

// handleListTaskRecipes lists discovered recipes from common sources in a task worktree.
func (s *Server) handleListTaskRecipes(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	workDir := ""
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	} else {
		project, err := s.db.GetProject(task.ProjectID)
		if err != nil {
			writeDBError(w, err, "project")
			return
		}
		workDir = project.Path
	}

	discovered, err := recipesMgr.List(workDir)
	if err != nil {
		slog.Error("failed to list task recipes", "taskID", taskID, "workDir", workDir, "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sources := make([]string, 0, 4)
	seenSources := map[string]struct{}{}
	for _, recipe := range discovered {
		if _, ok := seenSources[recipe.Source]; ok {
			continue
		}
		seenSources[recipe.Source] = struct{}{}
		sources = append(sources, recipe.Source)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"recipes": discovered,
		"sources": sources,
	})
}
