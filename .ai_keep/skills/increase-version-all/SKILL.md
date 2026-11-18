---
name: increase-version-all
description: 给 Toonflow Game 的后端（toonflow-game-app）、前端（Toonflow-game-web）、野外生存插件（toonflow-field-survival）三个仓库统一升 patch 版本号（+0.0.01），并可一键统一设为指定版本。Use when the user asks to "升版本号"、"三个仓库都升版本"、"前后端和插件版本一起加"、"把版本设为 x.y.z"、"bump version"。
---

# increase-version-all

## Purpose

Toonflow Game 是**三个独立 git 仓库**（公共父目录 `Toonflow-game/`）：

| 仓库 | 版本位 | 运行时用途 |
| --- | --- | --- |
| `toonflow-game-app`（后端） | `package.json` → `version` | 宿主的 `/other/version` 接口直接回读 |
| `Toonflow-game-web`（前端） | `package.json` → `version` | `vite.config.ts` 自动注入 `import.meta.env.VITE_APP_VERSION`，设置页显示它 |
| `toonflow-game-plugins/plugins/toonflow-field-survival`（插件） | `manifest.json` → `version` | 插件列表显示 + `t_plugin` 表记录 + 打包产物名 `<name>-<version>.tpg.zip` |

本技能把这三处**版本号一起**升 patch 位，避免"改了后端忘了前端""插件版本落后导致装不上"。

## Input

可选：

1. **目标版本**：不指定则各自 +0.0.01（1.0.31 → 1.0.32）；指定则三个仓库统一设为该版本。
2. **仓库根**：默认自动定位。

## 切记

- **只改 version 字段本身**，不要顺手格式化 / 重排整个 JSON —— diff 必须干净。
- **`package-lock.json` 不要改**。它长期落后于 `package.json`（现状：app 的 lock 停在 1.0.29，package.json 已经是 1.0.31），这是仓库既有惯例，锁文件由 `npm install` 自然更新，不属于本技能范围。
- **插件的 `entry.js` 不入库**（`.gitignore`），升版本不需要重新编译；但如果本次改动动了 `entry.ts`，仍需 `npx esbuild entry.ts --outfile=entry.js` 重编译。
- 版本号必须能解析成 `x.y.z` 三段式。遇到 `1.0` / `1.0.0-beta` 这类**不要猜** —— 脚本会报错并跳过，让你先人工确认。

## Process

### Step 1 — 预览（先 dry-run，别直接写）

```bash
cd D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins
python .zcode/skills/increase-version-all/scripts/bump_version.py --dry-run
```

输出形如：

```
仓库根: D:\Users\viaco\tools\Toonflow-game

[DRY] 后端   toonflow-game-app\package.json
        1.0.31  ->  1.0.32
[DRY] 前端   Toonflow-game-web\package.json
        1.0.12  ->  1.0.13
[DRY] 插件   toonflow-game-plugins\plugins\toonflow-field-survival\manifest.json
        1.0.31  ->  1.0.32
```

确认三个版本号都对得上，再进入 Step 2。

### Step 2 — 实际写入

```bash
python .zcode/skills/increase-version-all/scripts/bump_version.py
```

脚本写完会**回读校验**（写进去的值必须能被 `json.load` 读回同一个版本），不一致则报 FAIL。

统一设成指定版本：

```bash
python .zcode/skills/increase-version-all/scripts/bump_version.py --set 2.0.0
```

### Step 3 — 验证 diff 干净

```bash
cd D:/Users/viaco/tools/Toonflow-game
git -C toonflow-game-app diff -- package.json
git -C Toonflow-game-web diff -- package.json
git -C toonflow-game-plugins diff -- plugins/toonflow-field-survival/manifest.json
```

**每个仓库应该只有一行 `-` 一行 `+`，且只涉及 version 那一行。** 若出现整文件重排，说明脚本跑错了仓库根，用 `--root` 指定。

### Step 4 — 提交（按需）

三个仓库是**独立的 git 仓库**，要分别提交：

```bash
cd D:/Users/viaco/tools/Toonflow-game/toonflow-game-app   && git add package.json && git commit -m "chore(package): 更新版本号至<新版本>"
cd D:/Users/viaco/tools/Toonflow-game/Toonflow-game-web   && git add package.json && git commit -m "chore(package): 更新版本号至<新版本>"
cd D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins && git add plugins/toonflow-field-survival/manifest.json && git commit -m "build(toonflow-field-survival): 更新版本号至<新版本>"
```

提交信息沿用仓库既有前缀习惯（`chore(package):` / `build(...):`），可参考 `git log --oneline -- package.json`。
**不要提交其它未完成的工作区改动** —— 只 `git add` 这一个文件。

## 联动影响（升版本后什么会变）

- **后端**：改 `package.json` 后需重启 60002 才能让 `/other/version` 回读新值。
- **前端**：`vite.config.ts` 里 `'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)` 是构建期注入的 → 改了 package.json 需要**重新构建**（`yarn build`）才生效；`yarn dev` 下 vite 会自动重启，注入即刷新。
- **插件**：`manifest.json` 的 version 会进 `t_plugin` 表（装插件时写入）和打包产物名。**已装的旧版本不会自动升级** —— 要让线上插件拿到新版本号，得重新打包并 `POST /plugin/install`。

## 脚本参数

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 只报告，不写文件 |
| `--set X.Y.Z` | 三个仓库统一设为该版本（而非各自 +1） |
| `--root <dir>` | 指定 Toonflow-game 根目录（默认自动定位） |

## 例子

```
/increase-version-all                      # 三个仓库各升 0.0.01
/increase-version-all --set 2.0.0          # 三个仓库统一 2.0.0
/increase-version-all                      # 升完顺便提交三个仓库
```

## Notes

- 脚本只认 `x.y.z`。`1.0.0-beta.1`、`1.0` 之类一律报错跳过，**绝不猜**。
- 插件的 `entry.js` / `ui/` 在 `.gitignore` 内，升版本不影响它们；动了 `entry.ts` 才需要 esbuild 重编译。
- 临时产物（脚本自身的运行输出等）只放 `.cache`，不要写进仓库。
