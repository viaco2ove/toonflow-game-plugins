"""
云端背景分离适配器 —— 复刻 toonflow-game-app 的 src/routes/game/separateRoleAvatar.ts
支持三家云端厂商（与 app 的 manufacturer key 一致）：
    bria             → Bria（/v2/image/edit/remove_background，api_token header）
    aliyun_imageseg  → 阿里云视觉（官方 SDK AdvanceRequest，Action 按 model 字符串推导）
    tencent_ci       → 腾讯云数据万象（COS 上传 + GET ?ci-process=AIPortraitMatting，返回二进制）

三家统一返回带透明通道的前景 PNG bytes，与 avatar_matting.run_matting 对齐。
SDK 缺失时优雅降级：给出明确的安装提示而不是 crash。
"""
import io
import json
import re
import time
import uuid
from typing import Optional, Tuple
from urllib.parse import urlparse

import requests
from PIL import Image

ALIYUN_IMAGESEG_DEFAULT_BASE = "https://imageseg.cn-shanghai.aliyuncs.com"
ALIYUN_IMAGESEG_DEFAULT_REGION = "cn-shanghai"

BRIA_DEFAULT_BASE = "https://engine.prod.bria-api.com/v2/image/edit"


class MattingConfigError(Exception):
    """配置格式错误（apiKey/baseUrl 不合法）——用户可自行修正。"""


class MattingProviderError(Exception):
    """云端调用失败（网络/鉴权/配额等）。"""


# ───────────────────────── 通用工具 ─────────────────────────

def _normalize_image_bytes(image_bytes: bytes) -> bytes:
    """统一转成 RGBA PNG，避免 jpeg 等格式在各家管线里出问题。"""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _download(url: str, headers: Optional[dict] = None, timeout: int = 90) -> bytes:
    try:
        resp = requests.get(url, headers=headers or {}, timeout=timeout)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException as e:
        raise MattingProviderError(f"下载结果图失败: {e}")


# ───────────────────────── Bria ─────────────────────────

def normalize_bria_base(base: Optional[str]) -> str:
    """对齐 app 的 normalizeBriaBaseUrl：剥尾部斜杠和误填的 path。"""
    normalized = (base or "").strip().rstrip("/")
    if not normalized:
        return BRIA_DEFAULT_BASE
    if re.search(r"/(remove_background|erase_foreground)$", normalized, re.I):
        normalized = re.sub(r"/(remove_background|erase_foreground)$", "", normalized, flags=re.I)
    return normalized


def call_bria_edit(api_key: str, base_url: Optional[str], path: str, payload: dict) -> bytes:
    """Bria 单次编辑调用；返回 PNG bytes。"""
    if not (api_key or "").strip():
        raise MattingConfigError("Bria 缺少 API token")
    endpoint = f"{normalize_bria_base(base_url)}/{path}"
    try:
        resp = requests.post(
            endpoint,
            json=payload,
            headers={"Content-Type": "application/json", "api_token": api_key.strip()},
            timeout=90,
        )
    except requests.RequestException as e:
        raise MattingProviderError(f"Bria {path} 网络错误: {e}")

    if resp.status_code >= 400:
        try:
            err = resp.json()
            detail = err.get("error", {}).get("message") or err.get("message") or str(err)[:300]
        except Exception:
            detail = resp.text[:300]
        raise MattingProviderError(f"Bria {path} 失败 (HTTP {resp.status_code}): {detail}")

    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    image_url = str(data.get("result", {}).get("image_url") or data.get("image_url") or "").strip()
    if not image_url:
        image_url = _wait_bria_result(api_key, base_url, data)
    if not image_url:
        raise MattingProviderError(f"Bria {path} 未返回图片结果")
    return _download(image_url)


