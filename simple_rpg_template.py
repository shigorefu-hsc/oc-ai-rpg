"""
授業用: AI連携しやすい超シンプルRPG（1ファイル）

このテンプレートの狙い:
- NPCはJSONで管理（10人分）
- 生徒はJSONをChatGPTに渡して性格・セリフを作る
- ゲーム内で I キーを押して一括インポート
- 会話して全員と話すとクリア

日本語UI / シンプル2D / 見下ろし型 / pygame
"""

import json
import math
import random
import sys
from pathlib import Path

import pygame


# ============================================================
# 【ここを編集】ゲーム基本設定
# ============================================================
SCREEN_WIDTH = 1280
SCREEN_HEIGHT = 800
FPS = 60

TOP_PANEL_HEIGHT = 170
BOTTOM_PANEL_HEIGHT = 250
MAP_MARGIN = 16

PLAYER_SIZE = 34
PLAYER_SPEED = 220.0  # px / sec
TALK_DISTANCE = 85

# マップ描画領域（ここにプレイヤー/NPCが居る）
MAP_RECT = pygame.Rect(
    MAP_MARGIN,
    TOP_PANEL_HEIGHT + MAP_MARGIN,
    SCREEN_WIDTH - MAP_MARGIN * 2,
    SCREEN_HEIGHT - TOP_PANEL_HEIGHT - BOTTOM_PANEL_HEIGHT - MAP_MARGIN * 2,
)

# 色
COLOR_BG = (28, 33, 41)
COLOR_TOP_PANEL = (240, 244, 250)
COLOR_MAP_GRASS = (121, 182, 117)
COLOR_MAP_ROAD = (183, 166, 120)
COLOR_MAP_WATER = (98, 160, 210)
COLOR_PANEL_BORDER = (30, 36, 48)
COLOR_TEXT = (22, 28, 38)
COLOR_PLAYER = (65, 135, 255)
COLOR_PLAYER_BORDER = (15, 35, 90)
COLOR_NPC = (255, 172, 86)
COLOR_NPC_TALKED = (125, 205, 132)
COLOR_DIALOG_BG = (252, 252, 248)
COLOR_ACCENT = (75, 103, 224)
COLOR_WARNING = (190, 70, 60)


# ============================================================
# 【ここを編集】NPC初期配置（10人）
# ============================================================
# 授業では通常、JSON側を編集する。
# ここは「位置」や「初期配置」を調整したいときに編集。
BASE_NPCS = [
    {"id": "seller", "role": "商人", "x": 220, "y": 300},
    {"id": "blacksmith", "role": "鍛冶屋", "x": 360, "y": 240},
    {"id": "guard", "role": "門番", "x": 520, "y": 280},
    {"id": "healer", "role": "治療師", "x": 700, "y": 360},
    {"id": "scholar", "role": "学者", "x": 860, "y": 270},
    {"id": "child", "role": "子ども", "x": 980, "y": 430},
    {"id": "farmer", "role": "農家", "x": 300, "y": 470},
    {"id": "traveler", "role": "旅人", "x": 490, "y": 430},
    {"id": "bard", "role": "吟遊詩人", "x": 760, "y": 470},
    {"id": "mystic", "role": "占い師", "x": 1020, "y": 260},
]

# JSONファイル名（プロジェクト直下）
NPC_JSON_FILES = {
    "seller": Path("npc_seller.json"),
    "blacksmith": Path("npc_blacksmith.json"),
    "guard": Path("npc_guard.json"),
    "healer": Path("npc_healer.json"),
    "scholar": Path("npc_scholar.json"),
    "child": Path("npc_child.json"),
    "farmer": Path("npc_farmer.json"),
    "traveler": Path("npc_traveler.json"),
    "bard": Path("npc_bard.json"),
    "mystic": Path("npc_mystic.json"),
}

WATASHI_JSON_FILE = Path("watashi.json")
STORY_JSON_FILE = Path("story.json")


