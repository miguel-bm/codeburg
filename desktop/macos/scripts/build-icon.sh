#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$MACOS_DIR/assets"
OUT_FILE="$OUT_DIR/codeburg.icns"

SVG_SOURCE="$ROOT_DIR/frontend/public/codeburg-logo.svg"
ICO_SOURCE="$ROOT_DIR/frontend/public/codeburg-logo.ico"

if [[ ! -f "$SVG_SOURCE" && ! -f "$ICO_SOURCE" ]]; then
  echo "No icon source found in frontend/public (expected codeburg-logo.svg or codeburg-logo.ico)" >&2
  exit 1
fi

if [[ ! -x "$(command -v sips)" || ! -x "$(command -v iconutil)" ]]; then
  echo "Missing required macOS tools: sips and iconutil must be available." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ICONSET_DIR="$WORK_DIR/codeburg.iconset"
mkdir -p "$ICONSET_DIR"

BASE_PNG="$WORK_DIR/base.png"
if [[ -f "$SVG_SOURCE" ]]; then
  sips -s format png "$SVG_SOURCE" --out "$BASE_PNG" >/dev/null
else
  # Fallback: ICO works, but quality depends on source resolution.
  sips -s format png "$ICO_SOURCE" --out "$BASE_PNG" >/dev/null
fi

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$BASE_PNG" --out "$ICONSET_DIR/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET_DIR" -o "$OUT_FILE"
echo "Built $OUT_FILE"
