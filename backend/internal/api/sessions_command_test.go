package api

import "testing"

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

func TestBuildSessionCommand_SafeDefaults(t *testing.T) {
	t.Setenv("CODEBURG_UNSAFE_AGENT_DEFAULTS", "")

	_, claudeArgs := buildSessionCommand(StartSessionRequest{Provider: "claude"}, "", "")
	if containsArg(claudeArgs, "--dangerously-skip-permissions") {
		t.Fatalf("expected claude safe defaults, got args %v", claudeArgs)
	}

	_, codexArgs := buildSessionCommand(StartSessionRequest{Provider: "codex"}, "", "")
	if containsArg(codexArgs, "--full-auto") {
		t.Fatalf("expected codex safe defaults, got args %v", codexArgs)
	}
}

func TestBuildSessionCommand_UnsafeDefaultsOptIn(t *testing.T) {
	t.Setenv("CODEBURG_UNSAFE_AGENT_DEFAULTS", "true")

	_, claudeArgs := buildSessionCommand(StartSessionRequest{Provider: "claude"}, "", "")
	if !containsArg(claudeArgs, "--dangerously-skip-permissions") {
		t.Fatalf("expected claude unsafe opt-in flag, got args %v", claudeArgs)
	}

	_, codexArgs := buildSessionCommand(StartSessionRequest{Provider: "codex"}, "", "")
	if !containsArg(codexArgs, "--full-auto") {
		t.Fatalf("expected codex unsafe opt-in flag, got args %v", codexArgs)
	}
}
