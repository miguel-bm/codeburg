package recipes

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

var shellSafeArgRe = regexp.MustCompile(`^[A-Za-z0-9_@%+=:,./-]+$`)

// Recipe is a runnable command discovered from a known recipe source.
type Recipe struct {
	Name        string `json:"name"`
	Command     string `json:"command"`
	Source      string `json:"source"`
	Description string `json:"description,omitempty"`
}

// Manager discovers recipes in a project or task directory.
type Manager struct{}

func NewManager() *Manager {
	return &Manager{}
}

// List discovers recipes from common sources.
func (m *Manager) List(dir string) ([]Recipe, error) {
	if _, err := os.Stat(dir); err != nil {
		return nil, fmt.Errorf("stat recipe dir: %w", err)
	}

	var all []Recipe

	if recipes, err := m.listJustfileRecipes(dir); err == nil {
		all = append(all, recipes...)
	}
	if recipes, err := m.listMakefileRecipes(dir); err == nil {
		all = append(all, recipes...)
	}
	if recipes, err := m.listPackageJSONRecipes(dir); err == nil {
		all = append(all, recipes...)
	}
	if recipes, err := m.listTaskfileRecipes(dir); err == nil {
		all = append(all, recipes...)
	}

	return dedupeRecipes(all), nil
}

func (m *Manager) listJustfileRecipes(dir string) ([]Recipe, error) {
	_, ok := firstExistingFile(dir, []string{"justfile", "Justfile", ".justfile"})
	if !ok {
		return nil, nil
	}

	var parsed []parsedRecipe

	if _, err := exec.LookPath("just"); err == nil {
		cmd := exec.Command("just", "--list", "--unsorted")
		cmd.Dir = dir
		output, err := cmd.Output()
		if err == nil {
			parsed = parseJustList(output)
		}
	}

	if len(parsed) == 0 {
		path, _ := firstExistingFile(dir, []string{"justfile", "Justfile", ".justfile"})
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read justfile: %w", err)
		}
		parsed = parseJustfileFallback(content)
	}

	recipes := make([]Recipe, 0, len(parsed))
	for _, recipe := range parsed {
		recipes = append(recipes, Recipe{
			Name:        recipe.Name,
			Command:     "just " + shellQuote(recipe.Name),
			Source:      "justfile",
			Description: recipe.Description,
		})
	}

	sort.Slice(recipes, func(i, j int) bool { return recipes[i].Name < recipes[j].Name })
	return recipes, nil
}

func (m *Manager) listMakefileRecipes(dir string) ([]Recipe, error) {
	path, ok := firstExistingFile(dir, []string{"Makefile", "makefile", "GNUmakefile"})
	if !ok {
		return nil, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read makefile: %w", err)
	}

	parsed := parseMakefile(content)
	recipes := make([]Recipe, 0, len(parsed))
	for _, recipe := range parsed {
		recipes = append(recipes, Recipe{
			Name:        recipe.Name,
			Command:     "make " + shellQuote(recipe.Name),
			Source:      "makefile",
			Description: recipe.Description,
		})
	}

	sort.Slice(recipes, func(i, j int) bool { return recipes[i].Name < recipes[j].Name })
	return recipes, nil
}

func (m *Manager) listPackageJSONRecipes(dir string) ([]Recipe, error) {
	path := filepath.Join(dir, "package.json")
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat package.json: %w", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read package.json: %w", err)
	}

	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(content, &pkg); err != nil {
		return nil, fmt.Errorf("parse package.json: %w", err)
	}

	if len(pkg.Scripts) == 0 {
		return nil, nil
	}

	scriptNames := make([]string, 0, len(pkg.Scripts))
	for name := range pkg.Scripts {
		scriptNames = append(scriptNames, name)
	}
	sort.Strings(scriptNames)

	runner := detectNodeScriptRunner(dir)
	recipes := make([]Recipe, 0, len(scriptNames))
	for _, name := range scriptNames {
		recipes = append(recipes, Recipe{
			Name:        name,
			Command:     runner + " " + shellQuote(name),
			Source:      "package.json",
			Description: pkg.Scripts[name],
		})
	}
	return recipes, nil
}

