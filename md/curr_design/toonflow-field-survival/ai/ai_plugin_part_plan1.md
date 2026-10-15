未完成项（待办清单）

### P0 — 明显失效

- [ ] **follow 跟随玩家** — `spine.ts:216` 只 `return`，不发命令。勾了「跟随」但角色不动，用户可感知。
- [ ] **gather 真实产出** — 走到 zone 即结束，不触发采集产出 / 背包增加。需在 `entry.js` 的 `ai_command` 增加 `gather` 分支 + 产出结算。
- [ ] **useSkill 技能执行** — `spine.ts:142` `executeSkill` 只 return "v0.4 待实现"，LLM 决定用技能等于空转。需新增 `useSkill` 命令通道。

### P1 — 功能残缺

- [ ] **interact / NPC 对话** — `spine.ts:207` 同为占位。
- [ ] **useItem 回血数值** — `spine.ts:153` `heal: 30` 硬编码，应读物品真实回复值。
- [ ] **MapKnowledge 抽象落地** — 地图作息/坐标/采集优先级目前硬编码在 prompt 里，需实现接口并由 `events/scripts/<map>_ai.ts` 注入 `{{mapSpecificHint}}`。

### P2 — 代码卫生

- [ ] **删除死代码** — `index.ts:173-243` 的 `syncBrain` / `tickSyncAIs` / `emitAIEventSimple` / `tickAI` 均未被调用。
