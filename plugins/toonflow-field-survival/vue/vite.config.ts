import { defineConfig, loadEnv, Plugin } from "vite";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import http from "http";
// @ts-ignore
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

// 解析 ../.env（不在 vue/ 子目录）里的 game_app_service_url / auth_token / sessionId
// 不引入 dotenv 依赖（vue/package.json 没有），手写一个轻量解析
function loadDotenvLight(envPath: string): void {
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      // 去引号
      if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}
// ★ ESM 模式下 __dirname 不可用，用 import.meta.url 算
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
// .env 在 toonflow-game-plugins/ 根目录（vue → toonflow-field-survival → plugins → toonflow-game-plugins）
{
  const envPath = resolve(__dirname, "../../../.env");
  loadDotenvLight(envPath);
}

/** 故事目录读取中间件：/story-data/<storyName>/... → 读取对应文件 */
function storyDataPlugin(workshopsRoot: string): Plugin {
  return {
    name: "story-data",
    configureServer(server) {
      server.middlewares.use("/story-data", (req, res) => {
        const filePath = resolve(workshopsRoot, decodeURIComponent(req.url!.replace(/^\//, "")));
        if (!filePath.startsWith(workshopsRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end("Not found: " + filePath);
          return;
        }
        try {
          const content = readFileSync(filePath, "utf-8");
          res.setHeader("Content-Type", "application/json");
          res.end(content);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

/** dev-host 中间件：当 CONN=1 时，提供一个内嵌 iframe + JS 模拟宿主的 HTML。
 *  关键：dev-host 通过 /story-data/<storyName>/... 读取真实 test_state.json（和插件本体同一份数据）。
 *  如果 STORY 没传 / 文件不存在 → 直接报错，连不上。 */
function devHostPlugin(conn: string, story: string): Plugin {
  return {
    name: "dev-host",
    configureServer(server) {
      if (!conn || conn === "0" || conn === "false") return;
      const STORY = story || "";
      const STORY_ROOT = resolve(__dirname, "../workshops/toonflow-field-survival/map_design");
      const storyUrl = STORY
        ? `/story-data/toonflow-field-survival/map_design/${encodeURIComponent(STORY)}/test_data/test_state.json`
        : "";
      // ★ 服务器代理：/toon-api/* → {SERVICE_URL}/*（避免浏览器跨域）
      //   并把 auth_token 注入到 Authorization header
      const SERVICE_URL = process.env.game_app_service_url || "http://localhost:60002";
      const AUTH_TOKEN = process.env.auth_token || "";
      // 通用代理：/toon-asset/<path> → {SERVICE_URL}/<path>（图片/音频等静态资源）
      server.middlewares.use("/toon-asset", (req, res, next) => {
        try {
          const targetPath = (req.url || "/").replace(/^\//, "");
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          if (AUTH_TOKEN) headers["authorization"] = "Bearer " + AUTH_TOKEN;
          const proxyReq = http.request(
            {
              hostname: new URL(SERVICE_URL).hostname,
              port: new URL(SERVICE_URL).port || 80,
              method: req.method,
              path: "/" + targetPath,
              headers,
            },
            (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 502;
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (v) res.setHeader(k, v as any);
              }
              proxyRes.pipe(res);
            },
          );
          proxyReq.on("error", (err) => { res.statusCode = 502; res.end("proxy error: " + err.message); });
          req.pipe(proxyReq);
        } catch (e) { next(e as any); }
      });
      server.middlewares.use("/toon-api", (req, res, next) => {
        try {
          const u = new URL(req.url || "/", SERVICE_URL);
          const targetPath = u.pathname + u.search;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          // 注入 auth token
          if (AUTH_TOKEN) {
            headers["authorization"] = "Bearer " + AUTH_TOKEN;
          }
          // node fetch in vite middleware: 用 http module
          const proxyReq = http.request(
            {
              hostname: new URL(SERVICE_URL).hostname,
              port: new URL(SERVICE_URL).port || 80,
              method: req.method,
              path: targetPath,
              headers,
            },
            (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 502;
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (v) res.setHeader(k, v as any);
              }
              proxyRes.pipe(res);
            },
          );
          proxyReq.on("error", (err) => {
            res.statusCode = 502;
            res.end("proxy error: " + err.message);
          });
          req.pipe(proxyReq);
        } catch (e) {
          next(e as any);
        }
      });
      const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dev-host（拟真宿主桩）— ${STORY || "(no story)"}</title>
<style>
  body{margin:0;padding:0;font-family:system-ui,sans-serif;background:#1a1a1a;color:#eee}
  #wrap{position:fixed;inset:0}
  iframe{width:100%;height:100%;border:0;display:block}
  #log{position:fixed;left:8px;bottom:8px;background:#000a;padding:8px 12px;border-radius:6px;font:12px monospace;max-width:60%;max-height:30vh;overflow:auto;z-index:9;line-height:1.5}
  #badge{position:fixed;right:8px;top:8px;background:#f33;color:#fff;padding:4px 10px;border-radius:4px;font:12px monospace;z-index:9;max-width:60%;text-align:right}
  #error{position:fixed;inset:30px;display:none;align-items:center;justify-content:center;background:#1a1a1a;color:#f88;font:14px monospace;z-index:10;text-align:center;padding:40px;line-height:2}
</style>
</head>
<body>
<div id="wrap"><iframe id="game" src="/?__inner=1"></iframe></div>
<div id="badge">dev-host (--conn ${STORY})</div>
<div id="error"></div>
<div id="log"></div>
<script>
const STORY = ${JSON.stringify(STORY)};
const STORY_URL = ${JSON.stringify(storyUrl)};
const SERVICE_URL = ${JSON.stringify(SERVICE_URL)};
// ★ 注入 auth token（从 ../.env 读），浏览器 fetch /toon-api 时自动带上
const AUTH_TOKEN = ${JSON.stringify(AUTH_TOKEN)};
window.__AUTH_TOKEN__ = AUTH_TOKEN;
window.__SERVICE_URL__ = SERVICE_URL;
let lastState = null;
let storyData = null;
// ★ 当前关卡名（由客户端每帧 tick 上报；null = 未知 → 默认 RUINS 不安全，见 currentTheme）
let currentLevelName = null;
// ★ 外部可调用的 state 修改器（bsk evaluate / browser console 直接调用）
// 用法示例：window.__devHostModify({ hp: 999, exp: 5000, level: 20 })
window.__devHostModify = (patch) => {
  if (!lastState || !lastState.entities) return "no state";
  let applied = 0;
  for (const [k, v] of Object.entries(patch)) {
    const ent = lastState.entities.find(e => e.side === "player");
    if (ent && k in ent) { ent[k] = v; applied++; }
  }
  return "applied " + applied + " to player";
};
// ★ 外部可调用的 state 探针：返回玩家/敌怪摘要（bsk evaluate 用）
window.__devHostState = () => {
  if (!lastState) return { error: "no state" };
  const enemies = (lastState.entities || []).filter(e => e.side === "enemy");
  return {
    phase: lastState.phase,
    tick: lastState.tick,
    mobLevel: lastState._mobLevel,
    mobEpoch: lastState._mobEpoch,
    totalEntities: (lastState.entities || []).length,
    enemyCount: enemies.length,
    enemies: enemies.slice(0, 20).map(e => ({ id: e.id, name: e.name, level: e.level, hp: e.hp, alive: e.alive, x: e.x, y: e.y })),
  };
};
// ★ dev-host 模式下，模拟 t_plugin_session_data（real host 不在，standalone 必须自己应答）
//   数据存 window.__devHostPluginData，跨用户/跨会话共享 (sessionId="all")
window.__devHostPluginData = new Map();
window.__devHostPluginListeners = new Set();
window.__devHostPluginEmit = (key) => {
  for (const cb of window.__devHostPluginListeners) {
    try { cb(key); } catch (e) { console.warn("[devHost] listener err", e); }
  }
};
window.addEventListener("message", (e) => {
  const d = e?.data;
  if (!d || d.type !== "tf_plugin_data") return;
  const { reqId, op, dataKey, value, pluginId, sessionId, story } = d;
  const k = JSON.stringify({ p: pluginId, s: sessionId || "all", k: dataKey || "" });
  let result = null;
  if (op === "get") {
    const v = window.__devHostPluginData.get(k);
    result = { dataKey, value: v ? v.value : null, updatedAt: v ? v.updatedAt : 0 };
  } else if (op === "set") {
    window.__devHostPluginData.set(k, { value, updatedAt: Date.now() });
    window.__devHostPluginEmit(dataKey);
    result = { dataKey, value: null, ok: true };
  } else if (op === "list") {
    const keys = [];
    for (const key of window.__devHostPluginData.keys()) {
      const parsed = JSON.parse(key);
      if (parsed.p === pluginId && parsed.s === (sessionId || "all")) keys.push(parsed.k);
    }
    result = { keys, dataKey: "", value: null };
  } else if (op === "remove") {
    window.__devHostPluginData.delete(k);
    window.__devHostPluginEmit(dataKey);
    result = { dataKey, value: null, ok: true };
  }
  if (result) {
    // ★ 回包要发到 game iframe（不是 dev-host 顶层本身的 parent）
    const gameWin = document.getElementById("game")?.contentWindow;
    (gameWin || window.parent).postMessage({ type: "tf_plugin_data_result", reqId, ok: true, ...result }, "*");
  }
});
const log = (m) => { const el = document.getElementById("log"); el.textContent = m + "\\n" + el.textContent.slice(0, 4000); };
const post = (state) => { document.getElementById("game").contentWindow.postMessage({ type: "tf_plugin_state", state, actions: ["init","start","tick","skill","item","page","exit","revive"] }, "*"); };
const showError = (msg) => {
  const el = document.getElementById("error");
  el.textContent = msg;
  el.style.display = "flex";
  document.getElementById("wrap").style.display = "none";
  log("ERROR: " + msg);
};

// 启动时拉服务器 story runtime state。流程：
//   1) 从本地 workshops/.../${STORY}/story.json 读 sessionId/worldId（4 字段，不经常变）
//   2) 用 sessionId 调 POST {SERVICE_URL}/game/storyInfo（通过 /toon-api 走 vite 代理，避免 CORS）
//   3) 把 server response.state.player + .npcs 转为 test_state.json 的 roles 数组格式
//   4) 失败回退到本地 test_state.json（不打断开发）
async function loadStoryData() {
  if (!STORY) {
    showError("未指定 STORY：\\nnpm run debug -- --story=你的故事名 --conn");
    return false;
  }
  // 1) 读本地 story.json 拿 sessionId/worldId
  let sessionId = "";
  let worldId = 0;
  try {
    // 浏览器里没 node 的 resolve/existsSync/readFileSync，用 fetch 走 vite 静态服务
    const storyMetaUrl = "/story-data/toonflow-field-survival/map_design/" + encodeURIComponent(STORY) + "/story.json";
    const metaR = await fetch(storyMetaUrl);
    if (metaR.ok) {
      const meta = await metaR.json();
      sessionId = String(meta.sessionId || "");
      worldId = Number(meta.worldId || 0);
    } else {
      log("! story.json HTTP " + metaR.status + " → fallback local");
      return await loadStoryFromLocal();
    }
  } catch (e) {
    log("! read story.json failed: " + e.message + " → fallback local");
    return await loadStoryFromLocal();
  }
  if (!sessionId) {
    log("! story.json 缺 sessionId → fallback local");
    return await loadStoryFromLocal();
  }
// 2) 调服务器（通过 /toon-api 代理）
  try {
    const headers = { "Content-Type": "application/json" };
    // dev-host 页面 fetch 时直接带 token（vite.config.ts 注入了 window.__AUTH_TOKEN__）
    if (typeof window !== "undefined" && window.__AUTH_TOKEN__) {
      headers["Authorization"] = "Bearer " + window.__AUTH_TOKEN__;
    }
    const r = await fetch("/toon-api/game/storyInfo", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId }),
    });
    if (!r.ok) {
      log("! server storyInfo HTTP " + r.status + " → fallback local");
      return await loadStoryFromLocal();
    }
    const resp = await r.json();
    if (resp?.code !== 200 || !resp?.data) {
      log("! server response invalid (code=" + resp?.code + ") → fallback local");
      return await loadStoryFromLocal();
    }
    const srvData = resp.data;
    const srvState = srvData.state || {};
    // 3) 转换：state.player + state.npcs → roles[]
    const roles = [];
    if (srvState.player) {
      const p = srvState.player;
      roles.push({
        id: p.id || "player",
        name: p.name || "玩家",
        roleType: p.roleType || "player",
        // ★ server avatarPath "/1/..." 改写到 /toon-asset/1/... 走 vite 代理
        avatarPath: (p.avatarPath && p.avatarPath.startsWith("/")) ? "/toon-asset" + p.avatarPath : (p.avatarPath || ""),
        description: p.description || "",
        initial_level: p.parameterCardJson?.level || p.attributes?.cultivationInsight || 1,
      });
    }
    for (const [npcId, npc] of Object.entries(srvState.npcs || {})) {
      const n = npc;
      roles.push({
        id: n.id || npcId,
        name: n.name || npcId,
        roleType: n.roleType || "npc",
        avatarPath: (n.avatarPath && n.avatarPath.startsWith("/")) ? "/toon-asset" + n.avatarPath : (n.avatarPath || ""),
        description: n.description || "",
        initial_level: n.parameterCardJson?.level || 1,
      });
    }
    // materials 占位：用 server inventory 转成 materials 格式（dev-host 后续转 items）
    const materials = (srvState.inventory || []).map((it, idx) => ({
      name: it.name || ("物品" + (idx + 1)),
      count: 1,
      effectType: "heal_hp",
      stats: { heal: 0 },
    }));
    storyData = {
      description: srvData.chapterTitle || STORY,
      world: { name: srvData.world?.name || STORY },
      roles,
      monsters: [],
      materials,
    };
    log("✓ loaded story from server: " + STORY + " (roles: " + roles.length + ", materials: " + materials.length + ", session: " + sessionId + ")");
    return true;
  } catch (e) {
    log("! server fetch failed: " + e.message + " → fallback local");
    return await loadStoryFromLocal();
  }
}

// 回退：读本地 test_state.json
async function loadStoryFromLocal() {
  try {
    const r = await fetch(STORY_URL);
    if (!r.ok) {
      showError("无法读取 story 数据：" + STORY_URL + "\\nHTTP " + r.status + "\\n请确认 --story 名称正确");
      return false;
    }
    storyData = await r.json();
    log("✓ loaded story (local fallback): " + STORY + " (roles: " + (storyData.roles?.length || 0) + ", monsters: " + (storyData.monsters?.length || 0) + ", materials: " + (storyData.materials?.length || 0) + ")");
    return true;
  } catch (e) {
    showError("读取 story 失败：" + e.message + "\\n" + STORY_URL);
    return false;
  }
}

// ★ entity_types.json（Rotten-Soup 怪物权威数据，按 theme 加权刷怪）
let entityTypes = null;
async function loadEntityTypes() {
  const urls = ["/entity_types.json", "./entity_types.json", "../entity_types.json"];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) {
        entityTypes = await r.json();
        log("✓ loaded entity_types.json (enemies: " + (entityTypes.enemies?.length || 0) +
            ", themes: " + Object.keys(entityTypes.dungeon_themes || {}).length + ")");
        return;
      }
    } catch { /* try next */ }
  }
  log("⚠ entity_types.json not found, falling back to story monsters");
}

// 当前关卡 → dungeon theme 映射（与 mockHost/mapConfig.THEME_BY_MAPNAME 对齐）
const THEME_BY_MAPNAME = {
  "Mulberry Town": null,
  "Mulberry Forest": "RUINS",
  "Mulberry Graveyard": "CATACOMBS",
  "Lich Lair": "CATACOMBS",
  "Loot Goblin Lair": "RUINS",
  "Mulberry Dungeon": "RUINS", "Mulberry Dungeon 2": "RUINS", "Mulberry Dungeon 3": "RUINS",
  "Mulberry Dungeon 4": "RUINS", "Mulberry Dungeon 5": "RUINS",
  "Forest Dungeon": "RUINS", "Forest Dungeon 2": "RUINS", "Forest Dungeon 3": "RUINS",
  "Forest Dungeon 4": "RUINS", "Forest Dungeon 5": "RUINS",
  "Kingdom": null,
  "Lich Boss": "CATACOMBS",
};
function currentTheme(levelName) {
  if (!levelName) return "RUINS";
  if (THEME_BY_MAPNAME[levelName] !== undefined) return THEME_BY_MAPNAME[levelName];
  if (/graveyard|lich|crypt|catacomb|tomb/i.test(levelName)) return "CATACOMBS";
  if (/mine|cave/i.test(levelName)) return "MINE";
  if (/ice|frost|snow/i.test(levelName)) return "ICE";
  return "RUINS";
}

// 按 theme 权重从 entity_types 抽一个敌人
function pickMonsterByWeight(theme) {
  if (!entityTypes || !theme || !entityTypes.dungeon_themes) return null;
  const t = entityTypes.dungeon_themes[theme];
  if (!t || t._deprecated) return null;
  const dist = t.mob_distribution || {};
  const total = Object.values(dist).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [type, w] of Object.entries(dist)) {
    r -= w;
    if (r <= 0) return entityTypes.enemies.find((e) => e.entity_type === type)
      || entityTypes.special_enemies?.find((e) => e.entity_type === type) || null;
  }
  return null;
}

// 把 test_state.json 的 materials 映射成 ItemSlot
function materialsToItems(materials) {
  if (!Array.isArray(materials)) return [];
  return materials.map((m) => {
    let slotType = "utility";
    if (m.effectType === "heal_hp") slotType = "hp";
    else if (m.effectType === "heal_mp" || m.effectType === "heal_sp") slotType = "mp";
    else if (m.effectType === "attack") slotType = "atk";
    else if (m.effectType === "buff" || m.effectType === "defense") slotType = "buff";
    const heal = (m.stats && typeof m.stats.heal === "number") ? m.stats.heal : 0;
    return {
      name: m.name,
      count: m.count ?? 1,
      heal: (m.effectType === "heal_mp" || m.effectType === "heal_sp") ? 0 : heal,
      mp:    (m.effectType === "heal_mp" || m.effectType === "heal_sp") ? heal : 0,
      type: slotType,
      matId: m.matId,
      matType: m.type,
      description: m.description,
      priceBlack: m.priceBlack,
      stats: m.stats,
      singleUse: m.singleUse,
    };
  });
}

// 默认 4 个技能（和插件 mockHost 默认对齐：近战/远程/治疗/护盾）
const DEFAULT_SKILLS = [
  { name: "冲斩", power: 20, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee" },
  { name: "火球", power: 25, cost: 0, cd: 30, cdLeft: 0, type: "atk", range: "ranged" },
  { name: "治疗", power: 30, cost: 0, cd: 40, cdLeft: 0, type: "heal", range: "melee" },
  { name: "护盾", power: 0, cost: 0, cd: 60, cdLeft: 0, type: "buff", range: "melee" },
];

window.addEventListener("message", async (e) => {
  const d = e?.data;
  if (!d || typeof d !== "object") return;
  log("iframe→ " + JSON.stringify(d).slice(0, 240));
  if (d.type === "tf_plugin_loaded") {
    log("HOST: tf_plugin_loaded received, loading story...");
    const ok = await loadStoryData();
    if (!ok) { log("HOST: loadStoryData failed"); return; }
    await loadEntityTypes();
    log("HOST: story+entityTypes loaded, pushing select state");
    // ★ 直接同步推 select state（不用 setTimeout，background tab 上不可靠）
    lastState = {
      phase: "select", version: 5, tick: 0,
      world: { w: 3000, h: 3000 },
      roles: storyData.roles || [],
      selections: { participants: [], spectators: [], enemies: [] },
      entities: [], chests: [], potions: [], floaters: [],
      skills: DEFAULT_SKILLS,
      items: materialsToItems(storyData.materials || []),
      skillPage: 0, itemPage: 0,
      exp: 0, money: 0, drops: [], kills: 0,
      events: ["dev-host 已推送 select 状态（" + STORY + "）"],
      result: null,
      map: null, mapSource: "fallback",
    };
    post(lastState);
    log("host→ pushed select state (roles: " + lastState.roles.length + ", items: " + lastState.items.length + ")");
  }
  if (d.type === "tf_plugin_tick" && d.action === "start") {
    if (!storyData) { showError("storyData 未加载"); return; }
    const sel = d.params?.selections || {};
    const roles = storyData.roles || [];
    const playerRole = roles.find((r) => r.roleType === "player") || roles[0];
    const ents = [];
    if (playerRole) {
      const lv = playerRole.initial_level || 10;
      const s = 1 + (lv - 1) * 0.3;
      ents.push({
        id: playerRole.id || "p1", name: playerRole.name || "玩家", side: "player",
        x: 0, y: 0, vx: 0, vy: 0,
        hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
        mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
        exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
        level: lv, atk: 30, def: 10, facing: 0, cooldown: 0, alive: true,
        avatarPath: playerRole.avatarPath,
      });
    }
    (sel.participants || []).forEach((id, i) => {
      // participants 可能是 id(r02) 也可能是 name(裴勇)，两种都尝试匹配
      const r = roles.find((x) => x.id === id) || roles.find((x) => x.name === id);
      if (r && (!playerRole || r.id !== playerRole.id)) {
        const lv = r.initial_level || 10;
        const s = 1 + (lv - 1) * 0.3;
        ents.push({
          id: r.id, name: r.name, side: "ally",
          x: Math.cos(i) * 12, y: Math.sin(i) * 12, vx: 0, vy: 0,
          hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
          mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
          exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
          level: lv, atk: 25, def: 8, facing: 0, cooldown: 0, alive: true, avatarPath: r.avatarPath,
        });
      }
    });
    // ★ 直接同步推 playing state（用 setTimeout(200) 在 background tab 上不可靠，
    //   bsk 控制台时整个 setTimeout 队列被节流到 1Hz，start action 永远到不了）
    lastState = {
      phase: "playing", version: 5, tick: 0,
      world: { w: 3000, h: 3000 },
      // ★ 保留 roles：playing 推空 roles → onHostState 整份替换 → 选人阶段无角色可选
      roles: storyData.roles || [],
      selections: { participants: sel.participants || [], spectators: sel.spectators || [], enemies: sel.enemies || [] },
      entities: ents, chests: [], potions: [], floaters: [],
      skills: DEFAULT_SKILLS,
      items: materialsToItems(storyData.materials || []),
      skillPage: 0, itemPage: 0,
      exp: 0, money: 0, drops: [], kills: 0,
      events: ["dev-host: 游戏开始（" + STORY + "）"],
      result: null,
      map: null, mapSource: "fallback",
    };
    post(lastState);
    log("host→ pushed playing state (ents: " + ents.length + ")");
  }
  if (d.type === "tf_plugin_tick" && d.action === "tick") {
    if (!lastState) return;
    // ★ 用 50ms 间隔的"服务器 tick"——每次客户端发 tf_plugin_tick，
    //   把请求参数合并到 lastPendingTick，由服务器定时器自己驱动 AI。
    //   这避免了 background tab 上 setTimeout/RAF 被节流导致 AI 不跑。
    if (!window._devHostInterval) {
      window._devHostInterval = setInterval(() => {
        const p = window._devHostPending || {};
        window._devHostPending = null;
        // ★ 客户端上报的当前关卡名（跨 frame 传值的唯一通道是 tick 消息）
        if (p.levelName) currentLevelName = p.levelName;
        // ★ 玩家已死（over）→ 结算画面，停跑战斗 AI / 刷怪（客户端 loop 也已停发）
        if (lastState.phase === "over") return;
        // ★ 自己计数 tick（p.tick 是客户端的，可能为 0）
        lastState.tick = (lastState.tick || 0) + 1;
        // ★ 必须每次重新读 lastState.entities —— 之前 const ents = ... 会把旧数组引用
        //   冻结，野怪同步段重建 lastState.entities 后下面的逻辑仍改旧数组，
        //   导致 server push 出去的仍然是旧 11 只野怪（dev-host 永远在用切关前的引用）。
        const ents = lastState.entities;
        // 1. 镜像玩家位姿（前端权威）
        const me = ents.find((e) => e.side === "player");
        if (me) {
          const playerInfo = p.player || {};
          if (Number.isFinite(playerInfo.x)) me.x = playerInfo.x;
          if (Number.isFinite(playerInfo.y)) me.y = playerInfo.y;
          if (Number.isFinite(playerInfo.facing)) me.facing = playerInfo.facing;
          me.vx = 0; me.vy = 0;
          // 自然回复
          if (lastState.tick % 10 === 0) me.mp = Math.min(me.maxMp, (me.mp || 0) + 3);
          if (lastState.tick % 30 === 0) me.hp = Math.min(me.maxHp, me.hp + 1);
        }
      // 2. 敌人 AI（game.md 62-69）：
      //    ① 侦测/发起攻击距离 4m —— 4m 内才追击
      //    ② 伤害判定：近战 0.5m / 远程 4m
      //    ③ 玩家逃出 4m → 野怪停止追击、走回出生点（拴绳）
      const target = me;
      for (const e of ents) {
        if (e.side !== "enemy" || !e.alive || !target || !target.alive) { continue; }
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const d2 = Math.hypot(dx, dy) || 0.001;
        const isRanged = e.isRanged === true;
        const home = e.homeX !== undefined ? e : null;
        // ── 拴绳：离开出生点 > 4m 且玩家不在 4m 攻击圈内 → 回出生点 ──
        const homeD = home ? Math.hypot(e.x - e.homeX, e.y - e.homeY) : 0;
        if (d2 > 4) {
          // 脱战：走向出生点
          if (home && homeD > 0.3) {
            const hx = e.homeX - e.x;
            const hy = e.homeY - e.y;
            const hd = Math.hypot(hx, hy) || 0.001;
            const sp = 2.0 * 0.1;
            e.x += (hx / hd) * sp; e.y += (hy / hd) * sp;
            e.facing = hx > 0 ? 0 : 180;
          }
          e.cooldown = (e.cooldown || 0) - 1;
          continue;
        }
        // ── 4m 内：追击 + 攻击 ──
        if (isRanged) {
          if (d2 > 4) {
            const sp = 2.0 * 0.1;
            e.x += (dx / d2) * sp; e.y += (dy / d2) * sp;
          } else if (d2 < 2.5) {
            const sp = 1.5 * 0.1;
            e.x -= (dx / d2) * sp; e.y -= (dy / d2) * sp;
          }
        } else {
          if (d2 > 0.4) {
            const sp = 2.0 * 0.1;
            e.x += (dx / d2) * sp; e.y += (dy / d2) * sp;
          }
        }
        e.facing = dx > 0 ? 0 : 180;
        e.cooldown = (e.cooldown || 0) - 1;
        // 伤害判定距离：近战 0.5m / 远程 4m（game.md 63-64）
        const attackRange = isRanged ? 4 : 0.5;
        if (d2 < attackRange && e.cooldown <= 0) {
          const dmg = Math.max(1, (e.atk || 5) - (target.def || 0));
          target.hp = Math.max(0, target.hp - dmg);
          target.hitFlashMs = 250;
          lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: target.x, y: target.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
          e.cooldown = 40;
          if (target.hp <= 0) {
            target.alive = false;
            lastState.events.push("[mock] 玩家被 " + e.name + " 击倒");
            lastState.phase = "over";
            lastState.result = { reason: "death", exp: lastState.exp, money: lastState.money, drops: lastState.drops, kills: lastState.kills, survivedTicks: lastState.tick };
          }
        }
      }
      // 3. 玩家自动攻击（每 30 tick）：近战 0.5m / 远程 4m（game.md 63）
      if (me && me.alive && lastState.tick % 30 === 0) {
        let closest = null, minD = Infinity;
        for (const e of ents) {
          if (e.side !== "enemy" || !e.alive) continue;
          const dd = Math.hypot(e.x - me.x, e.y - me.y);
          const reach = 0.5;
          if (dd < reach && dd < minD) { minD = dd; closest = e; }
        }
        if (closest) {
          const dmg = Math.max(1, (me.atk || 30) - (closest.def || 0));
          closest.hp = Math.max(0, closest.hp - dmg);
          closest.hitFlashMs = 250;
          me.actionBobMs = 300;
          lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: closest.x, y: closest.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
          // ★ 默认攻击特效：红色火花 + 命中爆炸
          if (!lastState.vfx) lastState.vfx = [];
          lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "spark", entityId: closest.id, x: closest.x, y: closest.y, life: 8, total: 8, color: "#ff5a5a" });
          lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "explosion", entityId: closest.id, x: closest.x, y: closest.y, life: 6, total: 6, color: "#ff8c3a" });
          if (closest.hp <= 0) {
            closest.alive = false;
            lastState.kills++;
            lastState.money = (lastState.money || 0) + 3;
            me.exp = (me.exp || 0) + (closest.level || 1) * 5;
            lastState.events.push("[mock] 击杀 " + closest.name + " (+" + ((closest.level || 1) * 5) + "exp +3money)");
          }
        }
      }
      // 4. 盟友 AI：跟随玩家 + 自动攻击最近敌人（每 30 tick）
      for (const a of ents) {
        if (a.side !== "ally" || !a.alive) continue;
        const target2 = ents.filter((e) => e.side === "enemy" && e.alive).sort((x, y) => Math.hypot(x.x - a.x, x.y - a.y) - Math.hypot(y.x - a.x, y.y - a.y))[0];
        if (target2) {
          const dd = Math.hypot(target2.x - a.x, target2.y - a.y);
          if (dd < 1.5 && (a.cooldown || 0) <= 0) {
            const dmg = Math.max(1, (a.atk || 25) - (target2.def || 0));
            target2.hp = Math.max(0, target2.hp - dmg);
            target2.hitFlashMs = 250;
            a.actionBobMs = 300;
            lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: target2.x, y: target2.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
            a.cooldown = 30;
            if (target2.hp <= 0) {
              target2.alive = false;
              lastState.kills++;
              lastState.money = (lastState.money || 0) + 3;
              lastState.events.push("[mock] 盟友 " + a.name + " 击杀 " + target2.name);
            }
          }
        }
      }
      // 5. 野怪生成（game.md 67-69）：出生点/等级/类型来自地图 json（mulberryForest.json
      //    Actors 层），由客户端切关时生成 mapmob_* 并经 tick.localEnemies 上报。
      //    dev-host 不随机刷怪！只做两件事：
      //    ① 收到 localEnemies 清单（epoch 变化 = 切图/补怪）→ 以它为准重建 server 侧敌怪表
      //    ② 死亡的地图怪记 respawnAt；玩家离开该地图 30 秒后重新生成（game.md：离开当前地图30秒后重新生成野怪）
      const le = p.localEnemies;
      if (le && Array.isArray(le.list) && le.epoch !== lastState._mobEpoch) {
        console.log("[devHost] 收到新清单 epoch=" + le.epoch + " list=" + le.list.length + " (之前=" + lastState._mobEpoch + ")");
        lastState._mobEpoch = le.epoch;
        // 保留玩家/盟友，删除 server 侧全部敌怪（客户端是权威）
        const keep = ents.filter((e) => e.side !== "enemy");
        const bounds = le.bounds || { lx: 29, ly: 19 };
        for (const m of le.list) {
          keep.push({
            id: m.id, name: m.name, side: "enemy",
            x: m.x, y: m.y, vx: 0, vy: 0,
            hp: m.hp, maxHp: m.maxHp || m.hp,
            mp: 0, maxMp: 0, exp: m.exp || 0, expToNext: 0,
            level: m.level || 1, atk: m.atk, def: m.def,
            facing: 180, cooldown: 0, alive: m.alive !== false,
            avatarPath: m.avatarPath, isRanged: m.isRanged === true,
            homeX: m.x, homeY: m.y,            // ★ 拴绳出生点 = 地图 json 的出生点
            mapMob: true,                      // ★ 标记：地图怪（离开地图 30s 重生）
            _deadAt: m.alive === false ? 0 : undefined,
          });
        }
        lastState.entities = keep;
        lastState.events.push("[mock] 地图野怪同步（" + le.list.length + " 只）");
      }
      // 关卡名跟踪（仅日志用，不做刷怪控制）
      if (currentLevelName !== lastState._mobLevel) {
        lastState._mobLevel = currentLevelName;
      }
      // 6. 飘字/vfx/cd 衰减
      lastState.floaters = lastState.floaters.filter((f) => { f.life--; return f.life > 0; });
      if (lastState.vfx) lastState.vfx = lastState.vfx.filter((v) => { v.life--; return v.life > 0; });
      // ★ 技能 cd 每 tick -1（castSkill 时 dev-host 已设 cdLeft=cd）
      for (const sk of lastState.skills || []) {
        if (sk.cdLeft && sk.cdLeft > 0) sk.cdLeft = Math.max(0, sk.cdLeft - 1);
      }
      for (const e of ents) {
        if (e.hitFlashMs && e.hitFlashMs > 0) e.hitFlashMs = Math.max(0, e.hitFlashMs - 100);
        if (e.actionBobMs && e.actionBobMs > 0) e.actionBobMs = Math.max(0, e.actionBobMs - 100);
      }
      // 7. 回推
        post(lastState);
      }, 100);
      return;
    }
    // 客户端发来 tick：缓存到 pending，由服务器定时器自己取
    window._devHostPending = d.params || {};
  }
  // 处理 skill / item 等其他 action
  if (d.type === "tf_plugin_tick" && (d.action === "skill" || d.action === "item" || d.action === "page" || d.action === "exit")) {
    if (!lastState) return;
    // ★ exit：模拟 entry.js handle_action("exit") 的结算：
    //   phase=over，result={reason:"exit", exp, money, drops, kills, survivedTicks}
    if (d.action === "exit" && lastState.phase === "playing") {
      lastState.phase = "over";
      lastState.result = {
        reason: "exit",
        exp: lastState.exp || 0,
        money: lastState.money || 0,
        drops: [...(lastState.drops || [])],
        kills: lastState.kills || 0,
        survivedTicks: lastState.tick || 0,
      };
      lastState.events.push("[mock] 玩家主动退出（野外生存结束）");
    }
    // 简化：skill/item 直接给个回包（同步，不走 setTimeout）
    if (d.action === "skill" && d.params) {
      const me2 = lastState.entities.find((e) => e.side === "player");
      const sk = lastState.skills?.[d.params.index];
      if (me2 && sk) {
        if (!lastState.vfx) lastState.vfx = [];
        const id = "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6);
        if (sk.name === "冲斩") {
          lastState.vfx.push({
            id, kind: "slash_arc", entityId: me2.id,
            x: me2.x, y: me2.y,
            facing: me2.facing, life: 12, total: 12,
            color: "#fff", size: 1.6,
          });
        } else if (sk.name === "火球") {
          // ★ 火球目标 = 范围内最近的敌人；打过去产生 dmg/飘字/命中特效
          let target = null, minD = Infinity;
          for (const e2 of lastState.entities) {
            if (e2.side !== "enemy" || !e2.alive) continue;
            const dd = Math.hypot(e2.x - me2.x, e2.y - me2.y);
            if (dd < minD && dd < 12) { minD = dd; target = e2; }
          }
          const tx = target ? target.x : me2.x + Math.cos((me2.facing || 0) * Math.PI / 180) * 10;
          const ty = target ? target.y : me2.y - Math.sin((me2.facing || 0) * Math.PI / 180) * 10;
          lastState.vfx.push({
            id, kind: "fireball", entityId: me2.id,
            targetEntityId: target?.id,
            x: me2.x, y: me2.y,
            targetX: tx, targetY: ty,
            facing: me2.facing, life: 16, total: 16,
            color: "#ff6a00", size: 1.0,
          });
          // ★ 命中伤害（弹体到达后）
          if (target) {
            const dmg = Math.max(1, (sk.power || 20) + Math.floor((me2.atk || 30) * 0.5) - (target.def || 0));
            target.hp = Math.max(0, target.hp - dmg);
            target.hitFlashMs = 250;
            lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: target.x, y: target.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
            lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
          }
        } else if (sk.name === "治疗") {
          lastState.vfx.push({
            id, kind: "heal_ring", entityId: me2.id,
            x: me2.x, y: me2.y,
            facing: 0, life: 18, total: 18,
            color: "#7CFFB2", size: 1.0,
          });
        } else if (sk.name === "护盾") {
          lastState.vfx.push({
            id, kind: "buff_ring", entityId: me2.id,
            x: me2.x, y: me2.y,
            facing: 0, life: 30, total: 30,
            color: "#9CCFFF", size: 1.0,
          });
        }
        sk.cdLeft = sk.cd || 0;
      }
    }
    post(lastState);
  }
  // ★ item：磨刀石/开山刀/暮光佩剑/仪式长剑 → buff 给玩家（命中+atk），配 buff_ring vfx
  if (d.type === "tf_plugin_tick" && d.action === "item") {
    if (!lastState) return;
    const me3 = lastState.entities.find((e) => e.side === "player");
    const it = lastState.items?.[d.params?.index];
    if (me3 && it) {
      if (!lastState.vfx) lastState.vfx = [];
      const id = "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6);
      lastState.vfx.push({ id, kind: "buff_ring", entityId: me3.id, x: me3.x, y: me3.y, facing: 0, life: 24, total: 24, color: "#FFCC55", size: 1.0 });
      // ★ buff：临时增加 atk（30 tick），叠加在 me3.atk
      if (!me3._atkBuffLeftMs) me3._atkBuffLeftMs = 0;
      me3._atkBuffLeftMs = 30;
    }
    post(lastState);
    return;
  }
  // ★ revive：复活玩家（半血回场），清空周围敌人给玩家喘息空间
  if (d.type === "tf_plugin_tick" && d.action === "revive") {
    if (!lastState) return;
    const me2 = lastState.entities.find((e) => e.side === "player");
    if (me2) {
      me2.alive = true;
      me2.hp = Math.max(1, Math.floor(me2.maxHp / 2));
      me2.cooldown = 0;
    }
    lastState.entities = lastState.entities.filter((e) => e.side !== "enemy");
    lastState.phase = "playing";
    lastState.result = null;
    lastState._waveTimer = 0;
    lastState.events.push("[mock] 复活成功（半血回归）");
    post(lastState);
    log("host→ revive → phase=playing");
  }
});
</script>
</body>
</html>`;
      server.middlewares.use("/__dev_host", (_req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(PAGE);
      });
      // --conn 模式下根路径直接进拟真宿主桩（用户不用记 /__dev_host）
      server.middlewares.use("/", (req, res, next) => {
        const u = req.url || "/";
        // ?__inner=1 是 dev-host 内嵌 iframe 的标记，加载真正的游戏本体（不再重定向）
        if (u.includes("__inner=1")) return next();
        // 静态资源 / 资源路径透传
        if (u !== "/" && !u.startsWith("/?")) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(PAGE);
      });
    },
  };
}

/**
 * 构建为单个自包含 HTML（内联 JS/CSS），
 * 输出到插件 ui/game.html，由后端 /plugin/getAsset 提供给 iframe 加载。
 *
 * --story 参数通过 cross-env 传入，VITE_STORY/VITE_CONN 由 Vite 注入到前端
 * （只有 VITE_ 前缀的 env 变量才会注入）。
 *
 * --conn 模式会额外注册 /__dev_host 拟真宿主桩页面：
 *   访问 http://localhost:3000/__dev_host 即可在浏览器内选人、开始游戏（无需另启服务）。
 */
export default defineConfig(({ mode }) => {
  // 加载 .env.<mode> 文件（debug 模式下走 .env.debug）
  const env = loadEnv(mode, process.cwd(), "");
  // workshops 目录在 vue/ 的 ../../workshops/
  const workshopsRoot = resolve(__dirname, "..", "..", "..", "workshops");
  return {
    plugins: [
      vue(),
      viteSingleFile(),
      // 仅在非生产模式注册中间件
      ...(mode === "production" ? [] : [storyDataPlugin(workshopsRoot), devHostPlugin(env.CONN ?? "", env.STORY ?? "")]),
    ],
    server: {
      port: 3000,
    },
    define: {
      // Vite 默认不注入非 VITE_ 前缀的变量到客户端，这里显式暴露
      __STORY__: JSON.stringify(env.STORY ?? ""),
      __CONN__: JSON.stringify(env.CONN ?? ""),
    },
    base: "./",
    build: {
      outDir: "../ui",
      emptyOutDir: true,
      assetsInlineLimit: 100 * 1024 * 1024,
      target: "es2020",
    },
  };
});