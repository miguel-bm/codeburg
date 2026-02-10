package api

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

const (
	maxProjectFilePreviewBytes = 256 * 1024
	maxSecretContentBytes      = 1024 * 1024
)

type projectFileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Type    string    `json:"type"` // "file" | "dir"
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

func (s *Server) handleListProjectFiles(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	depth := 1
	if rawDepth := strings.TrimSpace(r.URL.Query().Get("depth")); rawDepth != "" {
		n, err := strconv.Atoi(rawDepth)
		if err != nil || n < 1 || n > 8 {
			writeError(w, http.StatusBadRequest, "depth must be between 1 and 8")
			return
		}
		depth = n
	}

	absPath, err := safeJoin(project.Path, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "path not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a directory")
		return
	}

	entries, err := listProjectFiles(project.Path, relPath, depth)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":    filepath.ToSlash(relPath),
		"entries": entries,
	})
}

func (s *Server) handleReadProjectFile(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	absPath, err := safeJoin(project.Path, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is a directory")
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, maxProjectFilePreviewBytes+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}
	truncated := len(buf) > maxProjectFilePreviewBytes
	if truncated {
		buf = buf[:maxProjectFilePreviewBytes]
	}

	isBinary := bytes.IndexByte(buf, 0) >= 0 || !utf8.Valid(buf)
	content := ""
	if !isBinary {
		content = string(buf)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"size":      info.Size(),
		"modTime":   info.ModTime(),
		"binary":    isBinary,
		"truncated": truncated,
		"content":   content,
	})
}

type patchProjectSecretsRequest struct {
	SecretFiles []secretFilePatch `json:"secretFiles"`
}

type secretFilePatch struct {
	Path       string  `json:"path"`
	Mode       string  `json:"mode"`
	SourcePath *string `json:"sourcePath,omitempty"`
	Enabled    *bool   `json:"enabled,omitempty"`
}

func (s *Server) handlePatchProjectSecrets(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")

	var req patchProjectSecretsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	seen := make(map[string]struct{}, len(req.SecretFiles))
	secretFiles := make([]db.SecretFileConfig, 0, len(req.SecretFiles))
	for _, raw := range req.SecretFiles {
		enabled := true
		if raw.Enabled != nil {
			enabled = *raw.Enabled
		}
		cfg, err := normalizeSecretFileConfig(db.SecretFileConfig{
			Path:       raw.Path,
			Mode:       raw.Mode,
			SourcePath: raw.SourcePath,
			Enabled:    enabled,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, ok := seen[cfg.Path]; ok {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("duplicate secret path: %s", cfg.Path))
			return
		}
		seen[cfg.Path] = struct{}{}
		secretFiles = append(secretFiles, cfg)
	}

	project, err := s.db.UpdateProject(projectID, db.UpdateProjectInput{
		SecretFiles: secretFiles,
	})
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	writeJSON(w, http.StatusOK, project)
}

func (s *Server) handleGetProjectSecrets(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	type secretFileStatus struct {
		Path           string  `json:"path"`
		Mode           string  `json:"mode"`
		SourcePath     *string `json:"sourcePath,omitempty"`
		Enabled        bool    `json:"enabled"`
		ManagedPath    string  `json:"managedPath"`
		ManagedExists  bool    `json:"managedExists"`
		ResolvedSource *string `json:"resolvedSource,omitempty"`
		ResolvedKind   string  `json:"resolvedKind,omitempty"`
	}

	statuses := make([]secretFileStatus, 0, len(project.SecretFiles))
	for _, raw := range project.SecretFiles {
		cfg, err := normalizeSecretFileConfig(raw)
		if err != nil {
			continue
		}

		managedPath, _ := s.worktree.ManagedSecretPath(project.ID, cfg.Path)
		managedExists := false
		if managedPath != "" {
			if info, err := os.Stat(managedPath); err == nil && !info.IsDir() {
				managedExists = true
			}
		}

		resolvedPath, resolvedKind, _ := s.worktree.ResolveSecretSource(project.Path, project.ID, worktree.SecretFile{
			Path:       cfg.Path,
			Mode:       cfg.Mode,
			SourcePath: ptrToString(cfg.SourcePath),
			Enabled:    cfg.Enabled,
		})

		entry := secretFileStatus{
			Path:          filepath.ToSlash(cfg.Path),
			Mode:          cfg.Mode,
			SourcePath:    cfg.SourcePath,
			Enabled:       cfg.Enabled,
			ManagedPath:   managedPath,
			ManagedExists: managedExists,
			ResolvedKind:  resolvedKind,
		}
		if resolvedPath != "" {
			entry.ResolvedSource = &resolvedPath
		}
		statuses = append(statuses, entry)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"secretFiles": statuses,
	})
}

func (s *Server) handleGetProjectSecretContent(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	managedPath, err := s.worktree.ManagedSecretPath(project.ID, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	f, err := os.Open(managedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "managed secret not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to open managed secret")
		return
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, maxSecretContentBytes+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read managed secret")
		return
	}
	truncated := len(buf) > maxSecretContentBytes
	if truncated {
		buf = buf[:maxSecretContentBytes]
	}

	if !utf8.Valid(buf) {
		writeError(w, http.StatusBadRequest, "managed secret content is binary")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"content":   string(buf),
		"truncated": truncated,
	})
}

func (s *Server) handlePutProjectSecretContent(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Content) > maxSecretContentBytes {
		writeError(w, http.StatusBadRequest, "content exceeds 1 MiB limit")
		return
	}

	managedPath, err := s.worktree.ManagedSecretPath(project.ID, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	if err := os.MkdirAll(filepath.Dir(managedPath), 0700); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create managed secret directory")
		return
	}
	if err := os.WriteFile(managedPath, []byte(req.Content), 0600); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write managed secret")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path": filepath.ToSlash(relPath),
	})
}

