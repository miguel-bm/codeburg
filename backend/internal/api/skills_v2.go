package api

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
)

type managedSkill struct {
	Name        string  `json:"name"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Path        string  `json:"path"`
	Scope       string  `json:"scope"`
	Target      string  `json:"target"`
	SourcePath  *string `json:"sourcePath,omitempty"`
	Symlinked   bool    `json:"symlinked"`
}

type projectSkillsResponse struct {
	Installed []managedSkill `json:"installed"`
	Available []managedSkill `json:"available"`
}

type installProjectSkillRequest struct {
	SourcePath string `json:"sourcePath"`
	Target     string `json:"target,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Name       string `json:"name,omitempty"`
}

type curatedSkillCatalogSource struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	RepoURL       string   `json:"repoUrl"`
	RepoRef       string   `json:"repoRef"`
	SkillPrefixes []string `json:"skillPrefixes"`
	BuiltIn       bool     `json:"builtIn"`
}

type curatedSkillCatalogEntry struct {
	SourceID    string  `json:"sourceId"`
	SourceName  string  `json:"sourceName"`
	RepoURL     string  `json:"repoUrl"`
	RepoRef     string  `json:"repoRef"`
	SkillPath   string  `json:"skillPath"`
	Name        string  `json:"name"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
}

type installCatalogSkillRequest struct {
	SourceID  string `json:"sourceId"`
	SkillPath string `json:"skillPath"`
	Target    string `json:"target,omitempty"`
	Name      string `json:"name,omitempty"`
}

type createSkillCatalogSourceRequest struct {
	Name          string   `json:"name"`
	RepoURL       string   `json:"repoUrl"`
	RepoRef       string   `json:"repoRef"`
	SkillPrefixes []string `json:"skillPrefixes"`
}

const customSkillCatalogSourcesPreferenceKey = "v2_skill_catalog_sources"

var curatedSkillCatalogSources = []curatedSkillCatalogSource{
	{
		ID:            "openai-curated",
		Name:          "OpenAI Curated Skills",
		RepoURL:       "https://github.com/openai/skills.git",
		RepoRef:       "main",
		SkillPrefixes: []string{"skills/.curated/"},
		BuiltIn:       true,
	},
	{
		ID:            "cloudflare",
		Name:          "Cloudflare Skills",
		RepoURL:       "https://github.com/cloudflare/skills.git",
		RepoRef:       "main",
		SkillPrefixes: []string{"skills/"},
		BuiltIn:       true,
	},
}

func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	skills, err := discoverGlobalSkills()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to discover skills")
		return
	}
	writeJSON(w, http.StatusOK, skills)
}

func (s *Server) handleListProjectSkills(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	installed, err := discoverSkillsForRoots(projectSkillRoots(project.Path), "project")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to discover project skills")
		return
	}
	available, err := discoverGlobalSkills()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to discover global skills")
		return
	}
	writeJSON(w, http.StatusOK, projectSkillsResponse{
		Installed: installed,
		Available: available,
	})
}

func (s *Server) handleListSkillCatalog(w http.ResponseWriter, r *http.Request) {
	sources, err := s.skillCatalogSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load skill catalog sources")
		return
	}
	entries, err := discoverCuratedSkillCatalog(sources)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to discover remote skill catalog")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) handleListSkillCatalogSources(w http.ResponseWriter, r *http.Request) {
	sources, err := s.skillCatalogSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load skill catalog sources")
		return
	}
	writeJSON(w, http.StatusOK, sources)
}

func (s *Server) handleCreateSkillCatalogSource(w http.ResponseWriter, r *http.Request) {
	var req createSkillCatalogSourceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	source := normalizeCustomSkillCatalogSource(req)
	if source.Name == "" {
		writeError(w, http.StatusBadRequest, "catalog name is required")
		return
	}
	if source.RepoURL == "" {
		writeError(w, http.StatusBadRequest, "catalog repository or local path is required")
		return
	}

	sources, err := s.skillCatalogSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load skill catalog sources")
		return
	}
	source.ID = uniqueSkillCatalogSourceID(source.Name, source.RepoURL, sources)

	checkedOutDir, err := checkoutCatalogRepo(source)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to fetch catalog source")
		return
	}
	entries, scanErr := scanCuratedSkillCatalogRepo(checkedOutDir, source)
	_ = os.RemoveAll(checkedOutDir)
	if scanErr != nil || len(entries) == 0 {
		writeError(w, http.StatusBadRequest, "catalog source did not expose any skills")
		return
	}

	customSources, err := s.customSkillCatalogSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load custom catalog sources")
		return
	}
	customSources = append(customSources, source)
	if err := s.saveCustomSkillCatalogSources(customSources); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save catalog source")
		return
	}
	writeJSON(w, http.StatusCreated, source)
}

func (s *Server) handleDeleteSkillCatalogSource(w http.ResponseWriter, r *http.Request) {
	sourceID := strings.TrimSpace(urlParam(r, "sourceId"))
	if sourceID == "" {
		writeError(w, http.StatusBadRequest, "catalog source id is required")
		return
	}
	for _, source := range curatedSkillCatalogSources {
		if source.ID == sourceID {
			writeError(w, http.StatusBadRequest, "built-in catalog sources cannot be removed")
			return
		}
	}

	customSources, err := s.customSkillCatalogSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load custom catalog sources")
		return
	}
	nextSources := customSources[:0]
	removed := false
	for _, source := range customSources {
		if source.ID == sourceID {
			removed = true
			continue
		}
		nextSources = append(nextSources, source)
	}
	if !removed {
		writeError(w, http.StatusNotFound, "catalog source not found")
		return
	}
	if err := s.saveCustomSkillCatalogSources(nextSources); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save catalog source")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleInstallGlobalSkill(w http.ResponseWriter, r *http.Request) {
	var req installProjectSkillRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sourcePath := strings.TrimSpace(req.SourcePath)
	if sourcePath == "" {
		writeError(w, http.StatusBadRequest, "sourcePath is required")
		return
	}

	target := normalizeSkillTarget(req.Target)
	skill, err := inspectSkillDir(sourcePath, "external", target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	destinationRoot, err := globalSkillRoot(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	installed, status, message := installSkillDirectory(sourcePath, destinationRoot, strings.TrimSpace(req.Name), normalizeSkillMode(req.Mode), "global", target, skill.Name)
	if message != "" {
		writeError(w, status, message)
		return
	}
	writeJSON(w, http.StatusCreated, installed)
}

func (s *Server) handleInstallProjectSkill(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req installProjectSkillRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sourcePath := strings.TrimSpace(req.SourcePath)
	if sourcePath == "" {
		writeError(w, http.StatusBadRequest, "sourcePath is required")
		return
	}
	skill, err := inspectSkillDir(sourcePath, "external", normalizeSkillTarget(req.Target))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	target := normalizeSkillTarget(req.Target)
	destinationRoot, err := projectSkillRoot(project.Path, target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = skill.Name
	}
	destinationPath := filepath.Join(destinationRoot, name)
	if _, err := os.Lstat(destinationPath); err == nil {
		writeError(w, http.StatusConflict, "skill already installed at target path")
		return
	} else if !os.IsNotExist(err) {
		writeError(w, http.StatusInternalServerError, "failed to inspect target path")
		return
	}

	if err := os.MkdirAll(destinationRoot, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create target skill directory")
		return
	}

	mode := normalizeSkillMode(req.Mode)
	if mode == "copy" {
		if err := copyDir(sourcePath, destinationPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to copy skill")
			return
		}
	} else {
		if err := os.Symlink(sourcePath, destinationPath); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to link skill")
			return
		}
	}

	installed, err := inspectSkillDir(destinationPath, "project", target)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to inspect installed skill")
		return
	}
	writeJSON(w, http.StatusCreated, installed)
}

func (s *Server) handleDeleteGlobalSkill(w http.ResponseWriter, r *http.Request) {
	target := normalizeSkillTarget(urlParam(r, "target"))
	name := strings.TrimSpace(urlParam(r, "name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "skill name is required")
		return
	}

	root, err := globalSkillRoot(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	path := filepath.Join(root, name)
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "skill not installed")
		return
	}
	if err := os.RemoveAll(path); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove global skill")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteProjectSkill(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	target := normalizeSkillTarget(urlParam(r, "target"))
	name := strings.TrimSpace(urlParam(r, "name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "skill name is required")
		return
	}

	root, err := projectSkillRoot(project.Path, target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	path := filepath.Join(root, name)
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "skill not installed")
		return
	}
	if err := os.RemoveAll(path); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove project skill")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleInstallCatalogSkill(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	project, err := s.db.GetProject(projectID)
	if err != nil {
		writeDBError(w, err, "project")
		return
	}

	var req installCatalogSkillRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	source, ok, err := s.findSkillCatalogSource(req.SourceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load skill catalog sources")
		return
	}
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown skill catalog source")
		return
	}

	target := normalizeSkillTarget(req.Target)
	destinationRoot, err := projectSkillRoot(project.Path, target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	checkedOutDir, err := checkoutCatalogRepo(source)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch skill catalog source")
		return
	}
	defer os.RemoveAll(checkedOutDir)

	relativeSkillPath := strings.TrimSpace(req.SkillPath)
	if relativeSkillPath == "" {
		writeError(w, http.StatusBadRequest, "skillPath is required")
		return
	}
	skillDir := filepath.Join(checkedOutDir, filepath.Clean(relativeSkillPath))
	skill, err := inspectSkillDir(skillDir, "catalog", target)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to inspect catalog skill")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = skill.Name
	}
	destinationPath := filepath.Join(destinationRoot, name)
	if _, err := os.Lstat(destinationPath); err == nil {
		writeError(w, http.StatusConflict, "skill already installed at target path")
		return
	} else if !os.IsNotExist(err) {
		writeError(w, http.StatusInternalServerError, "failed to inspect target path")
		return
	}

	if err := os.MkdirAll(destinationRoot, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create target skill directory")
		return
	}
	if err := copyDir(skillDir, destinationPath); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to copy catalog skill")
		return
	}

	installed, err := inspectSkillDir(destinationPath, "project", target)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to inspect installed skill")
		return
	}
	writeJSON(w, http.StatusCreated, installed)
}

func (s *Server) handleInstallGlobalCatalogSkill(w http.ResponseWriter, r *http.Request) {
	var req installCatalogSkillRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	source, ok, err := s.findSkillCatalogSource(req.SourceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load skill catalog sources")
		return
	}
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown skill catalog source")
		return
	}

	target := normalizeSkillTarget(req.Target)
	destinationRoot, err := globalSkillRoot(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	checkedOutDir, err := checkoutCatalogRepo(source)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch skill catalog source")
		return
	}
	defer os.RemoveAll(checkedOutDir)

	relativeSkillPath := strings.TrimSpace(req.SkillPath)
	if relativeSkillPath == "" {
		writeError(w, http.StatusBadRequest, "skillPath is required")
		return
	}
	skillDir := filepath.Join(checkedOutDir, filepath.Clean(relativeSkillPath))
	skill, err := inspectSkillDir(skillDir, "catalog", target)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to inspect catalog skill")
		return
	}

	installed, status, message := installSkillDirectory(skillDir, destinationRoot, strings.TrimSpace(req.Name), "copy", "global", target, skill.Name)
	if message != "" {
		writeError(w, status, message)
		return
	}
	writeJSON(w, http.StatusCreated, installed)
}

func installSkillDirectory(sourcePath, destinationRoot, name, mode, scope, target, fallbackName string) (managedSkill, int, string) {
	if name == "" {
		name = fallbackName
	}
	destinationPath := filepath.Join(destinationRoot, name)
	if _, err := os.Lstat(destinationPath); err == nil {
		return managedSkill{}, http.StatusConflict, "skill already installed at target path"
	} else if !os.IsNotExist(err) {
		return managedSkill{}, http.StatusInternalServerError, "failed to inspect target path"
	}

	if err := os.MkdirAll(destinationRoot, 0755); err != nil {
		return managedSkill{}, http.StatusInternalServerError, "failed to create target skill directory"
	}
	if mode == "copy" {
		if err := copyDir(sourcePath, destinationPath); err != nil {
			return managedSkill{}, http.StatusInternalServerError, "failed to copy skill"
		}
	} else if err := os.Symlink(sourcePath, destinationPath); err != nil {
		return managedSkill{}, http.StatusInternalServerError, "failed to link skill"
	}

	installed, err := inspectSkillDir(destinationPath, scope, target)
	if err != nil {
		return managedSkill{}, http.StatusInternalServerError, "failed to inspect installed skill"
	}
	return installed, http.StatusCreated, ""
}

func discoverGlobalSkills() ([]managedSkill, error) {
	return discoverSkillsForRoots(globalSkillRoots(), "global")
}

func discoverCuratedSkillCatalog(sources []curatedSkillCatalogSource) ([]curatedSkillCatalogEntry, error) {
	entries := make([]curatedSkillCatalogEntry, 0)
	for _, source := range sources {
		checkedOutDir, err := checkoutCatalogRepo(source)
		if err != nil {
			return nil, err
		}

		sourceEntries, err := scanCuratedSkillCatalogRepo(checkedOutDir, source)
		_ = os.RemoveAll(checkedOutDir)
		if err != nil {
			return nil, err
		}
		entries = append(entries, sourceEntries...)
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].SourceName == entries[j].SourceName {
			return entries[i].Title < entries[j].Title
		}
		return entries[i].SourceName < entries[j].SourceName
	})
	return entries, nil
}

func discoverSkillsForRoots(roots map[string]string, scope string) ([]managedSkill, error) {
	discovered := make([]managedSkill, 0)
	for target, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
				continue
			}
			skillPath := filepath.Join(root, entry.Name())
			skill, err := inspectSkillDir(skillPath, scope, target)
			if err != nil {
				continue
			}
			discovered = append(discovered, skill)
		}
	}
	sort.Slice(discovered, func(i, j int) bool {
		if discovered[i].Target == discovered[j].Target {
			return discovered[i].Name < discovered[j].Name
		}
		return discovered[i].Target < discovered[j].Target
	})
	return discovered, nil
}

func inspectSkillDir(path, scope, target string) (managedSkill, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return managedSkill{}, err
	}
	if !info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return managedSkill{}, fmt.Errorf("skill path must be a directory")
	}
	skillFile := filepath.Join(path, "SKILL.md")
	if _, err := os.Stat(skillFile); err != nil {
		return managedSkill{}, fmt.Errorf("missing SKILL.md in %s", path)
	}

	content, err := os.ReadFile(skillFile)
	if err != nil {
		return managedSkill{}, err
	}
	title, description := parseSkillMetadata(string(content), filepath.Base(path))
	sourcePath, symlinked := resolveSymlink(path)

	skill := managedSkill{
		Name:      filepath.Base(path),
		Title:     title,
		Path:      path,
		Scope:     scope,
		Target:    target,
		Symlinked: symlinked,
	}
	if description != "" {
		skill.Description = &description
	}
	if sourcePath != "" && sourcePath != path {
		skill.SourcePath = &sourcePath
	}
	return skill, nil
}

func parseSkillMetadata(content, fallback string) (string, string) {
	lines := strings.Split(content, "\n")
	title := fallback
	description := ""

	inFrontmatter := false
	for index, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if index == 0 && line == "---" {
			inFrontmatter = true
			continue
		}
		if inFrontmatter {
			if line == "---" {
				inFrontmatter = false
				continue
			}
			if strings.HasPrefix(line, "name:") {
				title = strings.TrimSpace(strings.Trim(strings.TrimPrefix(line, "name:"), `"'`))
			}
			if strings.HasPrefix(line, "description:") {
				description = strings.TrimSpace(strings.Trim(strings.TrimPrefix(line, "description:"), `"'`))
			}
			continue
		}
		if strings.HasPrefix(line, "# ") {
			title = strings.TrimSpace(strings.TrimPrefix(line, "# "))
			break
		}
	}
	return title, description
}

