#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""toon_plugins CLI"""
import os
import sys

# Windows 终端 UTF-8 支持
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import click
import json as _json

try:
    from datetime import datetime
except ImportError:
    datetime = None

try:
    from tabulate import tabulate
    _HAVE_TABULATE = True
except ImportError:
    _HAVE_TABULATE = False

CLI_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CLI_ROOT)

from toon_plugins.toon_client import ToonClient


# ── 打包跳过目录（默认瘦身）────────────────────────────────────────────────
# 在原 {".git","__pycache__","node_modules"} 基础上追加 虚拟环境 / 编辑器 /
# 各类缓存 以及体积占比最大的 test_data（现场测试数据，默认无需随包分发）。
# 默认瘦身；必要时可回退：设置环境变量 TOON_INCLUDE_TEST_DATA=1，或加 CLI 参数
# --include-test-data，即可把 test_data 从跳过集合中移除（两处打包逻辑均生效）。
SKIP_DIRS = {
    ".git", "__pycache__", "node_modules",
    ".venv", "venv", ".idea", ".vscode",
    ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "test_data",
}

# 可选跳过的目录：默认跳过，但可通过 include-test-data 回退放行
SKIP_DIRS_OPTIONAL = {"test_data"}

# raw 流式上传的默认切换阈值：8MB（可由 .env 的 plugin_upload_raw_threshold 覆盖）
DEFAULT_RAW_UPLOAD_THRESHOLD = 8 * 1024 * 1024


def want_include_test_data(cli_flag=False):
    """是否需要把 test_data 一并打包（默认瘦身，必要时回退）。

    任一为真即回退：CLI 参数 --include-test-data，或环境变量 TOON_INCLUDE_TEST_DATA=1。
    """
    if cli_flag:
        return True
    return str(os.environ.get("TOON_INCLUDE_TEST_DATA", "")).strip().lower() in (
        "1", "true", "yes", "on",
    )


def resolve_skip_dirs(with_test_data=False):
    """返回本次打包要跳过的目录集合。

    默认返回 SKIP_DIRS；with_test_data 为真时把 test_data 从跳过集合中移除。
    """
    if with_test_data:
        return {d for d in SKIP_DIRS if d not in SKIP_DIRS_OPTIONAL}
    return set(SKIP_DIRS)


def ensure_entry_js(plugin_dir, label=""):
    """打包前确保插件目录里有可上传的入口文件 entry.js。

    后端 /plugin/install 解包时会校验「包内必须存在 entry.js」，缺失直接
    返回 HTTP 400「插件入口文件不存在: entry.js」。而 entry.ts → entry.js
    的编译原先只发生在「安装成功之后」由后端现编（见 rebuild_entry），
    于是 entry.js 一旦缺失（被删、被清理、首次只提交了 entry.ts），
    打包阶段就先挂掉，编译永远等不到执行。

    这里在 zip 之前做一次前置兜底编译：entry.js 缺失（或比 entry.ts 更旧）
    且 entry.ts 存在时，用项目内已装的 esbuild 把 entry.ts 编成 entry.js。
    已有 entry.js 且不比 entry.ts 旧时不做任何事，不覆盖手写内容。

    返回 True 表示 entry.js 可用于打包；False 表示无法补齐（应跳过安装）。
    """
    import subprocess

    tag = (label + ": ") if label else ""
    js = os.path.join(plugin_dir, "entry.js")
    ts = os.path.join(plugin_dir, "entry.ts")

    # ★ 强制保证 entry.js 是 entry.ts 的最新编译产物（entry.ts 才是真源）。
    #   每次打包都重编，避免「手编的 entry.js 比 ts 新」导致 tbg 内是过期编译。
    if not os.path.isfile(ts):
        # 没有 entry.ts：若已有 entry.js 则直接放行（纯 JS 插件），否则报错
        if os.path.isfile(js):
            return True
        click.secho("  [ERR] " + tag + "既无 entry.js 也无 entry.ts，无法打包", fg="red")
        return False

    # ★ 必须 bundle 成自包含单文件（无 import / import.meta）：宿主持
    #   PluginExecutor 对含 import 的 entry 会跳过影子模块、直接 import，
    #   Node ESM 解析相对路径失败 → "entry 模块加载失败" → tick 恒返回空 state。
    #   ★ 2026-10-21 踩坑：早期这里漏了 --bundle，esbuild 只做单文件转译，
    #   entry.js 残留 `import ... from "./src/agents/plugins.prompts"`，
    #   安装到安卓部署机后小游戏永远开局超时。--bundle 一个都不能少。
    esbuild_args = ["entry.ts", "--bundle", "--format=esm", "--platform=node",
                    "--target=node18", "--outfile=entry.js"]

    # 优先用插件本地 node_modules 的 esbuild，回退到 npx / PATH 上的 esbuild
    esbuild_bin = os.path.join(plugin_dir, "node_modules", ".bin",
                               "esbuild.cmd" if sys.platform == "win32" else "esbuild")
    if os.path.isfile(esbuild_bin):
        cmd = [esbuild_bin] + esbuild_args
    else:
        # Windows 上 npx / esbuild 是 .cmd 包装器，CreateProcess 不走 PATHEXT，
        # 必须显式补 .cmd 后缀，否则报 [WinError 2] 系统找不到指定的文件
        if sys.platform == "win32":
            cmd = ["npx.cmd", "--no-install", "esbuild"] + esbuild_args
        else:
            cmd = ["npx", "--no-install", "esbuild"] + esbuild_args

    click.echo("  [BUILD] " + tag + "重编 entry.js (entry.ts → entry.js) ...")
    try:
        r = subprocess.run(cmd, cwd=plugin_dir, capture_output=True, text=True,
                           timeout=300)
    except Exception as ex:
        click.secho("  [WARN] " + tag + "entry 编译调用失败: " + str(ex), fg="yellow")
        return os.path.isfile(js)

    if r.returncode != 0 or not os.path.isfile(js):
        err = (r.stderr or r.stdout or "").strip().splitlines()
        tail = err[-1][:200] if err else ("returncode=" + str(r.returncode))
        click.secho("  [ERR] " + tag + "entry 编译失败: " + tail, fg="red")
        return False

    click.echo("  [BUILD] " + tag + "entry.js 已是最新编译")
    return True


def upload_plugin_zip(client, plugin_id, zip_bytes, upload_mode="auto", zip_path=None):
    """按体积自动（或显式）选择插件上传通道。

    - json：沿用 base64 JSON 通道（小包，兼容旧服务端）
    - raw ：走 /plugin/install-raw 流式上传，绕开 base64 膨胀与 express.json 体积上限

    阈值默认 8MB（.env 的 plugin_upload_raw_threshold 可覆盖）；upload_mode 取
    auto|raw|json，auto 时超过阈值自动改走 raw。raw 需要 zip 落盘：zip_path 已存在时
    直接复用（例如已保存的 .tpg），否则写系统临时文件并在上传完成后删除。
    """
    import base64
    import tempfile

    threshold = getattr(client, "plugin_upload_raw_threshold", 0) or DEFAULT_RAW_UPLOAD_THRESHOLD
    mode = upload_mode if upload_mode in ("raw", "json") else (
        "raw" if len(zip_bytes) > threshold else "json")

    if mode == "json":
        return client.install_plugin(plugin_id, base64.b64encode(zip_bytes).decode("ascii"))

    tmp_path = None
    path = zip_path
    if not path:
        fd, path = tempfile.mkstemp(prefix="toonplugin-", suffix=".tpg")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(zip_bytes)
        tmp_path = path
    try:
        return client.install_plugin_stream(plugin_id, path)
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def resolve_client(env_path=None):
    if env_path is None:
        for base in [os.getcwd(), os.path.dirname(CLI_ROOT)]:
            p = os.path.join(base, ".env")
            if os.path.isfile(p):
                env_path = p
                break
    client = ToonClient(env_path=env_path)
    # quick health-check
    try:
        client.list_plugins()
    except Exception as e:
        click.secho("[ERR] API failed: " + str(e), fg="red", err=True)
        sys.exit(1)
    return client


