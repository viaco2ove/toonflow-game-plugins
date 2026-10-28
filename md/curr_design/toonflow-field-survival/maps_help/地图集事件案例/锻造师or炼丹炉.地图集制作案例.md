# 锻造师 or 炼丹炉 · 地图集制作案例

> **一句话**：走近锻造大师/炼丹炉 → 弹「🔨 锻造」/「🔥 炼丹」按钮 → 点击打开**多标签面板**
> （售卖 / 打造 / 升级 / 溶解），货单是你**地图集自己的 `data/shop.*.json`**，插件只负责面板与落账。
>
> 前置：[触发性事件.靠近目标](触发性事件.靠近目标.地图集制作案例.md)（proximity 按钮怎么来）。
> 接口：[../API文档.md](../API文档.md) §2.5 / §2.7；硬约束：[../规范.md](../规范.md)「严重违规事项」。

---

## 0. 面板长什么样

| 面板 | 标签页 | 每页干什么 |
|------|--------|-----------|
| `mode: "forge"`（锻造） | 🛒 物品售卖 / 🔨 物品打造 / ⬆ 升级物品 / 🧪 溶解物品 | 买货 → AI 打造新装备 → 花材料升级 → 拆装备返还材料 |
| `mode: "alchemy"`（炼丹） | 🛒 物品售卖 / 🔥 开始炼丹 / 🧪 溶解丹药 | 买货 → AI 炼丹 → 拆丹药返还草药 |

售卖页再按**物品类型**分「子标签页」（顺序固定，`全部` 在最前）：

- 锻造：`全部 / 材料 / 武器 / 防具 / 饰品 / 图纸 / 技能 / 特殊`
- 炼丹：`全部 / 药草 / 辅料 / 材料 / 丹药 / 药方 / 器具 / 套装`

子标签由商品字段 `cat` 决定；`cat` 不在上面清单里 → 落到末尾「其他」分组（说明数据有问题）。

---

## 1. 一共要准备四样东西

```
① 地图 Actors 层  放对象（锻造大师 uid=256 / 炼丹炉 uid=257），设 gid 外观
② 事件 JSON      proximity(uid) → run_script
③ TS 脚本        读 data/shop.*.json → ctx.ui.openShopPanel({mode, tab, goods})
④ 货单数据       <故事>/data/shop.forge.json、shop.alchemy.json   ★ 属于地图集，不属于插件
```

**为什么货单不能写进插件**：插件是全故事共用的。把「通天传授」的 149 件商品硬编码进插件，
会让赦夜人/黑塔的玩家也看到铁剑图纸和九转回魂丹——这正是 [../规范.md](../规范.md) 点名的严重违规。

---

## 2. 第四样：货单 `data/shop.*.json`

位置：`workshops/toonflow-field-survival/map_design/<故事名>/data/`

```
data/
├── shop.forge.json      # 锻造大师的货
└── shop.alchemy.json    # 炼丹炉的货
```

### 2.1 文件结构

```json
{
  "version": 1,
  "title": "锻造大师 · 物品售卖",
  "from": "forge_master",
  "source": "物品售卖.list.md",
  "note": "由 vue/scripts/gen-shop-goods.mjs 生成，别手改",
  "goods": [ /* 见下 */ ]
}
```

> 也接受裸数组 `[ {...}, {...} ]`（脚本两种都认）。带外层对象更清楚，推荐用这种。

### 2.2 单件商品字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 全货单唯一，购买时靠它定位 |
| `name` | ✅ | 物品名（进背包就用这个名字） |
| `price` | ✅ | 单价（金）；`price ≤ 0` 会被后端拒绝 |
| `kind` | ✅ | `consumable` / `material` / `equipment` / `skill_book` / `quest` |
| `rarity` | ✅ | `common` / `fine` / `rare` / `epic` / `legend`（决定名字颜色） |
| `cat` | ★ | **售卖子标签分类**，见 2.3。不写会走关键词兜底猜，猜错就归「其他」 |
| `heal` | | 恢复量（丹药/食物） |
| `desc` | | 描述（售卖页副标题、搜索也搜它） |
| `from` | | 货源标记（`forge_master` / `alchemy_furnace`），只做展示与排查 |

实物（`通天传授-收徒系统/data/shop.forge.json` 第 1 件）：

```json
{ "id": "ore_copper", "name": "铜矿石", "price": 8,
  "kind": "material", "rarity": "common", "heal": 0,
  "desc": "常见的铜矿原石，可冶炼为铜锭",
  "from": "forge_master", "cat": "材料" }
```

### 2.3 `cat` 取值（写错就归「其他」）

| 面板 | 合法 `cat` |
|------|-----------|
| 锻造 | `材料` `武器` `防具` `饰品` `图纸` `技能` `特殊` |
| 炼丹 | `药草` `辅料` `材料` `丹药` `药方` `器具` `套装` |

现有货单分布（可作规模参考）：锻造 149 件 = 材料 42 / 武器 33 / 防具 29 / 饰品 19 / 特殊 10 / 图纸 8 / 技能 8；
炼丹 163 件 = 药草 37 / 丹药 53 / 辅料 20 / 材料 15 / 药方 18 / 器具 15 / 套装 5。

