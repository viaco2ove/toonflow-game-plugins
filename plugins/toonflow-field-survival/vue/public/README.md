# 地图初始信息加载
[first.map.json](maps/first.map.json)
例如
```json
{
  "start_map": {
    "name": "portalID",
    "type": "string",
    "value": "Mulberry Town"
  }
}

```
代表初始地图是：
[mulberryTown.json](maps/mulberryTown.json)


# 野怪信息
例如
[mulberryForest.json](maps/mulberryForest.json)
## ✅ 有野怪信息，全部整理如下
地图是Tiled地图，对象层`Actors`里面存放怪物出生信息，**瓦片32×32**，坐标`x/y`是像素坐标。

> 怪物统一类型：GOBLIN（哥布林），ORC（兽人）

## 1. 哥布林 Goblin，等级 level = 1
| id | 名称 | 类型 | 等级 | 像素X | 像素Y |
|----|------|------|------|-------|-------|
|5|Goblin|GOBLIN|1|672|1248|
|6|Goblin|GOBLIN|1|704|1152|
|7|Goblin|GOBLIN|1|736|1216|
|9|Goblin|GOBLIN|1|1568|672|
|10|Goblin|GOBLIN|1|1600|576|
|11|Goblin|GOBLIN|1|1664|672|
|16|Goblin|GOBLIN|1|1632|608|
|17|Goblin|GOBLIN|1|1248|800|
|18|Goblin|GOBLIN|1|1248|864|

## 2. 兽人 Orc，等级 level = 3
| id | 名称 | 类型 | 等级 | 像素X | 像素Y |
|----|------|------|------|-------|-------|
|22|Orc|ORC|3|1568|1024|
|32|Orc|ORC|3|1600|960|

---
### 补充
- 坐标换算成**瓦片格子坐标**（tile坐标，除以32）
例：x=672，672/32 = 21；y=1248/32 = 39 → 瓦片(21,39)
```
哥布林(21,39)
哥布林(22,36)
哥布林(23,38)
哥布林(49,21)
哥布林(50,18)
哥布林(52,21)
哥布林(51,19)
哥布林(39,25)
哥布林(39,27)

兽人(49,32)
兽人(50,30)
```

如果你需要，我可以帮你直接导出成游戏代码格式（json / 数组）。

# 无野怪的地图
[mulberryTown.json](maps/mulberryTown.json)
没有任何野怪 / 怪物（Enemy）对象
```json
{
  "height":56,        // 地图总瓦片高度 56格
  "infinite":false,   // 不是无限地图，固定尺寸
  "layers":[...],     // 图层数组（瓦片层+对象层）
  "nextlayerid":5,
  "nextobjectid":227, // 下一个对象ID是227，现有对象最大id=226
  "orientation":"orthogonal", // 正交瓦片地图（2D俯视/斜向正交）
  "renderorder":"right-down",
  "tiledversion":"1.2.1",
  "tileheight":32,    // 单瓦片像素高32px
  "tilesets":[...],
  "tilewidth":32,     // 单瓦片像素宽32px
  "type":"map",
  "version":1.2,
  "width":43          // 地图总瓦片宽度43格
}
```
这份 Tiled 地图 JSON本身没有单独一层专门标记敌人，判断「没有敌方」是从 Actors 对象层（id=4）遍历所有 object，筛选 entity_type：
敌人（Monster/Enemy）在你的这套地图规范里，不会出现在这个地图的 Actor 列表里；这个 Actor 层里所有实体类型只有：
DOOR、CHEST、NPC、LADDER、LEVEL_TRANSITION、PLAYER，没有任何 ENEMY/MONSTER 类型对象。
一、拆解 Actors 对象层（"name":"Actors"）
所有 objects 的entity_type枚举：
DOOR：门（Vertical Door / Horizontal Door）
CHEST：宝箱
NPC：NPC（村民、酒馆老板、镇长、矮人等，wanders=true 是闲逛 NPC）
LADDER：梯子（地牢传送）
LEVEL_TRANSITION：场景切换传送门（森林 / 墓地）
PLAYER：玩家出生点
👉 全程没有任何对象的 entity_type = "ENEMY" / "MONSTER"，这就是判定「这张图没有敌方」的根本依据。
注意：
Tile Layer 1/2/3 瓦片层只是地形、墙壁、装饰瓦片，瓦片 ID 只是图片索引，瓦片本身不是敌人；瓦片层的obstacles:true只是代表碰撞障碍物（墙、家具），不是怪物。
敌人是对象层实体（objectgroup），不是瓦片。你这套项目的约定：怪物、NPC、玩家、门、宝箱全部放在Actors对象层，而不是瓦片层。