def _match_world(client, story):
    """按故事名在 /game/listWorlds 里精确 / 唯一模糊匹配世界，返回 world dict 或 None。"""
    worlds = client.list_worlds() or []
    if isinstance(worlds, dict):
        worlds = worlds.get("worlds") or worlds.get("list") or []
    hit = [w for w in worlds if str(w.get("name") or "") == story]
    if not hit:
        like = [w for w in worlds if story in str(w.get("name") or "")]
        if len(like) == 1:
            hit = like
        elif len(like) > 1:
            raise RuntimeError(f"故事名「{story}」模糊匹配到 {len(like)} 个世界，请用完整名称")
    return hit[0] if hit else None


def _world_sessions(client, story, world_id):
    """返回 (world_id, rows)；world_id 缺省时按故事名从 listWorlds 解析。"""
    if world_id is None:
        w = _match_world(client, story)
        if not w:
            return None, []
        world_id = w.get("id")
    rows = client.list_sessions(world_id) or []
    if isinstance(rows, dict):
        rows = rows.get("sessions") or rows.get("list") or []
    return world_id, rows


def _pick_session(rows):
    """挑当前会话：优先 active，其次 updateTime 最新。"""
    if not rows:
        return None
    active = [r for r in rows if str(r.get("status") or "").lower() == "active"]
    pool = active or rows
    return sorted(pool, key=lambda r: r.get("updateTime") or 0, reverse=True)[0]


def _mapset_story_json(story):
    """定位本地地图集 story.json（workshops/.../map_design/<故事>/story.json），不存在返回 None。"""
    repo_root = os.path.dirname(CLI_ROOT)
    cand = os.path.join(repo_root, "workshops", "toonflow-field-survival",
                        "map_design", story, "story.json")
    return cand if os.path.isfile(cand) else None


def _resolve_plugin_id(raw: str) -> str:
    """把「插件文件夹名」解析为运行时真正使用的 pluginId（manifest.id）。

    -i 常传 toonflow-field-survival（文件夹），但运行时按 manifest.id
    （如 com.toonflow.minigame-field-survival）读写 t_plugin_session_data。
    若 raw 指向含 manifest.json 的目录，取其真实 id；否则原样返回。
    """
    if not raw:
        return raw
    # 已是完整 id（含点号，形如 com.toonflow...）通常无需解析
    if "." in raw and not os.path.isdir(raw):
        return raw
    candidates = [raw, os.path.join("plugins", raw), os.path.join(os.path.dirname(CLI_ROOT), "plugins", raw)]
    for cand in candidates:
        if os.path.isdir(cand):
            mpath = os.path.join(cand, "manifest.json")
            if os.path.isfile(mpath):
                try:
                    with open(mpath, encoding="utf-8") as f:
                        m = _json.load(f)
                    mid = m.get("id")
                    if mid:
                        return str(mid)
                except Exception:
                    pass
    return raw


@click.group()
@click.option("--env", "-e", type=click.Path(exists=True), help=".env path")
@click.pass_context
def main(ctx, env):
    ctx.ensure_object(dict)
    ctx.obj["env_path"] = env


@main.command()
@click.option("--install-all", is_flag=True, help="Install all plugins under plugins/")
@click.option("--install", "-i", help="Install specified plugins (comma-separated)")
@click.option("--plugins-dir", default="plugins", help="Plugin root")
@click.option("--no-tpg", is_flag=True, help="Don't save .tpg files locally")
@click.option("--upload-mode", type=click.Choice(["auto", "raw", "json"]), default="auto",
              help="Upload channel: auto (by size) / raw (stream) / json (base64)")
@click.option("--include-test-data", is_flag=True,
              help="Include test_data/ in package (default: slim package, test_data skipped)")
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.pass_context
def plugins(ctx, install_all, install, plugins_dir, no_tpg, upload_mode, include_test_data, enable):
    """List / install plugins"""

    client = resolve_client(ctx.obj["env_path"])

    # ── Install mode ──────────────────────────────────────────────
    if install_all or install:
        import zipfile, io

        if install_all:
            targets = sorted(p for p in os.listdir(plugins_dir)
                            if os.path.isdir(os.path.join(plugins_dir, p))
                            and not p.startswith("."))
        else:
            targets = [n.strip() for n in install.split(",") if n.strip()]

        if not targets:
            click.echo("No plugins found")
            return

        ok_count = 0; fail_count = 0
        for tname in targets:
            pdir = os.path.join(plugins_dir, tname)
            mp = os.path.join(pdir, "manifest.json")
            if not os.path.isfile(mp):
                click.echo("[SKIP] " + tname + ": no manifest.json")
                continue
            with open(mp, encoding="utf-8") as f:
                manifest = _json.load(f)
            plugin_id = manifest.get("id")
            if not plugin_id:
                click.echo("[SKIP] " + tname + ": no id in manifest")
                continue

            # ── Build vue/ subdirectory if present ──────────────────
            vue_dir = os.path.join(pdir, "vue")
            if os.path.isdir(vue_dir):
                import shutil, subprocess
                pkg_json = os.path.join(vue_dir, "package.json")
                if os.path.isfile(pkg_json):
                    click.echo("  [BUILD] " + tname + ": building vue/ ...")
                    try:
                        # Resolve yarn path — on Windows, "yarn" is actually "yarn.cmd"
                        # which subprocess must resolve via PATHEXT / which()
                        _yarn = shutil.which("yarn") or "yarn"
                        # Auto-install deps if node_modules missing
                        if not os.path.isdir(os.path.join(vue_dir, "node_modules")):
                            click.echo("  [BUILD] " + tname + ": installing deps ...")
                            r = subprocess.run([_yarn], cwd=vue_dir,
                                              capture_output=True, text=True,
                                              encoding="utf-8", errors="replace",
                                              timeout=180)
                            if r.returncode != 0:
                                click.secho("  [WARN] " + tname + ": yarn install failed: " +
                                            (r.stderr or "")[:200], fg="yellow")
                        # Build
                        result = subprocess.run(
                            [_yarn, "vite", "build"],
                            cwd=vue_dir,
                            capture_output=True,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            timeout=120,
                        )
                        if result.returncode == 0:
                            click.echo("  [BUILD] " + tname + ": done")
                            # ── Rename vite output to manifest-specified entry ──
                            # vite-plugin-singlefile always emits "index.html",
                            # but the iframe (and manifest.contributes.minigame.entry)
                            # expect the path declared in manifest.json.
                            try:
                                mg_entry = (manifest.get("contributes", {})
                                                       .get("minigame", {})
                                                       .get("entry", ""))
                                if mg_entry:
                                    ui_dir_abs = os.path.join(pdir,
                                        os.path.dirname(mg_entry))  # e.g. "ui"
                                    want_name = os.path.basename(mg_entry)  # e.g. "game.html"
                                    src_html = os.path.join(ui_dir_abs, "index.html")
                                    dst_html = os.path.join(ui_dir_abs, want_name)
                                    if os.path.isfile(src_html):
                                        if os.path.abspath(src_html) != os.path.abspath(dst_html):
                                            if os.path.isfile(dst_html):
                                                os.remove(dst_html)
                                            os.replace(src_html, dst_html)
                                            click.echo("  [BUILD] " + tname +
                                                       ": ui/index.html -> ui/" + want_name)
                            except Exception as ex:
                                click.secho("  [WARN] " + tname +
                                            ": rename ui/index.html failed: " + str(ex),
                                            fg="yellow")
                        else:
                            click.secho("  [WARN] " + tname + ": vite build failed: " +
                                        result.stderr[:200], fg="yellow")
                    except Exception as ex:
                        click.secho("  [WARN] " + tname + ": build error: " + str(ex),
                                    fg="yellow")

            # ★ 打包前置：entry.js 缺失时先由 entry.ts 编译补齐（后端 install 校验硬要求）
            if not ensure_entry_js(pdir, tname):
                fail_count += 1
                continue

            # Build zip in memory（默认瘦身：SKIP_DIRS 剔除 test_data 等冗余目录）
            buf = io.BytesIO()
            skip = resolve_skip_dirs(want_include_test_data(include_test_data))
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for base, dirs, files in os.walk(pdir):
                    dirs[:] = [d for d in dirs if d not in skip]
                    for fn in files:
                        if fn.endswith(".pyc") or fn == ".DS_Store":
                            continue
                        # ★ Windows 设备名（nul/con/prn/aux 等）打包会触发 relpath 抛
                        #   ValueError: path is on mount '\\.\nul'，跳过
                        if fn.lower() in {"nul", "con", "prn", "aux"}:
                            continue
                        fp = os.path.join(base, fn)
                        rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                        zf.write(fp, rel)
            zip_bytes = buf.getvalue()

            # Save .tpg to disk (optional)
            tpg_path = None
            if not no_tpg:
                tpg_dir = os.path.join(os.path.dirname(CLI_ROOT), "plugins_tbg")
                os.makedirs(tpg_dir, exist_ok=True)
                version = manifest.get("version", "0.0.0")
                tpg_path = os.path.join(tpg_dir, tname + "-" + version + ".tpg")
                with open(tpg_path, "wb") as f:
                    f.write(zip_bytes)
                click.echo("  [TPG] saved: " + tpg_path)

            # Upload：auto 按体积选 raw/json；raw 复用已落盘的 .tpg，--no-tpg 时走临时文件
            try:
                result = upload_plugin_zip(client, plugin_id, zip_bytes, upload_mode,
                                           zip_path=tpg_path)
                # Toonflow returns {pluginId, version, dirName, upgraded}
                # MCP mode may return {ok, version}
                ok = (result.get("ok") in (True, "true")) or bool(result.get("pluginId"))
                if ok:
                    if enable:
                        client.set_plugin_enabled(plugin_id, True)
                    click.secho("[OK] " + tname + " (" + plugin_id + ") v" +
                                result.get("version", "?"), fg="green")
                    ok_count += 1
                else:
                    click.secho("[ERR] " + tname + ": " + str(result), fg="red")
                    fail_count += 1
            except Exception as e:
                click.secho("[ERR] " + tname + ": " + str(e), fg="red")
                fail_count += 1

        click.echo("--- Done: " + str(ok_count) + " ok / " + str(fail_count) + " failed ---")
        return

    # ── List installed ────────────────────────────────────────────
    click.secho("Installed plugins:", bold=True)
    items = client.list_plugins()
    for p in items:
        pid = p.get("pluginId") or p.get("id", "")
        name = p.get("name", "")
        ver = p.get("version", "")
        enabled = p.get("enabled", False)
        flag = "+" if enabled else "-"
        click.echo("  [" + flag + "] " + name + " v" + ver + " (" + pid + ")")