### 2.4 货单从哪来

**A. 有设计文档（推荐）**：把商品写成 markdown 表格，用生成器转成 JSON：

```bash
cd plugins/toonflow-field-survival/vue && node scripts/gen-shop-goods.mjs
# 读：map_design_pre/通天传授-收徒系统/events/实体交互/物品售卖.list.md、物品售卖.炼丹.list.md
# 写：map_design/通天传授-收徒系统/data/shop.forge.json、shop.alchemy.json
```

生成器按文档 `##/###` 章节标题推导 `cat`（「## 五、武器」→ `武器`；「### 刀类」→ 仍归 `武器`）。
⚠️ 生成器当前把故事名与文档路径**写死在脚本里**，只服务这一套文档；
其他地图集请走 B，或复制脚本改路径（脚本是构建期工具，不进运行时产物）。

**B. 手写 JSON**：照 2.1/2.2 写就行，注意 `cat` 必须落在 2.3 的清单里。

**C. 改现有货单**：改设计文档 md → 重跑生成器 → **重建 `.tbg`**。
直接手改 `data/shop.*.json` 下次跑生成器就被覆盖（[../规范.md](../规范.md) §9 禁止项）。

---

## 3. 第二、三步：事件 + 脚本

### 3.1 事件（两条，uid 不同）

`events/maps/mulberryTown.events.json`：

```json
{ "id": "E50_forge_master", "comment": "走近锻造大师：走进即弹「锻造」按钮",
  "trigger": { "type": "proximity", "uid": "256", "radius": 2.8 },
  "proximity": { "label": "锻造", "icon": "🔨", "hint": "走近锻造大师" },
  "repeat": true,
  "actions": [{ "type": "run_script", "script": "E50_forge_master" }] }

{ "id": "E60_alchemy_furnace", "comment": "走近炼丹炉：走进即弹「炼丹」按钮",
  "trigger": { "type": "proximity", "uid": "257", "radius": 2.8 },
  "proximity": { "label": "炼丹", "icon": "🔥", "hint": "走近炼丹炉" },
  "repeat": true,
  "actions": [{ "type": "run_script", "script": "E60_alchemy_furnace" }] }
```

### 3.2 脚本（整份照抄，只改路径与 mode）

`events/scripts/E50_forge_master.ts`：

```ts
import type { Ctx, ShopGood } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const raw = await ctx.story.readJson<{ goods?: ShopGood[] } | ShopGood[]>("data/shop.forge.json");
  const goods: ShopGood[] = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
  if (!goods.length) {
    ctx.ui.toast("锻造大师的货架空了：故事包缺少 data/shop.forge.json", "red");
  }
  ctx.ui.openShopPanel({ mode: "forge", tab: "sell", goods });
  ctx.ui.event(`打开锻造面板（${goods.length} 件商品）`);
}
```

`E60_alchemy_furnace.ts` 只改三处：`data/shop.alchemy.json`、`mode: "alchemy"`、文案。

`tab` 可指定初始页：`"sell"`（售卖）/ `"craft"`（锻造打造）/ `"alchemy"`（炼丹）/ `"upgrade"` / `"dissolve"`。

> 脚本只做两件事：**读货单** + **开面板**。打造/升级/溶解的逻辑都在插件的
> `forgeOps.ts`（前端通用能力）+ 后端 `sys_*` 命令里，地图集不需要重写。

---

## 4. 面板每一页点下去会发生什么（排查用）

| 页 | 玩家操作 | 内部链路 | 玩家看到 |
|----|----------|----------|----------|
| 🛒 售卖 | 点子标签 → 点「购买」 | `sendSysCmdAwait("sys_shop_buy", {id, count, good})`，`good` 是**这一件商品原样带上去**（插件没有权威副本） | 模态弹窗「✅ 购买成功 · 获得「X」×1 · 花费 N 金 · 余额 M 金」；钱不够 → 「💰 金钱不足」 |
| 🔨 打造 | 输入名字 / 随机 / 选图纸 | 本地先查 `money ≥ 10` → `ctx.ai.generate("field-survival-forge-item", prompt)` → `sys_forge_create {input, aiJson, blueprint}` | 弹窗「🔨 锻造成功 · 获得「X」（品质）· 攻击/防御/耐久 · 已消耗图纸 · 花费 10 金」 |
| ⬆ 升级 | 选背包里的装备 | 校验 `铁矿石×2Lv`、`灵石碎屑×⌊Lv/3⌋`、`20×新等级` 金 → AI 生成新属性 → `sys_item_upgrade {oldName, cost, aiJson}` | 确认框 → 弹窗「⬆ 升级成功 Lv1→Lv2 + 属性 + 消耗清单」 |
| 🧪 溶解 | 选装备/丹药 | 确认框 → `sys_item_dissolve {name, rarity, lv, heal, isPill}`，按品质×等级返还 | 弹窗「⚒ 溶解完成 · 返还 铁矿石×N、灵石碎屑×M」 |
| 🔥 炼丹 | 输入 / 随机 / 选药方 | 同打造，命令换成 `sys_alchemy_create` | 弹窗「🔥 炼丹成功 · 丹药名/品质/恢复量」 |

