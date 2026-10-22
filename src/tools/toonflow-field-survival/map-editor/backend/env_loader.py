"""
环境配置加载器 —— 复刻 toonflow-game-app 的 src/env.ts 方案。

用法：
    python server.py local      # 加载 env/.env.local
    python server.py dev        # 加载 env/.env.dev
    python server.py prod       # 加载 env/.env.prod
    python server.py            # 不带参数：按 NODE_ENV 或 dev 兜底

语义与 app 对齐：
  - 配置文件放在 backend/env/.env.<环境名>
  - 默认以 env 文件为准；仅当 PREFER_PROCESS_ENV=1 时保留外部注入值
  - 缺失的必需字段自动补齐（向后兼容历史配置文件）
  - 环境变量写入 os.environ，模块内所有读取都走 os.environ

被支持的关键变量：
  LOG_LEVEL / LOG_PATH                          —— 日志级别与日志目录
  AI_TEXT_DEBUG_HTTP_REQ                       —— =1 时把 HTTP 请求体落盘
  AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH              —— 请求体日志目录
  TEMP_OSS                                     —— 临时文件上传提供商（支持 aliyun_oss）
  ALIYUN_TEMP_OSS_*                            —— 阿里云 OSS 临时上传配置
"""
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

BACKEND_DIR = Path(__file__).parent
ENV_DIR = BACKEND_DIR / "env"

# 支持的环境名（对应 env/.env.<name>）
KNOWN_ENVS = ("local", "dev", "prod")

# 历史配置补齐：缺失时追加到文件末尾（对齐 app env.ts 的 requiredKeys）
REQUIRED_KEYS: List[Dict[str, str]] = [
    {"key": "NODE_ENV", "value": "local"},
    {"key": "PORT", "value": "8000"},
    {"key": "LOG_LEVEL", "value": "INFO"},
    {"key": "LOG_PATH", "value": ""},
    {"key": "DEBUG_AI_TEXT", "value": "0"},
    {"key": "DEBUG_AI_TEXT_VERBOSE", "value": "0"},
    {"key": "AI_TEXT_DEBUG_HTTP", "value": "0"},
    {"key": "AI_TEXT_DEBUG_HTTP_AUTO", "value": "1"},
    {"key": "AI_TEXT_DEBUG_HTTP_VERBOSE", "value": "0"},
    {"key": "AI_TEXT_DEBUG_HTTP_REQ", "value": "0"},
    {"key": "AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH", "value": ""},
    {"key": "TEMP_OSS", "value": ""},
]

# 环境名 → 默认 NODE_ENV 值
_ENV_NODE_ENV = {
    "local": "local",
    "dev": "dev",
    "prod": "prod",
}

_loaded = False
_loaded_env_name = ""


def resolve_env_name(argv: Optional[List[str]] = None) -> str:
    """
    解析启动参数里的环境名。

    优先级：
      1. 命令行第一个非 --xxx 参数（local / dev / prod）
      2. 进程环境变量 NODE_ENV
      3. dev 兜底
    """
    args = list(argv if argv is not None else sys.argv[1:])
    for arg in args:
        if arg.startswith("-"):
            continue
        name = arg.strip().lower()
        if name in KNOWN_ENVS:
            return name
    node_env = (os.environ.get("NODE_ENV") or "").strip().lower()
    if node_env in KNOWN_ENVS:
        return node_env
    return "dev"


def _parse_env_text(text: str) -> Dict[str, str]:
    """解析 .env 文本为字典（忽略空行与 # 注释）。"""
    result: Dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        idx = line.find("=")
        if idx <= 0:
            continue
        key = line[:idx].strip()
        value = line[idx + 1:].strip()
        # 去掉引号包裹
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        result[key] = value
    return result


def _read_env_file(env_name: str) -> str:
    """读取 env 文件内容；不存在则用默认值创建。"""
    env_dir = ENV_DIR
    env_file = env_dir / f".env.{env_name}"
    if env_file.exists():
        return env_file.read_text(encoding="utf-8")

    # 文件不存在 → 自动创建（对齐 app 的行为）
    env_dir.mkdir(parents=True, exist_ok=True)
    # 新建文件里 NODE_ENV 直接写当前环境名，避免残留其它环境的取值
    lines = [
        f"{item['key']}={_ENV_NODE_ENV.get(env_name, env_name) if item['key'] == 'NODE_ENV' else item['value']}"
        for item in REQUIRED_KEYS
    ]
    default_text = "\n".join(lines)
    env_file.write_text(default_text + "\n", encoding="utf-8")
    print(f"[env] created {env_file}")
    return default_text


