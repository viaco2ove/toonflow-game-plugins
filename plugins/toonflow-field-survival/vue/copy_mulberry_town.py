#!/usr/bin/env python3
"""完整复刻 Rotten-Soup 的 mulberryTown.json → overworld.json 的城镇部分
   - 43×56 米 mulberry 内部（地表 + 房屋 + 农田 + 木桩）
   - 加一圈紧密相连的绿树围墙（边界 y=±28.5, x=±21.5，每 1 米一棵，留 4 个 4m 出口）
   - 城外保留少量树
"""
import json

# tile id → (kind, variant)
TILE_TO_DEC = {
    7355: ("tree", 0),       # 绿树
    7359: ("tree", 1),       # 枯树
    1722: ("bush", 0),       # 灌木
    1724: ("mushroom", 0),   # 蘑菇
    1482: ("flower", 0),     # 花
    9298: ("fence", 0),      # 木桩（mulberry 的装饰柱，不是围墙）
    8297: ("fence", 1),      # 横梁
}
HOUSE_TILES = {9184, 9185, 9186, 9304, 9305, 9306, 9310, 9425, 9424, 9426,
               7885, 7886, 9311, 9312, 9313, 9434, 9435, 9314, 9315}
FARM_TILES = {7766, 7767, 8005, 7745}

