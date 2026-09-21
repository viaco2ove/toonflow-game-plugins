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
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.pass_context
def plugins(ctx, install_all, install, plugins_dir, no_tpg, enable):
    """List / install plugins"""

    client = resolve_client(ctx.obj["env_path"])

    # ── Install mode ──────────────────────────────────────────────
    if install_all or install:
        import zipfile, io, base64

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

            # Build zip in memory
            buf = io.BytesIO()
            skip = {".git", "__pycache__", "node_modules"}
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for base, dirs, files in os.walk(pdir):
                    dirs[:] = [d for d in dirs if d not in skip]
                    for fn in files:
                        if fn.endswith(".pyc") or fn == ".DS_Store":
                            continue
                        fp = os.path.join(base, fn)
                        rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                        zf.write(fp, rel)
            zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

            # Save .tpg to disk (optional)
            if not no_tpg:
                tpg_dir = os.path.join(os.path.dirname(CLI_ROOT), "plugins_tbg")
                os.makedirs(tpg_dir, exist_ok=True)
                version = manifest.get("version", "0.0.0")
                tpg_path = os.path.join(tpg_dir, tname + "-" + version + ".tpg")
                with open(tpg_path, "wb") as f:
                    f.write(base64.b64decode(zip_b64))
                click.echo("  [TPG] saved: " + tpg_path)

            # Call REST API (no-tpg: base64 only, no disk write on server either)
            try:
                result = client.install_plugin(plugin_id, zip_b64)
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
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.pass_context
def install_cmd(ctx, plugin_dir, enable):
    """Install a single plugin from directory"""
    import zipfile, io, base64

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

    buf = io.BytesIO()
    skip = {".git", "__pycache__", "node_modules"}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in skip]
            for fn in files:
                if fn.endswith(".pyc") or fn == ".DS_Store":
                    continue
                fp = os.path.join(base, fn)
                rel = os.path.relpath(fp, plugin_dir).replace(os.sep, "/")
                zf.write(fp, rel)
    zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    click.echo("Installing " + plugin_id + " ...")
    result = client.install_plugin(plugin_id, zip_b64)
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
