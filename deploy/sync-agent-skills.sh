#!/usr/bin/env bash
# Sync Codeburg-managed agent skills into user-level agent directories.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${CODEBURG_SKILL_BIN_DIR:-${HOME}/go/bin}"
CODEX_SKILLS_DIR="${CODEBURG_CODEX_SKILLS_DIR:-${HOME}/.codex/skills}"
AGENTS_SKILLS_DIR="${CODEBURG_AGENTS_SKILLS_DIR:-${HOME}/.agents/skills}"
CLAUDE_SKILLS_DIR="${CODEBURG_CLAUDE_SKILLS_DIR:-${HOME}/.claude/skills}"

log() {
    echo "[skill-sync] $*"
}

sync_tree() {
    local src="$1"
    local dst="$2"
    local tmp

    if [[ ! -d "$src" ]]; then
        log "skip: source directory missing: $src"
        return 0
    fi

    tmp="${dst}.tmp.$$"
    rm -rf "$tmp"
    mkdir -p "$tmp"
    cp -a "$src"/. "$tmp"/

    mkdir -p "$(dirname "$dst")"
    rm -rf "$dst"
    mv "$tmp" "$dst"

    log "synced: $dst"
}

install_executable() {
    local src="$1"
    local dst="$2"
    local tmp

    if [[ ! -f "$src" ]]; then
        log "skip: executable source missing: $src"
        return 0
    fi

    mkdir -p "$(dirname "$dst")"
    tmp="${dst}.tmp.$$"
    cp "$src" "$tmp"
    chmod 0755 "$tmp"
    mv "$tmp" "$dst"

    log "installed: $dst"
}

install_executable "${REPO_DIR}/scripts/codeburg-task" "${BIN_DIR}/codeburg-task"

sync_tree "${REPO_DIR}/skills/codex/codeburg-task" "${CODEX_SKILLS_DIR}/codeburg-task"
# Also sync to ~/.agents/skills for runtimes using the new Codex path.
sync_tree "${REPO_DIR}/skills/codex/codeburg-task" "${AGENTS_SKILLS_DIR}/codeburg-task"
sync_tree "${REPO_DIR}/skills/claude/codeburg-task" "${CLAUDE_SKILLS_DIR}/codeburg-task"

log "done"