def _wait_bria_result(api_key: str, base_url: Optional[str], data: dict) -> str:
    """Bria 异步任务轮询（对齐 app 的 waitBriaResultImageUrl，最多 30 次 × 1s）。"""
    status_url = str(data.get("status_url") or "").strip()
    request_id = str(data.get("request_id") or "").strip()
    if not status_url and request_id:
        base = normalize_bria_base(base_url).replace("/image/edit", "", flags=re.I)
        status_url = f"{base}/status/{request_id}"
    if not status_url:
        return ""
    for attempt in range(30):
        if attempt:
            time.sleep(1)
        try:
            resp = requests.get(status_url, headers={"api_token": api_key.strip()}, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as e:
            raise MattingProviderError(f"Bria 轮询失败: {e}")
        except ValueError:
            continue
        image_url = str(payload.get("result", {}).get("image_url") or "").strip()
        if image_url:
            return image_url
        status = str(payload.get("status") or "").strip().upper()
        if status in ("ERROR", "UNKNOWN"):
            msg = (payload.get("error", {}).get("message")
                   or payload.get("error", {}).get("detail")
                   or payload.get("message") or "Bria 异步任务失败")
            raise MattingProviderError(str(msg))
    raise MattingProviderError("Bria 异步任务超时，请稍后重试")


def run_bria_matting(image_bytes: bytes, api_key: str, base_url: Optional[str]) -> bytes:
    """对齐 app 的 runDedicatedAvatarMattingJob：并发跑 remove_background + erase_foreground，取前景。"""
    normalized = _normalize_image_bytes(image_bytes)
    data_url = "data:image/png;base64," + __import__("base64").b64encode(normalized).decode()
    common = {"image": data_url, "sync": True, "visual_input_content_moderation": False}
    # 前景保留 alpha；背景层不需要（app 只用前景层）
    return call_bria_edit(api_key, base_url, "remove_background",
                          {**common, "preserve_alpha": True})


# ───────────────────────── 阿里云视觉 ─────────────────────────

def normalize_aliyun_base(base: Optional[str]) -> str:
    normalized = (base or "").strip().rstrip("/")
    return normalized or ALIYUN_IMAGESEG_DEFAULT_BASE


def resolve_aliyun_endpoint(base: Optional[str]) -> str:
    return urlparse(normalize_aliyun_base(base)).netloc or urlparse(ALIYUN_IMAGESEG_DEFAULT_BASE).netloc


def resolve_aliyun_region(base: Optional[str]) -> str:
    matched = re.search(r"imageseg\.([^.]+)\.aliyuncs\.com", resolve_aliyun_endpoint(base), re.I)
    return (matched.group(1).strip() if matched else "") or ALIYUN_IMAGESEG_DEFAULT_REGION


def parse_aliyun_access_key(api_key: str) -> Tuple[str, str]:
    """
    对齐 app 的 parseAliyunAccessKeyPair，支持三种格式：
      JSON:  {"accessKeyId": "...", "accessKeySecret": "..."}
      竖线:  AccessKeyId|AccessKeySecret
      两行:  第一行 ID，第二行 Secret
    """
    raw = (api_key or "").strip()
    if not raw:
        raise MattingConfigError("阿里云主体分离缺少 AccessKey 配置")
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            kid = str(parsed.get("accessKeyId") or parsed.get("AccessKeyId") or "").strip()
            secret = str(parsed.get("accessKeySecret") or parsed.get("AccessKeySecret") or "").strip()
            if kid and secret:
                return kid, secret
        except json.JSONDecodeError:
            pass
    if "|" in raw:
        kid, secret = raw.split("|", 1)
        kid, secret = kid.strip(), secret.strip()
        if kid and secret:
            return kid, secret
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) >= 2:
        return lines[0], "".join(lines[1:])
    raise MattingConfigError("阿里云主体分离的 API Key 格式无效，请填写 AccessKeyId|AccessKeySecret 或 JSON")


class AliyunMattingAction:
    """对齐 app 的 resolveAliyunMattingAction。注意字段名：hdcommon 用 image_urlobject（全小写）。"""
    CATALOG = [
        # (matcher, action, RequestCls, request_field, sdk_method)
        (lambda n: n == "segmenthdbody" or "hdbody" in n,
         "SegmentHDBody", "SegmentHDBodyAdvanceRequest", "image_urlobject", "segment_hdbody_advance"),
        (lambda n: n == "segmentbody" or n.endswith("body"),
         "SegmentBody", "SegmentBodyAdvanceRequest", "image_urlobject", "segment_body_advance"),
        (lambda n: n == "segmenthdcommonimage" or "hdcommon" in n,
         "SegmentHDCommonImage", "SegmentHDCommonImageAdvanceRequest", "image_urlobject", "segment_hdcommon_image_advance"),
    ]
    DEFAULT = ("SegmentCommonImage", "SegmentCommonImageAdvanceRequest", "image_urlobject", "segment_common_image_advance")

    @classmethod
    def resolve(cls, model: Optional[str]):
        normalized = (model or "").strip().lower()
        for matcher, action, req_cls, field, method in cls.CATALOG:
            if matcher(normalized):
                return action, req_cls, field, method
        return cls.DEFAULT


