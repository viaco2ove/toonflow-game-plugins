"""
临时文件上传（TEMP_OSS）—— 复刻 toonflow-game-app 的 src/utils/oss.ts 临时上传部分。

支持的提供商（由 TEMP_OSS 逗号分隔，可多选，按顺序回退）：
    aliyun_oss | aliyun-oss | tmpfiles.org | file.io | transfer.sh
    Cloudflare R2（r2 / cloudflare_r2）暂不支持，仅做提示

阿里云 OSS 走 PostObject 表单直传 + 签名 URL 返回（与 app 一致）。
不依赖 oss2 SDK，只用标准库 + requests，避免额外安装依赖。
"""
import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import quote

import requests

import env_loader
import logger


def parse_providers(raw: str) -> List[str]:
    """解析 TEMP_OSS 配置里的提供商列表。"""
    if not raw:
        return []
    return [p.strip().lower() for p in raw.replace(";", ",").split(",") if p.strip()]


def is_aliyun_provider(provider: str) -> bool:
    return "aliyun" in provider or provider == "oss"


def _encode_object_key(object_key: str) -> str:
    """对象 key 每一段单独编码，避免中文/空格导致直链不可访问。"""
    return "/".join(quote(seg, safe="") for seg in object_key.split("/") if seg)


def _read_aliyun_config() -> Optional[dict]:
    """读取阿里云 OSS 临时上传配置；缺字段返回 None。"""
    bucket = env_loader.get_env("ALIYUN_TEMP_OSS_BUCKET")
    region = env_loader.get_env("ALIYUN_TEMP_OSS_REGION")
    access_key_id = env_loader.get_env("ALIYUN_TEMP_OSS_ACCESS_KEY_ID")
    access_key_secret = env_loader.get_env("ALIYUN_TEMP_OSS_ACCESS_KEY_SECRET")
    if not (bucket and region and access_key_id and access_key_secret):
        return None

    endpoint_raw = env_loader.get_env("ALIYUN_TEMP_OSS_ENDPOINT").rstrip("/")
    endpoint_host = (
        endpoint_raw.replace("https://", "").replace("http://", "")
        if endpoint_raw
        else f"oss-{region}.aliyuncs.com"
    )
    # PostObject 上传走站点根（不带 bucket 前缀）
    root_host = f"https://{endpoint_host}"
    # 访问地址带 bucket 前缀
    access_host = (
        root_host
        if endpoint_host.startswith(f"{bucket}.")
        else f"https://{bucket}.{endpoint_host}"
    )
    return {
        "bucket": bucket,
        "region": region,
        "access_key_id": access_key_id,
        "access_key_secret": access_key_secret,
        "security_token": env_loader.get_env("ALIYUN_TEMP_OSS_SECURITY_TOKEN"),
        "prefix": env_loader.get_env("ALIYUN_TEMP_OSS_PREFIX", "temp/voice-clone").strip("/"),
        "public_base_url": env_loader.get_env("ALIYUN_TEMP_OSS_PUBLIC_BASE_URL").rstrip("/"),
        "root_host": root_host,
        "upload_host": access_host,
        "expires_seconds": max(30, env_loader.get_env_int("ALIYUN_TEMP_OSS_EXPIRES_SECONDS", 900)),
    }


