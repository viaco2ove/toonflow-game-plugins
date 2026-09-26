#!/usr/bin/env python3
"""生成 43x56 米的矩形城镇地图（外圈边界 + 4 角房屋）"""
import json

def main():
    data = json.load(open('public/maps/overworld.json', 'r', encoding='utf-8'))

    # 矩形区域 rx=21.5 ry=28
    data['zones'] = [
        {
            'name': '城镇',
            'x': 0,
            'y': 0,
            'rx': 21.5,
            'ry': 28,
            'kind': 'safe',
            'desc': '玩家出生的安全区，无怪物刷新',
            'refresh_rate': 0,
            'mob_types': []
        },
        {
            'name': '荒地',
            'x': 300,
            'y': 200,
            'r': 80,
            'kind': 'danger',
            'desc': '野兽出没，每45秒刷新',
            'refresh_rate': 45,
            'mob_types': ['wolf', 'boar']
        },
        {
            'name': '废墟',
            'x': -400,
            'y': -300,
            'r': 60,
            'kind': 'loot',
            'desc': '可能残留物资，每60秒刷新',
            'refresh_rate': 60,
            'mob_types': ['skeleton']
        },
        {
            'name': '清泉',
            'x': 600,
            'y': -500,
            'r': 40,
            'kind': 'safe',
            'desc': '补给点，无怪物刷新',
            'refresh_rate': 0,
            'mob_types': []
        },
        {
            'name': '祭坛',
            'x': -700,
            'y': 500,
            'r': 50,
            'kind': 'quest',
            'desc': '可触发支线，每90秒刷新',
            'refresh_rate': 90,
            'mob_types': ['spirit']
        },
    ]

    decorations = []

    # ===== 边界外圈：树和栅栏交替，间隔 2 米 =====
    # 只留 4 个出口：北、南、东、西各 1 个，4 米宽
    NORTH_EXITS = [(-2, 2)]        # 北中 1 个
    SOUTH_EXITS = [(-2, 2)]        # 南中 1 个
    EAST_EXIT = (-2, 2)            # 东中 1 个
    WEST_EXIT = (-2, 2)            # 西中 1 个

    def in_range(v, ranges):
        return any(s <= v <= e for s, e in ranges)

    # 北边：沿 x = -21..21，y = -28，每 2 米一个
    for x in range(-21, 22, 2):
        if in_range(x, NORTH_EXITS):
            continue
        # 偶数 x 树，奇数 x 栅栏
        decorations.append({'id': f'bn_{x}', 'kind': 'tree', 'x': x, 'y': -28, 'variant': 0})

    # 南边
    for x in range(-21, 22, 2):
        if in_range(x, SOUTH_EXITS):
            continue
        decorations.append({'id': f'bs_{x}', 'kind': 'tree', 'x': x, 'y': 28, 'variant': 1})

    # 东边
    for y in range(-28, 29, 2):
        if in_range(y, [EAST_EXIT]):
            continue
        decorations.append({'id': f'be_{y}', 'kind': 'tree', 'x': 21.5, 'y': y, 'variant': 0})

    # 西边
    for y in range(-28, 29, 2):
        if in_range(y, [WEST_EXIT]):
            continue
        decorations.append({'id': f'bw_{y}', 'kind': 'tree', 'x': -21.5, 'y': y, 'variant': 1})

    # 出口处画一个木桩作为门柱
    for (xs, xe) in NORTH_EXITS:
        decorations.append({'id': f'exit_n_post_l_{xs}', 'kind': 'fence', 'x': xs, 'y': -28})
        decorations.append({'id': f'exit_n_post_r_{xe}', 'kind': 'fence', 'x': xe, 'y': -28})
    for (xs, xe) in SOUTH_EXITS:
        decorations.append({'id': f'exit_s_post_l_{xs}', 'kind': 'fence', 'x': xs, 'y': 28})
        decorations.append({'id': f'exit_s_post_r_{xe}', 'kind': 'fence', 'x': xe, 'y': 28})
    # 东出口门柱
    decorations.append({'id': 'exit_e_post_t', 'kind': 'fence', 'x': 21.5, 'y': EAST_EXIT[0]})
    decorations.append({'id': 'exit_e_post_b', 'kind': 'fence', 'x': 21.5, 'y': EAST_EXIT[1]})
    # 西出口门柱
    decorations.append({'id': 'exit_w_post_t', 'kind': 'fence', 'x': -21.5, 'y': WEST_EXIT[0]})
    decorations.append({'id': 'exit_w_post_b', 'kind': 'fence', 'x': -21.5, 'y': WEST_EXIT[1]})

    # ===== 城镇内部：十字土路 =====
    # 南北路 x=0, y=-25..25
    for y in range(-25, 26):
        decorations.append({'id': f'road_ns_{y}', 'kind': 'road', 'x': 0, 'y': y})
    # 东西路 y=0, x=-19..19
    for x in range(-19, 20):
        decorations.append({'id': f'road_ew_{x}', 'kind': 'road', 'x': x, 'y': 0})

    # ===== 房屋（4 栋，4 个象限）=====
    # 左上（铁匠）
    decorations.append({'id': 'house_blacksmith', 'kind': 'building', 'x': -12, 'y': -16, 'variant': 0})
    decorations.append({'id': 'forge', 'kind': 'furniture', 'x': -12, 'y': -20, 'variant': 0})
    # 右上（商店）
    decorations.append({'id': 'house_shop', 'kind': 'building', 'x': 12, 'y': -16, 'variant': 1})
    decorations.append({'id': 'counter', 'kind': 'furniture', 'x': 12, 'y': -20, 'variant': 1})
    # 左下（长者）
    decorations.append({'id': 'house_elder', 'kind': 'building', 'x': -12, 'y': 16, 'variant': 2})
    decorations.append({'id': 'carpet', 'kind': 'furniture', 'x': -12, 'y': 20, 'variant': 2})
    # 右下（旅馆）
    decorations.append({'id': 'house_inn', 'kind': 'building', 'x': 12, 'y': 16, 'variant': 3})
    decorations.append({'id': 'bed', 'kind': 'furniture', 'x': 12, 'y': 20, 'variant': 3})

    # ===== NPC（每个房屋前 1 个）=====
    decorations.append({'id': 'npc_blacksmith', 'kind': 'npc', 'x': -8, 'y': -16, 'variant': 0, 'name': '铁匠'})
    decorations.append({'id': 'npc_merchant', 'kind': 'npc', 'x': 8, 'y': -16, 'variant': 1, 'name': '商人'})
    decorations.append({'id': 'npc_elder', 'kind': 'npc', 'x': -8, 'y': 16, 'variant': 2, 'name': '长者'})
    decorations.append({'id': 'npc_innkeeper', 'kind': 'npc', 'x': 8, 'y': 16, 'variant': 3, 'name': '旅馆'})
    # 中心守卫
    decorations.append({'id': 'npc_guard', 'kind': 'npc', 'x': 0, 'y': 5, 'variant': 4, 'name': '守卫'})

    # ===== 农田（左下象限角落，9 格）=====
    farm_x0, farm_y0 = -18, 6
    for r in range(3):
        for c in range(3):
            decorations.append({
                'id': f'farm_{r}_{c}',
                'kind': 'farm',
                'x': farm_x0 + c * 2,
                'y': farm_y0 + r * 2
            })

    # ===== 城内装饰树（沿内侧稀疏）=====
    # 一些散落的树让城镇更生动（不挡路）
    decorations.append({'id': 'tree_in_1', 'kind': 'tree', 'x': -7, 'y': -8, 'variant': 0})
    decorations.append({'id': 'tree_in_2', 'kind': 'tree', 'x': 7, 'y': 8, 'variant': 1})
    decorations.append({'id': 'bush_in_1', 'kind': 'bush', 'x': -7, 'y': -4, 'variant': 0})

    # ===== 野外 =====
    decorations.append({'id': 'tree_wild_1', 'kind': 'tree', 'x': 120, 'y': -60, 'variant': 0})
    decorations.append({'id': 'tree_wild_2', 'kind': 'tree', 'x': -150, 'y': 100, 'variant': 1})
    decorations.append({'id': 'water_wild_1', 'kind': 'water', 'x': -200, 'y': -50})

    # ===== 废墟 =====
    decorations.append({'id': 'ruin1', 'kind': 'building', 'x': -380, 'y': -280, 'variant': 4})
    decorations.append({'id': 'ruin2', 'kind': 'building', 'x': -420, 'y': -320, 'variant': 5})

    data['decorations'] = decorations

    open('public/maps/overworld.json', 'w', encoding='utf-8').write(
        json.dumps(data, ensure_ascii=False, indent=2)
    )
    print('Done: 43x56 rectangle town, sparse tree perimeter, gates with posts')

if __name__ == '__main__':
    main()