#!/usr/bin/env bash
# Local deploy flow used by SSH deploy and self-deploy.
# Usage: deploy-local.sh <commit-ish> [target-dir]
set -euo pipefail

REF="${1:-}"
TARGET_DIR="${2:-/opt/codeburg}"

if [[ -z "$REF" ]]; then
    echo "Usage: $0 <commit-ish> [target-dir]"
    exit 1
fi

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
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

LOCK_FILE="/tmp/codeburg-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "==> Another deploy is currently running (lock: ${LOCK_FILE})"
    exit 1
fi

echo "==> Resolving deploy ref '${REF}'..."
if ! COMMIT="$(git rev-parse "${REF}^{commit}" 2>/dev/null)"; then
    echo "==> Ref not found locally, fetching remotes..."
    git fetch --all --prune
    COMMIT="$(git rev-parse "${REF}^{commit}")"
fi
SHORT_COMMIT="$(git rev-parse --short "$COMMIT")"

CURRENT_REF="$(git rev-parse --short HEAD 2>/dev/null || true)"
echo "==> Current checkout: ${CURRENT_REF:-unknown}"
echo "==> Target commit: ${SHORT_COMMIT}"

echo "==> Checking out target commit (detached HEAD)..."
git checkout --detach --force "$COMMIT"

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
pnpm --dir frontend build

echo "==> Building backend..."
(cd backend && go build -o codeburg ./cmd/codeburg)

echo "==> Running migrations..."
./backend/codeburg migrate

echo "==> Updating service file..."
sudo cp "$TARGET_DIR/deploy/codeburg.service" /etc/systemd/system/codeburg.service
sudo systemctl daemon-reload

echo "==> Restarting service..."
sudo systemctl restart codeburg

echo "==> Checking status..."
sleep 2
if systemctl is-active --quiet codeburg; then
    echo "==> Codeburg is running at commit ${SHORT_COMMIT}. Deploy complete."
else
    echo "==> WARNING: Codeburg failed to start. Check: journalctl -u codeburg -n 50"
    exit 1
fi
