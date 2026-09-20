#!/usr/bin/env bash
# Generate platform-specific ColinCode icons from the source SVG.
# Ported from grok-code-product/scripts/generate-icons.sh (D17 §4: 直接复用),
# with output renamed to the ColinCode brand and layout split into
# product/branding/{darwin,win32,linux}/ per the D06 spec.
#
# Requires: rsvg-convert (librsvg), iconutil (macOS), ImageMagick (magick/convert)
# Usage: bash scripts/generate-icons.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANDING_DIR="$REPO_ROOT/product/branding"
SVG="$BRANDING_DIR/icon.svg"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$SVG" ] || fail "Source SVG not found at $SVG"
command -v rsvg-convert >/dev/null 2>&1 || fail "rsvg-convert not found (brew install librsvg)"

MAGICK=""
if command -v magick >/dev/null 2>&1; then
	MAGICK="magick"
elif command -v convert >/dev/null 2>&1; then
	MAGICK="convert"
fi

mkdir -p "$BRANDING_DIR/darwin" "$BRANDING_DIR/win32" "$BRANDING_DIR/linux" "$BRANDING_DIR/app"

echo "==> Generating icons from $SVG"

# PNG working set (kept under app/ for reuse by packaging, e.g. DMG / web)
for size in 16 32 48 64 128 256 512 1024; do
	rsvg-convert -w "$size" -h "$size" "$SVG" -o "$BRANDING_DIR/app/colincode_${size}x${size}.png" \
		|| fail "rsvg-convert failed at ${size}x${size}"
done
echo "    Generated app/colincode_{16..1024}.png"

# macOS .icns
echo "==> Generating macOS .icns"
ICONSET_DIR="$BRANDING_DIR/darwin/colincode.iconset"
mkdir -p "$ICONSET_DIR"
for size in 16 32 64 128 256 512 1024; do
	rsvg-convert -w "$size" -h "$size" "$SVG" -o "$ICONSET_DIR/icon_${size}x${size}.png" \
		|| fail "rsvg-convert failed (iconset ${size})"
	if [ "$size" -le 512 ]; then
		double=$((size * 2))
		rsvg-convert -w "$double" -h "$double" "$SVG" -o "$ICONSET_DIR/icon_${size}x${size}@2x.png" \
			|| fail "rsvg-convert failed (iconset ${size}@2x)"
	fi
done
iconutil -c icns "$ICONSET_DIR" -o "$BRANDING_DIR/darwin/colincode.icns" \
	|| fail "iconutil failed"
rm -rf "$ICONSET_DIR"
echo "    Generated darwin/colincode.icns"

# Windows .ico (+ tile PNGs consumed by the win32 packaging)
echo "==> Generating Windows .ico"
[ -n "$MAGICK" ] || fail "ImageMagick not found (brew install imagemagick)"
"$MAGICK" "$BRANDING_DIR/app/colincode_16x16.png" \
	"$BRANDING_DIR/app/colincode_32x32.png" \
	"$BRANDING_DIR/app/colincode_48x48.png" \
	"$BRANDING_DIR/app/colincode_256x256.png" \
	"$BRANDING_DIR/win32/colincode.ico" || fail "ImageMagick .ico generation failed"
cp "$BRANDING_DIR/app/colincode_128x128.png" "$BRANDING_DIR/win32/colincode_70x70.png"
cp "$BRANDING_DIR/app/colincode_256x256.png" "$BRANDING_DIR/win32/colincode_150x150.png"
echo "    Generated win32/colincode.ico (+ 70x70/150x150 tiles)"

# Linux PNG
cp "$BRANDING_DIR/app/colincode_512x512.png" "$BRANDING_DIR/linux/colincode.png"
echo "    Generated linux/colincode.png"

echo "==> Done."
