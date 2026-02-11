package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/miguel-bm/codeburg/internal/db"
)

// ArchiveInfo describes an archive file on disk.
type ArchiveInfo struct {
	Filename    string    `json:"filename"`
	ProjectName string    `json:"projectName"`
	ProjectID   string    `json:"projectId"`
	ArchivedAt  time.Time `json:"archivedAt"`
	Size        int64     `json:"size"`
}

func archivesDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".codeburg", "archives")
}

// handleArchiveProject exports a project to a JSON file and deletes it from the DB.
func (s *Server) handleArchiveProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	archive, err := s.db.ExportProjectArchive(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	// Ensure archives directory exists
	dir := archivesDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create archives directory")
		return
	}

	// Build filename: sanitized name + timestamp
	safeName := sanitizeFilename(archive.Project.Name)
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("%s-%s.json", safeName, timestamp)

	data, err := json.MarshalIndent(archive, "", "  ")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to marshal archive")
		return
	}

	filePath := filepath.Join(dir, filename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write archive file")
		return
	}

	// Delete project from DB (CASCADE deletes tasks, sessions, labels, etc.)
	if err := s.db.DeleteProject(projectID); err != nil {
		writeError(w, http.StatusInternalServerError, "archive saved but failed to delete project")
		return
	}

	// Broadcast project deletion
	s.wsHub.BroadcastGlobal("project_deleted", map[string]string{"id": projectID})

	writeJSON(w, http.StatusOK, map[string]string{
		"filename": filename,
		"path":     filePath,
	})
}

// handleListArchives lists all archive files.
func (s *Server) handleListArchives(w http.ResponseWriter, r *http.Request) {
	dir := archivesDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, []ArchiveInfo{})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read archives directory")
		return
	}

	archives := make([]ArchiveInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Read just enough to get metadata
		filePath := filepath.Join(dir, entry.Name())
		ai := ArchiveInfo{
			Filename: entry.Name(),
			Size:     info.Size(),
		}

		// Try to read the archive header for metadata
		if f, err := os.Open(filePath); err == nil {
			var partial struct {
				ArchivedAt time.Time `json:"archivedAt"`
				Project    struct {
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"project"`
			}
			dec := json.NewDecoder(io.LimitReader(f, 4096))
			if dec.Decode(&partial) == nil {
				ai.ProjectName = partial.Project.Name
				ai.ProjectID = partial.Project.ID
				ai.ArchivedAt = partial.ArchivedAt
			}
			f.Close()
		}

		archives = append(archives, ai)
	}

	writeJSON(w, http.StatusOK, archives)
}

// handleUnarchiveProject restores a project from an archive file.
func (s *Server) handleUnarchiveProject(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")

	// Validate filename (prevent path traversal)
	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	filePath := filepath.Join(archivesDir(), filename)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "archive not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read archive file")
		return
	}

	var archive db.ProjectArchive
	if err := json.Unmarshal(data, &archive); err != nil {
		writeError(w, http.StatusBadRequest, "invalid archive format")
		return
	}

	// Check for ID conflict
	if _, err := s.db.GetProject(archive.Project.ID); err == nil {
		writeError(w, http.StatusConflict, "a project with this ID already exists")
		return
	}

	if err := s.db.ImportProjectArchive(&archive); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to restore: %v", err))
		return
	}

	// Delete the archive file after successful restore
	os.Remove(filePath)

	// Broadcast
	s.wsHub.BroadcastGlobal("project_created", archive.Project)

	writeJSON(w, http.StatusOK, archive.Project)
}

// handleDeleteArchive permanently deletes an archive file.
func (s *Server) handleDeleteArchive(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")

	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	filePath := filepath.Join(archivesDir(), filename)
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "archive not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete archive")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func sanitizeFilename(name string) string {
	// Replace non-alphanumeric chars with hyphens, collapse multiples
	var b strings.Builder
	lastHyphen := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastHyphen = false
		} else if !lastHyphen {
			b.WriteRune('-')
			lastHyphen = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "project"
	}
	return s
}
