# Build standalone Windows .exe (includes code + audio, excludes JSON)
# Run in PowerShell on Windows from project root:
#   .\build_windows_exe.ps1

$ErrorActionPreference = "Stop"

function Step($t) {
    Write-Host "`n=== $t ===" -ForegroundColor Cyan
}

if (-not (Test-Path ".\\requirements.txt")) {
    throw "requirements.txt not found. Run from project root."
}

Step "Preparing virtual environment"
if (-not (Test-Path ".\\.venv\\Scripts\\python.exe")) {
    py -3 -m venv .venv
}

$py = Resolve-Path ".\\.venv\\Scripts\\python.exe"

Step "Installing build dependencies"
& $py -m pip install --upgrade pip
& $py -m pip install -r .\\requirements.txt pyinstaller

Step "Cleaning old build artifacts"
if (Test-Path .\\build) { Remove-Item -Recurse -Force .\\build }
if (Test-Path .\\dist) { Remove-Item -Recurse -Force .\\dist }
if (Test-Path .\\simple_rpg_template.spec) { Remove-Item -Force .\\simple_rpg_template.spec }

Step "Building EXE"
& $py -m PyInstaller `
  --noconfirm `
  --onefile `
  --windowed `
  --name "oc_ai_rpg" `
  --add-data "intro.mp3;." `
  --add-data "level.mp3;." `
  --add-data "mumble.wav;." `
  .\\simple_rpg_template.py

Step "Done"
Write-Host "EXE: .\\dist\\oc_ai_rpg.exe" -ForegroundColor Green
Write-Host "JSON files are external. Keep npc_*.json, watashi.json, story.json next to EXE." -ForegroundColor Yellow
