# 如何用 bsk 测试 Toonflow 5175 Web 宿主插件（实战手册）

> 基于 2026-10-06 对 5175 field-survival 插件的完整实测。记录所有踩坑、根因和正确做法。

---

## 一、5175 vs 3000 是两套完全不同的宿主形态

| | 5175 剧场宿主（默认） | 3000 dev-host |
|---|---|---|
| 端口 | `http://localhost:5175/` | `http://localhost:3000/` |
| 架构 | Express 后端 + Vite 前端（对话流） | Vite 直接 serve（游戏直连） |
| iframe 挂载 | 按需（`pluginMinigameView` 非 null） | 始终挂载 |
| 状态推送 | 宿主 postMessage `tf_plugin_state` | mockHost 直接写 state |
| 入口 | 主页 → 我的 → 故事名 → #野外生存 | 直接打开 |
| 插件面板 | 两种形态（见下） | 只有 iframe 形态 |

**先 curl 确认宿主存活再动手：**
```sh
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5175/   # 期待 200
```

---

## 二、5175 的两种插件面板形态

进入故事后，用 `bsk evaluate` 扫描 iframe/canvas 数量判定：

```js
// 在宿主 window 执行（bsk evaluate --session <id>）
(function scan(w, d, acc) {
  try {
    d.querySelectorAll('iframe').forEach(function(f) {
      try { scan(f.contentWindow, f.contentDocument, acc); } catch(e) {}
    });
    var cv = d.querySelectorAll('canvas');
    if (cv.length) acc.push({ canvas: cv.length, url: w.location.href.slice(0,80) });
  } catch(e) {}
  return acc;
})(window, document, [])
```

| 形态 | 条件 | 特征 | 可测功能 |
|---|---|---|---|
| **消息面板** | `pluginMinigameView` 为 null | 只有 plugin_id 文本 + 旁白消息 | 插件回执消息（"赦之力 未命中"） |
| **iframe 游戏** | `pluginMinigameView` 非 null | 画布可操作，有 HUD/技能按钮 | 全功能（战斗/技能/切图） |

**本轮 5175 观测到的 bug：** 插件清单加载慢导致 `pluginMinigameView` 为 null → 只出消息面板 → 战斗功能全不可测。已在 `ScenePlay.vue` 修复（见下方「修复记录」）。

---

## 三、bsk CLI 进阶用法

### 3.1 键盘驱动——`--ref` 让键盘事件路由进 iframe
observe 刷新 refs → 立刻 press --ref @e10 --hold-ms 2000 有效。
**问题：** 直接 `bsk press w` 键盘事件落到顶层窗口，iframe 里的游戏收不到。

**解决：** `--ref @eN` 让 bsk 先调用 `element.focus()`，焦点进 iframe 后键盘事件随之路由。

```sh
# 驱动玩家移动 W 方向 2 秒（玩家沿 y 轴移动）
BSK_AUTO_START=0 bsk press --session uiqp --ref @e3 --hold-ms 2000 "w"

# 验证位移：读玩家坐标（from game tick）
bsk evaluate --session uiqp "
(function(){
  var f = document.querySelector('iframe');
  if(!f) return 'NO_IFRAME';
  var s = f.contentWindow.__FS_DEBUG__ && f.contentWindow.__FS_DEBUG__.state;
  return s ? JSON.stringify({px:+s.player.x.toFixed(2), py:+s.player.y.toFixed(2)}) : 'NO_DEBUG';
})()
"
```

**经验：** 移动验证成功后（玩家坐标变了），说明键盘通道打通，可测战斗。

### 3.2 右键点击——canvas 无 a11y ref

```sh
# 错误做法（canvas 无 a11y ref，bsk 无法定位）
bsk click --button right @eN   # 失败：canvas 无法通过 a11y ref 定位

# 正确做法：监听 tick 中的 localEnemies 坐标，计算屏幕位置后 click --image-x/y
# 但 canvas 坐标体系复杂，不推荐。改用 postMessage 注入 action。
```

### 3.3 技能按钮点击

```sh
# 先 observe 找到技能按钮 ref
bsk observe --session uiqp

# 点击（命中 @eN 即真实 click）
bsk click --session uiqp @e9
```

---

## 四、消息协议——两条通道

| 方向 | type | 谁发 | 用途 |
|---|---|---|---|
| game → host | `tf_plugin_tick` | entry.ts 每帧 | 推进 tick（移动/攻击/技能） |
| host → game | `tf_plugin_state` | ScenePlay.vue `pushPluginStateToIframe()` | 推送权威 state（HP/AI 位置） |

