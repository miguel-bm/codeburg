package justfile

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Recipe represents a justfile recipe
type Recipe struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Args        string `json:"args,omitempty"`
}

// Manager handles justfile operations
type Manager struct{}

// NewManager creates a new justfile manager
func NewManager() *Manager {
	return &Manager{}
}

// Available checks if just is installed
func (m *Manager) Available() bool {
	cmd := exec.Command("just", "--version")
	return cmd.Run() == nil
}

// HasJustfile checks if a justfile exists in the given directory
func (m *Manager) HasJustfile(dir string) bool {
	for _, name := range []string{"justfile", "Justfile", ".justfile"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

// ListRecipes lists all available recipes in a directory
func (m *Manager) ListRecipes(dir string) ([]Recipe, error) {
	if !m.HasJustfile(dir) {
		return nil, nil
	}

	// Use just --list to get recipes
	cmd := exec.Command("just", "--list", "--unsorted")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("list recipes: %w", err)
	}

	return m.parseJustList(output), nil
}

// parseJustList parses the output of 'just --list'
// Format:
// Available recipes:
//     recipe-name # description
//     recipe-with-args arg1 arg2 # description
func (m *Manager) parseJustList(output []byte) []Recipe {
	var recipes []Recipe
	scanner := bufio.NewScanner(bytes.NewReader(output))

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)

		// Skip header line
		if strings.HasPrefix(line, "Available recipes:") || line == "" {
			continue
		}

		recipe := Recipe{}

		// Check for description (# comment)
		if idx := strings.Index(line, "#"); idx >= 0 {
			recipe.Description = strings.TrimSpace(line[idx+1:])
			line = strings.TrimSpace(line[:idx])
		}

		// Parse name and args
		parts := strings.Fields(line)
		if len(parts) == 0 {
			continue
		}

		recipe.Name = parts[0]
		if len(parts) > 1 {
			recipe.Args = strings.Join(parts[1:], " ")
		}

		recipes = append(recipes, recipe)
	}

	return recipes
}

// RunResult contains the result of running a recipe
type RunResult struct {
	ExitCode int    `json:"exitCode"`
	Output   string `json:"output"`
}

// Run executes a recipe in the given directory
func (m *Manager) Run(dir string, recipe string, args ...string) (*RunResult, error) {
	cmdArgs := append([]string{recipe}, args...)
	cmd := exec.Command("just", cmdArgs...)
	cmd.Dir = dir

	output, err := cmd.CombinedOutput()
	result := &RunResult{
		Output: string(output),
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("run recipe: %w", err)
		}
	}

	return result, nil
}

// StartRecipe starts a recipe and returns channels for streaming output
// This is for long-running commands where we want to stream output
func (m *Manager) StartRecipe(dir string, recipe string, args ...string) (*exec.Cmd, error) {
	cmdArgs := append([]string{recipe}, args...)
	cmd := exec.Command("just", cmdArgs...)
	cmd.Dir = dir

	return cmd, nil
}
