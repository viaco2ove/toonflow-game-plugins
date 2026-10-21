"""
AI 模型配置仓库 —— 复刻 toonflow-game-app 的 t_config + t_setting.languageModel 方案。

本地工具用 SQLite 单文件持久化（app 用 Knex/SQLite + t_config/t_setting 表）。
表结构刻意对齐 app 的 t_config 字段（见 src/types/database.d.ts），便于将来迁移。

- t_config：模型配置本体（type ∈ text|image|voice|video，明文 apiKey）
- t_setting：languageModel 槽位绑定 JSON（如 {"textureReplaceModel": 12}）
"""
import json
import os
import sqlite3
from pathlib import Path
from typing import Optional

# 与 app/src/types/database.d.ts 的 t_config 对齐的字段
CONFIG_COLUMNS = [
    "id", "type", "modelType", "model", "apiKey", "baseUrl", "manufacturer",
    "inputPricePer1M", "outputPricePer1M", "cacheReadPricePer1M", "currency",
    "reasoningEffort", "temperature", "topP", "remark", "createTime", "userId",
]

# 贴图替换功能使用的槽位 key（对应 app 的 t_aiModelMap）
SLOT_TEXTURE_REPLACE = "textureReplaceModel"
# 所有已知槽位（供前端下拉展示）
KNOWN_SLOTS = [
    {"key": SLOT_TEXTURE_REPLACE, "name": "贴图替换模型", "type": "image"},
]

DB_PATH = Path(__file__).parent / "ai_models.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    """建表（幂等）。"""
    conn = _conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS t_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT,
                modelType TEXT,
                model TEXT,
                apiKey TEXT,
                baseUrl TEXT,
                manufacturer TEXT,
                inputPricePer1M REAL,
                outputPricePer1M REAL,
                cacheReadPricePer1M REAL,
                currency TEXT,
                reasoningEffort TEXT,
                temperature REAL,
                topP REAL,
                remark TEXT,
                createTime INTEGER,
                userId INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS t_setting (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    # 数值字段空串归一
    for k in ("temperature", "topP", "inputPricePer1M", "outputPricePer1M", "cacheReadPricePer1M"):
        if d.get(k) == "":
            d[k] = None
    return d


def normalize_type(requested_type: str) -> str:
    """
    复刻 app 的 ExternalModelConfigType → PersistedModelConfigType 归一化。
    voice_design/voice_clone 归到 text/voice；image/video 保持；其余归 text。
    """
    rt = (requested_type or "text").lower()
    if rt in ("image", "video"):
        return rt
    if rt in ("voice", "voice_design", "voice_clone"):
        return "voice"
    return "text"


def list_models(type_filter: Optional[str] = None) -> list:
    conn = _conn()
    try:
        if type_filter:
            rows = conn.execute(
                "SELECT * FROM t_config WHERE type = ? ORDER BY id DESC", (type_filter,)
            ).fetchall()
        else:
            # 复刻 getSetting：排除 video（与 app 一致）
            rows = conn.execute(
                "SELECT * FROM t_config WHERE type <> 'video' ORDER BY id DESC"
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_model(model_id: int) -> Optional[dict]:
    conn = _conn()
    try:
        row = conn.execute("SELECT * FROM t_config WHERE id = ?", (model_id,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def add_model(data: dict) -> int:
    """插入一条配置，返回新 id。data 来自前端表单（含 type/manufacturer/model/baseUrl/apiKey 等）。"""
    ptype = normalize_type(data.get("type", "text"))
    # text 类型才落推理参数；其余写 null（对齐 app addModel.ts）
    is_text = ptype == "text"
    conn = _conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO t_config (
                type, modelType, model, apiKey, baseUrl, manufacturer,
                inputPricePer1M, outputPricePer1M, cacheReadPricePer1M, currency,
                reasoningEffort, temperature, topP, remark, createTime, userId
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                ptype,
                data.get("modelType") or None,
                data.get("model") or None,
                data.get("apiKey") or None,
                data.get("baseUrl") or None,
                data.get("manufacturer") or None,
                data.get("inputPricePer1M"),
                data.get("outputPricePer1M"),
                data.get("cacheReadPricePer1M"),
                data.get("currency") or "CNY",
                data.get("reasoningEffort") if is_text else None,
                data.get("temperature") if is_text else None,
                data.get("topP") if is_text else None,
                data.get("remark"),
                int(__import__("time").time() * 1000),
                1,
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_model(model_id: int, data: dict) -> bool:
    m = get_model(model_id)
    if not m:
        return False
    ptype = normalize_type(data.get("type", m["type"]))
    is_text = ptype == "text"
    conn = _conn()
    try:
        conn.execute(
            """
            UPDATE t_config SET
                type=?, modelType=?, model=?, apiKey=?, baseUrl=?, manufacturer=?,
                inputPricePer1M=?, outputPricePer1M=?, cacheReadPricePer1M=?, currency=?,
                reasoningEffort=?, temperature=?, topP=?, remark=?
            WHERE id=?
            """,
            (
                ptype,
                data.get("modelType", m.get("modelType")),
                data.get("model", m.get("model")),
                data.get("apiKey", m.get("apiKey")),
                data.get("baseUrl", m.get("baseUrl")),
                data.get("manufacturer", m.get("manufacturer")),
                data.get("inputPricePer1M", m.get("inputPricePer1M")),
                data.get("outputPricePer1M", m.get("outputPricePer1M")),
                data.get("cacheReadPricePer1M", m.get("cacheReadPricePer1M")),
                data.get("currency", m.get("currency") or "CNY"),
                (data.get("reasoningEffort") if is_text else None),
                (data.get("temperature") if is_text else None),
                (data.get("topP") if is_text else None),
                data.get("remark", m.get("remark")),
                model_id,
            ),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_model(model_id: int) -> bool:
    conn = _conn()
    try:
        conn.execute("DELETE FROM t_config WHERE id = ?", (model_id,))
        # 同步清理绑定里对该配置的引用
        bindings = _get_bindings_raw(conn)
        changed = False
        for slot, cid in list(bindings.items()):
            if cid == model_id:
                del bindings[slot]
                changed = True
        if changed:
            _set_bindings_raw(conn, bindings)
        conn.commit()
        return True
    finally:
        conn.close()


# ─── 槽位绑定（t_setting.languageModel）───
def _get_bindings_raw(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT value FROM t_setting WHERE key='languageModel'").fetchone()
    if not row or not row["value"]:
        return {}
    try:
        return json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return {}


def _set_bindings_raw(conn: sqlite3.Connection, bindings: dict) -> None:
    conn.execute(
        "INSERT INTO t_setting(key, value) VALUES('languageModel', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (json.dumps(bindings, ensure_ascii=False),),
    )


def get_bindings() -> dict:
    conn = _conn()
    try:
        return _get_bindings_raw(conn)
    finally:
        conn.close()


def bind_slot(slot: str, config_id: Optional[int]) -> dict:
    """把槽位绑定到某个配置 id（或解绑：config_id=None）。"""
    conn = _conn()
    try:
        bindings = _get_bindings_raw(conn)
        if config_id is None:
            bindings.pop(slot, None)
        else:
            bindings[slot] = config_id
        _set_bindings_raw(conn, bindings)
        conn.commit()
        return bindings
    finally:
        conn.close()


def get_bound_config(slot: str) -> Optional[dict]:
    """复刻 app 的 getPromptAi：读槽位 → configId → 查 t_config。"""
    bindings = get_bindings()
    cid = bindings.get(slot)
    if cid is None:
        return None
    return get_model(int(cid))


# 模块导入即初始化表
init()
