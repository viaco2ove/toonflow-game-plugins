#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Toonflow REST API client (mirrors tavo_plugins/lib/mcp_client.py)"""
import json
import os
import gzip
import urllib.request
import urllib.error
import urllib.parse


class ToonClient:
    def __init__(self, base_url=None, token=None, user_id=None, env_path=None):
        self.base_url = base_url or os.environ.get("TOONFLOW_API_URL", "")
        self.token    = token    or os.environ.get("TOONFLOW_AUTH_TOKEN", "")
        self.user_id  = user_id  or os.environ.get("TOONFLOW_USER_ID", "")

        # ── 上传相关可配置项默认值（均可被 .env 覆盖，见 _load_env）──────────
        self.plugin_upload_timeout = 1800                    # raw 流式上传默认超时 30 分钟
        self.plugin_upload_raw_threshold = 8 * 1024 * 1024   # 超过 8MB 自动改走 raw
        self.plugin_upload_gzip = False                      # 请求体 gzip，默认关闭

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
            elif k == "plugin_upload_timeout":
                # raw 流式上传超时（秒）
                try:
                    self.plugin_upload_timeout = int(float(v))
                except (TypeError, ValueError):
                    pass
            elif k == "plugin_upload_raw_threshold":
                # 超过该字节数自动改走 raw 通道
                try:
                    threshold = int(float(v))
                    if threshold > 0:
                        self.plugin_upload_raw_threshold = threshold
                except (TypeError, ValueError):
                    pass
            elif k == "plugin_upload_gzip":
                # 请求体 gzip 开关（1/true/yes/on 开启）
                self.plugin_upload_gzip = str(v).strip().lower() in ("1", "true", "yes", "on")

    # ── 底层请求 / 响应 ────────────────────────────────────────────────────────

    def _send_json(self, req, timeout):
        """发送请求并解析 JSON 响应；错误处理风格与原 _post 保持一致。"""
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
            except Exception:
                err_body = str(e)
            raise RuntimeError(f"HTTP {e.code}: {err_body}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"连接失败: {e}")

    def _parse_response(self, body):
        """校验响应码并返回 data：code 为 0(REST) / 200(Toonflow) 均视为成功。"""
        code = body.get("code")
        try:
            code_int = int(code) if code is not None else None
            # 0 (REST ok) and 200 (Toonflow ok) are both success
            if code_int is not None and code_int != 0 and code_int != 200:
                raise RuntimeError(f"API error: {body.get('message', body)}")
        except (ValueError, TypeError):
            pass
        return body.get("data", {})

    def _post(self, path, body=None, timeout=120, request_gzip=None):
        url = self.base_url + path
        data = json.dumps(body or {}, ensure_ascii=False).encode("utf-8") if body else None
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + self.token,
        }
        # 请求体 gzip：默认关闭，仅当 .env 的 plugin_upload_gzip=1 或显式
        # request_gzip=True 时启用。取舍说明：插件包经 base64 编码后近似随机数据，
        # gzip 收益接近 0，该能力主要对普通大 JSON 请求有效。
        use_gzip = self.plugin_upload_gzip if request_gzip is None else bool(request_gzip)
        if data is not None and use_gzip:
            data = gzip.compress(data)
            headers["Content-Encoding"] = "gzip"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        return self._parse_response(self._send_json(req, timeout))

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
        return self._parse_response(self._send_json(req, timeout))

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

    def install_plugin_stream(self, plugin_id, zip_path, file_name=None, timeout=None):
        """以流式 raw 方式上传插件 zip（绕开 base64 膨胀与 express.json 体积上限）。

        - POST /plugin/install-raw，Content-Type: application/octet-stream
        - 请求体直接传打开的文件对象：urllib 会分块流式发送，不会把整包读进内存，
          也不做 base64 编码（base64 会让体积膨胀约 1/3）；
        - 显式设置 Content-Length / Authorization / X-Plugin-File-Name；
        - 默认超时 1800s，可被 .env 的 plugin_upload_timeout 覆盖。
        """
        url = self.base_url + "/plugin/install-raw"
        if timeout is None:
            timeout = self.plugin_upload_timeout
        with open(zip_path, "rb") as body:
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(os.path.getsize(zip_path)),
                    "Authorization": "Bearer " + self.token,
                    "X-Plugin-File-Name": file_name or os.path.basename(zip_path),
                },
                method="POST",
            )
            return self._parse_response(self._send_json(req, timeout))

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