func resolveSymlink(path string) (string, bool) {
	realPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", false
	}
	return realPath, realPath != path
}

func normalizeSkillTarget(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", "agents", "universal":
		return "agents"
	case "codex":
		return "codex"
	case "claude":
		return "claude"
	default:
		return strings.TrimSpace(strings.ToLower(value))
	}
}

func normalizeSkillMode(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "copy") {
		return "copy"
	}
	return "symlink"
}

func (s *Server) skillCatalogSources() ([]curatedSkillCatalogSource, error) {
	customSources, err := s.customSkillCatalogSources()
	if err != nil {
		return nil, err
	}
	sources := make([]curatedSkillCatalogSource, 0, len(curatedSkillCatalogSources)+len(customSources))
	for _, source := range curatedSkillCatalogSources {
		source.BuiltIn = true
		sources = append(sources, source)
	}
	for _, source := range customSources {
		source.BuiltIn = false
		sources = append(sources, source)
	}
	return sources, nil
}

func (s *Server) customSkillCatalogSources() ([]curatedSkillCatalogSource, error) {
	pref, err := s.db.GetPreference(db.DefaultUserID, customSkillCatalogSourcesPreferenceKey)
	if err != nil {
		if err == db.ErrNotFound {
			return []curatedSkillCatalogSource{}, nil
		}
		return nil, err
	}
	var sources []curatedSkillCatalogSource
	if err := json.Unmarshal([]byte(pref.Value), &sources); err != nil {
		return nil, err
	}
	for index := range sources {
		sources[index] = normalizeStoredSkillCatalogSource(sources[index])
	}
	return sources, nil
}

