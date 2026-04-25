#!/usr/bin/env bash
set -euo pipefail

PASEO_HOME="${PASEO_HOME:-$HOME/.paseo-trial}"
PASEO_PORT="${PASEO_PORT:-6767}"
PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:${PASEO_PORT}}"
PASEO_VERSION="${PASEO_VERSION:-0.1.59}"
NPM_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.local}"

export NPM_CONFIG_PREFIX="${NPM_PREFIX}"
export npm_config_prefix="${NPM_PREFIX}"
export PATH="${NPM_PREFIX}/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

echo "==> Installing Paseo CLI ${PASEO_VERSION} into ${NPM_PREFIX}"
npm install -g "@getpaseo/cli@${PASEO_VERSION}"

mkdir -p "${PASEO_HOME}"

CONFIG_PATH="${PASEO_HOME}/config.json"
if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "==> Writing ${CONFIG_PATH}"
  cat > "${CONFIG_PATH}" <<EOF
{
  "version": 1,
  "app": {
    "baseUrl": "https://app.paseo.sh"
  },
  "daemon": {
    "listen": "${PASEO_LISTEN}",
    "cors": {
      "allowedOrigins": ["https://app.paseo.sh"]
    },
    "relay": {
      "enabled": true
    },
    "mcp": {
      "enabled": true,
      "injectIntoAgents": false
    }
  }
}
EOF
else
  echo "==> Reusing existing ${CONFIG_PATH}"
fi

echo "==> Restarting isolated Paseo daemon"
PASEO_HOME="${PASEO_HOME}" PASEO_LISTEN="${PASEO_LISTEN}" PASEO_RELAY_ENABLED=true paseo daemon stop --home "${PASEO_HOME}" --force >/dev/null 2>&1 || true
PASEO_HOME="${PASEO_HOME}" PASEO_LISTEN="${PASEO_LISTEN}" PASEO_RELAY_ENABLED=true paseo daemon start --home "${PASEO_HOME}"

echo
echo "==> Status"
PASEO_HOME="${PASEO_HOME}" PASEO_LISTEN="${PASEO_LISTEN}" paseo daemon status --home "${PASEO_HOME}" --json || true
echo
echo "==> Pairing link"
PASEO_HOME="${PASEO_HOME}" PASEO_LISTEN="${PASEO_LISTEN}" paseo daemon pair --home "${PASEO_HOME}" --json || true
