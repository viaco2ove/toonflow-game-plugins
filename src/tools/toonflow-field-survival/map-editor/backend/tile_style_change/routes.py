"""
Tile Style Change 路由
======================
生图代理 + 抠图（像素风硬边透明）

参考图支持：ref_images（用户上传）+ current_tile（当前格图）合并传入，
gpt-image-1 走 images/edits 多图编辑接口；其他 OpenAI 兼容模型走 images/generations。
"""
import base64
import io
from typing import List, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from PIL import Image

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import ai_store
import ai_clients

router = APIRouter(prefix="/api/tile-style", tags=["tile-style"])

# 贴图替换绑定的槽位（镜像 app t_aiModelMap）
SLOT_TEXTURE_REPLACE = ai_store.SLOT_TEXTURE_REPLACE

# 尺寸归一：前端可能传 "1024x1024" 这类 legacy 值，统一成 app 的 1K/2K/4K 预设
_SIZE_NORMALIZE = {
    "1024x1024": "1K", "2048x2048": "2K", "4096x4096": "4K",
    "512x512": "1K",
}
ASPECT_DEFAULT = "1:1"


# ─── Schema ───
class GenerateTileRequest(BaseModel):
    prompt: str
    ref_images: List[str] = []           # base64 dataURL 数组（用户上传参考图）
    current_tile: Optional[str] = None   # 当前 tile base64（保留原构图用）
    size: str = "1024x1024"              # 生成尺寸（1K/2K/4K 由前端换算）
    threshold: int = 30                  # 抠图硬边阈值
    config: dict = {}                    # { model, apiKey, baseURL, manufacturer }


class GenerateTileResponse(BaseModel):
    image_base64: str
    width: int
    height: int


# ─── 工具 ───
def _decode_b64(data_url: str) -> bytes:
    """base64 dataURL / 裸 base64 → 二进制"""
    b64 = data_url
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


def _open_rgba(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGBA")


# ─── 生图：OpenAI 兼容协议 ───
def call_openai_compatible(
    config: dict,
    prompt: str,
    size: str,
    ref_images: List[str],
) -> bytes:
    """
    调用 OpenAI Images API 兼容接口。
    - 有参考图 + 模型为 gpt-image-1：走 /images/edits 多图编辑
    - 否则：走 /images/generations 纯文本生成
    """
    api_key = config.get("apiKey", "")
    base_url = config.get("baseURL", "https://api.openai.com/v1").rstrip("/")
    model = config.get("model", "dall-e-3")

    if not api_key:
        raise HTTPException(400, "未配置 API Key")

    auth = {"Authorization": f"Bearer {api_key}"}

    # gpt-image-1 支持 edits（多参考图编辑）
    if ref_images and model.startswith("gpt-image-1"):
        url = f"{base_url}/images/edits"
        files = []
        for i, r in enumerate(ref_images):
            try:
                files.append(("image", (f"ref{i}.png", _decode_b64(r), "image/png")))
            except Exception:
                continue
        if not files:
            raise HTTPException(400, "参考图解码失败")
        data = {
            "model": model,
            "prompt": prompt,
            "n": "1",
            "size": size,
        }
        try:
            resp = requests.post(url, headers=auth, data=data, files=files, timeout=180)
            resp.raise_for_status()
            payload = resp.json()
            b64 = payload["data"][0]["b64_json"]
            return base64.b64decode(b64)
        except requests.exceptions.RequestException as e:
            raise HTTPException(502, f"生图 API 请求失败: {e}")
        except (KeyError, IndexError, TypeError) as e:
            raise HTTPException(502, f"生图响应解析失败: {e}")

    # 默认：纯文本生成（DALL-E 3 / SD / 其他兼容服务）
    url = f"{base_url}/images/generations"
    body = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json",
    }
    if ref_images:
        body["prompt"] = (
            f"{prompt}\n\n（参考图已提供，请基于其构图/风格生成保持一致；"
            "输出保持像素画风格、背景透明）"
        )
    try:
        resp = requests.post(url, json=body, headers={**auth, "Content-Type": "application/json"}, timeout=180)
        resp.raise_for_status()
        payload = resp.json()
        b64 = payload["data"][0]["b64_json"]
        return base64.b64decode(b64)
    except requests.exceptions.RequestException as e:
        raise HTTPException(502, f"生图 API 请求失败: {e}")
    except (KeyError, IndexError, TypeError) as e:
        raise HTTPException(502, f"生图响应解析失败: {e}")


