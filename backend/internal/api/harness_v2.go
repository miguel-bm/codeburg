package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type harnessStatusResponse struct {
	Tools         []harnessToolStatus `json:"tools"`
	Auth          []harnessAuthStatus `json:"auth"`
	Update        *harnessUpdateInfo  `json:"update,omitempty"`
	CheckedLatest bool                `json:"checkedLatest"`
	GeneratedAt   time.Time           `json:"generatedAt"`
}

type harnessToolStatus struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	PackageName   string   `json:"packageName"`
	Installed     bool     `json:"installed"`
	BinaryPath    *string  `json:"binaryPath,omitempty"`
	Version       *string  `json:"version,omitempty"`
	LatestVersion *string  `json:"latestVersion,omitempty"`
	UpdateCommand string   `json:"updateCommand"`
	ChangelogURL  string   `json:"changelogUrl"`
	InstallURL    string   `json:"installUrl"`
	LoadWarnings  []string `json:"loadWarnings,omitempty"`
}

type harnessAuthStatus struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	LoggedIn     bool     `json:"loggedIn"`
	Method       *string  `json:"method,omitempty"`
	Detail       *string  `json:"detail,omitempty"`
	Providers    []string `json:"providers,omitempty"`
	LoadWarnings []string `json:"loadWarnings,omitempty"`
}

