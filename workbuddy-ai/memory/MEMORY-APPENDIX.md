# Toonflow game-plugins 长期记忆 · 附录

> `MEMORY.md` 的溢出部分（体积超注入上限会截断）。**做浏览器 E2E 调试 / 动 map-editor、tiles-maps-editor 时先读本文件。**

## ★ 调试铁律与浏览器方案
0. **「点了没反应」必须先浏览器复现再改代码**：曾凭静态阅读断言「z-index 压住弹窗」，实测发现**弹窗链路根本没触发**（真根因是 color 被当 ms）。
   - 通道：bsk evaluate → `iframe.contentWindow` → `canvas.__vueParentComponent` 向上找根 → `root.setupState`（全部 ref 可读写）；发命令用 `parent.postMessage({type:'tf_plugin_tick',action,params},'*')`。
   - **bsk（browser-skill）**：`bsk session start --json` → `bsk navigate/observe/evaluate/screenshot`。★ 读**宿主真实 state** 靠拦 iframe 的 `postMessage`（`__devHostPluginState()` 不给 x/y/aiState）。★ 截图用 `--out`（不是 `--path`）。
   - **ego-browser**：命令是 **`ego-browser`**（不是 `ego`）；Git Bash 下 **`-e` 模式静默失败**（exit 0 无输出），**必须 `ego-browser nodejs < file.mjs`**；PowerShell 下 `-e` 反而正常。前置：ego lite 应用进程在跑。
1. ★ **采样前先看 `phase`**：玩家一死前端 loop 就停发 tick → 采样窗口冻结成「AI 没动」（曾据此误判「duel 假人不追击」，拦截宿主 state 后证伪）。
2. ★ **别只看前端合并后的 entities**：x/y 要靠 `hostDrives` 判定是否采用宿主值。
3. 复活 `setupState.reviveGame()`；玩家瞬移改 `state.entities` 的 player x/y（前端权威），★ 但**绕过 entityRef Proxy → epoch 不 bump → 宿主不重建**（宿主 side 仍 neutral → AI 不跑）；测「脚本改 side」必须走正规 UI 路径（点「⚔对打」→「模拟实战」）。玩家血量也是宿主权威，前端改会被覆盖。
4. 游戏是 canvas 渲染 → 查 DOM 找不到「Lv20」，只能截图目视；随机事件弹窗（如「采药」）会挡视野，先点「离去」。

## 次要子项目
- **map-editor**：AI 模型配置存后端 SQLite（`backend/ai_store.py`）；canvas 切换必须 `v-show` 不能 `v-if`（模块级缓存 ctx，v-if 重建后永久黑屏）。厂商目录权威源在 Toonflow-game-web `src/utils/modelConfigCatalog.ts`（22 家）。坑：voice+asr 的 baseUrl 硬编码 dashscope；`manufacturer=="aliyun"` 是死分支；抠图厂商只能绑背景分离槽位。
- **tiles-maps-editor**（`.workbuddy-ai/skills/`）：串 cognitive-tiles-maps（认知）+ tile-style-change（换皮）+ map-editor（UI）。scripts：`elements.py`（像素判材质/道路/建筑/活物）、`actors.py`（对象层 CRUD，坐标是像素）、`make_tiles.py`（程序化瓦片，id>=12900 空白段）。API：`POST /api/collections/{name}/maps/{map}` 保存（备份固定名会覆盖）；`POST /api/tile-style/override` 换格贴图（改图集本体，gid 不变）。
