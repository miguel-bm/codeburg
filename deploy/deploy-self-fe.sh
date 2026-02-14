#!/usr/bin/env bash
# Launch a detached frontend-only deploy so active sessions are not interrupted.
# Usage: deploy-self-fe.sh [ref] [source-dir]
# Optional env:
#   CODEBURG_DEPLOY_FOLLOW=1|0|auto   (default: auto; auto follows when running in a TTY)
#   CODEBURG_DEPLOY_HOLD=1|0          (default: 0; when 1, wait for Enter before exiting)
set -euo pipefail

REF="${1:-HEAD}"
SOURCE_DIR="${2:-$PWD}"
TARGET_DIR="${CODEBURG_INSTALL_DIR:-/opt/codeburg}"
LOCAL_DEPLOY_SCRIPT="${SOURCE_DIR}/deploy/deploy-local-fe.sh"

export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:$HOME/go/bin:$PATH"

if [[ ! -d "$SOURCE_DIR/.git" ]] && ! git -C "$SOURCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: source dir is not a git repository: ${SOURCE_DIR}"
    exit 1
fi
if [[ ! -x "$LOCAL_DEPLOY_SCRIPT" ]]; then
    echo "ERROR: deploy script not found or not executable: ${LOCAL_DEPLOY_SCRIPT}"
    exit 1
fi

COMMIT="$(git -C "$SOURCE_DIR" rev-parse "${REF}^{commit}")"
SHORT_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --short "$COMMIT")"
LOG_FILE="/tmp/codeburg-self-deploy-fe-${SHORT_COMMIT}-$(date +%Y%m%d-%H%M%S).log"

echo "==> Starting detached frontend-only deploy"
echo "    source: ${SOURCE_DIR}"
echo "    ref:    ${REF}"
echo "    commit: ${SHORT_COMMIT}"
echo "    target: ${TARGET_DIR}"
echo "    log:    ${LOG_FILE}"

nohup "$LOCAL_DEPLOY_SCRIPT" "$COMMIT" "$TARGET_DIR" >"$LOG_FILE" 2>&1 < /dev/null &
PID=$!

echo "==> Frontend deploy launched in background (pid ${PID})"
echo "==> Follow progress:"
echo "    tail -f ${LOG_FILE}"

FOLLOW_MODE="${CODEBURG_DEPLOY_FOLLOW:-auto}"
HOLD_MODE="${CODEBURG_DEPLOY_HOLD:-0}"

should_follow=0
case "$FOLLOW_MODE" in
    1|true|yes) should_follow=1 ;;
    0|false|no) should_follow=0 ;;
    auto)
        if [[ -t 1 ]]; then
            should_follow=1
        fi
        ;;
esac

if [[ "$should_follow" -eq 1 ]]; then
    echo "==> Streaming deploy log in this terminal..."
    if tail --help 2>/dev/null | grep -q -- '--pid'; then
        tail --pid="$PID" -n +1 -f "$LOG_FILE" || true
    else
        tail -n +1 -f "$LOG_FILE" &
        TAIL_PID=$!
        while kill -0 "$PID" 2>/dev/null; do
            sleep 1
        done
        kill "$TAIL_PID" 2>/dev/null || true
        wait "$TAIL_PID" 2>/dev/null || true
    fi

    if wait "$PID"; then
        echo "==> Frontend self-deploy finished successfully."
    else
        status=$?
        echo "==> Frontend self-deploy failed (exit ${status}). See ${LOG_FILE}"
    fi
fi

if [[ "$HOLD_MODE" == "1" && -t 0 ]]; then
    echo
    read -r -p "Deploy complete. Press Enter to close this session..." _
fi
