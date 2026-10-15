未完成项（待办清单）

### P0 — 明显失效

- [check] **follow 跟随玩家** — `spine.ts:216` 只 `return`，不发命令。勾了「跟随」但角色不动，用户可感知。
- [check] **gather 真实产出** — 走到 zone 即结束，不触发采集产出 / 背包增加。需在 `entry.js` 的 `ai_command` 增加 `gather` 分支 + 产出结算。
- [check] **useSkill 技能执行** — `spine.ts:142` `executeSkill` 只 return "v0.4 待实现"，LLM 决定用技能等于空转。需新增 `useSkill` 命令通道。

### P1 — 功能残缺

- [check] **interact / NPC 对话** — `spine.ts:207` 同为占位。
- [check] **useItem 回血数值** — `spine.ts:153` `heal: 30` 硬编码，应读物品真实回复值。
- [check] **MapKnowledge 抽象落地** — 地图作息/坐标/采集优先级目前硬编码在 prompt 里，需实现接口并由 `events/scripts/<map>_ai.ts` 注入 `{{mapSpecificHint}}`。

### P2 — 代码卫生

- [check] **删除死代码** — `index.ts:173-243` 的 `syncBrain` / `tickSyncAIs` / `emitAIEventSimple` / `tickAI` 均未被调用。

### P3
- [] AI 采集

① AI 采集在真宿主里产出为 0（最严重）

E11_herb_at.ts 的产出走 ctx.bag.give() → App.vue:246 evGiveItem → sendTick("sys_item_add")。但 entry.ts 里没有 sys_item_add 这个 case（只有 mockHost.ts:1345 有），落到 default: return okResp("") —— 真宿主上物品直接蒸发。
而且落点也不对：即便加上 case，entry.ts 的 s.items 是 buildItems(card, 8) 从玩家角色卡派生的共享背包，AI 采集会掉进玩家腰包。而 sensor.ts:166 的 inventoryFull 判的是 entity._aiBag——_aiBag 全仓只有 sensor 在读，没有任何地方写过。checklist 第四节把它列为"持久字段"，实际是不存在的。

② AI 采集会卡在确认弹窗上

E11 第一步是 ctx.ui.confirm(...) → App.vue:225 evConfirmOpen。这个 Promise 要玩家点按钮才 resolve；而 fireEventManually 是 await fireEvent(ev)，AI 每次采集都会在玩家屏幕上弹一个"是否就地采药？"。已有一个弹窗时直接 return false → 本次采集空手而归；玩家不理则 Promise 永不 settle。
AI 路径不该走交互式脚本，需要给 ctx 传一个"自动确认"模式。

③ 三个 events.json 副本只有一份有 trigger.ai.gather 声明

ui/events/maps/、vue/public/events/maps/、workshops/.../events/maps/ 三份都有（已确认），但 vue/src/eventScripts/_ctx.ts:98 的 EventDef.trigger 类型没加 ai?: { gather?: ... }（workshops 那份 _ctx.ts:95 加了）。目前因为 mapKnowledge.ts:78 自己定义了窄接口 AreaEnterEvent 绕开了类型，运行时不受影响——但插件内这份 _ctx.不一致。

④ 次要：vue/src/eventScripts/E01/E02/E03 从 ../shared/_ctx 导入，而 vue/src/shared/ 目录不存在（ te 剥除，但 vue-tsc 会报错）。