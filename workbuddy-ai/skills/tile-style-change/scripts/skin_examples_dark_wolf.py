"""
程序化绘制 32×32 像素风「暗黑疾风狼」精灵（v3 —— 对齐原版半兽人的比例）。

对齐要点（照抄原版 5292-5307 的构图规律）：
  - 大头：约占 12/32 高（原版绿皮脑袋就占了近 1/3）
  - 宽厚躯干：肩宽 ≈ 14px，肩线比腰宽 4-5px
  - 短粗四肢：臂/腿各 5-7px，末端有爪
  - 装备占位大：剑/盾/杖直接压在身体两侧，占 2/3 高
  - 描边：几乎每格都有 1px 暗色描边（像素风的灵魂）
"""
from PIL import Image

P = {
    "dk":     (14, 15, 21, 255),
    "furD":   (42, 47, 60, 255),
    "furM":   (78, 88, 106, 255),
    "furL":   (120, 134, 156, 255),
    "furH":   (158, 172, 192, 255),
    "eye":    (135, 228, 255, 255),
    "maw":    (64, 13, 19, 255),
    "fang":   (240, 238, 228, 255),
    "claw":   (158, 42, 40, 255),
    "armorD": (48, 46, 60, 255),
    "armorM": (92, 90, 110, 255),
    "armorL": (132, 130, 154, 255),
    "clothD": (70, 26, 34, 255),
    "clothM": (118, 48, 56, 255),
    "steelD": (98, 108, 126, 255),
    "steelM": (156, 166, 184, 255),
    "steelL": (212, 220, 232, 255),
    "glow":   (160, 230, 255, 255),
    "blood":  (190, 42, 42, 255),
    "gold":   (196, 156, 62, 255),
}

T = 32


def _g():
    return [[None] * T for _ in range(T)]


def _px(g, x, y, c):
    if 0 <= x < T and 0 <= y < T and c is not None:
        g[y][x] = c


def _h(g, x0, x1, y, c):
    for x in range(int(x0), int(x1) + 1):
        _px(g, x, y, c)


def _v(g, x, y0, y1, c):
    for y in range(int(y0), int(y1) + 1):
        _px(g, x, y, c)


def _box(g, x0, y0, x1, y1, c):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            _px(g, x, y, c)


def _ellipse(g, cx, cy, rx, ry, c):
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            dx = (x - cx) / max(rx, 0.5)
            dy = (y - cy) / max(ry, 0.5)
            if dx * dx + dy * dy <= 1.05:
                _px(g, x, y, c)


def _outline(g):
    src = [row[:] for row in g]
    for y in range(T):
        for x in range(T):
            if src[y][x] is not None:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < T and 0 <= ny < T and src[ny][nx] is not None:
                    g[y][x] = P["dk"]
                    break


def _to_img(g):
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    px = im.load()
    for y in range(T):
        for x in range(T):
            if g[y][x] is not None:
                px[x, y] = g[y][x]
    return im


# ── 狼头（占 13×13，大头比例）──────────────────────────────
def _head(g, cx, top, maw=False):
    """cx 中心，top 顶行；整体约 13 行高、13 宽"""
    # 尖耳
    for i in range(4):
        _px(g, cx - 6 + i, top + 3 - i, P["furM"])
        _px(g, cx - 5 + i, top + 3 - i, P["furD"])
        _px(g, cx + 6 - i, top + 3 - i, P["furM"])
        _px(g, cx + 5 - i, top + 3 - i, P["furD"])
    # 头颅（宽椭圆）
    _ellipse(g, cx, top + 7, 6, 5, P["furM"])
    # 额头亮部
    _ellipse(g, cx, top + 5, 5, 3, P["furL"])
    # 颊毛（两侧外扩，狼相）
    _px(g, cx - 7, top + 8, P["furM"]); _px(g, cx + 7, top + 8, P["furM"])
    _px(g, cx - 6, top + 9, P["furD"]); _px(g, cx + 6, top + 9, P["furD"])
    # 长吻（向下收窄）
    _h(g, cx - 4, cx + 4, top + 10, P["furM"])
    _h(g, cx - 3, cx + 3, top + 11, P["furM"])
    _h(g, cx - 3, cx + 3, top + 12, P["furM"])
    _h(g, cx - 2, cx + 2, top + 13, P["furM"])
    _px(g, cx, top + 13, P["dk"])                     # 鼻
    _px(g, cx - 1, top + 13, P["furD"])
    _px(g, cx + 1, top + 13, P["furD"])
    # 眼
    _px(g, cx - 4, top + 7, P["eye"]); _px(g, cx + 4, top + 7, P["eye"])
    _px(g, cx - 5, top + 7, P["dk"]); _px(g, cx + 5, top + 7, P["dk"])
    _px(g, cx - 4, top + 6, P["furH"]); _px(g, cx + 4, top + 6, P["furH"])
    # 獠牙 / 张口
    if maw:
        _h(g, cx - 2, cx + 2, top + 12, P["maw"])
        _px(g, cx - 1, top + 11, P["fang"]); _px(g, cx + 1, top + 11, P["fang"])
        _px(g, cx - 1, top + 13, P["fang"]); _px(g, cx + 1, top + 13, P["fang"])
    else:
        _px(g, cx - 2, top + 12, P["fang"]); _px(g, cx + 2, top + 12, P["fang"])
        _px(g, cx - 1, top + 13, P["fang"]); _px(g, cx + 1, top + 13, P["fang"])