func (s *Server) saveCustomSkillCatalogSources(sources []curatedSkillCatalogSource) error {
	clean := make([]curatedSkillCatalogSource, 0, len(sources))
	for _, source := range sources {
		source = normalizeStoredSkillCatalogSource(source)
		if source.ID == "" || source.Name == "" || source.RepoURL == "" {
			continue
		}
		clean = append(clean, source)
	}
	raw, err := json.Marshal(clean)
	if err != nil {
		return err
	}
	_, err = s.db.SetPreference(db.DefaultUserID, customSkillCatalogSourcesPreferenceKey, string(raw))
	return err
}

func (s *Server) findSkillCatalogSource(id string) (curatedSkillCatalogSource, bool, error) {
	sources, err := s.skillCatalogSources()
	if err != nil {
		return curatedSkillCatalogSource{}, false, err
	}
	for _, source := range sources {
		if source.ID == strings.TrimSpace(id) {
			return source, true, nil
		}
	}
	return curatedSkillCatalogSource{}, false, nil
}

func normalizeCustomSkillCatalogSource(req createSkillCatalogSourceRequest) curatedSkillCatalogSource {
	return normalizeStoredSkillCatalogSource(curatedSkillCatalogSource{
		Name:          req.Name,
		RepoURL:       req.RepoURL,
		RepoRef:       req.RepoRef,
		SkillPrefixes: req.SkillPrefixes,
	})
}

