"""
本地背景分离模型 —— 复刻 toonflow-game-app 的 src/lib/localAvatarMatting.ts。

支持三个厂商（与 app 的 manufacturer key 一致）：
    local_birefnet  → BiRefNet（rembg，支持 birefnet-portrait/general/general-lite）偏生物/通用
    local_modnet    → MODNet（onnxruntime 直跑官方 photographic portrait ONNX）偏人像
    local_u2net     → U²-Net 家族（rembg 内置，偏**非生物**通用 salient object：
                      u2net / u2netp / u2net-general / u2net_cloth_seg 布料 / u2net_human_seg 人像）

U²-Net 与 BiRefNet 共用同一条 rembg 执行路径与同一个 model-cache
（U2NET_HOME 环境变量已指向 model-cache，u2net.onnx 已在盘上，无需重复下载）。

运行目录与 app 共用（MODEL_path 指向 toonflow-game-app/Toonflow-game/tools/），
这样 map-editor 不用重复下载模型权重。

对外暴露：
    get_status(manufacturer, model)          → 安装状态
    install(manufacturer, model)             → 安装（建 venv + 装依赖 + 下模型 + 预热）
    run_matting(image_bytes, model)          → 返回带透明通道的前景 PNG bytes
"""
import json
import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Optional, Tuple

import env_loader
import logger

LOCAL_BIREFNET_MANUFACTURER = "local_birefnet"
LOCAL_MODNET_MANUFACTURER = "local_modnet"
LOCAL_U2NET_MANUFACTURER = "local_u2net"

BIREFNET_DEFAULT_MODEL = "birefnet-portrait"
MODNET_DEFAULT_MODEL = "modnet-photographic-portrait"
U2NET_DEFAULT_MODEL = "u2net"

BIREFNET_SUPPORTED_MODELS = {
    "birefnet-portrait",
    "birefnet-general",
    "birefnet-general-lite",
}
MODNET_SUPPORTED_MODELS = {MODNET_DEFAULT_MODEL}

# U²-Net 家族：通用显著对象分割，偏非生物（道具/建筑/布料/纹理）。
# 全部由 rembg 内置 session 提供，与 BiRefNet 共用 runner 与 model-cache。
U2NET_SUPPORTED_MODELS = {
    "u2net",                    # 通用 salient object（175MB，已在盘）
    "u2netp",                   # 轻量版（4.5MB，已在盘）
    "u2net-general",            # rembg 内置别名
    "u2net_cloth_seg",          # 布料/服装分割
    "u2net_human_seg",          # 人像分割
}
U2NET_MODELS_ON_DISK = {
    "u2net": "u2net.onnx",
    "u2netp": "u2netp.onnx",
}

BIREFNET_INSTALL_VERSION = 2
REMBG_VERSION = "2.0.67"
ONNXRUNTIME_VERSION = "1.22.1"

MODNET_ONNX_FILE_NAME = "modnet_photographic_portrait_matting.onnx"
MODNET_HF_DOWNLOAD_URL = (
    "https://huggingface.co/DavG25/modnet-pretrained-models/resolve/main/models/"
    + MODNET_ONNX_FILE_NAME
)
MODNET_HF_MIRROR_DOWNLOAD_URL = (
    "https://hf-mirror.com/DavG25/modnet-pretrained-models/resolve/main/models/"
    + MODNET_ONNX_FILE_NAME
)
MODNET_GDRIVE_DOWNLOAD_URL = (
    "https://drive.google.com/uc?id=1cgycTQlYXpTh26gB9FTnthE7AvruV8hd&export=download"
)

_install_lock = threading.Lock()
_installing = False
_install_message = ""


# ───────────────────────── 路径 ─────────────────────────
def _looks_like_placeholder(path: Path) -> bool:
    """
    env 模板里常留占位用户目录（如 D:\\Users\\xxx\\...），这类路径永远不存在。
    """
    text = str(path).lower()
    return "users\\xxx" in text or "users/xxx" in text or "<user>" in text