# ── 躯干（宽肩厚身）─────────────────────────────────────────
def _torso(g, cx, y0, armor=True, robe=False):
    """y0 = 颈根行"""
    # 肩：宽
    _h(g, cx - 8, cx + 8, y0, P["furM"])
    _h(g, cx - 8, cx + 8, y0 + 1, P["furM"])
    _h(g, cx - 7, cx + 7, y0 + 2, P["furM"])
    # 胸：宽而厚
    _h(g, cx - 7, cx + 7, y0 + 3, P["furL"])
    _h(g, cx - 6, cx + 6, y0 + 4, P["furL"])
    _h(g, cx - 6, cx + 6, y0 + 5, P["furM"])
    _h(g, cx - 5, cx + 5, y0 + 6, P["furM"])
    # 腰：收
    _h(g, cx - 5, cx + 5, y0 + 7, P["furM"])
    _h(g, cx - 4, cx + 4, y0 + 8, P["furD"])

    if armor:
        _box(g, cx - 6, y0 + 2, cx + 6, y0 + 6, P["armorM"])
        _h(g, cx - 6, cx + 6, y0 + 2, P["armorL"])
        # 肩甲金边（破除单调）
        _px(g, cx - 6, y0 + 2, P["gold"]); _px(g, cx + 6, y0 + 2, P["gold"])
        _px(g, cx - 5, y0 + 3, P["gold"]); _px(g, cx + 5, y0 + 3, P["gold"])
        _px(g, cx - 3, y0 + 3, P["steelL"]); _px(g, cx + 3, y0 + 3, P["steelL"])
        _px(g, cx - 3, y0 + 4, P["steelD"]); _px(g, cx + 3, y0 + 4, P["steelD"])
        # 胸口红色徽记（暗黑风的血红点缀）
        _px(g, cx, y0 + 4, P["blood"]); _px(g, cx - 1, y0 + 4, P["blood"])
        _h(g, cx - 4, cx + 4, y0 + 6, P["armorD"])
        # 腰甲 + 红绳腰带
        _h(g, cx - 5, cx + 5, y0 + 7, P["armorD"])
        _h(g, cx - 4, cx + 4, y0 + 7, P["blood"])
        _px(g, cx, y0 + 7, P["gold"])
    if robe:
        for y in range(y0, y0 + 14):
            half = 6 if y < y0 + 5 else 8
            _h(g, cx - half, cx + half, y, P["clothD"])
        _h(g, cx - 4, cx + 4, y0 + 4, P["clothM"])
        _h(g, cx - 3, cx + 3, y0 + 5, P["clothM"])


def _legs(g, cx, y0):
    """短粗狼腿 + 爪"""
    _box(g, cx - 5, y0, cx - 2, y0 + 3, P["furD"])
    _box(g, cx + 2, y0, cx + 5, y0 + 3, P["furD"])
    _h(g, cx - 6, cx - 2, y0 + 4, P["furD"])
    _h(g, cx + 2, cx + 6, y0 + 4, P["furD"])
    _px(g, cx - 5, y0 + 4, P["claw"]); _px(g, cx + 5, y0 + 4, P["claw"])


def _arm(g, x, y0, y1, dx=0):
    for i, y in enumerate(range(y0, y1)):
        _px(g, x + (dx if i > 0 else 0), y, P["furM"])
    _px(g, x + dx, y1, P["claw"])