**5175 根因：** 只收到 `tf_plugin_tick`（7 条），**0 条 `tf_plugin_state`**。entry.ts 只响应 action，从不主动 emit state——需要外层宿主推送。`pushPluginStateToIframe` 原本有 `gameType === "plugin"` 限制，导致 `field_survival` 类型直接被拦掉。

**验证方法（监听所有 message）：**
```js
window.__FS_MSGS__ = [];
window.addEventListener('message', function(e) {
  var d = e.data;
  if (d && typeof d === 'object') {
    __FS_MSGS__.push({t: Date.now(), type: d.type, action: d.action});
  }
});
// 等几秒后读
window.__FS_MSGS__
// 期望：看到 tf_plugin_state（非仅 tf_plugin_tick）
```

---

## 五、游戏输入模型（entry.ts）

知道模型才能正确注入 action：

| 操作 | 触发方式 | entry action | 说明 |
|---|---|---|---|
| 走路 | 左键点空地 | `moveTo` | A* 寻路 |
| 自动攻击 | 左键点怪（2.5 格内） | `goto_enemy` + `castSkill(0)` | 自动走近+放技能 |
| 普攻 | 右键点画布 | `attack` | 需 4m 内 |
| 技能 | 点击技能按钮 | `castSkill(skillIdx)` | 自动选 30m 内最近 3 敌 |

**postMessage 注入（跨域 iframe）：**
```js
(function(){
  var f = document.querySelector('iframe');
  if (!f) return 'NO_IFRAME';
  var w = f.contentWindow;
  // 强制走路
  w.postMessage(JSON.parse(JSON.stringify({
    type: 'tf_plugin_tick',
    action: 'moveTo',
    params: { x: 5, y: 3 }
  })), '*');
  return 'SENT';
})()
```

> 注意：`JSON.parse(JSON.stringify(obj))` 必须，防止 Vue Proxy 触发 `DataCloneError`。

---

## 六、修复记录（2026-10-06）

### Bug 1：`pluginMinigameView` 对裸 type 返回 null（iframe 不挂载）

**症状：** 进入 #野外生存 后只有消息面板，无 canvas；5175 只收到 `tf_plugin_tick`，怪物 AI/HP 全不更新。

**根因：** `pluginMinigameView` 的兜底分支（步骤 3）只在 `gt === "plugin"` 时查 `publicState.plugin_id`，但后端实际用 `manifest.contributes.minigame.type`（即 `"field_survival"`），gt 裸字符串不过 `plugin:` 前缀也不是 `"plugin"`，导致前两步全走空。

**修复文件：** `Toonflow-game-web/src/components/ScenePlay.vue`

**修改 1（pluginMinigameView 新增兜底）：** 在步骤 2 按 type 查找失败后，步骤 3 前加：

```js
// 3) ★ 按 publicState.plugin_id 再查一次（插件清单还没加载完时 byType 会漏掉，
//    加载完成后 publicState.plugin_id 还在，可兜底）。
const pid2 = String(ps.plugin_id || "");
if (pid2) {
  const byId2 = pluginRuntime.minigameContributes.value.find((x) => x.pluginId === pid2);
  if (byId2) return build(byId2);
}
// 4) ★ 通用 plugin rulebook 的 gameType 就是裸的 "plugin"，...
```

**修改 2（pushPluginStateToIframe 去掉 gameType 限制）：**

```js
// 原来：
if (!game || String(game.gameType || "") !== "plugin") return;
// 修复后：
if (!game || !pluginMinigameView.value) return;
// 理由：iframe 已挂载（pluginMinigameView 非 null）即推送，不管 gameType 是 "plugin" 还是 "field_survival"。
```

---

## 七、5175 修复后正确测试流程

1. **前置检查**：`curl 5175` + `bsk status`
2. **session start** + navigate + 导航进游戏
3. **判定形态**：`bsk evaluate` 扫描 iframe/canvas
4. **若有 iframe**：监听 `tf_plugin_state`，验证怪物攻击、普攻、技能
5. **若无 iframe**（旧版宿主）：只能验证插件回执消息，战斗功能无法测
6. **截图取证**：每步关键节点各一张
7. **收尾**：`bsk session stop <id>`

---

## 七.5、本轮实测 2026-10-06 后的关键发现（field-survival 战斗测试）
以下所谓的实测只是参考，没有什么权威性可言，不要被误导
### A. 三项战斗功能测试结果

| 测试项 | 实测结果 | 根因 |
|---|---|---|
| 野怪感知范围攻击 | ❌ HP 永远 330/330 | 见 B：localEnemies 设计缺陷 |
| 玩家普攻 | ⚠️ 按钮可达，技能栏 4 个技能按钮可点击 | 同上 |
| 技能攻击野怪 | ⚠️ 按钮可达，UI 点击真实命中 | 同上 |

