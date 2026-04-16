"""
超シンプルRPGテンプレート（授業用）

目的:
- AIで作ったNPC設定（名前・性格・セリフ）を入れて遊ぶ
- Python初心者でも、どこを編集すればよいか分かる
- 1ファイルで完結
"""

import math
import sys
import pygame


# ============================================================
# 【ここを編集】NPCデータ（授業では主にここを書き換える）
# ============================================================
# name: NPCの名前
# personality: 性格（今は表示のみ。将来の拡張にも使える）
# lines: 会話のセリフ（順番に表示）
# x, y: NPCの初期位置
npcs = [
    {
        "name": "村人A",
        "personality": "やさしい",
        "lines": [
            "こんにちは！",
            "今日はいい天気ですね。",
            "気をつけてね！",
        ],
        "x": 220,
        "y": 170,
    },
    {
        "name": "村人B",
        "personality": "げんき",
        "lines": [
            "ぼくは走るのが好きなんだ！",
            "きみも一緒に走ろうよ！",
        ],
        "x": 420,
        "y": 260,
    },
    {
        "name": "村人C",
        "personality": "しんちょう",
        "lines": [
            "道を歩くときは周りをよく見るんだ。",
            "あわてず、ゆっくりいこう。",
        ],
        "x": 640,
        "y": 160,
    },
]


# ============================================================
# 【ここを編集】ゲーム全体の基本設定
# ============================================================
SCREEN_WIDTH = 960
SCREEN_HEIGHT = 640
FPS = 60
PLAYER_SPEED = 4
TALK_DISTANCE = 70  # この距離以内でスペースキーを押すと会話開始

# 色（R, G, B）
BG_COLOR = (120, 185, 120)
GRID_COLOR = (100, 160, 100)
PLAYER_COLOR = (70, 130, 255)
NPC_COLOR = (255, 170, 70)
TEXT_COLOR = (20, 20, 20)
WINDOW_COLOR = (250, 250, 250)
WINDOW_BORDER_COLOR = (30, 30, 30)


# ============================================================
# 文字表示用の関数
# ============================================================
def get_font(size: int) -> pygame.font.Font:
    """日本語表示しやすいフォントを優先して取得する。"""
    candidate_fonts = ["msgothic", "yugothic", "meiryo", "hiraginosans", "arialunicode"]
    available = {name.lower() for name in pygame.font.get_fonts()}

    for name in candidate_fonts:
        if name.lower() in available:
            return pygame.font.SysFont(name, size)

    # 見つからない場合はデフォルト
    return pygame.font.SysFont(None, size)


def draw_text_wrapped(surface, text, font, color, rect, line_spacing=4):
    """長い文章を矩形内で自動改行して描画する。"""
    x, y, w, h = rect
    current_line = ""
    lines = []

    # 1文字ずつ追加して幅を超えたら改行（シンプル実装）
    for ch in text:
        test_line = current_line + ch
        if font.size(test_line)[0] <= w:
            current_line = test_line
        else:
            lines.append(current_line)
            current_line = ch
    if current_line:
        lines.append(current_line)

    line_height = font.get_height() + line_spacing
    max_lines = h // line_height

    for i, line in enumerate(lines[:max_lines]):
        img = font.render(line, True, color)
        surface.blit(img, (x, y + i * line_height))