@main.command(name="install")
@click.argument("plugin_dir", type=click.Path(exists=True))
@click.option("--upload-mode", type=click.Choice(["auto", "raw", "json"]), default="auto",
              help="Upload channel: auto (by size) / raw (stream) / json (base64)")
@click.option("--include-test-data", is_flag=True,
              help="Include test_data/ in package (default: slim package, test_data skipped)")
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.pass_context
def install_cmd(ctx, plugin_dir, upload_mode, include_test_data, enable):
    """Install a single plugin from directory"""
    import zipfile, io

    client = resolve_client(ctx.obj["env_path"])
    manifest_path = os.path.join(plugin_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        click.secho("[ERR] manifest.json not found", fg="red")
        return

    with open(manifest_path, encoding="utf-8") as f:
        manifest = _json.load(f)
    plugin_id = manifest.get("id")
    if not plugin_id:
        click.secho("[ERR] manifest.json missing id", fg="red")
        return

    # ── Build vue/ subdirectory if present ──────────────────
    vue_dir = os.path.join(plugin_dir, "vue")
    if os.path.isdir(vue_dir):
        import shutil, subprocess
        pkg_json = os.path.join(vue_dir, "package.json")
        if os.path.isfile(pkg_json):
            click.echo("[BUILD] building vue/ ...")
            try:
                _yarn = shutil.which("yarn") or "yarn"
                if not os.path.isdir(os.path.join(vue_dir, "node_modules")):
                    r = subprocess.run([_yarn], cwd=vue_dir,
                                      capture_output=True, text=True,
                                      encoding="utf-8", errors="replace",
                                      timeout=180)
                    if r.returncode != 0:
                        click.secho("[WARN] yarn install failed: " +
                                    (r.stderr or "")[:200], fg="yellow")
                result = subprocess.run(
                    [_yarn, "vite", "build"],
                    cwd=vue_dir,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=120,
                )
                if result.returncode == 0:
                    click.echo("[BUILD] done")
                    # Rename vite output to manifest-specified entry filename
                    try:
                        mg_entry = (manifest.get("contributes", {})
                                               .get("minigame", {})
                                               .get("entry", ""))
                        if mg_entry:
                            ui_dir_abs = os.path.join(plugin_dir, os.path.dirname(mg_entry))
                            want_name = os.path.basename(mg_entry)
                            src_html = os.path.join(ui_dir_abs, "index.html")
                            dst_html = os.path.join(ui_dir_abs, want_name)
                            if os.path.isfile(src_html):
                                if os.path.abspath(src_html) != os.path.abspath(dst_html):
                                    if os.path.isfile(dst_html):
                                        os.remove(dst_html)
                                    os.replace(src_html, dst_html)
                                    click.echo("[BUILD] ui/index.html -> " + want_name)
                    except Exception as ex:
                        click.secho("[WARN] rename ui/index.html failed: " + str(ex), fg="yellow")
                else:
                    click.secho("[WARN] vite build failed: " +
                                result.stderr[:200], fg="yellow")
            except Exception as ex:
                click.secho("[WARN] build error: " + str(ex), fg="yellow")

    # ★ 打包前置：entry.js 缺失时先由 entry.ts 编译补齐（后端 install 校验硬要求）
    if not ensure_entry_js(plugin_dir, plugin_id):
        click.secho("[ERR] Install aborted: entry.js 无法生成", fg="red")
        return

    # 打包（默认瘦身：SKIP_DIRS 剔除 test_data 等冗余目录）
    buf = io.BytesIO()
    skip = resolve_skip_dirs(want_include_test_data(include_test_data))
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in skip]
            for fn in files:
                if fn.endswith(".pyc") or fn == ".DS_Store":
                    continue
                # ★ Windows 设备名（nul/con/prn/aux 等）跳过
                if fn.lower() in {"nul", "con", "prn", "aux"}:
                    continue
                fp = os.path.join(base, fn)
                rel = os.path.relpath(fp, plugin_dir).replace(os.sep, "/")
                zf.write(fp, rel)
    zip_bytes = buf.getvalue()

    click.echo("Installing " + plugin_id + " ...")
    result = upload_plugin_zip(client, plugin_id, zip_bytes, upload_mode)
    ok = (result.get("ok") in (True, "true")) or bool(result.get("pluginId"))
    if ok:
        click.secho("[OK] Installed v" + result.get("version", "?"), fg="green")
        if enable:
            client.set_plugin_enabled(plugin_id, True)
            click.echo("  Enabled")
        # ★ 一致性保证：触发后端 esbuild 现编 entry.ts → 清 entryModuleCache
        #   装完自动生效，无需手动重启 60002。失败仅警告，不阻塞安装成功状态。
        try:
            rebuild = client.rebuild_entry(plugin_id, reason="cli:install")
            data = rebuild.get("data") if isinstance(rebuild, dict) else None
            if data and data.get("rebuilt"):
                click.echo("  entry.js 现编完成（mtime 失效已清缓存）")
            elif data and data.get("rebuildError"):
                click.secho("[WARN] esbuild 重建失败: " + str(data.get("rebuildError")), fg="yellow")
        except Exception as ex:
            click.secho("[WARN] rebuild 调失败（不影响安装）: " + str(ex), fg="yellow")
    else:
        click.secho("[ERR] Install failed: " + str(result), fg="red")


# ─────────────────────────────────────────────────────────────────────────
# 把地图目录打包成 .tbg 文件（zip 压缩、跳过 test_data/）
#   - -build：只产出 .tbg 文件
#   - -u：产出 .tbg 后再 base64 写 t_plugin_session_data.map_visual（v6 起主 key，
#         兼容同步写 map_data；运行时 entry 按当前故事读并注入会话）
# ─────────────────────────────────────────────────────────────────────────
def _tbg_skip_file(fn: str) -> bool:
    """打包 .tbg 时跳过的单文件：原图 master、历史备份、已生成的包本体、文档表。"""
    low = fn.lower()
    if fn in {"data.xlsx"}:
        return True
    if low.endswith((".original.png", ".tbg", ".tbg.devcache", ".bak")):
        return True
    if ".pre-" in fn:  # maps/bak、images/bak 之外散落在外的 *.pre-时间戳 备份
        return True
    return False


