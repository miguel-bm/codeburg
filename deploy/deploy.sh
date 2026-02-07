#!/usr/bin/env bash
# Codeburg deploy/upgrade script
# Runs on the server as the codeburg user (via: just deploy [branch])
# Usage: deploy.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"

# Ensure tools are in PATH (needed when invoked via SSH non-login shell)
export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd /opt/codeburg

echo "==> Fetching and checking out '$BRANCH'..."
git fetch origin
git checkout "$BRANCH"
git pull --rebase origin "$BRANCH"

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
cd frontend && pnpm build && cd ..

echo "==> Building backend..."
cd backend && go build -o codeburg ./cmd/codeburg && cd ..

echo "==> Running migrations..."
./backend/codeburg migrate

echo "==> Updating service file..."
sudo cp /opt/codeburg/deploy/codeburg.service /etc/systemd/system/codeburg.service
sudo systemctl daemon-reload

echo "==> Restarting service..."
sudo systemctl restart codeburg

echo "==> Checking status..."
sleep 2
if systemctl is-active --quiet codeburg; then
    echo "==> Codeburg is running. Deploy complete!"
else
    echo "==> WARNING: Codeburg failed to start. Check: journalctl -u codeburg -n 50"
    exit 1
fi
