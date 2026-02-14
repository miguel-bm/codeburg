#!/usr/bin/env bash
# Checks whether server runtime has the tools needed to develop Codeburg from within Codeburg.
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

required_cmds=(git go node npm pnpm just bash)
optional_cmds=(gh cloudflared claude codex)
frontend_bins=(tsc vite vitest eslint)

echo "==> Runtime tooling check"
echo "    root: ${ROOT_DIR}"
echo

missing_required=()

echo "Required commands:"
for cmd in "${required_cmds[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1; then
        version="$("$cmd" --version 2>/dev/null | head -n 1 || true)"
        printf "  [ok]  %-12s %s\n" "$cmd" "$version"
    else
        printf "  [missing] %s\n" "$cmd"
        missing_required+=("$cmd")
    fi
done

echo
echo "Optional commands:"
for cmd in "${optional_cmds[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1; then
        version="$("$cmd" --version 2>/dev/null | head -n 1 || true)"
        printf "  [ok]  %-12s %s\n" "$cmd" "$version"
    else
        printf "  [skip] %-12s not installed\n" "$cmd"
    fi
done

echo
echo "Frontend toolchain (via pnpm exec):"
if [[ ! -f "${ROOT_DIR}/frontend/package.json" ]]; then
    echo "  [skip] frontend/package.json not found"
elif [[ ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
    echo "  [missing] frontend/node_modules"
    echo "           run: pnpm --dir ${ROOT_DIR}/frontend install --frozen-lockfile"
    missing_required+=("frontend/node_modules")
else
    for bin in "${frontend_bins[@]}"; do
        if pnpm --dir "${ROOT_DIR}/frontend" exec "$bin" --version >/dev/null 2>&1; then
            version="$(pnpm --dir "${ROOT_DIR}/frontend" exec "$bin" --version 2>/dev/null | head -n 1 || true)"
            printf "  [ok]  %-12s %s\n" "$bin" "$version"
        else
            printf "  [missing] %s (via pnpm exec)\n" "$bin"
            missing_required+=("$bin")
        fi
    done
fi

echo
if [[ ${#missing_required[@]} -eq 0 ]]; then
    echo "PASS: runtime is ready for Codeburg self-development workflows."
else
    echo "FAIL: missing required items:"
    for item in "${missing_required[@]}"; do
        echo "  - ${item}"
    done
    exit 1
fi
