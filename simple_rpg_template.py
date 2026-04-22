"""
授業用: AI連携RPGテンプレート（1ファイル）

v2 コンセプト
- NPCは10人、JSONで編集
- NPCは歩く（生きている感じ）
- 会話は3択質問
- 色はJSONのRGBで変更可能
- 物語は story.json
- 主人公は watashi.json
"""

import json
import math
import random
import sys
from pathlib import Path

import pygame

# 実行場所の基準:
# - 通常実行: BASE_DIR = この.pyがある場所
# - .exe実行(pyinstaller): BASE_DIR = .exeがある場所
# JSONは常に BASE_DIR から読み書きし、音声は RESOURCE_DIR から読む
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
else:
    BASE_DIR = Path(__file__).resolve().parent
    RESOURCE_DIR = BASE_DIR


# ============================================================
# 【ここを編集】画面とゲーム基本設定
# ============================================================
SCREEN_WIDTH = 1280
SCREEN_HEIGHT = 820
FPS = 60

TOP_PANEL_HEIGHT = 120
BOTTOM_PANEL_HEIGHT = 300  # 前より大きく
MAP_MARGIN = 14

PLAYER_SIZE = 39  # примерно +15%
PLAYER_SPEED = 220.0
TALK_DISTANCE = 88

MAP_RECT = pygame.Rect(
    MAP_MARGIN,
    TOP_PANEL_HEIGHT + MAP_MARGIN,
    SCREEN_WIDTH - MAP_MARGIN * 2,
    SCREEN_HEIGHT - TOP_PANEL_HEIGHT - BOTTOM_PANEL_HEIGHT - MAP_MARGIN * 2,
)

# 色
COLOR_BG = (24, 30, 40)
COLOR_TOP_PANEL = (242, 246, 252)
COLOR_MAP_GRASS = (118, 178, 110)
COLOR_MAP_ROAD = (186, 168, 125)
COLOR_MAP_WATER = (95, 158, 214)
COLOR_MAP_TREE = (70, 132, 72)
COLOR_PANEL_BORDER = (26, 32, 44)
COLOR_TEXT = (22, 28, 36)
COLOR_PLAYER = (66, 132, 255)
COLOR_PLAYER_BORDER = (18, 35, 88)
COLOR_DIALOG_BG = (251, 251, 246)
COLOR_ACCENT = (70, 100, 220)
COLOR_CHOICE_BG = (234, 239, 249)
COLOR_CHOICE_BG_ACTIVE = (207, 220, 247)
COLOR_DONE_MARK = (120, 205, 130)


# ============================================================
# 【ここを編集】NPC初期位置（10人）
# ============================================================
BASE_NPCS = [
    {"id": "seller", "role": "商人", "x": 210, "y": 275},
    {"id": "blacksmith", "role": "鍛冶屋", "x": 355, "y": 240},
    {"id": "guard", "role": "門番", "x": 520, "y": 290},
    {"id": "healer", "role": "治療師", "x": 700, "y": 355},
    {"id": "scholar", "role": "学者", "x": 865, "y": 260},
    {"id": "child", "role": "子ども", "x": 990, "y": 430},
    {"id": "farmer", "role": "農家", "x": 295, "y": 470},
    {"id": "traveler", "role": "旅人", "x": 485, "y": 435},
    {"id": "bard", "role": "吟遊詩人", "x": 760, "y": 475},
    {"id": "mystic", "role": "占い師", "x": 1030, "y": 250},
]

NPC_JSON_FILES = {
    "seller": BASE_DIR / "npc_seller.json",
    "blacksmith": BASE_DIR / "npc_blacksmith.json",
    "guard": BASE_DIR / "npc_guard.json",
    "healer": BASE_DIR / "npc_healer.json",
    "scholar": BASE_DIR / "npc_scholar.json",
    "child": BASE_DIR / "npc_child.json",
    "farmer": BASE_DIR / "npc_farmer.json",
    "traveler": BASE_DIR / "npc_traveler.json",
    "bard": BASE_DIR / "npc_bard.json",
    "mystic": BASE_DIR / "npc_mystic.json",
}

WATASHI_JSON_FILE = BASE_DIR / "watashi.json"
STORY_JSON_FILE = BASE_DIR / "story.json"
INTRO_MUSIC_FILE = RESOURCE_DIR / "intro.mp3"
LEVEL_MUSIC_FILE = RESOURCE_DIR / "level.mp3"
MUMBLE_SFX_FILE = RESOURCE_DIR / "mumble.wav"


# ============================================================
# RPGっぽい背景（壁なし）
# ============================================================
# 壁は使わない（ユーザー要望）
OBSTACLES: list[pygame.Rect] = []