def build_tbg_file(source_path: str) -> dict:
    """把目录（或单个 .tbg/.json 文件）打包成 .tbg 写到 source_path 同级。

    返回 {"tbg_path", "tbg_bytes", "files", "size"}。
    """
    import base64, zipfile, io
    # 运行时只消费 maps/ images/ events/ data/ overrides/ 等正式素材；
    # .cache（切片/渲染临时图）、bak（历史备份）、previews（概念参考稿）一律不随包分发，
    # 否则临时大图会把包撑到上百 MB，触发服务端 413 Payload Too Large。
    SKIP_DIRS = {"test_data", "__pycache__", "node_modules", ".git",
                 ".cache", "bak", "previews"}

    if os.path.isdir(source_path):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(source_path):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for fn in files:
                    if _tbg_skip_file(fn):
                        continue
                    fp = os.path.join(root, fn)
                    arc = os.path.relpath(fp, source_path).replace(os.sep, "/")
                    zf.write(fp, arc)
        tbg_bytes = buf.getvalue()
        tbg_path = source_path.rstrip("/\\") + ".tbg"
        with open(tbg_path, "wb") as f:
            f.write(tbg_bytes)
        with zipfile.ZipFile(io.BytesIO(tbg_bytes)) as zf:
            names = zf.namelist()
        return {"tbg_path": tbg_path, "tbg_bytes": tbg_bytes, "files": names, "size": len(tbg_bytes)}
    elif os.path.isfile(source_path) and source_path.lower().endswith((".tbg", ".zip")):
        # 已经是 .tbg / .zip 直接拷贝到同级（覆盖）
        with open(source_path, "rb") as f:
            tbg_bytes = f.read()
        tbg_path = source_path  # 已存在路径
        return {"tbg_path": tbg_path, "tbg_bytes": tbg_bytes, "files": [], "size": len(tbg_bytes)}
    elif os.path.isfile(source_path) and source_path.lower().endswith(".json"):
        # 单 json 文件 → 包成 zip（一个 entry）
        import zipfile, io as _io
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(source_path, os.path.basename(source_path))
        tbg_bytes = buf.getvalue()
        tbg_path = source_path[:-5] + ".tbg"
        with open(tbg_path, "wb") as f:
            f.write(tbg_bytes)
        return {"tbg_path": tbg_path, "tbg_bytes": tbg_bytes, "files": [os.path.basename(source_path)], "size": len(tbg_bytes)}
    else:
        raise RuntimeError(f"不支持的 source_path: {source_path}")


def _seed_story_task_data(client, plugin_id: str, story: str, source_dir: str, session_id: str) -> None:
    """上传故事地图包时，自动把故事包里的主线任务链 / 任务表种进插件会话数据。

    ★ 2026-11-13：修复「部署版没有主线任务」——`-u` 只写 map_visual/map_data，
      而 entry.ensureChainDefs 读 chain_defs:<故事名>（key 不同）→ 主线页恒空。
      dev-host 桩会自动播种（vite.config.ts seedChainDefs/seedQuestDefs），
      真机走 CLI 上传，这里补上同样的一步，保证「本地有 = 部署有」。

    规则（与 vite 桩保持一致）：
      - 主线链 → key `chain_defs:<故事名>`，源 events/任务事件/main-quests.json
      - 任务表 → key `quest_defs`（全局单键），源 events/任务事件/quests.json
      - 两者都「只补不覆盖」：已有同 id 的条目保留（用户/CLI 手工调整优先）
      - 找不到源文件就跳过（不报错）
    """
    if not story:
        return
    candidates = [
        os.path.join(source_dir, "events", "任务事件"),
        os.path.join(source_dir, "event", "任务事件"),
    ]
    tasks_dir = next((d for d in candidates if os.path.isdir(d)), None)
    if not tasks_dir:
        click.secho("[seed] 未找到故事包任务事件目录（events/任务事件），跳过主线链播种", fg="yellow")
        return

    def _load(name):
        fp = os.path.join(tasks_dir, name)
        if not os.path.isfile(fp):
            return None
        try:
            with open(fp, "r", encoding="utf-8") as f:
                return _json.load(f)
        except Exception as e:
            click.secho(f"[seed] 读取 {name} 失败：{e}", fg="yellow")
            return None

    def _arr(obj):
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict):
            for k in ("chains", "quests", "defs"):
                if isinstance(obj.get(k), list):
                    return obj[k]
        return []

    def _merge(old_obj, new_arr):
        """只补不覆盖：按 id 合并，旧条目优先"""
        old_arr = _arr(old_obj)
        seen = set()
        merged = []
        for x in old_arr:
            sid = str((x or {}).get("id") or "")
            seen.add(sid)
            merged.append(x)
        added = 0
        for x in new_arr:
            sid = str((x or {}).get("id") or "")
            if not sid or sid in seen:
                continue
            seen.add(sid)
            merged.append(x)
            added += 1
        return merged, added

    # ① 主线链
    mq = _load("main-quests.json")
    if mq:
        arr = _arr(mq)
        if arr:
            key = "chain_defs:" + story
            try:
                cur = client.get_plugin_data(plugin_id, key, session_id=session_id, story=story)
                if isinstance(cur, dict) and "value" in cur:
                    cur = cur.get("value")
                merged, added = _merge(cur, arr)
                payload = {"version": (mq.get("version") if isinstance(mq, dict) else 1) or 1, "chains": merged}
                client.set_plugin_data(plugin_id, key, payload, session_id=session_id, story=story)
                click.secho(f"[seed] 主线任务链已播种 {key}（{len(merged)} 条，新增 {added}）", fg="green")
            except Exception as e:
                click.secho(f"[seed] 主线任务链播种失败（不影响地图上传）：{e}", fg="yellow")

    # ② 任务表（全局 key，与 entry.ensureQuestDefs 读取口径一致）
    qs = _load("quests.json")
    if qs:
        arr = _arr(qs)
        if arr:
            key = "quest_defs"
            try:
                cur = client.get_plugin_data(plugin_id, key, session_id=session_id, story=story)
                if isinstance(cur, dict) and "value" in cur:
                    cur = cur.get("value")
                merged, added = _merge(cur, arr)
                payload = {"version": (qs.get("version") if isinstance(qs, dict) else 1) or 1, "quests": merged}
                client.set_plugin_data(plugin_id, key, payload, session_id=session_id, story=story)
                click.secho(f"[seed] 任务表已播种 {key}（{len(merged)} 条，新增 {added}）", fg="green")
            except Exception as e:
                click.secho(f"[seed] 任务表播种失败（不影响地图上传）：{e}", fg="yellow")


# ─────────────────────────────────────────────────────────────────────────
# 插件会话数据（t_plugin_session_data）—  对应后端 POST /plugin/data
# 用法：
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 --list
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -k map_data --get
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 走廊-第二季 -k map_data --set --value-file map.json
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -k map_data --remove
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -spriteBinds -skillMeta -itemMeta
#       → 导出 sys_state 的实体形象绑定/技能配置/物品配置到
#         .cache/toonflow-field-survival/plugin_session_data/{故事}/{时间戳}/
#         （spriteBinds 额外解码 PNG；_export_manifest.json 记录 服务器/故事/会话/文件清单）
# sessionId 默认为 "all"（跨会话共享，与 req.md 约定一致）；
# 传 --session 切换到具体会话。
# ─────────────────────────────────────────────────────────────────────────

