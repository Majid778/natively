#!/bin/zsh
# Rebuild the app locally (no DMG, no download, no notarization) and swap it into
# /Applications in place. Lets you update an installed unsigned macOS build straight
# from source — useful because unsigned builds can't use electron's silent auto-update.
#
#   npm run update:local
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APP_NAME="Natively OSS.app"
DEST="/Applications/$APP_NAME"

echo "▶ Building local app (arm64, --dir, unsigned)…"
npm run build
npm run build:electron
# Reuse the prebuilt native module — it rarely changes and the napi rebuild is the
# slow/fragile part. Only rebuild if it's missing. Pass REBUILD_NATIVE=1 to force.
if [ "${REBUILD_NATIVE:-0}" = "1" ] || [ ! -f native-module/index.darwin-arm64.node ]; then
  echo "▶ Building native module…"
  npm run build:native
else
  echo "▶ Reusing prebuilt native module (set REBUILD_NATIVE=1 to force a rebuild)."
fi
npx electron-builder --mac dir --arm64 --publish never

BUILT="$(ls -d release/mac*/*.app 2>/dev/null | head -1)"
if [ -z "$BUILT" ]; then
  echo "✗ Could not find built .app under release/mac*/" >&2
  exit 1
fi
echo "▶ Built: $BUILT"

if [ ! -d "$DEST" ]; then
  echo "▶ No existing install — copying fresh to /Applications."
fi

echo "▶ Quitting running app…"
osascript -e 'tell application "Natively OSS" to quit' 2>/dev/null || true
pkill -f "Natively OSS.app/Contents/MacOS" 2>/dev/null || true
sleep 1

echo "▶ Swapping into /Applications…"
rsync -a --delete "$BUILT/" "$DEST/"
xattr -cr "$DEST" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "▶ Relaunching…"
open "$DEST"
VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null)"
echo "✓ Updated installed app to $VER (no download)."