ROADS = [
    pygame.Rect(MAP_RECT.x + 0, MAP_RECT.y + 235, MAP_RECT.width, 78),
    pygame.Rect(MAP_RECT.x + 560, MAP_RECT.y + 0, 86, MAP_RECT.height),
]

TREE_POINTS = [
    (MAP_RECT.x + 80, MAP_RECT.y + 85),
    (MAP_RECT.x + 140, MAP_RECT.y + 150),
    (MAP_RECT.x + 1120, MAP_RECT.y + 85),
    (MAP_RECT.x + 1060, MAP_RECT.y + 155),
    (MAP_RECT.x + 1160, MAP_RECT.y + 440),
    (MAP_RECT.x + 95, MAP_RECT.y + 420),
]


# ============================================================
# テキスト描画ユーティリティ
# ============================================================
def get_font(size: int) -> pygame.font.Font:
    candidates = ["msgothic", "yugothic", "meiryo", "hiraginosans", "arialunicode", "arial"]
    available = {name.lower() for name in pygame.font.get_fonts()}
    for name in candidates:
        if name.lower() in available:
            return pygame.font.SysFont(name, size)
    return pygame.font.SysFont(None, size)


def wrap_text_to_lines(text: str, font: pygame.font.Font, max_width: int) -> list[str]:
    if not text:
        return [""]

    out = []
    for para in str(text).split("\n"):
        cur = ""
        for ch in para:
            test = cur + ch
            if font.size(test)[0] <= max_width:
                cur = test
            else:
                if cur:
                    out.append(cur)
                cur = ch
        out.append(cur)
    return out


def draw_text_block(
    surface: pygame.Surface,
    text: str,
    font: pygame.font.Font,
    color: tuple[int, int, int],
    rect: pygame.Rect,
    line_spacing: int = 4,
    max_lines: int | None = None,
):
    lines = wrap_text_to_lines(text, font, rect.width)
    if max_lines is not None:
        lines = lines[:max_lines]

    y = rect.y
    line_h = font.get_height() + line_spacing
    for line in lines:
        img = font.render(line, True, color)
        surface.blit(img, (rect.x, y))
        y += line_h


