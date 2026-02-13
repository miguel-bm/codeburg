package api

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

func withShellFallback(command string, args []string) (string, []string) {
	if command == "" {
		return command, args
	}
	if _, err := exec.LookPath(command); err == nil {
		return command, args
	}

	// Use login shell so user-level PATH customizations are applied.
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, shellQuote(command))
	for _, arg := range args {
		parts = append(parts, shellQuote(arg))
	}
	return shell, []string{"-lc", strings.Join(parts, " ")}
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func buildSessionCommand(req StartSessionRequest, notifyScript, resumeProviderSessionID string) (string, []string) {
	switch req.Provider {
	case "claude":
		args := []string{}
		if unsafeAgentDefaultsEnabled() {
			args = append(args, "--dangerously-skip-permissions")
		}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		if req.ResumeSessionID != "" {
			if resumeProviderSessionID != "" {
				args = append(args, "--resume", resumeProviderSessionID)
			} else {
				args = append(args, "--continue")
			}
		}
		if req.Prompt != "" {
			args = append(args, req.Prompt)
		}
		return "claude", args

	case "codex":
		args := []string{}
		if unsafeAgentDefaultsEnabled() {
			args = append(args, "--full-auto")
		}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		if notifyScript != "" {
			args = append(args, "-c", fmt.Sprintf(`notify=["%s"]`, notifyScript))
		}
		if req.Prompt != "" {
			args = append(args, req.Prompt)
		}
		return "codex", args

	default: // terminal
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		if req.Prompt != "" {
			return shell, []string{"-lc", req.Prompt}
		}
		return shell, []string{"-i"}
	}
}

func unsafeAgentDefaultsEnabled() bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv("CODEBURG_UNSAFE_AGENT_DEFAULTS")))
	return value == "1" || value == "true" || value == "yes" || value == "on"
}

// validModelName matches model names safe to interpolate into shell commands.
// Must start with a letter, then letters, digits, hyphens, dots, colons, or slashes.
// e.g. "claude-sonnet-4-5-20250929", "gpt-5.2-codex", "o3", "anthropic/claude-3"
var validModelName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9\-.:\/_]*$`)

func isValidModelName(name string) bool {
	return validModelName.MatchString(name)
}
