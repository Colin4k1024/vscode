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
for size in 70 150; do
	rsvg-convert -w "$size" -h "$size" "$SVG" -o "$BRANDING_DIR/win32/colincode_${size}x${size}.png" \
		|| fail "rsvg-convert failed at ${size}x${size}"
done
echo "    Generated win32/colincode.ico (+ true 70x70/150x150 tiles)"

# Linux PNG
cp "$BRANDING_DIR/app/colincode_512x512.png" "$BRANDING_DIR/linux/colincode.png"
echo "    Generated linux/colincode.png"

# Windows Inno Setup wizard images (D06 round-1, M1): the upstream BMPs embed
# the VS Code logo, so render branded replacements at every DPI scale. The big
# wizard banner uses a dedicated tall SVG; the small wizard icon reuses the app
# icon, force-resized to the (slightly non-square) target boxes.
echo "==> Generating Windows Inno Setup BMPs"
INNO_BIG_SIZES="164x314 192x386 246x459 273x556 328x604 355x700 410x797"
INNO_SMALL_SIZES="55x55 64x68 83x80 92x97 110x106 119x123 138x140"
INNO_SCALES="100 125 150 175 200 225 250"
set -- $INNO_BIG_SIZES
for scale in $INNO_SCALES; do
	rsvg-convert -w "${1%x*}" -h "${1#*x}" "$BRANDING_DIR/inno-big.svg" -o "$BRANDING_DIR/win32/inno-big-$scale.png" \
		|| fail "rsvg-convert failed (inno-big-$scale)"
	"$MAGICK" "$BRANDING_DIR/win32/inno-big-$scale.png" "BMP3:$BRANDING_DIR/win32/inno-big-$scale.bmp" \
		|| fail "BMP conversion failed (inno-big-$scale)"
	rm -f "$BRANDING_DIR/win32/inno-big-$scale.png"
	shift
done
set -- $INNO_SMALL_SIZES
for scale in $INNO_SCALES; do
	"$MAGICK" "$BRANDING_DIR/app/colincode_256x256.png" -resize "${1}!" "BMP3:$BRANDING_DIR/win32/inno-small-$scale.bmp" \
		|| fail "BMP conversion failed (inno-small-$scale)"
	shift
done
echo "    Generated win32/inno-{big,small}-{100..250}.bmp"

# Server / web (D06 round-1, M1): resources/server/{code-192,code-512}.png and
# favicon.ico carry the upstream logo in a packaged server build.
echo "==> Generating server assets"
mkdir -p "$BRANDING_DIR/server"
rsvg-convert -w 192 -h 192 "$SVG" -o "$BRANDING_DIR/server/code-192.png" || fail "rsvg-convert failed (code-192)"
rsvg-convert -w 512 -h 512 "$SVG" -o "$BRANDING_DIR/server/code-512.png" || fail "rsvg-convert failed (code-512)"
"$MAGICK" "$BRANDING_DIR/app/colincode_16x16.png" "$BRANDING_DIR/app/colincode_32x32.png" \
	"$BRANDING_DIR/app/colincode_48x48.png" "$BRANDING_DIR/server/favicon.ico" \
	|| fail "ImageMagick favicon.ico generation failed"
echo "    Generated server/{code-192,code-512}.png + favicon.ico"

# macOS file-type icons (D06 round-1, M1): the 27 upstream document icons
# (python.icns, ...) embed the VS Code logo; replace them with a branded
# document icon derived from fileicon.svg. One icns is generated and the mixin
# copies it over every file-type slot.
echo "==> Generating macOS file-type .icns"
FILE_SVG="$BRANDING_DIR/darwin/fileicon.svg"
[ -f "$FILE_SVG" ] || fail "file-type icon SVG not found at $FILE_SVG"
FILE_ICONSET_DIR="$BRANDING_DIR/darwin/colincode-file.iconset"
mkdir -p "$FILE_ICONSET_DIR"
for size in 16 32 64 128 256 512 1024; do
	rsvg-convert -w "$size" -h "$size" "$FILE_SVG" -o "$FILE_ICONSET_DIR/icon_${size}x${size}.png" \
		|| fail "rsvg-convert failed (file iconset ${size})"
	if [ "$size" -le 512 ]; then
		double=$((size * 2))
		rsvg-convert -w "$double" -h "$double" "$FILE_SVG" -o "$FILE_ICONSET_DIR/icon_${size}x${size}@2x.png" \
			|| fail "rsvg-convert failed (file iconset ${size}@2x)"
	fi
done
iconutil -c icns "$FILE_ICONSET_DIR" -o "$BRANDING_DIR/darwin/colincode-file.icns" \
	|| fail "iconutil failed (file-type icns)"
rm -rf "$FILE_ICONSET_DIR"
echo "    Generated darwin/colincode-file.icns"

echo "==> Done."
