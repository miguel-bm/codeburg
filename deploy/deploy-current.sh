#!/usr/bin/env bash
# Deploy the current local working tree to the remote server and restart Codeburg.
# This is intended for preview/testing without requiring a git push first.
#
# Usage:
#   ./deploy/deploy-current.sh [ssh-host] [target-dir]
#
# Defaults:
#   ssh-host   = codeburg-server
#   target-dir = /opt/codeburg
set -euo pipefail

SSH_HOST="${1:-codeburg-server}"
TARGET_DIR="${2:-/opt/codeburg}"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "==> Must be run from inside a git repository."
    exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "==> Deploying current working tree to ${SSH_HOST}:${TARGET_DIR}"
echo "==> Source commit: $(git rev-parse --short HEAD)"

LOCAL_ARCHIVE="$(mktemp /tmp/codeburg-current.XXXXXX.tar)"
REMOTE_ARCHIVE="/tmp/codeburg-current-archive-$$.tar"

cleanup_local() {
    rm -f "$LOCAL_ARCHIVE"
}
trap cleanup_local EXIT

git ls-files --cached --others --exclude-standard -z \
  | tar --null -T - -cf "$LOCAL_ARCHIVE"

echo "==> Uploading archive to ${SSH_HOST}:${REMOTE_ARCHIVE}"
scp "$LOCAL_ARCHIVE" "${SSH_HOST}:${REMOTE_ARCHIVE}" >/dev/null

ssh "$SSH_HOST" "TARGET_DIR='$TARGET_DIR' ARCHIVE_PATH='$REMOTE_ARCHIVE' bash -s" <<'REMOTE'
set -euo pipefail

TARGET_DIR="${TARGET_DIR:?target dir required}"
ARCHIVE_PATH="${ARCHIVE_PATH:?archive path required}"
LOCK_FILE="/tmp/codeburg-deploy-current.lock"

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export CI=true

if [[ ! -d "$TARGET_DIR/.git" ]]; then
    echo "==> ERROR: ${TARGET_DIR} does not look like a git checkout (.git missing)"
    exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "==> Another current-tree deploy is already running (lock: ${LOCK_FILE})"
    exit 1
fi

STAGING_DIR="$(mktemp -d /tmp/codeburg-current-deploy.XXXXXX)"
cleanup() {
    rm -rf "$STAGING_DIR"
    rm -f "$ARCHIVE_PATH"
}
trap cleanup EXIT

echo "==> Receiving local tree into ${STAGING_DIR}..."
tar -C "$STAGING_DIR" -xf "$ARCHIVE_PATH"

echo "==> Replacing working tree contents in ${TARGET_DIR}..."
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
tar -C "$STAGING_DIR" -cf - . | tar -C "$TARGET_DIR" -xf -

cd "$TARGET_DIR"

echo "==> Syncing agent skills..."
./deploy/sync-agent-skills.sh

echo "==> Configuring runtime user environment..."
./deploy/configure-runtime-user-env.sh

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
pnpm --dir frontend build

echo "==> Building backend..."
(cd backend && go build -o codeburg ./cmd/codeburg)

echo "==> Running migrations..."
./backend/codeburg migrate

echo "==> Applying service unit..."
sudo systemctl start codeburg-apply-unit.service

echo "==> Restarting Codeburg..."
sudo systemctl restart codeburg

sleep 2
if systemctl is-active --quiet codeburg; then
    echo "==> Current-tree deploy complete. Service is running."
else
    echo "==> WARNING: service failed to start. Check: journalctl -u codeburg -n 100"
    exit 1
fi
REMOTE
