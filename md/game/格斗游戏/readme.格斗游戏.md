# 格斗游戏
做一个 插件 格斗游戏的。什么框架，什么形式好。独立运行对接  后端还是安装到宿主。
有什么好的开源项目。
如果直接照现有做法实现，做格斗会碰到一个无法回避的限制，所以先说结论。

## 一、三个判断

1. **形式选“半独立”**：格斗循环放在 iframe 里自己运行，逻辑固定为 60Hz、渲染插值；宿主只负责入口、选人、结算发奖。插件照常 `.tpg` 安装，但战斗过程不经过宿主 tick。
2. **框架选自研 Canvas + 帧数据 JSON**，不选整套游戏引擎。你要放进 480×720 的 iframe，Godot/Ikemen 那种十几 MB 起步的 web 包在插件场景里不划算。
3. **只有联机 PvP 才需要独立进程**：那时插件退化成“启动器 + 战报回传”，对战跑独立服务端；单机/同屏双人没必要独立。

## 二、不能把格斗塞进宿主 tick 的原因

现状是 HTTP `/plugin/tick`，逻辑 **10Hz**（`TICK_MS=100`），每推进一步一次完整往返；v3.1 的 WS 全双工已经落地，但世界推进依然由服务端 `TickDriver` 以 **10Hz** 驱动，且上行 pose 合并到 ≤10 条/秒。

格斗的判定粒度是 16.7ms，10Hz 等于每 100ms 结算一次，轻攻击的 4 帧启动、hitstop、受击硬直全部会被压扁；60 帧输入更会直接顶破上行限额。所以只有两条路：**把世界放在本地，或者干脆独立运行**，中间方案不成立。

推荐结构：

```
toonflow-fighting/
├─ manifest.json        contributes.minigame.interaction = "local-sim"
│                       （宿主只当 query 透传，interaction 是自由字符串，默认 realtime）
├─ entry.ts → entry.js  只做三件事：start 校验 / 战报重放校验 / 发奖励
├─ engine/core.js       纯逻辑无 DOM：fixedStep(60) + 状态机 + hitbox + 帧数据
└─ ui/game.html         60Hz 循环 + 输入采样 + 插值渲染，postMessage 只发结果
```

关键点：**`core.js` 必须被 iframe 和 `entry.js` 共用**。客户端提交 `seed + 输入序列 + 回合结果`，后端用同一份逻辑重放一遍，比对伤害/回合数再发奖；这样不用做服务器逐帧权威，也能防改包。整局通信量只有“开局、三回合结束、结算”五六条消息，比野外生存还省。

AI 也要分层：**帧内对手**用本地行为树/状态机（LLM 一次往返几百毫秒，在帧里不可用）；**帧外**的赛前挑衅、战术倾向、赛后解说走 MCP tools，跟 field-survival 的 `mcpTools` 一个套路。这也符合项目“别硬编码、用 agent 实现功能”的思路。

## 三、引擎三条路线

| 路线 | 包体/构建 | 优点 | 代价 |
|---|---|---|---|
| **自研 Canvas2D**（推荐） | <1MB，零构建 | 和现有 canvas 插件同构，手感/判定完全可控，改一帧就能改判定 | 判定、受击框、取消规则要自己写，大概 2~3 周 |
| Godot 4 + 回滚插件 | web 包十 MB 级 | 工具链成熟，`godot-rollback-netcode` 现成，动画/粒子省事 | iframe 首载慢，插件升级变重，且要额外维护一套构建 |
| Ikemen GO(WASM) | 大，且需虚拟文件系统 | MUGEN 素材和帧数据生态直接复用，手感成熟 | 官方只有桌面版，浏览器是社区 WASM 版，塞 iframe 麻烦 |

## 四、值得看的开源项目

| 项目 | 拿来干什么 | 适配度 |
|---|---|---|
| **Ikemen GO** | MUGEN 兼容（CNS/CMD/SFF），MIT，回滚+延迟网络。**最值得读的是它的角色状态机和帧数据组织**，也可以直接当独立客户端 | 参考★★★★★ / 嵌入★★ |
| M.U.G.E.N 角色包 | SFF/ACT/CNS 素材与定义格式，二十多年素材库；注意角色版权，商用要换自制素材 | 素材★★★ |
| **GGPO** | 回滚网络鼻祖 SDK，输入预测+重放的教科书实现 | 联机★★★★ |
| backroll-rs / **GGRS** | GGPO 的 Rust 重写，控制流更清晰，可编 WASM | 联机★★★ |
| **godot-rollback-netcode** | Godot 4 的 MIT 回滚插件，含确定性、随机数、动画、调试工具 | 若走 Godot ★★★★ |
| **netplayjs** | TS + WebRTC 浏览器 P2P 回滚，最贴 iframe 联机场景 | 浏览器联机★★★★ |
| BestoNet | Unity C# 回滚，同人格斗 Idol Showdown 在用 | 走 Unity 才用 |
| openomf | C 写的《One Must Fall 2097》重制，完整 1v1 实现，适合当阅读样本 | 参考★★★ |

Ikemen GO 的 MIT 许可、MUGEN 资源兼容和内置回滚/延迟网络，来自官方站；浏览器版是社区用 WASM 编译的非官方分支。 回滚网络部分参考 GGPO 原理文档与 GGRS 仓库；Godot 插件为 MIT；netplayjs/BestoNet/openomf 见 GitHub 的 rollback-netcode 主题页。

## 五、我建议的起手顺序

1. 先定手感三件套：逻辑 60Hz、输入缓冲 6 帧、hitstop 6 帧。跑通“单角色 3 招”（5A / 2B / 236C）再谈美术。
2. 帧数据先手写 JSON，参数可以直接抄 MUGEN 常见值（走 4px/帧、跳 40 帧、轻攻击 4/3/8、轻受击 11 帧）。
3. 判定只用矩形 hitbox/hurtbox，不做骨骼胶囊，2D 格斗够用且好调。
4. 联机放到二期：先用 `netplayjs` 的思路做“只同步输入 + 本地回滚”，不要一开始就上服务端逐帧。

要不要我按这个结构直接起一个骨架（`manifest` + 复用 `core.js` 的 `entry` 校验 + 60Hz 内核 + 1 角色 3 招）？起完你就能在 iframe 里打起来了。