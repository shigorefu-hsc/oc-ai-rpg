# AI RPG Template (Source)

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
Run from project root:
- `installer\\build_exe_one_click.bat`

Output:
- `installer\\dist\\oc_ai_rpg.exe`
- editable JSON files are copied next to EXE.
