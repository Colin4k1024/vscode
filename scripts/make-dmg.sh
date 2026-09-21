#!/usr/bin/env bash
# Build a distributable DMG (drag-to-Applications layout) from a packaged
# macOS app — the artifact to hand to other people (the .zip stays the
# CI/manifest artifact).
#
# Usage: bash scripts/make-dmg.sh --app </path/to/App.app> --out <dist-dir> [--name=<name>] [--version=<v>] [--arch=<arm64>]
set -euo pipefail

APP=""
OUT=""
NAME=""
VERSION=""
ARCH="arm64"
while [ $# -gt 0 ]; do
	case "$1" in
		--app) APP="${2:?--app needs a path}"; shift 2 ;;
		--out) OUT="${2:?--out needs a dir}"; shift 2 ;;
		--name=*) NAME="${1#*=}"; shift ;;
		--version=*) VERSION="${1#*=}"; shift ;;
		--arch=*) ARCH="${1#*=}"; shift ;;
		-h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$APP" ] && [ -d "$APP" ] || fail "--app must point at a packaged .app"
[ -n "$OUT" ] || fail "--out is required"
[ "$(uname -s)" = "Darwin" ] || fail "DMG creation requires macOS (hdiutil)"

APP_BASE="$(basename "$APP" .app)"
NAME="${NAME:-$(echo "$APP_BASE" | tr -d ' ' | tr '[:upper:]' '[:lower:]')}"
if [ -z "$VERSION" ]; then
	VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
	[ -n "$VERSION" ] || fail "could not read version from $APP/Contents/Info.plist — pass --version="
fi

DMG="$OUT/$NAME-$VERSION-darwin-$ARCH.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "$APP_BASE" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "dmg: $DMG ($(stat -c%s "$DMG" 2>/dev/null || stat -f%z "$DMG") bytes)"