def main():
    pygame.init()
    pygame.display.set_caption("超シンプルRPGテンプレート")

    # Python 3.14 + 旧pygame では font モジュールが使えない場合がある。
    # そのときは pygame-ce を案内して、授業中に原因不明で止まらないようにする。
    if not pygame.font:
        print("エラー: pygame の font モジュールが使えません。")
        print("Python 3.14 では 'pip install pygame-ce' を試してください。")
        pygame.quit()
        sys.exit(1)

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    clock = pygame.time.Clock()

    # フォント
    font_small = get_font(20)
    font_main = get_font(26)

    # プレイヤー（青い四角）
    player_size = 36
    player_rect = pygame.Rect(100, 100, player_size, player_size)

    # NPC（オレンジの四角）を内部用データに変換
    # 元データは「npcs」そのまま使うので、生徒が編集しやすい
    npc_size = 36
    npc_states = []
    for npc in npcs:
        npc_states.append(
            {
                "data": npc,
                "rect": pygame.Rect(npc["x"], npc["y"], npc_size, npc_size),
            }
        )

    # 会話状態
    talking = False
    talking_npc_index = None
    talking_line_index = 0

    # メインループ
    running = True
    while running:
        clock.tick(FPS)

        # -------------------------
        # 入力処理（キー・終了）
        # -------------------------
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            # スペースキーを押した瞬間の処理
            if event.type == pygame.KEYDOWN and event.key == pygame.K_SPACE:
                if talking:
                    # 会話中なら次のセリフへ
                    talking_line_index += 1
                    lines = npcs[talking_npc_index]["lines"]
                    if talking_line_index >= len(lines):
                        # セリフが終わったら会話終了
                        talking = False
                        talking_npc_index = None
                        talking_line_index = 0
                else:
                    # 会話中でなければ、近くのNPCを探して会話開始
                    nearest_index = None
                    nearest_distance = 99999

                    px, py = player_rect.center
                    for i, npc_state in enumerate(npc_states):
                        nx, ny = npc_state["rect"].center
                        dist = math.hypot(px - nx, py - ny)
                        if dist < nearest_distance:
                            nearest_distance = dist
                            nearest_index = i

                    if nearest_index is not None and nearest_distance <= TALK_DISTANCE:
                        talking = True
                        talking_npc_index = nearest_index
                        talking_line_index = 0

        # -------------------------
        # プレイヤー移動（会話中は移動しない）
        # -------------------------
        if not talking:
            keys = pygame.key.get_pressed()
            dx = 0
            dy = 0

            # 矢印キーでもWASDでも移動できる
            if keys[pygame.K_UP] or keys[pygame.K_w]:
                dy -= PLAYER_SPEED
            if keys[pygame.K_DOWN] or keys[pygame.K_s]:
                dy += PLAYER_SPEED
            if keys[pygame.K_LEFT] or keys[pygame.K_a]:
                dx -= PLAYER_SPEED
            if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
                dx += PLAYER_SPEED

            player_rect.x += dx
            player_rect.y += dy

            # 画面外に出ないように制限
            player_rect.x = max(0, min(player_rect.x, SCREEN_WIDTH - player_rect.width))
            player_rect.y = max(0, min(player_rect.y, SCREEN_HEIGHT - player_rect.height))

        # -------------------------
        # 描画処理
        # -------------------------
        screen.fill(BG_COLOR)

        # 背景グリッド（マップっぽく見せるため）
        grid = 40
        for x in range(0, SCREEN_WIDTH, grid):
            pygame.draw.line(screen, GRID_COLOR, (x, 0), (x, SCREEN_HEIGHT), 1)
        for y in range(0, SCREEN_HEIGHT, grid):
            pygame.draw.line(screen, GRID_COLOR, (0, y), (SCREEN_WIDTH, y), 1)

        # NPC描画
        for npc_state in npc_states:
            npc_rect = npc_state["rect"]
            npc_data = npc_state["data"]

            pygame.draw.rect(screen, NPC_COLOR, npc_rect)
            pygame.draw.rect(screen, WINDOW_BORDER_COLOR, npc_rect, 2)

            # NPC名を頭の上に表示
            name_img = font_small.render(npc_data["name"], True, TEXT_COLOR)
            name_x = npc_rect.centerx - name_img.get_width() // 2
            name_y = npc_rect.y - 24
            screen.blit(name_img, (name_x, name_y))

        # プレイヤー描画
        pygame.draw.rect(screen, PLAYER_COLOR, player_rect)
        pygame.draw.rect(screen, WINDOW_BORDER_COLOR, player_rect, 2)

        # 案内テキスト
        if not talking:
            guide = "矢印/WASDで移動  近くでSPACE: 会話"
            guide_img = font_small.render(guide, True, TEXT_COLOR)
            screen.blit(guide_img, (12, 10))

        # 会話ウィンドウ描画
        if talking and talking_npc_index is not None:
            npc = npcs[talking_npc_index]
            line = npc["lines"][talking_line_index]

            # 画面下に会話枠
            window_height = 170
            window_rect = pygame.Rect(
                20,
                SCREEN_HEIGHT - window_height - 20,
                SCREEN_WIDTH - 40,
                window_height,
            )
            pygame.draw.rect(screen, WINDOW_COLOR, window_rect)
            pygame.draw.rect(screen, WINDOW_BORDER_COLOR, window_rect, 3)

            # 名前・性格（重要要件）
            title_text = f"{npc['name']}（性格: {npc['personality']}）"
            title_img = font_main.render(title_text, True, TEXT_COLOR)
            screen.blit(title_img, (window_rect.x + 14, window_rect.y + 12))

            # セリフ（改行対応）
            draw_text_wrapped(
                screen,
                line,
                font_main,
                TEXT_COLOR,
                (
                    window_rect.x + 14,
                    window_rect.y + 52,
                    window_rect.width - 28,
                    window_rect.height - 74,
                ),
                line_spacing=6,
            )

            hint_img = font_small.render("SPACE: 次へ", True, TEXT_COLOR)
            hint_x = window_rect.right - hint_img.get_width() - 14
            hint_y = window_rect.bottom - hint_img.get_height() - 10
            screen.blit(hint_img, (hint_x, hint_y))

        pygame.display.flip()

    pygame.quit()
    sys.exit()


if __name__ == "__main__":
    main()


# ============================================================
# 実行方法（授業用メモ）
# ============================================================
# 1) まだならインストール:
#    Python 3.14 の場合（推奨）:
#    pip install pygame-ce
#
#    Python 3.13 以下で通常版を使う場合:
#    pip install pygame
#
# 2) 実行:
#    python simple_rpg_template.py
#
# 3) 最初に編集する場所:
#    このファイル上部の「【ここを編集】NPCデータ（授業では主にここを書き換える）」
# ============================================================
