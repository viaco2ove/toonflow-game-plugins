#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_entity_types.py —— 地图集**自己**生成 entity_types.json
============================================================
为什么有这个工具（2026-11-10 用户明确要求）：
  **插件里不允许出现任何「某个地图集特有」的实体/名称/数值。**
  插件只做通用解析；地图集的一切特有数据都写在自己的 entity_types.json 里，
  随 .tbg 视觉包一起打包，运行时由插件的 entityRegistry 读入。

本工具做三件事（幂等，可反复跑）：
  ① 合并**基础怪物表**（Rotten-Soup 原始数据，引擎级、非地图集业务）
     —— 地图集只需声明自己新增的怪，其余自动继承；
  ② 追加地图集**特有怪**（故事专属 entity_type + 中文名 + 数值 + 贴图帧）；
  ③ 从地图 Tiled 对象**自动派生** npc_dialogs（dialog key → 中文名）：
     规则 = 该 dialog key 在某图上出现时，取同对象的 full_name / name 作为中文名。
     地图里没写 full_name 的 NPC 会漏掉 → 工具会列出待补清单（stderr 提示）。

用法：
  python build_entity_types.py <故事目录> [--stories 附加目录1,目录2 ...]
  例：
    python build_entity_types.py \\
      workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季
"""
from __future__ import print_function

import io
import json
import os
import sys

# ── 路径 ──────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BASE_TYPES = os.path.join(
    REPO_ROOT, "workshops", "toonflow-field-survival", "map_design",
    "base", "entity_types.json",
)

# ── 基础怪物表的中文名 / 阵营（Rotten-Soup 原始数据的本地化）──
#   这是**引擎级**词表（游戏本体的怪物），不是任何地图集的业务。
BASE_ZH = {
    "RAT": "老鼠", "BAT": "暗夜生物", "SNAKE": "爬虫", "WILD_GOAT": "山羊",
    "GOBLIN": "哥布林", "ZOMBIE": "人形亡者", "IMP": "小恶魔", "SKELETON": "骷髅兵",
    "KOBOLD": "狗头人", "ICE_ELEMENTAL": "冰元素", "ORC": "半兽人",
    "BONEMAN": "白骨人", "EMPOWERED_ORC": "强化半兽人", "DEMON": "恶魔",
    "GHOST": "幽灵", "MUMMY": "木乃伊", "SIREN": "塞壬", "TROLL": "巨魔",
    "BANSHEE": "报丧女偶", "GOLEM": "石魔", "CYCLOPS": "独眼巨人",
    "MINOTAUR": "牛头人", "VAMPIRE": "血族", "LICH": "巫妖", "LOOT_GOBLIN": "拾荒哥布林",
}

# ── 基础 NPC 对话名（Rotten-Soup 原始地图的 NPC，引擎级）──
#   这几个 NPC 在 base/overworld.json 里只带 dialog key、不写 full_name，
#   头顶名字由本表提供（同样属于「基础数据」，不是任何地图集的业务）。
BASE_NPC_DIALOGS = {
    "DWARF_BILI": "矮人比利",
    "BARTENDER": "酒馆老板",
    "MAYOR_LEONARD": "镇长 Leonard",
    "LEONARD": "镇长 Leonard",
    "BARKEEP": "酒馆老板",
}

# ── 地图集特有怪声明 ──────────────────────────────────
#   key = 故事目录名 → 该故事新增的怪
#   字段：entity_type / name_zh / hp / atk / def / level / textures（图集 tile id）/ camp
STORY_ENEMIES = {
    "赦夜人冥夜走廊-第二季": [
        {
            "entity_type": "SY_BLOODRAT", "name": "blood rat", "name_zh": "魔血鼠",
            "description_zh": "被魔血浸过的鼠。牙龈发黑，见人就钻。",
            "hp_game": 45, "atk_game": 10, "def_game": 2, "level_game": 2,
            "textures": [2365, 2373], "camp": "hostile",
        },
        {
            "entity_type": "SY_BLOODBAT", "name": "blood bat", "name_zh": "血蝠",
            "description_zh": "夜行的血蝠。翼膜下渗着暗红的液体。",
            "hp_game": 70, "atk_game": 14, "def_game": 3, "level_game": 4,
            "textures": [3704, 3712], "camp": "hostile",
        },
        {
            "entity_type": "SY_BLOODBAT2", "name": "blood bat elder", "name_zh": "血翼蝠",
            "description_zh": "翼展近一米的血蝠王。群里的那只。",
            "hp_game": 130, "atk_game": 22, "def_game": 5, "level_game": 8,
            "textures": [3704, 3712], "camp": "hostile",
        },
        {
            "entity_type": "SY_BLACKCORPSE", "name": "black armored corpse", "name_zh": "黑甲尸",
            "description_zh": "披着黑甲的尸傀。甲缝里塞满了暗核碎片。",
            "hp_game": 180, "atk_game": 24, "def_game": 12, "level_game": 6,
            "textures": [2552, 2560], "camp": "hostile",
        },
        {
            "entity_type": "SY_CARRION", "name": "carrion", "name_zh": "尸傀",
            "description_zh": "还没被完全唤醒的尸傀。关节还是软的。",
            "hp_game": 90, "atk_game": 16, "def_game": 4, "level_game": 5,
            "textures": [2552, 2560], "camp": "hostile",
        },
        {
            "entity_type": "SY_CORRIDOR", "name": "corridor thing", "name_zh": "走廊魔物",
            "description_zh": "走廊深处的东西。看不出原本是什么形状。",
            "hp_game": 110, "atk_game": 18, "def_game": 6, "level_game": 6,
            "textures": [7440, 7448], "camp": "hostile",
        },
        {
            "entity_type": "SY_LUWENZHAO_BOSS", "name": "twilight deacon", "name_zh": "陆文昭",
            "description_zh": "暮光教会的执事。终章里的那个人。",
            "hp_game": 420, "atk_game": 34, "def_game": 18, "level_game": 12,
            "textures": [5292, 5300], "camp": "hostile",
        },
    ],
    "黑塔：从超忆症开始成神": [
        {
            "entity_type": "HT_FAKE_STUDENT", "name": "fake student", "name_zh": "伪人·学生",
            "description_zh": "被改写了一半的人。脸是对的，眼神不是。",
            "hp_game": 45, "atk_game": 9, "def_game": 2, "level_game": 1,
            "textures": [4336, 4344], "camp": "hostile",
        },
        {
            "entity_type": "HT_FAKE_PAW", "name": "fake pawn", "name_zh": "伪人·爪牙",
            "description_zh": "被什么东西驱使着来猎杀，从不半途而废。",
            "hp_game": 75, "atk_game": 14, "def_game": 4, "level_game": 3,
            "textures": [2672, 2680], "camp": "hostile",
        },
        {
            "entity_type": "HT_FAKE_ELITE", "name": "fake elite", "name_zh": "伪人·精英",
            "description_zh": "站得比谁都直，笑得比谁都标准。",
            "hp_game": 150, "atk_game": 20, "def_game": 8, "level_game": 5,
            "textures": [4817, 4825], "camp": "hostile",
        },
        {
            "entity_type": "HT_FAKE_TEACHER", "name": "fake teacher", "name_zh": "伪人·教师",
            "description_zh": "讲课的时候，他从不看教材。",
            "hp_game": 110, "atk_game": 16, "def_game": 6, "level_game": 4,
            "textures": [4812, 4820], "camp": "hostile",
        },
        {
            "entity_type": "HT_FAKE_HOST", "name": "fake host", "name_zh": "伪人·宿主",
            "description_zh": "他记得所有人的名字，除了自己的。",
            "hp_game": 260, "atk_game": 26, "def_game": 12, "level_game": 7,
            "textures": [4219, 4227], "camp": "hostile",
        },
        {
            "entity_type": "HT_FAKE_MR", "name": "Mr. Xiansheng", "name_zh": "先生",
            "description_zh": "伪人首领。他记得林凡——因为林凡的消失就是他的手笔之一。",
            "hp_game": 420, "atk_game": 34, "def_game": 18, "level_game": 9,
            "textures": [4814, 4822], "camp": "hostile",
        },
    ],
}


def load_json(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2))
        f.write("\n")


def collect_dialogs(maps_dir):
    """从地图 Tiled 对象派生 npc_dialogs：dialog key → 中文名(full_name / name)。"""
    out = {}
    missing = []
    if not os.path.isdir(maps_dir):
        return out, missing
    for fn in sorted(os.listdir(maps_dir)):
        if not fn.endswith(".json"):
            continue
        try:
            d = load_json(os.path.join(maps_dir, fn))
        except Exception:
            continue
        for layer in d.get("layers") or []:
            if layer.get("type") != "objectgroup":
                continue
            for o in layer.get("objects") or []:
                props = {}
                for p in o.get("properties") or []:
                    props[p.get("name")] = p.get("value")
                dlg = props.get("dialog")
                if not isinstance(dlg, str) or not dlg.strip():
                    continue
                key = dlg.strip().upper()
                if key in out:
                    continue
                zh = ""
                for cand in (props.get("full_name"), props.get("name")):
                    if isinstance(cand, str) and cand.strip() and cand.strip() != "NPC":
                        zh = cand.strip()
                        break
                if zh:
                    out[key] = zh
                else:
                    missing.append((key, fn, o.get("id")))
    return out, missing


def merge_enemies(base, story_list):
    """基础表 + 故事特有怪（同 entity_type 以故事为准）。"""
    merged = []
    seen = set()
    for e in base.get("enemies") or []:
        e2 = dict(e)
        et = e2.get("entity_type")
        seen.add(et)
        if et in BASE_ZH:
            e2["name_zh"] = BASE_ZH[et]
        e2.setdefault("camp", "hostile")
        merged.append(e2)
    for e in story_list:
        et = e.get("entity_type")
        # 已有同 id（基础表里）→ 覆盖
        idx = next((i for i, x in enumerate(merged) if x.get("entity_type") == et), -1)
        if idx >= 0:
            merged[idx].update(e)
        else:
            merged.append(dict(e))
    return merged


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    story_dir = os.path.abspath(argv[1])
    story_name = os.path.basename(story_dir)
    if not os.path.isdir(story_dir):
        print("! 故事目录不存在：", story_dir)
        return 1

    base = load_json(BASE_TYPES) if os.path.exists(BASE_TYPES) else {"enemies": [], "special_enemies": []}
    story_extra = STORY_ENEMIES.get(story_name, [])

    # 已有文件里的故事特有怪（人工手改过的要保留）→ 先读出来做合并基底
    out_path = os.path.join(story_dir, "entity_types.json")
    existing = {}
    if os.path.exists(out_path):
        try:
            existing = load_json(out_path)
        except Exception:
            existing = {}
    existing_special = existing.get("special_enemies") or []

    enemies = merge_enemies(base, story_extra)

    # npc_dialogs：地图派生 ∪ 已有手写（手写优先）
    dialogs, missing = collect_dialogs(os.path.join(story_dir, "maps"))
    # 基础 NPC 名兜底（引擎级数据）→ 地图集派生值优先
    for k, v in BASE_NPC_DIALOGS.items():
        dialogs.setdefault(k, v)
    # 已有手写（人工调整过）优先级最高
    for k, v in (existing.get("npc_dialogs") or {}).items():
        dialogs[k] = v

    data = {
        "meta": {
            "generator": "src/tools/toonflow-field-survival/build_entity_types.py",
            "note": ("本文件由地图集自己维护：插件只做通用解析，不含任何地图集业务。"
                     "改怪数值/中文名/贴图/NPC 名请改这里，不要改插件。"),
            "story": story_name,
            "base_source": "map_design/base/entity_types.json（Rotten-Soup 原始数据）",
        },
        "enemies": enemies,
        "special_enemies": existing_special,
        "non_hostile_entity_types": existing.get("non_hostile_entity_types") or base.get("non_hostile_entity_types") or [],
        "corpse_entity_types": existing.get("corpse_entity_types") or base.get("corpse_entity_types") or [],
        "item_types": existing.get("item_types") or base.get("item_types") or [],
        "npc_dialogs": dialogs,
    }
    save_json(out_path, data)

    print("✓ 已生成", out_path)
    print("   怪档案 %d 种（故事特有 %d）/ NPC 对话名 %d 个"
          % (len(enemies), len(story_extra), len(dialogs)))
    if missing:
        print("   ⚠ 这些 dialog key 的对象在地图里没写 full_name/name → 头顶会显示原始 key：")
        for key, fn, oid in missing:
            print("      %-24s %s#%s" % (key, fn, oid))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
