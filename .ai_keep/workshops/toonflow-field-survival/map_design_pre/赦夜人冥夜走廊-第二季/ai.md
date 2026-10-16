# ai 托管器 agent（赦夜人冥夜走廊-第二季）

> 上游：`ai_分类.md` / `ai_分类_细分_地图集.md` / `ai_分类_细分_插件内含.md`
> 同目录配套：`地图事件与业务设计.md`
> 实现现状：`plugins/toonflow-field-survival/vue/src/ai/`（brain / sensor / spine / mapKnowledge / chatCommand）

---

## 1. 触发性设计：交谈命令 `#ai`

在与角色交谈时输入 `#ai xxxx`，**无论有没有勾选 AI 托管**，都主动触发一次 ai 托管器 agent 决策。

事件目录：`workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季/events`

示例（通用指令，插件已内置关键词通道）：

```
#ai 帮我去收集木材
#ai 帮我去收集药草
#ai 在周围瞎逛
#ai 攻击最近的怪
#ai 治疗自己
#ai 撤退
```

本剧专属指令（需要地图集补关键词规则或走 LLM 通道）：

```
#ai 去夜采药圃采药          → zone「夜采药圃」
#ai 护送林家商队            → interact uid 林家商队
#ai 去暮光布道点看看        → zone「暮光布道点」
#ai 离陆文昭远点            → flee（本图 hostile uid）
```

### 1.1 决策路径

1. **关键词快速通道**（`chatCommand.ts` 的 `KEYWORD_RULES`）→ 直接出 action
2. **LLM 通道**（brain + mapKnowledge 注入）→ 自然语言解析
3. **兜底**：基于感知（有敌人就打、有资源就去采、否则待命）

### 1.2 关键词规则（已实现 · 数据驱动）

`vue/src/ai/chatCommand.ts` 的采集规则**不再写死「农田 / 喷水池」**（那是通天传授的 zone 名，
赦夜人里根本没有）→ 改成从 `mapKnowledge.gatherZones` 按 `kind` 找最近的采集点。
`kind` 由本剧 `events.json` 的 `trigger.ai.gather` 声明，换地图集不用改插件。

| 关键词 | 命中 | 动作 | 本剧落点 |
|--------|------|------|---------|
| 药草 / 采药 / 药材 / 草药 / **夜采 / 药圃** | `kind=herb` 最近 zone | `gather` | 夜采药圃（桑镇）/ 林中药丛（桑林） |
| 木材 / 砍柴 / 伐木 / 柴火 / 木柴 | `kind=wood` 最近 zone | `gather` | 木材堆 |
| 钓鱼 / 捕鱼 / 鱼 | `kind=fish` 最近 zone | `gather` | 本剧无 |
| 采矿 / 挖矿 / 矿石 | `kind=ore` 最近 zone | `gather` | 本剧无 |
| 商队 / 护送 / 护卫 / **陆文昭 / 执事 / 暮光** | 场上最近的非敌对同名实体 | `interact` | 林家商队 / 林家护卫 / 陆文昭 |
| **去 XX / 到 XX / 前往 XX** | 本图 `eventZones` 里名字匹配 | `move` | 魔血洼地 / 月蚀石阵 / 暮光布道点 … |
| 闲逛 / 漫游 / 巡逻 / 瞎逛 | 随机方向 8-12m | `move` | — |
| 攻击 / 打 / 战斗 / 杀 / 清怪 | 最近敌人 | `attack` | — |
| 治疗 / 回血 / 吃药 | 背包里的药 | `useItem` | — |
| 跟随 / 跟着 | 玩家 | `follow` | — |
| 逃跑 / 撤退 / 离去 / 走开 | — | `flee` | — |
| 等等 / 别动 / 待命 | — | `wait` | — |

命中顺序：`KEYWORD_RULES` 从上到下，**「去 XX」排在逃跑之前会被「离去」误吞**，
所以 `离去` 已加进逃跑规则且逃跑规则排在前面；「去 XX」匹配不到 zone 时返回 null 继续往下走。

---

## 2. 地图集的 AI 行为设计（分类）

> 依据 `ai_分类_细分_地图集.md`：地图专用行为函数 / 地图知识与位置识别 / 地图可交互地点识别 / 触发性事件。

### 2.1 地图专用 AI 行为函数（`events/scripts/<map>_ai.ts`）

本剧专属的作息与剧本，注册给小脑：