**要点**：所有成功/失败都是**模态弹窗**（必须点「知道了」），不是右下角飘字——
花钱的操作不能糊弄过去。失败原因（金钱不足 / 材料不足 / 商品不存在）由后端返回文本决定。

---

## 5. 图纸 / 药方机制（最容易踩的一块）

图纸是**消耗品**，用图纸打造产出的必须是**图纸记载的成品**：

| 图纸名 | 产物 |
|--------|------|
| 铁剑图纸 | 铁剑 |
| 精钢甲图纸 | 精钢甲 |
| 明月剑铸造秘法 | 明月剑 |
| 龙鳞甲编缀图 | 龙鳞甲 |
| 九转回魂丹配方 | 九转回魂丹 |
| 随机丹方残卷 | （不指定，AI 自由发挥） |

规则：剥掉载体后缀（`图纸/图谱/编缀图/总纲/拓本/残卷/秘法/秘方/配方/丹方/药方/…`），
剥完只剩「随机/上古/未知/残缺/…」这类无指代词 → 视为没写明产物。

**三道保险**（都已实现，你只要不自己再扣一次）：
1. 前端选择弹窗里直接标「→ 制作「铁剑」」，选之前就知道做什么；
2. 提示词追加【按图纸制造】约束；AI 若仍返回图纸名，前后端都会纠正成成品；
3. **图纸只由后端扣 1 张**（`sys_forge_create` / `sys_alchemy_create` 的 `blueprint` 参数）。
   ⚠️ 不要在脚本里再 `ctx.bag.remove` 一次——会变成一张图纸打两次（实测 2 张 → 直接归零）。

---

## 6. 想加第二个锻造师（卖不同货）

不用改插件，复制三样：

1. 地图里再放一个对象（新 uid，例如 300），`entity_type: "NPC"`；
2. 事件加一条 `proximity(uid=300)`，`label` 改成「铁匠」之类；
3. 脚本复制一份改数据路径：`ctx.story.readJson("data/shop.blacksmith.json")`；
4. 新写一份 `data/shop.blacksmith.json`（同样 schema，`from` 可写 `blacksmith`）。

同理可以做「只卖不打造」的商人：`openShopPanel({ mode: "forge", tab: "sell", goods })`
——玩家可以自己点到「打造」页，若要限制就得用自己的脚本 + `ctx.ui.select` 做简易商店（不推荐，除非确实需要）。

---

## 7. 坑表

| 现象 | 原因 / 解法 |
|------|-------------|
| 面板能开，货架空的 | ① `data/shop.*.json` 不存在；② 脚本没把 `goods` 传给 `openShopPanel`；③ 安装态没重建 `.tbg`（dev 能读、真机读不到就是这个） |
| 只有「全部」有货，分类页全空 | 商品缺 `cat`（或 `cat` 值不在 2.3 清单里）→ 全落到「其他」 |
| 买了弹「商品不存在」 | `sys_shop_buy` 找不到该 `id`：`good` 没随命令带上去（面板调用被改坏）或 `price ≤ 0` |
| 钱扣了东西没进包 | 后端返回被忽略：命令必须**等回执**再判定（前端已有 `sendSysCmdAwait`，别改回 fire-and-forget） |
| 打造产出「XX图纸」 | 图纸名被直接当 `input` 喂给 AI。必须用 `blueprintProduct()` 解析成品名 |
| 图纸越打越多 / 一次扣两张 | 前端也扣了一次。只保留后端扣 |
| AI 执行者点按钮没反应 | 正常：`openShopPanel` 对 AI 托管是**自动忽略**（只记日志），面板只服务玩家 |
| 改了 `data/*.json` 没生效 | `readJson` 按 path 缓存一局 → dev 刷新页面；安装态必须重建 `.tbg` |
| 分类页商品顺序乱 | 子标签顺序固定（2.3 的清单顺序），组内按货单原序；想调顺序就调货单顺序 |

---

## 8. 检查清单

```
[ ] 地图里有锻造大师/炼丹炉对象，gid 外观已设，uid 记下了
[ ] 事件 proximity 的 uid 与对象 id 一致，repeat: true，顶层 proximity{label,icon}
[ ] 脚本读 data/shop.<forge|alchemy>.json，并在 goods 为空时明确提示
[ ] openShopPanel 的 mode 与货单对得上（forge ↔ shop.forge.json）
[ ] 每件商品都有 cat，且取值在合法清单里
[ ] 没有在脚本里手动扣图纸（只由后端扣）
[ ] node .cache/validate_events.mjs <故事名> → 0 error
[ ] dev 实测：售卖页 8 个/4 个子标签都有货 → 买一件进背包 → 打造一件 → 升级 → 溶解
[ ] 图纸打造：2 张图纸打一件 → 剩 1 张，产物是成品名
[ ] data/ 改过 → 已重建 .tbg 并 -u 上传，真宿主复验
```
