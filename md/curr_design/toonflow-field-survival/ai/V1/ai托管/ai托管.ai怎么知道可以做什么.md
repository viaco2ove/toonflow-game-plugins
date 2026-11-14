# AI 托管：角色怎么知道自己能做什么

> 问题：AI 托管一个角色后，这个角色（的大脑 LLM）怎么知道自己**能做什么**？
> 答案一句话：**能力不是"知道"出来的，是"注册 + 派生"出来的** —— 宿主（entry.ts）注册它真正会执行的动作，感知层（sensor）从游戏状态派生出"此刻用得了的具体参数"，大脑 prompt 里只出现**真实可执行**的能力清单。

---

## 1. 现状：代码里"能做什么"的四条通道（实证）

| # | 通道 | 文件 | 内容 | 性质 |
|---|------|------|------|------|
| ① | LLM prompt 尾部一行字 | `ai/brain.ts` buildUserPrompt | `可用动作类型：move, attack, gather, interact, useSkill, useItem, flee, wait, follow` | **硬编码字符串** |
| ② | 前端执行器 switch | `ai/spine.ts` executeAction | 同样 9 种动作的 case 分支 | 硬编码 |
| ③ | 宿主命令处理器 | `entry.ts` case "ai_command" | move / attack / stop / _mark_managed / stopMove / gather / interact / useSkill / useItem（+ 缺 useItem 前的校验） | **真正的权威** |
| ④ | #ai 快速通道关键词 | `ai/chatCommand.ts` KEYWORD_RULES | 木材/药草/钓鱼/采矿/攻击/跟随/治疗/闲逛/护送/去某地/逃跑/等待 12 组正则 | 硬编码 |

另外两条**数据派生**通道（这是做对了的部分）：

- **地图知识** `ai/mapKnowledge.ts`：从 eventEngine 的 eventZones + events.json 派生"本图能采什么"（herb/fish/wood/ore），优先级 = 地图集显式声明 `trigger.ai.gather` → 事件 id 推断 → zone 名推断。
- **自身状态** `ai/sensor.ts`：从 entity + state 派生 HP/MP/技能列表（含 CD）/背包（队伍背包 + `_aiBag` 私藏合并）。

### 角色感知的完整清单（sensor.ts 每次决策前实时收集）

```
self:      HP/MP/等级/攻击/防御/位置/背包/技能(含CD)/buff
nearby:    13米内 敌人/友方/NPC（按距离排序）
resources: 26米内 可采集 zone（来自地图集声明）
world:     当前地图/时间
```

## 2. 现状的三个结构性问题

### 问题 ①：能力清单是"抄"的，不是"查"的

prompt 里那行 `可用动作类型：move, attack, ...` 是手写字符串。宿主加了新动作（比如未来的"换图"），prompt 不会自动更新；宿主删了动作，prompt 还在骗 LLM。**三处硬编码必须人工保持同步**（brain.ts 的字符串、spine.ts 的 switch、entry.ts 的 case）——已经出现过裂缝：spine.ts 有 `follow`，entry.ts 的 ai_command **没有** follow 分支（它被前端翻译成 move 实现，属于隐性契约）。

### 问题 ②：LLM 看到的能力和角色实际能力是脱节的

- prompt 给的是**抽象动作名**，没有参数约束。LLM 可能输出 `{"type":"useSkill","skillName":"火球术"}`，但角色技能列表里根本没有"火球术"——宿主返回 `技能「火球术」不可用`，一次决策浪费。
- `skills` 感知来自 `state.skills`（**队伍技能栏**），不是角色自己的技能。ally 角色若未来有独立技能表，大脑现在无从得知。
- useItem 要求 itemName，但 prompt 没告诉 LLM「背包里实际有哪些药」→ 已在 system prompt 里给了背包列表，算部分解决，但动作与参数之间没有**绑定关系声明**。

### 问题 ③：紧急覆盖和兜底决策不了解"角色差异化"

`checkEmergency`（sensor.ts）和 `fallbackDecision`（brain.ts）对所有角色用一套阈值：<15% 撤退、<30% 找药、没蓝等待。角色性格（personality，如"谨慎型"）只进了 prompt，**不影响**程序化决策——谨慎型坦克和莽撞型法师在血量 20% 时行为完全相同。

---

## 3. 目标设计：能力清单（Capability Manifest）

核心思想：**能力不是描述给 LLM 听的，是注册进系统、由系统查出来给 LLM 的。**

### 3.1 能力注册表（单一事实来源）

新建 `ai/capabilities.ts`，每个能力是一条**自描述**记录：

