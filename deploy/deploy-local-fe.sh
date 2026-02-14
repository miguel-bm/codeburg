#!/usr/bin/env bash
# Local frontend-only deploy flow used by SSH deploy-fe and self-deploy-fe.
# Usage: deploy-local-fe.sh <commit-ish> [target-dir]
set -euo pipefail

REF="${1:-}"
TARGET_DIR="${2:-/opt/codeburg}"

if [[ -z "$REF" ]]; then
    echo "Usage: $0 <commit-ish> [target-dir]"
    exit 1
fi

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd "$TARGET_DIR"

ensure_repo_writable() {
    if [[ -w "$TARGET_DIR/.git" ]]; then
        return
    fi
    if [[ "$TARGET_DIR" == "/opt/codeburg" ]]; then
        echo "==> Fixing repository ownership for ${TARGET_DIR}..."
        sudo chown -R codeburg:codeburg /opt/codeburg
        return
    fi
    echo "==> WARNING: ${TARGET_DIR}/.git is not writable and no ownership fix is configured for this path."
}

ensure_repo_writable

LOCK_FILE="/tmp/codeburg-deploy-fe.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "==> Another frontend deploy is currently running (lock: ${LOCK_FILE})"
    exit 1
fi

echo "==> Resolving frontend deploy ref '${REF}'..."
if ! COMMIT="$(git rev-parse "${REF}^{commit}" 2>/dev/null)"; then
    echo "==> Ref not found locally, fetching remotes..."
    git fetch --all --prune
    COMMIT="$(git rev-parse "${REF}^{commit}")"
fi
SHORT_COMMIT="$(git rev-parse --short "$COMMIT")"

echo "==> Updating working tree to ${SHORT_COMMIT} (detached HEAD)..."
git checkout --detach --force "$COMMIT"

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
pnpm --dir frontend build

echo "==> Frontend deploy complete at commit ${SHORT_COMMIT} (no service restart)."