def _extract_aliyun_image_url(payload) -> str:
    """对齐 app 的 extractAliyunImageUrlFromResult：挨个试候选路径，Data.Result 可能是 JSON 字符串。"""
    def scan(node) -> str:
        if not isinstance(node, dict):
            return ""
        candidates = [
            node.get("ImageURL"), node.get("ImageUrl"),
            node.get("imageURL"), node.get("imageUrl"),   # app 里 data.imageUrl / result.imageURL 是小写开头
            node.get("URL"), node.get("Url"),
            node.get("OutputURL"), node.get("OutputUrl"),
            node.get("ForegroundURL"), node.get("ForegroundUrl"),
        ]
        for c in candidates:
            value = str(c or "").strip()
            if value:
                return value
        return ""

    def walk(node) -> str:
        if not isinstance(node, dict):
            return ""
        found = scan(node)
        if found:
            return found
        # 嵌套：Data / Result（可能是 dict，也可能是 JSON 字符串）
        for key in ("Data", "data", "Result", "result"):
            child = node.get(key)
            if isinstance(child, dict):
                found = walk(child)
                if found:
                    return found
            elif isinstance(child, str) and child.strip().startswith("{"):
                try:
                    found = walk(json.loads(child))
                except json.JSONDecodeError:
                    continue
                if found:
                    return found
        return ""

    return walk(payload or {})


def _extract_aliyun_error(payload) -> str:
    if not isinstance(payload, dict):
        return ""
    code = payload.get("Code") or payload.get("code") or (payload.get("Data") or {}).get("Code") or ""
    message = payload.get("Message") or payload.get("message") or (payload.get("Data") or {}).get("Message") or ""
    request_id = payload.get("RequestId") or payload.get("requestId") or ""
    parts = []
    if code:
        parts.append(f"[{code}]")
    if message:
        parts.append(str(message))
    if request_id:
        parts.append(f"(RequestId: {request_id})")
    return " ".join(parts)


def run_aliyun_matting(image_bytes: bytes, api_key: str, base_url: Optional[str], model: Optional[str]) -> bytes:
    """阿里云主体分离（官方 SDK AdvanceRequest 链路，避免外部临时链接被 InvalidImage.URL 拒绝）。"""
    normalized = _normalize_image_bytes(image_bytes)
    access_key_id, access_key_secret = parse_aliyun_access_key(api_key)

    try:
        from alibabacloud_imageseg20191230.client import Client as ImagesegClient
        from alibabacloud_imageseg20191230 import models as imageseg_models
        from alibabacloud_tea_openapi import models as openapi_models
        from alibabacloud_tea_util import models as util_models
    except ImportError as e:
        raise MattingProviderError(
            "阿里云视觉 SDK 未安装，请运行：pip install alibabacloud_imageseg20191230"
        ) from e

    action, req_cls, field, method = AliyunMattingAction.resolve(model)

    config = openapi_models.Config(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        endpoint=resolve_aliyun_endpoint(base_url),
        region_id=resolve_aliyun_region(base_url),
    )
    config.protocol = "HTTPS"
    client = ImagesegClient(config)

    request_cls = getattr(imageseg_models, req_cls)
    request = request_cls(**{field: normalized})
    runtime = util_models.RuntimeOptions(connect_timeout=10000, read_timeout=90000, autoretry=False, max_attempts=1)

    try:
        response = getattr(client, method)(request, runtime)
    except Exception as e:
        # Tea 异常里 body 一般带 Code/Message
        body = getattr(e, "data", None)
        body = getattr(body, "body", None) if body is not None else None
        detail = _extract_aliyun_error(body) or str(e)
        raise MattingProviderError(f"阿里云主体分离 {action} 失败: {detail}") from e

    body = getattr(response, "body", response)
    image_url = _extract_aliyun_image_url(body)
    if not image_url:
        detail = _extract_aliyun_error(body)
        raise MattingProviderError(
            f"阿里云主体分离 {action} 未返回图片结果" + (f"（{detail}）" if detail else "")
        )
    return _download(image_url)


# ───────────────────────── 腾讯云数据万象 ─────────────────────────

def parse_tencent_access_key(api_key: str) -> Tuple[str, str, Optional[str]]:
    """对齐 app 的 parseTencentAccessKeyPair：JSON / SecretId|SecretKey[|SessionToken] / 三行文本。"""
    raw = (api_key or "").strip()
    if not raw:
        raise MattingConfigError("腾讯云主体分离缺少 SecretId / SecretKey 配置")
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            sid = str(parsed.get("secretId") or parsed.get("SecretId") or "").strip()
            skey = str(parsed.get("secretKey") or parsed.get("SecretKey") or "").strip()
            token = str(parsed.get("sessionToken") or parsed.get("SessionToken") or parsed.get("token") or "").strip()
            if sid and skey:
                return sid, skey, token or None
        except json.JSONDecodeError:
            pass
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    if len(parts) >= 2 and not re.match(r"^https?://", parts[0], re.I):
        return parts[0], parts[1], parts[2] if len(parts) >= 3 else None
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) >= 2:
        return lines[0], lines[1], lines[2] if len(lines) >= 3 else None
    raise MattingConfigError("腾讯云主体分离的 API Key 格式无效，请填写 SecretId|SecretKey 或 JSON")