func normalizeStoredSkillCatalogSource(source curatedSkillCatalogSource) curatedSkillCatalogSource {
	source.ID = strings.TrimSpace(source.ID)
	source.Name = strings.TrimSpace(source.Name)
	source.RepoURL = strings.TrimSpace(source.RepoURL)
	source.RepoRef = strings.TrimSpace(source.RepoRef)
	if source.RepoRef == "" {
		source.RepoRef = "main"
	}
	prefixes := make([]string, 0, len(source.SkillPrefixes))
	for _, prefix := range source.SkillPrefixes {
		prefix = filepath.ToSlash(strings.TrimSpace(prefix))
		if prefix == "" {
			continue
		}
		if !strings.HasSuffix(prefix, "/") {
			prefix += "/"
		}
		prefixes = append(prefixes, prefix)
	}
	if len(prefixes) == 0 {
		prefixes = []string{"skills/"}
	}
	source.SkillPrefixes = prefixes
	source.BuiltIn = false
	return source
}

func uniqueSkillCatalogSourceID(name, repoURL string, sources []curatedSkillCatalogSource) string {
	base := "custom-" + slugifySkillCatalogSourceID(name)
	if base == "custom-" {
		base = "custom-catalog"
	}
	if !skillCatalogSourceIDExists(base, sources) {
		return base
	}
	suffix := shortSkillCatalogSourceSuffix(repoURL)
	candidate := base + "-" + suffix
	if !skillCatalogSourceIDExists(candidate, sources) {
		return candidate
	}
	for index := 2; ; index++ {
		candidate = fmt.Sprintf("%s-%s-%d", base, suffix, index)
		if !skillCatalogSourceIDExists(candidate, sources) {
			return candidate
		}
	}
}

