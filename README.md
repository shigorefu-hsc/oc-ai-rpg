# AI RPG Template

## Controls
- `ENTER` : Start / Next page (title and intro)
- `Arrow Keys` or `WASD` : Move player
- `SPACE` : Start talk / Next dialogue page / Close question menu
- `1` / `2` / `3` : Select question during dialogue
- `I` : Reload all JSON files

## JSON files
- NPC (10 files): `npc_*.json`
- Player: `watashi.json`
- Story: `story.json`

## Notes
- NPC color uses `color_rgb: [R, G, B]`
- Dialogue supports long text; game shows max 5 lines per page

## Build .exe on Windows
Use `build_windows_exe.ps1`.

What gets bundled into `.exe`:
- Python code
- Audio files (`intro.mp3`, `level.mp3`, `mumble.wav`)

What stays external (editable):
- `npc_*.json`
- `watashi.json`
- `story.json`

After build, copy these JSON files next to `dist\\oc_ai_rpg.exe`.
