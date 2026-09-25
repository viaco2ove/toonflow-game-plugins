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


if __name__ == "__main__":
    main()