# sys_state 里「用户配置类」字段的导出实现（-spriteBinds / -skillMeta / -itemMeta）。
# 背景（2026-11-17）：persistSys 覆盖写事故把某会话的 spriteBinds/skillMeta/itemMeta 抹空，
# 需要一条不进数据库的取证/备份通道：按故事解析会话 → 读 sys_state → 落 JSON（+PNG）。
# ★ CLI_ROOT 是 src/（既有约定：打包产物 plugins_tbg 用 dirname(CLI_ROOT) 做仓库根），
#   仓库根/.cache 才是临时目录的正确位置（AGENTS.md）——所以这里也要 dirname 一级。
# ★ 目录结构（2026-11-18）：{base}/{story}/{time}/ —— 同一故事多次导出互不覆盖，
#   每次导出在 _export_manifest.json 里记录 故事 / 会话清单 / 服务器地址。
EXPORT_BASE_DIR = os.path.join(os.path.dirname(CLI_ROOT), ".cache", "toonflow-field-survival", "plugin_session_data")


def _export_timestamp():
    """导出批次目录名：YYYYMMDD_HHMMSS（datetime 不可用时退化为秒级时间戳）。"""
    if datetime:
        return datetime.now().strftime("%Y%m%d_%H%M%S")
    import time as _time
    return str(int(_time.time()))


def _safe_dirname(name, fallback="unnamed"):
    """目录名清洗：保留中文，只替换文件系统非法字符（Windows: \\ / : * ? " < > |）。"""
    import re as _re
    s = _re.sub(r'[\\/:*?"<>|]+', "_", str(name or "").strip())
    return s or fallback


def _unwrap_plugin_value(r):
    """get_plugin_data 回包取 value（兼容 {data:{value}} 旧信封与 {value} 新解包两种形态）。"""
    if isinstance(r, dict) and isinstance(r.get("data"), dict) and "value" in r["data"]:
        return r["data"].get("value")
    return r.get("value") if isinstance(r, dict) else None


def _safe_filename(name, fallback="unnamed"):
    """文件名清洗：只留字母数字下划线连字符，其余替换为 _（中文角色键转写为拼音不可行，直接 _ 化）。"""
    import re as _re
    s = _re.sub(r"[^A-Za-z0-9_-]+", "_", str(name or "")).strip("_")
    return s or fallback


def _decode_data_url_image(data_url, out_path):
    """data:image/<mime>;base64,xxx → 解码写文件；返回 (ok, ext)。非 data: URL 返回 (False, None)。"""
    import base64 as _base64
    s = str(data_url or "")
    if not s.startswith("data:image/"):
        return False, None
    try:
        head, b64 = s.split(",", 1)
        ext = head[len("data:image/"):].split(";")[0] or "png"
        if ext == "jpeg":
            ext = "jpg"
        raw = _base64.b64decode(b64)
        with open(out_path + "." + ext, "wb") as f:
            f.write(raw)
        return True, ext
    except Exception:
        return False, None


def _export_session_fields(client, plugin_id, story, session_id, fields, out_dir):
    """按故事（或指定会话）导出 sys_state 的指定字段。

    目录结构（2026-11-18）：{base}/{story}/{YYYYMMDD_HHMMSS}/
      · base        = --out 或 .cache/toonflow-field-survival/plugin_session_data/
      · story       = -story 的故事名（文件系统非法字符清洗）；--session 模式无故事名时
                      退化为 _session_<sessionId>，保证两种模式都有归属目录
      · time        = 导出批次时间戳，同一故事多次导出互不覆盖
    同一批次内记录 来源（服务器 / 故事 / 会话清单）到 _export_manifest.json。

    输出：
      <dir>/<sessionId>.<field>.json          字段原样 JSON
      <dir>/sprites/<sessionId>/<角色>.png    spriteBinds 里的 data:URL 图（便利产物）
      <dir>/_export_manifest.json             导出清单（服务器/故事/会话/字段/文件列表）
    """
    # ① 解析会话清单 --------------------------------------------------------
    sessions = []          # [(sessionId, title)]
    if session_id and session_id != "all":
        sessions = [(session_id, "")]
        click.echo(f"[export] 会话：--session 指定 {session_id}")
    elif story:
        worlds = client.list_worlds() or []
        if isinstance(worlds, dict):   # 防御：极老后端包一层 {worlds:[...]}
            worlds = worlds.get("worlds") or worlds.get("list") or []
        hit = [w for w in worlds if str(w.get("name") or "") == story]
        if not hit:
            like = [w for w in worlds if story in str(w.get("name") or "")]
            if len(like) == 1:
                hit = like
            elif len(like) > 1:
                click.secho(f"[ERR] 故事名「{story}」模糊匹配到 {len(like)} 个世界，请用完整名称："
                            + "、".join(str(w.get('name')) for w in like[:5]), fg="red")
                return
        if not hit:
            click.secho(f"[ERR] 找不到名为「{story}」的故事（/game/listWorlds 共 {len(worlds)} 个）", fg="red")
            return
        world = hit[0]
        rows = client.list_sessions(world.get("id")) or []
        if isinstance(rows, dict):
            rows = rows.get("sessions") or rows.get("list") or []
        sessions = [(str(r.get("sessionId") or ""), str(r.get("title") or "")) for r in rows]
        click.echo(f"[export] 故事「{story}」(worldId={world.get('id')}) → {len(sessions)} 个会话")
        if not sessions:
            click.secho("[WARN] 该故事没有任何会话（未开局过）→ 无 sys_state 可导出", fg="yellow")
            return
    else:
        click.secho("[ERR] 需要 -story <故事名>（解析该故事全部会话）或 --session <gs_xxx>（单会话）；"
                    "sys_state 是会话级存档，sessionId=\"all\" 下不存在", fg="red")
        return

    # ② 目标目录：{base}/{story}/{time}（--session 无故事名时退化为 _session_<sid>）----
    base_dir = out_dir or EXPORT_BASE_DIR
    if story:
        story_dir_name = _safe_dirname(story)
    elif sessions:
        story_dir_name = "_session_" + _safe_filename(sessions[0][0], "unknown")
    else:
        story_dir_name = "_session_unknown"
    batch_dir_name = _export_timestamp()
    out_dir = os.path.join(base_dir, story_dir_name, batch_dir_name)
    os.makedirs(out_dir, exist_ok=True)
    sprites_dir = os.path.join(out_dir, "sprites")
    written = []           # (path, bytes)
    png_count = 0

    # ② 逐会话读 sys_state、抽取字段落盘 ------------------------------------
    for sid, title in sessions:
        if not sid:
            continue
        try:
            r = client.get_plugin_data(plugin_id, "sys_state", session_id=sid, story=story)
        except Exception as e:
            click.secho(f"[WARN] {sid} 读 sys_state 失败：{e}", fg="yellow")
            continue
        value = _unwrap_plugin_value(r)
        if not value or not isinstance(value, dict):
            click.secho(f"[WARN] {sid} sys_state 未存储或为空（未开局 / 数据已被清）→ 跳过", fg="yellow")
            continue

        for field in fields:
            fv = value.get(field)
            if fv is None:
                click.secho(f"[WARN] {sid} sys_state.{field} 不存在 → 跳过", fg="yellow")
                continue
            path = os.path.join(out_dir, f"{sid}.{field}.json")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                _json.dump(fv, f, ensure_ascii=False, indent=2)
            written.append((path, os.path.getsize(path)))
            click.echo(f"  [OK] {os.path.relpath(path, os.path.dirname(CLI_ROOT))}  ({os.path.getsize(path)} bytes)")

        # spriteBinds 便利产物：把形象图解码成图片文件。
        # ★ 2026-11-18 资产外置适配：image 可能是 `asset:<assetId>` 引用
        #   （base64 已外置到 t_plugin_session_data 的 sprite_asset:<assetId> key），
        #   此处逐个拉回再解码；data:URL（旧格式/小图）与引用路径（preset）照旧处理。
        if "spriteBinds" in fields:
            binds = value.get("spriteBinds") or {}
            if isinstance(binds, dict) and binds:
                sid_dir = os.path.join(sprites_dir, _safe_filename(sid, "session"))
                os.makedirs(sid_dir, exist_ok=True)
                for role_key, bind in binds.items():
                    image = bind.get("image") if isinstance(bind, dict) else bind
                    if not isinstance(image, str) or not image:
                        continue
                    if image.startswith("asset:"):
                        asset_id = image[len("asset:"):]
                        try:
                            ar = client.get_plugin_data(plugin_id, f"sprite_asset:{asset_id}", session_id=sid)
                        except Exception as e:
                            click.secho(f"  [WARN] {role_key}: 资产 sprite_asset:{asset_id} 读取失败（{e}）→ 跳过", fg="yellow")
                            continue
                        av = (ar or {}).get("value") if isinstance(ar, dict) else None
                        data_url = (av or {}).get("dataUrl") if isinstance(av, dict) else None
                        if not isinstance(data_url, str) or not data_url:
                            click.secho(f"  [WARN] {role_key}: 资产 sprite_asset:{asset_id} 无 dataUrl → 跳过", fg="yellow")
                            continue
                        ok, ext = _decode_data_url_image(data_url, os.path.join(sid_dir, _safe_filename(role_key, "role")))
                        if ok:
                            png_count += 1
                            click.echo(f"  [OK] sprites/{_safe_filename(sid, 'session')}/{_safe_filename(role_key, 'role')}.{ext}  (via asset:{asset_id})")
                        continue
                    ok, ext = _decode_data_url_image(image, os.path.join(sid_dir, _safe_filename(role_key, "role")))
                    if ok:
                        png_count += 1
                        click.echo(f"  [OK] sprites/{_safe_filename(sid, 'session')}/{_safe_filename(role_key, 'role')}.{ext}")
                    elif not str(image).startswith("data:"):
                        click.echo(f"  [INFO] {role_key}: 形象是引用路径（非内嵌 data:URL）→ 不解码，JSON 里保留原值")

    # ③ 导出清单（记录来源：服务器 / 故事 / 会话 / 字段 / 文件）--------------------
    manifest = {
        "exportedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S") if datetime else None,
        "server": str(getattr(client, "base_url", "") or ""),
        "story": story or "",
        "pluginId": plugin_id,
        "sessions": [{"sessionId": s, "title": t} for s, t in sessions],
        "fields": fields,
        "files": [os.path.relpath(p, os.path.dirname(CLI_ROOT)) for p, _ in written],
        "pngDecoded": png_count,
    }
    mpath = os.path.join(out_dir, "_export_manifest.json")
    with open(mpath, "w", encoding="utf-8", newline="\n") as f:
        _json.dump(manifest, f, ensure_ascii=False, indent=2)

    click.secho(f"\n[OK] 导出完成：{len(written)} 个 JSON + {png_count} 张图 → {os.path.relpath(out_dir, os.path.dirname(CLI_ROOT))}/"
                f"\n     来源：server={manifest['server']}  story={manifest['story'] or '(--session 模式)'}"
                f"  sessions={[s for s, _ in sessions]}"
                f"\n     清单：_export_manifest.json", fg="green")