def parse_tencent_bucket(base_url: Optional[str]) -> Tuple[str, str]:
    """对齐 app 的 parseTencentCosBucketConfig：JSON / bucket|region / 标准 COS 桶域名。"""
    raw = (base_url or "").strip()
    if not raw:
        raise MattingConfigError("腾讯云主体分离缺少 COS 存储桶地址，请填写标准 COS 桶域名")
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            bucket = str(parsed.get("bucket") or parsed.get("Bucket") or "").strip()
            region = str(parsed.get("region") or parsed.get("Region") or "").strip()
            if bucket and region:
                return bucket, region
        except json.JSONDecodeError:
            pass
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    if len(parts) >= 2 and not re.match(r"^https?://", parts[0], re.I):
        return parts[0], parts[1]
    normalized_url = raw if re.match(r"^https?://", raw, re.I) else f"https://{raw}"
    try:
        host = urlparse(normalized_url).netloc
    except Exception:
        raise MattingConfigError("腾讯云主体分离的 Base URL 无效，请填写标准 COS 桶域名")
    matched = re.match(r"^([^.]+)\.(?:cos|ci)\.([^.]+)\.myqcloud\.com$", host, re.I)
    if not matched:
        raise MattingConfigError(
            "腾讯云主体分离的 Base URL 必须是标准 COS 桶域名，例如 https://bucket-appid.cos.ap-shanghai.myqcloud.com"
        )
    return matched.group(1).strip(), matched.group(2).strip()


def run_tencent_matting(image_bytes: bytes, api_key: str, base_url: Optional[str], model: Optional[str]) -> bytes:
    """腾讯云数据万象：先 putObject 上传源图，再 GET ?ci-process=AIPortraitMatting，返回二进制，最后删源图。"""
    normalized = _normalize_image_bytes(image_bytes)
    secret_id, secret_key, session_token = parse_tencent_access_key(api_key)
    bucket, region = parse_tencent_bucket(base_url)
    action = "AIPortraitMatting"   # 对齐 app 的 resolveTencentMattingAction：恒为此值

    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError:
        raise MattingProviderError("腾讯云 COS SDK 未安装，请运行：pip install cos-python-sdk-v5")

    client = CosS3Client(CosConfig(
        Region=region, SecretId=secret_id, SecretKey=secret_key, Token=session_token or None,
    ))
    source_key = f"toonflow/avatar-matting/source/{uuid.uuid4().hex}.png"
    try:
        try:
            client.put_object(Bucket=bucket, Key=source_key, Body=normalized, ContentType="image/png")
        except Exception as e:
            raise MattingProviderError(f"腾讯云上传头像分离源图失败: {e}") from e
        try:
            resp = client.get_object(Bucket=bucket, Key=source_key, Query={"ci-process": action})
            body = resp.get("Body")
            content = body.getrawdata() if hasattr(body, "getrawdata") else (body.read() if body else b"")
        except Exception as e:
            raise MattingProviderError(f"腾讯云主体分离 {action} 失败: {e}") from e
        if not content:
            raise MattingProviderError("腾讯云主体分离未返回图片结果")
        return content
    finally:
        try:
            client.delete_object(Bucket=bucket, Key=source_key)
        except Exception:
            pass


# ───────────────────────── 统一分发 ─────────────────────────

CLOUD_MATTING_MANUFACTURERS = {"bria", "aliyun_imageseg", "tencent_ci"}


def is_cloud_matting_manufacturer(manufacturer: Optional[str]) -> bool:
    return (manufacturer or "").strip().lower() in CLOUD_MATTING_MANUFACTURERS


def run_cloud_matting(
    image_bytes: bytes,
    manufacturer: str,
    api_key: str,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
) -> bytes:
    """统一入口：按厂商分发，返回带透明通道的前景 PNG bytes。"""
    normalized_mfr = (manufacturer or "").strip().lower()
    if normalized_mfr == "bria":
        return run_bria_matting(image_bytes, api_key, base_url)
    if normalized_mfr == "aliyun_imageseg":
        return run_aliyun_matting(image_bytes, api_key, base_url, model)
    if normalized_mfr == "tencent_ci":
        return run_tencent_matting(image_bytes, api_key, base_url, model)
    raise MattingConfigError(f"不支持的云端抠图厂商: {manufacturer}")