type harnessUpdateInfo struct {
	Running   bool       `json:"running"`
	Tool      *string    `json:"tool,omitempty"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
}

type harnessToolDefinition struct {
	ID            string
	Name          string
	Binary        string
	VersionArgs   []string
	PackageName   string
	UpdateCommand string
	ChangelogURL  string
	InstallURL    string
}

type harnessUpdateState struct {
	Tool      string
	StartedAt time.Time
}

var harnessUpdateLock = struct {
	sync.Mutex
	active *harnessUpdateState
}{}

var harnessTools = []harnessToolDefinition{
	{
		ID:            "pi",
		Name:          "Pi",
		Binary:        "pi",
		VersionArgs:   []string{"--version"},
		PackageName:   "@mariozechner/pi-coding-agent",
		UpdateCommand: "npm i -g @mariozechner/pi-coding-agent@latest",
		ChangelogURL:  "https://www.npmjs.com/package/@mariozechner/pi-coding-agent?activeTab=versions",
		InstallURL:    "https://pt-act-pi-mono.mintlify.app/packages/coding-agent",
	},
	{
		ID:            "codex",
		Name:          "Codex",
		Binary:        "codex",
		VersionArgs:   []string{"--version"},
		PackageName:   "@openai/codex",
		UpdateCommand: "npm i -g @openai/codex@latest",
		ChangelogURL:  "https://developers.openai.com/codex/changelog",
		InstallURL:    "https://developers.openai.com/codex/cli",
	},
	{
		ID:            "claude",
		Name:          "Claude Code",
		Binary:        "claude",
		VersionArgs:   []string{"--version"},
		PackageName:   "@anthropic-ai/claude-code",
		UpdateCommand: "claude update",
		ChangelogURL:  "https://code.claude.com/docs/en/whats-new",
		InstallURL:    "https://code.claude.com/docs/en/cli-usage",
	},
}

func (s *Server) handleHarnessStatus(w http.ResponseWriter, r *http.Request) {
	checkLatest := r.URL.Query().Get("latest") == "1" || r.URL.Query().Get("checkLatest") == "1"
	writeJSON(w, http.StatusOK, inspectHarnessStatus(r.Context(), checkLatest))
}

func (s *Server) handleStreamHarnessToolUpdate(w http.ResponseWriter, r *http.Request) {
	toolID := urlParam(r, "tool")
	if _, ok := harnessToolByID(toolID); !ok {
		writeError(w, http.StatusBadRequest, "unsupported harness tool")
		return
	}

	release, active := acquireHarnessUpdate(toolID)
	if release == nil {
		message := "another harness update is already running"
		if active.Tool != "" {
			message = fmt.Sprintf("%s: %s", message, active.Tool)
		}
		writeError(w, http.StatusConflict, message)
		return
	}
	defer release()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	sendSSE(w, flusher, "status", map[string]any{"tool": toolID, "message": "Starting update"})

	cmd, err := harnessUpdateCommand(r.Context(), toolID)
	if err != nil {
		sendSSE(w, flusher, "error", err.Error())
		sendSSE(w, flusher, "done", map[string]any{"exitCode": 1})
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendSSE(w, flusher, "error", err.Error())
		sendSSE(w, flusher, "done", map[string]any{"exitCode": 1})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		sendSSE(w, flusher, "error", err.Error())
		sendSSE(w, flusher, "done", map[string]any{"exitCode": 1})
		return
	}

	if err := cmd.Start(); err != nil {
		sendSSE(w, flusher, "error", err.Error())
		sendSSE(w, flusher, "done", map[string]any{"exitCode": 1})
		return
	}

	type streamEvent struct {
		event string
		data  any
	}
	events := make(chan streamEvent, 64)
	readPipe := func(event string, scanner *bufio.Scanner) {
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			events <- streamEvent{event: event, data: scanner.Text()}
		}
		if err := scanner.Err(); err != nil {
			events <- streamEvent{event: "stderr", data: err.Error()}
		}
	}
	go readPipe("stdout", bufio.NewScanner(stdout))
	go readPipe("stderr", bufio.NewScanner(stderr))

	go func() {
		err := cmd.Wait()
		exitCode := 0
		if err != nil {
			exitCode = 1
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			}
		}
		events <- streamEvent{event: "done", data: map[string]any{"exitCode": exitCode}}
		close(events)
	}()

	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			sendSSE(w, flusher, ev.event, ev.data)
		case <-r.Context().Done():
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return
		}
	}
}

func inspectHarnessStatus(ctx context.Context, checkLatest bool) harnessStatusResponse {
	tools := make([]harnessToolStatus, 0, len(harnessTools))
	for _, tool := range harnessTools {
		tools = append(tools, inspectHarnessTool(ctx, tool, checkLatest))
	}
	return harnessStatusResponse{
		Tools:         tools,
		Auth:          inspectHarnessAuth(ctx),
		Update:        currentHarnessUpdate(),
		CheckedLatest: checkLatest,
		GeneratedAt:   time.Now().UTC(),
	}
}

func inspectHarnessTool(ctx context.Context, tool harnessToolDefinition, checkLatest bool) harnessToolStatus {
	status := harnessToolStatus{
		ID:            tool.ID,
		Name:          tool.Name,
		PackageName:   tool.PackageName,
		UpdateCommand: tool.UpdateCommand,
		ChangelogURL:  tool.ChangelogURL,
		InstallURL:    tool.InstallURL,
		LoadWarnings:  []string{},
	}

	if binaryPath, err := exec.LookPath(tool.Binary); err == nil {
		status.Installed = true
		status.BinaryPath = stringPtr(binaryPath)
		if version, err := commandOutput(ctx, 4*time.Second, binaryPath, tool.VersionArgs...); err == nil {
			if trimmed := strings.TrimSpace(version); trimmed != "" {
				status.Version = stringPtr(trimmed)
			}
		} else {
			status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to read version: %v", err))
		}
	}

	if checkLatest {
		if latest, err := npmLatestVersion(ctx, tool.PackageName); err == nil {
			status.LatestVersion = stringPtr(latest)
		} else {
			status.LoadWarnings = append(status.LoadWarnings, fmt.Sprintf("failed to check latest version: %v", err))
		}
	}

	if len(status.LoadWarnings) == 0 {
		status.LoadWarnings = nil
	}
	return status
}

func inspectHarnessAuth(ctx context.Context) []harnessAuthStatus {
	piStatus := inspectPiStatus()
	auth := []harnessAuthStatus{
		{
			ID:        "pi",
			Name:      "Pi",
			LoggedIn:  piStatus.AuthConfigured,
			Providers: piProviderLabels(piStatus.AuthProviders),
		},
		inspectCodexAuth(ctx),
		inspectClaudeAuth(ctx),
		{
			ID:        "pi-codex",
			Name:      "Codex through Pi",
			LoggedIn:  piHasProvider(piStatus.AuthProviders, "openai-codex"),
			Providers: piProviderLabels(filterPiProviders(piStatus.AuthProviders, "openai-codex")),
		},
	}
	if len(piStatus.LoadWarnings) > 0 {
		auth[0].LoadWarnings = piStatus.LoadWarnings
	}
	return auth
}

func inspectCodexAuth(ctx context.Context) harnessAuthStatus {
	status := harnessAuthStatus{ID: "codex", Name: "Codex", LoadWarnings: []string{}}
	binaryPath, err := exec.LookPath("codex")
	if err != nil {
		status.LoadWarnings = append(status.LoadWarnings, "codex is not installed")
		return status
	}
	output, err := commandOutput(ctx, 5*time.Second, binaryPath, "login", "status")
	trimmed := strings.TrimSpace(output)
	if err != nil {
		status.LoadWarnings = append(status.LoadWarnings, trimmedOrError(trimmed, err))
		return compactHarnessAuthStatus(status)
	}
	if trimmed != "" {
		status.Detail = stringPtr(trimmed)
	}
	lower := strings.ToLower(trimmed)
	status.LoggedIn = strings.Contains(lower, "logged in") && !strings.Contains(lower, "not logged")
	if strings.Contains(lower, "chatgpt") {
		status.Method = stringPtr("ChatGPT")
	} else if strings.Contains(lower, "api") {
		status.Method = stringPtr("API key")
	}
	return compactHarnessAuthStatus(status)
}

func inspectClaudeAuth(ctx context.Context) harnessAuthStatus {
	status := harnessAuthStatus{ID: "claude", Name: "Claude Code", LoadWarnings: []string{}}
	binaryPath, err := exec.LookPath("claude")
	if err != nil {
		status.LoadWarnings = append(status.LoadWarnings, "claude is not installed")
		return status
	}
	output, err := commandOutput(ctx, 5*time.Second, binaryPath, "auth", "status")
	trimmed := strings.TrimSpace(output)
	if err != nil {
		status.LoadWarnings = append(status.LoadWarnings, trimmedOrError(trimmed, err))
		return compactHarnessAuthStatus(status)
	}
	var raw struct {
		LoggedIn         bool   `json:"loggedIn"`
		AuthMethod       string `json:"authMethod"`
		Email            string `json:"email"`
		SubscriptionType string `json:"subscriptionType"`
	}
	if json.Unmarshal([]byte(trimmed), &raw) == nil {
		status.LoggedIn = raw.LoggedIn
		if raw.AuthMethod != "" {
			status.Method = stringPtr(raw.AuthMethod)
		}
		detailParts := []string{}
		if raw.Email != "" {
			detailParts = append(detailParts, raw.Email)
		}
		if raw.SubscriptionType != "" {
			detailParts = append(detailParts, raw.SubscriptionType)
		}
		if len(detailParts) > 0 {
			status.Detail = stringPtr(strings.Join(detailParts, " · "))
		}
	} else {
		status.LoggedIn = strings.Contains(strings.ToLower(trimmed), "loggedin") || strings.Contains(strings.ToLower(trimmed), "login method")
		if trimmed != "" {
			status.Detail = stringPtr(trimmed)
		}
	}
	return compactHarnessAuthStatus(status)
}

func compactHarnessAuthStatus(status harnessAuthStatus) harnessAuthStatus {
	if len(status.LoadWarnings) == 0 {
		status.LoadWarnings = nil
	}
	return status
}

func piProviderLabels(providers []piAuthProvider) []string {
	if len(providers) == 0 {
		return nil
	}
	labels := make([]string, 0, len(providers))
	for _, provider := range providers {
		if provider.Type != "" && provider.Type != "unknown" {
			labels = append(labels, fmt.Sprintf("%s (%s)", provider.Provider, provider.Type))
			continue
		}
		labels = append(labels, provider.Provider)
	}
	sort.Strings(labels)
	return labels
}

func filterPiProviders(providers []piAuthProvider, ids ...string) []piAuthProvider {
	allowed := make(map[string]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	filtered := make([]piAuthProvider, 0, len(providers))
	for _, provider := range providers {
		if allowed[provider.Provider] {
			filtered = append(filtered, provider)
		}
	}
	return filtered
}

func piHasProvider(providers []piAuthProvider, id string) bool {
	for _, provider := range providers {
		if provider.Provider == id {
			return true
		}
	}
	return false
}

func npmLatestVersion(ctx context.Context, packageName string) (string, error) {
	output, err := commandOutput(ctx, 8*time.Second, "npm", "view", packageName, "version", "--json")
	if err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(output)
	var parsed string
	if json.Unmarshal([]byte(trimmed), &parsed) == nil && parsed != "" {
		return parsed, nil
	}
	trimmed = strings.Trim(trimmed, "\"")
	if trimmed == "" {
		return "", fmt.Errorf("npm returned an empty version")
	}
	return trimmed, nil
}

func commandOutput(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, name, args...)
	output, err := cmd.CombinedOutput()
	if cmdCtx.Err() == context.DeadlineExceeded {
		return string(output), fmt.Errorf("%s timed out", name)
	}
	return string(output), err
}

func trimmedOrError(output string, err error) string {
	if output != "" {
		return output
	}
	return err.Error()
}

func harnessToolByID(id string) (harnessToolDefinition, bool) {
	for _, tool := range harnessTools {
		if tool.ID == id {
			return tool, true
		}
	}
	return harnessToolDefinition{}, false
}

func currentHarnessUpdate() *harnessUpdateInfo {
	harnessUpdateLock.Lock()
	defer harnessUpdateLock.Unlock()
	if harnessUpdateLock.active == nil {
		return &harnessUpdateInfo{Running: false}
	}
	tool := harnessUpdateLock.active.Tool
	startedAt := harnessUpdateLock.active.StartedAt
	return &harnessUpdateInfo{Running: true, Tool: &tool, StartedAt: &startedAt}
}

func acquireHarnessUpdate(tool string) (func(), harnessUpdateState) {
	harnessUpdateLock.Lock()
	defer harnessUpdateLock.Unlock()
	if harnessUpdateLock.active != nil {
		return nil, *harnessUpdateLock.active
	}
	harnessUpdateLock.active = &harnessUpdateState{Tool: tool, StartedAt: time.Now().UTC()}
	return func() {
		harnessUpdateLock.Lock()
		defer harnessUpdateLock.Unlock()
		harnessUpdateLock.active = nil
	}, harnessUpdateState{}
}

func harnessUpdateCommand(ctx context.Context, tool string) (*exec.Cmd, error) {
	script, err := runtimeInstallScriptPath()
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, script, tool)
	if cwd, err := os.Getwd(); err == nil {
		cmd.Dir = cwd
	}
	return cmd, nil
}

func runtimeInstallScriptPath() (string, error) {
	candidates := []string{}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "deploy", "install-runtime-tool.sh"))
	}
	candidates = append(candidates, "/opt/codeburg/deploy/install-runtime-tool.sh")
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("runtime install script not found")
}
