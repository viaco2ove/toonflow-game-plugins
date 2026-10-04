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
NPC：NPC（村民、酒馆老板、矮人等，wanders=true 是闲逛 NPC）
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
| actor 碰撞 | `tryMove` 里遍历 `tile.actors`（撞人＝攻击、撞门＝开门） | 只做**地形**碰撞（撞人不做伤害结算） |
| 属性类型 | 直接 `some(o => o.blocked)`，字符串 `"false"` 会被误判成墙 | 入口统一 `toBool()` 归一 |
| 卡墙兜底 | 无（格子制不会半格卡住） | 起点在墙里则放行移动（自解困） |
| 出生点 | `changeLevels` 直接把玩家放到目标地图的配对传送门 | 落到主连通域 + 离 portal ≥3 米（避免"进门即反切"） |
| 切图触发 | 踩到 LEVEL_TRANSITION 格即切 | 距离 <2.5 米即切 + `portalLatchPending` 闸门防连切 |
| 寻路 | `ROT.Path.AStar`，绕墙 | 同源 A\*，另做视线拉直 + 禁斜穿墙角 + 目标吸附 |
| 视野 | `Tile.visible()` + ROT（`Game.js` 用 Precise、`Player.js` 用 Recursive，混写同一份 `visible_tiles`） | ROT `RecursiveShadowcasting`（逐格对拍 0 差异）+ 三态迷雾 |
| 野怪挡路 | `tryMove` 撞到 actor 即攻击/开门 | 宿主侧局部避障（`navStep`）+ 前端 `applyEnemyCollision` 纠偏 |

## 离线仿真（怎么验的）

`collision.ts` 是纯函数模块，不依赖 Vue / DOM，所以可以脱离浏览器直接跑：
用 esbuild 把 `src/collision.ts` 打成 ESM（桩掉 `./assets` 与 `fetch`），
在 Node 里对 23 张真实地图做全套校验：

| 项 | 内容 | 结果 |
|---|---|---|
| A | tileset 属性解析 vs 独立基线 | `blocked=1573 / vision=398` ✅ 一致 |
| B | `pickSpawn` 落点：站得下 + 主连通域 + 离 portal ≥3 米 | 23/23，违例 0 |
| C | `WalkGridPacket` encode/decode 往返 + 坏包防御 | 23/23 字节级一致；空包/长度不符一律拒收 |
| D | A\* 寻路：路点合法性 + 路径真能走通 + 无解判定 | 抽样 276 次，有解 269、走不通 0 |
| E | FOV：自身格可见 + 5 米内不发黑 + 连线采样 | 通过 |
| F | `stepWithAvoidance`：每步都不得进墙 | 38 475 步，进墙 0 例 |
| **G** | **与 ROT 官方 `RecursiveShadowcasting` 逐格对拍** | **30 759 格，差异 0** ✅ |
| H | 每图 6000 tick 随机游走（`resolveMove`，0.3 米/帧） | 进墙 0 次、被困 0 例 |

### G 项：FOV 的黄金标准对拍

FOV 不靠"自己写的采样判据"验收 —— 那玩意儿有量化误差（`metersToCell` 的 floor 取格
会把"光沿格角擦过"误记成穿墙，实测假阳性 ~0.8%）。做法是直接加载 Rotten-Soup 自带的
`legacy/v2/assets/js/rot.js`（ROT v0.7~dev），用同一份 `vision` 位图跑官方实现，
逐格比对：

```
=== 对拍 RecursiveShadowcasting ===
  比对 30759 格：不一致 0 格（我们多标 0、ROT 多标 0）
  ✅ 与 ROT 官方 RecursiveShadowcasting 完全一致
```

> **选 Recursive 而不是 Precise 的原因**：Rotten-Soup 两个都用了，但写的是**同一份**
> `map.visible_tiles` —— `Game.js`（关卡加载）用 Precise，`Player.js`（**每回合**）用
> Recursive。逐回合的玩家视野走的是 Recursive，所以对齐它。两者本身差 2.763%
> （Precise 看得到更多），且我们对 Precise 同样是**只少不多**（`onlyOurs = 0`），
> 即无论如何都不会让玩家透视墙壁。

## 已补：敌人碰撞 / 战争迷雾 / 点击寻路 / 光标特效

### 1. 敌人碰撞（宿主侧也拦墙）

难点：**敌人位姿由宿主推进**（`entry.ts` 真实宿主 / `entry.js` JS 兜底 / `mockHost.ts` 独立模式），
而 tileset 属性表与地图 JSON 只在 iframe 侧解析过。

方案不是让宿主各写一份解析（三份代码、三处漂移），而是 **iframe 把走位网格压成位图随 tick 上报一次**：

