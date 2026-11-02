# P2 回合/指令型插件模板

> 协议参考：`md/curr_design/toonflow-field-survival/网络通信/插件的网络通信机制_v2.md` §4「分流协议」

## 这是什么

一个**零 tick 轮询**的最小插件骨架。适合回合制 / 策略 / 卡牌 / 经营 / RPG 对话选段
这类「状态只在玩家出招时变化」的小游戏。

- 通信量 = 玩家操作次数（点一次按钮 = 一次 `/plugin/tick` 往返）
- 没有心跳、没有 10Hz 轮询、不占写库带宽

## 关键约定

### 1. manifest 声明 `interaction`

```json
"contributes": {
  "minigame": {
    "type": "turn_based_template",
    "entry": "ui/game.html",
    "interaction": "turn-based"
  }
}
```

宿主（`Toonflow-game-web`）读到后会把 `?interaction=turn-based` 拼进 iframe src。
缺省（不声明）= `realtime`，行为与既有插件完全一致。

### 2. 插件端读 URL 判定（前端框架）

```ts
// bridge.ts
export function isTurnBased(): boolean {
  return interactionMode() === "turn-based";
}

// App.vue 的 tick 循环里
if (ts - lastSendAt >= currentSendMs(ts) && !isTurnBased()) {
  sendTick("tick", { /* ... */ });
}
```

纯 HTML 模板里直接读 `location.search`（见 `ui/game.html`）。

### 3. 后端零改动

`/plugin/tick` 本就支持任意 `action`。回合制插件的 `handle_action`
只需要实现自己的 action（`start` / `attack` / …），**不需要知道自己是回合制**。

## 目录结构

```
turn-based/
├── manifest.json     # 含 interaction: "turn-based"
├── entry.js          # 后端权威逻辑：handle_action(action, params, state, ctx)
└── ui/game.html      # 前端单文件：每次点击 = 一次往返
```

## 与 P1（实时动作型）的取舍

| | P1 realtime（野外生存） | P2 turn-based（本模板） |
|---|---|---|
| tick 频率 | 10Hz 活跃 / 1Hz 挂机 | **0** |
| 通信触发 | 定时器自动 | 玩家出招 |
| 通信量 | 与游戏时长成正比 | 与操作次数成正比 |
| 延迟 | 每帧最新 | 出招后一次往返 |
| 适合 | 动作 / 射击 / 走位 | 卡牌 / 回合 / 经营 / 选段 |

**不要混用**：如果插件需要连续移动（玩家按住方向键），那就是 P1，
不要为了"省流量"改成回合制——回合制下玩家无法连续操作。

## 验收清单

1. 打开插件 → 控制台/网络面板**没有周期性请求**（只有点击时的请求）；
2. 点「开始」→ 双方 HP 出现；
3. 点「攻击」→ 日志新增回合记录，HP 条变化；
4. 后端日志 `POST /plugin/tick` 次数 == 玩家点击次数（无周期性增长）；
5. `plugin_state.updatedAt` 只在操作时变化（无 2s 节流下的持续写入）。
