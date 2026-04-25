package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type piConfigDocument struct {
	Path       string     `json:"path"`
	Exists     bool       `json:"exists"`
	Valid      bool       `json:"valid"`
	Content    string     `json:"content"`
	UpdatedAt  *time.Time `json:"updatedAt,omitempty"`
	ParseError *string    `json:"parseError,omitempty"`
}

type piConfigResponse struct {
	Status            piStatusResponse   `json:"status"`
	GlobalSettings    piConfigDocument   `json:"globalSettings"`
	Models            piConfigDocument   `json:"models"`
	ProjectSettings   *piConfigDocument  `json:"projectSettings,omitempty"`
	GlobalPackages    []piPackageEntry   `json:"globalPackages,omitempty"`
	ProjectPackages   []piPackageEntry   `json:"projectPackages,omitempty"`
	GlobalExtensions  []piExtensionEntry `json:"globalExtensions,omitempty"`
	ProjectExtensions []piExtensionEntry `json:"projectExtensions,omitempty"`
}

type updatePiConfigRequest struct {
	Content string `json:"content"`
}

type mutatePiPackageRequest struct {
	Source string `json:"source"`
}

type updatePiPackagesRequest struct {
	Source string `json:"source,omitempty"`
}

type mutatePiExtensionRequest struct {
	Path string `json:"path"`
}

type piPackageEntry struct {
	Source         string `json:"source"`
	Scope          string `json:"scope"`
	SourceType     string `json:"sourceType"`
	Pinned         bool   `json:"pinned"`
	Filtered       bool   `json:"filtered"`
	ExtensionCount int    `json:"extensionCount"`
	SkillCount     int    `json:"skillCount"`
	PromptCount    int    `json:"promptCount"`
	ThemeCount     int    `json:"themeCount"`
}

type piExtensionEntry struct {
	Path  string `json:"path"`
	Scope string `json:"scope"`
}

func (s *Server) handleGetPiConfig(w http.ResponseWriter, r *http.Request) {
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleGetProjectPiConfig(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handlePutPiGlobalSettings(w http.ResponseWriter, r *http.Request) {
	if err := writePiJSONDocument(r, piGlobalSettingsPath()); err != nil {
		writePiConfigWriteError(w, err)
		return
	}

	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config.GlobalSettings)
}

func (s *Server) handlePutPiModels(w http.ResponseWriter, r *http.Request) {
	if err := writePiJSONDocument(r, piModelsPath()); err != nil {
		writePiConfigWriteError(w, err)
		return
	}

	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config.Models)
}

func (s *Server) handlePutProjectPiSettings(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	projectSettingsPath := filepath.Join(project.Path, ".pi", "settings.json")
	if err := writePiJSONDocument(r, projectSettingsPath); err != nil {
		writePiConfigWriteError(w, err)
		return
	}

	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	if config.ProjectSettings == nil {
		writeError(w, http.StatusInternalServerError, "failed to read project pi settings")
		return
	}
	writeJSON(w, http.StatusOK, *config.ProjectSettings)
}