def build_aliyun_signed_get_url(config: dict, object_key: str) -> str:
    """生成阿里云 OSS 临时签名下载 URL（Bucket 私有也能被外部拉取）。"""
    expires = int(time.time()) + config["expires_seconds"]
    encoded_key = _encode_object_key(object_key)
    canonical_resource = f"/{config['bucket']}/{encoded_key}"
    string_to_sign = f"GET\n\n\n{expires}\n{canonical_resource}"
    signature = base64.b64encode(
        hmac.new(
            config["access_key_secret"].encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("ascii")

    base = config["public_base_url"] or config["upload_host"]
    url = f"{base}/{encoded_key}"
    sep = "&" if "?" in url else "?"
    url = (
        f"{url}{sep}OSSAccessKeyId={config['access_key_id']}"
        f"&Expires={expires}&Signature={quote(signature, safe='')}"
    )
    if config.get("security_token"):
        url += f"&security-token={quote(config['security_token'], safe='')}"
    return url


def _upload_to_aliyun(data: bytes, filename: str) -> Optional[str]:
    """
    PostObject 表单直传到阿里云 OSS。

    注意：POST 地址是 OSS 站点根（不带 bucket 前缀），
    bucket 与 key 都放在 policy conditions 里，这是 PostObject 的标准用法。
    """
    config = _read_aliyun_config()
    if not config:
        logger.warn("[TEMP_OSS] 阿里云配置缺失，跳过")
        return None

    object_key = f"{config['prefix']}/{int(time.time())}-{filename}".lstrip("/")

    policy = {
        "expiration": (datetime.now(timezone.utc) + timedelta(minutes=10)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "conditions": [
            {"bucket": config["bucket"]},
            {"key": object_key},
            ["content-length-range", 1, max(len(data), 1) + 1024],
            ["eq", "$success_action_status", "200"],
        ],
    }

    policy_b64 = base64.b64encode(
        json.dumps(policy).encode("utf-8")
    ).decode("ascii")

    form = {
        "key": object_key,
        "policy": policy_b64,
        "OSSAccessKeyId": config["access_key_id"],
        "Signature": base64.b64encode(
            hmac.new(
                config["access_key_secret"].encode("utf-8"),
                policy_b64.encode("utf-8"),
                hashlib.sha1,
            ).digest()
        ).decode("ascii"),
        "success_action_status": "200",
    }
    if config.get("security_token"):
        form["x-oss-security-token"] = config["security_token"]

    try:
        # PostObject 必须打到 bucket 虚拟主机（不带 bucket 前缀会返回 NoSuchBucket）
        resp = requests.post(
            config["upload_host"],
            data=form,
            files={"file": (filename, data)},
            timeout=120,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warn(f"[TEMP_OSS] 阿里云上传失败: {e}")
        return None

    if config.get("public_base_url"):
        return f"{config['public_base_url']}/{_encode_object_key(object_key)}"
    return build_aliyun_signed_get_url(config, object_key)


def _normalize_public_url(provider: str, url: str) -> str:
    """tmpfiles 返回的地址需要加 dl/ 才是直链。"""
    url = url.strip()
    if "tmpfiles" in provider and url.startswith("http"):
        head, sep, tail = url.partition("/")
        parts = tail.split("/")
        if len(parts) >= 2:
            return f"{head}/{sep}{parts[0]}/dl/{parts[1]}"
    return url


def _upload_to_single(data: bytes, filename: str, provider: str) -> Optional[str]:
    """向单个提供商上传，返回公网 URL。"""
    try:
        if is_aliyun_provider(provider):
            return _upload_to_aliyun(data, filename)

        if "tmpfiles" in provider:
            resp = requests.post(
                "https://tmpfiles.org/api/v1/upload",
                files={"file": (filename, data)},
                timeout=120,
            )
            resp.raise_for_status()
            payload = resp.json()
            url = (
                payload.get("data", {}).get("url")
                or payload.get("data", {}).get("link")
                or payload.get("url")
                or payload.get("link")
            )
            if url:
                return _normalize_public_url(provider, url)

        if "file.io" in provider:
            resp = requests.post(
                "https://file.io", files={"file": (filename, data)}, timeout=120
            )
            resp.raise_for_status()
            url = resp.json().get("link") or resp.json().get("url")
            if url:
                return _normalize_public_url(provider, url)

        if "transfer.sh" in provider:
            endpoint = (
                provider if provider.startswith("http") else "https://transfer.sh"
            ).rstrip("/")
            resp = requests.put(
                f"{endpoint}/{quote(filename)}",
                data=data,
                headers={"Content-Type": "application/octet-stream"},
                timeout=120,
            )
            resp.raise_for_status()
            if resp.text.strip():
                return resp.text.strip()
    except Exception as e:
        logger.warn(f"[TEMP_OSS] 上传失败 ({provider}): {e}")

    return None


def upload_temp(data: bytes, filename: str) -> Optional[str]:
    """
    上传到临时文件服务，返回公网 URL。

    未配置 TEMP_OSS 或全部失败返回 None（调用方回退本地路径）。
    """
    providers = parse_providers(env_loader.get_env("TEMP_OSS"))
    if not providers:
        return None
    for provider in providers:
        url = _upload_to_single(data, filename, provider)
        if url:
            logger.info(f"[TEMP_OSS] 上传成功 ({provider}): {url}")
            return url
    return None


def provider_status() -> dict:
    """当前 TEMP_OSS 配置状态（供前端展示与排障）。"""
    providers = parse_providers(env_loader.get_env("TEMP_OSS"))
    aliyun = _read_aliyun_config()
    return {
        "providers": providers,
        "aliyun_configured": bool(aliyun),
        "aliyun_bucket": aliyun["bucket"] if aliyun else "",
        "aliyun_region": aliyun["region"] if aliyun else "",
    }