@main.command(name="story_info")
@click.option("--story", "-s", required=True, help="故事名称（如 赦夜人冥夜走廊-第二季）")
@click.option("--worldid", "world_id", type=int, default=None, help="世界 ID（可选）")
@click.option("--roles", is_flag=True, help="只显示角色列表（roles/npcs）")
@click.option("--state", is_flag=True, help="只显示 state 顶层字段")
@click.option("--bind", is_flag=True, help="把解析到的 sessionId 回写本地地图集 story.json")
@click.option("--session", "session_id", default=None, help="显式指定会话 id（默认取该世界 active/最新会话）")
@click.pass_context
def story_info(ctx, story, world_id, roles, state, bind, session_id):
    """获取 /game/storyInfo 接口数据（角色、状态、动态事件等）。

    注意：storyInfo 回包不含 sessionId；会话 id 需另走 /game/listSession 按 worldId 解析。

    用法示例：
      python -m toon_plugins story_info -s 赦夜人冥夜走廊-第二季 --worldid 47
      python -m toon_plugins story_info -s 赦夜人冥夜走廊-第二季 --roles
      python -m toon_plugins story_info -s 赦夜人冥夜走廊-第二季 --state
      python -m toon_plugins story_info -s 末世选择，从解析神明开始成神 --worldid 48 --bind
    """
    client = resolve_client(ctx.obj["env_path"])
    result = client.story_info(story, world_id)

    # 会话清单：storyInfo 不返回 sessionId，这里走 listSession 解析当前会话
    wid, rows = _world_sessions(client, story, world_id)
    sid = session_id
    if not sid and rows:
        sid = (_pick_session(rows) or {}).get("sessionId")

    if bind:
        if not sid:
            click.secho("[ERR] 没有可绑定的会话（该世界未开局过）", fg="red", err=True)
            sys.exit(1)
        sp = _mapset_story_json(story)
        if not sp:
            click.secho(f"[ERR] 找不到本地地图集 story.json：{story}", fg="red", err=True)
            sys.exit(1)
        data = {}
        try:
            with open(sp, encoding="utf-8") as fh:
                data = _json.load(fh)
        except Exception:
            pass
        data["storyName"] = story
        data["sessionId"] = sid
        data["sessionId_1"] = sid
        if wid is not None:
            data["worldId"] = int(wid)
        tmp = sp + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            _json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, sp)
        click.secho(f"[OK] 已回写 sessionId={sid} → {sp}", fg="green")

    if state:
        # 只显示 state 顶层字段
        state_data = result.get("state", {})
        click.echo(_json.dumps(state_data, ensure_ascii=False, indent=2))
        return

    if roles:
        # 只显示角色（player + npcs）
        state_data = result.get("state", {})
        player = state_data.get("player", {})
        npcs = state_data.get("npcs", {})

        click.secho("=== 玩家 ===", bold=True)
        pcj = player.get("parameterCardJson", {})
        click.echo(f"  id: {player.get('id')}")
        click.echo(f"  name: {player.get('name')}")
        click.echo(f"  roleType: {player.get('roleType')}")
        click.echo(f"  level: {pcj.get('level', 'N/A')}")
        click.echo(f"  hp: {pcj.get('hp', 'N/A')}/{pcj.get('hp', 'N/A')}")
        click.echo(f"  x/y: {pcj.get('x', 'N/A')}/{pcj.get('y', 'N/A')}")
        click.echo(f"  mapName: {pcj.get('mapName', 'N/A')}")

        click.secho(f"\n=== NPC ({len(npcs)} 个) ===", bold=True)
        if isinstance(npcs, dict):
            for k, v in npcs.items():
                pcj = v.get("parameterCardJson", {})
                click.echo(f"\n  [{k}] {v.get('name')} ({v.get('roleType')})")
                click.echo(f"    level: {pcj.get('level', 'N/A')}")
                click.echo(f"    hp: {pcj.get('hp', 'N/A')}/{pcj.get('maxHp', pcj.get('hp', 'N/A'))}")
                click.echo(f"    x/y: {pcj.get('x', 'N/A')}/{pcj.get('y', 'N/A')}")
                click.echo(f"    mapName: {pcj.get('mapName', 'N/A')}")
        elif isinstance(npcs, list):
            for v in npcs:
                pcj = v.get("parameterCardJson", {})
                click.echo(f"\n  [{v.get('id')}] {v.get('name')} ({v.get('roleType')})")
                click.echo(f"    level: {pcj.get('level', 'N/A')}")
                click.echo(f"    hp: {pcj.get('hp', 'N/A')}/{pcj.get('maxHp', pcj.get('hp', 'N/A'))}")
                click.echo(f"    x/y: {pcj.get('x', 'N/A')}/{pcj.get('y', 'N/A')}")
                click.echo(f"    mapName: {pcj.get('mapName', 'N/A')}")
        return

    # 默认：一行摘要
    state_data = result.get("state", {})
    player = state_data.get("player", {})
    npcs = state_data.get("npcs", {})
    npc_count = len(npcs) if isinstance(npcs, (dict, list)) else 0
    click.echo(
        f"{result.get('chapterTitle')} round={state_data.get('round')} "
        f"玩家={player.get('name')} NPC={npc_count} "
        f"session={sid or '-'} "
        f"(--roles 看角色 / --state 看全量 / --bind 回写会话)"
    )