# ============================================================
# JSONテンプレート（新フォーマット）
# ============================================================
def make_npc_template(npc_id: str, role: str, color_rgb: list[int]) -> dict:
    """
    NPC JSON新フォーマット。
    _ai_hidden は授業補助の隠しメタ。ゲーム内表示には使わない。
    """
    return {
        "id": npc_id,
        "role": role,
        "name": role,
        "personality": "",
        "color_rgb": color_rgb,
        "dialogue": {
            "ask_self": [],
            "ask_about_me": [],
            "ask_anything": [],
        },
        "move_speed": 60,
        "roam_radius": 95,
        "_ai_hidden": {
            "language": "ja",
            "student_visible_explanation": False,
            "task": "name/personality/dialogue/color_rgb を埋める",
            "constraints": [
                "dialogue の行数制限はなし（長文可）",
                "ゲーム側では1画面あたり最大5行表示",
                "color_rgb は [R,G,B] の整数(0〜255)",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
            "interaction_protocol": [
                "生成前に生徒へ質問する",
                "質問項目: 性格, 口調, 一人称, 主人公への態度, 好きなこと, 色RGB",
                "生徒の回答を反映してJSONを返す"
            ],
            "world_tone": "ファンタジーRPGの町",
        },
    }


def make_watashi_template() -> dict:
    return {
        "id": "watashi",
        "name": "ワタシ",
        "title": "見習い冒険者",
        "personality": "まじめ",
        "origin": "港町ミナト",
        "goal": "星の地図の欠片を集める",
        "color_rgb": [66, 132, 255],
        "_ai_hidden": {
            "language": "ja",
            "student_visible_explanation": False,
            "task": "主人公設定を具体化する",
            "constraints": [
                "中高生向けに分かりやすい日本語",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
        },
    }


def make_story_template() -> dict:
    return {
        "id": "story",
        "world_name": "",
        "chapter_title": "",
        "intro_lines": [],
        "_ai_hidden": {
            "language": "ja",
            "student_visible_explanation": False,
            "task": "chapter_title と intro_lines を作る",
            "constraints": [
                "行数制限なし（長文可）",
                "ゲーム側では1画面あたり最大5行表示",
                "中高生向けの安全な内容",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
            "interaction_protocol": [
                "生成前に生徒へ質問する",
                "質問項目: 世界観, 雰囲気, 主人公の立場, 最初の目的",
                "生徒の回答を反映してJSONを返す"
            ],
        },
    }


def ensure_json_templates_exist():
    role_by_id = {n["id"]: n["role"] for n in BASE_NPCS}
    default_colors = {
        "seller": [255, 170, 80],
        "blacksmith": [199, 127, 77],
        "guard": [90, 150, 220],
        "healer": [120, 205, 160],
        "scholar": [185, 145, 225],
        "child": [255, 205, 95],
        "farmer": [170, 190, 85],
        "traveler": [130, 165, 230],
        "bard": [235, 130, 190],
        "mystic": [140, 130, 210],
    }

    for npc_id, path in NPC_JSON_FILES.items():
        if path.exists():
            continue
        path.write_text(
            json.dumps(make_npc_template(npc_id, role_by_id[npc_id], default_colors[npc_id]), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    if not WATASHI_JSON_FILE.exists():
        WATASHI_JSON_FILE.write_text(json.dumps(make_watashi_template(), ensure_ascii=False, indent=2), encoding="utf-8")

    if not STORY_JSON_FILE.exists():
        STORY_JSON_FILE.write_text(json.dumps(make_story_template(), ensure_ascii=False, indent=2), encoding="utf-8")


# ============================================================
# JSON読み込み
# ============================================================
def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def clean_lines(obj) -> list[str]:
    if not isinstance(obj, list):
        return []
    out = []
    for x in obj:
        s = str(x).strip()
        if s:
            out.append(s)
    return out


def build_dialog_pages(raw_lines: list[str], font: pygame.font.Font, max_width: int, max_lines_per_page: int = 5) -> list[str]:
    """
    長文をページ分割する。
    - JSON上の行数制限はなし
    - 画面表示は1ページ最大5行
    """
    if not raw_lines:
        return []

    all_wrapped = []
    for i, raw in enumerate(raw_lines):
        wrapped = wrap_text_to_lines(raw, font, max_width)
        all_wrapped.extend(wrapped)
        if i < len(raw_lines) - 1:
            all_wrapped.append("")

    pages = []
    for i in range(0, len(all_wrapped), max_lines_per_page):
        pages.append("\n".join(all_wrapped[i : i + max_lines_per_page]))
    return pages


def parse_rgb(obj, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if not isinstance(obj, list) or len(obj) != 3:
        return fallback
    vals = []
    for v in obj:
        if not isinstance(v, (int, float)):
            return fallback
        vals.append(max(0, min(255, int(v))))
    return (vals[0], vals[1], vals[2])


def apply_npc_payload(npc_data: dict, payload: dict):
    if isinstance(payload.get("name"), str) and payload["name"].strip():
        npc_data["name"] = payload["name"].strip()

    if isinstance(payload.get("role"), str) and payload["role"].strip():
        npc_data["role"] = payload["role"].strip()

    if isinstance(payload.get("personality"), str):
        npc_data["personality"] = payload["personality"].strip()

    npc_data["color_rgb"] = parse_rgb(payload.get("color_rgb"), npc_data["color_rgb"])

    dialogue = payload.get("dialogue", {})
    if isinstance(dialogue, dict):
        npc_data["dialogue"]["ask_self"] = clean_lines(dialogue.get("ask_self", []))
        npc_data["dialogue"]["ask_about_me"] = clean_lines(dialogue.get("ask_about_me", []))
        npc_data["dialogue"]["ask_anything"] = clean_lines(dialogue.get("ask_anything", []))

    ms = payload.get("move_speed")
    rr = payload.get("roam_radius")

    if isinstance(ms, (int, float)):
        npc_data["move_speed"] = max(20.0, min(float(ms), 150.0))
    if isinstance(rr, (int, float)):
        npc_data["roam_radius"] = max(20.0, min(float(rr), 200.0))


def load_all_json(npc_states: list[dict], watashi: dict, story: dict) -> str:
    by_id = {s["data"]["id"]: s for s in npc_states}

    count = 0
    for npc_id, path in NPC_JSON_FILES.items():
        if not path.exists():
            return f"エラー: {path.name} が見つかりません"
        try:
            payload = load_json(path)
        except Exception as e:
            return f"エラー: {path.name} ({e})"

        if not isinstance(payload, dict):
            return f"形式エラー: {path.name} はJSONオブジェクトにしてください"

        if payload.get("id") != npc_id:
            return f"IDエラー: {path.name} の id は '{npc_id}'"

        apply_npc_payload(by_id[npc_id]["data"], payload)
        count += 1

    if not WATASHI_JSON_FILE.exists():
        return "エラー: watashi.json が見つかりません"
    try:
        payload = load_json(WATASHI_JSON_FILE)
    except Exception as e:
        return f"エラー: watashi.json ({e})"

    if not isinstance(payload, dict) or payload.get("id") != "watashi":
        return "ID/形式エラー: watashi.json"

    for key in ["name", "title", "personality", "origin", "goal"]:
        if isinstance(payload.get(key), str):
            watashi[key] = payload[key].strip() or watashi[key]

    watashi["color_rgb"] = parse_rgb(payload.get("color_rgb"), watashi["color_rgb"])

    if not STORY_JSON_FILE.exists():
        return "エラー: story.json が見つかりません"
    try:
        payload = load_json(STORY_JSON_FILE)
    except Exception as e:
        return f"エラー: story.json ({e})"

    if not isinstance(payload, dict) or payload.get("id") != "story":
        return "ID/形式エラー: story.json"

    for key in ["world_name", "chapter_title"]:
        if isinstance(payload.get(key), str):
            story[key] = payload[key].strip() or story[key]

    intro = clean_lines(payload.get("intro_lines", []))
    if intro:
        story["intro_lines"] = intro

    return f"ロード完了: NPC {count}/10"


# ============================================================
# 移動
# ============================================================
def move_with_bounds(rect: pygame.Rect, dx: float, dy: float, bounds: pygame.Rect):
    rect.x += int(dx)
    rect.y += int(dy)

    if rect.left < bounds.left:
        rect.left = bounds.left
    if rect.right > bounds.right:
        rect.right = bounds.right
    if rect.top < bounds.top:
        rect.top = bounds.top
    if rect.bottom > bounds.bottom:
        rect.bottom = bounds.bottom


def update_npc_movement(npc_states: list[dict], dt: float, freeze: bool):
    if freeze:
        return

    for s in npc_states:
        d = s["data"]
        r = s["rect"]
        s["decision_timer"] -= dt

        if s["decision_timer"] <= 0:
            if random.random() < 0.30:
                s["vx"] = 0.0
                s["vy"] = 0.0
                s["decision_timer"] = random.uniform(0.7, 1.6)
            else:
                ang = random.uniform(0.0, math.tau)
                sp = float(d.get("move_speed", 60.0))
                s["vx"] = math.cos(ang) * sp
                s["vy"] = math.sin(ang) * sp
                s["decision_timer"] = random.uniform(0.8, 2.1)

        fx = s["fx"] + s["vx"] * dt
        fy = s["fy"] + s["vy"] * dt

        test = pygame.Rect(int(fx), int(fy), r.width, r.height)

        home_x = s["home_x"]
        home_y = s["home_y"]
        roam = float(d.get("roam_radius", 95.0))

        dist_home = math.hypot(test.centerx - home_x, test.centery - home_y)
        if dist_home > roam:
            vx = home_x - test.centerx
            vy = home_y - test.centery
            ln = math.hypot(vx, vy) or 1.0
            sp = float(d.get("move_speed", 60.0))
            s["vx"] = (vx / ln) * sp
            s["vy"] = (vy / ln) * sp
            fx = s["fx"] + s["vx"] * dt
            fy = s["fy"] + s["vy"] * dt
            test = pygame.Rect(int(fx), int(fy), r.width, r.height)

        if not MAP_RECT.contains(test):
            s["vx"] *= -0.7
            s["vy"] *= -0.7
            s["decision_timer"] = random.uniform(0.15, 0.6)
        else:
            s["fx"] = fx
            s["fy"] = fy
            r.x = int(s["fx"])
            r.y = int(s["fy"])


def find_nearest_npc(player_rect: pygame.Rect, npc_states: list[dict]):
    idx = None
    best = 999999.0
    px, py = player_rect.center
    for i, s in enumerate(npc_states):
        nx, ny = s["rect"].center
        dist = math.hypot(px - nx, py - ny)
        if dist < best:
            best = dist
            idx = i
    return idx, best


# ============================================================
# 描画
# ============================================================
def draw_top_panel(screen, font_m, font_s, mission_text, status_text):
    panel = pygame.Rect(0, 0, SCREEN_WIDTH, TOP_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_TOP_PANEL, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.bottom - 1), (SCREEN_WIDTH, panel.bottom - 1), 2)

    t = "AI RPG: 町の10人と会話しよう"
    img = font_m.render(t, True, COLOR_TEXT)
    screen.blit(img, (20, 12))

    draw_text_block(screen, mission_text, font_s, COLOR_TEXT, pygame.Rect(22, 50, SCREEN_WIDTH - 44, 28), max_lines=1)

    # JSON案内は上部から消し、短い状態だけ右上へ
    sbox = pygame.Rect(SCREEN_WIDTH - 290, 12, 270, 34)
    pygame.draw.rect(screen, (255, 255, 255), sbox)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, sbox, 1)
    draw_text_block(screen, status_text, font_s, COLOR_ACCENT, sbox.inflate(-10, -6), max_lines=1)


def draw_map(screen):
    pygame.draw.rect(screen, COLOR_MAP_GRASS, MAP_RECT)

    for road in ROADS:
        pygame.draw.rect(screen, COLOR_MAP_ROAD, road)

    water = pygame.Rect(MAP_RECT.x + 850, MAP_RECT.y + 330, 250, 130)
    pygame.draw.ellipse(screen, COLOR_MAP_WATER, water)
    pygame.draw.ellipse(screen, COLOR_PANEL_BORDER, water, 2)

    for x, y in TREE_POINTS:
        pygame.draw.circle(screen, COLOR_MAP_TREE, (x, y), 22)
        pygame.draw.circle(screen, COLOR_PANEL_BORDER, (x, y), 22, 2)

    pygame.draw.rect(screen, COLOR_PANEL_BORDER, MAP_RECT, 2)


def draw_npcs(screen, npc_states, nearest_idx, font_name):
    for i, s in enumerate(npc_states):
        r = s["rect"]
        d = s["data"]
        col = d["color_rgb"]

        pygame.draw.rect(screen, col, r, border_radius=7)
        pygame.draw.rect(screen, COLOR_PANEL_BORDER, r, 2, border_radius=7)

        # かんたんな顔（目2つ + 口）
        eye_y = r.y + 11
        left_eye = (r.x + 11, eye_y)
        right_eye = (r.x + r.width - 11, eye_y)
        pygame.draw.circle(screen, COLOR_PANEL_BORDER, left_eye, 2)
        pygame.draw.circle(screen, COLOR_PANEL_BORDER, right_eye, 2)
        mouth_rect = pygame.Rect(r.x + 10, r.y + 17, r.width - 20, 7)
        pygame.draw.arc(screen, COLOR_PANEL_BORDER, mouth_rect, 0.2, math.pi - 0.2, 1)

        if d.get("talked"):
            pygame.draw.circle(screen, COLOR_DONE_MARK, (r.right + 6, r.y + 6), 5)

        # 近いNPCは「Talk」ではなく名前表示
        if nearest_idx == i:
            name = d["name"]
            w = max(72, min(220, font_name.size(name)[0] + 20))
            bubble = pygame.Rect(r.centerx - w // 2, r.y - 30, w, 24)
            pygame.draw.rect(screen, (255, 255, 255), bubble, border_radius=9)
            pygame.draw.rect(screen, COLOR_PANEL_BORDER, bubble, 1, border_radius=9)
            img = font_name.render(name, True, COLOR_TEXT)
            screen.blit(img, (bubble.centerx - img.get_width() // 2, bubble.y + 3))


def draw_player(screen, rect, color_rgb):
    pygame.draw.rect(screen, color_rgb, rect, border_radius=7)
    pygame.draw.rect(screen, COLOR_PLAYER_BORDER, rect, 2, border_radius=7)

    # 主人公の顔（NPCと同じくシンプル）
    eye_y = rect.y + 11
    left_eye = (rect.x + 11, eye_y)
    right_eye = (rect.x + rect.width - 11, eye_y)
    pygame.draw.circle(screen, COLOR_PLAYER_BORDER, left_eye, 2)
    pygame.draw.circle(screen, COLOR_PLAYER_BORDER, right_eye, 2)
    mouth_rect = pygame.Rect(rect.x + 10, rect.y + 17, rect.width - 20, 7)
    pygame.draw.arc(screen, COLOR_PLAYER_BORDER, mouth_rect, 0.2, math.pi - 0.2, 1)

    # 主人公マーク: 小さな王冠
    crown_w = 18
    crown_h = 10
    cx = rect.centerx
    base_y = rect.y - 6

    crown_points = [
        (cx - crown_w // 2, base_y),
        (cx - crown_w // 3, base_y - crown_h),
        (cx, base_y - crown_h // 2 - 3),
        (cx + crown_w // 3, base_y - crown_h),
        (cx + crown_w // 2, base_y),
    ]

    pygame.draw.polygon(screen, (245, 206, 78), crown_points)
    pygame.draw.polygon(screen, COLOR_PANEL_BORDER, crown_points, 1)


def draw_dialog_panel(
    screen,
    font_title,
    font_body,
    font_small,
    npc_data,
    phase,
    line,
    line_idx,
    line_total,
    selected_choice,
):
    panel = pygame.Rect(0, SCREEN_HEIGHT - BOTTOM_PANEL_HEIGHT, SCREEN_WIDTH, BOTTOM_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_DIALOG_BG, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.y), (SCREEN_WIDTH, panel.y), 2)

    title = f"{npc_data['name']} / 役割: {npc_data['role']} / 性格: {npc_data.get('personality') or '未設定'}"
    draw_text_block(screen, title, font_title, COLOR_TEXT, pygame.Rect(20, panel.y + 14, SCREEN_WIDTH - 40, 30), max_lines=1)

    if phase == "choice":
        q1 = "1. 自己紹介して"
        q2 = "2. わたしのことどう思う？"
        q3 = "3. 何か話して"
        qs = [q1, q2, q3]

        for i, q in enumerate(qs):
            y = panel.y + 62 + i * 64
            box = pygame.Rect(24, y, SCREEN_WIDTH - 48, 52)
            bg = COLOR_CHOICE_BG_ACTIVE if selected_choice == i else COLOR_CHOICE_BG
            pygame.draw.rect(screen, bg, box, border_radius=8)
            pygame.draw.rect(screen, COLOR_PANEL_BORDER, box, 1, border_radius=8)
            draw_text_block(screen, q, font_body, COLOR_TEXT, box.inflate(-14, -11), max_lines=1)

        hint = "1/2/3: 選択   SPACE: 会話を終える"
        h_img = font_small.render(hint, True, COLOR_TEXT)
        screen.blit(h_img, (SCREEN_WIDTH - h_img.get_width() - 20, panel.bottom - 32))
    else:
        # 下欄は広く。1ページ最大5行で表示
        body_rect = pygame.Rect(22, panel.y + 58, SCREEN_WIDTH - 44, 176)
        draw_text_block(screen, line, font_body, COLOR_TEXT, body_rect, line_spacing=7, max_lines=5)

        page = f"{line_idx + 1}/{max(1, line_total)}"
        p_img = font_small.render(page, True, COLOR_TEXT)
        h_img = font_small.render("SPACE: 次へ", True, COLOR_TEXT)
        screen.blit(p_img, (22, panel.bottom - 32))
        screen.blit(h_img, (SCREEN_WIDTH - h_img.get_width() - 20, panel.bottom - 32))


def draw_bottom_message(screen, font_body, text):
    panel = pygame.Rect(0, SCREEN_HEIGHT - BOTTOM_PANEL_HEIGHT, SCREEN_WIDTH, BOTTOM_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_DIALOG_BG, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.y), (SCREEN_WIDTH, panel.y), 2)

    draw_text_block(
        screen,
        text,
        font_body,
        COLOR_TEXT,
        pygame.Rect(24, panel.y + 24, SCREEN_WIDTH - 48, BOTTOM_PANEL_HEIGHT - 50),
        line_spacing=6,
        max_lines=8,
    )


def draw_title_screen(screen, font_l, font_m):
    screen.fill(COLOR_BG)
    box = pygame.Rect(120, 120, SCREEN_WIDTH - 240, SCREEN_HEIGHT - 240)
    pygame.draw.rect(screen, COLOR_TOP_PANEL, box, border_radius=16)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, box, 3, border_radius=16)

    t1 = "ルーメン王国の朝"
    t2 = "AIでキャラクターを育てる授業RPG"
    t3 = "はじめる"

    i1 = font_l.render(t1, True, COLOR_TEXT)
    i2 = font_m.render(t2, True, COLOR_TEXT)
    i3 = font_m.render(t3, True, COLOR_ACCENT)

    screen.blit(i1, (box.centerx - i1.get_width() // 2, box.y + 95))
    screen.blit(i2, (box.centerx - i2.get_width() // 2, box.y + 195))
    screen.blit(i3, (box.centerx - i3.get_width() // 2, box.y + 295))


def draw_intro_screen(screen, font_l, font_m, font_s, page_text, page_idx, page_total, watashi, story):
    screen.fill((20, 25, 33))
    box = pygame.Rect(90, 80, SCREEN_WIDTH - 180, SCREEN_HEIGHT - 160)
    pygame.draw.rect(screen, (244, 247, 252), box, border_radius=16)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, box, 3, border_radius=16)

    header = f"主人公: {watashi['name']} / {watashi['title']}"
    h_img = font_m.render(header, True, COLOR_TEXT)
    screen.blit(h_img, (box.x + 24, box.y + 22))

    sub = f"性格: {watashi['personality']}   出身: {watashi['origin']}   目的: {watashi['goal']}"
    draw_text_block(screen, sub, font_s, COLOR_TEXT, pygame.Rect(box.x + 24, box.y + 60, box.width - 48, 28), max_lines=1)

    draw_text_block(
        screen,
        page_text,
        font_l,
        COLOR_TEXT,
        pygame.Rect(box.x + 24, box.y + 116, box.width - 48, box.height - 230),
        line_spacing=11,
        max_lines=8,
    )

    world = f"世界: {story['world_name']} / 章: {story['chapter_title']}"
    draw_text_block(screen, world, font_s, COLOR_TEXT, pygame.Rect(box.x + 24, box.bottom - 86, box.width - 48, 24), max_lines=1)

    footer = f"{page_idx + 1}/{page_total}"
    f_img = font_m.render(footer, True, COLOR_ACCENT)
    screen.blit(f_img, (box.right - f_img.get_width() - 24, box.bottom - 46))


def switch_music(audio_enabled: bool, current_key: str, target_key: str, target_file: Path) -> str:
    """
    BGMを切り替える。target_key が current_key と同じなら何もしない。
    target_key が空文字なら停止する。
    """
    if not audio_enabled:
        return current_key

    if current_key == target_key:
        return current_key

    try:
        if target_key == "":
            pygame.mixer.music.stop()
            return ""

        if target_file.exists():
            pygame.mixer.music.load(str(target_file))
            pygame.mixer.music.play(-1)  # 無限ループ
            return target_key
    except Exception:
        return current_key

    return current_key


# ============================================================
# メイン
# ============================================================
def main():
    pygame.init()
    pygame.display.set_caption("AI RPG Template")

    if not pygame.font:
        print("エラー: pygame font モジュールが使えません。")
        print("対処: pip install pygame-ce")
        pygame.quit()
        sys.exit(1)

    # 音声初期化（失敗してもゲームは続行）
    audio_enabled = True
    try:
        pygame.mixer.init()
    except Exception:
        audio_enabled = False

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    clock = pygame.time.Clock()

    font_s = get_font(22)
    font_m = get_font(30)
    font_l = get_font(42)
    font_name = get_font(18)
    # 下部会話用は小さめ
    font_dialog_title = get_font(27)
    font_dialog_body = get_font(26)

    ensure_json_templates_exist()

    watashi = {
        "name": "ワタシ",
        "title": "見習い冒険者",
        "personality": "まじめ",
        "origin": "港町ミナト",
        "goal": "星の地図の欠片を集める",
        "color_rgb": (66, 132, 255),
    }

    story = {"world_name": "", "chapter_title": "", "intro_lines": []}

    player_rect = pygame.Rect(MAP_RECT.x + 56, MAP_RECT.y + 65, PLAYER_SIZE, PLAYER_SIZE)

    npc_states = []
    default_color = (255, 170, 80)
    for b in BASE_NPCS:
        d = {
            "id": b["id"],
            "role": b["role"],
            "name": b["role"],
            "personality": "",
            "color_rgb": default_color,
            "dialogue": {
                "ask_self": [],
                "ask_about_me": [],
                "ask_anything": [],
            },
            "move_speed": 60.0,
            "roam_radius": 95.0,
            "talked": False,
        }

        rect = pygame.Rect(b["x"], b["y"], 34, 34)
        npc_states.append(
            {
                "data": d,
                "rect": rect,
                "home_x": rect.centerx,
                "home_y": rect.centery,
                "fx": float(rect.x),
                "fy": float(rect.y),
                "vx": 0.0,
                "vy": 0.0,
                "decision_timer": random.uniform(0.2, 1.8),
            }
        )

    status_message = load_all_json(npc_states, watashi, story)

    state = "title"  # title -> intro -> play -> clear
    intro_pages = list(story.get("intro_lines", []))
    intro_idx = 0

    talking = False
    talking_npc_idx = None
    talk_phase = "choice"  # choice / lines
    selected_choice = 0
    current_pages = []
    current_page_idx = 0
    current_music = ""
    mumble_sfx = None

    if audio_enabled and MUMBLE_SFX_FILE.exists():
        try:
            mumble_sfx = pygame.mixer.Sound(str(MUMBLE_SFX_FILE))
            mumble_sfx.set_volume(1.0)
        except Exception:
            mumble_sfx = None

    choice_items = [
        ("ask_self", "自己紹介して"),
        ("ask_about_me", "わたしのことどう思う？"),
        ("ask_anything", "何か話して"),
    ]

    running = True
    while running:
        dt = clock.tick(FPS) / 1000.0

        nearest_idx, nearest_dist = find_nearest_npc(player_rect, npc_states)

        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False

            if ev.type == pygame.KEYDOWN:
                if state == "title":
                    if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                        status_message = load_all_json(npc_states, watashi, story)
                        intro_pages = list(story.get("intro_lines", []))
                        if not intro_pages:
                            intro_pages = ["物語が空です。story.json の intro_lines を編集してください。"]
                        intro_idx = 0
                        state = "intro"
                    continue

                if state == "intro":
                    if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                        intro_idx += 1
                        if intro_idx >= len(intro_pages):
                            state = "play"
                    continue

                if state in ("play", "clear"):
                    if ev.key == pygame.K_i and not talking:
                        status_message = load_all_json(npc_states, watashi, story)

                    if ev.key == pygame.K_SPACE:
                        if talking:
                            if talk_phase == "choice":
                                # choice画面でSPACE -> 会話終了
                                talking = False
                                talking_npc_idx = None
                            else:
                                current_page_idx += 1
                                if current_page_idx >= len(current_pages):
                                    talk_phase = "choice"
                                    current_page_idx = 0
                                    current_pages = []
                        else:
                            if nearest_idx is not None and nearest_dist <= TALK_DISTANCE:
                                talking = True
                                talking_npc_idx = nearest_idx
                                talk_phase = "choice"
                                selected_choice = 0
                                current_pages = []
                                current_page_idx = 0
                                if mumble_sfx is not None:
                                    mumble_sfx.play()

                    if talking and talk_phase == "choice":
                        key_to_idx = {
                            pygame.K_1: 0,
                            pygame.K_KP1: 0,
                            pygame.K_2: 1,
                            pygame.K_KP2: 1,
                            pygame.K_3: 2,
                            pygame.K_KP3: 2,
                        }
                        if ev.key in key_to_idx:
                            selected_choice = key_to_idx[ev.key]
                            q_key = choice_items[selected_choice][0]

                            npc = npc_states[talking_npc_idx]["data"]
                            lines = npc["dialogue"].get(q_key, [])

                            if not lines:
                                lines = ["……（まだ準備中）", "JSONの dialogue を編集してみよう。"]

                            npc["talked"] = True
                            current_pages = build_dialog_pages(
                                lines,
                                font_dialog_body,
                                SCREEN_WIDTH - 44,
                                max_lines_per_page=5,
                            )
                            current_page_idx = 0
                            talk_phase = "lines"

        # 更新
        if state in ("play", "clear"):
            if all(s["data"].get("talked", False) for s in npc_states):
                state = "clear"

            if not talking:
                keys = pygame.key.get_pressed()
                dx = 0.0
                dy = 0.0

                if keys[pygame.K_UP] or keys[pygame.K_w]:
                    dy -= PLAYER_SPEED * dt
                if keys[pygame.K_DOWN] or keys[pygame.K_s]:
                    dy += PLAYER_SPEED * dt
                if keys[pygame.K_LEFT] or keys[pygame.K_a]:
                    dx -= PLAYER_SPEED * dt
                if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
                    dx += PLAYER_SPEED * dt

                move_with_bounds(player_rect, dx, dy, MAP_RECT)

            update_npc_movement(npc_states, dt, freeze=talking)

        # BGM状態を画面状態に同期
        # - intro: intro.mp3
        # - play/clear: level.mp3
        # - title: 停止
        if state == "intro":
            current_music = switch_music(audio_enabled, current_music, "intro", INTRO_MUSIC_FILE)
        elif state in ("play", "clear"):
            current_music = switch_music(audio_enabled, current_music, "level", LEVEL_MUSIC_FILE)
        else:
            current_music = switch_music(audio_enabled, current_music, "", Path(""))

        # 描画
        if state == "title":
            draw_title_screen(screen, font_l, font_m)
            pygame.display.flip()
            continue

        if state == "intro":
            draw_intro_screen(screen, font_l, font_m, font_s, intro_pages[intro_idx], intro_idx, len(intro_pages), watashi, story)
            pygame.display.flip()
            continue

        screen.fill(COLOR_BG)
        draw_map(screen)

        talked_count = sum(1 for s in npc_states if s["data"].get("talked"))
        mission = f"ミッション: 10人と会話する ({talked_count}/10)"

        draw_top_panel(screen, font_m, font_s, mission, status_message)
        draw_npcs(screen, npc_states, nearest_idx, font_name)
        draw_player(screen, player_rect, watashi["color_rgb"])

        if talking and talking_npc_idx is not None:
            npc = npc_states[talking_npc_idx]["data"]
            line = current_pages[current_page_idx] if current_pages else ""
            draw_dialog_panel(
                screen,
                font_dialog_title,
                font_dialog_body,
                font_s,
                npc,
                talk_phase,
                line,
                current_page_idx,
                len(current_pages),
                selected_choice,
            )
        else:
            msg = "移動: 矢印 / WASD"
            if state == "clear":
                msg = "クリア！"
            draw_bottom_message(screen, font_dialog_body, msg)

        pygame.display.flip()

    pygame.quit()
    sys.exit()


if __name__ == "__main__":
    main()