func slugifySkillCatalogSourceID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			continue
		}
		if builder.Len() > 0 {
			last := builder.String()[builder.Len()-1]
			if last != '-' {
				builder.WriteByte('-')
			}
		}
	}
	return strings.Trim(builder.String(), "-")
}

func skillCatalogSourceIDExists(id string, sources []curatedSkillCatalogSource) bool {
	for _, source := range sources {
		if source.ID == id {
			return true
		}
	}
	return false
}

func shortSkillCatalogSourceSuffix(value string) string {
	hash := uint32(2166136261)
	for _, char := range value {
		hash ^= uint32(char)
		hash *= 16777619
	}
	return fmt.Sprintf("%08x", hash)[:6]
}

func checkoutCatalogRepo(source curatedSkillCatalogSource) (string, error) {
	tmpDir, err := os.MkdirTemp("", "codeburg-skill-catalog-*")
	if err != nil {
		return "", err
	}

	if isLocalCatalogSource(source.RepoURL) {
		if err := copyDir(source.RepoURL, tmpDir); err != nil {
			_ = os.RemoveAll(tmpDir)
			return "", fmt.Errorf("copy %s: %w", source.Name, err)
		}
		return tmpDir, nil
	}

	args := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(source.RepoRef) != "" {
		args = append(args, "--branch", source.RepoRef)
	}
	args = append(args, source.RepoURL, tmpDir)
	cmd := exec.Command("git", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		_ = os.RemoveAll(tmpDir)
		return "", fmt.Errorf("clone %s: %s", source.Name, strings.TrimSpace(string(output)))
	}
	return tmpDir, nil
}