def _autodetect_tool_root() -> Optional[Path]:
    """
    自动定位 toonflow-game-app 的 tools 目录（与 app 共用模型权重，避免重复下载）。

    从本文件向上遍历**所有**祖先目录，每个祖先尝试两种布局：
      A. <ancestor>/toonflow-game-app/Toonflow-game/tools
         （toonflow-game-plugins 与 toonflow-game-app 平铺在同一父目录下）
      B. <ancestor>/Toonflow-game/tools
         （仓库内自带 tools 目录）
    命中条件：<candidate>/avatar-matting/birefnet 存在。
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidates = [
            parent / "toonflow-game-app" / "Toonflow-game" / "tools",
            parent / "Toonflow-game" / "tools",
        ]
        for candidate in candidates:
            try:
                if (candidate / "avatar-matting" / "birefnet").is_dir():
                    return candidate
            except OSError:
                continue
        # 到盘符根都没找到就放弃
        if len(parent.parts) <= 2:
            break
    return None


def tool_root_dir() -> Path:
    """
    本地工具根目录：MODEL_path 优先，否则自动探测 app 的 tools 目录，最后兜底 backend/tools。
    """
    configured = env_loader.get_env("MODEL_path")
    if configured:
        p = Path(configured)
        if not p.is_absolute():
            p = env_loader.BACKEND_DIR / p
        if p.is_dir() and not _looks_like_placeholder(p):
            return p
        # 占位路径或不存在 → 落到自动探测
        detected = _autodetect_tool_root()
        if detected:
            logger.warn(
                f"[matting] MODEL_path 无效（{p}），已自动探测到本地工具目录: {detected}"
            )
            return detected

    detected = _autodetect_tool_root()
    if detected:
        return detected
    return env_loader.BACKEND_DIR / "tools"


def birefnet_root_dir() -> Path:
    return tool_root_dir() / "avatar-matting" / "birefnet"


def venv_dir() -> Path:
    return birefnet_root_dir() / "venv"


def cache_dir() -> Path:
    return birefnet_root_dir() / "model-cache"


def work_dir() -> Path:
    return birefnet_root_dir() / "work"


def state_file() -> Path:
    return birefnet_root_dir() / "install-state.json"


def birefnet_runner_script() -> Path:
    return birefnet_root_dir() / "run_birefnet.py"


def modnet_runner_script() -> Path:
    return birefnet_root_dir() / "run_modnet.py"


def modnet_model_path() -> Path:
    return cache_dir() / MODNET_ONNX_FILE_NAME


def managed_python() -> Path:
    return (
        venv_dir() / "Scripts" / "python.exe"
        if os.name == "nt"
        else venv_dir() / "bin" / "python"
    )


# ───────────────────────── 模型名归一 ─────────────────────────
def is_modnet_model(model: Optional[str]) -> bool:
    """判断模型名是否属于 MODNet 家族（兼容下划线/旧命名）。"""
    normalized = (model or "").strip().lower()
    return (
        normalized == MODNET_DEFAULT_MODEL
        or normalized == "modnet_photographic_portrait_matting"
        or normalized == MODNET_ONNX_FILE_NAME.replace(".onnx", "")
    )


def is_u2net_model(model: Optional[str]) -> bool:
    """判断模型名是否属于 U²-Net 家族（兼容 u2netp / u2net-general 等别名）。"""
    normalized = (model or "").strip().lower()
    return normalized.startswith("u2net") or normalized.startswith("u2net_")


def resolve_manufacturer(manufacturer: Optional[str]) -> str:
    """归一厂商 key；未指定时默认 BiRefNet（与 app 保持一致）。"""
    normalized = (manufacturer or "").strip().lower()
    if normalized == LOCAL_MODNET_MANUFACTURER:
        return LOCAL_MODNET_MANUFACTURER
    if normalized == LOCAL_U2NET_MANUFACTURER:
        return LOCAL_U2NET_MANUFACTURER
    return LOCAL_BIREFNET_MANUFACTURER


def resolve_model(manufacturer: str, model: Optional[str]) -> str:
    """按厂商补足默认模型，避免用户手输模型名。"""
    normalized = (model or "").strip().lower()
    if manufacturer == LOCAL_MODNET_MANUFACTURER:
        return MODNET_DEFAULT_MODEL
    if manufacturer == LOCAL_U2NET_MANUFACTURER:
        if normalized in U2NET_SUPPORTED_MODELS:
            return normalized
        if not normalized:
            return U2NET_DEFAULT_MODEL
        if is_u2net_model(normalized):
            return normalized
        return U2NET_DEFAULT_MODEL
    if not normalized:
        return BIREFNET_DEFAULT_MODEL
    if normalized in BIREFNET_SUPPORTED_MODELS:
        return normalized
    if is_modnet_model(normalized):
        return MODNET_DEFAULT_MODEL
    if normalized.startswith("birefnet-"):
        return normalized
    return BIREFNET_DEFAULT_MODEL


def model_label(model: Optional[str]) -> str:
    if is_modnet_model(model):
        return "MODNet"
    if is_u2net_model(model):
        return "U2Net"
    return "BiRefNet"


def supported_models(manufacturer: str) -> list:
    """该厂商支持的模型列表（供前端下拉）。"""
    if manufacturer == LOCAL_MODNET_MANUFACTURER:
        return [{"label": MODNET_DEFAULT_MODEL, "value": MODNET_DEFAULT_MODEL}]
    if manufacturer == LOCAL_U2NET_MANUFACTURER:
        return [
            {"label": name, "value": name}
            for name in ("u2net", "u2netp", "u2net-general", "u2net_cloth_seg", "u2net_human_seg")
        ]
    return [
        {"label": name, "value": name}
        for name in ("birefnet-portrait", "birefnet-general", "birefnet-general-lite")
    ]


# ───────────────────────── 安装状态 ─────────────────────────
def _read_state() -> Optional[dict]:
    try:
        raw = state_file().read_text(encoding="utf-8")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        status = str(parsed.get("status") or "").strip()
        if status not in ("installing", "installed", "failed"):
            return None
        return parsed
    except Exception:
        return None


def _write_state(**kwargs) -> None:
    birefnet_root_dir().mkdir(parents=True, exist_ok=True)
    payload = {"updatedAt": _now_ms()}
    existing = _read_state() or {}
    payload.update(existing)
    payload.update(kwargs)
    state_file().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


def _file_exists(path: Path) -> bool:
    try:
        return path.exists() and path.is_file()
    except OSError:
        return False


def _has_base_runtime() -> bool:
    state = _read_state()
    if not state or state.get("status") != "installed":
        return False
    return _file_exists(managed_python()) and _file_exists(birefnet_runner_script())


def _has_modnet_runtime() -> bool:
    return (
        _has_base_runtime()
        and _file_exists(modnet_runner_script())
        and _file_exists(modnet_model_path())
    )


def u2net_model_path(model: str) -> Optional[Path]:
    """U²-Net 权重路径；未知变体返回 None（交给 rembg 按名解析）。"""
    return cache_dir() / U2NET_MODELS_ON_DISK[model] if model in U2NET_MODELS_ON_DISK else None


def _has_u2net_runtime(model: Optional[str] = None) -> bool:
    """
    U²-Net 与 BiRefNet 共用 rembg runner 和 venv，判定分两层：
      1) 基础运行时（venv + runner + install-state）就绪
      2) 该模型权重已在 model-cache（u2net / u2netp 已随 app 预置；
         u2net-general / *_seg 若未在盘，会由 rembg 的 pooch 首次运行时自动下载）
    """
    if not _has_base_runtime():
        return False
    path = u2net_model_path((model or U2NET_DEFAULT_MODEL).strip().lower())
    if path is None:
        # 未预置的变体：交给 rembg 首次运行自动下载，基础运行时就绪即可用
        return True
    return _file_exists(path)


def is_model_ready(model: str) -> bool:
    """按模型判断本地抠图能力是否可直接使用。"""
    if is_modnet_model(model):
        return _has_modnet_runtime()
    if is_u2net_model(model):
        return _has_u2net_runtime(model)
    return _has_base_runtime()


_subprocess_kwargs_cache: Optional[dict] = None


def _subprocess_kwargs() -> dict:
    """
    子进程公共参数。

    windowsHide 只在部分 Windows 的 Popen 上存在；
    即便 os.name == 'nt'，某些 Python 构建也不支持该参数。
    这里用一次真实调用探测能力，不支持就退化为空参数。
    """
    global _subprocess_kwargs_cache
    if _subprocess_kwargs_cache is not None:
        return _subprocess_kwargs_cache

    kwargs: dict = {}
    try:
        subprocess.run(
            [sys.executable, "-c", "pass"],
            capture_output=True,
            timeout=10,
            windowsHide=True,
        )
        kwargs = {"windowsHide": True}
    except TypeError:
        kwargs = {}
    except Exception:
        kwargs = {}

    _subprocess_kwargs_cache = kwargs
    return kwargs


def _system_python() -> Optional[str]:
    """探测系统 Python 3。"""
    for command in ("python", "py -3", "python3"):
        exe = command.split(" ")[0]
        args = command.split(" ")[1:]
        try:
            proc = subprocess.run(
                [exe, *args, "--version"],
                capture_output=True,
                timeout=10,
                **_subprocess_kwargs(),
            )
            if proc.returncode == 0:
                return command
        except Exception:
            continue
    return None


def get_status(manufacturer: Optional[str] = None, model: Optional[str] = None) -> dict:
    """查询安装状态（对齐 app 的 getLocalAvatarMattingStatus）。"""
    mfr = resolve_manufacturer(manufacturer)
    resolved = resolve_model(mfr, model)
    label = model_label(resolved)
    can_install = _system_python() is not None

    if _installing:
        return _build_status(mfr, resolved, "installing", _install_message or f"本地 {label} 安装中", can_install)
    if is_model_ready(resolved):
        return _build_status(mfr, resolved, "installed", f"本地 {label} 已安装，可直接使用", can_install)
    if is_modnet_model(resolved) and _has_base_runtime():
        return _build_status(mfr, resolved, "not_installed", "BiRefNet 本地环境已安装；如需使用 MODNet，请补装 MODNet 模型文件", can_install)
    if is_u2net_model(resolved) and _has_base_runtime():
        return _build_status(mfr, resolved, "not_installed", f"本地 {label} 环境已就绪；{resolved} 权重未在 model-cache 中，首次推理会自动下载", can_install)

    state = _read_state()
    if state and state.get("status") == "failed":
        return _build_status(mfr, resolved, "failed", state.get("message") or f"本地 {label} 安装失败，请重试", can_install)
    if not can_install:
        return _build_status(mfr, resolved, "not_installed", f"未检测到可用 Python 3，无法安装本地 {label}", False)
    if state and state.get("status") == "installing":
        return _build_status(mfr, resolved, "installing", state.get("message") or f"本地 {label} 安装中", True)
    return _build_status(mfr, resolved, "not_installed", f"首次使用需要安装 Python 依赖和 {label} 模型文件", True)


def _build_status(manufacturer: str, model: str, status: str, message: str, can_install: bool) -> dict:
    return {
        "manufacturer": manufacturer,
        "model": model,
        "status": status,
        "installed": status == "installed",
        "canInstall": can_install,
        "message": message,
    }


# ───────────────────────── runner 脚本 ─────────────────────────
BIREFNET_RUNNER_SOURCE = """import argparse
import json
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='birefnet-portrait')
    parser.add_argument('--input', default='')
    parser.add_argument('--output', default='')
    parser.add_argument('--warmup', action='store_true')
    args = parser.parse_args()

    from rembg import new_session, remove

    session = new_session(args.model)
    if args.warmup:
        print(json.dumps({'ok': True, 'model': args.model}))
        return

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        raise FileNotFoundError(str(input_path))

    result = remove(input_path.read_bytes(), session=session, force_return_bytes=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(result)
    print(json.dumps({'ok': True, 'output': str(output_path)}))

if __name__ == '__main__':
    main()
"""

MODNET_RUNNER_SOURCE = '''import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
import onnxruntime

REF_SIZE = 512


def compute_scale(im_h, im_w, ref_size):
    if max(im_h, im_w) < ref_size or min(im_h, im_w) > ref_size:
        if im_w >= im_h:
            im_rh = ref_size
            im_rw = int(im_w / im_h * ref_size)
        else:
            im_rw = ref_size
            im_rh = int(im_h / im_w * ref_size)
    else:
        im_rh = im_h
        im_rw = im_w
    im_rw = max(32, im_rw - im_rw % 32)
    im_rh = max(32, im_rh - im_rh % 32)
    return im_rw / im_w, im_rh / im_h


def prepare_input(image_path):
    image = Image.open(image_path).convert('RGB')
    im = np.asarray(image).astype(np.float32)
    im = (im - 127.5) / 127.5
    im_h, im_w, _ = im.shape
    x_scale, y_scale = compute_scale(im_h, im_w, REF_SIZE)
    resized = Image.fromarray(
        np.clip((im * 127.5) + 127.5, 0, 255).astype(np.uint8)
    ).resize(
        (
            max(32, int(round(im_w * x_scale / 32.0) * 32)),
            max(32, int(round(im_h * y_scale / 32.0) * 32)),
        ),
        Image.Resampling.BILINEAR,
    )
    normalized = (np.asarray(resized).astype(np.float32) - 127.5) / 127.5
    tensor = np.transpose(normalized, (2, 0, 1))
    tensor = np.expand_dims(tensor, axis=0).astype('float32')
    return image, tensor, im_w, im_h


def run_inference(session, tensor):
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    result = session.run([output_name], {input_name: tensor})
    return np.squeeze(result[0])


def save_foreground(image, matte, output_path, width, height):
    matte = np.clip(matte * 255.0, 0, 255).astype('uint8')
    alpha = Image.fromarray(matte, mode='L').resize((width, height), Image.Resampling.BILINEAR)
    rgba = image.convert('RGBA')
    rgba.putalpha(alpha)
    rgba.save(output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='')
    parser.add_argument('--output', default='')
    parser.add_argument('--model-path', default='')
    parser.add_argument('--warmup', action='store_true')
    args = parser.parse_args()

    model_path = Path(args.model_path)
    if not model_path.exists():
        raise FileNotFoundError(str(model_path))

    session = onnxruntime.InferenceSession(str(model_path), None)
    if args.warmup:
        print(json.dumps({'ok': True, 'model_path': str(model_path)}))
        return

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        raise FileNotFoundError(str(input_path))

    image, tensor, width, height = prepare_input(input_path)
    matte = run_inference(session, tensor)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_foreground(image, matte, output_path, width, height)
    print(json.dumps({'ok': True, 'output': str(output_path)}))


if __name__ == '__main__':
    main()
'''


def _write_runner_scripts() -> None:
    birefnet_root_dir().mkdir(parents=True, exist_ok=True)
    birefnet_runner_script().write_text(BIREFNET_RUNNER_SOURCE, encoding="utf-8")
    modnet_runner_script().write_text(MODNET_RUNNER_SOURCE, encoding="utf-8")


def _run(cmd: list, timeout: int = 600, env: Optional[dict] = None) -> Tuple[int, str, str]:
    """执行子进程，返回 (exit_code, stdout, stderr)。"""
    merged = os.environ.copy()
    merged["PYTHONUTF8"] = "1"
    merged["U2NET_HOME"] = str(cache_dir())
    if env:
        merged.update(env)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=merged,
            **_subprocess_kwargs(),
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired:
        return -1, "", f"命令执行超时: {' '.join(cmd)}"
    except Exception as e:
        return -1, "", str(e)


def _download_modnet_model() -> None:
    """下载 MODNet 模型文件，依次尝试多个镜像源。"""
    target = modnet_model_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    sources = [
        ("Hugging Face 国内镜像", MODNET_HF_MIRROR_DOWNLOAD_URL),
        ("Hugging Face", MODNET_HF_DOWNLOAD_URL),
        ("Google Drive", MODNET_GDRIVE_DOWNLOAD_URL),
    ]
    errors = []
    for label, url in sources:
        logger.info(f"[matting] 正在从 {label} 下载 MODNet 模型...")
        code, out, err = _run([sys.executable, "-c", _DOWNLOAD_SNIPPET, url, str(target)], timeout=1800)
        if code == 0 and target.exists():
            logger.info(f"[matting] MODNet 模型下载成功（{label}）")
            return
        errors.append(f"{label}: {err.strip()[:200] or out.strip()[:200]}")
    raise RuntimeError("MODNet 模型下载失败。\n" + "\n".join(errors))


_DOWNLOAD_SNIPPET = """
import sys, urllib.request
url, target = sys.argv[1], sys.argv[2]
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=600) as resp, open(target, 'wb') as fp:
    fp.write(resp.read())
