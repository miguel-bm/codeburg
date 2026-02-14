#!/usr/bin/env bash
# Codeburg deploy/upgrade script
# Runs on the server as the codeburg user (via: just deploy [branch])
# Usage: deploy.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"
TARGET_DIR="/opt/codeburg"

# Ensure tools are in PATH (needed when invoked via SSH non-login shell)
export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd "$TARGET_DIR"

echo "==> Fetching '$BRANCH'..."
git fetch origin
COMMIT="$(git rev-parse "origin/${BRANCH}^{commit}")"
echo "==> Deploying commit ${COMMIT} from origin/${BRANCH}..."

"${TARGET_DIR}/deploy/deploy-local.sh" "$COMMIT" "$TARGET_DIR"
