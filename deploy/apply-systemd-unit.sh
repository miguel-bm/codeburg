#!/usr/bin/env bash
set -euo pipefail

SRC="/opt/codeburg/deploy/codeburg.service"
DST="/etc/systemd/system/codeburg.service"

if [[ ! -f "$SRC" ]]; then
    echo "ERROR: source unit file not found: $SRC"
    exit 1
fi

if [[ -f "$DST" ]] && cmp -s "$SRC" "$DST"; then
    echo "==> codeburg.service already up to date"
    exit 0
fi

echo "==> Installing updated codeburg.service"
install -o root -g root -m 0644 "$SRC" "$DST"
systemctl daemon-reload
echo "==> codeburg.service updated and daemon reloaded"