| 行为 | 地图 | 说明 |
|------|------|------|
| 夜巡 | 桑镇 | 深夜时段 NPC 往镇口 / 布道点移动 |
| 药铺作息 | 桑镇 | 药铺老板夜里有灯，白天关门 |
| 魔血驱引 | 桑林 | 魔血鼠/石蛇向魔血洼地聚集，不追出洼地 |
| 血蝠夜行 | 乱葬岗 | 血蝠只在「月蚀」时段活跃，白天休眠 |
| 尸傀守坑 | 乱葬岗 | 黑甲尸守尸坑，离坑 20m 自动返回 |
| 陆文昭游走 | 桑镇/桑林/走廊5 | 按 phase 在不同图出现，camp 由 neutral→hostile |

### 2.2 地图知识与位置识别（`MapKnowledge`）

数据来源：`eventZones` + `events.json`（`vue/src/ai/mapKnowledge.ts` 实时派生，插件不硬编码）。

| 项 | 内容 |
|----|------|
| 可采集 zone | 夜采药圃（herb） / 木材堆（wood） / 林中药丛（herb） |
| 可交互对象 | 药铺老板、镇民、陆文昭、林家商队、林家护卫、玉简残片、灰绒兔 |
| 危险区 | 魔血洼地、尸坑、灵魂祭坛、走廊 3-5（AI 低血时不进） |
| 安全区 | 桑镇镇中心、药铺 |

### 2.3 地图可交互地点识别

- 每个 `interact` 事件的 `uid` → `interactUids`，AI 知道该找谁
- 每个 `area_enter` 事件的 `trigger.ai.gather` → 采集点声明
  - ⚠️ 未声明且推断为 `other` 的 zone 会被 `mapKnowledge` 跳过

### 2.4 触发性事件

- `#ai` 交谈指令（§1）
- 进入「魔血洼地 / 灵魂祭坛 / 凿室 / 剥皮间」→ 强制触发一次 AI 决策（危险区预警）
- phase 切换（`phase_N_done`）→ 触发 AI 重新评估目标

---

## 3. 插件内含的 AI 行为（分类，本剧复用）

> 依据 `ai_分类_细分_插件内含.md`。本剧**不新增**插件能力，只复用。

| 分类 | 现状 | 本剧使用 |
|------|------|---------|
| AI 商店 / 技能 / 物品数据解析 | 已实现 | 药铺老板买卖走这套 |
| 野怪基础攻击行为 | 已实现 | 魔血鼠 / 石蛇 / 血蝠 / 黑甲尸 |
| ally 托管-大脑（LLM） | 已实现 | 苏清漪、林家护卫可托管 |
| ally 托管-小脑和脊椎 | 已实现 | `gather` / `interact` / `attack` / `flee` / `follow` |
| 通用数据识别（名字/位置/可用动作/地图有什么） | 已实现 | `sensor` + `mapKnowledge` |

### 3.1 本剧待补的插件侧扩充（可选）

| 项 | 说明 | 状态 |
|----|------|------|
| `#ai` 采集关键词数据驱动 | 关键词 → 按 `ai.gather` 的 kind 找最近采集点，不再写死 zone 名 | ✅ 已做 |
| `#ai` 找人 / 去区域 | `商队/护卫/陆文昭` → 找最近同名实体；`去 XX` → 匹配本图 eventZones | ✅ 已做 |
| `dangerZone` 感知 | sensor 增加「本图危险区」字段，低血 AI 主动避开 | ⬜ P1 |
| `escort` 行为函数 | 护送商队：AI 保持商队 5m 内，商队移动则跟随 | ⬜ P1 |
| AI 采集冷却按 zone 配 | 每个 zone 独立冷却，避免反复刷同一点 | ⬜ P2 |

---

## 4. 采集点声明清单（本剧）

| zone | `ai.gather` | 事件 | 地图 |
|------|-------------|------|------|
| 夜采药圃 | `herb` | E02 | 桑镇 |
| 木材堆 | `wood` | E08 | 桑镇 |
| 林中药丛 | `herb` | E18 | 桑林 |

写法（`events/maps/mulberryTown.events.json`）：

```json
{
  "id": "E02_night_herb",
  "trigger": { "type": "area_enter", "zone": "夜采药圃", "ai": { "gather": "herb" } },
  "repeat": true,
  "actions": [{ "type": "run_script", "script": "E02_night_herb" }]
}
```

产出（掉什么 / 给多少 / 弹不弹确认）**永远写在地图集脚本里**；AI 到达后前端调 `triggerZoneGather(zone, actor)` 复用同一脚本，落进该角色 `_aiBag`，不污染玩家背包。
