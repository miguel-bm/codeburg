#!/usr/bin/env bash
# One-time host bootstrap for self-deploy helper services.
# Run as root on the server after pulling latest /opt/codeburg.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: run as root (sudo ./deploy/install-self-deploy-host.sh)"
    exit 1
fi

INSTALL_DIR="${1:-/opt/codeburg}"
CODEBURG_USER="codeburg"

if [[ ! -d "$INSTALL_DIR" ]]; then
    echo "ERROR: install dir not found: $INSTALL_DIR"
    exit 1
fi

echo "==> Installing host helper unit"
install -o root -g root -m 0644 \
    "$INSTALL_DIR/deploy/codeburg-apply-unit.service" \
    /etc/systemd/system/codeburg-apply-unit.service

echo "==> Ensuring helper script is executable"
chown root:root "$INSTALL_DIR/deploy/apply-systemd-unit.sh"
chmod 0755 "$INSTALL_DIR/deploy/apply-systemd-unit.sh"

echo "==> Writing sudoers policy for ${CODEBURG_USER}"
cat > /etc/sudoers.d/codeburg << 'SUDOEOF'
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl start codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl status codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl start codeburg-apply-unit.service
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl status codeburg-apply-unit.service
codeburg ALL=(ALL) NOPASSWD: /usr/bin/chown -R codeburg\:codeburg /opt/codeburg
SUDOEOF
chmod 0440 /etc/sudoers.d/codeburg

echo "==> Reloading systemd"
systemctl daemon-reload
systemctl enable codeburg-apply-unit >/dev/null 2>&1 || true

echo "==> Applying current codeburg.service"
systemctl start codeburg-apply-unit.service

echo "==> Done. Self-deploy helper is ready."
