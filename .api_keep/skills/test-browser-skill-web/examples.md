# test-browser-skill-web 示例

## 示例 1：5175 剧场宿主 · field-survival 插件挂载验证（2026-10-06）

### 原材料（Input）

1. **已完成产出**：
   - 截图 `C:/Users/viaco/AppData/Local/Temp/fs-5175-full.png`（进入故事后的全页）
   - console 日志摘录（语音 400 刷屏 + voiceGenPlay 报错）
   - 会话记录：bsk session cnmv（edge 0d10b911）

2. **会话上下文**：
   - 上一轮已在 3000 dev-host 完成 entry.js 战斗链路验证（点击哥布林 → 自动移动 + HP 200+→84）；
   - 本轮用户选 C：测试 `http://localhost:5175/`。

3. **目标技能名**：`test-browser-skill-web`

### 实测路径回放

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| Step 0 | curl 5175 → 200；bsk status → daemon 0.3.2、edge 已连 | ✅ |
| Step 1 | session start --browser 0d10b911 → cnmv；navigate 5175；observe | ✅ 主页（Toonflow AI 剧场 / ab_compare_project） |
| Step 1 入口 | fill 输入框「继续」→ click「进入故事」 | ✅ 进入故事页 |
| Step 2 | observe | ✅ 出现 field-survival / 第 1 轮 · playing |
| Step 2 形态判定 | evaluate 统计 iframe/canvas（含 shadow 全扫） | ❌ 0 iframe / 0 canvas → 消息面板形态 |
| Step 2a | click「展开」→ 按钮变「收起」，仍无 iframe | ⚠️ iframe 容器 v-if 未满足 |
| 定位原因 | 读面板 HTML：activeMiniGame.gameType 未命中 manifest.contributes.minigame.type | 结论：宿主未挂载游戏 iframe |
| Step 5 | screenshot --out fs-5175-full.png | ✅ 立绘 + 插件面板 +「赦之力 未命中」回执可见 |

### 关键结论（已固化进 SKILL.md 规则）

1. 5175 与 3000 是两套宿主形态，先分辨再动手。
2. 消息面板形态下游戏 canvas 不存在，功能测试只能验证插件回执消息。
3. 语音 /game/streamvoice 400 与游戏挂载无关，不阻塞但需记录。

### 易错点实录

- screenshot 参数是 --out 不是 --output（报错一次）。
- 首次 screenshot 超时（30s RPC），重试成功；持续超时才查 bsk logs。
- observe 的 refs 会过期：点完「进入故事」后旧 ref 失效，必须重新 observe。
- 多浏览器在线时 session start 必须带 --browser <id>。
- bsk evaluate 的 IIFE 不带 return 时输出 {}——所有片段必须显式 return。

## 示例 2：3000 dev-host · 战斗链路验证（2026-10-06 上一轮，作为对照）

### 路径差异

3000 是 dev-host：vite 直接 /@fs/ 加载 entry.js，游戏 canvas 在 iframe 里直接可操作。

| 功能 | 证据 |
|---|---|
| 点击怪物自动攻击 | 玩家 (1.5,-0.5)→(2.40,-0.5)→(1.59,-0.89) 位移 + 目标 HP 200+→84 |
| 死亡结算 | 截图「击杀 4 金钱 +12」 |
| 切图 | teleportTarget = {mapName:'Mulberry Forest'} → 11 只哥布林生成 |

### 教训（已固化到 SKILL.md Step 4 注意事项）

- 改 entry.ts 必须手动 npx esbuild entry.ts --outfile=entry.js（默认 ESM）。
- postMessage 注入先 JSON 序列化防 DataCloneError。
