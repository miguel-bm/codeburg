package api

import (
	"bufio"
	"encoding/json"
	"log/slog"
	"net/http"
	"os/exec"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/miguel/codeburg/internal/justfile"
)

var justMgr = justfile.NewManager()

// handleListJustRecipes lists available recipes for a project
func (s *Server) handleListJustRecipes(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	recipes, err := justMgr.ListRecipes(project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if recipes == nil {
		recipes = []justfile.Recipe{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"hasJustfile": justMgr.HasJustfile(project.Path),
		"recipes":     recipes,
	})
}

// handleRunJustRecipe runs a recipe for a project
func (s *Server) handleRunJustRecipe(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	recipe := chi.URLParam(r, "recipe")

	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	// Parse optional args from body
	var input struct {
		Args []string `json:"args"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&input)
	}

	result, err := justMgr.Run(project.Path, recipe, input.Args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleRunJustRecipeInTask runs a recipe in the task's worktree
func (s *Server) handleRunJustRecipeInTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	recipe := chi.URLParam(r, "recipe")

	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Determine the working directory
	workDir := ""
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	} else {
		// Fall back to project path
		project, err := s.db.GetProject(task.ProjectID)
		if err != nil {
			writeDBError(w, err, "project")
			return
		}
		workDir = project.Path
	}

	// Parse optional args from body
	var input struct {
		Args []string `json:"args"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&input)
	}

	result, err := justMgr.Run(workDir, recipe, input.Args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleStreamJustRecipe runs a recipe with streaming output via SSE
func (s *Server) handleStreamJustRecipe(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	recipe := chi.URLParam(r, "recipe")

	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Determine the working directory
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

	// Parse optional args
	args := r.URL.Query()["arg"]

	// Build command
	cmdArgs := append([]string{recipe}, args...)
	cmd := exec.Command("just", cmdArgs...)
	cmd.Dir = workDir

	// Get output pipes
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Start command
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Set up SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Funnel all output through a single channel to avoid concurrent ResponseWriter writes
	type sseEvent struct {
		event string
		data  interface{}
	}
	events := make(chan sseEvent, 64)

	// Read stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			events <- sseEvent{"stdout", scanner.Text()}
		}
	}()

	// Read stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			events <- sseEvent{"stderr", scanner.Text()}
		}
	}()

	// Wait for command to complete, then close the events channel.
	// cmd.Wait blocks until stdout/stderr are fully read, so all output
	// events are sent before the "done" event.
	go func() {
		err := cmd.Wait()
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			}
		}
		events <- sseEvent{"done", map[string]int{"exitCode": exitCode}}
		close(events)
	}()

	// Drain events from the single goroutine that owns the ResponseWriter
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			sendSSE(w, flusher, ev.event, ev.data)
		case <-r.Context().Done():
			cmd.Process.Kill()
			return
		}
	}
}

func sendSSE(w http.ResponseWriter, flusher http.Flusher, event string, data interface{}) {
	var dataStr string
	switch v := data.(type) {
	case string:
		dataStr = v
	default:
		bytes, _ := json.Marshal(v)
		dataStr = string(bytes)
	}

	// Escape newlines for SSE
	dataStr = strings.ReplaceAll(dataStr, "\n", "\ndata: ")

	w.Write([]byte("event: " + event + "\n"))
	w.Write([]byte("data: " + dataStr + "\n\n"))
	flusher.Flush()
}

// handleListTaskJustRecipes lists recipes available in a task's worktree
func (s *Server) handleListTaskJustRecipes(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")

	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	// Determine the working directory
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

	recipes, err := justMgr.ListRecipes(workDir)
	if err != nil {
		slog.Error("failed to list recipes", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if recipes == nil {
		recipes = []justfile.Recipe{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"hasJustfile": justMgr.HasJustfile(workDir),
		"recipes":     recipes,
	})
}