func (s *Server) handleResolveProjectSecrets(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req struct {
		Paths []string `json:"paths"`
	}
	if r.Body != nil {
		if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	configByPath := make(map[string]db.SecretFileConfig, len(project.SecretFiles))
	for _, raw := range project.SecretFiles {
		cfg, err := normalizeSecretFileConfig(raw)
		if err != nil {
			continue
		}
		configByPath[cfg.Path] = cfg
	}

	paths := make([]string, 0)
	if len(req.Paths) == 0 {
		for p := range configByPath {
			paths = append(paths, p)
		}
		sort.Strings(paths)
	} else {
		for _, raw := range req.Paths {
			p, err := normalizeRelativePath(raw, false)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			paths = append(paths, p)
		}
	}

	type resolveEntry struct {
		Path           string  `json:"path"`
		Mode           string  `json:"mode"`
		Enabled        bool    `json:"enabled"`
		ResolvedSource *string `json:"resolvedSource,omitempty"`
		ResolvedKind   string  `json:"resolvedKind,omitempty"`
	}

	results := make([]resolveEntry, 0, len(paths))
	for _, p := range paths {
		cfg, ok := configByPath[p]
		if !ok {
			cfg = db.SecretFileConfig{
				Path:    p,
				Mode:    "copy",
				Enabled: true,
			}
		}

		resolvedPath, resolvedKind, _ := s.worktree.ResolveSecretSource(project.Path, project.ID, worktree.SecretFile{
			Path:       cfg.Path,
			Mode:       cfg.Mode,
			SourcePath: ptrToString(cfg.SourcePath),
			Enabled:    cfg.Enabled,
		})

		entry := resolveEntry{
			Path:    filepath.ToSlash(cfg.Path),
			Mode:    cfg.Mode,
			Enabled: cfg.Enabled,
		}
		if resolvedPath != "" {
			entry.ResolvedSource = &resolvedPath
			entry.ResolvedKind = resolvedKind
		}
		results = append(results, entry)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"results": results,
	})
}

func normalizeSecretFileConfig(cfg db.SecretFileConfig) (db.SecretFileConfig, error) {
	path, err := normalizeRelativePath(cfg.Path, false)
	if err != nil {
		return db.SecretFileConfig{}, fmt.Errorf("invalid secret path %q: %w", cfg.Path, err)
	}

	mode := strings.TrimSpace(strings.ToLower(cfg.Mode))
	if mode == "" {
		mode = "copy"
	}
	if mode != "copy" && mode != "symlink" {
		return db.SecretFileConfig{}, fmt.Errorf("invalid mode for %s: %s", path, mode)
	}

	var sourcePath *string
	if cfg.SourcePath != nil && strings.TrimSpace(*cfg.SourcePath) != "" {
		sp, err := normalizeRelativePath(*cfg.SourcePath, false)
		if err != nil {
			return db.SecretFileConfig{}, fmt.Errorf("invalid sourcePath for %s: %w", path, err)
		}
		sourcePath = &sp
	}

	enabled := cfg.Enabled
	if !enabled && cfg.Mode == "" && cfg.SourcePath == nil {
		enabled = true
	}

	return db.SecretFileConfig{
		Path:       path,
		Mode:       mode,
		SourcePath: sourcePath,
		Enabled:    enabled,
	}, nil
}

func normalizeRelativePath(raw string, allowEmpty bool) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("path is required")
	}
	if filepath.IsAbs(p) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}
	clean := filepath.Clean(p)
	if clean == "." {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path traversal is not allowed")
	}
	return clean, nil
}

func safeJoin(basePath, relPath string) (string, error) {
	baseAbs, err := filepath.Abs(basePath)
	if err != nil {
		return "", fmt.Errorf("invalid base path")
	}
	targetAbs := baseAbs
	if relPath != "" {
		targetAbs = filepath.Join(baseAbs, relPath)
	}
	targetAbs, err = filepath.Abs(targetAbs)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}
	rel, err := filepath.Rel(baseAbs, targetAbs)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes project root")
	}
	return targetAbs, nil
}

func listProjectFiles(projectRoot, relPath string, depth int) ([]projectFileEntry, error) {
	rootAbs, err := safeJoin(projectRoot, relPath)
	if err != nil {
		return nil, err
	}

	out := make([]projectFileEntry, 0, 64)
	if err := walkProjectFiles(rootAbs, relPath, depth, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func walkProjectFiles(absDir, relDir string, depth int, out *[]projectFileEntry) error {
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	for _, entry := range entries {
		relChild := entry.Name()
		if relDir != "" {
			relChild = filepath.Join(relDir, entry.Name())
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fileType := "file"
		if entry.IsDir() {
			fileType = "dir"
		}

		*out = append(*out, projectFileEntry{
			Name:    entry.Name(),
			Path:    filepath.ToSlash(relChild),
			Type:    fileType,
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})

		if entry.IsDir() && depth > 1 {
			nextAbs := filepath.Join(absDir, entry.Name())
			if err := walkProjectFiles(nextAbs, relChild, depth-1, out); err != nil {
				return err
			}
		}
	}

	return nil
}

func mapSecretFiles(configs []db.SecretFileConfig) []worktree.SecretFile {
	if len(configs) == 0 {
		return nil
	}
	out := make([]worktree.SecretFile, 0, len(configs))
	for _, cfg := range configs {
		normalized, err := normalizeSecretFileConfig(cfg)
		if err != nil {
			continue
		}
		out = append(out, worktree.SecretFile{
			Path:       normalized.Path,
			Mode:       normalized.Mode,
			SourcePath: ptrToString(normalized.SourcePath),
			Enabled:    normalized.Enabled,
		})
	}
	return out
}