# ============================================================
# マップオブジェクト（簡易RPG環境）
# ============================================================
# 衝突判定用の障害物（家・池・柵など）
OBSTACLES = [
    pygame.Rect(MAP_RECT.x + 70, MAP_RECT.y + 50, 160, 120),
    pygame.Rect(MAP_RECT.x + 960, MAP_RECT.y + 50, 190, 130),
    pygame.Rect(MAP_RECT.x + 420, MAP_RECT.y + 370, 230, 110),
    pygame.Rect(MAP_RECT.x + 760, MAP_RECT.y + 170, 150, 90),
    pygame.Rect(MAP_RECT.x + 150, MAP_RECT.y + 300, 120, 80),
]

# 道（見た目だけ）
ROADS = [
    pygame.Rect(MAP_RECT.x + 0, MAP_RECT.y + 245, MAP_RECT.width, 70),
    pygame.Rect(MAP_RECT.x + 555, MAP_RECT.y + 0, 80, MAP_RECT.height),
]


# ============================================================
# 文字描画ユーティリティ
# ============================================================
def get_font(size: int) -> pygame.font.Font:
    """日本語を表示しやすいフォントを優先して返す。"""
    candidates = ["msgothic", "yugothic", "meiryo", "hiraginosans", "arialunicode", "arial"]
    available = {name.lower() for name in pygame.font.get_fonts()}

    for name in candidates:
        if name.lower() in available:
            return pygame.font.SysFont(name, size)

    return pygame.font.SysFont(None, size)


def wrap_text_to_lines(text: str, font: pygame.font.Font, max_width: int) -> list[str]:
    """指定幅で自動改行した行リストを返す。"""
    if not text:
        return [""]

    lines = []
    for paragraph in str(text).split("\n"):
        current = ""
        for ch in paragraph:
            test = current + ch
            if font.size(test)[0] <= max_width:
                current = test
            else:
                if current:
                    lines.append(current)
                current = ch
        lines.append(current)
    return lines


def draw_text_block(
    surface: pygame.Surface,
    text: str,
    font: pygame.font.Font,
    color: tuple[int, int, int],
    rect: pygame.Rect,
    line_spacing: int = 6,
    max_lines: int | None = None,
) -> int:
    """矩形内にテキストを描画し、描画した高さ(px)を返す。"""
    lines = wrap_text_to_lines(text, font, rect.width)
    if max_lines is not None:
        lines = lines[:max_lines]

    y = rect.y
    line_h = font.get_height() + line_spacing
    for line in lines:
        img = font.render(line, True, color)
        surface.blit(img, (rect.x, y))
        y += line_h

    return y - rect.y


