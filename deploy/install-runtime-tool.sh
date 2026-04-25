#!/usr/bin/env bash
# Install or update user-level runtime tools for the current user.
set -euo pipefail

TOOL="${1:-}"
if [[ -z "${TOOL}" ]]; then
    echo "Usage: $0 <tool>"
    echo "Supported tools: codex, pi"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/configure-runtime-user-env.sh" >/dev/null
. "${HOME}/.codeburg/runtime-env.sh"

case "${TOOL}" in
    codex)
        echo "==> Installing/updating Codex into ${NPM_CONFIG_PREFIX}"
        npm install -g @openai/codex
        echo "==> Codex installed at $(command -v codex)"
        codex --version
        ;;
    pi)
        echo "==> Installing/updating pi into ${NPM_CONFIG_PREFIX}"
        npm install -g @mariozechner/pi-coding-agent
        echo "==> pi installed at $(command -v pi)"
        pi --version
        ;;
    *)
        echo "Unsupported tool: ${TOOL}"
        echo "Supported tools: codex, pi"
        exit 1
        ;;
esac
