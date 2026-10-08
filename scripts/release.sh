#!/bin/sh
# Builds the Windows app and publishes it as a GitHub release, which installed copies
# pick up as an automatic update.
# Usage: bump "version" in package.json, commit, then run:  npm run release:win
# Set GH to the gh CLI's path if it isn't on PATH.
set -e
GH="${GH:-gh}"
V=$(node -p "require('./package.json').version")
TAG="v$V"

rm -rf dist
npx electron-builder --win nsis portable --x64 --publish never

# GitHub turns spaces into dots, so upload under the dashed names latest.yml points at.
mkdir -p dist/upload
cp "dist/Crosshair Studio Setup $V.exe" "dist/upload/Crosshair-Studio-Setup-$V.exe"
cp "dist/Crosshair Studio Setup $V.exe.blockmap" "dist/upload/Crosshair-Studio-Setup-$V.exe.blockmap"
cp "dist/Crosshair Studio-$V-portable.exe" "dist/upload/Crosshair-Studio-$V-portable.exe"
cp dist/latest.yml dist/upload/

git tag "$TAG" 2>/dev/null || true
git push origin HEAD "$TAG"
"$GH" release create "$TAG" dist/upload/* --title "$V" --notes "${NOTES:-Crosshair Studio $V}" --latest
