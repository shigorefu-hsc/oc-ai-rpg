# Build standalone Windows .exe (includes code + audio, keeps JSON external/editable)
# Run from anywhere:
#   .\installer\build_windows_exe.ps1

$ErrorActionPreference = "Stop"

function Step($t) {
    Write-Host "`n=== $t ===" -ForegroundColor Cyan
}

function Ensure-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is not available. Install App Installer from Microsoft Store and rerun."
    }
}

function Refresh-Path {
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Ensure-Python {
    $hasPy = Get-Command py -ErrorAction SilentlyContinue
    $hasPython = Get-Command python -ErrorAction SilentlyContinue

    if ($hasPy -or $hasPython) {
        Write-Host "Python already installed."
        return
    }

    Ensure-Winget
    Step "Installing Python"
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path

    $hasPy = Get-Command py -ErrorAction SilentlyContinue
    $hasPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $hasPy -and -not $hasPython) {
        throw "Python installation failed or PATH not updated. Reopen terminal and rerun."
    }
}

function Get-PythonLauncher {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @("py", "-3")
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @("python")
    }
    throw "Python command not found."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$SourceDir = Join-Path $ProjectRoot "source"
$VenvDir = Join-Path $ProjectRoot ".venv"

$Requirements = Join-Path $SourceDir "requirements.txt"
$EntryScript = Join-Path $SourceDir "simple_rpg_template.py"

$DistDir = Join-Path $ScriptDir "dist"
$BuildDir = Join-Path $ScriptDir "build"
$SpecPath = Join-Path $ScriptDir "oc_ai_rpg.spec"

if (-not (Test-Path $Requirements)) { throw "requirements.txt not found: $Requirements" }
if (-not (Test-Path $EntryScript)) { throw "entry script not found: $EntryScript" }

Step "Preparing virtual environment"
Ensure-Python
$pyLauncher = Get-PythonLauncher

if (-not (Test-Path "$VenvDir\\Scripts\\python.exe")) {
    if ($pyLauncher.Count -eq 2) {
        & $pyLauncher[0] $pyLauncher[1] -m venv $VenvDir
    } else {
        & $pyLauncher[0] -m venv $VenvDir
    }
}

$py = (Resolve-Path "$VenvDir\\Scripts\\python.exe").Path

Step "Installing build dependencies"
& $py -m pip install --upgrade pip
& $py -m pip install -r $Requirements pyinstaller

Step "Cleaning old build artifacts"
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
if (Test-Path $SpecPath) { Remove-Item -Force $SpecPath }

Step "Building EXE"
& $py -m PyInstaller `
  --noconfirm `
  --onefile `
  --windowed `
  --name "oc_ai_rpg" `
  --distpath $DistDir `
  --workpath $BuildDir `
  --specpath $ScriptDir `
  --add-data "$SourceDir\\intro.mp3;." `
  --add-data "$SourceDir\\level.mp3;." `
  --add-data "$SourceDir\\mumble.wav;." `
  $EntryScript

Step "Copying editable JSON files next to EXE"
Copy-Item "$SourceDir\\npc_*.json" $DistDir -Force
Copy-Item "$SourceDir\\watashi.json" $DistDir -Force
Copy-Item "$SourceDir\\story.json" $DistDir -Force

Step "Done"
Write-Host "EXE: $DistDir\\oc_ai_rpg.exe" -ForegroundColor Green
Write-Host "JSON are external and editable in $DistDir" -ForegroundColor Yellow