def _ensure_required_keys(text: str, env_name: str) -> str:
    """历史配置文件补齐新增字段（保持向后兼容）。"""
    missing = [
        item for item in REQUIRED_KEYS
        if not any(
            line.strip().startswith(f"{item['key']}=")
            for line in text.splitlines()
        )
    ]
    if not missing:
        return text
    suffix = "\n".join(f"{item['key']}={item['value']}" for item in missing)
    env_file = ENV_DIR / f".env.{env_name}"
    text = f"{text.rstrip()}\n{suffix}\n"
    env_file.write_text(text, encoding="utf-8")
    print(f"[env] patched {env_file} (+{len(missing)} keys)")
    return text


def load_env(env_name: Optional[str] = None, force: bool = False) -> str:
    """
    加载指定环境的配置到 os.environ。

    默认幂等（已加载则直接返回）；force=True 时强制重读 env 文件，
    适用于 server.py 在导入后用 CLI 参数再次明确指定环境的场景。

    返回最终生效的环境名。
    """
    global _loaded, _loaded_env_name
    if _loaded and not force:
        return _loaded_env_name

    name = (env_name or resolve_env_name()).strip().lower()
    if name not in KNOWN_ENVS:
        print(f"[env] unknown env '{name}', fallback to dev")
        name = "dev"

    text = _read_env_file(name)
    text = _ensure_required_keys(text, name)
    parsed = _parse_env_text(text)

    # 兼容：env 文件里没写 NODE_ENV 时，按环境名补上
    parsed.setdefault("NODE_ENV", _ENV_NODE_ENV.get(name, name))
    # 无论文件里怎么写，NODE_ENV 始终等于实际加载的环境名，
    # 避免复制 .env.local 成 .env.prod 后残留 local。
    parsed["NODE_ENV"] = name

    # 默认以 env 文件为准；仅当显式开启 PREFER_PROCESS_ENV=1 时保留外部注入值
    preserve_process_env = (parsed.get("PREFER_PROCESS_ENV") or "").strip() == "1"

    applied = 0
    for key, value in parsed.items():
        current = os.environ.get(key)
        if not preserve_process_env or current is None or current == "":
            os.environ[key] = value
            applied += 1

    os.environ["NODE_ENV"] = name
    _loaded = True
    _loaded_env_name = name

    env_file = ENV_DIR / f".env.{name}"
    print(f"[env] {name}")
    print(f"[env] file {env_file}")
    print(f"[env] applied {applied} vars (preserve_process_env={preserve_process_env})")
    return name


def get_env(name: str, default: str = "") -> str:
    """读取环境变量（去掉首尾空白）。"""
    return (os.environ.get(name) or default).strip()


def get_env_int(name: str, default: int = 0) -> int:
    """读取整型环境变量；非法值回退默认值。"""
    raw = get_env(name)
    if not raw:
        return default
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return default


def get_env_bool(name: str, default: bool = False) -> bool:
    """读取布尔型环境变量：1/true/yes/on 视为真。"""
    raw = get_env(name).lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def resolve_path(raw_value: str, fallback: str = "") -> str:
    """
    解析配置里的路径。

    - 去掉引号
    - 绝对路径原样返回（兼容 Windows 与 WSL 风格）
    - 相对路径按 backend 目录解析
    """
    value = (raw_value or "").strip().strip("'\"").strip()
    if not value:
        return fallback
    p = Path(value)
    if p.is_absolute() or value.startswith("\\\\"):
        return value
    return str((BACKEND_DIR / p).resolve())


if __name__ == "__main__":
    # 允许 `python env_loader.py local` 单独调试
    name = load_env()
    print(f"[env] NODE_ENV={get_env('NODE_ENV')}")
    print(f"[env] LOG_PATH={get_env('LOG_PATH')}")
    print(f"[env] AI_TEXT_DEBUG_HTTP_REQ={get_env('AI_TEXT_DEBUG_HTTP_REQ')}")
    print(f"[env] AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH={get_env('AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH')}")
    print(f"[env] TEMP_OSS={get_env('TEMP_OSS')}")
else:
    # 被其它模块导入时自动加载，保证任何入口（server / 脚本 / 测试）
    # 读到的环境变量都一致。对齐 app 中 env.ts 在模块加载时生效的语义。
    load_env()
