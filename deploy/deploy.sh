#!/usr/bin/env bash
set -euo pipefail

cd /opt/codeburg

echo "==> Pulling latest changes..."
git pull origin main

echo "==> Installing frontend dependencies..."
pnpm --dir frontend install --frozen-lockfile

echo "==> Building frontend..."
cd frontend && pnpm build && cd ..

echo "==> Building backend..."
cd backend && GOTOOLCHAIN=auto go build -o codeburg ./cmd/codeburg && cd ..

echo "==> Running migrations..."
./backend/codeburg migrate

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