# ── 装备 ────────────────────────────────────────────────────
def _shield(g, sx, y0, h=10, glow=False):
    for y in range(y0, y0 + h):
        r = 4 if 1 < y - y0 < h - 2 else (3 if y - y0 in (0, h - 1) else 2)
        _h(g, sx - r, sx + r, y, P["steelD"])
    _px(g, sx, y0 + h // 2, P["steelM"])
    _px(g, sx - 1, y0 + h // 2 - 1, P["steelM"])
    if glow:
        _px(g, sx, y0 + 2, P["glow"]); _px(g, sx - 1, y0 + h // 2, P["glow"])
        _px(g, sx + 1, y0 + h // 2, P["glow"]); _px(g, sx, y0 + h - 3, P["glow"])


def _sword(g, bx, y0, y1, glow=False):
    _v(g, bx, y0, y1, P["steelD"])
    _px(g, bx, y0, P["steelM"])
    _px(g, bx - 1, y1 - 1, P["steelM"])
    if glow:
        _px(g, bx, y0 + 1, P["glow"]); _px(g, bx, y1, P["glow"])


def _hammer(g, hx, y0, y1):
    _v(g, hx, y0, y1, P["steelD"])
    _box(g, hx - 3, y0 - 2, hx + 2, y0 + 2, P["steelM"])
    _px(g, hx - 2, y0 - 1, P["steelL"]); _px(g, hx + 1, y0 - 1, P["steelL"])


def _staff(g, sx, y0, y1):
    _v(g, sx, y0, y1, P["steelD"])
    _px(g, sx, y0, P["glow"])
    _px(g, sx - 1, y0 + 1, P["glow"]); _px(g, sx + 1, y0 + 1, P["glow"])


def _dagger(g, bx, y0, y1):
    _v(g, bx, y0, y1, P["steelD"])
    _px(g, bx, y0, P["steelM"])


def _cloak(g, cx, y0, h=13):
    for y in range(y0, y0 + h):
        _px(g, cx - 9, y, P["clothD"]); _px(g, cx + 9, y, P["clothD"])
    _px(g, cx - 9, y0 + 5, P["clothM"]); _px(g, cx + 9, y0 + 5, P["clothM"])
    _px(g, cx - 9, y0 + 9, P["clothM"]); _px(g, cx + 9, y0 + 9, P["clothM"])


def _tail(g, cx, y):
    """尾巴（尖端带暗红）"""
    for i in range(4):
        _px(g, cx + 7 + i, y - (i // 2), P["furD"])
    _px(g, cx + 10, y - 2, P["furM"])
    _px(g, cx + 11, y - 2, P["clothD"])


# ── 8 组姿势 ────────────────────────────────────────────────
def draw_orc(tile_id):
    g = _g()
    cx = 16
    b = (tile_id - 5292) % 8 == 1
    dy = 1 if b else 0        # 第二帧整体下移 1px（呼吸）
    head_top = 2 + dy
    body_y = 16 + dy

    if tile_id in (5292, 5300):                    # ① 站立
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx - 8, body_y + 1, body_y + 6)
        _arm(g, cx + 8, body_y + 1, body_y + 6)
        _legs(g, cx, body_y + 9)
        _tail(g, cx, body_y + 10)

    elif tile_id in (5293, 5301):                  # ② 圆盾 + 战锤
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx + 8, body_y + 1, body_y + 5, 1)
        _hammer(g, cx + 10, body_y - 8, body_y + 2)
        _arm(g, cx - 8, body_y + 1, body_y + 6)
        _shield(g, cx - 10, body_y + 1)
        _legs(g, cx, body_y + 9)

    elif tile_id in (5294, 5302):                  # ③ 双剑（举高）
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx - 8, body_y + 1, body_y + 4, -1)
        _sword(g, cx - 11, body_y - 12, body_y - 2, glow=True)
        _arm(g, cx + 8, body_y + 1, body_y + 4, 1)
        _sword(g, cx + 11, body_y - 12, body_y - 2, glow=True)
        _legs(g, cx, body_y + 9)

    elif tile_id in (5295, 5303):                  # ④ 双匕首
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx - 8, body_y + 1, body_y + 4, -1)
        _dagger(g, cx - 11, body_y - 3, body_y + 3)
        _arm(g, cx + 8, body_y + 1, body_y + 4, 1)
        _dagger(g, cx + 11, body_y - 3, body_y + 3)
        _legs(g, cx, body_y + 9)

    elif tile_id in (5296, 5304):                  # ⑤ 法杖 + 书
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx + 8, body_y + 1, body_y + 5, 1)
        _staff(g, cx + 11, body_y - 13, body_y + 9)
        _arm(g, cx - 8, body_y + 1, body_y + 5)
        _box(g, cx - 12, body_y + 2, cx - 9, body_y + 7, P["clothD"])
        _px(g, cx - 10, body_y + 4, P["clothM"])
        _legs(g, cx, body_y + 9)

    elif tile_id in (5297, 5305):                  # ⑥ 黄袍法师
        _head(g, cx, head_top, maw=b)
        # 长袍（从肩以下，颈部留出，头不埋进去）
        for y in range(body_y, body_y + 13):
            half = 7 if y < body_y + 5 else 8
            _h(g, cx - half, cx + half, y, P["clothD"])
        # 袍身配色分层：暗红 → 亮红 → 金边
        _h(g, cx - 6, cx + 6, body_y + 2, P["clothM"])
        _h(g, cx - 4, cx + 4, body_y + 4, P["clothM"])
        _h(g, cx - 3, cx + 3, body_y + 6, P["gold"])
        _px(g, cx - 5, body_y + 1, P["gold"]); _px(g, cx + 5, body_y + 1, P["gold"])
        # 胸前的魔法纹章
        _px(g, cx, body_y + 3, P["glow"]); _px(g, cx - 1, body_y + 4, P["glow"])
        _px(g, cx + 1, body_y + 4, P["glow"]); _px(g, cx, body_y + 5, P["glow"])
        # 举起的双手（施法）
        _arm(g, cx - 8, body_y, body_y + 3, -1)
        _arm(g, cx + 8, body_y, body_y + 3, 1)
        _px(g, cx - 9, body_y - 1, P["glow"]); _px(g, cx + 9, body_y - 1, P["glow"])
        # 法杖
        _staff(g, cx + 12, body_y - 12, body_y + 10)
        # 兜帽尖顶（法师特征）
        _px(g, cx, head_top - 1, P["clothD"])
        _px(g, cx - 1, head_top - 1, P["clothD"])
        _px(g, cx + 1, head_top - 1, P["clothD"])

    elif tile_id in (5298, 5306):                  # ⑦ 骑士 + 红斗篷 + 爆发
        _head(g, cx, head_top, maw=b)
        _cloak(g, cx, body_y - 1)
        _torso(g, cx, body_y)
        _arm(g, cx - 8, body_y + 1, body_y + 6)
        _arm(g, cx + 8, body_y + 1, body_y + 6)
        _legs(g, cx, body_y + 9)
        for (bx, by) in ((3, 6), (28, 7), (5, 28), (26, 27), (1, 17), (30, 18),
                         (8, 11), (23, 12), (6, 22), (25, 21)):
            _px(g, bx, by, P["blood"])
        _px(g, cx, body_y - 2, P["blood"])

    else:                                          # ⑧ 5299 / 5307 发光盾
        _head(g, cx, head_top, maw=b)
        _torso(g, cx, body_y)
        _arm(g, cx + 8, body_y + 1, body_y + 5, 1)
        _shield(g, cx + 10, body_y + 1, glow=True)
        _arm(g, cx - 8, body_y + 1, body_y + 6)
        _legs(g, cx, body_y + 9)

    _outline(g)
    return _to_img(g)


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orc_gen")
    os.makedirs(out, exist_ok=True)
    ids = list(range(5292, 5308))
    base = r"workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季"
    orig = Image.open(os.path.join(base, "images", "compiled_tileset_32x32.original.png")).convert("RGBA")
    t, cols = 32, 120
    S = 5; PAD = 24; W = 8
    sheet = Image.new("RGBA", (W * (t * S + 8) + 8, 2 * (t * S + PAD + 8) + 8), (26, 26, 30, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, tid in enumerate(ids):
        im = draw_orc(tid)
        im.save(os.path.join(out, f"px_{tid}.png"))
        c, r = tid % cols, tid // cols
        oc = orig.crop((c * t, r * t, (c + 1) * t, (r + 1) * t)).resize((t * S, t * S), Image.NEAREST)
        x = 8 + (i % W) * (t * S + 8); y = 8 + (i // W) * (t * S + PAD + 8)
        sheet.paste(oc, (x, y), oc)
        d.text((x + 2, y + t * S + 2), f"原{tid}", fill=(200, 200, 120))
        new = im.resize((t * S, t * S), Image.NEAREST)
        sheet.paste(new, (x, y), new)
        d.text((x + 2, y + t * S + 14), f"新{tid}", fill=(130, 230, 160))
    sheet.save(os.path.join(out, "px_cmp.png"))
    print("OK", sheet.size)