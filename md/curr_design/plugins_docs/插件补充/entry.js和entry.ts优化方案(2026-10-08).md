# entry.js 和 entry.ts 优化方案 (2026-10-08)

> 前置文档：[`entry.js和entry.ts 的关系和说明.md`](./entry.js和entry.ts 的关系和说明(2026-10-07).md)（现象溯源）、[`插件工作机制.md`](./插件工作机制.md)（运行模型）
> 关联：本次修复在 2026-10-07 暴露出"插件拟真安装一致性"系列问题（[bugs/插件的拟真安装一致性问题.md](../../curr_design/toonflow-field-survival/bugs/插件的拟真安装一致性问题.md)）

## 目标

消除 `entry.js` 当前身兼三职的歧义（**前端入口**——已失效 / **后端 import 目标**——真正用 / **ts 编译产物**——实际上是手工改过的副本），让"改 entry.ts → 改 entry.js"成为**唯一可能**的编辑路径，**所有运行链路看到的都是同一份代码**。

## 现状（问题清单）

| # | 问题 | 实证 | 影响 |
|---|---|---|---|
| 1 | `entry.js` 与 `entry.ts` 内容漂移 | 行数 2838 vs 3624（差 786），手工编辑痕迹多 | 改 entry.ts 不编译 = 后端跑老代码 |
| 2 | 文档自相矛盾 | 插件设计.md § 2.1 说 entry.js 是"前端入口"；§ 4 / § 5.1 / § 6.1 说 entry.js 是"编译产物" | AI/新人误读，三方理解错位 |
| 3 | entry.js 没人用但有"前端"角色 | `ui/game.html` 是 vite 内联 bundle，前端根本不读 entry.js | 角色空转，约定漂移风险 |
| 4 | entry.js 备份命名混乱 | `entry.js.bak_20261005`、`entry.js.bak_before_tsc_20261006_1830`、`entry.js.new` | 历史回滚时连带 entry.ts 改动丢失 |
| 5 | `entryModuleCache` 永不过期 | PluginExecutor.ts:59 进程级 Map，命中条件仅"重启 60002" | 改了 entry.js / entry.ts 不重启 60002 = 后端跑老代码 |
| 6 | 安装副本 vs 仓库 | 同机器 4 个位置 3 个版本（实测）：仓库/用户 1/用户 7-8/`toonflow-game-app/Toonflow-game/` 残留 | 谁在哪个账号下测试拿到的版本不同 |
| 7 | 拟真测试链路 ≠ 安装链路 | dev-host ENTRY_PATH = `../entry.js`；安装链路 PluginExecutor 读安装副本 entry.js；两条链路走不同的 `entry.js` | dev-host 通过 ≠ 安装通过 |
| 8 | esbuild 现编 vs 仓库内提交 | esbuild 实际编出的 entry.js（如果有）跟仓库提交的不一定一致 | "build → diff" 才发现 |

## 方案对比

按"改动量"从小到大列出 4 套方案，互斥（选一个为主推，其他作为补强/过渡）：

| 方案 | 名称 | 一句话 | 改动范围 | 立即消除 |
|---|---|---|---|---|
| A | **文档+校验双锁** | 写明现状，git hook 禁止手编辑 entry.js | 文档 + git hook | 漂移、口径混乱 |
| B | **esbuild 单点编译** | 把 entry.js 设为 esbuild 唯一编译产物，删除手编辑可能 | 仓库 + 同步脚本 | 漂移、双身份 |
| C | **前端入口迁移** | 把 entry.js 真正作为"前端 minigame 入口"用，删 game.html 的内联 bundle，改入口引用 | 前后端大改 | 三身份合一 |
| D | **后端直接读 .ts** | PluginExecutor 改成读 .ts（tsx 加载），删 entry.js | 60002 后端 + 模板 | 双身份完全消除 |

**推荐主推：A + B 组合**（最小最稳），C/D 作为长期演进路线，但**不在 toonflow-field-survival 单插件上做**，需要先在插件设计层面达成一致。

---

## 方案 A：文档+校验双锁（最稳，零功能改动）

### A.1 写明现状（已完成）

