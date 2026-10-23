# AI 托管 Agent · 用户提示词（动态感知）

> **生成方**：插件前端 `vue/src/ai/brain.ts` 的 `buildSystemPrompt()` + `buildUserPrompt()`
> **去向**：`input.userPrompt` → `messages[1]`（user 角色）
> **更新频率**：每次决策（3~15 秒一次，取决于战况）
> **对应代码**：`ai/brain.ts:136-223`

---

## 1. 分工：系统提示词管"能怎么做"，用户提示词管"现在怎么样"

系统提示词（[系统提示词文档](./ai托管.agent.系统提示词.md)）提供恒定的动作表和参数规则。用户提示词提供**这一拍的实际数据**。

用户提示词由 `brain.ts` 的两个函数拼接而成，中间用 `---` 分隔：

```
input.userPrompt = buildSystemPrompt() + "\n---\n\n" + buildUserPrompt()
                    ↑ 前半段：角色是谁、能用什么          ↑ 后半段：现在什么情况、要干什么
```

---

## 2. 前半段：角色设定（`buildSystemPrompt`）

当前代码（`brain.ts:136-169`）产出如下结构：

```
# 角色设定

你是角色【萧肿】的AI控制大脑。

## 基础信息
- 名字：萧肿
- 等级：Lv.5
- 性格特点：勇敢冲锋型，喜欢正面战斗
- 当前所在地图：mulberryTown（桑顿小镇）

## 本图知识（地图集提供）
本图可采集地点：
- 农田（herb）坐标 (42, 31)，可反复采集
- 木材堆（wood）坐标 (68, 24)，可反复采集
本图可交互对象（Tiled id）：npc_merchant_01

## 核心能力
- HP: 75/80 (94%)
- MP: 30/40 (75%)
- 攻击力: 35
- 防御力: 12

## 背包物品（队伍背包 + 私藏）
- 生命药水 ×2
- 铁剑 ×1
- 草药 ×5

## 技能列表
- 冲斩 (消耗10MP, 冷却剩余0秒)
- 怒吼 (消耗20MP, 冷却剩余12秒)

## 当前位置
- X: 13.0, Y: 25.0
- 附近可采集资源：
  - 农田 (herb, 18米)
  - 木材堆 (wood, 8米)
```

### 2.1 数据来源（全部由 `sensor.ts` 实时派生）

| 段落 | 来源 | 备注 |
|---|---|---|
| 名字/等级/性格 | `AIState`（`brain.ts` 初始化时从 entity 拷贝） | 性格来自 `enableAI(entity, personality)`，默认"勇敢冲锋型" |
| 当前所在地图 | `perception.world.currentMap` | 读 `state.levelName` |
| 本图知识 | `readMapKnowledge().summary`（`mapKnowledge.ts`） | 从 eventZones + events.json 的 `trigger.ai.gather` 派生 |
| HP/MP/攻防 | `perception.self` | `hpPercent` / `mpPercent` 是 0-100 整数 |
| 背包物品 | `perception.self.inventory` | 队伍背包（`state.items`）+ AI 私藏（`entity._aiBag`）**按名称合并计数** |
| 技能列表 | `perception.self.skills`（读 `state.skills`） | ⚠️ 当前是**队伍技能栏**，非角色独立技能表（见 §6 待改进） |
| 当前位置 | `perception.self.position` | 保留 1 位小数 |
| 附近可采集资源 | `perception.resources` | 半径 26 米内，按距离升序 |

### 2.2 空值处理（已实测覆盖）

| 情况 | 输出 |
|---|---|
| 背包为空 | `- 空` |
| 无技能 | `- 无` |
| 本图无采集点 | `- 本地图暂无特殊地点知识` / `附近可采集资源：\n  - 暂无` |
| 附近无资源 | `  - 暂无` |

---

## 3. 后半段：当前情况（`buildUserPrompt`）

当前代码（`brain.ts:172-223`）产出如下结构：

```
## 当前情况

### 环境感知
- 周围敌人：1只 (哥布林 HP:30/30 距3.5米)
- 周围友方：2个
- 周围NPC：0个

### 战斗状态
- 周围有 1 个敌人
- 最近敌人: 哥布林 (HP: 30, 距离: 3.5米)

### 资源状态
- 背包物品数（队伍+私藏）: 3
- 可达资源: 2个 (最近: 农田, 18米)

### 角色记忆（最近3件事）
- 遭遇哥布林，展开战斗 (刚刚)
- 在 mulberryTown 城镇中巡逻 (5分钟前)
- 跟随玩家陆川进入地图 (10分钟前)

### 当前目标
跟随玩家陆川战斗

## 决策要求

1. **生存优先**：HP < 30% 必须治疗或撤退
2. **效率优先**：有明确目标时保持专注
3. **团队协作**：适当支援附近友方
4. **资源管理**：背包较多时优先处理

## 输出格式

请以JSON格式输出决策：
{ ...example... }

可用动作类型：move, attack, gather, interact, useSkill, useItem, flee, wait, follow
```

### 3.1 各段落的数据来源