@main.command(name="plugin_session_data")
@click.option("-i", "plugin_id", required=True, help="插件 id 或插件文件夹名（如 toonflow-field-survival；含 manifest.json 的目录会自动解析为 manifest.id）")
@click.option("-story", "story", default="", help="故事标识（可读字段，写入 t_plugin_session_data.pluginName 不持久，仅日志用）")
@click.option("--session", "session_id", default="all", show_default=True, help="会话 id（默认 all 跨会话共享）")
@click.option("-k", "--key", "data_key", default=None, help="dataKey（get/set/remove 必填）")
@click.option("--get", "op_get", is_flag=True, help="读取一个 dataKey")
@click.option("--set", "op_set", is_flag=True, help="写入一个 dataKey（配 --value 或 --value-file）")
@click.option("--list", "op_list", is_flag=True, help="列出该插件在 sessionId 下的全部 dataKey")
@click.option("--remove", "op_remove", is_flag=True, help="删除一个 dataKey")
@click.option("--value", "value_inline", default=None, help="--set 时直接给值（JSON 字符串）")
@click.option("--value-file", "value_file", default=None, type=click.Path(exists=True), help="--set 时从文件读值（自动 JSON.parse）")
@click.option("-u", "--upload-tbg", "upload_tbg", default=None, type=click.Path(exists=True, file_okay=True, dir_okay=True),
              help="上传地图：传 .tbg/.json 文件（直接写 map_visual）或地图目录（自动 zip 打包成 .tbg 写 map_visual）。"
              "★ 传目录时会自动播种主线任务链（chain_defs:<故事>）与任务表（quest_defs），"
              "取自 <目录>/events/任务事件/{main-quests,quests}.json —— 不然部署版主线页为空。"
              "等价 --set -k map_visual --value-file <file>")
@click.option("-build", "build_tbg", default=None, type=click.Path(exists=True, file_okay=True, dir_okay=True),
              help="只构建 .tbg 文件到目录同级（不写 t_plugin_session_data），等价把 -u 的打包步骤单独跑。")
@click.option("-role", "op_role", is_flag=True, help="读取并展示 AI 故事角色位置（dataKey=ai_story_roles）")
@click.option("-position", "op_position", is_flag=True, help="配合 -role 使用，按 x/y 排序展示角色位置")
@click.option("-spriteBinds", "sprite_binds", is_flag=True,
              help="导出角色实体形象绑定（sys_state.spriteBinds）→ JSON + 解码 PNG。"
                   "目录：.cache/toonflow-field-survival/plugin_session_data/{故事}/{时间戳}/；"
                   "会话来源：-story 解析该故事的全部会话，或 --session 指定单个会话")
@click.option("-skillMeta", "skill_meta", is_flag=True,
              help="导出技能配置/属性特效绑定（sys_state.skillMeta）→ JSON（目录与会话来源同上）")
@click.option("-itemMeta", "item_meta", is_flag=True,
              help="导出物品配置/属性特效绑定（sys_state.itemMeta）→ JSON（目录与会话来源同上）")
@click.option("--out", "export_out", default=None, type=click.Path(file_okay=False, dir_okay=True),
              help="导出根目录（默认 <仓库根>/.cache/toonflow-field-survival/plugin_session_data/，"
                   "其下按 {故事}/{时间戳} 分目录）")
