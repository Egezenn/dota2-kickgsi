#!/usr/bin/env bash
set -e

echo "Building DotaKickGSI..."

# 1. Compile standalone Python server via PyInstaller
uv run pyinstaller --onefile --noconsole --name DotaKickGSI backend/__main__.py

# 2. Organize build artifacts
mkdir -p releases

if [ -f "dist/DotaKickGSI.exe" ]; then
    mv -f dist/DotaKickGSI.exe releases/DotaKickGSI-Windows.exe
elif [ -f "dist/DotaKickGSI" ]; then
    mv -f dist/DotaKickGSI releases/DotaKickGSI-Linux
fi

cp -f backend/rank.png releases/
cp -f config_default.json releases/
cp -f userjs/userscript.js releases/

# 3. Clean up temporary build files
rm -rf build dist DotaKickGSI.spec

echo "Build complete! Artifacts are ready in the releases/ directory."
