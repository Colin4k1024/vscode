#!/usr/bin/env bash
# Generate platform-specific icons from the source SVG.
#
# Port of grok-code-product/scripts/generate-icons.sh (codex-desktop D06,
# issue #8 acceptance 10; D17 ROUTE-DECISION ruling: port, don't rewrite).
# Divergences from the original, all mandated by the D17 mixin ruling:
#   - output names are the fork's (OpenAgents.icns / OpenAgents.ico /
#     open-agents.png) instead of GrokCode.* / grok-code.png;
#   - failures are HARD failures - the original's
#     `|| echo WARNING` silent skip for the .ico step is removed
#     (D17: silent skips produce unreproducible builds);
#   - the .ico step falls back from ImageMagick to python3 + PIL when
#     `magick`/`convert` is not installed, instead of skipping.
#
# Requires: rsvg-convert (librsvg: `brew install librsvg`),
#           iconutil (macOS, for the .icns),
#           and ImageMagick OR python3-with-PIL for the .ico.
# Usage: bash scripts/generate-icons.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANDING_DIR="$REPO_ROOT/product/branding"
SVG="$BRANDING_DIR/icon.svg"
ICNS_NAME="OpenAgents.icns"
ICO_NAME="OpenAgents.ico"
LINUX_PNG_NAME="open-agents.png"

if [ ! -f "$SVG" ]; then
  echo "ERROR: Source SVG not found at $SVG" >&2
  exit 1
fi
if ! command -v rsvg-convert > /dev/null; then
  echo "ERROR: rsvg-convert not found (brew install librsvg)" >&2
  exit 1
fi

echo "==> Generating icons from $SVG"

# PNG sizes for general use
for size in 16 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$BRANDING_DIR/icon_${size}x${size}.png"
  echo "    Generated icon_${size}x${size}.png"
done

# macOS .icns
echo "==> Generating macOS .icns"
if ! command -v iconutil > /dev/null; then
  echo "ERROR: iconutil not found (macOS only) - cannot generate the .icns" >&2
  exit 1
fi
ICONSET_DIR="$BRANDING_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"
for size in 16 32 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$ICONSET_DIR/icon_${size}x${size}.png"
  if [ "$size" -le 512 ]; then
    double=$((size * 2))
    rsvg-convert -w "$double" -h "$double" "$SVG" -o "$ICONSET_DIR/icon_${size}x${size}@2x.png"
  fi
done
iconutil -c icns "$ICONSET_DIR" -o "$BRANDING_DIR/$ICNS_NAME"
rm -rf "$ICONSET_DIR"
echo "    Generated $ICNS_NAME"

# Windows .ico (16/32/48/256, matching grok-code-product's size set)
echo "==> Generating Windows .ico"
if command -v magick > /dev/null 2>&1; then
  magick "$BRANDING_DIR/icon_16x16.png" \
         "$BRANDING_DIR/icon_32x32.png" \
         "$BRANDING_DIR/icon_48x48.png" \
         "$BRANDING_DIR/icon_256x256.png" \
         "$BRANDING_DIR/$ICO_NAME"
  echo "    Generated $ICO_NAME (ImageMagick)"
elif command -v convert > /dev/null 2>&1; then
  convert "$BRANDING_DIR/icon_16x16.png" \
          "$BRANDING_DIR/icon_32x32.png" \
          "$BRANDING_DIR/icon_48x48.png" \
          "$BRANDING_DIR/icon_256x256.png" \
          "$BRANDING_DIR/$ICO_NAME"
  echo "    Generated $ICO_NAME (ImageMagick)"
elif command -v python3 > /dev/null 2>&1 && python3 -c "import PIL" > /dev/null 2>&1; then
  # PIL's ICO plugin ignores append_images; it downsizes from one source
  # image according to the `sizes` list instead, so feed it the 256px raster.
  python3 - "$BRANDING_DIR" "$ICO_NAME" <<'PYEOF'
import sys
from PIL import Image
from os import path
branding_dir, ico_name = sys.argv[1], sys.argv[2]
Image.open(path.join(branding_dir, "icon_256x256.png")).convert("RGBA").save(
    path.join(branding_dir, ico_name),
    sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
PYEOF
  echo "    Generated $ICO_NAME (PIL fallback)"
else
  echo "ERROR: no .ico generator available (install ImageMagick, or python3 with Pillow)" >&2
  exit 1
fi

# Linux PNG
cp "$BRANDING_DIR/icon_512x512.png" "$BRANDING_DIR/$LINUX_PNG_NAME"
echo "    Generated $LINUX_PNG_NAME"

echo "==> Done."
