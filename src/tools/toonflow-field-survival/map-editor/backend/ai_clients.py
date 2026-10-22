"""
AI 模型接口适配层 —— 复刻 toonflow-game-app 的 src/utils/ai/{text,image} 方案。

对外暴露：
  call_image(config, prompt, ref_images, size, aspect_ratio) -> base64 data URI
  call_text(config, messages, system, ...) -> 文本

厂商分发（镜像 app 的 modelInstance / instanceMap）：
  - openai / other（OpenAI 兼容）：走 /images/generations；有参考图且模型以 gpt-image-1 开头 → /images/edits（多图编辑）
  - volcengine（火山 Ark）：直连 images/generations，参考图走 image 字段（图生图）
  - gemini：generateContent + responseModalities=["IMAGE"]，参考图作为 inline_data
  - siliconflow：/v1/images/generations，image_size

尺寸语义（镜像 app）：1K=1024², 2K=2048², 4K=4096²。
返回：统一 base64 data URI（URL 自动下载转 base64，与 app u.ai.image 一致）。
"""
import base64

import requests

import logger

SIZE_MAP = {"1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096"}

# 火山 Seedream 对 1K 下限敏感，按 app 方案升到 2K 像素映射
VOLCENGINE_SIZE = {
    "1:1": [2048, 2048], "16:9": [2560, 1440], "9:16": [1440, 2560],
    "4:3": [2304, 1728], "3:4": [1728, 2304], "21:9": [3072, 1312],
}


# ─── 通用工具 ───
def _to_data_uri(b64: str, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{b64}"


def _dump_request(label: str, method: str, url: str, headers: dict, body) -> None:
    """
    把 HTTP 请求体落盘（AI_TEXT_DEBUG_HTTP_REQ=1 时生效）。

    对齐 app 的 dumpAiHttpRequest：一个请求一个 JSON 文件。
    """
    if not logger.req_dump_enabled():
        return
    logger.dump_http_request(
        label,
        {"method": method, "url": url, "headers": headers or {}, "body": body},
    )


def _post_json(label: str, url: str, headers: dict, body: dict, timeout: int = 180):
    """统一的 JSON POST：先落盘请求体，再发起请求。"""
    _dump_request(label, "POST", url, headers, body)
    resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp


def _url_to_b64(url: str) -> str:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return base64.b64encode(r.content).decode("ascii")


def _decode(b64url: str) -> bytes:
    """dataURL / 裸 base64 → 二进制。"""
    b = b64url
    if "," in b:
        b = b.split(",", 1)[1]
    return base64.b64decode(b)


def _mime_of(raw: bytes) -> str:
    if raw[:4] == b"\x89PNG":
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:4] == b"GIF8":
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _as_dataurl(ref: str) -> str:
    """参考图统一成 dataURL。已是 dataURL 则原样；否则按头部判定补前缀。"""
    if ref.startswith("data:"):
        return ref
    raw = _decode(ref)
    return _to_data_uri(base64.b64encode(raw).decode("ascii"), _mime_of(raw))


# ─── 图像生成 ───
def call_image(
    config: dict,
    prompt: str,
    ref_images: list = None,
    size: str = "1K",
    aspect_ratio: str = "1:1",
) -> str:
    mfr = (config.get("manufacturer") or "openai").lower()
    if mfr in ("openai", "other"):
        return _call_openai_image(config, prompt, ref_images or [], size)
    if mfr == "volcengine":
        return _call_volcengine(config, prompt, ref_images or [], size, aspect_ratio)
    if mfr == "gemini":
        return _call_gemini(config, prompt, ref_images or [], size, aspect_ratio)
    if mfr == "siliconflow":
        return _call_siliconflow(config, prompt, ref_images or [], size)
    # 兜底：OpenAI 兼容
    return _call_openai_image(config, prompt, ref_images or [], size)


def _call_openai_image(config, prompt, ref_images, size):
    api_key = config.get("apiKey", "")
    base_url = (config.get("baseURL") or "https://api.openai.com/v1").rstrip("/")
    model = config.get("model") or "gpt-image-1"
    px = SIZE_MAP.get(size, "1024x1024")
    auth = {"Authorization": f"Bearer {api_key}"}

    # 有参考图 + gpt-image-1 → /images/edits（多图编辑，镜像 app @ai-sdk 传 images 的语义）
    if ref_images and model.startswith("gpt-image-1"):
        url = f"{base_url}/images/edits"
        files = []
        for i, r in enumerate(ref_images):
            try:
                files.append(("image", (f"ref{i}.png", _decode(r), "image/png")))
            except Exception:
                continue
        if not files:
            raise RuntimeError("参考图解码失败")
        data = {"model": model, "prompt": prompt, "n": "1", "size": px}
        _dump_request("image_openai_edits", "POST", url, auth, data)
        resp = requests.post(url, headers=auth, data=data, files=files, timeout=180)
        resp.raise_for_status()
        b64 = resp.json()["data"][0]["b64_json"]
        return _to_data_uri(b64)

    # 文生图 / 兼容生图
    url = f"{base_url}/images/generations"
    full = prompt
    if ref_images:
        full += "\n\n（参考图已提供，请基于其构图/风格生成保持一致；输出保持像素画风格、背景透明）"
    body = {
        "model": model,
        "prompt": full,
        "n": 1,
        "size": px,
        "response_format": "b64_json",
    }
    resp = _post_json(
        "image_openai_generations", url,
        {**auth, "Content-Type": "application/json"}, body,
    )
    b64 = resp.json()["data"][0]["b64_json"]
    return _to_data_uri(b64)


