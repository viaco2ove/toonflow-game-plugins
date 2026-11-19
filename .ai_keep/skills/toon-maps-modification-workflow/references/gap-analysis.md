# gap-analysis.md — 原型要素拆解与缺口分级

把概念原型图拆成可落地的要素清单，并逐条判定素材状态。本文件是第 2 步的口径依据；
机械匹配由 `scripts/gap_report.py` 完成，视觉判断由人看图确认。

## 1. 要素分类

| 类别 | 说明 | 落地载体 |
|---|---|---|
| `terrain` | 地面、道路、路面材质、积水/地面纹理 | 图集地形 tile（L1 地面层） |
| `structure` | 建筑、墙体、围合、围栏、门窗、屋顶 | 图集立面/结构 tile（L2 层） |
| `prop` | 家具、道具、车辆、设施、摊位、沙袋、帐篷 | 图集道具 tile（L3 层）或 Actors 对象 |
| `vegetation` | 树、灌木、枯丛、草丛 | 图集植物 tile |
| `actor` | NPC、野怪、可交互角色 | `entity_types.json` + Actors 对象层 |
| `trigger` | 事件区、传送门、任务板、入口 | `eventZones` + Actors 门对象 |

## 2. 四级状态判定

| 状态 | 判定条件 | 后续动作 |
|---|---|---|
| **R 现成** | 图集里已能目视确认对应图块；或 entity_types 已有同名/同类型实体 | 数据层直接落子/放置，记录 gid 或 entity_type |
| **C 可换色** | 图块形状/结构可复用，仅配色不符合题材（如木墙→混凝土灰、绿篱→枯丛） | `tile-style-change` 保形换色；先 `--preview` 看图 |
| **M 缺 tile** | 图集内没有对应形状，且尾部有空段可补 | `make_tiles.py` 程序化生成 32×32 tile，写入空段并出对照表 |
| **E 缺实体** | 活物类型未在 `entity_types.json` 定义（enemies/special/non-hostile 都查不到） | 先补实体定义（含 textures、camp、ai、spawn），再放 Actors |

判定顺序：先查实体表（actor 类）→ 再查图集候选（find_tiles 目视确认）→ 形状也没有才判 M。

### 禁止的判定方式

- 凭 gid 数字猜长相：图集分区被打乱，同类外观散落各处。
- 凭 `category` 标签下结论：实测标签不可靠（L1 草地被标成 building_wall）。
- 跨图集抄 gid：同一 gid 在不同 tileset 变体里像素含义可能不同，部分槽位在另一套里是透明。
- 把原型插画里的细节当成图集已有素材：原型是概念稿，不代表游戏内有对应 tile。

## 3. 清单格式（喂给 gap_report.py）

```json
{
  "maps": [
    {
      "file": "mulberryTown.json",
      "elements": [
        { "kind": "terrain", "name": "营地沥青/水泥路面", "keywords": ["road", "concrete", "asphalt"] },
        { "kind": "structure", "name": "铁丝网围栏", "keywords": ["fence", "iron"] },
        { "kind": "prop", "name": "帆布帐篷", "keywords": ["tent"] },
        { "kind": "prop", "name": "瞭望塔", "keywords": ["watchtower", "tower"] },
        { "kind": "vegetation", "name": "枯树枯丛", "keywords": ["shrub", "tree", "dead"] },
        { "kind": "actor", "name": "苏晚晴", "entity": "npc_1" },
        { "kind": "trigger", "name": "医疗站事件区", "zone": "医疗站" }
      ]
    }
  ]
}
```

字段说明：
- `kind`：上表六类之一。
- `name`：原型里的中文称呼，报告里原样保留。
- `keywords`：英文/别名，用于在 `compiled_dawnlike.json` 的 description 与实体名里模糊匹配。
- `entity`（actor 可选）：实体 id，如 `npc_1`；给了就按 id 精确核对实体表。
- `zone`（trigger 可选）：对应 `eventZones[].name`。

## 4. 报告产出口径

`gap_report.py` 输出 Markdown，每张地图一节：

1. **现状概览**：尺寸、层数、Actors 数、事件区清单、用量 Top gid。
2. **实体核对**：Actors 引用的 `entity_type` 是否都在 entity_types.json 有定义；缺失项标红。
3. **要素分级表**：每行 = 原型要素 / 类别 / 匹配到的现有实体或候选 gid / 状态（R/C/M/E）/ 备注。
4. **缺口汇总**：M 档缺哪些 tile、E 档缺哪些实体，按数量排序。

