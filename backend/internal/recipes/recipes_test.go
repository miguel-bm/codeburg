package recipes

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManagerList_MultiSource(t *testing.T) {
	dir := t.TempDir()

	if err := os.WriteFile(filepath.Join(dir, "justfile"), []byte(`fmt:
	@echo "fmt"`), 0644); err != nil {
		t.Fatalf("write justfile: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Makefile"), []byte(`lint: ## Lint
	@echo lint`), 0644); err != nil {
		t.Fatalf("write Makefile: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{
  "scripts": {
    "dev": "vite",
    "test": "vitest"
  }
}`), 0644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Taskfile.yml"), []byte(`version: "3"
tasks:
  deploy:
    desc: Deploy app`), 0644); err != nil {
		t.Fatalf("write Taskfile.yml: %v", err)
	}

	mgr := NewManager()
	recipes, err := mgr.List(dir)
	if err != nil {
		t.Fatalf("list recipes: %v", err)
	}

	byKey := map[string]Recipe{}
	for _, recipe := range recipes {
		byKey[recipe.Source+":"+recipe.Name] = recipe
	}

	if got := byKey["justfile:fmt"].Command; got != "just fmt" {
		t.Errorf("expected just command, got %q", got)
	}
	if got := byKey["makefile:lint"].Command; got != "make lint" {
		t.Errorf("expected make command, got %q", got)
	}
	if got := byKey["package.json:test"].Command; got != "npm run test" {
		t.Errorf("expected npm command, got %q", got)
	}
	if got := byKey["taskfile:deploy"].Command; got != "task deploy" {
		t.Errorf("expected task command, got %q", got)
	}
}

func TestDetectNodeScriptRunner(t *testing.T) {
	dir := t.TempDir()

	if got := detectNodeScriptRunner(dir); got != "npm run" {
		t.Fatalf("expected npm run, got %q", got)
	}

	if err := os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte("lockfileVersion: 9"), 0644); err != nil {
		t.Fatalf("write pnpm lockfile: %v", err)
	}
	if got := detectNodeScriptRunner(dir); got != "pnpm run" {
		t.Fatalf("expected pnpm run, got %q", got)
	}
}