# 问题点
依靠了entity_type 来判断 阵营。具有不可靠性
优化：
1.依然采取原来的“entity_type”来初步判断阵营，这样可以无需修改原来的地图依然可用。
5 个 playable_now 怪物：
RAT / BAT / SNAKE / GOBLIN /ORC
RAT / BAT / SNAKE/WILD_GOAT / GOBLIN / ZOMBIE/IMP/ORC etc
老鼠/暗夜生物/爬虫/山羊/绿皮地精（哥布林）/人形亡者/小恶魔 等
[entity_types.json](entity_types.json)
2.增加“camp” 代表阵营
neutral/hostile/friendly
没有camp时依靠entity_type来判断
3.增加"full_name" 代表姓名
例如没有full_name 的哥布林头上只是显示"哥布林”， 有full_name的就是“哥布林(full_name)”
野怪头上要显示等级和entity_type和full_name

---

# 墙体碰撞（tile 级）

> 修正上面第 100 行的说法：判定"能不能走"的属性**不叫 `obstacles`，叫 `blocked`**，
> 且它不在 Tiled 地图里，而在 **tileset 资源** `compiled_dawnlike.json` 的每个 tile 上。

## 机制（对齐 Rotten-Soup 的 `Tile.blocked()`）

1. `compiled_dawnlike.json` → `tiles[].properties`，其中：
   - `blocked: true` → 不可通行（1573 个 tile）
   - `blocks_vision: true` → 挡视线 / 挡箭（398 个 tile）
   - 没写 `blocked` 的 tile **默认可通行**（地板、草地、水面都属此类）
2. 全部 `tilelayer` 逐格取 `gid` → `id = gid - 1` → 查属性 → 叠成 `cols×rows` 的 `Uint8Array`。
   任一层标 `blocked` 即整格不可走（多层叠加取"或"）。
3. 移动时分轴求解：X 轴被挡就只丢 X、Z 轴继续 → 撞墙可沿墙滑行。
4. 出生点必须落在**主连通域**里，且离切图用的 portal ≥ 3 米（见下）。

实现：`vue/src/collision.ts`，接到 `vue/src/App.vue` 的 `localTick()` 玩家位移之后。

## 各地图阻挡占比（实测，共 23 张）

| 地图 | 格子 | 阻挡 | 占比 | 挡视线 |
|---|---|---|---|---|
| mulberryTown / overworld | 43×56 | 856 | 35.5% | 327 |
| mulberryForest | 60×40 | 1345 | 56.0% | 29 |
| mulberryGraveyard | 45×29 | 712 | 54.6% | 63 |
| lichLair | 12×12 | 63 | 43.8% | 44 |
| lootGoblinLair | 33×28 | 569 | 61.6% | 541 |
| taintedForest | 50×50 | 1633 | 65.3% | 0 |
| kingdom | 40×40 | 148 | 9.3% | 71 |
| mulberry/forest Dungeon 1~5 | 31×23 ~ 39×27 | 274~454 | 37~43% | 同阻挡 |
| oldForest / oldGraveyard / oldlichBoss / lichBoss / orcCastle | — | 91~1689 | 35~47% | — |

## ⚠️ 出生点必须做「连通域 + portal 净空」双重校验

落点策略的唯一实现在 `collision.ts` 的 `pickSpawn()`，`App.vue` 的 `switchLevel` 与
开局 `onMounted` 都调它（避免两处规则漂移）。

**规则（按优先级）**

| # | 条件 | 结果 |
|---|---|---|
| ① | 原坐标吸附格中心后在主连通域 **且** 离 portal ≥ 3 米 | 原样使用（`relocated:false`） |
| ② | 主连通域内离原坐标最近、且离 portal ≥ 3 米的站得下格 | 挪过去 |
| ③ | 净空无解（极小图）→ 只保连通域 | 挪过去 + `console.warn` |
| ④ | 网格全是墙 | 保持原位，靠 `resolveMove` 的自解困放行 |

**为什么必须做连通域校验**
- `switchLevel` 一贯把玩家重置到**地图中心 (0,0)**，但
  **mulberryForest / oldForest / oldGraveyard 的中心格本身就是墙**。
- 更隐蔽的是：只挪到"最近的可走格"不够 —— mulberryForest 中心旁有一块
  **仅 4 格的封闭小口袋**，玩家进图后能动却永远走不出去
  （离线仿真：6000 tick 随机游走只经过 4 格）。

