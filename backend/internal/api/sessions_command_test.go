package api

import (
	"strings"
	"testing"
)

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

func TestBuildChatTurnCommand_Claude(t *testing.T) {
	t.Setenv("CODEBURG_UNSAFE_AGENT_DEFAULTS", "")
	t.Setenv("CODEBURG_CHAT_AUTO_APPROVE", "")

	command, args, err := buildChatTurnCommand("claude", "fix tests", "claude-sonnet", "provider-session-1")
	if err != nil {
		t.Fatalf("buildChatTurnCommand: %v", err)
	}
	if command != "claude" {
		t.Fatalf("expected command claude, got %q", command)
	}
	if !containsArg(args, "--print") || !containsArg(args, "--output-format") || !containsArg(args, "stream-json") {
		t.Fatalf("expected stream-json print args, got %v", args)
	}
	if !containsArg(args, "--resume") || !containsArg(args, "provider-session-1") {
		t.Fatalf("expected resume args, got %v", args)
	}
	if !containsArg(args, "--model") || !containsArg(args, "claude-sonnet") {
		t.Fatalf("expected model args, got %v", args)
	}
	if !containsArg(args, "--dangerously-skip-permissions") {
		t.Fatalf("expected chat mode to auto-approve permissions, got args %v", args)
	}
}

func TestBuildChatTurnCommand_CodexResume(t *testing.T) {
	t.Setenv("CODEBURG_UNSAFE_AGENT_DEFAULTS", "")
	t.Setenv("CODEBURG_CHAT_AUTO_APPROVE", "")

	command, args, err := buildChatTurnCommand("codex", "continue", "gpt-5-codex", "session-123")
	if err != nil {
		t.Fatalf("buildChatTurnCommand: %v", err)
	}
	if command != "codex" {
		t.Fatalf("expected command codex, got %q", command)
	}
	if len(args) < 3 || args[0] != "exec" || args[1] != "resume" || args[2] != "--json" {
		t.Fatalf("unexpected resume args prefix: %v", args)
	}
	if !containsArg(args, "--full-auto") {
		t.Fatalf("expected --full-auto in args, got %v", args)
	}
	if !containsArg(args, "session-123") {
		t.Fatalf("expected session id in args, got %v", args)
	}
}

func TestBuildChatTurnCommand_ChatAutoApproveOptOut(t *testing.T) {
	t.Setenv("CODEBURG_UNSAFE_AGENT_DEFAULTS", "")
	t.Setenv("CODEBURG_CHAT_AUTO_APPROVE", "false")

	_, claudeArgs, err := buildChatTurnCommand("claude", "hi", "", "")
	if err != nil {
		t.Fatalf("buildChatTurnCommand(claude): %v", err)
	}
	if containsArg(claudeArgs, "--dangerously-skip-permissions") {
		t.Fatalf("expected claude chat auto-approval disabled, got args %v", claudeArgs)
	}

	_, codexArgs, err := buildChatTurnCommand("codex", "hi", "", "")
	if err != nil {
		t.Fatalf("buildChatTurnCommand(codex): %v", err)
	}
	if containsArg(codexArgs, "--full-auto") {
		t.Fatalf("expected codex chat auto-approval disabled, got args %v", codexArgs)
	}
}

func TestResolveSessionType_Defaults(t *testing.T) {
	if got := resolveSessionType(StartSessionRequest{Provider: "claude"}); got != "chat" {
		t.Fatalf("expected claude default chat, got %q", got)
	}
	if got := resolveSessionType(StartSessionRequest{Provider: "codex"}); got != "chat" {
		t.Fatalf("expected codex default chat, got %q", got)
	}
	if got := resolveSessionType(StartSessionRequest{Provider: "terminal"}); got != "terminal" {
		t.Fatalf("expected terminal default terminal, got %q", got)
	}
	if got := resolveSessionType(StartSessionRequest{Provider: "claude", SessionType: "terminal"}); got != "terminal" {
		t.Fatalf("expected explicit session type to win, got %q", got)
	}
}

func TestBuildSessionCommand_TerminalPromptKeepsShellOpen(t *testing.T) {
	t.Setenv("SHELL", "/bin/zsh")

	command, args := buildSessionCommand(StartSessionRequest{
		Provider: "terminal",
		Prompt:   "just test",
	}, "", "")

	if command != "/bin/zsh" {
		t.Fatalf("expected shell command /bin/zsh, got %q", command)
	}
	if len(args) != 2 || args[0] != "-lc" {
		t.Fatalf("expected args [-lc <command>], got %v", args)
	}
	if !strings.Contains(args[1], "just test") {
		t.Fatalf("expected prompt command in shell expression, got %q", args[1])
	}
	if !strings.Contains(args[1], "exec '/bin/zsh' -i") {
		t.Fatalf("expected interactive shell handoff after prompt, got %q", args[1])
	}
}
