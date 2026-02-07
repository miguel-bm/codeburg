#!/usr/bin/env bash
# Codeburg server setup script
# Run as root on a fresh Debian 12 (Bookworm) VM
#
# Usage: curl -sSL <raw-url> | bash
#   or:  bash setup.sh
set -euo pipefail

CODEBURG_USER="codeburg"
CODEBURG_REPO="https://github.com/miguel/codeburg.git"  # Update with actual repo URL
INSTALL_DIR="/opt/codeburg"
GO_VERSION="1.24.1"
NODE_MAJOR=22

echo "========================================="
echo "  Codeburg Server Setup - Debian 12"
echo "========================================="

# --- Must be root ---
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root."
    exit 1
fi

# --- System packages ---
echo ""
echo "==> Installing system packages..."
apt-get update
apt-get install -y \
    git \
    tmux \
    curl \
    wget \
    build-essential \
    sudo \
    ca-certificates \
    gnupg

# --- Go ---
echo ""
echo "==> Installing Go ${GO_VERSION}..."
if ! command -v go &>/dev/null || ! go version | grep -q "go${GO_VERSION}"; then
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz
fi

# Ensure Go is in PATH for all users
cat > /etc/profile.d/golang.sh << 'GOEOF'
export PATH="/usr/local/go/bin:$PATH"
GOEOF
export PATH="/usr/local/go/bin:$PATH"
echo "    Go $(go version | awk '{print $3}')"

# --- Node.js ---
echo ""
echo "==> Installing Node.js ${NODE_MAJOR}..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y nodejs
fi
echo "    Node $(node --version)"

# --- pnpm ---
echo ""
echo "==> Installing pnpm..."
corepack enable
corepack prepare pnpm@latest --activate
echo "    pnpm $(pnpm --version)"

# --- just ---
echo ""
echo "==> Installing just..."
if ! command -v just &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin
fi
echo "    just $(just --version)"

# --- cloudflared ---
echo ""
echo "==> Installing cloudflared..."
if ! command -v cloudflared &>/dev/null; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | \
        gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" \
        > /etc/apt/sources.list.d/cloudflared.list
    apt-get update
    apt-get install -y cloudflared
fi
echo "    cloudflared $(cloudflared --version 2>&1 | head -1)"

# --- Create codeburg user ---
echo ""
echo "==> Creating ${CODEBURG_USER} user..."
if ! id "${CODEBURG_USER}" &>/dev/null; then
    useradd -m -s /bin/bash "${CODEBURG_USER}"
    echo "    Created user ${CODEBURG_USER}"
else
    echo "    User ${CODEBURG_USER} already exists"
fi

# Add to sudo for systemctl restart
cat > /etc/sudoers.d/codeburg << 'SUDOEOF'
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl status codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop codeburg
codeburg ALL=(ALL) NOPASSWD: /usr/bin/systemctl start codeburg
SUDOEOF
chmod 0440 /etc/sudoers.d/codeburg
echo "    Sudoers configured for systemctl"

# --- Go path for codeburg user ---
sudo -u "${CODEBURG_USER}" bash -c 'mkdir -p ~/go/bin'
cat >> "/home/${CODEBURG_USER}/.bashrc" << 'BASHEOF'

# Go
export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=auto
BASHEOF

# --- Clone repository ---
echo ""
echo "==> Setting up repository..."
if [[ -d "${INSTALL_DIR}" ]]; then
    echo "    ${INSTALL_DIR} already exists, updating..."
    cd "${INSTALL_DIR}"
    sudo -u "${CODEBURG_USER}" git pull origin main || true
else
    git clone "${CODEBURG_REPO}" "${INSTALL_DIR}"
    chown -R "${CODEBURG_USER}:${CODEBURG_USER}" "${INSTALL_DIR}"
fi

# --- Create data directory ---
sudo -u "${CODEBURG_USER}" mkdir -p "/home/${CODEBURG_USER}/.codeburg"

# --- Initial build ---
echo ""
echo "==> Building Codeburg..."
cd "${INSTALL_DIR}"
sudo -u "${CODEBURG_USER}" bash -c "
    export PATH='/usr/local/go/bin:\$HOME/go/bin:\$PATH'
    export GOTOOLCHAIN=auto
    cd ${INSTALL_DIR}
    pnpm --dir frontend install
    cd frontend && pnpm build && cd ..
    cd backend && go build -o codeburg ./cmd/codeburg && cd ..
    ./backend/codeburg migrate
"
echo "    Build complete!"

# --- Install systemd service ---
echo ""
echo "==> Installing systemd service..."
cp "${INSTALL_DIR}/deploy/codeburg.service" /etc/systemd/system/codeburg.service
systemctl daemon-reload
systemctl enable codeburg
systemctl start codeburg
echo "    Service installed and started"

# --- Done ---
echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "Codeburg is running on http://127.0.0.1:8080"
echo ""
echo "Next steps:"
echo ""
echo "1. Set up SSH key access for the codeburg user:"
echo "   ssh-copy-id codeburg@<this-vm-ip>"
echo ""
echo "2. Configure Cloudflare tunnel (as codeburg user):"
echo "   su - codeburg"
echo "   cloudflared tunnel login"
echo "   cloudflared tunnel create codeburg"
echo "   # Note the tunnel ID, then:"
echo "   cp /opt/codeburg/deploy/cloudflared.yml ~/.cloudflared/config.yml"
echo "   # Edit config.yml to replace <TUNNEL_ID>"
echo "   cloudflared tunnel route dns codeburg codeburg.miscellanics.com"
echo "   sudo cloudflared service install"
echo "   sudo systemctl enable cloudflared"
echo "   sudo systemctl start cloudflared"
echo ""
echo "3. Open https://codeburg.miscellanics.com and set your password"
echo ""
echo "4. On your dev machine, add to ~/.ssh/config:"
echo "   Host codeburg-server"
echo "       HostName <this-vm-ip>"
echo "       User codeburg"
echo ""
echo "5. Deploy updates with: just deploy"
echo ""
echo "6. Install agent CLIs (optional, as codeburg user):"
echo "   # Claude Code (native installer, auto-updates)"
echo "   curl -fsSL https://claude.ai/install.sh | bash"
echo "   claude  # Follow login prompts"
echo ""
echo "   # Codex"
echo "   npm install -g @openai/codex"
echo "   codex  # Follow login prompts"
echo ""
