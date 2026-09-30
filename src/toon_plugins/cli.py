#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""toon_plugins CLI"""
import os
import sys
import click
import json as _json

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

            # Build zip in memory（默认瘦身：SKIP_DIRS 剔除 test_data 等冗余目录）
            buf = io.BytesIO()
            skip = resolve_skip_dirs(want_include_test_data(include_test_data))
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for base, dirs, files in os.walk(pdir):
                    dirs[:] = [d for d in dirs if d not in skip]
                    for fn in files:
                        if fn.endswith(".pyc") or fn == ".DS_Store":
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

    # 打包（默认瘦身：SKIP_DIRS 剔除 test_data 等冗余目录）
    buf = io.BytesIO()
    skip = resolve_skip_dirs(want_include_test_data(include_test_data))
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in skip]
            for fn in files:
                if fn.endswith(".pyc") or fn == ".DS_Store":
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
    else:
        click.secho("[ERR] Install failed: " + str(result), fg="red")


# ─────────────────────────────────────────────────────────────────────────
# 把地图目录打包成 .tbg 文件（zip 压缩、跳过 test_data/）
#   - -build：只产出 .tbg 文件
#   - -u：产出 .tbg 后再 base64 写 t_plugin_session_data.map_data
# ─────────────────────────────────────────────────────────────────────────
def build_tbg_file(source_path: str) -> dict:
    """把目录（或单个 .tbg/.json 文件）打包成 .tbg 写到 source_path 同级。

    返回 {"tbg_path", "tbg_bytes", "files", "size"}。
    """
    import base64, zipfile, io
    SKIP_DIRS = {"test_data", "__pycache__", "node_modules", ".git"}

    if os.path.isdir(source_path):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(source_path):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for fn in files:
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


# ─────────────────────────────────────────────────────────────────────────
# 插件会话数据（t_plugin_session_data）—  对应后端 POST /plugin/data
# 用法：
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 --list
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -k map_data --get
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -k map_data --set --value-file map.json
#   python -m toon_plugins plugin_session_data -i toonflow-field-survival \
#       -story 赦夜人冥夜走廊-第二季 -k map_data --remove
# sessionId 默认为 "all"（跨会话共享，与 req.md 约定一致）；
# 传 --session 切换到具体会话。
# ─────────────────────────────────────────────────────────────────────────
@main.command(name="plugin_session_data")
@click.option("-i", "plugin_id", required=True, help="插件 id（如 toonflow-field-survival）")
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
              help="上传地图：传 .tbg/.json 文件（直接写 map_data）或地图目录（自动 zip 打包成 .tbg 写 map_data）。等价 --set -k map_data --value-file <file>")
@click.option("-build", "build_tbg", default=None, type=click.Path(exists=True, file_okay=True, dir_okay=True),
              help="只构建 .tbg 文件到目录同级（不写 t_plugin_session_data），等价把 -u 的打包步骤单独跑。")
@click.pass_context
def plugin_session_data(ctx, plugin_id, story, session_id, data_key,
                       op_get, op_set, op_list, op_remove,
                       value_inline, value_file, upload_tbg, build_tbg):
    """Read / write / list / remove a plugin's session data (t_plugin_session_data).

    The backend endpoint is POST /plugin/data; sessionId="all" is treated as
    cross-session and bypasses t_gameSession existence check.
    """
    client = resolve_client(ctx.obj["env_path"])

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
        # ★ 按 story 命名空间隔离：map_data:赦夜人冥夜走廊-第二季
        #   避免故事 A 的地图覆盖故事 B 的（同一 userId/sessionId="all" 下）
        data_key = "map_data:" + (story or "default")
        value_file = upload_tbg
        op = "set"
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

    if op in ("get", "set", "remove") and not data_key:
        click.secho("[ERR] " + op + " 必须传 -k/--key", fg="red"); return

    if op == "set":
        if value_inline is None and value_file is None:
            click.secho("[ERR] --set 必须传 --value 或 --value-file", fg="red"); return
        if value_file:
            if os.path.isdir(value_file) or value_file.lower().endswith((".tbg", ".zip", ".json")):
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
