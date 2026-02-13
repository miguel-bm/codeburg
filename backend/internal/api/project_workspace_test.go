package api

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

func createWorkspaceProject(t *testing.T, env *testEnv) db.Project {
	t.Helper()

	repoPath := createTestGitRepo(t)
	resp := env.post("/api/projects", map[string]string{
		"name": "workspace-test",
		"path": repoPath,
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create project failed: %d %s", resp.Code, resp.Body.String())
	}

	var project db.Project
	decodeResponse(t, resp, &project)
	return project
}

func TestProjectWorkspaceFileCRUD(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	project := createWorkspaceProject(t, env)

	createDirResp := env.post("/api/projects/"+project.ID+"/files", map[string]string{
		"path": "src/components",
		"type": "dir",
	})
	if createDirResp.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating dir, got %d: %s", createDirResp.Code, createDirResp.Body.String())
	}

	writeResp := env.request("PUT", "/api/projects/"+project.ID+"/file", map[string]string{
		"path":    "src/components/App.tsx",
		"content": "export const value = 1;\n",
	})
	if writeResp.Code != http.StatusOK {
		t.Fatalf("expected 200 writing file, got %d: %s", writeResp.Code, writeResp.Body.String())
	}

	readResp := env.get("/api/projects/" + project.ID + "/file?path=src/components/App.tsx")
	if readResp.Code != http.StatusOK {
		t.Fatalf("expected 200 reading file, got %d: %s", readResp.Code, readResp.Body.String())
	}

	var readBody map[string]any
	decodeResponse(t, readResp, &readBody)
	if readBody["content"] != "export const value = 1;\n" {
		t.Fatalf("unexpected content: %v", readBody["content"])
	}

	deleteFileResp := env.request("DELETE", "/api/projects/"+project.ID+"/file?path=src/components/App.tsx", nil)
	if deleteFileResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 deleting file, got %d: %s", deleteFileResp.Code, deleteFileResp.Body.String())
	}

	readMissingResp := env.get("/api/projects/" + project.ID + "/file?path=src/components/App.tsx")
	if readMissingResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", readMissingResp.Code)
	}

	deleteDirResp := env.request("DELETE", "/api/projects/"+project.ID+"/file?path=src", nil)
	if deleteDirResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 deleting directory, got %d: %s", deleteDirResp.Code, deleteDirResp.Body.String())
	}
}

func TestProjectWorkspaceProtectsGitPath(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	project := createWorkspaceProject(t, env)

	createResp := env.post("/api/projects/"+project.ID+"/files", map[string]string{
		"path": ".git/hooks",
		"type": "dir",
	})
	if createResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 creating protected path, got %d", createResp.Code)
	}

	writeResp := env.request("PUT", "/api/projects/"+project.ID+"/file", map[string]string{
		"path":    ".git/config",
		"content": "unsafe",
	})
	if writeResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 writing protected path, got %d", writeResp.Code)
	}

	deleteResp := env.request("DELETE", "/api/projects/"+project.ID+"/file?path=.git", nil)
	if deleteResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 deleting protected path, got %d", deleteResp.Code)
	}
}

func TestProjectWorkspaceRejectsSymlinkFileEscape(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	project := createWorkspaceProject(t, env)

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("original"), 0644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	linkPath := filepath.Join(project.Path, "link.txt")
	if err := os.Symlink(outsideFile, linkPath); err != nil {
		t.Fatalf("create symlink: %v", err)
	}

	resp := env.request("PUT", "/api/projects/"+project.ID+"/file", map[string]string{
		"path":    "link.txt",
		"content": "escaped",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 writing through symlink, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceRejectsSymlinkDirectoryEscape(t *testing.T) {
	env := setupTestEnv(t)
	env.setup("testpass123")
	project := createWorkspaceProject(t, env)

	outsideDir := t.TempDir()
	linkDir := filepath.Join(project.Path, "linkdir")
	if err := os.Symlink(outsideDir, linkDir); err != nil {
		t.Fatalf("create symlink dir: %v", err)
	}

	resp := env.request("PUT", "/api/projects/"+project.ID+"/file", map[string]string{
		"path":    "linkdir/evil.txt",
		"content": "escaped",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 writing inside symlinked dir, got %d: %s", resp.Code, resp.Body.String())
	}
}