- ✅ `entry.js和entry.ts 的关系和说明.md`：解释三身份成因、误读路径
- ✅ `插件工作机制.md`：写明"前端用 ui/game.html，后端用 entry.js，entry.ts 是后端逻辑源码 + esbuild 源"
- ✅ `插件的拟真安装一致性问题.md`：列出 4 个 entry.js 副本

### A.2 git hook：禁止手编辑 entry.js

**思路**：CI/本地 hook 在每次 `git commit` 触发，校验 entry.js 与 entry.ts 的一致性（`esbuild entry.ts` 模拟编一次，与仓库 entry.js 对比）。不一致则拒绝提交。

**实现**（`.git/hooks/pre-commit` 或 `.husky/pre-commit`）：

```bash
#!/usr/bin/env bash
# ★ entry.js 一致性校验（防手编辑漂移）
# 1) esbuild 现编一次到临时文件
TMP=$(mktemp)
npx --no-install esbuild plugins/toonflow-field-survival/entry.ts \
  --outfile="$TMP" --bundle=false --format=esm --target=es2020 2>/dev/null
# 2) 与仓库 entry.js 对比（忽略注释/空白差异可用 diff -w）
if ! diff -q "$TMP" plugins/toonflow-field-survival/entry.js >/dev/null 2>&1; then
  echo "✘ entry.js 与 entry.ts 编译产物不一致"
  echo "  请执行: cd plugins/toonflow-field-survival && npx esbuild entry.ts --outfile=entry.js"
  rm "$TMP"; exit 1
fi
rm "$TMP"
```

**优点**：纯校验，零功能改动，立刻堵住"手编 entry.js"路径
**缺点**：依赖 esbuild 在本地/ CI 装好；编译目标/格式化差异可能误报（→ 解决：让 esbuild 选项与宿主加载时一致，或对比 AST 而非文本）

### A.3 文档同步：插件设计.md 修订

**当前矛盾**（`toonflow-game-app/md/curr_design/插件设计/插件设计.md`）：
- § 2.1（22-24 行）：`entry.js` 是"前端入口脚本"
- § 4（172-173 行）：`entry.js ← tsc 编译产物`
- § 5.1：只提 `import entry.js`
- § 6.1：`entry.js` 是"编译产物"

**建议修订**（在 toonflow-game-app 仓库）：
- § 2.1 删掉或重写"前端入口脚本"那行，明确"前端用 ui/game.html（vite 内联 bundle），entry.js 是后端动态 import 目标"
- § 4 / § 5.1 / § 6.1 统一表述："entry.js 是 entry.ts 的 esbuild 编译产物，前端不读，后端 PluginExecutor.loadEntryModule 读"
- 新增 § "前后端职责"：以 toonflow-field-survival 为例画出"前端只渲染+收输入，后端跑所有业务"的分工

---

## 方案 B：esbuild 单点编译（推荐主推）

### B.1 仓库调整

1. **删除 entry.js 的手写痕迹**（备份归档到 `archive/`）：
   ```bash
   git rm entry.js.bak_20261005 entry.js.bak_before_tsc_20261006_1830 entry.js.new
   # entry.js 保留在 .gitignore，提交时不带，每次构建现编
   echo "entry.js" >> plugins/toonflow-field-survival/.gitignore
   echo "entry.js.map" >> plugins/toonflow-field-survival/.gitignore
   ```
2. **加一个 `build-entry.sh`**（在 `plugins/toonflow-field-survival/`）：
   ```bash
   #!/usr/bin/env bash
   # 编译 entry.ts → entry.js（确保与 60002 PluginExecutor 加载的目标同步）
   set -euo pipefail
   npx esbuild entry.ts --outfile=entry.js --bundle=false --format=esm --target=es2020
   ```
3. **加 npm script**（在 `vue/package.json` 或新建根 `package.json`）：
   ```json
   {
     "scripts": {
       "build:entry": "cd plugins/toonflow-field-survival && bash build-entry.sh",
       "sync": "npm run build:entry && ./sync-plugin.sh",
       "predev": "npm run build:entry"
     }
   }
   ```
4. **`predev` 钩子**：`npm run dev`/`npm run debug`/`vite dev` 启动前先编译 entry.js，避免"忘记编译 → 后端跑老代码"。

