# Windows installer for oc-ai-rpg
# Steps:
# 1) Install Git (if missing)
# 2) Install Python (if missing)
# 3) Clone/update project, create venv, install deps
# 4) Run the game

param(
    [string]$RepoUrl = "https://github.com/shigorefu-hsc/oc-ai-rpg.git",
    [string]$InstallDir = "$env:USERPROFILE\\Games\\oc-ai-rpg"
)

$ErrorActionPreference = "Stop"

function Write-Step($text) {
    Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Ensure-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is not available. Install App Installer from Microsoft Store and rerun this script."
    }
}

function Refresh-Path {
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host "Git already installed."
        return
    }

    Write-Step "Installing Git"
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git installation failed or PATH not updated. Please reopen terminal and rerun."
    }
}

function Ensure-Python {
    $hasPy = Get-Command py -ErrorAction SilentlyContinue
    $hasPython = Get-Command python -ErrorAction SilentlyContinue

    if ($hasPy -or $hasPython) {
        Write-Host "Python already installed."
        return
    }

    Write-Step "Installing Python"
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path

    $hasPy = Get-Command py -ErrorAction SilentlyContinue
    $hasPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $hasPy -and -not $hasPython) {
        throw "Python installation failed or PATH not updated. Please reopen terminal and rerun."
    }
}

function Get-PythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @("py", "-3")
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @("python")
    }
    throw "Python command not found."
}

function Setup-Game {
    Write-Step "Preparing install folder"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    if (Test-Path "$InstallDir\\.git") {
        Write-Step "Updating existing repository"
        git -C $InstallDir pull
    } else {
        Write-Step "Cloning repository"
        git clone $RepoUrl $InstallDir
    }

    $pyCmd = Get-PythonCommand

    Write-Step "Creating virtual environment"
    if ($pyCmd.Count -eq 2) {
        & $pyCmd[0] $pyCmd[1] -m venv "$InstallDir\\.venv"
    } else {
        & $pyCmd[0] -m venv "$InstallDir\\.venv"
    }

    $venvPython = "$InstallDir\\.venv\\Scripts\\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "venv python was not created: $venvPython"
    }

    Write-Step "Installing dependencies"
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r "$InstallDir\\requirements.txt"

    Write-Step "Starting game"
    & $venvPython "$InstallDir\\simple_rpg_template.py"
}

try {
    Ensure-Winget
    Ensure-Git
    Ensure-Python
    Setup-Game
}
catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