# ─── 抠图（像素风硬边透明） ───
def chroma_key_removal(img_bytes: bytes, threshold: int = 30) -> bytes:
    """
    像素风硬边抠图：
    1. 背景采样：四角 + 边缘 1px 环取均值（避免主体占角落误判）
    2. 颜色距离 < threshold → 完全透明（alpha=0），否则完全不透明（alpha=255）
    3. 不做羽化（羽化会把硬像素边抹糊，破坏像素画观感）
    """
    img = _open_rgba(img_bytes)
    pixels = img.load()
    w, h = img.size

    # 边缘采样点
    bg_samples = []
    for (x, y) in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        bg_samples.append(pixels[x, y][:3])
    # 边缘环采样
    for x in range(0, w, max(1, w // 32)):
        bg_samples.append(pixels[x, 0][:3])
        bg_samples.append(pixels[x, h - 1][:3])
    for y in range(0, h, max(1, h // 32)):
        bg_samples.append(pixels[0, y][:3])
        bg_samples.append(pixels[w - 1, y][:3])

    bg_r = sum(c[0] for c in bg_samples) // len(bg_samples)
    bg_g = sum(c[1] for c in bg_samples) // len(bg_samples)
    bg_b = sum(c[2] for c in bg_samples) // len(bg_samples)

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            dist = ((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2) ** 0.5
            pixels[x, y] = (r, g, b, 0 if dist < threshold else 255)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ─── API ───
def _normalize_size(size: str) -> str:
    return _SIZE_NORMALIZE.get((size or "").strip(), size or "1K")


@router.post("/generate", response_model=GenerateTileResponse)
async def generate_tile(req: GenerateTileRequest):
    """生成单个 tile 贴图，自动抠背景为透明（像素风硬边）

    配置解析顺序（镜像 app getPromptAi）：
      1. 请求体自带 config（前端显式传入 / 测试用）
      2. 否则从 ai_store 解析绑定的 textureReplaceModel 槽位配置
    """
    config = req.config or {}
    if not config.get("manufacturer"):
        bound = ai_store.get_bound_config(SLOT_TEXTURE_REPLACE)
        if not bound:
            raise HTTPException(
                400,
                "未绑定贴图替换模型：请点右上角 ⚙️ 设置，添加一个 image 类型模型并绑定到「贴图替换模型」槽位",
            )
        config = bound

    if not config.get("apiKey"):
        raise HTTPException(400, "模型配置缺少 apiKey")

    # 合并参考图：用户上传 + 当前格图（保留原构图）
    refs: List[str] = list(req.ref_images or [])
    if req.current_tile:
        refs.append(req.current_tile)

    size = _normalize_size(req.size)
    try:
        b64_uri = ai_clients.call_image(
            config, req.prompt, ref_images=refs, size=size, aspect_ratio=ASPECT_DEFAULT,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"生图调用失败: {e}")

    img_bytes = _decode_b64(b64_uri)

    # 抠图（硬边透明）
    processed = chroma_key_removal(img_bytes, threshold=req.threshold)

    b64 = base64.b64encode(processed).decode("utf-8")
    img = _open_rgba(processed)
    return GenerateTileResponse(
        image_base64=f"data:image/png;base64,{b64}",
        width=img.width,
        height=img.height,
    )
