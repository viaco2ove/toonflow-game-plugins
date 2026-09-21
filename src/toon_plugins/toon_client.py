#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Toonflow REST API client (mirrors tavo_plugins/lib/mcp_client.py)"""
import json
import os
import urllib.request
import urllib.error
import urllib.parse


class ToonClient:
    def __init__(self, base_url=None, token=None, user_id=None, env_path=None):
        self.base_url = base_url or os.environ.get("TOONFLOW_API_URL", "")
        self.token    = token    or os.environ.get("TOONFLOW_AUTH_TOKEN", "")
        self.user_id  = user_id  or os.environ.get("TOONFLOW_USER_ID", "")

        # Read from .env if not set
        if env_path is None:
            env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
        if env_path:
            self._load_env(env_path)

        if not self.base_url:
            raise RuntimeError("缺少配置：TOONFLOW_API_URL（传参或 .env）")
        if not self.token:
            raise RuntimeError("缺少配置：TOONFLOW_AUTH_TOKEN（传参或 .env）")

        self.base_url = self.base_url.rstrip("/")

    def _load_env(self, env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "game_app_service_url":
                self.base_url = self.base_url or v.rstrip("/")
            elif k == "auth_token":
                self.token = self.token or v
            elif k == "user_id":
                self.user_id = self.user_id or v

    def _post(self, path, body=None, timeout=120):
        url = self.base_url + path
        data = json.dumps(body or {}, ensure_ascii=False).encode("utf-8") if body else None
        req = urllib.request.Request(
            url, data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
            except Exception:
                err_body = str(e)
            raise RuntimeError(f"HTTP {e.code}: {err_body}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"连接失败: {e}")
        code = body.get("code")
        try:
            code_int = int(code) if code is not None else None
            # 0 (REST ok) and 200 (Toonflow ok) are both success
            if code_int is not None and code_int != 0 and code_int != 200:
                raise RuntimeError(f"API error: {body.get('message', body)}")
        except (ValueError, TypeError):
            pass
        return body.get("data", {})

    def _get(self, path, params=None, timeout=30):
        url = self.base_url + path
        if params:
            qs = urllib.parse.urlencode(params)
            url = url + "?" + qs
        req = urllib.request.Request(
            url,
            headers={"Authorization": "Bearer " + self.token},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
            except Exception:
                err_body = str(e)
            raise RuntimeError(f"HTTP {e.code}: {err_body}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"连接失败: {e}")
        code = body.get("code")
        try:
            code_int = int(code) if code is not None else None
            # 0 (REST ok) and 200 (Toonflow ok) are both success
            if code_int is not None and code_int != 0 and code_int != 200:
                raise RuntimeError(f"API error: {body.get('message', body)}")
        except (ValueError, TypeError):
            pass
        return body.get("data", {})

    # ── Plugin APIs ────────────────────────────────────────────────────────────

    def list_plugins(self):
        """List installed plugins for current user."""
        data = self._post("/plugin/list", {})
        return data if isinstance(data, list) else data.get("plugins", [])

    def install_plugin(self, plugin_id, zip_base64, file_name=None):
        """Install (or upgrade) a plugin from base64 zip — no disk I/O."""
        body = {"base64Data": zip_base64}
        if file_name:
            body["fileName"] = file_name
        return self._post("/plugin/install", body)

    def uninstall_plugin(self, plugin_id):
        return self._post("/plugin/uninstall", {"pluginId": plugin_id})

    def set_plugin_enabled(self, plugin_id, enabled=True):
        return self._post("/plugin/setEnabled", {"pluginId": plugin_id, "enabled": enabled})

    def get_plugin_asset(self, plugin_id, path):
        """Fetch a plugin asset file, returns raw bytes."""
        # GET /plugin/getAsset?pluginId=&path=  → {data: "base64..."} or "base64..."
        import base64
        data = self._get("/plugin/getAsset", {"pluginId": plugin_id, "path": path})
        b64 = data.get("data") if isinstance(data, dict) else data
        if b64:
            return base64.b64decode(b64)
        return b64
