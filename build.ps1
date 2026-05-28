# PowerShell build script for Dota 2 GSI Kick Prediction Automator
# Compiles uvicorn GSI server and packages Chrome Extension

$ErrorActionPreference = "Stop"

Write-Host "========== Starting Build Process ==========" -ForegroundColor Cyan

# Terminate any running automator instances to prevent file locks on the executable
Write-Host "Stopping any running DotaKickGSI automator instances..." -ForegroundColor Cyan
if (Get-Process -Name "DotaKickGSI-Windows" -ErrorAction SilentlyContinue) {
    taskkill /F /IM DotaKickGSI-Windows.exe 2>$null
}
if (Get-Process -Name "DotaKickGSI" -ErrorAction SilentlyContinue) {
    taskkill /F /IM DotaKickGSI.exe 2>$null
}
Start-Sleep -Seconds 1

# 1. Compile standalone Python server via PyInstaller
Write-Host "`n[1/4] Compiling standalone Python server via PyInstaller..." -ForegroundColor Green
uv run pyinstaller --onefile --noconsole --name DotaKickGSI gsi_server.py

# 2. Package the browser extension into a zip file
Write-Host "`n[2/4] Zipping browser extension..." -ForegroundColor Green
$extensionZipPath = "extension.zip"
if (Test-Path $extensionZipPath) {
    Remove-Item $extensionZipPath -Force
}
Compress-Archive -Path "extension" -DestinationPath $extensionZipPath -Force

# 3. Package the browser extension into a CRX file
Write-Host "`n[3/4] Packaging browser extension into CRX..." -ForegroundColor Green
& "$PSScriptRoot/scripts/pack_extension.ps1"

# 4. Organize build artifacts
Write-Host "`n[4/4] Organizing build artifacts into releases/ folder..." -ForegroundColor Green
if (-not (Test-Path "releases")) {
    New-Item -ItemType Directory -Path "releases" | Out-Null
}

Move-Item -Path "dist/DotaKickGSI.exe" -Destination "releases/DotaKickGSI-Windows.exe" -Force
Move-Item -Path "extension.zip" -Destination "releases/extension.zip" -Force

# Clean up pyinstaller temp files
Write-Host "`nCleaning up PyInstaller temporary files..." -ForegroundColor Gray
if (Test-Path "build") {
    Remove-Item "build" -Recurse -Force
}
if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force
}
if (Test-Path "DotaKickGSI.spec") {
    Remove-Item "DotaKickGSI.spec" -Force
}

Write-Host "`n========== Build Completed Successfully! ==========" -ForegroundColor Green
Write-Host "Artifacts are ready inside the 'releases/' folder." -ForegroundColor Cyan
