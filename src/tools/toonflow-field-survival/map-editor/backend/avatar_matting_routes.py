"""
背景分离模型路由
================
复刻 toonflow-game-app 的 /setting/localAvatarMatting/{status,install}，
并额外提供 /run 用于实际抠图。支持本地（BiRefNet/MODNet/U2Net）与云端（Bria/阿里云视觉/腾讯云数据万象）。

接口：
  POST /api/matting/status   → 查询安装状态（本地模型）
  POST /api/matting/install  → 安装本地背景分离模型
  POST /api/matting/run      → 对图片做背景分离（本地或云端，返回透明前景 PNG dataURL）
  GET  /api/matting/models   → 列出支持的厂商与模型
"""
import base64
import io
from typing import Optional

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import avatar_matting
import cloud_matting
import logger
import temp_oss

router = APIRouter(prefix="/api/matting", tags=["matting"])


class StatusRequest(BaseModel):
    manufacturer: Optional[str] = None
    model: Optional[str] = None


class InstallRequest(StatusRequest):
    pass


class RunRequest(BaseModel):
    image_base64: str                    # dataURL 或裸 base64
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    save_temp: bool = False              # 是否同时上传到 TEMP_OSS
    # 云端配置（不传则从绑定的模型配置解析）
    api_key: Optional[str] = None
    base_url: Optional[str] = None


def _decode_b64(data_url: str) -> bytes:
    """base64 dataURL / 裸 base64 → 二进制。"""
    b64 = (data_url or "").strip()
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    if not b64:
        raise HTTPException(400, "图片数据为空")
    try:
        return base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(400, f"图片解析失败: {e}")


@router.get("/models")
def list_models():
    """列出支持的背景分离厂商与模型（供前端下拉）——本地 + 云端，对齐 app 全集。"""
    return {
        "manufacturers": [
            # 云端（需要 API Key，按量计费）
            {
                "value": "bria",
                "label": "Bria",
                "cloud": True,
                "models": [{"label": "RMBG-2.0", "value": "RMBG-2.0"}],
            },
            {
                "value": "aliyun_imageseg",
                "label": "阿里云视觉",
                "cloud": True,
                "models": [
                    {"label": "SegmentCommonImage（通用主体）", "value": "SegmentCommonImage"},
                    {"label": "SegmentHDCommonImage（高清通用）", "value": "SegmentHDCommonImage"},
                    {"label": "SegmentBody（人体）", "value": "SegmentBody"},
                    {"label": "SegmentHDBody（高清人体）", "value": "SegmentHDBody"},
                ],
            },
            {
                "value": "tencent_ci",
                "label": "腾讯云数据万象",
                "cloud": True,
                "models": [{"label": "AIPortraitMatting", "value": "AIPortraitMatting"}],
            },
            # 本地（离线推理，不消耗额度）
            {
                "value": avatar_matting.LOCAL_BIREFNET_MANUFACTURER,
                "label": "BiRefNet 本地",
                "cloud": False,
                "models": avatar_matting.supported_models(avatar_matting.LOCAL_BIREFNET_MANUFACTURER),
            },
            {
                "value": avatar_matting.LOCAL_MODNET_MANUFACTURER,
                "label": "MODNet 本地",
                "cloud": False,
                "models": avatar_matting.supported_models(avatar_matting.LOCAL_MODNET_MANUFACTURER),
            },
            {
                "value": avatar_matting.LOCAL_U2NET_MANUFACTURER,
                "label": "U2Net 本地（非生物）",
                "cloud": False,
                "models": avatar_matting.supported_models(avatar_matting.LOCAL_U2NET_MANUFACTURER),
            },
        ],
        "rootDir": str(avatar_matting.birefnet_root_dir()),
        "tempOss": temp_oss.provider_status(),
    }


@router.post("/status")
def status(req: StatusRequest):
    """查询本地背景分离模型安装状态。"""
    try:
        return avatar_matting.get_status(req.manufacturer, req.model)
    except Exception as e:
        raise HTTPException(500, f"查询背景分离模型状态失败: {e}")


@router.post("/install")
def install(req: InstallRequest):
    """安装本地背景分离模型（首次使用需下载模型权重，耗时较长）。"""
    try:
        return avatar_matting.install(req.manufacturer, req.model)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/run")
def run(req: RunRequest):
    """
    对图片做背景分离，返回带透明通道的前景 PNG（dataURL）。

    本地厂商（local_birefnet/local_modnet/local_u2net）→ avatar_matting.run_matting（离线推理）。
    云端厂商（bria/aliyun_imageseg/tencent_ci）→ cloud_matting.run_cloud_matting（需要 apiKey，
    与 app 的 separateRoleAvatar.ts 行为一致）。
    """
    raw_mfr = (req.manufacturer or "").strip()

    raw = _decode_b64(req.image_base64)
    try:
        # 统一转成 PNG，避免 jpeg 等格式在抠图管线里出问题
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        normalized = buffer.getvalue()
    except Exception as e:
        raise HTTPException(400, f"图片解析失败: {e}")

    save_temp_url = ""
    if cloud_matting.is_cloud_matting_manufacturer(raw_mfr):
        # ── 云端 ──
        api_key = (req.api_key or "").strip()
        if not api_key:
            raise HTTPException(400, f"{raw_mfr} 需要 API Key（可在 ⚙️ 模型管理里配置并绑定背景分离模型）")
        try:
            result = cloud_matting.run_cloud_matting(
                normalized, raw_mfr, api_key, req.base_url, req.model
            )
        except cloud_matting.MattingConfigError as e:
            raise HTTPException(400, str(e))
        except cloud_matting.MattingProviderError as e:
            raise HTTPException(502, str(e))
        except Exception as e:
            logger.error(f"[matting] 云端抠图异常: {e}")
            raise HTTPException(502, f"云端抠图失败: {e}")
        label = raw_mfr
        resolved_model = (req.model or "").strip() or "default"
    else:
        # ── 本地 ──
        manufacturer = avatar_matting.resolve_manufacturer(raw_mfr)
        resolved_model = avatar_matting.resolve_model(manufacturer, req.model)
        label = avatar_matting.model_label(resolved_model)
        try:
            result = avatar_matting.run_matting(normalized, resolved_model)
        except Exception as e:
            raise HTTPException(500, str(e))

    payload = {
        "ok": True,
        "manufacturer": raw_mfr or manufacturer,
        "model": resolved_model,
        "image_base64": "data:image/png;base64," + base64.b64encode(result).decode("ascii"),
    }

    if req.save_temp:
        try:
            url = temp_oss.upload_temp(result, f"matting_{resolved_model}.png")
            payload["tempUrl"] = url or ""
            if not url:
                logger.warn("[matting] TEMP_OSS 上传未成功")
        except Exception as e:
            logger.warn(f"[matting] TEMP_OSS 上传异常: {e}")
            payload["tempUrl"] = ""

    return payload