"""


# ───────────────────────── 安装 ─────────────────────────
def install(manufacturer: Optional[str] = None, model: Optional[str] = None) -> dict:
    """安装本地背景分离模型（对齐 app 的 installLocalBiRefNet）。"""
    global _installing, _install_message

    mfr = resolve_manufacturer(manufacturer)
    resolved = resolve_model(mfr, model)
    label = model_label(resolved)

    with _install_lock:
        if _installing:
            return get_status(mfr, resolved)
        if is_model_ready(resolved):
            return _build_status(mfr, resolved, "installed", f"本地 {label} 已安装，可直接使用", True)

        _installing = True
        _install_message = f"正在准备本地 {label} 环境"
        _write_state(status="installing", message=_install_message, model=resolved, version=BIREFNET_INSTALL_VERSION)

        try:
            launcher = _system_python()
            if not launcher:
                raise RuntimeError(f"未检测到可用 Python 3，无法安装本地 {label}")

            parts = launcher.split(" ")
            python_exe = parts[0]
            python_args = parts[1:]

            for directory in (birefnet_root_dir(), cache_dir(), work_dir()):
                directory.mkdir(parents=True, exist_ok=True)

            has_base = _has_base_runtime()

            # 1) 建 venv
            if not has_base:
                _install_message = "正在创建本地 Python 环境"
                _write_state(status="installing", message=_install_message)
                code, out, err = _run(
                    [python_exe, *python_args, "-m", "venv", str(venv_dir())], timeout=600
                )
                if code != 0:
                    raise RuntimeError(f"创建 Python 环境失败: {err.strip()[-500:]}")

            # 2) 写 runner 脚本
            _write_runner_scripts()

            # 3) 装依赖
            if not has_base or is_modnet_model(resolved):
                _install_message = "正在安装本地头像分离依赖"
                _write_state(status="installing", message=_install_message)
                _run([str(managed_python()), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], timeout=1800)
                code, out, err = _run(
                    [
                        str(managed_python()), "-m", "pip", "install",
                        f"rembg=={REMBG_VERSION}",
                        f"onnxruntime=={ONNXRUNTIME_VERSION}",
                        "pillow",
                        "numpy",
                    ],
                    timeout=1800,
                )
                if code != 0:
                    # 固定版本失败时回退到不带版本号的安装
                    code, out, err = _run(
                        [
                            str(managed_python()), "-m", "pip", "install",
                            "rembg", "onnxruntime", "pillow", "numpy",
                        ],
                        timeout=1800,
                    )
                    if code != 0:
                        raise RuntimeError(f"安装依赖失败: {err.strip()[-500:]}")

            # 4) 下载 / 预热模型
            if is_modnet_model(resolved):
                if not _file_exists(modnet_model_path()):
                    _install_message = "正在下载本地 MODNet 模型文件"
                    _write_state(status="installing", message=_install_message)
                    _download_modnet_model()

                _install_message = "正在预热本地 MODNet 模型"
                _write_state(status="installing", message=_install_message)
                code, out, err = _run(
                    [
                        str(managed_python()), str(modnet_runner_script()),
                        "--warmup", "--model-path", str(modnet_model_path()),
                    ],
                    timeout=1800,
                )
                if code != 0:
                    raise RuntimeError(f"MODNet 预热失败: {err.strip()[-500:]}")
            else:
                # BiRefNet 与 U²-Net 都走 rembg runner（--model 按名解析 session）
                _install_message = f"正在预下载 {resolved} 模型文件"
                _write_state(status="installing", message=_install_message)
                code, out, err = _run(
                    [str(managed_python()), str(birefnet_runner_script()), "--warmup", "--model", resolved],
                    timeout=1800,
                )
                if code != 0:
                    raise RuntimeError(f"{label} 预热失败: {err.strip()[-500:]}")

            status = _build_status(mfr, resolved, "installed", f"本地 {label} 已安装，可直接使用", True)
            _write_state(
                status="installed",
                message=status["message"],
                installedAt=_now_ms(),
                model=resolved,
                version=BIREFNET_INSTALL_VERSION,
                pythonLauncher=launcher,
            )
            logger.info(f"[matting] {status['message']}")
            return status
        except Exception as e:
            message = str(e) or f"本地 {label} 安装失败"
            _write_state(status="failed", message=message, lastError=message, model=resolved)
            logger.error(f"[matting] 安装失败: {message}")
            raise RuntimeError(message)
        finally:
            _installing = False
            _install_message = ""


# ───────────────────────── 推理 ─────────────────────────
def run_matting(image_bytes: bytes, model: Optional[str] = None) -> bytes:
    """
    对图片做背景分离，返回带透明通道的前景 PNG bytes。

    与 app 的 runLocalBiRefNetMatting 行为一致。
    """
    if is_modnet_model(model):
        mfr = resolve_manufacturer(LOCAL_MODNET_MANUFACTURER)
    elif is_u2net_model(model):
        mfr = resolve_manufacturer(LOCAL_U2NET_MANUFACTURER)
    else:
        mfr = resolve_manufacturer(LOCAL_BIREFNET_MANUFACTURER)
    resolved = resolve_model(mfr, model)
    label = model_label(resolved)

    status = get_status(mfr, resolved)
    if status["status"] != "installed":
        raise RuntimeError(status["message"] or f"本地 {label} 尚未安装")

    work_dir().mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    input_path = work_dir() / f"{token}_input.png"
    output_path = work_dir() / f"{token}_output.png"
    try:
        input_path.write_bytes(image_bytes)
        if is_modnet_model(resolved):
            # 强制重写脚本，保证旧安装态也能拿到最新的透明前景实现
            _write_runner_scripts()
            cmd = [
                str(managed_python()), str(modnet_runner_script()),
                "--model-path", str(modnet_model_path()),
                "--input", str(input_path),
                "--output", str(output_path),
            ]
        else:
            cmd = [
                str(managed_python()), str(birefnet_runner_script()),
                "--model", resolved,
                "--input", str(input_path),
                "--output", str(output_path),
            ]
        code, out, err = _run(cmd, timeout=1800)
        if code != 0:
            raise RuntimeError(f"本地 {label} 推理失败: {err.strip()[-500:] or out.strip()[-500:]}")
        if not output_path.exists():
            raise RuntimeError(f"本地 {label} 未产出结果文件")
        return output_path.read_bytes()
    finally:
        for path in (input_path, output_path):
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass