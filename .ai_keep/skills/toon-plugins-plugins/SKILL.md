---
name: toon-plugins-plugins
description: 用 toon_plugins CLI 上传野外生存插件（plugins/toonflow-field-survival）和全部地图集故事包（workshops/toonflow-field-survival/map_design/<故事>）到 .env 指向的后端（当前=部署机 192.168.31.66:60002）。当用户要求「上传插件」「上传地图集」「部署故事包」「更新任务链到部署机」「重新播种任务」时使用。
---

# toon-plugins-plugins —— 插件与地图集上传

工作目录：仓库根 `D:\Users\viaco\tools\Toonflow-game\toonflow-game-plugins`。
目标后端由仓库根 `../../../.env` 的 `game_app_service_url` 决定（★该 key 重复行 first-wins，确认没有未注释的 localhost 行排在前面）。★部署机 IP 随换网变动（2026-11-18 曾切 192.168.31.66，2026-11-20 起又切回 10.10.2.195），**以 .env 未注释行为准**，操作前先 `curl -m 4 http://<ip>:60002/` 探活（401=活着），别按记忆写死 IP。

使用例子
- /toon-plugins-plugins 用cli 上传插件和全部地图集
## 1. 上传插件

```bash
python -m toon_plugins plugins -i toonflow-field-survival        # 裸 id，等价 --install
python -m toon_plugins plugins --install-all                     # 装 plugins/ 下全部插件
```

- ★ 2026-11-20 已修 CLI（`ensure_entry_js` 入口统一 `os.path.abspath`）：裸 id / `--install-all` 拼出的相对 plugin_dir 曾因「isfile 按当前 cwd 判真、subprocess cwd 切进插件目录后同一相对路径解析失败」报「系统找不到指定的路径」。现两种写法均可用，传绝对路径也兼容。
- 自动流程：`vue/` yarn vite build（产物改名为 manifest 指定的 `ui/game.html`）→ 打包瘦身 zip（剔除 test_data / test-host / node_modules / *.pyc）→ 存 `plugins_tbg/toonflow-field-survival-<版本>.tpg` → 按体积选 raw/json 通道上传 → enable。
- 版本号在 `../../../plugins/toonflow-field-survival/manifest.json`。
- ★ 不会触发后端 esbuild rebuild（`install` 命令才会）。改了 entry.ts 时补 rebuild：`python -c "import sys; sys.path.insert(0,'src'); from toon_plugins.cli import resolve_client; c=resolve_client('.env'); print(c.rebuild_entry('com.toonflow.minigame-field-survival', reason='cli:plugins-upload'))"`（看输出 `rebuilt:true, cacheCleared:true`），或改用 `install` 命令 + 绝对路径（带自动 rebuild）。

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
2. `quest_defs` 是全局键且**各故事委托条目 id 都是 Q01~Q12**——四个故事互相冲突，`_merge` 按 id 去重（旧条目优先）→ 只有先上传的故事的委托表能进去，其余显示「新增 0」。2026-11-20 起远端约定：**quest_defs = 当前活跃故事（末世）的 12 条**；其他故事委托板会错显末世委托（运行时 `ensureQuestDefs` 不按故事过滤，全局单键是既有设计，故事化改造 `quest_defs:<故事>` 待做）。传其他故事前**不要**再删 quest_defs，会连末世的委托表一起丢。
3. `map_visual` / `map_data` 是整键覆盖，无此问题。

## 验证

```bash
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" --list
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" -k "chain_defs:<故事名>" --get
python -m toon_plugins plugin_session_data -i plugins\toonflow-field-survival -story "<故事名>" -k "quest_defs" --get
```

## 已知坑

- **Git Bash 里 `-i plugins\toonflow-field-survival`（反斜杠目录）会生成假 pluginId** `pluginstoonflow-field-survival`（CLI 把 `\` 吞了）→ 操作打到不存在的插件上（显示 [OK] 但无效果）。`-i` 用纯 id `toonflow-field-survival` 或正斜杠路径。
- **HTTP 413**：包体过大（--include-test-data 会把 test_data 打进去）会超限，保持默认瘦身。
- **中文参数**：`-story "<中文名>"` 必须加引号；CLI 走 requests+JSON 通道，中文安全（手工 curl -d 才会 GBK 乱码假 miss）。
- 部署机 login 接口返回的 token 不可用于插件接口，能用的是 iframe src 里的 token 与 .env 里的 auth_token。
