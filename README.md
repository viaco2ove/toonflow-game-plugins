# toon_plugins — Toonflow Game Plugin CLI
https://github.com/viaco2ove/toonflow-game-plugins.git

类 `tavo_plugins` 的 Toonflow 版 CLI，无需落盘，直接 base64 上传插件。

## 安装

```bash
pip install -e src/
```

## 配置

在 `toonflow-game-plugins/.env` 中已有配置：

```env
game_app_service_url=http://localhost:60002/
auth_token=eyJhbGci...   # JWT token（admin userId=1）
```

CLI 自动从 `.env` 读取 URL 和 Token。

## 命令

### `python -m toon_plugins plugins`

列出已安装的插件。

```
Installed plugins:
  [+] 野外生存 v1.0.0 (com.toonflow.minigame-field-survival)
```

### `python -m toon_plugins plugins --install-all --no-tpg`

把 `plugins/` 下的所有插件目录打成 zip → base64 → 调用 `/plugin/install` API 安装到服务器，**不落盘**。

```bash
python -m toon_plugins plugins --install-all --no-tpg
[OK] toonflow-field-survival (com.toonflow.minigame-field-survival) v1.0.0
--- Done: 1 ok / 0 failed ---
```

### `python -m toon_plugins plugins --install-all`

同上，但同时在 `plugins_tbg/` 目录保存 `.tpg` 文件（与 `tavo_plugins` 行为一致）。

### `python -m toon_plugins plugins -i <name>[,<name>,...]`

指定安装哪些插件（逗号分隔），不加 `--no-tpg` 则保存 tpg。

### `python -m toon_plugins install <dir>`

安装单个插件目录：

```bash
python -m toon_plugins install plugins/toonflow-field-survival
```

## 可编程调用

```python
from toon_plugins.toon_client import ToonClient

client = ToonClient()          # 自动从 .env 读取配置
client = ToonClient(base_url="http://localhost:60002", token="...")

# 列出
plugins = client.list_plugins()

# 安装（base64 in-memory）
client.install_plugin(plugin_id, zip_base64)

# 启用 / 禁用
client.set_plugin_enabled(plugin_id, True)
client.set_plugin_enabled(plugin_id, False)

# 卸载
client.uninstall_plugin(plugin_id)

# 读取插件资源
raw_bytes = client.get_plugin_asset(plugin_id, "ui/game.html")
```

## 目录结构

```
toonflow-game-plugins/
├── .env                        # API 配置
├── src/
│   ├── pyproject.toml
│   └── toon_plugins/
│       ├── __init__.py
│       ├── __main__.py         # python -m toon_plugins
│       ├── cli.py              # click 命令行
│       └── toon_client.py      # REST API 客户端
├── plugins/                    # 插件源码目录
│   └── toonflow-field-survival/
└── plugins_tbg/                       # --no-tpg=False 时保存的 .tpg 文件
```