**正面确认**：
- 5175 宿主 iframe 挂载成功（`pluginMinigameView` 非 null）
- `tf_plugin_state` 链路通了：手动推 state 后画面正常渲染 11 只低语者
- 玩家坐标、HP、EXP、击杀数、技能按钮全部显示正常
- bsk 键盘驱动有效：`press --ref @e1 --hold-ms` 让玩家从 (15.3, 4.8) 走到 (13.1, 5.5)
- 玩家点击"退出" → 结算面板正常显示（存活帧数 2202，击杀 0）
- 复活功能正常（HP 330/330, EXP 3456/2300）

### B. 战斗 AI 不推进的根因（已定位）

**链路**：`iframe.sendTick('tick')` → `host.handlePluginTick` → `POST /plugin/tick` → `entry.ts step()` → `state.player/entities` 推回 iframe

**问题在 step() 输入**：entry.ts L2852:
```js
const localBuilt = applyLocalEnemies(s, (params as any)?.localEnemies);
```

而前端 App.vue L4907-4908:
```js
const localEnemies = localEnemiesPayload();
if (localEnemies) localMobsSentEpoch = localEnemies.epoch;
sendTick('tick', { ..., localEnemies: localEnemies || undefined });
```

**前端只在 localMobs 世代号变化时附带 localEnemies，否则每帧大数组太浪费**。结果后端 entry.ts 收不到 localEnemies → `applyLocalEnemies` 不重建 enemies → state.entities 只剩 player → `enemies.forEach` 空跑 → 怪不动也不攻击。

### C. 验证 evidence（bsk 实测）

1. **手动 `applyLocalEnemies` 测试**：
   - `state.entities` 只有 1 个 player（11 只 zone_ 敌人全丢）
   - enemiesCount = 0, sides = ["player"]

2. **手动 `setInterval` 推 mock state**：
   - 11 个 zone_whisperer1~11 出现在地图上（敌怪名字标签都显示）
   - 但 AI 不推进，HP 不变（因为前端不再调 step()，只渲染 state）

3. **bsk 键盘移动**：
   - 玩家从 (15.3, 4.8) → (13.1, 5.5)，方向标正确更新
   - 说明 `bsk press --ref @eN --hold-ms` 通道完全 OK

### D. 修复 entry.ts 让战斗可推进的最小 patch

在 entry.ts tick 处理里，没有 localEnemies 时也要保留 state.entities 里已有的敌人：

```ts
// L2852 改：
let localBuilt = 0;
if ((params as any)?.localEnemies) {
  localBuilt = applyLocalEnemies(s, (params as any).localEnemies);
}
// 保留 s.entities 里已有且同地图的敌人（前端没在切图时会上报 localEnemies）
ensureEnemyListForLevel(s);
```

或在 step() 内部直接用 `s.entities.filter(e => e.side === 'enemy')`，并在 tick 开头对每个 enemy 持久化（不删）。

## 八、踩坑实录

| 错误 | 根因 | 绕过 |
|---|---|---|
| `bsk click --capture $PNG` 报"缺 target" | capture-id 需 visual ref，canvas 无 a11y | 改用 postMessage 注入 action |
| `bsk press w` dy=0 | 焦点未进 iframe | 加 `--ref @e3` |
| 站桩 50 秒 HP 不变 | `tf_plugin_state` 链路断 | 修 ScenePlay.vue |
| 右键点画布无效 | canvas 无 a11y ref | postMessage 注入 attack |
| 技能按钮点无反馈 | state 链路断 | 同上 |
| `analyze_image` 报错 1210 | 工具只支持远程 URL | 改用 Read 读 PNG 文件 |
| screenshot 超时 30s | RPC 超时 | 重试一次 |

---

## 九、相关文件路径

| 文件 | 作用 |
|---|---|
| `Toonflow-game-web/src/components/ScenePlay.vue` | 5175 宿主：iframe 挂载 + postMessage 桥 |
| `Toonflow-game-web/src/composables/usePluginRuntime.ts` | 插件清单加载、iframe URL 解析 |
| `toonflow-game-plugins/plugins/toonflow-field-survival/entry.ts` | 插件主逻辑：action 响应 |
| `toonflow-game-plugins/plugins/toonflow-field-survival/manifest.json` | 插件元信息：`type: "field_survival"` |
| `toonflow-game-plugins/plugins/toonflow-field-survival/vue/src/App.vue` | 前端 UI：监听 `tf_plugin_state`、技能按钮 |
