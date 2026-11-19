---
name: toon-plugins-plugins
description: 用 toon_plugins CLI 上传野外生存插件（plugins/toonflow-field-survival）和全部地图集故事包（workshops/toonflow-field-survival/map_design/<故事>）到 .env 指向的后端（当前=部署机 192.168.31.66:60002）。当用户要求「上传插件」「上传地图集」「部署故事包」「更新任务链到部署机」「重新播种任务」时使用。
---

# toon-plugins-plugins —— 插件与地图集上传

工作目录：仓库根 `D:\Users\viaco\tools\Toonflow-game\toonflow-game-plugins`。
目标后端由仓库根 `.env` 的 `game_app_service_url` 决定（★该 key 重复行 first-wins，确认没有未注释的 localhost 行排在前面）。当前部署机：`http://192.168.31.66:60002/`（2026-11-18 换网后 IP）。

使用例子
- /toon-plugins-plugins 用cli 上传插件和全部地图集
## 1. 上传插件

```bash
python -m toon_plugins plugins -i toonflow-field-survival
```

- 自动流程：`vue/` yarn vite build（产物改名为 manifest 指定的 `ui/game.html`）→ 打包瘦身 zip（剔除 test_data / test-host / node_modules / *.pyc）→ 存 `plugins_tbg/toonflow-field-survival-<版本>.tpg` → 按体积选 raw/json 通道上传 → enable。
- 版本号在 `plugins/toonflow-field-survival/manifest.json`。
- ★ 不会触发后端 esbuild rebuild（`install` 命令才会）。改了 entry.ts 需要后端现编时，装完手动调 `/plugin/rebuild`，或改用 `python -m toon_plugins install plugins/toonflow-field-survival --upload-mode raw`（带自动 rebuild）。

## 2. 上传地图集故事包

```bash
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -u workshops\toonflow-field-survival\map_design\<故事目录名> -story "<故事名>"
```

- `-i` 传插件**目录**（含 manifest.json 时自动解析为 manifest.id）。
- `-u` 传目录：打包 `<故事>.tbg`（落在 map_design/ 下，约 4MB）→ 写 `map_visual:<故事名>`（主 key）→ 兼容同步 `map_data:<故事名>` → 自动播种任务数据：
  - `chain_defs:<故事名>` ← `events/任务事件/main-quests.json`
  - `quest_defs`（**全局单键**，四故事共用）← `events/任务事件/quests.json`
- 四个故事目录：`末世选择，从解析神明开始成神` / `赦夜人冥夜走廊-第二季` / `通天传授-收徒系统` / `黑塔：从超忆症开始成神`（`base/` 是底料不传）。

## ★ 最大坑：任务播种「只补不覆盖」

`_seed_story_task_data` 合并时**旧条目优先**——改了已有任务/链的数据（坐标、uid、目标名、数量）后直接 `-u`，输出会显示「新增 0」，改动**不会生效**。

任务数据有变更时的正确流程：

1. 先删该故事的任务链再重传：
   ```bash
   python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" -k "chain_defs:<故事名>" --remove
   python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -u workshops\toonflow-field-survival\map_design\<故事目录> -story "<故事名>"
   ```
2. `quest_defs` 是全局键，删了会波及所有故事——`--remove -k quest_defs` 后必须**四个故事全部重新 `-u`**（每个把自己的 quests.json 补进去，传完即全量 48 条）。
3. `map_visual` / `map_data` 是整键覆盖，无此问题。

## 验证

```bash
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" --list
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" -k "chain_defs:<故事名>" --get
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" -k "quest_defs" --get
```

## 已知坑

- **entry 编译失败（2026-11-20 实测）**：`plugins` / `install` 打包前会无条件重编 entry.js（esbuild `--bundle --format=esm --platform=node --target=node18`），CLI 内 subprocess 调 `node_modules/.bin/esbuild.cmd` 报「系统找不到指定的路径」且 GBK 输出把 utf-8 解码线程弄崩 → 安装中止；手动 `npx esbuild entry.ts --bundle --format=esm --platform=node --target=node18 --outfile=entry.js` 能编译成功但绕不开 CLI 的强制重编。**插件代码没改时不必重传**（远端已是最新版），待修 CLI 的编译调用。
- **HTTP 413**：包体过大（--include-test-data 会把 test_data 打进去）会超限，保持默认瘦身。
- **中文参数**：`-story "<中文名>"` 必须加引号；CLI 走 requests+JSON 通道，中文安全（手工 curl -d 才会 GBK 乱码假 miss）。
- 部署机 login 接口返回的 token 不可用于插件接口，能用的是 iframe src 里的 token 与 .env 里的 auth_token。