func (s *Server) handleInstallPiPackage(w http.ResponseWriter, r *http.Request) {
	if err := s.runPiPackageMutation(r, nil, "install"); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleRemovePiPackage(w http.ResponseWriter, r *http.Request) {
	if err := s.runPiPackageMutation(r, nil, "remove"); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleUpdatePiPackages(w http.ResponseWriter, r *http.Request) {
	if err := s.runPiPackageUpdate(r, nil); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleInstallProjectPiPackage(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}
	if err := s.runPiPackageMutation(r, &project.Path, "install"); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleRemoveProjectPiPackage(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}
	if err := s.runPiPackageMutation(r, &project.Path, "remove"); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleUpdateProjectPiPackages(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}
	if err := s.runPiPackageUpdate(r, &project.Path); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleAddPiExtension(w http.ResponseWriter, r *http.Request) {
	if err := mutatePiExtensionsList(piGlobalSettingsPath(), r, true); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleRemovePiExtension(w http.ResponseWriter, r *http.Request) {
	if err := mutatePiExtensionsList(piGlobalSettingsPath(), r, false); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleAddProjectPiExtension(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}
	if err := mutatePiExtensionsList(filepath.Join(project.Path, ".pi", "settings.json"), r, true); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) handleRemoveProjectPiExtension(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}
	if err := mutatePiExtensionsList(filepath.Join(project.Path, ".pi", "settings.json"), r, false); err != nil {
		writePiConfigWriteError(w, err)
		return
	}
	config, err := loadPiConfigResponse(&project.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read pi config")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func writePiConfigWriteError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "invalid JSON") || strings.Contains(err.Error(), "invalid request body") {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func loadPiConfigResponse(projectPath *string) (piConfigResponse, error) {
	status := inspectPiStatus()

	globalSettings, err := readPiJSONDocument(status.SettingsPath)
	if err != nil {
		return piConfigResponse{}, err
	}

	models, err := readPiJSONDocument(status.ModelsPath)
	if err != nil {
		return piConfigResponse{}, err
	}

	response := piConfigResponse{
		Status:         status,
		GlobalSettings: globalSettings,
		Models:         models,
	}

	if projectPath != nil {
		projectSettingsPath := filepath.Join(*projectPath, ".pi", "settings.json")
		projectSettings, err := readPiJSONDocument(projectSettingsPath)
		if err != nil {
			return piConfigResponse{}, err
		}
		response.ProjectSettings = &projectSettings
	}

	response.GlobalPackages, response.GlobalExtensions = parsePiSettingsResources(globalSettings, "global")
	if response.ProjectSettings != nil {
		response.ProjectPackages, response.ProjectExtensions = parsePiSettingsResources(*response.ProjectSettings, "project")
	}

	return response, nil
}

func readPiJSONDocument(path string) (piConfigDocument, error) {
	document := piConfigDocument{
		Path:  path,
		Valid: true,
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return document, nil
		}
		return piConfigDocument{}, err
	}

	document.Exists = true
	modTime := info.ModTime().UTC()
	document.UpdatedAt = &modTime

	raw, err := os.ReadFile(path)
	if err != nil {
		return piConfigDocument{}, err
	}
	document.Content = string(raw)

	if len(strings.TrimSpace(document.Content)) == 0 {
		document.Valid = false
		msg := "file is empty"
		document.ParseError = &msg
		return document, nil
	}

	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		document.Valid = false
		msg := err.Error()
		document.ParseError = &msg
		return document, nil
	}

	return document, nil
}

func writePiJSONDocument(r *http.Request, path string) error {
	var req updatePiConfigRequest
	if err := decodeJSON(r, &req); err != nil {
		return fmt.Errorf("invalid request body")
	}

	data, err := normalizePiJSONDocument(req.Content)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create pi config directory: %w", err)
	}
	if err := writeFileAtomic(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write pi config: %w", err)
	}
	return nil
}

func piAgentDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".pi", "agent")
	}
	return filepath.Join(home, ".pi", "agent")
}

func piGlobalSettingsPath() string {
	return filepath.Join(piAgentDir(), "settings.json")
}

func piModelsPath() string {
	return filepath.Join(piAgentDir(), "models.json")
}

func normalizePiJSONDocument(content string) ([]byte, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, fmt.Errorf("invalid JSON: content is required")
	}

	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	data, err := json.MarshalIndent(parsed, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to format JSON: %w", err)
	}
	return append(data, '\n'), nil
}

func parsePiSettingsResources(document piConfigDocument, scope string) ([]piPackageEntry, []piExtensionEntry) {
	if !document.Exists || !document.Valid || strings.TrimSpace(document.Content) == "" {
		return nil, nil
	}

	var settings map[string]any
	if err := json.Unmarshal([]byte(document.Content), &settings); err != nil {
		return nil, nil
	}

	packages := make([]piPackageEntry, 0)
	if rawPackages, ok := settings["packages"].([]any); ok {
		for _, rawPkg := range rawPackages {
			if entry, ok := parsePiPackageEntry(rawPkg, scope); ok {
				packages = append(packages, entry)
			}
		}
	}

	extensions := make([]piExtensionEntry, 0)
	if rawExtensions, ok := settings["extensions"].([]any); ok {
		for _, raw := range rawExtensions {
			path, ok := raw.(string)
			if !ok || strings.TrimSpace(path) == "" {
				continue
			}
			extensions = append(extensions, piExtensionEntry{
				Path:  strings.TrimSpace(path),
				Scope: scope,
			})
		}
	}

	return packages, extensions
}

func parsePiPackageEntry(raw any, scope string) (piPackageEntry, bool) {
	switch value := raw.(type) {
	case string:
		source := strings.TrimSpace(value)
		if source == "" {
			return piPackageEntry{}, false
		}
		return piPackageEntry{
			Source:     source,
			Scope:      scope,
			SourceType: detectPiPackageSourceType(source),
			Pinned:     isPiPackageSourcePinned(source),
		}, true
	case map[string]any:
		source, _ := value["source"].(string)
		source = strings.TrimSpace(source)
		if source == "" {
			return piPackageEntry{}, false
		}
		entry := piPackageEntry{
			Source:     source,
			Scope:      scope,
			SourceType: detectPiPackageSourceType(source),
			Pinned:     isPiPackageSourcePinned(source),
			Filtered:   true,
		}
		entry.ExtensionCount = countPiPackageFilters(value["extensions"])
		entry.SkillCount = countPiPackageFilters(value["skills"])
		entry.PromptCount = countPiPackageFilters(value["prompts"])
		entry.ThemeCount = countPiPackageFilters(value["themes"])
		return entry, true
	default:
		return piPackageEntry{}, false
	}
}