### B.2 sync-plugin.sh（解决安装副本漂移）

参考 [插件的拟真安装一致性问题.md § 解决方向 ①](../../curr_design/toonflow-field-survival/bugs/插件的拟真安装一致性问题.md#解决方向建议未实施)：

```bash
#!/usr/bin/env bash
# ★ 一键同步插件代码到所有安装副本（解决仓库 vs 安装副本漂移）
# 用法：./sync-plugin.sh [userId ...]   不传则同步所有现有安装副本
set -euo pipefail

# 1) esbuild 现编
cd "$(dirname "$0")"
npx esbuild entry.ts --outfile=entry.js --bundle=false --format=esm --target=es2020

# 2) 同步 entry.js / entry.ts / ui/game.html / manifest.json 到所有安装副本
PLUGIN_ID="com.toonflow.minigame-field-survival"
PLUGIN_ROOT="${PLUGIN_ROOT:-D:/Users/viaco/tools/Toonflow-game/toonflow-app-run-db/plugins}"
SRC="$(pwd)"

USER_IDS="${@:-}"
if [ -z "$USER_IDS" ]; then
  USER_IDS=$(ls "$PLUGIN_ROOT" 2>/dev/null)
fi

for uid in $USER_IDS; do
  DST="$PLUGIN_ROOT/$uid/$PLUGIN_ID"
  [ -d "$DST" ] || continue
  echo "→ sync $DST"
  cp -f "$SRC/entry.js"    "$DST/entry.js"
  cp -f "$SRC/entry.ts"    "$DST/entry.ts"
  cp -f "$SRC/ui/game.html" "$DST/ui/game.html" 2>/dev/null || true
  cp -f "$SRC/manifest.json" "$DST/manifest.json"
done

echo "✔ 同步完成。需要重启 60002 让 entryModuleCache 失效。"
```

### B.3 `entryModuleCache` 失效入口（解决"改了不生效"）

**改造 PluginExecutor.ts:59**：

```ts
const entryModuleCache = new Map<string, { handle_action: Function; mtimeMs: number; sourcePath: string }>();

async function loadEntryModule(pluginDir: string) {
  // 优先 .js（编译产物），其次 .ts（运行时支持）
  for (const candidate of [path.join(pluginDir, "entry.js"), path.join(pluginDir, "entry.ts")]) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    const cached = entryModuleCache.get(pluginDir);
    if (cached && cached.sourcePath === candidate && cached.mtimeMs === stat.mtimeMs) {
      return { handle_action: cached.handle_action };
    }
    try {
      const url = fileUrl(candidate);
      const mod = await import(/* @vite-ignore */ url);
      if (mod.handle_action) {
        entryModuleCache.set(pluginDir, {
          handle_action: mod.handle_action,
          mtimeMs: stat.mtimeMs,
          sourcePath: candidate,
        });
        return mod as { handle_action: Function };
      }
    } catch { /* 继续尝试 */ }
  }
  // ... fallback
}
```

**+ 暴露清缓存接口**（供 dev plugin reload 用）：
```ts
export function clearEntryCache(pluginDir?: string): void {
  if (pluginDir) entryModuleCache.delete(pluginDir);
  else entryModuleCache.clear();
}
```

**+ 路由**：`POST /admin/plugin/reload { pluginDir: "..." }` 调用 `clearEntryCache`。
**+ vite dev-host**：同样的 mtime 检查 + reload 钩子（vite.config.ts:544-551 `entryMod`）。

### B.4 dev-host 与安装链路同源（解决"测的不是装的"）

`vite.config.ts:88-90`：

```ts
// 现在
const ENTRY_PATH = resolve(__dirname, "../entry.js");
```

→ 改为优先读安装副本：

```ts
// 方案 B.4：dev-host 优先用安装副本的 entry.js（与生产环境同源）
const INSTALLED_ROOT = process.env.INSTALLED_PLUGIN_ROOT
  || "D:/Users/viaco/tools/Toonflow-game/toonflow-app-run-db/plugins";
const INSTALLED_ENTRY = `${INSTALLED_ROOT}/1/com.toonflow.minigame-field-survival/entry.js`;
const ENTRY_PATH = fs.existsSync(INSTALLED_ENTRY)
  ? INSTALLED_ENTRY
  : resolve(__dirname, "../entry.js");
```

**约束**：调试前必须先 `python -m toon_plugins plugins -i toonflow-field-survival` 装一次，否则回退到仓库 entry.js。

### B.5 验收

- ✅ 改 entry.ts 后跑 `npm run sync`，entry.js 自动生成，所有安装副本同步，60002 不重启**不**生效（缓存还在）→ 必须重启 60002
- ✅ B.3 的 mtime 失效后：**改 entry.js 不重启 60002 也能生效**
- ✅ B.4 后 dev-host 与生产环境跑同一份 entry.js

---

## 方案 C：前端入口迁移（真正落实"前端入口"角色）

### C.1 思路

让 `entry.js` 真正成为"前端 minigame 入口"——前端代码（vue/src/App.vue 的内容）拆出独立 entry.js，`ui/game.html` 改为 `<script src="entry.js">` 引入。

### C.2 改动

1. **vue/ 目录整体废弃**：不再 vite build 内联 App.vue 到 game.html
2. **entry.js 重写为 minigame 入口脚本**：纯 JS 写游戏 UI + 输入 + 渲染逻辑，**依赖 toonflowJsApi 调后端**
3. **ui/game.html 简化**：仅 30 行的 HTML 壳 + `<script src="../entry.js"></script>`
4. **后端 entry.ts 拆出独立 game logic**：只保留 handle_action、state 操作、持久化

### C.3 评估

- **优点**：entry.js 的"前端入口"角色真实化，UI/逻辑分离清晰
- **缺点**：toonflow-field-survival 整个 vue/ 重写，工作量大（vue 组件 100+ 个）；开发体验降级（失去 SFC 热更新）
- **建议时机**：插件 API 稳定 + 至少 2 个以上 minigame 插件都愿意迁移时再启动

---

## 方案 D：后端直接读 .ts（消灭双身份）

### D.1 思路

PluginExecutor.loadEntryModule 改用 tsx 加载器读 entry.ts，**删除 entry.js**。manifest.main 字段语义 = "后端 TS 入口"（现名一致）。

### D.2 改动

1. **PluginExecutor.ts:188-199** 改为：
   ```ts
   for (const candidate of [path.join(pluginDir, "entry.ts"), path.join(pluginDir, "entry.js")]) {
     if (!fs.existsSync(candidate)) continue;
     try {
       const mod = await tsxImport(candidate);  // tsx loader
       if (mod.handle_action) {
         entryModuleCache.set(pluginDir, { handle_action: mod.handle_action, mtimeMs: stat.mtimeMs, sourcePath: candidate });
         return mod;
       }
     } catch { /* 继续 */ }
   }
   ```
2. **删除 entry.js 与所有 .bak**：仓库不再保留 entry.js
3. **toonflow-game-app/package.json 配 tsx 依赖**（已配）
4. **manifest 校验**：main 字段只接受 .ts

### D.3 评估

- **优点**：彻底消除"编译产物"角色；改 entry.ts 即生效（mtime 失效后）；减少 entry.js 这个"被遗忘的副本"；manifest 字段语义诚实
- **缺点**：tsx 加载比 esbuild 慢（每 tick 不重新 import，但冷启动 0.5-1s）；调试时堆栈映射可能混乱；esbuild 的 tree-shaking/bundling 优势丧失
- **风险**：插件可移植性（如果 60002 不带 tsx 部署，插件就废）
- **建议时机**：与"插件设计"决策一并讨论，不在 toonflow-field-survival 单点推动

---

## 一致性的强制保证
### cli 插件安装过程，程序性保证一致性
python -m toon_plugins plugins --install-all
python -m toon_plugins plugins -i toonflow-field-survival
这两个cli 命令内部保证entry.ts和entry.js的一致性，entryModuleCache 清理。

### web 上进行插件tbg文件安装时。
entryModuleCache 清理。

### 插件vue 的运行，保证一致性
npm run dev or npm run debug  or npm run debug -- --story 赦夜人冥夜走廊-第二季 --conn
三个命令都自己做好 entry.ts 和 entry.js 的一致性保证，entryModuleCache 清理。

## 实施路线

按风险/收益排序，**建议分三步走**：

| 阶段 | 动作 | 预期收益                        | 工期 |
|---|---|---------------------------------|---|
| **第一阶段：止血** | 方案 A.1（文档）+ A.2（git hook）+ A.3（设计文档修订）+ **三个入口的一致性强制保证** | 阻止进一步漂移 + 新人理解一致 + 一致性程序性保证 | 1-2 天 |
| **第二阶段：自动化** | 方案 B 全部（esbuild + sync + mtime + dev-host 同源） | 改 entry.ts 一行 = 链路生效     | 3-5 天 |
| **第三阶段：演进** | 方案 C 或 D（选一个，作为插件设计层面决策） | 角色统一，长期可维护            | 视插件数量决定 |

**当前推荐立即执行第一阶段**（最小成本、零风险、立刻堵住新人误解路径）。第二阶段在下一次插件大改时一并做。第三阶段放到插件 API 评审时讨论。

## 落地 checklist（第一阶段）

- [x] 写 `entry.js和entry.ts 的关系和说明.md`（10-07 已写）
- [x] 写 `插件工作机制.md`（10-08 已写）
- [x] 写本优化方案（10-08）
- [x] **一致性的强制保证（程序性，10-08 已落代码）**
  - [x] `toonflow-game-app/src/lib/pluginEntryConsistency.ts` 新建：esbuild 现编 + 清 entryModuleCache 统一函数
  - [x] `toonflow-game-app/src/lib/PluginExecutor.ts` 改 mtime 失效 + 导出 `clearEntryCache()`
  - [x] `toonflow-game-app/src/routes/plugin/rebuild.ts` 新建：`POST /plugin/rebuild`
  - [x] `toonflow-game-app/src/router.ts` 注册路由
  - [x] `toonflow-game-app/src/routes/plugin/install.ts` 网页装后调 ensureEntryConsistency
  - [x] `toonflow-game-plugins/src/toon_plugins/toon_client.py` 加 `rebuild_entry()`
  - [x] `toonflow-game-plugins/src/toon_plugins/cli.py` install_cmd 装完调 rebuild_entry
  - [x] `toonflow-game-plugins/plugins/toonflow-field-survival/vue/vite.config.ts` dev 启动时 fetch /plugin/rebuild
- [ ] 修订 `toonflow-game-app/md/curr_design/插件设计/插件设计.md` § 2.1/4/5.1/6.1 的 entry.js 表述
- [ ] 在 `toonflow-game-plugins` 仓库加 `.git/hooks/pre-commit` 校验 entry.js 一致性（防止 CI 之外的人手编）
- [ ] 把 `entry.js.bak_*` / `entry.js.new` 归档到 `archive/`
- [ ] 文档纳入 PR review checklist：任何提到 entry.js 的 commit 必须附"为什么"理由

## 第一阶段三个入口的一致性保证（已实现）

| 入口 | 触发时机 | 实现 | 失败处理 |
|---|---|---|---|
| **CLI 装** `python -m toon_plugins plugins -i xxx` | 装完返回 OK 之后 | `cli.py install_cmd()` → `client.rebuild_entry()` → `POST /plugin/rebuild` → `ensureEntryConsistency()` | 警告不阻塞 |
| **网页装**（5175 上传 .tbg） | 路由 `/plugin/install` 解压后 | 直接调 `ensureEntryConsistency()`（同进程，无需 HTTP） | 警告写入 `result.consistencyWarning` |
| **vue 启动** `npm run dev/debug/--conn` | vite `configureServer` 时 | `http.request('/plugin/rebuild')`（跨进程到 60002） | console.log 不阻塞 vite |

三处都走同一个 `ensureEntryConsistency(userId, pluginId, opts)`，统一做两件事：
1. `npx esbuild entry.ts --outfile=entry.js --format=esm --target=es2020`（如果 entry.ts 存在）
2. `clearEntryCache(pluginDir)`（如果 clearEntryCache 已导出则调；否则 60002 进程级 entryModuleCache Map.delete）

**额外**：PluginExecutor.loadEntryModule 改成 mtime 失效——esbuild 重建后即使没调 clearEntryCache，下一次 tick 也会自动重 import（因为 sourcePath 相同但 mtimeMs 变了）。三道保险：

- mtime 失效（自动，最快生效）
- `clearEntryCache()`（手动，跨进程路由调用）
- 进程重启（兜底，永远有效）

---

## 已完成 vs 未完成（2026-10-08 现状盘点）

### ✅ 第一阶段（止血 + 一致性保证）几乎全完成

**必要核心全到位**：

| 项目 | 状态 |
|---|---|
| 写明现状（3 份文档） | ✅ |
| 修订插件设计.md（§ 2.1/4/5.1/6.1 + 附录 C） | ✅ |
| 程序性一致性保证（3 入口） | ✅ CLI 装 / 网页装 / vue 启动都调统一 `ensureEntryConsistency()` |
| PluginExecutor mtime 失效 | ✅ esbuild 重建后**自动重 import，无需重启 60002** |
| `clearEntryCache()` 导出 | ✅ |
| `POST /plugin/rebuild` 路由 | ✅ |
| 仓库 entry.js 现编（vite 启动时） | ✅ 避免 dev-host 与 user-side 脱节 |

**这条最关键的——改 entry.ts → 三个入口任何一个触发 → 下一帧后端跑新代码——已实现。**

### ⚠️ 第一阶段未完成项（次要 / 加固层）

| 项目 | 必要吗 | 建议 |
|---|---|---|
| git hook 校验 entry.js | **次要** | 程序性保证已落，git hook 是"防 CI 之外的人手编"的最后围栏。**没有也行**，加 15 行 bash 更稳 |
| 归档 `entry.js.bak_*` | **可做可不做** | mtime 失效后"手编 entry.js"已不会导致生产错误，归档价值降低 |
| PR review checklist | **文档性** | 对 AI / 新人有利，没也行 |

**这三项的共同点**：mtime 失效 + 三入口 + clearEntryCache 落地的**当前架构下**，从"防手编"退化成"防意外手编"——价值还在但**不是核心瓶颈**。

### ❌ 第二阶段（自动化）— 未启动

方案 B 全部：sync-plugin.sh 脚本、predev 钩子、dev-host 同源改造。

**核心已通过"三入口主动 rebuild"解决**：
- B.3 缓存失效 = 方案精华，**已实现**
- B.4 dev-host 同源未做但三入口 rebuild 间接保证了 B.2 的同步
- sync-plugin.sh 手动同步等价为"`python -m toon_plugins plugins --install-all`一键重装"——更省事

**第二阶段剩余价值**：**多账号同步**（user 7/8 与 user 1 不一致）。可以靠 install-all 一行解决。

### ❌ 第三阶段（演进 C/D）— 未启动且建议不做

- **D（后端读 .ts，删 entry.js）**：值得做但**不在 toonflow-field-survival 单插件上推**——它影响所有插件的部署形态。应作为插件设计演进讨论的结论。
- **C（前端入口迁移）**：工作量大、收益模糊（vue/ 100+ 组件要拆出来），**不做**。

---

## 结论：继续做还是停

**建议停**——第一阶段已经解决了**实际会出问题的核心场景**：

1. 改 entry.ts → 三个入口触发 → esbuild 现编 + 清缓存 → 下一帧后端跑新代码（**关键，已实现**）
2. 文档口径统一——新人/AI 不会再把 entry.js 误读为"前端入口"（**已实现**）

**剩余 3 项**（git hook / 归档 / checklist）是**防御性**而非**功能性**——核心矛盾已通过程序性保证不再发生。

**真正还应该做的**（按优先级）：

1. **多账号同步**（如果测试时 user 7/8 还要用）：`python -m toon_plugins plugins --install-all`
2. **回归验证**：改 entry.ts 一行 → 走三入口 → 观察实际生效
3. **CI hook**（如果想长期保证）：加 `.husky/pre-commit` 跑 9 行 bash

**不需要做的**：方案 C（前端入口迁移）/ 方案 B.4（dev-host 同源，三入口 rebuild 已隐含）/ 方案 D（跨插件影响大，不在单点推动）