@click.pass_context
def plugin_session_data(ctx, plugin_id, story, session_id, data_key,
                       op_get, op_set, op_list, op_remove,
                       value_inline, value_file, upload_tbg, build_tbg,
                       op_role, op_position,
                       sprite_binds, skill_meta, item_meta, export_out):
    """Read / write / list / remove a plugin's session data (t_plugin_session_data).

    The backend endpoint is POST /plugin/data; sessionId="all" is treated as
    cross-session and bypasses t_gameSession existence check.

    导出模式（-spriteBinds / -skillMeta / -itemMeta）：从 sys_state 抽取
    实体形象绑定 / 技能配置 / 物品配置，按 -story 解析该故事全部会话（或 --session
    指定单个会话），落盘到
      .cache/toonflow-field-survival/plugin_session_data/{故事}/{时间戳}/
    spriteBinds 额外把 data:URL 形象图解码成 PNG（sprites/<sessionId>/<角色>.png）；
    _export_manifest.json 记录本次导出来源（服务器 / 故事 / 会话清单 / 字段 / 文件）。
    """
    client = resolve_client(ctx.obj["env_path"])

    # ★ 命名空间对齐：用户常传插件「文件夹名」（如 toonflow-field-survival），但运行时
    #   entry.ensureStoryVisualMap 按 manifest.id（如 com.toonflow.minigame-field-survival）
    #   读 t_plugin_session_data。若 -i 指向含 manifest.json 的目录，则解析为真实 id，
    #   保证模板读写命名空间一致（否则写库在 toonflow-field-survival、运行时读 com.toonflow...
    #   永远读不到 → 故事视觉地图失效）。
    resolved = _resolve_plugin_id(plugin_id)
    if resolved != plugin_id:
        click.echo(f"[plugin_data] -i {plugin_id!r} → manifest.id {resolved!r}")
    plugin_id = resolved

    # ★ -spriteBinds/-skillMeta/-itemMeta：从 sys_state 导出实体形象绑定 / 技能 / 物品配置
    #   （2026-11-17 persistSys 覆盖清空事故后的取证/备份通道）
    if sprite_binds or skill_meta or item_meta:
        if op_get or op_set or op_list or op_remove or upload_tbg or build_tbg or op_role:
            click.secho("[ERR] -spriteBinds/-skillMeta/-itemMeta 与 --get/--set/--list/--remove/-u/-build/-role 互斥", fg="red"); return
        fields = [name for name, want in
                  (("spriteBinds", sprite_binds), ("skillMeta", skill_meta), ("itemMeta", item_meta)) if want]
        _export_session_fields(client, plugin_id, story, session_id, fields, export_out)
        return

    # ★ -u/--upload-tbg 走「上传地图」快捷路径：dataKey=map_data，op=set，从文件读
    #   先于 ops 推断：用户传 -u 时不必再传 --set / -k / --value-file
    if upload_tbg:
        if op_get or op_list or op_remove:
            click.secho("[ERR] --upload-tbg 与 --get/--list/--remove 互斥", fg="red"); return
        if value_inline or value_file:
            click.secho("[ERR] --upload-tbg 与 --value/--value-file 互斥", fg="red"); return
        # ★ -build 只打包不写 server；-u 打包并上传
        if build_tbg:
            click.secho("[ERR] --upload-tbg 与 -build 互斥", fg="red"); return
        # ★ v6 故事绑定：主 key 改 map_visual:<story>（运行时 entry.ensureStoryVisualMap 优先读），
        #   旧 key map_data:<story> 仍会同步写一份（entry 回退读，兼容历史模板）。
        #   两者均按 story 命名空间隔离，避免故事 A 的地图覆盖故事 B 的（sessionId="all" 下）。
        data_key = "map_visual:" + (story or "default")
        value_file = upload_tbg
        op = "set"
        # ★ -u 走 set 快捷路径，直接跳到 SET 分支（不要让后面 ops 推断把它覆盖成 get）
        # ↓↓↓ 关键：跳过后面的 ops 推断逻辑，避免 data_key 非 None 时被覆盖成 "get"
        op_get = False; op_set = True; op_list = False; op_remove = False
    # ★ -build 只构建 .tbg 文件到目录同级（不写 t_plugin_session_data）
    if build_tbg:
        if upload_tbg:
            click.secho("[ERR] -build 与 -u/--upload-tbg 互斥", fg="red"); return
        try:
            info = build_tbg_file(build_tbg)
        except Exception as e:
            click.secho("[ERR] 构建 .tbg 失败：" + str(e), fg="red"); return
        click.secho(f"[OK] {info['tbg_path']}  ({info['size']} bytes, {len(info['files'])} files)", fg="green")
        return
    else:
        # 选 op（显式 flag 优先；否则按 dataKey 推断：传 key 默认 get，未传默认 list）
        ops = [n for n, v in [("get", op_get), ("set", op_set), ("list", op_list), ("remove", op_remove)] if v]
        if len(ops) > 1:
            click.secho("[ERR] 一次只能选一个 op：get/set/list/remove", fg="red"); return
        if not ops:
            ops = ["list"] if not data_key else ["get"]
        op = ops[0]

    # ★ -role/-position：读取 AI 故事角色位置（dataKey=ai_story_roles）
    if op_role:
        if op_get or op_set or op_remove:
            click.secho("[ERR] -role 与 --get/--set/--remove 互斥", fg="red"); return
        ai_key = "ai_story_roles"
        r = client.get_plugin_data(plugin_id, ai_key, session_id=session_id, story=story)
        if isinstance(r, dict) and isinstance(r.get("data"), dict) and "value" in r["data"]:
            value = r["data"].get("value")
        else:
            value = r.get("value") if isinstance(r, dict) else None

        if not value or not isinstance(value, dict):
            click.secho(f"[INFO] {ai_key} 未存储或为空", fg="yellow")
            return

        roles = value.get("roles") or []
        level = value.get("level") or ""
        updated_at = value.get("updatedAt")

        if updated_at:
            try:
                ts = datetime.fromtimestamp(updated_at / 1000).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                ts = str(updated_at)
            click.echo(f"地图: {level}  ·  更新: {ts}")
        else:
            click.echo(f"地图: {level}")

        if not roles:
            click.echo("(没有角色数据)")
            return

        if op_position:
            roles = sorted(roles, key=lambda r: (r.get("mapName", ""), r.get("x", 0), r.get("y", 0)))

        # 表格输出
        rows = []
        for r0 in roles:
            alive = "✓" if r0.get("alive") else "✗"
            rows.append([
                str(r0.get("id", "")),
                str(r0.get("name", "")),
                str(r0.get("roleType", "")),
                str(r0.get("side", "")),
                f"{r0.get('x', 0):.2f}",
                f"{r0.get('y', 0):.2f}",
                str(r0.get("mapName", "")),
                alive,
            ])
        click.echo(tabulate(rows, headers=["id", "name", "roleType", "side", "x", "y", "mapName", "alive"], tablefmt="psql"))
        return

    if op in ("get", "set", "remove") and not data_key:
        click.secho("[ERR] " + op + " 必须传 -k/--key", fg="red"); return

    if op == "set":
        if value_inline is None and value_file is None:
            click.secho("[ERR] --set 必须传 --value 或 --value-file", fg="red"); return
        if value_file:
            # ★ 2026-11-09 修复：只有**地图/视觉包类** dataKey 才走 tbg 打包。
            #   旧实现见 .json 就打包 → 写 chain_defs:<故事> 这类普通 JSON 时，
            #   会被打成 base64+zip 的地图包 → 引擎读 chain_defs 拿到的是 {format:"tbg",...}
            #   而不是链定义数组 → 主线页空白、链定义永远加载不出来。
            #   目录 / .tbg / .zip 一律走打包；.json 仅在地图类 key 下才打包。
            base_key = str(data_key or "").split(":", 1)[0]
            is_map_key = base_key in ("map_data", "map_visual")
            is_zip_like = value_file.lower().endswith((".tbg", ".zip"))
            if os.path.isdir(value_file) or is_zip_like or (is_map_key and value_file.lower().endswith(".json")):
                # 走 build_tbg_file 统一打包（目录 / 已是 .tbg / 单 .json）
                import base64
                try:
                    info = build_tbg_file(value_file)
                except Exception as e:
                    click.secho("[ERR] 构建 .tbg 失败：" + str(e), fg="red"); return
                tbg_b64 = base64.b64encode(info["tbg_bytes"]).decode("ascii")
                value = {
                    "format": "tbg",
                    "encoding": "base64+zip",
                    "data": tbg_b64,
                    "size": info["size"],
                    "files": info["files"],
                    "source": value_file,
                    "tbg_path": info["tbg_path"],
                }
                click.echo(f"[tbg] 打包 {len(info['files'])} 个文件 → {info['tbg_path']} ({info['size']} bytes)")
            else:
                with open(value_file, "r", encoding="utf-8") as f:
                    txt = f.read()
                try:
                    value = _json.loads(txt)
                except Exception as e:
                    click.secho("[ERR] --value-file 不是合法 JSON: " + str(e), fg="red"); return
        else:
            try:
                value = _json.loads(value_inline)
            except Exception as e:
                # 不是 JSON 也允许（按字符串原样存）
                value = value_inline

    click.echo(
        f"[plugin_data] pluginId={plugin_id} sessionId={session_id!r} "
        f"story={story!r} op={op} dataKey={data_key or '(n/a)'}"
    )

    if op == "get":
        r = client.get_plugin_data(plugin_id, data_key, session_id=session_id, story=story)
        # r 可能是 {value, dataKey, updatedAt}（toonflow 后端，由 _parse_response 剥过 data）
        # 或 {data: {value,...}}（旧版 / 直返）。兼容两者。
        if isinstance(r, dict) and isinstance(r.get("data"), dict) and "value" in r["data"]:
            value = r["data"].get("value")
        else:
            value = r.get("value") if isinstance(r, dict) else None
        click.echo(_json.dumps(value, ensure_ascii=False, indent=2))
    elif op == "set":
        r = client.set_plugin_data(plugin_id, data_key, value, session_id=session_id, story=story)
        # 兼容 r 是 {ok: true, dataKey, value:null} 或 {data:{...}} 两种形态
        summary = (r or {}).get("data") if isinstance(r, dict) and isinstance(r.get("data"), dict) else r
        click.secho("[OK] " + _json.dumps(summary or {}, ensure_ascii=False), fg="green")
        # ★ v6：-u 上传视觉地图模板时，同步写一份旧 key map_data:<story>
        #   （entry.ensureStoryVisualMap 的回退模板 key，兼容 2026-10-13 前上传的模板）
        #   ★ 2026-11-09 修复：只在**写的是地图/视觉包本身**时才同步 legacy key。
        #     旧实现对任何 --set 都写 map_data:<story> → 写 chain_defs:<story> 这类
        #     非地图数据时，会把地图槽整个覆盖成那份数据 → 地图集（含 events）当场报废。
        legacy_key = "map_data:" + (story or "default")
        base_key = str(data_key or "").split(":", 1)[0]
        is_map_payload = base_key in ("map_data", "map_visual") or legacy_key == data_key
        if legacy_key != data_key and is_map_payload:
            try:
                client.set_plugin_data(plugin_id, legacy_key, value, session_id=session_id, story=story)
                click.echo(f"[plugin_data] 兼容模板已同步写入 {legacy_key}")
            except Exception as e:
                click.secho(f"[WARN] 兼容模板 {legacy_key} 写入失败（不影响主 key）：{e}", fg="yellow")
        # ★★ 2026-11-13 修复：上传故事地图包时**自动播种主线任务链与任务表**。
        #   背景（真机部署踩坑）：`-u` 只写 map_visual/map_data 两个 key，
        #   而 entry.ensureChainDefs 读的是 **chain_defs:<故事名>**（另一套 key）
        #   → 部署版主线页恒 0/0「这个故事还没有配置主线任务链」。
        #   dev-host 桩（vite.config.ts 的 seedChainDefs/seedQuestDefs）会自动播种，
        #   真机（CLI 上传）没有这一步 → 本地有、部署没有。
        #   现在 -u 传**目录**时，从目录里找 events/任务事件/*.json 自动补种；
        #   找不到就跳过（不报错，不影响地图上传）。
        if is_map_payload and upload_tbg and os.path.isdir(str(upload_tbg)):
            _seed_story_task_data(client, plugin_id, story, str(upload_tbg), session_id)
    elif op == "list":
        r = client.list_plugin_data(plugin_id, session_id=session_id, story=story)
        # ToonClient._parse_response 已经把外层 data 字段剥掉了；r 本身就是
        # {keys: [...], dataKey, value} 形式。但为兼容未来 server 直返 {data:{keys}}，
        # 双向取值。
        if isinstance(r, dict) and isinstance(r.get("data"), dict) and "keys" in r["data"]:
            keys = r["data"].get("keys") or []
        else:
            keys = (r or {}).get("keys") or []
        if not keys:
            click.echo("(no dataKeys)")
        else:
            for k in keys:
                click.echo("- " + k)
    elif op == "remove":
        r = client.remove_plugin_data(plugin_id, data_key, session_id=session_id, story=story)
        click.secho("[OK] removed " + data_key, fg="green")


if __name__ == "__main__":
    main()
