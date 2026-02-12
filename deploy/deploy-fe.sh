#!/usr/bin/env bash
# Frontend-only deploy — rebuilds frontend/dist without restarting the Go server.
# Sessions stay alive since the server keeps running.
# Usage: deploy-fe.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd /opt/codeburg

echo "==> Fetching and checking out '$BRANCH'..."
git fetch origin
git checkout "$BRANCH"
git pull --rebase origin "$BRANCH"

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
pnpm --dir frontend build

echo "==> Done! Frontend updated without server restart."