### 活物（actor）两层匹配口径

实体定义分散在两处，脚本都查：

- **实体表数组**：`enemies` / `special_enemies` / `non_hostile_entity_types` / `corpse_entity_types` / `item_types`；
  其中非敌对/物品/尸体数组是 `entity_type` 字符串列表，怪物数组是带 `entity_type/name_zh/textures` 的 dict。
- **`npc_dialogs` dict**：`{entity_type: 中文名}`，通用 NPC 的显示名挂在这里（复用旧 entity_type、只改对话名的角色在此命中）。

actor 分级依次走三层：

| 层级 | 命中条件 | 状态 |
|---|---|---|
| 1 实体表 | 在上述数组或 npc_dialogs 里按 id/中文名命中 | R 现成实体 |
| 2 本地图 | 实体表未命中，但本图 Actors 已有同名 `full_name` 对象（复用通用 NPC） | R 已在图上（复用通用类型） |
| 3 都未命中 | 实体表与本图 Actors 都找不到 | E 缺实体定义 |

> 注意：换皮故事里 entity_type 常沿用旧 id（如 DWARF_BILI 显示名已是「江浩」），按中文名命中是预期行为，不要误判成实体错配。

脚本不做像素相似度判断；候选 gid 必须再开 `find_tiles.py` 出的拼图目视确认后才能落子。

## 5. 末世/废墟题材常见要素清单（营地 + 废墟带参考）

### 幸存者营地（室内/半室内围合场景）

| 要素 | 类别 | 典型缺口 |
|---|---|---|
| 水泥/沥青营地地面 | terrain | 基础图集多为草地/泥地，可能需 C 换色或 M 补路面 tile |
| 混凝土残墙/体育馆外墙 | structure | 基础图集为木墙/砖墙，通常 M 补混凝土立面 |
| 铁丝网/铁栏杆围栏 | structure | 查图集 fence 类；无则 M 补铁栏 tile |
| 帆布帐篷 | prop | 基础图集通常没有，M 补 |
| 沙袋/路障 | prop | M 补 |
| 瞭望塔/探照灯 | prop | M 补（立柱+平台+灯组） |
| 桌椅/灶台/补给架 | prop | 优先复用图集家具 tile，C 换色 |
| 枯树/枯草 | vegetation | 现有绿树 C 换色为灰绿枯丛；形态不符再 M 补 |

### 外围废墟带（开放场景）

| 要素 | 类别 | 典型缺口 |
|---|---|---|
| 开裂沥青路/水泥空地 | terrain | M 补路面 tile 或 C 换色 |
| 断墙残垣/空窗框 | structure | M 补残墙 tile（带缺口碎边） |
| 废弃车辆（轿车/皮卡） | prop | 基础图集没有，M 补俯视车辆 tile |
| 积水坑/湿地面 | terrain | 复用图集水面 tile，C 压暗成滞水色 |
| 黑雾/雾团 | prop/氛围 | 半透明紫灰 tile，叠在 L3；注意透明度与描边 |
| 药草/杂草丛 | vegetation | 复用植物 tile，C 换色 |
| 黑市摊棚/木箱 | prop | 复用家具/箱柜 tile，C 换色 |

### 活物（actor）核对要点

- NPC：核对 `entity_type`、`full_name`、`uid` 三者；同一角色 uid 全图集复用，不新造。
- 野怪：实体表定义、Actors 的 `entity_type`、头顶 `full_name` 三处一致；`textures` 首帧 + 动画帧都要在图集里有对应格。
- 原型里出现但实体表没有的人形/怪物，先判 E，补完定义再放置。

## 6. 分级示例（本故事营地）

| 原型要素 | 现状核对 | 状态 | 动作 |
|---|---|---|---|
| 食堂/医疗站/训练场分区 | eventZones 与 Actors 已落位 | R | 数据层保留，仅核对位置 |
| 混凝土营地地面 | 图集现有石板/泥地 tile | C | 保形换色压暗为冷灰 |
| 铁丝网围栏 | 图集现有木栅栏/绿篱 | M | 补铁栏 tile 或换现有铁件 tile |
| 帐篷/瞭望塔/沙袋 | 图集与实体表均无 | M | 程序化补 tile，再落子 |
| 苏晚晴/老雷/赵大川等 NPC | entity_types 已有定义 | R | Actors 层核对 uid 与位置 |
| 黑雾女孩幻影（小铃铛） | 实体已有，造型为幻影 | R/C | 核对 sprite 绑定，必要时换色 |
