"""
日志与请求体落盘 —— 复刻 toonflow-game-app 的 src/logger.ts + src/utils/ai/debugReqDump.ts。

两个能力：

1) LOG_PATH / LOG_LEVEL
   - 按天切分日志文件：app-YYYY-MM-DD.log
   - LOG_LEVEL 控制输出级别（DEBUG/INFO/WARN/ERROR）
   - 未配置 LOG_PATH 时回退到 backend/logs

2) AI_TEXT_DEBUG_HTTP_REQ
   - =1 且配置了 AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH 时，把每次 HTTP 请求体落盘
   - 一个请求一个 JSON 文件：req_<timestamp>_<label>.json
   - 落盘失败只记录错误，不阻断业务
"""
import json
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import env_loader

_LEVELS = {"DEBUG": 10, "INFO": 20, "WARN": 30, "ERROR": 40}

_lock = threading.Lock()
_log_file: Optional[Path] = None
_current_date_key = ""


def _level_value() -> int:
    raw = env_loader.get_env("LOG_LEVEL", "INFO").upper()
    return _LEVELS.get(raw, _LEVELS["INFO"])


def log_dir() -> Path:
    """日志目录：LOG_PATH 优先，其次 backend/logs。"""
    configured = env_loader.get_env("LOG_PATH")
    if configured:
        p = Path(configured)
        return p if p.is_absolute() else (env_loader.BACKEND_DIR / p)
    return env_loader.BACKEND_DIR / "logs"


def _today_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _ensure_log_file() -> Path:
    """按天切换日志文件。"""
    global _log_file, _current_date_key
    today = _today_key()
    if _log_file is not None and _current_date_key == today:
        return _log_file
    directory = log_dir()
    directory.mkdir(parents=True, exist_ok=True)
    _log_file = directory / f"app-{today}.log"
    _current_date_key = today
    return _log_file


def _write(level: str, message: str) -> None:
    """写日志文件 + 控制台。"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    line = f"[{ts}] [{level}] {message}"
    with _lock:
        try:
            with open(_ensure_log_file(), "a", encoding="utf-8") as fp:
                fp.write(line + "\n")
        except Exception:
            pass

    console = {
        "DEBUG": sys.stderr,
        "INFO": sys.stdout,
        "WARN": sys.stderr,
        "ERROR": sys.stderr,
    }.get(level, sys.stdout)
    try:
        console.write(line + "\n")
        console.flush()
    except Exception:
        pass


def debug(message: str) -> None:
    if _level_value() <= _LEVELS["DEBUG"]:
        _write("DEBUG", message)


def info(message: str) -> None:
    if _level_value() <= _LEVELS["INFO"]:
        _write("INFO", message)


def warn(message: str) -> None:
    if _level_value() <= _LEVELS["WARN"]:
        _write("WARN", message)


def error(message: str) -> None:
    if _level_value() <= _LEVELS["ERROR"]:
        _write("ERROR", message)


# ───────────────────────── 请求体落盘 ─────────────────────────
_SANITIZE_RE = re.compile(r'[/:\\?%*|"<>]')

# 需要脱敏的请求头（保留前 12 字符）
_SENSITIVE_HEADERS = {"authorization", "api-key", "x-api-key", "x-goog-api-key"}


def req_dump_enabled() -> bool:
    """AI_TEXT_DEBUG_HTTP_REQ=1 且配置了日志目录时才落盘。"""
    return (
        env_loader.get_env("AI_TEXT_DEBUG_HTTP_REQ") == "1"
        and bool(env_loader.get_env("AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH"))
    )


def _sanitize_label(label: str) -> str:
    return _SANITIZE_RE.sub("_", str(label or "unknown"))[:120]


def sanitize_headers(headers: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Authorization 等敏感头脱敏（保留前缀，值打码）。"""
    out: Dict[str, Any] = {}
    for key, value in (headers or {}).items():
        if str(key).lower() in _SENSITIVE_HEADERS:
            text = str(value)
            out[key] = f"{text[:12]}***" if len(text) > 12 else "***"
        else:
            out[key] = value
    return out


def _normalize_body(body: Any) -> Any:
    """body 的落盘形态：可序列化对象原样，二进制降级为摘要。"""
    if body is None:
        return None
    if isinstance(body, (bytes, bytearray)):
        return f"[binary {len(body)}B]"
    if isinstance(body, str):
        try:
            return json.loads(body)
        except (json.JSONDecodeError, TypeError):
            return body[:20000]
    if isinstance(body, dict):
        # bytes 值的字典（multipart 文件等）降级为长度摘要
        out = {}
        for key, value in body.items():
            if isinstance(value, (bytes, bytearray)):
                out[key] = f"[binary {len(value)}B]"
            elif isinstance(value, str) and len(value) > 20000:
                out[key] = value[:20000] + f"…[+{len(value) - 20000} chars]"
            else:
                out[key] = value
        return out
    try:
        json.dumps(body)
        return body
    except (TypeError, ValueError):
        return "[unserializable body]"


def dump_http_request(label: str, entry: Dict[str, Any]) -> Optional[Path]:
    """
    落盘一条 HTTP 请求（一个请求一个 JSON 文件）。

    返回落盘文件路径；未启用或失败返回 None（不抛异常，不阻断业务）。
    """
    if not req_dump_enabled():
        return None
    directory = Path(env_loader.get_env("AI_TEXT_DEBUG_HTTP_REQ_LOG_PATH"))
    if not directory.is_absolute():
        directory = (env_loader.BACKEND_DIR / directory).resolve()
    try:
        directory.mkdir(parents=True, exist_ok=True)
        file_path = directory / f"req_{int(time.time() * 1000)}_{_sanitize_label(label)}.json"
        payload = {
            "_meta": {
                "env": {"AI_TEXT_DEBUG_HTTP_REQ": "1"},
                "label": label,
                "method": entry.get("method") or "POST",
                "url": entry.get("url") or "",
                "dumpedAt": datetime.now().isoformat(),
            },
            "headers": sanitize_headers(entry.get("headers") or {}),
            "body": _normalize_body(entry.get("body")),
        }
        extra = entry.get("extra")
        if extra:
            payload["extra"] = extra
        file_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        debug(f"[ai:req_dump] {file_path}")
        return file_path
    except Exception as e:
        error(f"[ai:req_dump] 写入失败: {e}")
        return None
