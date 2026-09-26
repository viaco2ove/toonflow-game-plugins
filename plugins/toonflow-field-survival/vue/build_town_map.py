#!/usr/bin/env python3
"""生成 43x56 米的矩形城镇地图（overworld.json）"""
import json

def main():
    data = json.load(open('public/maps/overworld.json', 'r', encoding='utf-8'))

    # 城镇矩形区域: 43x56 米
    # 左上角 (-21.5, -28), 右下角 (21.5, 28)
    # 边界用树和栅栏围住，只留几个出口

    # 区域定义（矩形）
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

    # ===== 边界围栏 + 树 =====
    # 北边 (y=-28): 留 3 个出口（东、中、西），中间出口 4 米宽，两边各 3 米宽
    # x 范围 -21.5 到 21.5
    north_exits = [(-10, -7), (-2, 2), (7, 10)]  # 出口区间
    for x in range(-21, 22):
        in_exit = any(s <= x <= e for s, e in north_exits)
        if not in_exit:
            if x % 2 == 0:
                decorations.append({'id': f'fence_n_{x}', 'kind': 'fence', 'x': x, 'y': -28})
            else:
                decorations.append({'id': f'tree_n_{x}', 'kind': 'tree', 'x': x, 'y': -28, 'variant': x % 2})

    # 南边 (y=28): 留 2 个出口
    south_exits = [(-8, -4), (4, 8)]
    for x in range(-21, 22):
        in_exit = any(s <= x <= e for s, e in south_exits)
        if not in_exit:
            if x % 2 == 0:
                decorations.append({'id': f'fence_s_{x}', 'kind': 'fence', 'x': x, 'y': 28})
            else:
                decorations.append({'id': f'tree_s_{x}', 'kind': 'tree', 'x': x, 'y': 28, 'variant': x % 2})

    # 东边 (x=21.5): 留 1 个出口
    east_exit = (-5, 5)  # y 方向出口
    for y in range(-28, 29):
        in_exit = east_exit[0] <= y <= east_exit[1]
        if not in_exit:
            if y % 2 == 0:
                decorations.append({'id': f'tree_e_{y}', 'kind': 'tree', 'x': 21.5, 'y': y, 'variant': 0})
            else:
                decorations.append({'id': f'fence_e_{y}', 'kind': 'fence', 'x': 21.5, 'y': y})

    # 西边 (x=-21.5): 留 1 个出口
    west_exit = (-8, 2)
    for y in range(-28, 29):
        in_exit = west_exit[0] <= y <= west_exit[1]
        if not in_exit:
            if y % 2 == 0:
                decorations.append({'id': f'fence_w_{y}', 'kind': 'fence', 'x': -21.5, 'y': y})
            else:
                decorations.append({'id': f'tree_w_{y}', 'kind': 'tree', 'x': -21.5, 'y': y, 'variant': 1})

    # ===== 十字土路 =====
    # 南北路 (x=0, y 从 -25 到 25)
    for y in range(-25, 26):
        decorations.append({'id': f'road_ns_{y}', 'kind': 'road', 'x': 0, 'y': y})
    # 东西路 (y=0, x 从 -19 到 19)
    for x in range(-19, 20):
        decorations.append({'id': f'road_ew_{x}', 'kind': 'road', 'x': x, 'y': 0})

    # ===== 房屋布局（4 栋）=====
    # 左上区 (-18 到 -6, -25 到 -10)
    decorations.append({'id': 'house_blacksmith', 'kind': 'building', 'x': -12, 'y': -18, 'variant': 0})
    decorations.append({'id': 'forge', 'kind': 'furniture', 'x': -12, 'y': -21, 'variant': 0})

    # 右上区 (6 到 18, -25 到 -10)
    decorations.append({'id': 'house_shop', 'kind': 'building', 'x': 12, 'y': -18, 'variant': 1})
    decorations.append({'id': 'counter', 'kind': 'furniture', 'x': 12, 'y': -21, 'variant': 1})

    # 左下区 (-18 到 -6, 10 到 25)
    decorations.append({'id': 'house_elder', 'kind': 'building', 'x': -12, 'y': 18, 'variant': 2})
    decorations.append({'id': 'carpet', 'kind': 'furniture', 'x': -12, 'y': 15, 'variant': 2})

    # 右下区 (6 到 18, 10 到 25)
    decorations.append({'id': 'house_inn', 'kind': 'building', 'x': 12, 'y': 18, 'variant': 3})
    decorations.append({'id': 'bed', 'kind': 'furniture', 'x': 12, 'y': 15, 'variant': 3})

    # ===== NPC =====
    decorations.append({'id': 'npc_blacksmith', 'kind': 'npc', 'x': -8, 'y': -18, 'variant': 0, 'name': '铁匠'})
    decorations.append({'id': 'npc_merchant', 'kind': 'npc', 'x': 8, 'y': -18, 'variant': 1, 'name': '商人'})
    decorations.append({'id': 'npc_elder', 'kind': 'npc', 'x': -8, 'y': 18, 'variant': 2, 'name': '长者'})
    decorations.append({'id': 'npc_innkeeper', 'kind': 'npc', 'x': 8, 'y': 18, 'variant': 3, 'name': '旅馆老板'})
    decorations.append({'id': 'npc_guard_n', 'kind': 'npc', 'x': 0, 'y': -25, 'variant': 4, 'name': '守卫'})
    decorations.append({'id': 'npc_guard_s', 'kind': 'npc', 'x': 0, 'y': 25, 'variant': 4, 'name': '守卫'})
    decorations.append({'id': 'npc_guard_e', 'kind': 'npc', 'x': 19, 'y': 0, 'variant': 4, 'name': '守卫'})
    decorations.append({'id': 'npc_guard_w', 'kind': 'npc', 'x': -19, 'y': 0, 'variant': 4, 'name': '守卫'})

    # ===== 农田（左上角空地）=====
    farm_x, farm_y = -16, 5
    for r in range(3):
        for c in range(3):
            decorations.append({
                'id': f'farm_{r}_{c}',
                'kind': 'farm',
                'x': farm_x + c * 3,
                'y': farm_y + r * 3
            })

    # ===== 额外装饰树（四角）=====
    decorations.append({'id': 'tree_corner_ne', 'kind': 'tree', 'x': 18, 'y': -23, 'variant': 0})
    decorations.append({'id': 'tree_corner_nw', 'kind': 'tree', 'x': -18, 'y': -23, 'variant': 1})
    decorations.append({'id': 'tree_corner_se', 'kind': 'tree', 'x': 18, 'y': 23, 'variant': 0})
    decorations.append({'id': 'tree_corner_sw', 'kind': 'tree', 'x': -18, 'y': 23, 'variant': 1})

    # ===== 野外装饰 ======
    decorations.append({'id': 'tree_wild_1', 'kind': 'tree', 'x': 120, 'y': -60, 'variant': 0})
    decorations.append({'id': 'tree_wild_2', 'kind': 'tree', 'x': -150, 'y': 100, 'variant': 1})
    decorations.append({'id': 'water_wild_1', 'kind': 'water', 'x': -200, 'y': -50})

    # ===== 废墟建筑 =====
    decorations.append({'id': 'ruin1', 'kind': 'building', 'x': -380, 'y': -280, 'variant': 4})
    decorations.append({'id': 'ruin2', 'kind': 'building', 'x': -420, 'y': -320, 'variant': 5})

    data['decorations'] = decorations

    open('public/maps/overworld.json', 'w', encoding='utf-8').write(
        json.dumps(data, ensure_ascii=False, indent=2)
    )
    print('Done: 43x56 矩形城镇地图已生成')

if __name__ == '__main__':
    main()
