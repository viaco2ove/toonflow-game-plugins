# backend/env —— 环境配置

复刻 toonflow-game-app 的 `env/` 目录与 `src/env.ts` 加载逻辑。

## 用法

```bash
python server.py local     # 加载 env/.env.local
python server.py dev       # 加载 env/.env.dev
python server.py prod      # 加载 env/.env.prod
python server.py           # 不带参数：按 NODE_ENV 兜底为 dev
```

优先级：命令行参数 > `NODE_ENV` 环境变量 > `dev`。

## 加载语义（与 app 一致）

- 配置文件：`env/.env.<环境名>`，不存在时自动用默认值创建
- 缺失的新字段会自动补齐到文件末尾（向后兼容历史配置）
- 默认以 env 文件为准；仅当 `PREFER_PROCESS_ENV=1` 时保留外部注入值
- 变量写入 `os.environ`，全部通过 `env_loader.get_env*` 读取

## 主要变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 后端端口，默认 8000 |
| `LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `LOG_PATH` | 日志目录，按天切分为 `app-YYYY-MM-DD.log`；未配置回退 `backend/logs` |
| `MODEL_path` | 本地工具根目录，抠图模型的 venv / 权重都放这里（默认指向 app 的 tools 目录，从而与 app 共用已下好的模型） |
| `AI_TEXT_DEBUG_HTTP_REQ` | `=1` 时把每次 HTTP 请求体落盘到日志目录 |
| `AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH` | 请求体日志目录，一个请求一个 `req_<时间戳>_<label>.json` |
| `TEMP_OSS` | 临时上传提供商，逗号分隔可多选：`aliyun_oss` / `tmpfiles.org` / `file.io` / `transfer.sh` |
| `ALIYUN_TEMP_OSS_*` | 阿里云 OSS 配置：`BUCKET` / `REGION` / `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET` / `PREFIX` / `EXPIRES_SECONDS` 等 |

## 请求体日志

`AI_TEXT_DEBUG_HTTP_REQ=1` 时，每次调用 AI 接口前会先落盘一条请求（URL / headers / body）。
`Authorization`、`api-key` 等敏感头自动脱敏（保留前 12 字符）。

```json
{
  "_meta": { "label": "text_chat_completions", "method": "POST", "url": "..." },
  "headers": { "Authorization": "Bearer sk-te***" },
  "body": { "model": "gpt-4o", "messages": [...] }
}
```