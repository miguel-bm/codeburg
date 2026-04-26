#!/usr/bin/env bash
# Install or update user-level runtime tools for the current user.
set -euo pipefail

TOOL="${1:-}"
if [[ -z "${TOOL}" ]]; then
    echo "Usage: $0 <tool>"
    echo "Supported tools: codex, pi, claude"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/configure-runtime-user-env.sh" >/dev/null
. "${HOME}/.codeburg/runtime-env.sh"

case "${TOOL}" in
    codex)
        echo "==> Installing/updating Codex into ${NPM_CONFIG_PREFIX}"
        npm install -g @openai/codex@latest
        echo "==> Codex installed at $(command -v codex)"
        codex --version
        ;;
    pi)
        echo "==> Installing/updating pi into ${NPM_CONFIG_PREFIX}"
        npm install -g @mariozechner/pi-coding-agent@latest
        echo "==> pi installed at $(command -v pi)"
        pi --version
        ;;
    claude)
        if command -v claude >/dev/null 2>&1; then
            echo "==> Updating Claude Code with claude update"
            if ! claude update; then
                echo "==> claude update failed; falling back to npm install"
                npm install -g @anthropic-ai/claude-code@latest
            fi
        else
            echo "==> Claude Code not found; installing with npm into ${NPM_CONFIG_PREFIX}"
            npm install -g @anthropic-ai/claude-code@latest
        fi
        echo "==> Claude Code installed at $(command -v claude)"
        claude --version
        ;;
    *)
        echo "Unsupported tool: ${TOOL}"
        echo "Supported tools: codex, pi, claude"
        exit 1
        ;;
esac
