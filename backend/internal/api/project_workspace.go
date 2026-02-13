package api

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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
	maxProjectFileWriteBytes   = 1024 * 1024
	maxSecretContentBytes      = 1024 * 1024
)

type projectFileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Type    string    `json:"type"` // "file" | "dir"
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

type createProjectFileEntryRequest struct {
	Path string `json:"path"`
	Type string `json:"type"` // "file" | "dir"
}

type writeProjectFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type renameFileRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type duplicateFileRequest struct {
	Path string `json:"path"`
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
		if err != nil || n < 1 || n > 32 {
			writeError(w, http.StatusBadRequest, "depth must be between 1 and 32")
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

func (s *Server) handleCreateProjectFileEntry(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req createProjectFileEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}

	entryType := strings.TrimSpace(strings.ToLower(req.Type))
	if entryType == "" {
		entryType = "file"
	}
	if entryType != "file" && entryType != "dir" {
		writeError(w, http.StatusBadRequest, "type must be \"file\" or \"dir\"")
		return
	}

	absPath, err := safeJoin(project.Path, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := os.Stat(absPath); err == nil {
		writeError(w, http.StatusConflict, "path already exists")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	if entryType == "dir" {
		if err := os.MkdirAll(absPath, 0755); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create directory")
			return
		}
	} else {
		f, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
		if err := f.Close(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat created entry")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(relPath),
		"path":    filepath.ToSlash(relPath),
		"type":    entryType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handlePutProjectFile(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req writeProjectFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}
	if len(req.Content) > maxProjectFileWriteBytes {
		writeError(w, http.StatusBadRequest, "content exceeds 1 MiB limit")
		return
	}

	absPath, err := safeJoin(project.Path, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	fileMode := os.FileMode(0644)
	if info, err := os.Stat(absPath); err == nil {
		if info.IsDir() {
			writeError(w, http.StatusBadRequest, "path is a directory")
			return
		}
		fileMode = info.Mode().Perm()
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	if err := os.WriteFile(absPath, []byte(req.Content), fileMode); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"size":      info.Size(),
		"modTime":   info.ModTime(),
		"binary":    false,
		"truncated": false,
		"content":   req.Content,
	})
}

func (s *Server) handleDeleteProjectFile(w http.ResponseWriter, r *http.Request) {
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
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
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
			writeError(w, http.StatusNotFound, "path not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if info.IsDir() {
		if err := os.RemoveAll(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete directory")
			return
		}
	} else {
		if err := os.Remove(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete file")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func renameFileInRoot(root string, req renameFileRequest) (int, string) {
	fromRel, err := normalizeRelativePath(req.From, false)
	if err != nil {
		return http.StatusBadRequest, err.Error()
	}
	toRel, err := normalizeRelativePath(req.To, false)
	if err != nil {
		return http.StatusBadRequest, err.Error()
	}
	if isProtectedProjectPath(fromRel) || isProtectedProjectPath(toRel) {
		return http.StatusBadRequest, "path is protected"
	}

	fromAbs, err := safeJoin(root, fromRel)
	if err != nil {
		return http.StatusBadRequest, err.Error()
	}
	toAbs, err := safeJoin(root, toRel)
	if err != nil {
		return http.StatusBadRequest, err.Error()
	}

	if _, err := os.Stat(fromAbs); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return http.StatusNotFound, "source path not found"
		}
		return http.StatusInternalServerError, "failed to stat source"
	}
	if _, err := os.Stat(toAbs); err == nil {
		return http.StatusConflict, "destination already exists"
	} else if !errors.Is(err, os.ErrNotExist) {
		return http.StatusInternalServerError, "failed to stat destination"
	}

	if err := os.MkdirAll(filepath.Dir(toAbs), 0755); err != nil {
		return http.StatusInternalServerError, "failed to create parent directory"
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		return http.StatusInternalServerError, "failed to rename"
	}

	return 0, ""
}

func (s *Server) handleRenameProjectFile(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req renameFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if status, msg := renameFileInRoot(project.Path, req); status != 0 {
		writeError(w, status, msg)
		return
	}

	toRel, _ := normalizeRelativePath(req.To, false)
	absPath, _ := safeJoin(project.Path, toRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat renamed entry")
		return
	}

	fileType := "file"
	if info.IsDir() {
		fileType = "dir"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"name":    filepath.Base(toRel),
		"path":    filepath.ToSlash(toRel),
		"type":    fileType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func duplicateFileInRoot(root string, path string) (string, int, string) {
	relPath, err := normalizeRelativePath(path, false)
	if err != nil {
		return "", http.StatusBadRequest, err.Error()
	}
	if isProtectedProjectPath(relPath) {
		return "", http.StatusBadRequest, "path is protected"
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		return "", http.StatusBadRequest, err.Error()
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", http.StatusNotFound, "file not found"
		}
		return "", http.StatusInternalServerError, "failed to stat file"
	}
	if info.IsDir() {
		return "", http.StatusBadRequest, "cannot duplicate a directory"
	}

	content, err := os.ReadFile(absPath)
	if err != nil {
		return "", http.StatusInternalServerError, "failed to read file"
	}

	dir := filepath.Dir(relPath)
	base := filepath.Base(relPath)
	ext := filepath.Ext(base)
	nameNoExt := strings.TrimSuffix(base, ext)

	var copyName string
	if ext != "" {
		copyName = nameNoExt + "-copy" + ext
	} else {
		copyName = nameNoExt + "-copy"
	}

	copyRel := copyName
	if dir != "." && dir != "" {
		copyRel = filepath.Join(dir, copyName)
	}

	copyAbs, err := safeJoin(root, copyRel)
	if err != nil {
		return "", http.StatusBadRequest, err.Error()
	}

	// If copy already exists, add a number
	if _, err := os.Stat(copyAbs); err == nil {
		for i := 2; i < 100; i++ {
			if ext != "" {
				copyName = fmt.Sprintf("%s-copy-%d%s", nameNoExt, i, ext)
			} else {
				copyName = fmt.Sprintf("%s-copy-%d", nameNoExt, i)
			}
			copyRel = copyName
			if dir != "." && dir != "" {
				copyRel = filepath.Join(dir, copyName)
			}
			copyAbs, _ = safeJoin(root, copyRel)
			if _, err := os.Stat(copyAbs); errors.Is(err, os.ErrNotExist) {
				break
			}
		}
	}

	if err := os.WriteFile(copyAbs, content, info.Mode().Perm()); err != nil {
		return "", http.StatusInternalServerError, "failed to write copy"
	}

	return copyRel, 0, ""
}

func (s *Server) handleDuplicateProjectFile(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req duplicateFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	copyRel, status, msg := duplicateFileInRoot(project.Path, req.Path)
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	absPath, _ := safeJoin(project.Path, copyRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat copy")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(copyRel),
		"path":    filepath.ToSlash(copyRel),
		"type":    "file",
		"size":    info.Size(),
		"modTime": info.ModTime(),
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

// --- Task-level file operations ---
// These use the task's worktree path (or project path fallback) as root.

func (s *Server) resolveTaskFileRoot(w http.ResponseWriter, r *http.Request) (string, bool) {
	taskID := urlParam(r, "id")
	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return "", false
	}

	if task.WorktreePath != nil && *task.WorktreePath != "" {
		return *task.WorktreePath, true
	}

	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		writeDBError(w, err, "project")
		return "", false
	}
	return project.Path, true
}

func (s *Server) handleListTaskFiles(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
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
		if err != nil || n < 1 || n > 32 {
			writeError(w, http.StatusBadRequest, "depth must be between 1 and 32")
			return
		}
		depth = n
	}

	absPath, err := safeJoin(root, relPath)
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

	entries, err := listProjectFiles(root, relPath, depth)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":    filepath.ToSlash(relPath),
		"entries": entries,
	})
}

func (s *Server) handleReadTaskFile(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	absPath, err := safeJoin(root, relPath)
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

func (s *Server) handlePutTaskFile(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	var req writeProjectFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}
	if len(req.Content) > maxProjectFileWriteBytes {
		writeError(w, http.StatusBadRequest, "content exceeds 1 MiB limit")
		return
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	fileMode := os.FileMode(0644)
	if info, err := os.Stat(absPath); err == nil {
		if info.IsDir() {
			writeError(w, http.StatusBadRequest, "path is a directory")
			return
		}
		fileMode = info.Mode().Perm()
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	if err := os.WriteFile(absPath, []byte(req.Content), fileMode); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":      filepath.ToSlash(relPath),
		"size":      info.Size(),
		"modTime":   info.ModTime(),
		"binary":    false,
		"truncated": false,
		"content":   req.Content,
	})
}

func (s *Server) handleCreateTaskFileEntry(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	var req createProjectFileEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	relPath, err := normalizeRelativePath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}

	entryType := strings.TrimSpace(strings.ToLower(req.Type))
	if entryType == "" {
		entryType = "file"
	}
	if entryType != "file" && entryType != "dir" {
		writeError(w, http.StatusBadRequest, "type must be \"file\" or \"dir\"")
		return
	}

	absPath, err := safeJoin(root, relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := os.Stat(absPath); err == nil {
		writeError(w, http.StatusConflict, "path already exists")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	if entryType == "dir" {
		if err := os.MkdirAll(absPath, 0755); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create directory")
			return
		}
	} else {
		f, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
		if err := f.Close(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
	}

	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat created entry")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(relPath),
		"path":    filepath.ToSlash(relPath),
		"type":    entryType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handleDeleteTaskFile(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	relPath, err := normalizeRelativePath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isProtectedProjectPath(relPath) {
		writeError(w, http.StatusBadRequest, "path is protected")
		return
	}

	absPath, err := safeJoin(root, relPath)
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

	if info.IsDir() {
		if err := os.RemoveAll(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete directory")
			return
		}
	} else {
		if err := os.Remove(absPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete file")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRenameTaskFile(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	var req renameFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if status, msg := renameFileInRoot(root, req); status != 0 {
		writeError(w, status, msg)
		return
	}

	toRel, _ := normalizeRelativePath(req.To, false)
	absPath, _ := safeJoin(root, toRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat renamed entry")
		return
	}

	fileType := "file"
	if info.IsDir() {
		fileType = "dir"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"name":    filepath.Base(toRel),
		"path":    filepath.ToSlash(toRel),
		"type":    fileType,
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

func (s *Server) handleDuplicateTaskFile(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	var req duplicateFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	copyRel, status, msg := duplicateFileInRoot(root, req.Path)
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	absPath, _ := safeJoin(root, copyRel)
	info, err := os.Stat(absPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat copy")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"name":    filepath.Base(copyRel),
		"path":    filepath.ToSlash(copyRel),
		"type":    "file",
		"size":    info.Size(),
		"modTime": info.ModTime(),
	})
}

// --- File search ---

type fileSearchRequest struct {
	Query         string `json:"query"`
	Regex         bool   `json:"regex,omitempty"`
	CaseSensitive bool   `json:"caseSensitive,omitempty"`
	MaxResults    int    `json:"maxResults,omitempty"`
}

type fileSearchMatch struct {
	Line    int    `json:"line"`
	Content string `json:"content"`
}

type fileSearchResult struct {
	File    string            `json:"file"`
	Matches []fileSearchMatch `json:"matches"`
}

func searchFiles(rootDir, query string, regex, caseSensitive bool, maxResults int) ([]fileSearchResult, error) {
	if maxResults <= 0 {
		maxResults = 200
	}

	var results []fileSearchResult
	totalMatches := 0

	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		if totalMatches >= maxResults {
			return filepath.SkipAll
		}

		name := info.Name()
		// Skip hidden dirs and .git
		if info.IsDir() && (name == ".git" || name == "node_modules" || name == ".next" || name == "vendor") {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil
		}
		// Skip large and binary files
		if info.Size() > 512*1024 || info.Size() == 0 {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		if !utf8.Valid(data) {
			return nil
		}

		relPath, _ := filepath.Rel(rootDir, path)
		content := string(data)
		lines := strings.Split(content, "\n")

		var matches []fileSearchMatch
		for i, line := range lines {
			if totalMatches >= maxResults {
				break
			}
			var found bool
			if regex {
				// Simple regex match
				if re, err := regexp.Compile(query); err == nil {
					found = re.MatchString(line)
				}
			} else if caseSensitive {
				found = strings.Contains(line, query)
			} else {
				found = strings.Contains(strings.ToLower(line), strings.ToLower(query))
			}
			if found {
				matches = append(matches, fileSearchMatch{
					Line:    i + 1,
					Content: truncateLine(line, 200),
				})
				totalMatches++
			}
		}

		if len(matches) > 0 {
			results = append(results, fileSearchResult{
				File:    filepath.ToSlash(relPath),
				Matches: matches,
			})
		}

		return nil
	})

	if err != nil {
		return nil, err
	}
	return results, nil
}

func truncateLine(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func (s *Server) handleSearchProjectFiles(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req fileSearchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}

	results, err := searchFiles(project.Path, req.Query, req.Regex, req.CaseSensitive, req.MaxResults)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleSearchTaskFiles(w http.ResponseWriter, r *http.Request) {
	root, ok := s.resolveTaskFileRoot(w, r)
	if !ok {
		return
	}

	var req fileSearchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}

	results, err := searchFiles(root, req.Query, req.Regex, req.CaseSensitive, req.MaxResults)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
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