| | |
|---|---|
| 体积 | 60×40 图 = 2400 字节/层 → base64 后 1.9 KB（两层） |
| 时机 | 建网格时按 `walkGridEpochSeq` 自增世代号，**每张图只发一次**，稳态零开销 |
| 世代号 | 用自增序号而非关卡名 —— 否则 A→B→A 会被误判成"同世代"而漏发 |
| 坏包 | `decodeWalkGridPacket` 对 `null` / 空对象 / 长度不符一律返回 `null`，宿主保留上一份网格 |

宿主拿到网格后，敌人的每步位移走 `navStep`（= `collision.ts:stepWithAvoidance` 的内联镜像）：
按"与期望方向点积"排序 8 个候选方向、过滤 `dot > -0.35`（不往回走）、
逐个试到能站得下为止，全被挡则退化为**分轴滑行**贴墙蹭出去。
**不给敌人上 A\*** —— 60 只怪每 tick 一次 A\* 的开销不可接受，而局部避障是恒定 O(8)。

另加两道兜底：`snapEnemySpawn`（刷怪点压在墙上时环状 BFS 找最近可站格）与
每 tick 一次的 `unstickEnemies`（被宿主强行摆进墙的怪拉回来）。

> ⚠️ 宿主侧是 **inline 镜像**（`entry.ts` / `entry.js` 各一份，无 import）。
> 宿主加载器**不保证支持 import**，一旦加了跨目录 import 会让整个插件加载失败，
> 所以宁可承担三处同步的代价。改避障逻辑时**这三个文件要一起改**。

### 2. 战争迷雾（`blocks_vision` FOV）

| 项 | 做法 |
|---|---|
| 算法 | ROT `RecursiveShadowcasting`（理由见上），8 octant 递归投影 |
| 阻塞源 | `g.vision` 位图 —— 与 Rotten-Soup 的 `Tile.visible()` 同源（tileset 的 `blocks_vision`） |
| 半径 | 13 米（`FOV_RADIUS_M`；内部按 ROT 惯例 +1 传出） |
| 三态 | 未探索（纯黑 α255）/ 已探索但当前不可见（半暗 α168）/ 可见（透明） |
| 性能 | 只在**玩家跨格**时重算 FOV 并重绘 1px/格 的离屏 canvas；每帧只做一次 `drawImage` |
| 实体裁剪 | 渲染层按 `isVisibleAt()` 过滤 —— 看不见的怪不画（含小地图圆点） |
| 开关 | HUD 上的「迷雾」勾选框，状态存 `localStorage.fs_fog`，HUD 显示已探索百分比 |

> ⚠️ 移植 ROT 时的两个坑（都会表现为**光贴着厚墙表面渗透进墙后空地**）：
> ① 进入遮挡时**不能**改 `start`，只能记「最后遮挡斜率」，恢复通畅时才用它收紧；
> ② 行末若仍处于遮挡，**必须 `break` 终止整个 octant**。
> 现象：玩家 (16,14) 左侧一道 9 格厚墙，墙后的 (5,13)/(5,14) 被点亮。

### 3. 点击寻路（A\* 绕墙）

旧的 `moveTo` 是"朝目标直走、连续 3 tick 撞墙就放弃"。现在是：

1. 点击 → `findPath` 在**站得下掩码**上跑 A\*（octile 启发 + 二叉堆 + `closed`/`gScore`/`cameFrom` 定型数组）；
2. **禁止斜穿墙角**（两条正交边都可走才允许斜走）—— 玩家位移是分轴求解的，允许斜穿会给出走不出来的路径；
3. `simplifyPath` 做视线拉直（string pulling）压掉冗余路点；
4. 只对**离墙 0.4 米以上**的格做拉直，避免贴墙路径被"拉"进墙角；
5. 目标格站不下（点到墙上）→自动换成主连通域内最近的可站格；
6. 路径确实无解时才回退到直线直走，并沿用 `moveToUnreachable` 标记，3-tick 放弃逻辑只在这条路上生效。

实测 D 项：抽样 276 次，有解 269 次、**"直线被墙挡但 A\* 仍走到了" 204 次** ——
这 204 次正是旧实现会直接放弃的场景。

### 4. 光标与点击特效

- 舞台光标改为**手指**（`.stage` / `.stage-rotate` 的 `cursor: pointer`，`touch-action: manipulation`）。
- 点击地面立即反馈 `ClickFx`（36 帧）：
  - 落点扩散涟漪 —— **可达=绿**、**不可达=红 + 叉**；
  - 目标处脉冲标记；
  - 可达时叠加一条 A\* 虚线路径预览。