func countPiPackageFilters(value any) int {
	items, ok := value.([]any)
	if !ok {
		return 0
	}
	return len(items)
}

func detectPiPackageSourceType(source string) string {
	switch {
	case strings.HasPrefix(source, "npm:"):
		return "npm"
	case strings.HasPrefix(source, "git:"):
		return "git"
	case strings.HasPrefix(source, "https://"), strings.HasPrefix(source, "http://"), strings.HasPrefix(source, "ssh://"), strings.HasPrefix(source, "git://"):
		return "git"
	default:
		return "local"
	}
}

func isPiPackageSourcePinned(source string) bool {
	if strings.HasPrefix(source, "npm:") {
		spec := strings.TrimPrefix(source, "npm:")
		lastAt := strings.LastIndex(spec, "@")
		return lastAt > 0
	}
	lastAt := strings.LastIndex(source, "@")
	if lastAt < 0 {
		return false
	}
	lastSep := strings.LastIndexAny(source, "/:")
	return lastAt > lastSep
}

func (s *Server) runPiPackageMutation(r *http.Request, projectPath *string, command string) error {
	var req mutatePiPackageRequest
	if err := decodeJSON(r, &req); err != nil {
		return fmt.Errorf("invalid request body")
	}
	source := strings.TrimSpace(req.Source)
	if source == "" {
		return fmt.Errorf("invalid request body")
	}

	args := []string{command}
	if projectPath != nil {
		args = append(args, "-l")
	}
	args = append(args, source)
	return runPiCLI(args, projectPath)
}

func (s *Server) runPiPackageUpdate(r *http.Request, projectPath *string) error {
	var req updatePiPackagesRequest
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &req); err != nil {
			return fmt.Errorf("invalid request body")
		}
	}

	args := []string{"update"}
	if projectPath != nil {
		args = append(args, "-l")
	}
	if strings.TrimSpace(req.Source) != "" {
		args = append(args, strings.TrimSpace(req.Source))
	}
	return runPiCLI(args, projectPath)
}

func runPiCLI(args []string, projectPath *string) error {
	piPath, err := exec.LookPath("pi")
	if err != nil {
		return fmt.Errorf("pi is not installed")
	}
	cmd := exec.Command(piPath, args...)
	if projectPath != nil {
		cmd.Dir = *projectPath
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("pi command failed: %s", message)
	}
	return nil
}

func mutatePiExtensionsList(settingsPath string, r *http.Request, add bool) error {
	var req mutatePiExtensionRequest
	if err := decodeJSON(r, &req); err != nil {
		return fmt.Errorf("invalid request body")
	}
	extensionPath := strings.TrimSpace(req.Path)
	if extensionPath == "" {
		return fmt.Errorf("invalid request body")
	}

	settings, err := loadMutablePiSettings(settingsPath)
	if err != nil {
		return err
	}

	values := extractStringSlice(settings["extensions"])
	if add {
		if !stringSliceContains(values, extensionPath) {
			values = append(values, extensionPath)
		}
	} else {
		filtered := make([]string, 0, len(values))
		for _, value := range values {
			if value != extensionPath {
				filtered = append(filtered, value)
			}
		}
		values = filtered
	}

	settings["extensions"] = stringSliceToAny(values)
	return saveMutablePiSettings(settingsPath, settings)
}

func loadMutablePiSettings(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return map[string]any{}, nil
	}
	var settings map[string]any
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	if settings == nil {
		settings = map[string]any{}
	}
	return settings, nil
}

func saveMutablePiSettings(path string, settings map[string]any) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to format JSON: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create pi config directory: %w", err)
	}
	if err := writeFileAtomic(path, append(data, '\n'), 0644); err != nil {
		return fmt.Errorf("failed to write pi config: %w", err)
	}
	return nil
}

func extractStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if asString, ok := item.(string); ok && strings.TrimSpace(asString) != "" {
			result = append(result, strings.TrimSpace(asString))
		}
	}
	return result
}

func stringSliceToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func stringSliceContains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