| 段落 | 来源 | 上限 |
|---|---|---|
| 周围敌人 | `perception.nearby.enemies` | 半径 13 米；**只列最近 3 个** |
| 周围友方 | `perception.nearby.allies` | 只报数量 |
| 周围 NPC | `perception.nearby.npcs` | 只报数量 |
| 战斗状态 | 由 `enemies.length > 0` 推导 | 最近敌人 1 个 |
| 资源状态 | `perception.self.inventory.length` + `perception.resources` | 只报最近 1 个资源 |
| 角色记忆 | `AIState.memory.slice(-3)` | **固定 3 条**，超出丢弃 |
| 当前目标 | `AIState.goal` | 由上一次决策的 `goal` 字段写入 |

### 3.2 记忆的时间格式化

```typescript
const ago = Math.round((Date.now() - m.timestamp) / 1000);
const agoText = ago < 60 ? `${ago}秒前` : `${Math.round(ago / 60)}分钟前`;
```

超过 60 秒就不显示秒数，向上取整到分钟。超过 60 分钟会显示"120分钟前"这类不够自然的表述（P3 可优化为"2小时前"）。

---

## 4. 完整示例（前后两段拼在一起）

```markdown
# 角色设定

你是角色【萧肿】的AI控制大脑。

## 基础信息
- 名字：萧肿
- 等级：Lv.5
- 性格特点：勇敢冲锋型，喜欢正面战斗
- 当前所在地图：mulberryTown（桑顿小镇）

## 本图知识（地图集提供）
本图可采集地点：
- 农田（herb）坐标 (42, 31)，可反复采集
- 木材堆（wood）坐标 (68, 24)，可反复采集
本图可交互对象（Tiled id）：npc_merchant_01

## 核心能力
- HP: 26/80 (33%)
- MP: 30/40 (75%)
- 攻击力: 35
- 防御力: 12

## 背包物品（队伍背包 + 私藏）
- 生命药水 ×2
- 铁剑 ×1

## 技能列表
- 冲斩 (消耗10MP, 冷却剩余0秒)
- 怒吼 (消耗20MP, 冷却剩余12秒)

## 当前位置
- X: 13.0, Y: 25.0
- 附近可采集资源：
  - 农田 (herb, 18米)
  - 木材堆 (wood, 8米)

---

## 当前情况

### 环境感知
- 周围敌人：1只 (哥布林 HP:14/30 距2.8米)
- 周围友方：2个
- 周围NPC：0个

### 战斗状态
- 周围有 1 个敌人
- 最近敌人: 哥布林 (HP: 14, 距离: 2.8米)

### 资源状态
- 背包物品数（队伍+私藏）: 2
- 可达资源: 2个 (最近: 木材堆, 8米)

### 角色记忆（最近3件事）
- 遭遇哥布林，展开战斗 (刚刚)
- 使用生命药水，恢复30HP (45秒前)
- 在 mulberryTown 城镇中巡逻 (5分钟前)

### 当前目标
跟随玩家陆川战斗

## 决策要求
...（见上）
```

---

## 5. 这份提示词喂给谁

```
前端 brain.ts
  ├─ buildSystemPrompt()  ─┐
  └─ buildUserPrompt()    ─┴─→ input.userPrompt
                                    ↓
                    sendTick("sys_brain", { reqId, entityName, systemPrompt, userPrompt })
                                    ↓
                    entry.ts case "sys_brain"（待实现）
                                    ↓
                    ctx.tsApi.agent.run("field-survival-ai-brain", {
                      entityName,        // 插件固定字段
                      systemPrompt,      // ← PROMPT_FIELD_SURVIVAL_AI_BRAIN（静态）
                      userPrompt         // ← 本文（动态）
                    })
                                    ↓
                    PluginAgentRunner：拼 messages，调 u.ai.text.invoke
```

---

## 6. 已知问题与改进项

| # | 问题 | 影响 | 改进 |
|---|---|---|---|
| 1 | **技能列表读的是 `state.skills`（队伍技能栏），不是角色自己的技能** | 角色扮演 LLM 可能喊出队伍有但该角色不会的技能 | 若引入角色独立技能表，改 `sensor.senseSelf()` 的 `skills` 来源 |
| 2 | **「决策要求」和「可用动作类型」与系统提示词重复** | 每次决策多烧 ~150 token；两处规则若不一致会让 LLM 困惑 | **P2 落地时删除** `buildUserPrompt` 里的这两段，统一由系统提示词提供 |
| 3 | **记忆固定 3 条、时间格式化粗糙**（超 60 分钟显示"120分钟前"） | 长时段目标漂移 | P3：扩展到 5 条 + 优化时间格式化（"2小时前"/"昨天"） |
| 4 | **周围友方/NPC 只报数量，不报名字** | LLM 无法决定"找谁对话" | P2：友方/NPC 也报名字+距离（各限 3 个），让 interact 有目标可选 |
| 5 | **背包只报名称+数量，不报 heal/mp 效果** | LLM 不知道用哪个药能回多少血 | P3：感知层补 `heal`/`mp` 字段 |

---

## 7. 相关文档

- [ai托管.agent.系统提示词.md](./ai托管.agent.系统提示词.md) — 静态部分（格式契约 + 决策原则）
- [ai托管.agent.传入参数.md](./ai托管.agent.传入参数.md) — `agent.run()` input 契约
- [ai托管.agent.传出参数.md](./ai托管.agent.传出参数.md) — 输出解析与校验
- [ai托管.开发计划.plancheck.md](../ai托管.开发计划.plancheck.md) — 落地步骤