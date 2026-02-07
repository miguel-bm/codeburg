#!/usr/bin/env bash
# Codeburg deploy/upgrade script
# Runs on the server as the codeburg user (via: just deploy)
set -euo pipefail

# Ensure tools are in PATH (needed when invoked via SSH non-login shell)
export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd /opt/codeburg

echo "==> Pulling latest changes..."
git pull --rebase origin main

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