# ============================================================
# JSONテンプレート生成
# ============================================================
def make_npc_template(npc_id: str, role: str) -> dict:
    """
    生徒向けNPC JSONテンプレート。
    _ai_* はゲーム内で表示しない「AI向け隠しヒント」。
    """
    return {
        "id": npc_id,
        "role": role,
        "name": role,
        "personality": "",
        "lines": [],
        "move_speed": 60,
        "roam_radius": 90,
        "_ai_tags": {
            "language": "ja",
            "task": "name, personality, lines を埋める",
            "constraints": [
                "lines は 3〜5 個",
                "1行は 8〜28 文字程度",
                "授業向けに安全な内容",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
            "tone_hint": "世界観はファンタジーRPGの町",
        },
    }


def make_watashi_template() -> dict:
    """プレイヤー（自分）用JSONテンプレート。"""
    return {
        "id": "watashi",
        "name": "ワタシ",
        "title": "見習い冒険者",
        "personality": "まじめ",
        "origin": "港町ミナト",
        "goal": "星の地図の欠片を集める",
        "_ai_tags": {
            "language": "ja",
            "task": "主人公設定を具体化する",
            "constraints": [
                "中高生向けに分かりやすい日本語",
                "暴力/差別/過激表現を避ける",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
        },
    }


def make_story_template() -> dict:
    """ワールドストーリー用JSONテンプレート。"""
    return {
        "id": "story",
        "world_name": "ルーメン王国",
        "chapter_title": "朝霧のはじまり",
        "intro_lines": [
            "朝霧の王国ルーメンでは、古い星の地図が失われてしまった。",
            "きみは見習い冒険者として、町の人と話しながら手がかりを探す。",
            "まずは町にいる全員と会話して、物語を動かそう。",
        ],
        "_ai_tags": {
            "language": "ja",
            "task": "chapter_title と intro_lines を作る",
            "constraints": [
                "intro_lines は 3〜5 行",
                "中高生向けに分かりやすい日本語",
                "暴力/差別/過激表現を避ける",
                "JSON以外を出力しない",
                "キーを削除しない",
            ],
        },
    }


def ensure_json_templates_exist():
    """JSONファイルが無ければ自動生成（既存ファイルは上書きしない）。"""
    role_by_id = {npc["id"]: npc["role"] for npc in BASE_NPCS}

    for npc_id, file_path in NPC_JSON_FILES.items():
        if file_path.exists():
            continue
        template = make_npc_template(npc_id, role_by_id.get(npc_id, "村人"))
        file_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")

    if not WATASHI_JSON_FILE.exists():
        WATASHI_JSON_FILE.write_text(
            json.dumps(make_watashi_template(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if not STORY_JSON_FILE.exists():
        STORY_JSON_FILE.write_text(
            json.dumps(make_story_template(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


# ============================================================
# JSON読み込み
# ============================================================
def load_json_file(path: Path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def clean_lines(lines_obj) -> list[str]:
    if not isinstance(lines_obj, list):
        return []
    lines = []
    for item in lines_obj:
        s = str(item).strip()
        if s:
            lines.append(s)
    return lines


def apply_npc_data_from_json(npc_data: dict, payload: dict):
    """NPC1人分のJSONデータをゲーム内データへ反映。"""
    if isinstance(payload.get("name"), str) and payload["name"].strip():
        npc_data["name"] = payload["name"].strip()

    if isinstance(payload.get("role"), str) and payload["role"].strip():
        npc_data["role"] = payload["role"].strip()

    if isinstance(payload.get("personality"), str):
        npc_data["personality"] = payload["personality"].strip()

    npc_data["lines"] = clean_lines(payload.get("lines", []))

    # 動きもJSONで調整可能
    move_speed = payload.get("move_speed")
    roam_radius = payload.get("roam_radius")

    if isinstance(move_speed, (int, float)):
        npc_data["move_speed"] = max(20.0, min(float(move_speed), 140.0))

    if isinstance(roam_radius, (int, float)):
        npc_data["roam_radius"] = max(20.0, min(float(roam_radius), 180.0))


def load_all_json(npc_states: list[dict], watashi: dict, story: dict) -> str:
    """
    10個のNPC JSON + watashi.json を読み込む。
    1つでも不正があればエラーメッセージを返す。
    """
    by_id = {item["data"]["id"]: item for item in npc_states}

    loaded_npcs = 0
    for npc_id, file_path in NPC_JSON_FILES.items():
        if not file_path.exists():
            return f"エラー: {file_path.name} が見つかりません"

        try:
            payload = load_json_file(file_path)
        except json.JSONDecodeError as e:
            return f"JSONエラー: {file_path.name} ({e})"
        except Exception as e:
            return f"読み込みエラー: {file_path.name} ({e})"

        if not isinstance(payload, dict):
            return f"形式エラー: {file_path.name} はオブジェクト形式にしてください"

        if payload.get("id") != npc_id:
            return f"IDエラー: {file_path.name} の id は '{npc_id}' にしてください"

        state = by_id[npc_id]
        apply_npc_data_from_json(state["data"], payload)
        loaded_npcs += 1

    # watashi.json
    if not WATASHI_JSON_FILE.exists():
        return "エラー: watashi.json が見つかりません"

    try:
        payload = load_json_file(WATASHI_JSON_FILE)
    except json.JSONDecodeError as e:
        return f"JSONエラー: {WATASHI_JSON_FILE.name} ({e})"
    except Exception as e:
        return f"読み込みエラー: {WATASHI_JSON_FILE.name} ({e})"

    if not isinstance(payload, dict):
        return "形式エラー: watashi.json はオブジェクト形式にしてください"

    if payload.get("id") != "watashi":
        return "IDエラー: watashi.json の id は 'watashi' にしてください"

    # ゲームで使う公開キーだけ反映（_ai_* は読み捨て）
    for key in ["name", "title", "personality", "origin", "goal"]:
        if isinstance(payload.get(key), str):
            watashi[key] = payload[key].strip() or watashi[key]

    # story.json
    if not STORY_JSON_FILE.exists():
        return "エラー: story.json が見つかりません"

    try:
        payload = load_json_file(STORY_JSON_FILE)
    except json.JSONDecodeError as e:
        return f"JSONエラー: {STORY_JSON_FILE.name} ({e})"
    except Exception as e:
        return f"読み込みエラー: {STORY_JSON_FILE.name} ({e})"

    if not isinstance(payload, dict):
        return "形式エラー: story.json はオブジェクト形式にしてください"

    if payload.get("id") != "story":
        return "IDエラー: story.json の id は 'story' にしてください"

    for key in ["world_name", "chapter_title"]:
        if isinstance(payload.get(key), str):
            story[key] = payload[key].strip() or story[key]

    intro_lines = clean_lines(payload.get("intro_lines", []))
    if intro_lines:
        story["intro_lines"] = intro_lines

    return f"インポート成功: NPC {loaded_npcs}/10 + watashi.json + story.json"


# ============================================================
# 移動と衝突
# ============================================================
def move_rect_with_collisions(
    rect: pygame.Rect,
    dx: float,
    dy: float,
    blocks: list[pygame.Rect],
    bounds: pygame.Rect,
):
    """プレイヤー向け: 軸ごとに移動して衝突を解決。"""
    # X軸
    rect.x += int(dx)
    if rect.left < bounds.left:
        rect.left = bounds.left
    if rect.right > bounds.right:
        rect.right = bounds.right

    for block in blocks:
        if rect.colliderect(block):
            if dx > 0:
                rect.right = block.left
            elif dx < 0:
                rect.left = block.right

    # Y軸
    rect.y += int(dy)
    if rect.top < bounds.top:
        rect.top = bounds.top
    if rect.bottom > bounds.bottom:
        rect.bottom = bounds.bottom

    for block in blocks:
        if rect.colliderect(block):
            if dy > 0:
                rect.bottom = block.top
            elif dy < 0:
                rect.top = block.bottom


def update_npc_movement(npc_states: list[dict], dt: float, freeze: bool):
    """NPCのランダム歩行（生きている感じを出す）。"""
    if freeze:
        return

    for npc_state in npc_states:
        data = npc_state["data"]
        rect = npc_state["rect"]

        npc_state["decision_timer"] -= dt

        if npc_state["decision_timer"] <= 0:
            # 一定周期で「止まる or 歩く」を再決定
            if random.random() < 0.28:
                npc_state["vx"] = 0.0
                npc_state["vy"] = 0.0
                npc_state["decision_timer"] = random.uniform(0.7, 1.8)
            else:
                angle = random.uniform(0.0, math.tau)
                speed = float(data.get("move_speed", 60.0))
                npc_state["vx"] = math.cos(angle) * speed
                npc_state["vy"] = math.sin(angle) * speed
                npc_state["decision_timer"] = random.uniform(0.9, 2.4)

        fx = npc_state["fx"] + npc_state["vx"] * dt
        fy = npc_state["fy"] + npc_state["vy"] * dt

        test_rect = pygame.Rect(int(fx), int(fy), rect.width, rect.height)

        # 徘徊半径を超えたらホームへ戻る方向に寄せる
        home_x = npc_state["home_x"]
        home_y = npc_state["home_y"]
        roam = float(data.get("roam_radius", 90.0))
        dist_home = math.hypot(test_rect.centerx - home_x, test_rect.centery - home_y)
        if dist_home > roam:
            vec_x = home_x - test_rect.centerx
            vec_y = home_y - test_rect.centery
            length = math.hypot(vec_x, vec_y) or 1.0
            pull = float(data.get("move_speed", 60.0))
            npc_state["vx"] = (vec_x / length) * pull
            npc_state["vy"] = (vec_y / length) * pull
            fx = npc_state["fx"] + npc_state["vx"] * dt
            fy = npc_state["fy"] + npc_state["vy"] * dt
            test_rect = pygame.Rect(int(fx), int(fy), rect.width, rect.height)

        # 壁/障害物に当たったら方向を変える
        hit = False
        if not MAP_RECT.contains(test_rect):
            hit = True
        else:
            for block in OBSTACLES:
                if test_rect.colliderect(block):
                    hit = True
                    break

        if hit:
            npc_state["vx"] *= -0.7
            npc_state["vy"] *= -0.7
            npc_state["decision_timer"] = random.uniform(0.2, 0.8)
        else:
            npc_state["fx"] = fx
            npc_state["fy"] = fy
            rect.x = int(npc_state["fx"])
            rect.y = int(npc_state["fy"])


def find_nearest_npc(player_rect: pygame.Rect, npc_states: list[dict]):
    nearest = None
    nearest_dist = 999999.0

    px, py = player_rect.center
    for i, npc_state in enumerate(npc_states):
        nx, ny = npc_state["rect"].center
        dist = math.hypot(px - nx, py - ny)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest = i

    return nearest, nearest_dist


# ============================================================
# ゲーム画面描画
# ============================================================
def draw_top_panel(
    screen: pygame.Surface,
    font_s: pygame.font.Font,
    font_m: pygame.font.Font,
    mission_text: str,
    status_text: str,
    nearest_text: str,
):
    panel = pygame.Rect(0, 0, SCREEN_WIDTH, TOP_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_TOP_PANEL, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.bottom - 1), (SCREEN_WIDTH, panel.bottom - 1), 2)

    title = "AI RPG テンプレート: 町の10人と会話しよう"
    title_img = font_m.render(title, True, COLOR_TEXT)
    screen.blit(title_img, (22, 14))

    draw_text_block(screen, mission_text, font_s, COLOR_TEXT, pygame.Rect(22, 60, SCREEN_WIDTH - 44, 26), line_spacing=2, max_lines=1)
    draw_text_block(screen, nearest_text, font_s, COLOR_TEXT, pygame.Rect(22, 92, SCREEN_WIDTH - 44, 26), line_spacing=2, max_lines=1)

    # ステータスは右上の独立ボックスにして重なりを防ぐ
    status_box = pygame.Rect(SCREEN_WIDTH - 430, 14, 410, 52)
    pygame.draw.rect(screen, (255, 255, 255), status_box)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, status_box, 1)
    draw_text_block(screen, status_text, font_s, COLOR_ACCENT, status_box.inflate(-12, -10), line_spacing=2, max_lines=2)


def draw_map_background(screen: pygame.Surface):
    # マップ地面
    pygame.draw.rect(screen, COLOR_MAP_GRASS, MAP_RECT)

    # 道
    for road in ROADS:
        pygame.draw.rect(screen, COLOR_MAP_ROAD, road)

    # 水辺
    water = pygame.Rect(MAP_RECT.x + 845, MAP_RECT.y + 325, 260, 140)
    pygame.draw.ellipse(screen, COLOR_MAP_WATER, water)

    # 障害物を建物/柵っぽく描画
    for i, block in enumerate(OBSTACLES):
        base = (160, 120, 88) if i % 2 == 0 else (142, 108, 80)
        pygame.draw.rect(screen, base, block)
        pygame.draw.rect(screen, COLOR_PANEL_BORDER, block, 2)

    # 枠線
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, MAP_RECT, 2)


def draw_npcs(screen: pygame.Surface, npc_states: list[dict], nearest_index: int | None):
    for i, npc_state in enumerate(npc_states):
        rect = npc_state["rect"]
        data = npc_state["data"]
        color = COLOR_NPC_TALKED if data.get("talked", False) else COLOR_NPC

        pygame.draw.rect(screen, color, rect, border_radius=6)
        pygame.draw.rect(screen, COLOR_PANEL_BORDER, rect, 2, border_radius=6)

        # 一番近いNPCだけ頭上に小さなガイドを出す（文字重なり防止）
        if nearest_index == i:
            bubble = pygame.Rect(rect.centerx - 20, rect.y - 24, 40, 18)
            pygame.draw.rect(screen, (255, 255, 255), bubble, border_radius=8)
            pygame.draw.rect(screen, COLOR_PANEL_BORDER, bubble, 1, border_radius=8)
            mark = "Talk" if not data.get("talked") else "Done"
            font = pygame.font.SysFont(None, 16)
            img = font.render(mark, True, COLOR_TEXT)
            screen.blit(img, (bubble.centerx - img.get_width() // 2, bubble.y + 2))


def draw_player(screen: pygame.Surface, player_rect: pygame.Rect):
    pygame.draw.rect(screen, COLOR_PLAYER, player_rect, border_radius=6)
    pygame.draw.rect(screen, COLOR_PLAYER_BORDER, player_rect, 2, border_radius=6)


def draw_dialog_panel(
    screen: pygame.Surface,
    font_s: pygame.font.Font,
    font_m: pygame.font.Font,
    npc_data: dict,
    line: str,
    line_index: int,
    total_lines: int,
):
    panel = pygame.Rect(0, SCREEN_HEIGHT - BOTTOM_PANEL_HEIGHT, SCREEN_WIDTH, BOTTOM_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_DIALOG_BG, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.y), (SCREEN_WIDTH, panel.y), 2)

    title = f"{npc_data['name']}  /  役割: {npc_data['role']}  /  性格: {npc_data.get('personality') or '未設定'}"
    draw_text_block(screen, title, font_m, COLOR_TEXT, pygame.Rect(22, panel.y + 16, SCREEN_WIDTH - 44, 30), line_spacing=2, max_lines=1)

    body_rect = pygame.Rect(22, panel.y + 58, SCREEN_WIDTH - 44, 120)
    draw_text_block(screen, line, font_m, COLOR_TEXT, body_rect, line_spacing=8, max_lines=4)

    page = f"{line_index + 1}/{max(total_lines, 1)}"
    hint = "SPACE: 次のセリフ"
    page_img = font_s.render(page, True, COLOR_TEXT)
    hint_img = font_s.render(hint, True, COLOR_TEXT)
    screen.blit(page_img, (22, panel.bottom - 34))
    screen.blit(hint_img, (SCREEN_WIDTH - hint_img.get_width() - 22, panel.bottom - 34))


def draw_bottom_hint(screen: pygame.Surface, font_s: pygame.font.Font, text: str):
    panel = pygame.Rect(0, SCREEN_HEIGHT - BOTTOM_PANEL_HEIGHT, SCREEN_WIDTH, BOTTOM_PANEL_HEIGHT)
    pygame.draw.rect(screen, COLOR_DIALOG_BG, panel)
    pygame.draw.line(screen, COLOR_PANEL_BORDER, (0, panel.y), (SCREEN_WIDTH, panel.y), 2)

    title = "メッセージ"
    t_img = pygame.font.SysFont(None, 34).render(title, True, COLOR_TEXT)
    screen.blit(t_img, (22, panel.y + 22))

    draw_text_block(
        screen,
        text,
        font_s,
        COLOR_TEXT,
        pygame.Rect(22, panel.y + 70, SCREEN_WIDTH - 44, 140),
        line_spacing=8,
        max_lines=5,
    )


def draw_title_screen(screen: pygame.Surface, font_l: pygame.font.Font, font_m: pygame.font.Font):
    screen.fill(COLOR_BG)

    box = pygame.Rect(120, 120, SCREEN_WIDTH - 240, SCREEN_HEIGHT - 240)
    pygame.draw.rect(screen, COLOR_TOP_PANEL, box, border_radius=16)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, box, 3, border_radius=16)

    t1 = "ルーメン王国の朝"
    t2 = "AIでキャラを作るRPG授業テンプレート"
    t3 = "はじまり"

    i1 = font_l.render(t1, True, COLOR_TEXT)
    i2 = font_m.render(t2, True, COLOR_TEXT)
    i3 = font_m.render(t3, True, COLOR_ACCENT)

    screen.blit(i1, (box.centerx - i1.get_width() // 2, box.y + 90))
    screen.blit(i2, (box.centerx - i2.get_width() // 2, box.y + 190))
    screen.blit(i3, (box.centerx - i3.get_width() // 2, box.y + 290))

def draw_intro_screen(
    screen: pygame.Surface,
    font_l: pygame.font.Font,
    font_m: pygame.font.Font,
    font_s: pygame.font.Font,
    page_text: str,
    page_index: int,
    page_total: int,
    watashi: dict,
    story: dict,
):
    screen.fill((20, 24, 30))

    box = pygame.Rect(90, 80, SCREEN_WIDTH - 180, SCREEN_HEIGHT - 160)
    pygame.draw.rect(screen, (244, 247, 252), box, border_radius=16)
    pygame.draw.rect(screen, COLOR_PANEL_BORDER, box, 3, border_radius=16)

    header = f"主人公: {watashi['name']} / {watashi['title']}"
    h_img = font_m.render(header, True, COLOR_TEXT)
    screen.blit(h_img, (box.x + 26, box.y + 24))

    sub = f"性格: {watashi['personality']}    出身: {watashi['origin']}    目的: {watashi['goal']}"
    draw_text_block(screen, sub, font_s, COLOR_TEXT, pygame.Rect(box.x + 26, box.y + 62, box.width - 52, 30), max_lines=1)

    draw_text_block(
        screen,
        page_text,
        font_l,
        COLOR_TEXT,
        pygame.Rect(box.x + 26, box.y + 120, box.width - 52, box.height - 220),
        line_spacing=12,
        max_lines=8,
    )

    world = f"世界: {story['world_name']} / 章: {story['chapter_title']}"
    draw_text_block(screen, world, font_s, COLOR_TEXT, pygame.Rect(box.x + 26, box.bottom - 86, box.width - 52, 28), max_lines=1)

    footer = f"{page_index + 1}/{page_total}"
    f_img = font_m.render(footer, True, COLOR_ACCENT)
    screen.blit(f_img, (box.right - f_img.get_width() - 26, box.bottom - 46))


# ============================================================
# メイン
# ============================================================
def main():
    pygame.init()
    pygame.display.set_caption("AI RPG Template")

    # Python 3.14 + 旧pygame環境向けガード
    if not pygame.font:
        print("エラー: pygame font モジュールが使えません。")
        print("対処: pip install pygame-ce")
        pygame.quit()
        sys.exit(1)

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    clock = pygame.time.Clock()

    font_s = get_font(23)
    font_m = get_font(31)
    font_l = get_font(44)

    # JSONテンプレートを準備
    ensure_json_templates_exist()

    # プレイヤー
    player_rect = pygame.Rect(MAP_RECT.x + 50, MAP_RECT.y + 60, PLAYER_SIZE, PLAYER_SIZE)

    # watashi（主人公）初期値
    watashi = {
        "name": "ワタシ",
        "title": "見習い冒険者",
        "personality": "まじめ",
        "origin": "港町ミナト",
        "goal": "星の地図の欠片を集める",
    }
    story = {
        "world_name": "ルーメン王国",
        "chapter_title": "朝霧のはじまり",
        "intro_lines": [
            "朝霧の王国ルーメンでは、古い星の地図が失われてしまった。",
            "きみは見習い冒険者として、町の人と話しながら手がかりを探す。",
            "まずは町にいる全員と会話して、物語を動かそう。",
        ],
    }

    # NPC状態を生成
    npc_states = []
    for base in BASE_NPCS:
        data = {
            "id": base["id"],
            "role": base["role"],
            "name": base["role"],
            "personality": "",
            "lines": [],
            "move_speed": 60.0,
            "roam_radius": 90.0,
            "talked": False,
        }

        rect = pygame.Rect(base["x"], base["y"], 34, 34)
        npc_states.append(
            {
                "data": data,
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

    # 起動時に一度JSONを読み込み
    status_message = load_all_json(npc_states, watashi, story)

    # 画面状態
    state = "title"  # title -> intro -> play -> clear

    intro_pages = list(story.get("intro_lines", []))
    intro_index = 0

    talking = False
    talking_npc_index = None
    talking_line_index = 0

    running = True
    while running:
        dt = clock.tick(FPS) / 1000.0

        nearest_index, nearest_dist = find_nearest_npc(player_rect, npc_states)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.KEYDOWN:
                # ----------------
                # タイトル
                # ----------------
                if state == "title":
                    if event.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                        # 最新JSONで主人公ストーリーを再生成してからイントロへ
                        status_message = load_all_json(npc_states, watashi, story)
                        intro_pages = list(story.get("intro_lines", []))
                        if not intro_pages:
                            intro_pages = ["物語はまだ書かれていない。watashi.json の intro_lines を編集しよう。"]
                        intro_index = 0
                        state = "intro"
                    continue

                # ----------------
                # イントロ
                # ----------------
                if state == "intro":
                    if event.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                        intro_index += 1
                        if intro_index >= len(intro_pages):
                            state = "play"
                    continue

                # ----------------
                # プレイ
                # ----------------
                if state in ("play", "clear"):
                    if event.key == pygame.K_i and not talking:
                        status_message = load_all_json(npc_states, watashi, story)

                    if event.key == pygame.K_SPACE:
                        if talking:
                            npc = npc_states[talking_npc_index]["data"]
                            lines = npc.get("lines", [])

                            if not lines:
                                talking = False
                                talking_npc_index = None
                                talking_line_index = 0
                            else:
                                talking_line_index += 1
                                if talking_line_index >= len(lines):
                                    npc["talked"] = True
                                    talking = False
                                    talking_npc_index = None
                                    talking_line_index = 0
                        else:
                            if nearest_index is not None and nearest_dist <= TALK_DISTANCE:
                                talking = True
                                talking_npc_index = nearest_index
                                talking_line_index = 0

        # ----------------
        # 更新
        # ----------------
        if state in ("play", "clear"):
            # 全員と話したらクリア状態へ
            all_talked = all(item["data"].get("talked", False) for item in npc_states)
            if all_talked:
                state = "clear"

            # 移動（会話中は停止）
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

                move_rect_with_collisions(player_rect, dx, dy, OBSTACLES, MAP_RECT)

            update_npc_movement(npc_states, dt, freeze=talking)

        # ----------------
        # 描画
        # ----------------
        if state == "title":
            draw_title_screen(screen, font_l, font_m)
            pygame.display.flip()
            continue

        if state == "intro":
            draw_intro_screen(
                screen,
                font_l,
                font_m,
                font_s,
                intro_pages[intro_index],
                intro_index,
                len(intro_pages),
                watashi,
                story,
            )
            pygame.display.flip()
            continue

        screen.fill(COLOR_BG)
        draw_map_background(screen)

        # 上部UI
        talked_count = sum(1 for item in npc_states if item["data"].get("talked"))
        mission_text = f"ミッション: 町の10人と会話する ({talked_count}/10)"

        if nearest_index is not None:
            n = npc_states[nearest_index]["data"]
            near_msg = f"最寄りNPC: {n['name']}（{n['role']}） / 距離: {int(nearest_dist)}"
            if nearest_dist <= TALK_DISTANCE:
                near_msg += "  -> SPACEで会話"
        else:
            near_msg = "最寄りNPC: なし"

        draw_top_panel(screen, font_s, font_m, mission_text, status_message, near_msg)

        # キャラ描画
        draw_npcs(screen, npc_states, nearest_index)
        draw_player(screen, player_rect)

        # 下部UI
        if talking and talking_npc_index is not None:
            npc = npc_states[talking_npc_index]["data"]
            lines = npc.get("lines", [])
            if lines:
                line = lines[talking_line_index]
            else:
                line = "……（まだセリフがありません）\nJSONをChatGPTで更新して I キーで再読み込みしてください。"

            draw_dialog_panel(
                screen,
                font_s,
                font_m,
                npc,
                line,
                talking_line_index,
                len(lines),
            )
        else:
            hint = ""
            if state == "clear":
                hint = "クリア！"
            draw_bottom_hint(screen, font_s, hint)

        pygame.display.flip()

    pygame.quit()
    sys.exit()


if __name__ == "__main__":
    main()


# ============================================================
# 実行方法
# ============================================================
# 1) インストール（Python 3.14 では pygame-ce 推奨）
#    pip install pygame-ce
#
# 2) 実行
#    python simple_rpg_template.py
#
# 3) 操作方法は README.md を参照
# ============================================================
