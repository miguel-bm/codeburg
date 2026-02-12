package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
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

type GitRevertRequest struct {
	Tracked   []string `json:"tracked,omitempty"`
	Untracked []string `json:"untracked,omitempty"`
}

type GitCommitResponse struct {
	Hash    string `json:"hash"`
	Message string `json:"message"`
}

type GitPushRequest struct {
	Force bool `json:"force,omitempty"`
}

type GitLogEntry struct {
	Hash       string `json:"hash"`
	ShortHash  string `json:"shortHash"`
	Message    string `json:"message"`
	Body       string `json:"body,omitempty"`
	Author     string `json:"author"`
	AuthorEmail string `json:"authorEmail"`
	Date       string `json:"date"`
	FilesChanged int  `json:"filesChanged"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
}

type GitLogResponse struct {
	Commits []GitLogEntry `json:"commits"`
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

func (s *Server) handleListBranches(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	// Best-effort fetch to get latest remote refs
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	fetchCmd := exec.CommandContext(ctx, "git", "fetch", "--prune")
	fetchCmd.Dir = project.Path
	fetchCmd.Run() // ignore errors

	// List all branches (local + remote)
	out, err := runGit(project.Path, "branch", "-a", "--format=%(refname:short)")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	seen := make(map[string]bool)
	defaultBranch := project.DefaultBranch

	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		name := strings.TrimSpace(scanner.Text())
		if name == "" {
			continue
		}
		// Strip "origin/" prefix for remote branches
		if strings.HasPrefix(name, "origin/") {
			name = strings.TrimPrefix(name, "origin/")
		}
		// Skip HEAD pointer and default branch
		if name == "HEAD" || name == defaultBranch {
			continue
		}
		seen[name] = true
	}

	branches := make([]string, 0, len(seen))
	for name := range seen {
		branches = append(branches, name)
	}

	// Sort alphabetically
	sort.Strings(branches)

	writeJSON(w, http.StatusOK, branches)
}

// resolveProjectWorkDir resolves a project's working directory from URL param.
func (s *Server) resolveProjectWorkDir(w http.ResponseWriter, r *http.Request) (string, bool) {
	projectID := urlParam(r, "id")

	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return "", false
	}

	return project.Path, true
}

// gitStatus computes git status for a given work directory.
func gitStatus(workDir string) (*GitStatusResponse, error) {
	out, err := runGit(workDir, "status", "--porcelain=v1", "-b")
	if err != nil {
		return nil, err
	}

	resp := parseGitStatus(out)
	mergeNumstat(workDir, &resp)
	return &resp, nil
}

func (s *Server) handleGitStatus(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	resp, err := gitStatus(workDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleProjectGitStatus(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	resp, err := gitStatus(workDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

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
	commitHash := r.URL.Query().Get("commit")

	var args []string
	if commitHash != "" {
		// Diff for a specific commit — use diff-tree for root commit safety
		_, err := runGit(workDir, "rev-parse", "--verify", commitHash+"^")
		if err != nil {
			// Root commit: show entire tree as additions
			args = []string{"diff-tree", "--patch", "--no-commit-id", "-r", commitHash}
		} else {
			args = []string{"diff", commitHash + "^", commitHash}
		}
	} else if base {
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

func (s *Server) handleGitRevert(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitRevertRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Tracked) == 0 && len(req.Untracked) == 0 {
		writeError(w, http.StatusBadRequest, "tracked or untracked files are required")
		return
	}

	if len(req.Tracked) > 0 {
		args := append([]string{"restore", "--staged", "--worktree", "--"}, req.Tracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	if len(req.Untracked) > 0 {
		args := append([]string{"clean", "-f", "-d", "--"}, req.Untracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
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

func (s *Server) handleGitPull(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	if _, err := runGit(workDir, "pull", "--ff-only"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Invalidate diff stats cache for this task
	taskID := urlParam(r, "id")
	s.diffStatsCache.Delete(taskID)

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGitPush(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	var req GitPushRequest
	// Body is optional — ignore decode errors for backwards compat
	_ = decodeJSON(r, &req)

	args := []string{"push"}
	if req.Force {
		args = append(args, "--force-with-lease")
	}
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

// gitLog returns recent commits for the given working directory.
func gitLog(workDir string, limit int) ([]GitLogEntry, error) {
	if limit <= 0 {
		limit = 20
	}
	// Use a delimiter to reliably split fields
	const sep = "§"
	format := strings.Join([]string{"%H", "%h", "%s", "%b", "%an", "%ae", "%aI"}, sep)
	out, err := runGit(workDir, "log", fmt.Sprintf("-%d", limit), fmt.Sprintf("--format=%s", format))
	if err != nil {
		return nil, err
	}

	var commits []GitLogEntry
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, sep, 7)
		if len(parts) < 7 {
			continue
		}
		entry := GitLogEntry{
			Hash:        parts[0],
			ShortHash:   parts[1],
			Message:     parts[2],
			Body:        strings.TrimSpace(parts[3]),
			Author:      parts[4],
			AuthorEmail: parts[5],
			Date:        parts[6],
		}

		// Get diffstat for this commit
		statOut, statErr := runGit(workDir, "diff-tree", "--no-commit-id", "--numstat", "-r", entry.Hash)
		if statErr == nil {
			for _, sl := range strings.Split(strings.TrimSpace(statOut), "\n") {
				if sl == "" {
					continue
				}
				fields := strings.Fields(sl)
				if len(fields) >= 2 {
					add, _ := strconv.Atoi(fields[0])
					del, _ := strconv.Atoi(fields[1])
					entry.Additions += add
					entry.Deletions += del
					entry.FilesChanged++
				}
			}
		}

		commits = append(commits, entry)
	}
	return commits, nil
}

func (s *Server) handleGitLog(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	limit := 20
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	commits, err := gitLog(workDir, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, GitLogResponse{Commits: commits})
}

func (s *Server) handleProjectGitLog(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	limit := 20
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	commits, err := gitLog(workDir, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, GitLogResponse{Commits: commits})
}

// --- Project-level git handlers ---

func (s *Server) handleProjectGitDiff(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	file := r.URL.Query().Get("file")
	staged := r.URL.Query().Get("staged") == "true"
	commitHash := r.URL.Query().Get("commit")

	var args []string
	if commitHash != "" {
		_, err := runGit(workDir, "rev-parse", "--verify", commitHash+"^")
		if err != nil {
			args = []string{"diff-tree", "--patch", "--no-commit-id", "-r", commitHash}
		} else {
			args = []string{"diff", commitHash + "^", commitHash}
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

func (s *Server) handleProjectGitStage(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
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

func (s *Server) handleProjectGitUnstage(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
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

func (s *Server) handleProjectGitRevert(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	var req GitRevertRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Tracked) == 0 && len(req.Untracked) == 0 {
		writeError(w, http.StatusBadRequest, "tracked or untracked files are required")
		return
	}

	if len(req.Tracked) > 0 {
		args := append([]string{"restore", "--staged", "--worktree", "--"}, req.Tracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if len(req.Untracked) > 0 {
		args := append([]string{"clean", "-f", "-d", "--"}, req.Untracked...)
		if _, err := runGit(workDir, args...); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectGitCommit(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
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

	hashOut, err := runGit(workDir, "rev-parse", "--short", "HEAD")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

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

func (s *Server) handleProjectGitPull(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	if _, err := runGit(workDir, "pull", "--ff-only"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectGitPush(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	var req GitPushRequest
	_ = decodeJSON(r, &req)

	args := []string{"push"}
	if req.Force {
		args = append(args, "--force-with-lease")
	}
	if _, err := runGit(workDir, args...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectGitStash(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
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

// --- Diff content endpoints (original + modified strings for side-by-side view) ---

type GitDiffContentResponse struct {
	Original string `json:"original"`
	Modified string `json:"modified"`
}

// gitDiffContent computes the original and modified file content for a diff view.
func gitDiffContent(workDir string, file string, staged bool, base bool, baseBranch string, commitHash string) (*GitDiffContentResponse, error) {
	if file == "" {
		return nil, fmt.Errorf("file parameter is required")
	}

	absFile := filepath.Join(workDir, file)

	if commitHash != "" {
		// Show file content before and after a specific commit
		var original string
		_, err := runGit(workDir, "rev-parse", "--verify", commitHash+"^")
		if err == nil {
			original, _ = runGit(workDir, "show", commitHash+"^:"+file)
		}
		modified, _ := runGit(workDir, "show", commitHash+":"+file)
		return &GitDiffContentResponse{Original: original, Modified: modified}, nil
	}

	if base {
		// Diff against merge-base with default branch
		mergeBaseRef := baseBranch
		mbOut, err := runGit(workDir, "merge-base", baseBranch, "HEAD")
		if err == nil {
			mergeBaseRef = strings.TrimSpace(mbOut)
		}
		original, _ := runGit(workDir, "show", mergeBaseRef+":"+file)
		modified, err := os.ReadFile(absFile)
		if err != nil {
			// File might be deleted
			return &GitDiffContentResponse{Original: original, Modified: ""}, nil
		}
		return &GitDiffContentResponse{Original: original, Modified: string(modified)}, nil
	}

	// Determine file status from porcelain output
	statusOut, err := runGit(workDir, "status", "--porcelain=v1", "--", file)
	if err != nil {
		return nil, fmt.Errorf("git status: %w", err)
	}

	statusLine := strings.TrimSpace(statusOut)
	var x, y byte
	if len(statusLine) >= 2 {
		x = statusLine[0] // index status
		y = statusLine[1] // worktree status
	}

	resp := &GitDiffContentResponse{}

	if staged {
		// Staged: original = HEAD version, modified = index version
		if x == 'A' {
			// New file in index
			resp.Original = ""
			out, _ := runGit(workDir, "show", ":0:"+file)
			resp.Modified = out
		} else if x == 'D' {
			// Deleted in index
			out, _ := runGit(workDir, "show", "HEAD:"+file)
			resp.Original = out
			resp.Modified = ""
		} else {
			out, _ := runGit(workDir, "show", "HEAD:"+file)
			resp.Original = out
			out2, _ := runGit(workDir, "show", ":0:"+file)
			resp.Modified = out2
		}
	} else {
		// Unstaged changes
		if x == '?' && y == '?' {
			// Untracked file
			resp.Original = ""
			data, err := os.ReadFile(absFile)
			if err != nil {
				return nil, fmt.Errorf("read file: %w", err)
			}
			resp.Modified = string(data)
		} else if y == 'D' {
			// Deleted in worktree
			out, _ := runGit(workDir, "show", "HEAD:"+file)
			resp.Original = out
			resp.Modified = ""
		} else {
			// Modified in worktree — original is HEAD (or index if staged changes exist)
			out, _ := runGit(workDir, "show", "HEAD:"+file)
			resp.Original = out
			data, err := os.ReadFile(absFile)
			if err != nil {
				return nil, fmt.Errorf("read file: %w", err)
			}
			resp.Modified = string(data)
		}
	}

	return resp, nil
}

func (s *Server) handleGitDiffContent(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveTaskWorkDir(w, r)
	if !ok {
		return
	}

	file := r.URL.Query().Get("file")
	staged := r.URL.Query().Get("staged") == "true"
	base := r.URL.Query().Get("base") == "true"
	commitHash := r.URL.Query().Get("commit")

	baseBranch := "main"
	if base {
		taskID := urlParam(r, "id")
		task, _ := s.db.GetTask(taskID)
		if task != nil {
			project, _ := s.db.GetProject(task.ProjectID)
			if project != nil {
				baseBranch = project.DefaultBranch
			}
		}
	}

	resp, err := gitDiffContent(workDir, file, staged, base, baseBranch, commitHash)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleProjectGitDiffContent(w http.ResponseWriter, r *http.Request) {
	workDir, ok := s.resolveProjectWorkDir(w, r)
	if !ok {
		return
	}

	file := r.URL.Query().Get("file")
	staged := r.URL.Query().Get("staged") == "true"
	commitHash := r.URL.Query().Get("commit")

	resp, err := gitDiffContent(workDir, file, staged, false, "", commitHash)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}