**为什么必须做 portal 净空（3 米）**
- 切图触发半径是 **2.5 米**（`localTick` 里 portal 判定）。
- 但地图作者标注的 `PLAYER` 在这些图里**离切图点只有 1.00 米**：
  `lichLair`、`mulberryForest`、`mulberryGraveyard`（另有 `mulberryTown` / `overworld`
  标注点离 DOOR 1.00 米，但 DOOR 在本插件里不是 portal，不受影响）。
- 一旦采用标注点 → 一进图就被判进传送门 → 反复切图。**连通域校验救不了这个问题**
  （那些点确实在主连通域里）。

**双保险：切图闸门 `portalLatchPending`**

任何原因（净空无解、宿主强行摆位、玩家站着不动）导致落点仍在触发圈内时，
切图后闸门会锁住 portal 判定，**必须先走出所有触发圈才重新武装**，
从机制上排除无限切图的可能。

**坐标必须先吸附到格中心**：Tiled 换算公式 `obj.x/32 - W/2` 给的是格**左边界**
（portal 还多减 1 行），不吸附会让玩家半身压在隔壁格上，出生即判定失败。

**实测（23 张图离线仿真）**

```
地图                  落点             净空m    标注PLAYER净空m
lichLair           (0.5, 0.5)       4.30     1.00  ←若用它就会反复切图
mulberryForest     (-3.5, 4.5)      26.50    1.00  ←若用它就会反复切图
mulberryGraveyard  (0.0, 0.0)       13.51    1.00  ←若用它就会反复切图
mulberryTown       (0.0, 0.5)       13.51    3.16
overworld          (0.0, 0.5)       13.51    3.16
其余 18 张           原坐标即可       4.30~∞    —
→ 硬性违例 0 例、净空未达标 0 例
```

## 与 Rotten-Soup 的差异

| 项 | Rotten-Soup | 本插件 |
|---|---|---|
| 坐标 | 整数格 + 回合制 | 连续米坐标 + 实时 tick |
| 挡不挡 | `tryMove` 返回 false，该回合不动 | 分轴求解，可沿墙滑行 |
| actor 碰撞 | `tryMove` 里遍历 `tile.actors`（撞人＝攻击、撞门＝开门） | 未做（敌人位姿由宿主驱动） |
| 属性类型 | 直接 `some(o => o.blocked)`，字符串 `"false"` 会被误判成墙 | 入口统一 `toBool()` 归一 |
| 卡墙兜底 | 无（格子制不会半格卡住） | 起点在墙里则放行移动（自解困） |
| 出生点 | `changeLevels` 直接把玩家放到目标地图的配对传送门 | 落到主连通域 + 离 portal ≥3 米（避免"进门即反切"） |
| 切图触发 | 踩到 LEVEL_TRANSITION 格即切 | 距离 <2.5 米即切 + `portalLatchPending` 闸门防连切 |

## 离线仿真（怎么验的）

`collision.ts` 是纯函数模块，不依赖 Vue / DOM，所以可以脱离浏览器直接跑：
用 esbuild 把 `src/collision.ts` 打成 ESM（桩掉 `./assets` 与 `fetch`），
在 Node 里对 23 张真实地图做四项校验：

| 项 | 内容 | 结果 |
|---|---|---|
| A | tileset 属性解析 vs 独立 Python/JS 基线 | `blocked=1573 / vision=398` ✅ 一致 |
| B | `pickSpawn` 落点：站得下 + 在主连通域 + 离 portal ≥2.5 米 | 23/23 通过，硬性违例 0 |
| C | 每图 6000 tick 随机走（0.3 米/帧 + `resolveMove`） | 进墙 0 次、被困 0 例 |
| D | `resolveMove` 单元：撞墙停住 / 贴墙滑行 / 自解困放行 / 空地正常位 | 0 例异常 |

## 未做（可选后续）

- **野怪碰撞**：敌人位姿由宿主推进（`entry.ts` 的 tick + `mockHost.ts` 的追击），
  两处都没有碰撞。要加需要同时改 `entry.ts` / `entry.js`（双份维护）与 `vue/src/mockHost.ts`。
- **视野遮挡**：`blocks_vision` 网格已随 `WalkGrid` 一起产出（`isVisionBlockedCell`），
  但渲染层还没用它做迷雾，目前只实现了"能走/不能走"。
- **点击寻路绕行**：现在 `moveTo` 撞墙连续 3 tick 就放弃，没有 A\* 绕路。
