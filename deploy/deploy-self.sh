#!/usr/bin/env bash
# Launch a detached deploy so restarting codeburg.service does not kill deployment.
# Usage: deploy-self.sh [ref] [source-dir]
set -euo pipefail

REF="${1:-HEAD}"
SOURCE_DIR="${2:-$PWD}"
TARGET_DIR="${CODEBURG_INSTALL_DIR:-/opt/codeburg}"
LOCAL_DEPLOY_SCRIPT="${SOURCE_DIR}/deploy/deploy-local.sh"

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"

if [[ ! -d "$SOURCE_DIR/.git" ]] && ! git -C "$SOURCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: source dir is not a git repository: ${SOURCE_DIR}"
    exit 1
fi
if [[ ! -x "$LOCAL_DEPLOY_SCRIPT" ]]; then
    echo "ERROR: deploy script not found or not executable: ${LOCAL_DEPLOY_SCRIPT}"
    exit 1
fi

COMMIT="$(git -C "$SOURCE_DIR" rev-parse "${REF}^{commit}")"
SHORT_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --short "$COMMIT")"
LOG_FILE="/tmp/codeburg-self-deploy-${SHORT_COMMIT}-$(date +%Y%m%d-%H%M%S).log"

echo "==> Starting detached deploy"
echo "    source: ${SOURCE_DIR}"
echo "    ref:    ${REF}"
echo "    commit: ${SHORT_COMMIT}"
echo "    target: ${TARGET_DIR}"
echo "    log:    ${LOG_FILE}"

nohup "$LOCAL_DEPLOY_SCRIPT" "$COMMIT" "$TARGET_DIR" >"$LOG_FILE" 2>&1 < /dev/null &
PID=$!

echo "==> Deploy launched in background (pid ${PID})"
echo "==> Follow progress:"
echo "    tail -f ${LOG_FILE}"