def main():
    src = json.load(open('D:/Users/viaco/PycharmProjects/Rotten-Soup/public/maps/mulberryTown.json', encoding='utf-8'))
    W, H = src['width'], src['height']  # 43, 56
    layers = src['layers']
    tile_layers = [l for l in layers if l.get('type') == 'tilelayer']
    print(f'found {len(tile_layers)} tile layers ({W}x{H})')

    base = json.load(open('public/maps/overworld.json', encoding='utf-8'))
    decorations = []
    dec_id = 0

    # ===== 1) 复刻 mulberry 全部非 0 tile =====
    for li, layer in enumerate(tile_layers):
        for i, tid in enumerate(layer['data']):
            if tid == 0: continue
            z = i // W
            x = i % W
            wx = x - W / 2.0 + 0.5   # 世界 x 中心 0
            wy = z - H / 2.0 + 0.5   # 世界 y 中心 0

            if tid in TILE_TO_DEC:
                kind, variant = TILE_TO_DEC[tid]
            elif tid in FARM_TILES:
                kind, variant = 'farm', 0
            elif tid in HOUSE_TILES:
                kind, variant = 'building', li
            else:
                kind, variant = 'ground', 0

            decorations.append({
                'id': f'r_{dec_id:05d}',
                'kind': kind,
                'x': round(wx, 2),
                'y': round(wy, 2),
                'variant': variant,
                'tileId': tid,
                'layer': li,
            })
            dec_id += 1

    print(f'extracted {dec_id} decorations from mulberryTown')

    # ===== 2) 加一圈紧密相连的绿树围墙 =====
    # 边界 y=±28, x=±21.5，每 1 米一棵（间隔 1m，碰撞半径 0.9m → 不可穿越）
    # 出口：北中、南中、东中、西中各 4 米宽
    TOWN_HALF_X = 21.5
    TOWN_HALF_Y = 28.0
    EXIT_HALF = 2.0  # 出口半宽 2m（4m 总宽）

    def is_exit_x(x):
        return -EXIT_HALF <= x <= EXIT_HALF

    def is_exit_y(y):
        return -EXIT_HALF <= y <= EXIT_HALF

    # 北边：y = -TOWN_HALF_Y，沿 x 从 -21..21 每 1m
    # 用 .5 偏移紧贴边界（mulberry 的 fence 在 0.5 偏移）
    boundary_id = 100000

    # 北
    for x10 in range(-215, 216, 10):  # -21.5 .. 21.5 步长 1m
        x = x10 / 10.0
        if is_exit_x(x): continue
        decorations.append({
            'id': f'b_{boundary_id:05d}',
            'kind': 'tree', 'x': round(x, 1), 'y': -TOWN_HALF_Y,
            'variant': 0,
        })
        boundary_id += 1
    # 南
    for x10 in range(-215, 216, 10):
        x = x10 / 10.0
        if is_exit_x(x): continue
        decorations.append({
            'id': f'b_{boundary_id:05d}',
            'kind': 'tree', 'x': round(x, 1), 'y': TOWN_HALF_Y,
            'variant': 1,
        })
        boundary_id += 1
    # 东
    for y10 in range(-280, 281, 10):
        y = y10 / 10.0
        if is_exit_y(y): continue
        decorations.append({
            'id': f'b_{boundary_id:05d}',
            'kind': 'tree', 'x': TOWN_HALF_X, 'y': round(y, 1),
            'variant': 0,
        })
        boundary_id += 1
    # 西
    for y10 in range(-280, 281, 10):
        y = y10 / 10.0
        if is_exit_y(y): continue
        decorations.append({
            'id': f'b_{boundary_id:05d}',
            'kind': 'tree', 'x': -TOWN_HALF_X, 'y': round(y, 1),
            'variant': 1,
        })
        boundary_id += 1

    print(f'added {boundary_id - 100000} boundary trees')

    # ===== 3) 城外农场（mulberryForest 风格：栅栏围起 + 8×6 菜地 + 农民 + 牛）=====
    # 坐标：城镇东南角外 50m（x=60, y=60），朝东南
    farm_id = 200000
    FARM_CX, FARM_CY = 80, 80  # 农场中心
    FARM_W, FARM_H = 16, 14   # 栅栏围栏大小（米）

    # 3.1 围栏（栅栏，木桩）
    # 上下
    for x10 in range(int((FARM_CX - FARM_W/2) * 10), int((FARM_CX + FARM_W/2 + 1) * 10), 10):
        x = x10 / 10.0
        decorations.append({
            'id': f'farm_{farm_id:05d}', 'kind': 'fence', 'x': x, 'y': FARM_CY - FARM_H/2,
        })
        farm_id += 1
    # 左右
    for y10 in range(int((FARM_CY - FARM_H/2) * 10), int((FARM_CY + FARM_H/2 + 1) * 10), 10):
        y = y10 / 10.0
        decorations.append({
            'id': f'farm_{farm_id:05d}', 'kind': 'fence', 'x': FARM_CX + FARM_W/2, 'y': y,
        })
        farm_id += 1
    # 留出北侧 4m 入口（x ∈ [FARM_CX-2, FARM_CX+2] 不放栅栏）

    # 3.2 农田地块（6 列 × 4 行，每格 2 米 × 2 米，用 mulberry 农田 tile 7766）
    # 用 'farm' kind 让 App.vue 渲染真实的 tileset 农田
    for col in range(6):
        for row in range(4):
            decorations.append({
                'id': f'farm_field_{farm_id:05d}',
                'kind': 'farm',
                'x': round(FARM_CX - 6 + col * 2, 1),
                'y': round(FARM_CY - 3 + row * 2, 1),
                'tileId': 7766,
            })
            farm_id += 1

    # 3.3 农民（NPC，2 个，站在农场北入口附近）
    decorations.extend([
        {'id': 'farmer_1', 'kind': 'npc', 'x': FARM_CX - 3, 'y': FARM_CY - FARM_H/2 - 2, 'variant': 0, 'name': '农夫甲'},
        {'id': 'farmer_2', 'kind': 'npc', 'x': FARM_CX + 3, 'y': FARM_CY - FARM_H/2 - 2, 'variant': 1, 'name': '农夫乙'},
    ])

    # 3.4 牛（用 tileset 的 minotaur sprite 作为 cow placeholder，3 头放牧场）
    for i, (dx, dy) in enumerate([(-4, 2), (3, 2), (5, 0)]):
        decorations.append({
            'id': f'cow_{i}',
            'kind': 'tree',  # 用作占位（mulberry 牛 sprite 不在 SPRITE_ANIM 中）
            'x': FARM_CX + dx,
            'y': FARM_CY + FARM_H/2 - 2 + dy * 0.5,
            'variant': 0,
            '_note': 'cow placeholder'
        })

    # 3.5 农场边缘植物/树
    decorations.extend([
        {'id': 'farm_tree_1', 'kind': 'tree', 'x': FARM_CX - FARM_W/2 - 3, 'y': FARM_CY - FARM_H/2 - 3, 'variant': 0},
        {'id': 'farm_tree_2', 'kind': 'tree', 'x': FARM_CX + FARM_W/2 + 3, 'y': FARM_CY - FARM_H/2 - 3, 'variant': 1},
        {'id': 'farm_bush_1', 'kind': 'bush', 'x': FARM_CX - FARM_W/2 - 2, 'y': FARM_CY + FARM_H/2 + 2},
        {'id': 'farm_bush_2', 'kind': 'bush', 'x': FARM_CX + FARM_W/2 + 2, 'y': FARM_CY + FARM_H/2 + 2},
    ])

    # 3.6 野外零散装饰（保留之前的）
    decorations.extend([
        {'id': 'tree_wild_1', 'kind': 'tree', 'x': 120, 'y': -60, 'variant': 0},
        {'id': 'tree_wild_2', 'kind': 'tree', 'x': -150, 'y': 100, 'variant': 1},
        {'id': 'water_wild_1', 'kind': 'water', 'x': -200, 'y': -50},
    ])

    print(f'added farm with {farm_id - 200000} items')

    # ===== 4) Zone 列表（城镇 = 43×56 矩形）=====
    base['zones'] = [
        {'name': '城镇', 'x': 0, 'y': 0, 'rx': 21.5, 'ry': 28, 'kind': 'safe',
         'desc': 'Mulberry 镇（复刻 Rotten-Soup mulberryTown）', 'refresh_rate': 0, 'mob_types': []},
        {'name': '荒地', 'x': 300, 'y': 200, 'rx': 80, 'ry': 60, 'kind': 'danger',
         'desc': '野兽出没，每45秒刷新', 'refresh_rate': 45, 'mob_types': ['wolf', 'boar']},
        {'name': '废墟', 'x': -400, 'y': -300, 'rx': 60, 'ry': 50, 'kind': 'loot',
         'desc': '可能残留物资，每60秒刷新', 'refresh_rate': 60, 'mob_types': ['skeleton']},
        {'name': '清泉', 'x': 600, 'y': -500, 'rx': 40, 'ry': 35, 'kind': 'safe',
         'desc': '补给点，无怪物刷新', 'refresh_rate': 0, 'mob_types': []},
        {'name': '祭坛', 'x': -700, 'y': 500, 'rx': 50, 'ry': 40, 'kind': 'quest',
         'desc': '可触发支线，每90秒刷新', 'refresh_rate': 90, 'mob_types': ['spirit']},
    ]

    base['decorations'] = decorations
    open('public/maps/overworld.json', 'w', encoding='utf-8').write(
        json.dumps(base, ensure_ascii=False, indent=2)
    )
    print(f'total decorations: {len(decorations)}, file written')

if __name__ == '__main__':
    main()