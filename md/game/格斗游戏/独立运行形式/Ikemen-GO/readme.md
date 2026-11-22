# Ikemen-GO
https://github.com/ikemen-engine/Ikemen-GO
测试效果：要手感对、能立刻打、非常毛胚
**GitHub 上没有 “成品游戏” 仓库。** 一个完整的 Ikemen 游戏构建动辄 600MB 以上，素材版权还各归各的，因此没人会把它放进 Git 仓库；成品都发在 itch.io、Steam 或个人网盘。GitHub 上真正有价值的是**引擎和工具链**，其中有一个项目直接推翻了我上次的一个判断。

## 一、最值得看的：浏览器里直接运行的 Ikemen

**Energy's WebMUGEN 2.0**（itch.io，HTML5，代码 MIT）：官方描述是 “把一个完整的格斗游戏引擎放进浏览器标签页，不用安装”，首发包约 60MB、之后走缓存，内置 Kung Fu Man / Sakura / RyuDX 三个角色，带 Arcade、组队、生存、训练、观战和 rollback 联机。

它的作者把它做成了一个工具链，这才是重点：

- **`energyjp/mugen-studio`**（GitHub，MIT，JavaScript，23★）：拖入角色、场景、音乐、整套屏包，然后**导出一个网页游戏，或导出一个跑在 Ikemen GO 上的桌面版**
- **`energyjp/ikemen-go-web`**：Ikemen GO 编译成 WebAssembly，产物是 `ikemen-v2.wasm`

**所以我要收回上一轮那句话**：“Ikemen 进不了 iframe” 是错的。它已经有 WASM 版，能在浏览器里运行。代价官方自己写在页面上：**单线程，重角色和复杂场景会卡顿**，首次加载 60MB。

## 二、GitHub 上真正有内容的仓库

表格

| 仓库 | 星标 | 用处 |
| --- | --- | --- |
| `ikemen-engine/Ikemen-GO` | 1704★ / 304 fork | 引擎本体，Go，昨天还在提交 |
| `ikemen-engine/Ikemen-GO-Screenpack` | 25★ | 官方屏包源码 —— 你嫌简陋的那套就从这里改 |
| `CableDorado2/Ikemen-Plus-Ultra` | 109★ | S-SIZE 分支，仓库近 3GB，含大量屏包与内容，11 月仍活跃 |
| `CableDorado2/IkemenGO-GameModes-Tweaks` | 15★ | 官方外部模块的改法 + 自制游戏模式 |
| `two4teezee/Ikemen-GO-Trials-Mode` | 8★ | Trials 模式模块，学 “加模式” 的样板 |
| `SuperFromND/iguana` | 19★ | 自动生成招式表，省手工 |
| `eduardovbe/CharFactory` | 10★ | **角色编辑器 + MCP 的 AI agent**：精灵、动画、判定框、音效、代码、逐帧招式模拟器 |

`CharFactory` 这条对你最关键：它是 MIT 的开源工具，能让 AI 直接产出 MUGEN/Ikemen 的角色文件（.def/.air/.sff/ 判定框），等于把最贵的美术人力成本压到最低。你之前反感 “AI 裸写代码”，但这个工具做的是让 AI 生成**可验证的资产文件**，性质不一样

## 三、真正的成品（要下载，不在 GitHub）

- **BROK MUGEN**（itch.io）：游戏《BROK the InvestiGator》的同人格斗，**41 个角色、40 个场景**，素材全手绘、画风统一，而且同时提供 MUGEN 1.0 / 1.1 / **Ikemen Go** 三种构建（Ikemen 包 659MB）。这是目前能找到最接近 “成品” 的免费项目slashteryt.itch.io
- **Thumps & Blows**（Steam，付费）：Ikemen Go 商业发行，10 个手绘火柴人
- **Card Sagas Wars**（2018）：全原创像素，做到原型就停了

三个例子的共同点还是那句话：**画风统一 + 全部自制**。BROK 是卡通描线风，Thumps 是火柴人 —— 没人靠堆别人素材做出成品。

## 四、路线要重排
原来只有两条路，现在多了一条：

- **自研内核**：轻、可控、天然进 iframe，手感要自己从零写
- **Ikemen WASM**：状态机、AI、连招、rollback 全是现成的，你只喂素材 + 换屏包；但 60MB 单线程 WASM，进 iframe 会卡，内置角色版权各归作者
- **中间路线**：`mugen-studio` 思路 —— 内容与引擎分离，浏览器端只加载你的 2~4 个自制角色 + 极简屏包，把 60MB 压到十几 MB

 WebMUGEN 浏览器直接跑，不用装。
 顺便能实测它嵌进 iframe 后卡不卡 —— 这个数据直接决定第三条路走不走得通。
