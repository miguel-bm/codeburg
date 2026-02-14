#!/usr/bin/env bash
# Frontend-only deploy — rebuilds frontend/dist without restarting the Go server.
# Sessions stay alive since the server keeps running.
# Usage: deploy-fe.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"
TARGET_DIR="/opt/codeburg"

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd "$TARGET_DIR"

echo "==> Fetching '$BRANCH'..."
git fetch origin
COMMIT="$(git rev-parse "origin/${BRANCH}^{commit}")"
echo "==> Deploying frontend commit ${COMMIT} from origin/${BRANCH}..."

"${TARGET_DIR}/deploy/deploy-local-fe.sh" "$COMMIT" "$TARGET_DIR"
