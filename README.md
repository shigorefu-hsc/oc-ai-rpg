# Project Structure

- `source/` : game source code, JSON content files, audio assets, Python dependencies
- `installer/` : Windows EXE build scripts

## One-click EXE build (Windows)
Run:
- `installer\\build_exe_one_click.bat`

If Python is missing, the builder installs it automatically via `winget`.

Output:
- `installer\\dist\\oc_ai_rpg.exe`
- editable JSON files are copied next to EXE.
