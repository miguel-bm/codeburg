package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// Git operation response types

type GitFileEntry struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // M, A, D, R, C, etc.
	Additions int    `json:"additions,omitempty"`
	Deletions int    `json:"deletions,omitempty"`
}

type GitStatusResponse struct {
	Branch    string         `json:"branch"`
	Ahead     int            `json:"ahead"`
	Behind    int            `json:"behind"`
	Staged    []GitFileEntry `json:"staged"`
	Unstaged  []GitFileEntry `json:"unstaged"`
	Untracked []string       `json:"untracked"`
}

type GitDiffResponse struct {
	Diff string `json:"diff"`
}

type GitStageRequest struct {
	Files []string `json:"files"`
}

type GitCommitRequest struct {
	Message string `json:"message"`
	Amend   bool   `json:"amend,omitempty"`
}

type GitCommitResponse struct {
	Hash    string `json:"hash"`
	Message string `json:"message"`
}

type GitStashRequest struct {
	Action string `json:"action"` // "push", "pop", "list"
}

type GitStashEntry struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

type GitStashResponse struct {
	Entries []GitStashEntry `json:"entries,omitempty"`
}

// resolveTaskWorkDir resolves a task's working directory (worktree or project path).
// Returns the workDir, the task, or writes an error response and returns empty string.
func (s *Server) resolveTaskWorkDir(w http.ResponseWriter, r *http.Request) (string, bool) {
	taskID := urlParam(r, "id")

	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return "", false
	}

	if task.WorktreePath == nil || *task.WorktreePath == "" {
		writeError(w, http.StatusBadRequest, "task has no worktree")
		return "", false
	}

	return *task.WorktreePath, true
}

// runGit executes a git command in the given directory with a 5s timeout.
func runGit(dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %s: %w", args[0], strings.TrimSpace(string(out)), err)
	}
	return string(out), nil
}

func (s *Server) handleGitStatus(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	out, err := runGit(workDir, "status", "--porcelain=v1", "-b")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := parseGitStatus(out)

	// Merge in diff stats from --numstat for staged and unstaged files
	mergeNumstat(workDir, &resp)

	writeJSON(w, http.StatusOK, resp)
}

// parseGitStatus parses `git status --porcelain=v1 -b` output.
func parseGitStatus(output string) GitStatusResponse {
	resp := GitStatusResponse{
		Staged:    []GitFileEntry{},
		Unstaged:  []GitFileEntry{},
		Untracked: []string{},
	}

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}

		// Branch header line: ## branch...tracking [ahead N, behind M]
		if strings.HasPrefix(line, "## ") {
			parseBranchLine(line, &resp)
			continue
		}

		if len(line) < 4 {
			continue
		}

		x := line[0] // staged status
		y := line[1] // unstaged status
		path := line[3:]

		// Handle renames: "R  old -> new"
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}

		// Untracked
		if x == '?' && y == '?' {
			resp.Untracked = append(resp.Untracked, path)
			continue
		}

		// Staged changes (index column)
		if x != ' ' && x != '?' {
			resp.Staged = append(resp.Staged, GitFileEntry{
				Path:   path,
				Status: string(x),
			})
		}

		// Unstaged changes (work tree column)
		if y != ' ' && y != '?' {
			resp.Unstaged = append(resp.Unstaged, GitFileEntry{
				Path:   path,
				Status: string(y),
			})
		}
	}

	return resp
}

// parseBranchLine parses the ## header from porcelain output.
func parseBranchLine(line string, resp *GitStatusResponse) {
	// Format: "## branch...tracking [ahead N, behind M]"
	// or:     "## branch"
	// or:     "## No commits yet on branch"
	header := strings.TrimPrefix(line, "## ")

	// Extract ahead/behind from brackets
	if idx := strings.Index(header, " ["); idx >= 0 {
		bracket := header[idx+2 : len(header)-1] // strip "[ " and "]"
		header = header[:idx]

		for _, part := range strings.Split(bracket, ", ") {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, "ahead ") {
				fmt.Sscanf(part, "ahead %d", &resp.Ahead)
			} else if strings.HasPrefix(part, "behind ") {
				fmt.Sscanf(part, "behind %d", &resp.Behind)
			}
		}
	}

	// Extract branch name (before "...")
	if idx := strings.Index(header, "..."); idx >= 0 {
		resp.Branch = header[:idx]
	} else {
		resp.Branch = header
	}
}