func isLocalCatalogSource(value string) bool {
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, ".") {
		if info, err := os.Stat(value); err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

func scanCuratedSkillCatalogRepo(root string, source curatedSkillCatalogSource) ([]curatedSkillCatalogEntry, error) {
	entries := make([]curatedSkillCatalogEntry, 0)
	seen := map[string]bool{}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.EqualFold(d.Name(), "SKILL.md") {
			return nil
		}

		relSkillFile, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relSkillFile = filepath.ToSlash(relSkillFile)
		if !matchesCuratedSkillPrefix(relSkillFile, source.SkillPrefixes) {
			return nil
		}

		relSkillDir := filepath.ToSlash(filepath.Dir(relSkillFile))
		if seen[relSkillDir] {
			return nil
		}
		seen[relSkillDir] = true

		skill, err := inspectSkillDir(filepath.Dir(path), "catalog", "agents")
		if err != nil {
			return nil
		}
		entry := curatedSkillCatalogEntry{
			SourceID:    source.ID,
			SourceName:  source.Name,
			RepoURL:     source.RepoURL,
			RepoRef:     source.RepoRef,
			SkillPath:   relSkillDir,
			Name:        skill.Name,
			Title:       skill.Title,
			Description: skill.Description,
		}
		entries = append(entries, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Title < entries[j].Title
	})
	return entries, nil
}

func matchesCuratedSkillPrefix(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(path, filepath.ToSlash(prefix)) {
			return true
		}
	}
	return false
}

func globalSkillRoots() map[string]string {
	home, _ := os.UserHomeDir()
	return map[string]string{
		"agents": filepath.Join(home, ".agents", "skills"),
		"claude": filepath.Join(home, ".claude", "skills"),
		"codex":  filepath.Join(home, ".codex", "skills"),
	}
}

func globalSkillRoot(target string) (string, error) {
	roots := globalSkillRoots()
	root, ok := roots[target]
	if !ok {
		return "", fmt.Errorf("unsupported skill target")
	}
	return root, nil
}

func projectSkillRoots(projectPath string) map[string]string {
	return map[string]string{
		"agents": filepath.Join(projectPath, ".agents", "skills"),
		"claude": filepath.Join(projectPath, ".claude", "skills"),
		"codex":  filepath.Join(projectPath, ".codex", "skills"),
	}
}

func projectSkillRoot(projectPath, target string) (string, error) {
	roots := projectSkillRoots(projectPath)
	root, ok := roots[target]
	if !ok {
		return "", fmt.Errorf("unsupported skill target")
	}
	return root, nil
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(targetPath, 0755)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return err
		}
		return copyFile(path, targetPath)
	})
}

func copyFile(src, dst string) error {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return err
	}

	target, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer target.Close()

	_, err = io.Copy(target, source)
	return err
}
