#!/usr/bin/env bash
# Configure a consistent user-local runtime environment for the Codeburg service user.
set -euo pipefail

HOME_DIR="${HOME:?HOME is required}"
LOCAL_PREFIX="${CODEBURG_NPM_PREFIX:-${HOME_DIR}/.local}"
RUNTIME_FILE="${HOME_DIR}/.codeburg/runtime-env.sh"
PROFILE_FILE="${HOME_DIR}/.profile"
NPMRC_FILE="${HOME_DIR}/.npmrc"

mkdir -p "${HOME_DIR}/.codeburg" "${HOME_DIR}/go/bin" "${LOCAL_PREFIX}/bin" "${LOCAL_PREFIX}/lib"

cat > "${RUNTIME_FILE}" <<EOF
export PATH="${LOCAL_PREFIX}/bin:\$HOME/go/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin"
export GOTOOLCHAIN=auto
export NPM_CONFIG_PREFIX="${LOCAL_PREFIX}"
export npm_config_prefix="${LOCAL_PREFIX}"
export NODE_PATH="${LOCAL_PREFIX}/lib/node_modules"
EOF

if [[ -f "${PROFILE_FILE}" ]]; then
    python3 - "${PROFILE_FILE}" "${RUNTIME_FILE}" <<'PY'
from pathlib import Path
import sys

profile = Path(sys.argv[1])
runtime = sys.argv[2]
source_line = f'[ -f "{runtime}" ] && . "{runtime}"'
content = profile.read_text()
if source_line not in content:
    if not content.endswith("\n"):
        content += "\n"
    content += f"\n# Codeburg runtime environment\n{source_line}\n"
    profile.write_text(content)
PY
fi

cat > "${NPMRC_FILE}" <<EOF
prefix=${LOCAL_PREFIX}
cache=${HOME_DIR}/.npm
EOF

echo "Configured runtime env:"
echo "  prefix: ${LOCAL_PREFIX}"
echo "  runtime: ${RUNTIME_FILE}"
echo "  npmrc: ${NPMRC_FILE}"
