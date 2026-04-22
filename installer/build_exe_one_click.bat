@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1_PATH=%SCRIPT_DIR%build_windows_exe.ps1"

if not exist "%PS1_PATH%" (
  echo ERROR: build_windows_exe.ps1 not found:
  echo %PS1_PATH%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo Build failed with exit code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