// parseNumstat parses `git diff --numstat` output into a map of path -> (additions, deletions).
func parseNumstat(output string) map[string][2]int {
	stats := make(map[string][2]int)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		// Format: "additions\tdeletions\tpath"
		// Binary files show "-\t-\tpath"
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		if parts[0] == "-" {
			continue // binary file
		}
		var adds, dels int
		fmt.Sscanf(parts[0], "%d", &adds)
		fmt.Sscanf(parts[1], "%d", &dels)
		// Handle renames: "old => new" or "{old => new}/path"
		path := parts[2]
		if idx := strings.Index(path, " => "); idx >= 0 {
			// Simple rename: "old => new"
			path = path[idx+4:]
		}
		stats[path] = [2]int{adds, dels}
	}
	return stats
}

// mergeNumstat runs git diff --numstat for staged and unstaged changes
// and merges the stats into the response's file entries.
func mergeNumstat(workDir string, resp *GitStatusResponse) {
	// Staged numstat
	if len(resp.Staged) > 0 {
		out, err := runGit(workDir, "diff", "--cached", "--numstat")
		if err == nil {
			stats := parseNumstat(out)
			for i := range resp.Staged {
				if s, ok := stats[resp.Staged[i].Path]; ok {
					resp.Staged[i].Additions = s[0]
					resp.Staged[i].Deletions = s[1]
				}
			}
		}
	}

	// Unstaged numstat
	if len(resp.Unstaged) > 0 {
		out, err := runGit(workDir, "diff", "--numstat")
		if err == nil {
			stats := parseNumstat(out)
			for i := range resp.Unstaged {
				if s, ok := stats[resp.Unstaged[i].Path]; ok {
					resp.Unstaged[i].Additions = s[0]
					resp.Unstaged[i].Deletions = s[1]
				}
			}
		}
	}
}

func (s *Server) handleGitDiff(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	file := r.URL.Query().Get("file")
	staged := r.URL.Query().Get("staged") == "true"
	base := r.URL.Query().Get("base") == "true"

	var args []string
	if base {
		// Diff against merge-base with default branch
		taskID := urlParam(r, "id")
		task, _ := s.db.GetTask(taskID)
		project, _ := s.db.GetProject(task.ProjectID)
		baseBranch := "main"
		if project != nil {
			baseBranch = project.DefaultBranch
		}

		// Get merge-base
		mbOut, err := runGit(workDir, "merge-base", baseBranch, "HEAD")
		if err != nil {
			// Fallback: diff against the base branch directly
			args = []string{"diff", baseBranch + "...HEAD"}
		} else {
			mergeBase := strings.TrimSpace(mbOut)
			args = []string{"diff", mergeBase, "HEAD"}
		}
	} else if staged {
		args = []string{"diff", "--cached"}
	} else {
		args = []string{"diff"}
	}

	if file != "" {
		args = append(args, "--", file)
	}

	out, err := runGit(workDir, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, GitDiffResponse{Diff: out})
}

func (s *Server) handleGitStage(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitStageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files is required")
		return
	}

	args := append([]string{"add", "--"}, req.Files...)
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitUnstage(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitStageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files is required")
		return
	}

	args := append([]string{"reset", "HEAD", "--"}, req.Files...)
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitCommit(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitCommitRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Message == "" && !req.Amend {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	args := []string{"commit"}
	if req.Amend {
		args = append(args, "--amend")
		if req.Message == "" {
			args = append(args, "--no-edit")
		}
	}
	if req.Message != "" {
		args = append(args, "-m", req.Message)
	}

	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Invalidate diff stats cache for this task
	taskID := urlParam(r, "id")
	s.diffStatsCache.Delete(taskID)

	// Get the commit hash
	hashOut, err := runGit(workDir, "rev-parse", "--short", "HEAD")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Get commit message
	msgOut, err := runGit(workDir, "log", "-1", "--format=%s")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, GitCommitResponse{
		Hash:    strings.TrimSpace(hashOut),
		Message: strings.TrimSpace(msgOut),
	})
}

func (s *Server) handleGitStash(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitStashRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	switch req.Action {
	case "push":
		if _, err := runGit(workDir, "stash", "push"); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case "pop":
		if _, err := runGit(workDir, "stash", "pop"); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case "list":
		out, err := runGit(workDir, "stash", "list")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		entries := []GitStashEntry{}
		scanner := bufio.NewScanner(strings.NewReader(out))
		idx := 0
		for scanner.Scan() {
			line := scanner.Text()
			// Format: "stash@{0}: WIP on branch: message"
			if colonIdx := strings.Index(line, ": "); colonIdx >= 0 {
				entries = append(entries, GitStashEntry{
					Index:   idx,
					Message: line[colonIdx+2:],
				})
			}
			idx++
		}

		writeJSON(w, http.StatusOK, GitStashResponse{Entries: entries})

	default:
		writeError(w, http.StatusBadRequest, "invalid action: must be push, pop, or list")
	}
}