def _call_volcengine(config, prompt, ref_images, size, aspect_ratio):
    api_key = config.get("apiKey", "")
    base = (config.get("baseURL") or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    url = f"{base}/images/generations"
    # 1K 升 2K 像素（Seedream 对 1K 下限敏感）
    dims = VOLCENGINE_SIZE.get(aspect_ratio, VOLCENGINE_SIZE["1:1"])
    if size == "4K":
        dims = [d * 2 for d in dims]
    w, h = dims
    body = {
        "model": config.get("model") or "doubao-seedream-4-0-250828",
        "prompt": prompt,
        "size": f"{w}x{h}",
        "response_format": "url",
        "sequential_image_generation": "disabled",
        "stream": False,
        "watermark": False,
        "aspect_ratio": aspect_ratio,
    }
    if ref_images:
        body["image"] = [_as_dataurl(r) for r in ref_images]
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = _post_json("image_volcengine", url, headers, body)
    u = resp.json()["data"][0]["url"]
    return _to_data_uri(_url_to_b64(u))


def _call_gemini(config, prompt, ref_images, size, aspect_ratio):
    api_key = config.get("apiKey", "")
    model = config.get("model") or "gemini-2.5-flash-image"
    base = (config.get("baseURL") or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    url = f"{base}/models/{model}:generateContent?key={api_key}"
    parts = [{"text": prompt}]
    for r in ref_images:
        raw = _decode(r)
        parts.append({"inline_data": {"mime_type": _mime_of(raw), "data": base64.b64encode(raw).decode("ascii")}})
    image_config = {"aspectRatio": aspect_ratio}
    if model != "gemini-2.5-flash-image":
        image_config["imageSize"] = size
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": image_config,
        },
    }
    resp = _post_json("image_gemini", url, {}, body)
    data = resp.json()
    for cand in data.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            if "inline_data" in p:
                return _to_data_uri(p["inline_data"]["data"], p["inline_data"]["mime_type"])
    raise RuntimeError("gemini 未返回图像")


def _call_siliconflow(config, prompt, ref_images, size):
    api_key = config.get("apiKey", "")
    base = (config.get("baseURL") or "https://api.siliconflow.cn").rstrip("/")
    url = f"{base}/v1/images/generations"
    px = SIZE_MAP.get(size, "1024x1024")
    body = {
        "model": config.get("model") or "Kwai-Kolors/Kolors",
        "prompt": prompt,
        "image_size": px,
    }
    if ref_images:
        body["image"] = _as_dataurl(ref_images[0])
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = _post_json("image_siliconflow", url, headers, body)
    data = resp.json()
    u = (data.get("images") or [{}])[0].get("url") or (data.get("data") or [{}])[0].get("url")
    return _to_data_uri(_url_to_b64(u))


# ─── 文本大模型（复刻 u.ai.text，以 OpenAI 兼容为主）───
def call_text(
    config: dict,
    messages: list,
    system: str = None,
    temperature=None,
    top_p=None,
    reasoning_effort: str = None,
) -> str:
    """
    文本补全。大多数厂商走 OpenAI 兼容 chat/completions（镜像 app instanceMap）。
    reasoning_effort 仅对 openai/other/volcengine/doubao 透传。
    """
    mfr = (config.get("manufacturer") or "openai").lower()
    api_key = config.get("apiKey", "")
    base = (config.get("baseURL") or "https://api.openai.com/v1").rstrip("/")
    model = config.get("model") or "gpt-4o-mini"
    url = f"{base}/chat/completions"

    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(messages)

    body = {
        "model": model,
        "messages": msgs,
        "temperature": temperature if temperature is not None else 0.3,
        "top_p": top_p if top_p is not None else 0.5,
    }
    if reasoning_effort and mfr in ("openai", "other", "volcengine", "doubao"):
        body["reasoning_effort"] = reasoning_effort

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = _post_json("text_chat_completions", url, headers, body)
    return resp.json()["choices"][0]["message"]["content"]