```typescript
export interface Capability {
  id: "attack" | "gather" | "useSkill" | ...;
  /** 中文名，进 prompt 用 */
  label: string;
  /** 动作参数 schema（给 LLM 看：需要什么、什么类型） */
  params: Array<{
    name: string;
    type: "entity" | "zone" | "skill" | "item" | "point" | "none";
    required: boolean;
    /** 该参数当前的可选值（运行时从感知层注入） */
    options?: string[];
    hint?: string;
  }>;
  /** 宿主是否真的实现了这个 action（与 entry.ts 对齐） */
  hostSupported: boolean;
  /** 决策要求（进 prompt 的"使用时机"） */
  usage: string;
}
```

`hostSupported` 字段是**关键**：它由宿主（entry.ts）回报的能力表反查，**宿主没实现的动作不会出现在 prompt 里**。这样问题①从根上消失——不再有"抄一份字符串"。

### 3.2 运行时能力集 = 注册表 ∩ 本角色当前可用的

大脑每次决策前，**动态求交集**：

```
可用能力 = 注册表(全部能力)
         ∩ 宿主支持(hostSupported)          ← 宿主说能做才信
         ∩ 角色有权使用(rolePolicy)           ← 角色卡/剧情设定
         ∩ 此刻有目标(targetAvailable)        ← 此刻真的有敌人/zone/技能/药
```

举例：
- 没有敌人在场 → `attack` 不进 prompt（避免 LLM 空打）
- 背包里没有药 → `useItem` 不进 prompt
- 技能全在 CD → `useSkill` 不进 prompt（或者说"技能在冷却"）
- 角色是"守卫型"（不允许主动采集）→ `gather` 不进 prompt

这解决了问题②：LLM 看到的每一条能力，**此刻都能真的执行**，且参数取值明确。

### 3.3 Prompt 里的能力段落长这样

```markdown
## 当前可用能力

| 能力 | 参数 | 何时用 |
|------|------|--------|
| attack | target: 敌人 id/名字 | 附近有敌人时 |
| gather | zone: 农田 | 当前无威胁且背包未满 |
| useSkill | skill: 冲斩(10MP) / 怒吼(20MP) | 战斗中有目标 |
| useItem | item: 生命药水×2 | 血量低于 40% |
| follow | - | 玩家在 5 米外 |
| wait | duration(ms) | 无事可做 |
```

（不可用的能力**不出现**，而不是列出来再让 LLM 猜能不能用。）

### 3.4 角色差异化：能力策略（Policy）

把"性格"从 prompt 文字升级为**策略参数**：

```typescript
interface RolePolicy {
  /** 血量低于此值才撤退（莽撞型=10，谨慎型=35） */
  fleeHpThreshold: number;
  /** 是否允许主动采集 */
  allowGather: boolean;
  /** 是否允许离开玩家多远 */
  maxLeash: number;
  /** 偏好：战斗 / 采集 / 跟随（影响兜底决策排序） */
  preference: "combat" | "gather" | "escort";
}
```

`checkEmergency` 与 `fallbackDecision` 读 policy 而非硬编码阈值 → 问题③解决。

### 3.5 落地路径

| 阶段 | 内容 | 改动面 |
|------|------|--------|
| P0 | 抽 `ai/capabilities.ts` 单一注册表；brain.ts 的 prompt 改为**从注册表生成**（不再手写字符串）；spine.ts / entry.ts 各加一处**一致性自检**（注册表里 hostSupported 的动作，宿主 case 必须存在，否则启动时 warn） | 纯前端，不改宿主 |
| P1 | 感知层补 `availableTargets`（敌人/zone/技能/物品的当前候选），prompt 能力表用真实取值填充；无目标的能力自动隐藏 | 改 sensor.ts + brain.ts |
| P2 | 引入 `RolePolicy`（角色卡新增字段或由 personality 映射），紧急阈值与兜底决策读 policy | 改 sensor.ts + brain.ts + 角色卡 |
| P3 | 宿主回报真实能力表（`ai_command` 之外加一个 `ai_capabilities` 查询），`hostSupported` 改为运行时查询而非静态标记 | 改 entry.ts + entry.js |

P0 就能消灭"抄字符串"这个最大隐患，且不动宿主。

---

## 4. 一句话总结

> **能力清单是注册出来的，不是提示出来的。**
>
> 宿主注册它会做的动作 → 能力注册表登记这些动作及其参数 → 感知层注入此刻可用的具体参数和候选目标 → 大脑 prompt 里只出现"此刻真的能执行"的能力 → LLM 只需要选，不需要猜。

## 5. 相关文档

- [ally 类型角色的ai 托管能力.md](../ally%20类型角色的ai%20托管能力.md) — 托管能力整体设计（三层神经架构、触发时机、prompt 设计）
- [ai托管.插件.行为list.md](./ai托管.插件.行为list.md) — 插件行为清单
- 代码：`vue/src/ai/{types,brain,sensor,spine,mapKnowledge,chatCommand}.ts`、宿主 `entry.ts` case "ai_command"