func (m *Manager) listTaskfileRecipes(dir string) ([]Recipe, error) {
	path, ok := firstExistingFile(dir, []string{"Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"})
	if !ok {
		return nil, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read taskfile: %w", err)
	}

	var root struct {
		Tasks map[string]interface{} `yaml:"tasks"`
	}
	if err := yaml.Unmarshal(content, &root); err != nil {
		return nil, fmt.Errorf("parse taskfile: %w", err)
	}

	if len(root.Tasks) == 0 {
		return nil, nil
	}

	taskNames := make([]string, 0, len(root.Tasks))
	for name := range root.Tasks {
		taskNames = append(taskNames, name)
	}
	sort.Strings(taskNames)

	recipes := make([]Recipe, 0, len(taskNames))
	for _, name := range taskNames {
		desc := extractTaskDescription(root.Tasks[name])
		recipes = append(recipes, Recipe{
			Name:        name,
			Command:     "task " + shellQuote(name),
			Source:      "taskfile",
			Description: desc,
		})
	}
	return recipes, nil
}

type parsedRecipe struct {
	Name        string
	Description string
}

func parseJustList(output []byte) []parsedRecipe {
	var recipes []parsedRecipe
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "Available recipes:") {
			continue
		}

		var description string
		if idx := strings.Index(line, "#"); idx >= 0 {
			description = strings.TrimSpace(line[idx+1:])
			line = strings.TrimSpace(line[:idx])
		}

		parts := strings.Fields(line)
		if len(parts) == 0 {
			continue
		}

		recipes = append(recipes, parsedRecipe{Name: parts[0], Description: description})
	}
	return recipes
}

func parseJustfileFallback(content []byte) []parsedRecipe {
	var recipes []parsedRecipe
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		raw := scanner.Text()
		if strings.HasPrefix(raw, " ") || strings.HasPrefix(raw, "\t") {
			continue
		}
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}

		var description string
		if idx := strings.Index(line, "#"); idx >= 0 {
			description = strings.TrimSpace(line[idx+1:])
			line = strings.TrimSpace(line[:idx])
		}

		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}

		parts := strings.Fields(strings.TrimSpace(line[:colon]))
		if len(parts) == 0 {
			continue
		}

		name := parts[0]
		if strings.Contains(name, "=") {
			continue
		}

		recipes = append(recipes, parsedRecipe{Name: name, Description: description})
	}
	return recipes
}

func parseMakefile(content []byte) []parsedRecipe {
	var recipes []parsedRecipe
	scanner := bufio.NewScanner(bytes.NewReader(content))

	for scanner.Scan() {
		raw := scanner.Text()
		if strings.HasPrefix(raw, " ") || strings.HasPrefix(raw, "\t") {
			continue
		}

		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		var description string
		if idx := strings.Index(line, "#"); idx >= 0 {
			description = strings.TrimSpace(line[idx+1:])
			line = strings.TrimSpace(line[:idx])
		}

		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		if colon+1 < len(line) && line[colon+1] == '=' {
			continue
		}

		targetExpr := strings.TrimSpace(line[:colon])
		if targetExpr == "" || strings.Contains(targetExpr, "=") {
			continue
		}

		targets := strings.Fields(targetExpr)
		for _, target := range targets {
			if target == "" || strings.HasPrefix(target, ".") {
				continue
			}
			if strings.ContainsAny(target, "%$") {
				continue
			}
			recipes = append(recipes, parsedRecipe{Name: target, Description: description})
		}
	}

	return recipes
}

func detectNodeScriptRunner(dir string) string {
	switch {
	case fileExists(filepath.Join(dir, "pnpm-lock.yaml")):
		return "pnpm run"
	case fileExists(filepath.Join(dir, "yarn.lock")):
		return "yarn run"
	case fileExists(filepath.Join(dir, "bun.lockb")), fileExists(filepath.Join(dir, "bun.lock")):
		return "bun run"
	default:
		return "npm run"
	}
}

func extractTaskDescription(raw interface{}) string {
	switch v := raw.(type) {
	case map[string]interface{}:
		if desc, ok := v["desc"].(string); ok {
			return desc
		}
		if summary, ok := v["summary"].(string); ok {
			return summary
		}
	case string:
		return v
	}
	return ""
}

func firstExistingFile(dir string, names []string) (string, bool) {
	for _, name := range names {
		path := filepath.Join(dir, name)
		if fileExists(path) {
			return path, true
		}
	}
	return "", false
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func dedupeRecipes(recipes []Recipe) []Recipe {
	seen := make(map[string]struct{}, len(recipes))
	out := make([]Recipe, 0, len(recipes))
	for _, recipe := range recipes {
		key := recipe.Source + "\x00" + recipe.Name
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, recipe)
	}
	return out
}

func shellQuote(arg string) string {
	if arg == "" {
		return "''"
	}
	if shellSafeArgRe.MatchString(arg) {
		return arg
	}
	return "'" + strings.ReplaceAll(arg, "'", `'"'"'`) + "'"
}
