// vite.config.ts
import { defineConfig, loadEnv } from "file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/plugins/toonflow-field-survival/vue/node_modules/vite/dist/node/index.js";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import http from "http";
import vue from "file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/plugins/toonflow-field-survival/vue/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { viteSingleFile } from "file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/plugins/toonflow-field-survival/vue/node_modules/vite-plugin-singlefile/dist/esm/index.js";
import { fileURLToPath } from "url";
var __vite_injected_original_import_meta_url = "file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/plugins/toonflow-field-survival/vue/vite.config.ts";
function loadDotenvLight(envPath) {
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
      if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
  }
}
var __filename = fileURLToPath(__vite_injected_original_import_meta_url);
var __dirname = fileURLToPath(new URL(".", __vite_injected_original_import_meta_url));
{
  const envPath = resolve(__dirname, "../../../.env");
  loadDotenvLight(envPath);
}
function storyDataPlugin(workshopsRoot) {
  return {
    name: "story-data",
    configureServer(server) {
      server.middlewares.use("/story-data", (req, res) => {
        const filePath = resolve(workshopsRoot, decodeURIComponent(req.url.replace(/^\//, "")));
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
    }
  };
}
function devHostPlugin(conn, story) {
  return {
    name: "dev-host",
    configureServer(server) {
      if (!conn || conn === "0" || conn === "false") return;
      const STORY = story || "";
      const STORY_ROOT = resolve(__dirname, "../workshops/toonflow-field-survival/map_design");
      const storyUrl = STORY ? `/story-data/toonflow-field-survival/map_design/${encodeURIComponent(STORY)}/test_data/test_state.json` : "";
      const SERVICE_URL = process.env.game_app_service_url || "http://localhost:60002";
      const AUTH_TOKEN = process.env.auth_token || "";
      const ENTRY_PATH = resolve(__dirname, "../entry.js");
      server.middlewares.use("/toon-asset", (req, res, next) => {
        try {
          const targetPath = (req.url || "/").replace(/^\//, "");
          const headers = {};
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
              headers
            },
            (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 502;
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (v) res.setHeader(k, v);
              }
              proxyRes.pipe(res);
            }
          );
          proxyReq.on("error", (err) => {
            res.statusCode = 502;
            res.end("proxy error: " + err.message);
          });
          req.pipe(proxyReq);
        } catch (e) {
          next(e);
        }
      });
      server.middlewares.use("/toon-api", (req, res, next) => {
        try {
          const u = new URL(req.url || "/", SERVICE_URL);
          const targetPath = u.pathname + u.search;
          const headers = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          if (AUTH_TOKEN) {
            headers["authorization"] = "Bearer " + AUTH_TOKEN;
          }
          const proxyReq = http.request(
            {
              hostname: new URL(SERVICE_URL).hostname,
              port: new URL(SERVICE_URL).port || 80,
              method: req.method,
              path: targetPath,
              headers
            },
            (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 502;
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (v) res.setHeader(k, v);
              }
              proxyRes.pipe(res);
            }
          );
          proxyReq.on("error", (err) => {
            res.statusCode = 502;
            res.end("proxy error: " + err.message);
          });
          req.pipe(proxyReq);
        } catch (e) {
          next(e);
        }
      });
      const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dev-host\uFF08\u62DF\u771F\u5BBF\u4E3B\u6869\uFF09\u2014 ${STORY || "(no story)"}</title>
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
// \u2605 \u6CE8\u5165 auth token\uFF08\u4ECE ../.env \u8BFB\uFF09\uFF0C\u6D4F\u89C8\u5668 fetch /toon-api \u65F6\u81EA\u52A8\u5E26\u4E0A
const AUTH_TOKEN = ${JSON.stringify(AUTH_TOKEN)};
// \u2605 \u771F\u5B9E\u63D2\u4EF6\u5165\u53E3\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09\u2014\u2014\u6869\u901A\u8FC7 vite /@fs \u52A8\u6001 import \u5B83\uFF0C\u6267\u884C\u4E0E\u5B89\u88C5\u540E\u4E00\u81F4\u7684\u903B\u8F91
const ENTRY_PATH = ${JSON.stringify(ENTRY_PATH.replace(/\\/g, "/"))};
window.__AUTH_TOKEN__ = AUTH_TOKEN;
window.__SERVICE_URL__ = SERVICE_URL;
let lastState = null;
let storyData = null;
// \u2605 \u5F53\u524D\u5173\u5361\u540D\uFF08\u7531\u5BA2\u6237\u7AEF\u6BCF\u5E27 tick \u4E0A\u62A5\uFF1Bnull = \u672A\u77E5 \u2192 \u9ED8\u8BA4 RUINS \u4E0D\u5B89\u5168\uFF0C\u89C1 currentTheme\uFF09
let currentLevelName = null;
// \u2605 \u5916\u90E8\u53EF\u8C03\u7528\u7684 state \u4FEE\u6539\u5668\uFF08bsk evaluate / browser console \u76F4\u63A5\u8C03\u7528\uFF09
// \u7528\u6CD5\u793A\u4F8B\uFF1Awindow.__devHostModify({ hp: 999, exp: 5000, level: 20 })
window.__devHostModify = (patch) => {
  if (!lastState || !lastState.entities) return "no state";
  let applied = 0;
  for (const [k, v] of Object.entries(patch)) {
    const ent = lastState.entities.find(e => e.side === "player");
    if (ent && k in ent) { ent[k] = v; applied++; }
  }
  return "applied " + applied + " to player";
};
// \u2605 \u5916\u90E8\u53EF\u8C03\u7528\u7684 state \u63A2\u9488\uFF1A\u8FD4\u56DE\u73A9\u5BB6/\u654C\u602A\u6458\u8981\uFF08bsk evaluate \u7528\uFF09
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
// \u2605 dev-host \u6A21\u5F0F\u4E0B\uFF0C\u6A21\u62DF t_plugin_session_data\uFF08real host \u4E0D\u5728\uFF0Cstandalone \u5FC5\u987B\u81EA\u5DF1\u5E94\u7B54\uFF09
//   \u6570\u636E\u5B58 window.__devHostPluginData\uFF0C\u8DE8\u7528\u6237/\u8DE8\u4F1A\u8BDD\u5171\u4EAB (sessionId="all")
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
    const v = window.__pdGet(k);
    result = { dataKey, value: v ? v.value : null, updatedAt: v ? v.updatedAt : 0 };
  } else if (op === "set") {
    window.__pdSet(k, value);
    result = { dataKey, value: null, ok: true };
  } else if (op === "list") {
    const keys = [];
    for (const key of window.__devHostPluginData.keys()) {
      const parsed = JSON.parse(key);
      if (parsed.p === pluginId && parsed.s === (sessionId || "all")) keys.push(parsed.k);
    }
    result = { keys, dataKey: "", value: null };
  } else if (op === "remove") {
    window.__pdRemove(k);
    result = { dataKey, value: null, ok: true };
  }
  if (result) {
    // \u2605 \u56DE\u5305\u8981\u53D1\u5230 game iframe\uFF08\u4E0D\u662F dev-host \u9876\u5C42\u672C\u8EAB\u7684 parent\uFF09
    const gameWin = document.getElementById("game")?.contentWindow;
    (gameWin || window.parent).postMessage({ type: "tf_plugin_data_result", reqId, ok: true, ...result }, "*");
  }
});
const log = (m) => { const el = document.getElementById("log"); el.textContent = m + "\\n" + el.textContent.slice(0, 4000); };
const post = (state, response) => {
  if (state && typeof state === "object") state.response = response || "";
  document.getElementById("game").contentWindow.postMessage({ type: "tf_plugin_state", state, actions: ["init","start","tick","skill","item","page","exit","revive","sys","sys_sell","sys_use_item","sys_sort","sys_ring_move","sys_use_skill","sys_shop_refresh","sys_shop_buy","sys_party","sys_teleport","sys_travel"], response: response || "" }, "*");
};

/* ================= \u771F\u5B9E\u63D2\u4EF6 entry.js \u6267\u884C\u5668\uFF08\u8584\u5BBF\u4E3B\uFF09 =================
 * \u6869\u4E0D\u518D\u81EA\u5DF1\u6A21\u62DF\u6E38\u620F\u903B\u8F91\uFF1AloadStoryData() \u62FF\u5230\u670D\u52A1\u5668\u53C2\u6570\u5361\u540E\uFF0C
 * \u6240\u6709 action\uFF08init/start/tick/skill/item/page/exit/revive/sys*\uFF09\u90FD\u8F6C\u4EA4 entry.js\uFF0C
 * \u4E0E\u300C\u63D2\u4EF6\u5B89\u88C5\u540E\u300D\u7531\u5BBF\u4E3B PluginExecutor \u6267\u884C\u7684\u8DEF\u5F84\u4E00\u81F4\u3002
 * pluginData\uFF08t_plugin_session_data \u7684\u6A21\u62DF\uFF09\u4E0E\u524D\u7AEF SDK \u7684 tf_plugin_data \u8BF7\u6C42\u5171\u7528\u540C\u4E00\u4EFD\u5B58\u50A8\u3002
 */
let entryMod = null;
let entryCtx = null;
let entryState = null;
let entryBroken = false;
window.__devHostPluginState = () => (entryState ? { phase: entryState.phase, tick: entryState.tick, card: entryState.playerCard, bag: (entryState.playerCard || {}).items, ring: entryState.ring } : null);

// \u63D2\u4EF6\u4F1A\u8BDD\u6570\u636E\uFF08\u6A21\u62DF t_plugin_session_data\uFF09\uFF1A\u5185\u5B58 Map + localStorage \u53CC\u5199\uFF0C\u5237\u65B0\u4E0D\u4E22
const __PD_PREFIX = "devhost_pd_v1_";
window.__pdKey = (pluginId, sessionId, dataKey) => JSON.stringify({ p: pluginId || "", s: sessionId || "all", k: dataKey || "" });
window.__pdGet = (k) => {
  if (window.__devHostPluginData.has(k)) return window.__devHostPluginData.get(k);
  try {
    const raw = localStorage.getItem(__PD_PREFIX + k);
    if (raw) { const rec = JSON.parse(raw); window.__devHostPluginData.set(k, rec); return rec; }
  } catch { /* ignore */ }
  return null;
};
window.__pdSet = (k, value) => {
  const rec = { value, updatedAt: Date.now() };
  window.__devHostPluginData.set(k, rec);
  try { localStorage.setItem(__PD_PREFIX + k, JSON.stringify(rec)); } catch { /* ignore */ }
  window.__devHostPluginEmit(JSON.parse(k).k);
  return rec;
};
window.__pdRemove = (k) => {
  window.__devHostPluginData.delete(k);
  try { localStorage.removeItem(__PD_PREFIX + k); } catch { /* ignore */ }
  window.__devHostPluginEmit(JSON.parse(k).k);
};

const ENTRY_PLUGIN_ID = "com.toonflow.minigame-field-survival";
function buildEntryCtx() {
  const sessionId = (typeof window !== "undefined" && window.__STORY_SESSION_ID__) || "all";
  entryCtx = {
    pluginId: ENTRY_PLUGIN_ID,
    userId: 1,
    sessionId,
    roles: (storyData && storyData.roles) || [],
    playerCard: (window.__STORY_PLAYER_CARD__ || {}),
    worldBookDigest: "",
    tsApi: {
      pluginData: {
        get: async (k) => { const rec = window.__pdGet(window.__pdKey(ENTRY_PLUGIN_ID, sessionId, k)); return rec ? rec.value : null; },
        set: async (k, v) => { window.__pdSet(window.__pdKey(ENTRY_PLUGIN_ID, sessionId, k), v); return null; },
        remove: async (k) => { window.__pdRemove(window.__pdKey(ENTRY_PLUGIN_ID, sessionId, k)); return null; },
        list: async () => {
          const out = [];
          for (const key of window.__devHostPluginData.keys()) {
            try { const p = JSON.parse(key); if (p.p === ENTRY_PLUGIN_ID && p.s === sessionId) out.push(p.k); } catch { /* ignore */ }
          }
          return out;
        },
      },
      // 3001 \u6869\u6CA1\u6709\u63D2\u4EF6 agent \u901A\u9053\uFF08\u771F\u5B9E\u5BBF\u4E3B\u8D70 runPluginAgent\uFF09\uFF1A
      // \u629B\u9519\u8BA9 entry.js \u843D\u5230\u5185\u7F6E\u515C\u5E95\uFF08\u5730\u56FE fallbackMap / \u5546\u57CE BUILTIN_SHOP_GOODS\uFF09\uFF0C
      // \u5E76\u5728\u4E8B\u4EF6\u91CC\u63D0\u793A\u300C\u964D\u7EA7\u300D\u3002\u5B89\u88C5\u540E\u94FE\u8DEF\u4F1A\u8D70\u771F\u5B9E agent\u3002
      agent: {
        run: async (agentName) => {
          log("\u26A0 entry.agent.run(" + agentName + ") \u5728 dev-host \u6869\u4E0D\u53EF\u7528 \u2192 \u4F7F\u7528\u5185\u7F6E\u515C\u5E95");
          throw new Error("dev-host \u6869\u65E0\u63D2\u4EF6 agent \u901A\u9053");
        },
      },
    },
  };
  return entryCtx;
}

async function loadEntryModule() {
  if (entryMod) return entryMod;
  const url = "/@fs/" + ENTRY_PATH;
  const mod = await import(/* @vite-ignore */ url);
  if (!mod || typeof mod.handle_action !== "function") throw new Error("entry.js \u672A\u5BFC\u51FA handle_action");
  entryMod = mod;
  log("\u2713 \u5DF2\u52A0\u8F7D\u771F\u5B9E\u63D2\u4EF6\u5165\u53E3 entry.js\uFF08\u8584\u5BBF\u4E3B\u6A21\u5F0F\uFF09");
  return mod;
}

/** \u628A action \u4EA4\u7ED9 entry.js \u6267\u884C\uFF1B\u6210\u529F\u8FD4\u56DE true\uFF0C\u5931\u8D25\uFF08\u53EA\u62A5\u4E00\u6B21\uFF09\u8FD4\u56DE false \u4EA4\u7ED9\u65E7\u903B\u8F91\u515C\u5E95 */
async function tryEntryAction(action, params) {
  if (entryBroken) return false;
  try {
    const mod = await loadEntryModule();
    if (!entryCtx) buildEntryCtx();
    if (!entryState && action !== "init" && action !== "start_init" && action !== "start") {
      await mod.handle_action("init", {}, null, entryCtx);
    }
    const res = await mod.handle_action(action, params || {}, entryState, entryCtx);
    if (!res || !res.state) return false;
    entryState = res.state;
    // \u53CD\u5411\u540C\u6B65\u53C2\u6570\u5361\uFF1Aentry \u5185\u90E8 patchCard \u6539\u8FC7\u7684 card \u8981\u6210\u4E3A\u540E\u7EED tick \u7684 ctx \u6765\u6E90\uFF0C
    // \u5426\u5219\u4E0B\u4E00\u4E2A tick \u7684 syncCardFromContext \u4F1A\u7528\u65E7 card \u8986\u76D6\uFF08\u5356\u51FA/\u8D2D\u4E70\u7ED3\u679C\u4E22\u5931\uFF09
    if (entryState.playerCard) entryCtx.playerCard = entryState.playerCard;
    lastState = entryState;
    post(entryState, res.response || "");
    log("entry\u2192 " + action + " ok" + (res.response ? " / " + res.response : ""));
    return true;
  } catch (err) {
    entryBroken = true;
    log("! entry.js \u6267\u884C\u5931\u8D25\uFF0C\u56DE\u9000\u6869\u5185\u672C\u5730\u6A21\u62DF\uFF1A" + (err && err.message ? err.message : err));
    return false;
  }
}

/* \u4E32\u884C\u961F\u5217\uFF1A\u771F\u5BBF\u4E3B\u662F\u4E32\u884C\u5904\u7406 action \u7684\uFF0C\u6869\u8FD9\u91CC\u4E5F\u5FC5\u987B\u4E32\u884C\uFF0C
   \u5426\u5219\u300C\u6BCF\u5E27 tick + \u5E76\u53D1\u7684 sys_* \u64CD\u4F5C\u300D\u4F1A\u5E76\u53D1\u5199 entryState \u9020\u6210\u72B6\u6001\u4E92\u76F8\u8986\u76D6\u3002
   tick \u79EF\u538B\u65F6\u76F4\u63A5\u4E22\u5F03\uFF08\u4E0B\u4E00\u5E27\u8FD8\u4F1A\u518D\u6765\uFF09\uFF0C\u907F\u514D\u961F\u5217\u8D8A\u6EDA\u8D8A\u957F\u3002 */
let entryChain = Promise.resolve();
let entryTickPending = false;
function queueEntryAction(action, params) {
  if (action === "tick") {
    if (entryTickPending) return Promise.resolve(true);
    entryTickPending = true;
  }
  const run = () => tryEntryAction(action, params).finally(() => {
    if (action === "tick") entryTickPending = false;
  });
  const p = entryChain.then(run, run);
  entryChain = p.catch(() => {});
  return p;
}
const showError = (msg) => {
  const el = document.getElementById("error");
  el.textContent = msg;
  el.style.display = "flex";
  document.getElementById("wrap").style.display = "none";
  log("ERROR: " + msg);
};

// \u542F\u52A8\u65F6\u62C9\u670D\u52A1\u5668 story runtime state\u3002\u6D41\u7A0B\uFF1A
//   1) \u4ECE\u672C\u5730 workshops/.../${STORY}/story.json \u8BFB sessionId/worldId\uFF084 \u5B57\u6BB5\uFF0C\u4E0D\u7ECF\u5E38\u53D8\uFF09
//   2) \u7528 sessionId \u8C03 POST {SERVICE_URL}/game/storyInfo\uFF08\u901A\u8FC7 /toon-api \u8D70 vite \u4EE3\u7406\uFF0C\u907F\u514D CORS\uFF09
//   3) \u628A server response.state.player + .npcs \u8F6C\u4E3A test_state.json \u7684 roles \u6570\u7EC4\u683C\u5F0F
//   4) \u5931\u8D25\u56DE\u9000\u5230\u672C\u5730 test_state.json\uFF08\u4E0D\u6253\u65AD\u5F00\u53D1\uFF09
async function loadStoryData() {
  if (!STORY) {
    showError("\u672A\u6307\u5B9A STORY\uFF1A\\nnpm run debug -- --story=\u4F60\u7684\u6545\u4E8B\u540D --conn");
    return false;
  }
  // 1) \u8BFB\u672C\u5730 story.json \u62FF sessionId/worldId
  let sessionId = "";
  let worldId = 0;
  try {
    // \u6D4F\u89C8\u5668\u91CC\u6CA1 node \u7684 resolve/existsSync/readFileSync\uFF0C\u7528 fetch \u8D70 vite \u9759\u6001\u670D\u52A1
    const storyMetaUrl = "/story-data/toonflow-field-survival/map_design/" + encodeURIComponent(STORY) + "/story.json";
    const metaR = await fetch(storyMetaUrl);
    if (metaR.ok) {
      const meta = await metaR.json();
      sessionId = String(meta.sessionId || "");
      worldId = Number(meta.worldId || 0);
    } else {
      log("! story.json HTTP " + metaR.status + " \u2192 fallback local");
      return await loadStoryFromLocal();
    }
  } catch (e) {
    log("! read story.json failed: " + e.message + " \u2192 fallback local");
    return await loadStoryFromLocal();
  }
  if (!sessionId) {
    log("! story.json \u7F3A sessionId \u2192 fallback local");
    return await loadStoryFromLocal();
  }
// 2) \u8C03\u670D\u52A1\u5668\uFF08\u901A\u8FC7 /toon-api \u4EE3\u7406\uFF09
  try {
    const headers = { "Content-Type": "application/json" };
    // dev-host \u9875\u9762 fetch \u65F6\u76F4\u63A5\u5E26 token\uFF08vite.config.ts \u6CE8\u5165\u4E86 window.__AUTH_TOKEN__\uFF09
    if (typeof window !== "undefined" && window.__AUTH_TOKEN__) {
      headers["Authorization"] = "Bearer " + window.__AUTH_TOKEN__;
    }
    const r = await fetch("/toon-api/game/storyInfo", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId }),
    });
    if (!r.ok) {
      log("! server storyInfo HTTP " + r.status + " \u2192 fallback local");
      return await loadStoryFromLocal();
    }
    const resp = await r.json();
    if (resp?.code !== 200 || !resp?.data) {
      log("! server response invalid (code=" + resp?.code + ") \u2192 fallback local");
      return await loadStoryFromLocal();
    }
    const srvData = resp.data;
    const srvState = srvData.state || {};
    // 3) \u8F6C\u6362\uFF1Astate.player + state.npcs \u2192 roles[]
    //    \u2605 \u53C2\u6570\u5361\uFF08parameterCardJson\uFF09\u5FC5\u987B\u5B8C\u6574\u5E26\u51FA\uFF1Aentry.js \u7528\u5B83\u6784\u5EFA\u80CC\u5305/\u6280\u80FD/\u7B49\u7EA7\uFF0C
    //      \u524D\u7AEF\u7CFB\u7EDF\u9762\u677F\u76F4\u63A5\u8BFB state.playerCard \u2192 \u4E0E\u670D\u52A1\u5668\u6570\u636E\u4E00\u81F4\u3002
    const roles = [];
    const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    // \u89D2\u8272\u5728\u5730\u56FE\u4E0A\u7684\u4F4D\u7F6E\uFF08\u89D2\u8272\u5361\u300C\u4F20\u9001\u5230\u300D\u7528\uFF09\uFF1A\u517C\u5BB9\u591A\u79CD\u5B57\u6BB5\u547D\u540D
    const posOf = (n) => {
      const p = n.position || n.pos || {};
      return {
        mapName: n.mapName || n.map || n.levelName || n.sceneName || p.mapName || "",
        x: numOr(n.x ?? p.x, 0),
        y: numOr(n.y ?? p.y, 0),
      };
    };
    if (srvState.player) {
      const p = srvState.player;
      const card = p.parameterCardJson || p.parameter_card_json || {};
      window.__STORY_PLAYER_CARD__ = JSON.parse(JSON.stringify(card));
      const lv = numOr(card.level, p.attributes?.cultivationInsight || 1);
      const pos = posOf(p);
      roles.push({
        id: p.id || "player",
        name: p.name || "\u73A9\u5BB6",
        roleType: p.roleType || "player",
        // \u2605 server avatarPath "/1/..." \u6539\u5199\u5230 /toon-asset/1/... \u8D70 vite \u4EE3\u7406
        avatarPath: (p.avatarPath && p.avatarPath.startsWith("/")) ? "/toon-asset" + p.avatarPath : (p.avatarPath || ""),
        description: p.description || "",
        initial_level: lv,
        level: lv,
        hp: numOr(card.hp, 100),
        maxHp: numOr(card.hp, 100),
        mp: numOr(card.mp, 0),
        exp: numOr(card.exp, 0),
        skills: Array.isArray(card.skills) ? card.skills : [],
        items: Array.isArray(card.items) ? card.items : [],
        parameterCardJson: card,
        mapName: pos.mapName,
        x: pos.x,
        y: pos.y,
      });
    }
    for (const [npcId, npc] of Object.entries(srvState.npcs || {})) {
      const n = npc;
      const card = n.parameterCardJson || n.parameter_card_json || {};
      const lv = numOr(card.level, n.initial_level || 1);
      const pos = posOf(n);
      roles.push({
        id: n.id || npcId,
        name: n.name || npcId,
        roleType: n.roleType || "npc",
        avatarPath: (n.avatarPath && n.avatarPath.startsWith("/")) ? "/toon-asset" + n.avatarPath : (n.avatarPath || ""),
        description: n.description || "",
        initial_level: lv,
        level: lv,
        hp: numOr(card.hp, 100),
        maxHp: numOr(card.hp, 100),
        mp: numOr(card.mp, 0),
        exp: numOr(card.exp, 0),
        skills: Array.isArray(card.skills) ? card.skills : [],
        items: Array.isArray(card.items) ? card.items : [],
        parameterCardJson: card,
        mapName: pos.mapName,
        x: pos.x,
        y: pos.y,
      });
    }
    // materials \u5360\u4F4D\uFF1A\u7528 server inventory \u8F6C\u6210 materials \u683C\u5F0F\uFF08dev-host \u540E\u7EED\u8F6C items\uFF09
    const materials = (srvState.inventory || []).map((it, idx) => ({
      name: it.name || ("\u7269\u54C1" + (idx + 1)),
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
    // \u2605 \u628A sessionId \u66B4\u9732\u7ED9 game iframe\uFF08\u7CFB\u7EDF\u9762\u677F\u4E70/\u5356\u7269\u54C1\u8981\u53D1\u8BF7\u6C42\u5230\u670D\u52A1\u5668\uFF09
    if (typeof window !== "undefined") window.__STORY_SESSION_ID__ = sessionId;
    log("\u2713 loaded story from server: " + STORY + " (roles: " + roles.length + ", materials: " + materials.length + ", session: " + sessionId + ")");
    return true;
  } catch (e) {
    log("! server fetch failed: " + e.message + " \u2192 fallback local");
    return await loadStoryFromLocal();
  }
}

// \u56DE\u9000\uFF1A\u8BFB\u672C\u5730 test_state.json
async function loadStoryFromLocal() {
  try {
    const r = await fetch(STORY_URL);
    if (!r.ok) {
      showError("\u65E0\u6CD5\u8BFB\u53D6 story \u6570\u636E\uFF1A" + STORY_URL + "\\nHTTP " + r.status + "\\n\u8BF7\u786E\u8BA4 --story \u540D\u79F0\u6B63\u786E");
      return false;
    }
    storyData = await r.json();
    if (typeof window !== "undefined") window.__STORY_SESSION_ID__ = "";
    log("\u2713 loaded story (local fallback): " + STORY + " (roles: " + (storyData.roles?.length || 0) + ", monsters: " + (storyData.monsters?.length || 0) + ", materials: " + (storyData.materials?.length || 0) + ")");
    return true;
  } catch (e) {
    showError("\u8BFB\u53D6 story \u5931\u8D25\uFF1A" + e.message + "\\n" + STORY_URL);
    return false;
  }
}

// \u2605 entity_types.json\uFF08Rotten-Soup \u602A\u7269\u6743\u5A01\u6570\u636E\uFF0C\u6309 theme \u52A0\u6743\u5237\u602A\uFF09
let entityTypes = null;
async function loadEntityTypes() {
  const urls = ["/entity_types.json", "./entity_types.json", "../entity_types.json"];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) {
        entityTypes = await r.json();
        log("\u2713 loaded entity_types.json (enemies: " + (entityTypes.enemies?.length || 0) +
            ", themes: " + Object.keys(entityTypes.dungeon_themes || {}).length + ")");
        return;
      }
    } catch { /* try next */ }
  }
  log("\u26A0 entity_types.json not found, falling back to story monsters");
}

// \u5F53\u524D\u5173\u5361 \u2192 dungeon theme \u6620\u5C04\uFF08\u4E0E mockHost/mapConfig.THEME_BY_MAPNAME \u5BF9\u9F50\uFF09
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

// \u6309 theme \u6743\u91CD\u4ECE entity_types \u62BD\u4E00\u4E2A\u654C\u4EBA
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

// \u628A test_state.json \u7684 materials \u6620\u5C04\u6210 ItemSlot
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

// \u9ED8\u8BA4 4 \u4E2A\u6280\u80FD\uFF08\u548C\u63D2\u4EF6 mockHost \u9ED8\u8BA4\u5BF9\u9F50\uFF1A\u8FD1\u6218/\u8FDC\u7A0B/\u6CBB\u7597/\u62A4\u76FE\uFF09
const DEFAULT_SKILLS = [
  { name: "\u51B2\u65A9", power: 20, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee" },
  { name: "\u706B\u7403", power: 25, cost: 0, cd: 30, cdLeft: 0, type: "atk", range: "ranged" },
  { name: "\u6CBB\u7597", power: 30, cost: 0, cd: 40, cdLeft: 0, type: "heal", range: "melee" },
  { name: "\u62A4\u76FE", power: 0, cost: 0, cd: 60, cdLeft: 0, type: "buff", range: "melee" },
];

window.addEventListener("message", async (e) => {
  const d = e?.data;
  if (!d || typeof d !== "object") return;
  log("iframe\u2192 " + JSON.stringify(d).slice(0, 240));
  if (d.type === "tf_plugin_loaded") {
    log("HOST: tf_plugin_loaded received, loading story...");
    const ok = await loadStoryData();
    if (!ok) { log("HOST: loadStoryData failed"); return; }
    await loadEntityTypes();
    log("HOST: story+entityTypes loaded, pushing select state");
    // \u2605 \u76F4\u63A5\u540C\u6B65\u63A8 select state\uFF08\u4E0D\u7528 setTimeout\uFF0Cbackground tab \u4E0A\u4E0D\u53EF\u9760\uFF09
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
      events: ["dev-host \u5DF2\u63A8\u9001 select \u72B6\u6001\uFF08" + STORY + "\uFF09"],
      result: null,
      map: null, mapSource: "fallback",
    };
    // \u2605 \u771F\u5B9E\u63D2\u4EF6 entry.js \u63A5\u7BA1\uFF08\u8584\u5BBF\u4E3B\uFF09\uFF1Ainit \u8FD4\u56DE\u5E26\u670D\u52A1\u5668\u53C2\u6570\u5361\u7684 select state
    if (await queueEntryAction("init", {})) {
      log("HOST: entry.js \u5DF2\u63A5\u7BA1\uFF08init \u2192 select state\uFF09");
      return;
    }
    post(lastState);
    log("host\u2192 pushed select state (roles: " + lastState.roles.length + ", items: " + lastState.items.length + ")");
  }
  // \u2605 \u8584\u5BBF\u4E3B\uFF1A--conn \u6869\u4E0B\u6240\u6709\u52A8\u4F5C\u4F18\u5148\u4EA4\u7ED9\u771F\u5B9E\u63D2\u4EF6 entry.js \u6267\u884C\uFF08\u4E0E\u300C\u5B89\u88C5\u540E\u300D\u8DEF\u5F84\u4E00\u81F4\uFF09
  if (d.type === "tf_plugin_tick" && typeof d.action === "string") {
    if (await queueEntryAction(d.action, d.params || {})) return;
  }
  if (d.type === "tf_plugin_tick" && d.action === "start") {
    if (!storyData) { showError("storyData \u672A\u52A0\u8F7D"); return; }
    const sel = d.params?.selections || {};
    const roles = storyData.roles || [];
    const playerRole = roles.find((r) => r.roleType === "player") || roles[0];
    const ents = [];
    if (playerRole) {
      const lv = playerRole.initial_level || 10;
      const s = 1 + (lv - 1) * 0.3;
      ents.push({
        id: playerRole.id || "p1", name: playerRole.name || "\u73A9\u5BB6", side: "player",
        x: 0, y: 0, vx: 0, vy: 0,
        hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
        mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
        exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
        level: lv, atk: 30, def: 10, facing: 0, cooldown: 0, alive: true,
        avatarPath: playerRole.avatarPath,
      });
    }
    (sel.participants || []).forEach((id, i) => {
      // participants \u53EF\u80FD\u662F id(r02) \u4E5F\u53EF\u80FD\u662F name(\u88F4\u52C7)\uFF0C\u4E24\u79CD\u90FD\u5C1D\u8BD5\u5339\u914D
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
    // \u2605 \u76F4\u63A5\u540C\u6B65\u63A8 playing state\uFF08\u7528 setTimeout(200) \u5728 background tab \u4E0A\u4E0D\u53EF\u9760\uFF0C
    //   bsk \u63A7\u5236\u53F0\u65F6\u6574\u4E2A setTimeout \u961F\u5217\u88AB\u8282\u6D41\u5230 1Hz\uFF0Cstart action \u6C38\u8FDC\u5230\u4E0D\u4E86\uFF09
    lastState = {
      phase: "playing", version: 5, tick: 0,
      world: { w: 3000, h: 3000 },
      // \u2605 \u4FDD\u7559 roles\uFF1Aplaying \u63A8\u7A7A roles \u2192 onHostState \u6574\u4EFD\u66FF\u6362 \u2192 \u9009\u4EBA\u9636\u6BB5\u65E0\u89D2\u8272\u53EF\u9009
      roles: storyData.roles || [],
      selections: { participants: sel.participants || [], spectators: sel.spectators || [], enemies: sel.enemies || [] },
      entities: ents, chests: [], potions: [], floaters: [],
      skills: DEFAULT_SKILLS,
      items: materialsToItems(storyData.materials || []),
      skillPage: 0, itemPage: 0,
      exp: 0, money: 0, drops: [], kills: 0,
      events: ["dev-host: \u6E38\u620F\u5F00\u59CB\uFF08" + STORY + "\uFF09"],
      result: null,
      map: null, mapSource: "fallback",
    };
    post(lastState);
    log("host\u2192 pushed playing state (ents: " + ents.length + ")");
  }
  if (d.type === "tf_plugin_tick" && d.action === "tick") {
    if (!lastState) return;
    // \u2605 \u7528 50ms \u95F4\u9694\u7684"\u670D\u52A1\u5668 tick"\u2014\u2014\u6BCF\u6B21\u5BA2\u6237\u7AEF\u53D1 tf_plugin_tick\uFF0C
    //   \u628A\u8BF7\u6C42\u53C2\u6570\u5408\u5E76\u5230 lastPendingTick\uFF0C\u7531\u670D\u52A1\u5668\u5B9A\u65F6\u5668\u81EA\u5DF1\u9A71\u52A8 AI\u3002
    //   \u8FD9\u907F\u514D\u4E86 background tab \u4E0A setTimeout/RAF \u88AB\u8282\u6D41\u5BFC\u81F4 AI \u4E0D\u8DD1\u3002
    if (!window._devHostInterval) {
      window._devHostInterval = setInterval(() => {
        const p = window._devHostPending || {};
        window._devHostPending = null;
        // \u2605 \u5BA2\u6237\u7AEF\u4E0A\u62A5\u7684\u5F53\u524D\u5173\u5361\u540D\uFF08\u8DE8 frame \u4F20\u503C\u7684\u552F\u4E00\u901A\u9053\u662F tick \u6D88\u606F\uFF09
        if (p.levelName) currentLevelName = p.levelName;
        // \u2605 \u73A9\u5BB6\u5DF2\u6B7B\uFF08over\uFF09\u2192 \u7ED3\u7B97\u753B\u9762\uFF0C\u505C\u8DD1\u6218\u6597 AI / \u5237\u602A\uFF08\u5BA2\u6237\u7AEF loop \u4E5F\u5DF2\u505C\u53D1\uFF09
        if (lastState.phase === "over") return;
        // \u2605 \u81EA\u5DF1\u8BA1\u6570 tick\uFF08p.tick \u662F\u5BA2\u6237\u7AEF\u7684\uFF0C\u53EF\u80FD\u4E3A 0\uFF09
        lastState.tick = (lastState.tick || 0) + 1;
        // \u2605 \u5FC5\u987B\u6BCF\u6B21\u91CD\u65B0\u8BFB lastState.entities \u2014\u2014 \u4E4B\u524D const ents = ... \u4F1A\u628A\u65E7\u6570\u7EC4\u5F15\u7528
        //   \u51BB\u7ED3\uFF0C\u91CE\u602A\u540C\u6B65\u6BB5\u91CD\u5EFA lastState.entities \u540E\u4E0B\u9762\u7684\u903B\u8F91\u4ECD\u6539\u65E7\u6570\u7EC4\uFF0C
        //   \u5BFC\u81F4 server push \u51FA\u53BB\u7684\u4ECD\u7136\u662F\u65E7 11 \u53EA\u91CE\u602A\uFF08dev-host \u6C38\u8FDC\u5728\u7528\u5207\u5173\u524D\u7684\u5F15\u7528\uFF09\u3002
        const ents = lastState.entities;
        // 1. \u955C\u50CF\u73A9\u5BB6\u4F4D\u59FF\uFF08\u524D\u7AEF\u6743\u5A01\uFF09
        const me = ents.find((e) => e.side === "player");
        if (me) {
          const playerInfo = p.player || {};
          if (Number.isFinite(playerInfo.x)) me.x = playerInfo.x;
          if (Number.isFinite(playerInfo.y)) me.y = playerInfo.y;
          if (Number.isFinite(playerInfo.facing)) me.facing = playerInfo.facing;
          me.vx = 0; me.vy = 0;
          // \u81EA\u7136\u56DE\u590D
          if (lastState.tick % 10 === 0) me.mp = Math.min(me.maxMp, (me.mp || 0) + 3);
          if (lastState.tick % 30 === 0) me.hp = Math.min(me.maxHp, me.hp + 1);
        }
      // 2. \u654C\u4EBA AI\uFF08game.md 62-69\uFF09\uFF1A
      //    \u2460 \u4FA6\u6D4B/\u53D1\u8D77\u653B\u51FB\u8DDD\u79BB 4m \u2014\u2014 4m \u5185\u624D\u8FFD\u51FB
      //    \u2461 \u4F24\u5BB3\u5224\u5B9A\uFF1A\u8FD1\u6218 0.5m / \u8FDC\u7A0B 4m
      //    \u2462 \u73A9\u5BB6\u9003\u51FA 4m \u2192 \u91CE\u602A\u505C\u6B62\u8FFD\u51FB\u3001\u8D70\u56DE\u51FA\u751F\u70B9\uFF08\u62F4\u7EF3\uFF09
      const target = me;
      for (const e of ents) {
        if (e.side !== "enemy" || !e.alive || !target || !target.alive) { continue; }
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const d2 = Math.hypot(dx, dy) || 0.001;
        const isRanged = e.isRanged === true;
        const home = e.homeX !== undefined ? e : null;
        // \u2500\u2500 \u62F4\u7EF3\uFF1A\u79BB\u5F00\u51FA\u751F\u70B9 > 4m \u4E14\u73A9\u5BB6\u4E0D\u5728 4m \u653B\u51FB\u5708\u5185 \u2192 \u56DE\u51FA\u751F\u70B9 \u2500\u2500
        const homeD = home ? Math.hypot(e.x - e.homeX, e.y - e.homeY) : 0;
        if (d2 > 4) {
          // \u8131\u6218\uFF1A\u8D70\u5411\u51FA\u751F\u70B9
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
        // \u2500\u2500 4m \u5185\uFF1A\u8FFD\u51FB + \u653B\u51FB \u2500\u2500
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
        // \u4F24\u5BB3\u5224\u5B9A\u8DDD\u79BB\uFF1A\u8FD1\u6218 0.5m / \u8FDC\u7A0B 4m\uFF08game.md 63-64\uFF09
        const attackRange = isRanged ? 4 : 0.5;
        if (d2 < attackRange && e.cooldown <= 0) {
          const dmg = Math.max(1, (e.atk || 5) - (target.def || 0));
          target.hp = Math.max(0, target.hp - dmg);
          target.hitFlashMs = 250;
          lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: target.x, y: target.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
          e.cooldown = 40;
          if (target.hp <= 0) {
            target.alive = false;
            lastState.events.push("[mock] \u73A9\u5BB6\u88AB " + e.name + " \u51FB\u5012");
            lastState.phase = "over";
            lastState.result = { reason: "death", exp: lastState.exp, money: lastState.money, drops: lastState.drops, kills: lastState.kills, survivedTicks: lastState.tick };
          }
        }
      }
      // 3. \u73A9\u5BB6\u81EA\u52A8\u653B\u51FB\uFF08\u6BCF 30 tick\uFF09\uFF1A\u8FD1\u6218 0.5m / \u8FDC\u7A0B 4m\uFF08game.md 63\uFF09
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
          // \u2605 \u9ED8\u8BA4\u653B\u51FB\u7279\u6548\uFF1A\u7EA2\u8272\u706B\u82B1 + \u547D\u4E2D\u7206\u70B8
          if (!lastState.vfx) lastState.vfx = [];
          lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "spark", entityId: closest.id, x: closest.x, y: closest.y, life: 8, total: 8, color: "#ff5a5a" });
          lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "explosion", entityId: closest.id, x: closest.x, y: closest.y, life: 6, total: 6, color: "#ff8c3a" });
          if (closest.hp <= 0) {
            closest.alive = false;
            lastState.kills++;
            lastState.money = (lastState.money || 0) + 3;
            me.exp = (me.exp || 0) + (closest.level || 1) * 5;
            lastState.events.push("[mock] \u51FB\u6740 " + closest.name + " (+" + ((closest.level || 1) * 5) + "exp +3money)");
          }
        }
      }
      // 4. \u76DF\u53CB AI\uFF1A\u8DDF\u968F\u73A9\u5BB6 + \u81EA\u52A8\u653B\u51FB\u6700\u8FD1\u654C\u4EBA\uFF08\u6BCF 30 tick\uFF09
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
              lastState.events.push("[mock] \u76DF\u53CB " + a.name + " \u51FB\u6740 " + target2.name);
            }
          }
        }
      }
      // 5. \u91CE\u602A\u751F\u6210\uFF08game.md 67-69\uFF09\uFF1A\u51FA\u751F\u70B9/\u7B49\u7EA7/\u7C7B\u578B\u6765\u81EA\u5730\u56FE json\uFF08mulberryForest.json
      //    Actors \u5C42\uFF09\uFF0C\u7531\u5BA2\u6237\u7AEF\u5207\u5173\u65F6\u751F\u6210 mapmob_* \u5E76\u7ECF tick.localEnemies \u4E0A\u62A5\u3002
      //    dev-host \u4E0D\u968F\u673A\u5237\u602A\uFF01\u53EA\u505A\u4E24\u4EF6\u4E8B\uFF1A
      //    \u2460 \u6536\u5230 localEnemies \u6E05\u5355\uFF08epoch \u53D8\u5316 = \u5207\u56FE/\u8865\u602A\uFF09\u2192 \u4EE5\u5B83\u4E3A\u51C6\u91CD\u5EFA server \u4FA7\u654C\u602A\u8868
      //    \u2461 \u6B7B\u4EA1\u7684\u5730\u56FE\u602A\u8BB0 respawnAt\uFF1B\u73A9\u5BB6\u79BB\u5F00\u8BE5\u5730\u56FE 30 \u79D2\u540E\u91CD\u65B0\u751F\u6210\uFF08game.md\uFF1A\u79BB\u5F00\u5F53\u524D\u5730\u56FE30\u79D2\u540E\u91CD\u65B0\u751F\u6210\u91CE\u602A\uFF09
      const le = p.localEnemies;
      if (le && Array.isArray(le.list) && le.epoch !== lastState._mobEpoch) {
        console.log("[devHost] \u6536\u5230\u65B0\u6E05\u5355 epoch=" + le.epoch + " list=" + le.list.length + " (\u4E4B\u524D=" + lastState._mobEpoch + ")");
        lastState._mobEpoch = le.epoch;
        // \u4FDD\u7559\u73A9\u5BB6/\u76DF\u53CB\uFF0C\u5220\u9664 server \u4FA7\u5168\u90E8\u654C\u602A\uFF08\u5BA2\u6237\u7AEF\u662F\u6743\u5A01\uFF09
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
            homeX: m.x, homeY: m.y,            // \u2605 \u62F4\u7EF3\u51FA\u751F\u70B9 = \u5730\u56FE json \u7684\u51FA\u751F\u70B9
            mapMob: true,                      // \u2605 \u6807\u8BB0\uFF1A\u5730\u56FE\u602A\uFF08\u79BB\u5F00\u5730\u56FE 30s \u91CD\u751F\uFF09
            _deadAt: m.alive === false ? 0 : undefined,
          });
        }
        lastState.entities = keep;
        lastState.events.push("[mock] \u5730\u56FE\u91CE\u602A\u540C\u6B65\uFF08" + le.list.length + " \u53EA\uFF09");
      }
      // \u5173\u5361\u540D\u8DDF\u8E2A\uFF08\u4EC5\u65E5\u5FD7\u7528\uFF0C\u4E0D\u505A\u5237\u602A\u63A7\u5236\uFF09
      if (currentLevelName !== lastState._mobLevel) {
        lastState._mobLevel = currentLevelName;
      }
      // 6. \u98D8\u5B57/vfx/cd \u8870\u51CF
      lastState.floaters = lastState.floaters.filter((f) => { f.life--; return f.life > 0; });
      if (lastState.vfx) lastState.vfx = lastState.vfx.filter((v) => { v.life--; return v.life > 0; });
      // \u2605 \u6280\u80FD cd \u6BCF tick -1\uFF08castSkill \u65F6 dev-host \u5DF2\u8BBE cdLeft=cd\uFF09
      for (const sk of lastState.skills || []) {
        if (sk.cdLeft && sk.cdLeft > 0) sk.cdLeft = Math.max(0, sk.cdLeft - 1);
      }
      for (const e of ents) {
        if (e.hitFlashMs && e.hitFlashMs > 0) e.hitFlashMs = Math.max(0, e.hitFlashMs - 100);
        if (e.actionBobMs && e.actionBobMs > 0) e.actionBobMs = Math.max(0, e.actionBobMs - 100);
      }
      // 7. \u56DE\u63A8
        post(lastState);
      }, 100);
      return;
    }
    // \u5BA2\u6237\u7AEF\u53D1\u6765 tick\uFF1A\u7F13\u5B58\u5230 pending\uFF0C\u7531\u670D\u52A1\u5668\u5B9A\u65F6\u5668\u81EA\u5DF1\u53D6
    window._devHostPending = d.params || {};
  }
  // \u5904\u7406 skill / item \u7B49\u5176\u4ED6 action
  if (d.type === "tf_plugin_tick" && (d.action === "skill" || d.action === "item" || d.action === "page" || d.action === "exit")) {
    if (!lastState) return;
    // \u2605 exit\uFF1A\u6A21\u62DF entry.js handle_action("exit") \u7684\u7ED3\u7B97\uFF1A
    //   phase=over\uFF0Cresult={reason:"exit", exp, money, drops, kills, survivedTicks}
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
      lastState.events.push("[mock] \u73A9\u5BB6\u4E3B\u52A8\u9000\u51FA\uFF08\u91CE\u5916\u751F\u5B58\u7ED3\u675F\uFF09");
    }
    // \u7B80\u5316\uFF1Askill/item \u76F4\u63A5\u7ED9\u4E2A\u56DE\u5305\uFF08\u540C\u6B65\uFF0C\u4E0D\u8D70 setTimeout\uFF09
    if (d.action === "skill" && d.params) {
      const me2 = lastState.entities.find((e) => e.side === "player");
      const sk = lastState.skills?.[d.params.index];
      if (me2 && sk) {
        if (!lastState.vfx) lastState.vfx = [];
        const id = "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6);
        if (sk.name === "\u51B2\u65A9") {
          lastState.vfx.push({
            id, kind: "slash_arc", entityId: me2.id,
            x: me2.x, y: me2.y,
            facing: me2.facing, life: 12, total: 12,
            color: "#fff", size: 1.6,
          });
        } else if (sk.name === "\u706B\u7403") {
          // \u2605 \u706B\u7403\u76EE\u6807 = \u8303\u56F4\u5185\u6700\u8FD1\u7684\u654C\u4EBA\uFF1B\u6253\u8FC7\u53BB\u4EA7\u751F dmg/\u98D8\u5B57/\u547D\u4E2D\u7279\u6548
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
          // \u2605 \u547D\u4E2D\u4F24\u5BB3\uFF08\u5F39\u4F53\u5230\u8FBE\u540E\uFF09
          if (target) {
            const dmg = Math.max(1, (sk.power || 20) + Math.floor((me2.atk || 30) * 0.5) - (target.def || 0));
            target.hp = Math.max(0, target.hp - dmg);
            target.hitFlashMs = 250;
            lastState.floaters.push({ id: "f" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), text: "-" + dmg, x: target.x, y: target.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
            lastState.vfx.push({ id: "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6), kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
          }
        } else if (sk.name === "\u6CBB\u7597") {
          lastState.vfx.push({
            id, kind: "heal_ring", entityId: me2.id,
            x: me2.x, y: me2.y,
            facing: 0, life: 18, total: 18,
            color: "#7CFFB2", size: 1.0,
          });
        } else if (sk.name === "\u62A4\u76FE") {
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
  // \u2605 item\uFF1A\u78E8\u5200\u77F3/\u5F00\u5C71\u5200/\u66AE\u5149\u4F69\u5251/\u4EEA\u5F0F\u957F\u5251 \u2192 buff \u7ED9\u73A9\u5BB6\uFF08\u547D\u4E2D+atk\uFF09\uFF0C\u914D buff_ring vfx
  if (d.type === "tf_plugin_tick" && d.action === "item") {
    if (!lastState) return;
    const me3 = lastState.entities.find((e) => e.side === "player");
    const it = lastState.items?.[d.params?.index];
    if (me3 && it) {
      if (!lastState.vfx) lastState.vfx = [];
      const id = "vfx_" + lastState.tick + "_" + Math.random().toString(36).slice(2, 6);
      lastState.vfx.push({ id, kind: "buff_ring", entityId: me3.id, x: me3.x, y: me3.y, facing: 0, life: 24, total: 24, color: "#FFCC55", size: 1.0 });
      // \u2605 buff\uFF1A\u4E34\u65F6\u589E\u52A0 atk\uFF0830 tick\uFF09\uFF0C\u53E0\u52A0\u5728 me3.atk
      if (!me3._atkBuffLeftMs) me3._atkBuffLeftMs = 0;
      me3._atkBuffLeftMs = 30;
    }
    post(lastState);
    return;
  }
  // \u2605 revive\uFF1A\u590D\u6D3B\u73A9\u5BB6\uFF08\u534A\u8840\u56DE\u573A\uFF09\uFF0C\u6E05\u7A7A\u5468\u56F4\u654C\u4EBA\u7ED9\u73A9\u5BB6\u5598\u606F\u7A7A\u95F4
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
    lastState.events.push("[mock] \u590D\u6D3B\u6210\u529F\uFF08\u534A\u8840\u56DE\u5F52\uFF09");
    post(lastState);
    log("host\u2192 revive \u2192 phase=playing");
  }
});
</script>
</body>
</html>`;
      server.middlewares.use("/__dev_host", (_req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(PAGE);
      });
      server.middlewares.use("/", (req, res, next) => {
        const u = req.url || "/";
        if (u.includes("__inner=1")) return next();
        if (u !== "/" && !u.startsWith("/?")) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(PAGE);
      });
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const workshopsRoot = resolve(__dirname, "..", "..", "..", "workshops");
  return {
    plugins: [
      vue(),
      viteSingleFile(),
      // 仅在非生产模式注册中间件
      ...mode === "production" ? [] : [storyDataPlugin(workshopsRoot), devHostPlugin(env.CONN ?? "", env.STORY ?? "")]
    ],
    server: {
      port: 3e3,
      // ★ 允许 --conn 拟真宿主桩通过 /@fs/ 动态 import 插件入口 entry.js
      //   （vite 默认只允许 workspace root=vue/ 目录，entry.js 在其上一级）
      fs: {
        allow: [
          resolve(__dirname),
          // vue/
          resolve(__dirname, ".."),
          // plugins/toonflow-field-survival/
          resolve(__dirname, "../../..")
          // toonflow-game-plugins/
        ]
      }
    },
    define: {
      // Vite 默认不注入非 VITE_ 前缀的变量到客户端，这里显式暴露
      __STORY__: JSON.stringify(env.STORY ?? ""),
      __CONN__: JSON.stringify(env.CONN ?? "")
    },
    base: "./",
    build: {
      outDir: "../ui",
      emptyOutDir: true,
      assetsInlineLimit: 100 * 1024 * 1024,
      target: "es2020"
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxVc2Vyc1xcXFx2aWFjb1xcXFx0b29sc1xcXFxUb29uZmxvdy1nYW1lXFxcXHRvb25mbG93LWdhbWUtcGx1Z2luc1xcXFxwbHVnaW5zXFxcXHRvb25mbG93LWZpZWxkLXN1cnZpdmFsXFxcXHZ1ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcVXNlcnNcXFxcdmlhY29cXFxcdG9vbHNcXFxcVG9vbmZsb3ctZ2FtZVxcXFx0b29uZmxvdy1nYW1lLXBsdWdpbnNcXFxccGx1Z2luc1xcXFx0b29uZmxvdy1maWVsZC1zdXJ2aXZhbFxcXFx2dWVcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L1VzZXJzL3ZpYWNvL3Rvb2xzL1Rvb25mbG93LWdhbWUvdG9vbmZsb3ctZ2FtZS1wbHVnaW5zL3BsdWdpbnMvdG9vbmZsb3ctZmllbGQtc3Vydml2YWwvdnVlL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52LCBQbHVnaW4gfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCBodHRwIGZyb20gXCJodHRwXCI7XG4vLyBAdHMtaWdub3JlXG5pbXBvcnQgdnVlIGZyb20gXCJAdml0ZWpzL3BsdWdpbi12dWVcIjtcbmltcG9ydCB7IHZpdGVTaW5nbGVGaWxlIH0gZnJvbSBcInZpdGUtcGx1Z2luLXNpbmdsZWZpbGVcIjtcblxuLy8gXHU4OUUzXHU2NzkwIC4uLy5lbnZcdUZGMDhcdTRFMERcdTU3MjggdnVlLyBcdTVCNTBcdTc2RUVcdTVGNTVcdUZGMDlcdTkxQ0NcdTc2ODQgZ2FtZV9hcHBfc2VydmljZV91cmwgLyBhdXRoX3Rva2VuIC8gc2Vzc2lvbklkXG4vLyBcdTRFMERcdTVGMTVcdTUxNjUgZG90ZW52IFx1NEY5RFx1OEQ1Nlx1RkYwOHZ1ZS9wYWNrYWdlLmpzb24gXHU2Q0ExXHU2NzA5XHVGRjA5XHVGRjBDXHU2MjRCXHU1MTk5XHU0RTAwXHU0RTJBXHU4RjdCXHU5MUNGXHU4OUUzXHU2NzkwXG5mdW5jdGlvbiBsb2FkRG90ZW52TGlnaHQoZW52UGF0aDogc3RyaW5nKTogdm9pZCB7XG4gIGlmICghZXhpc3RzU3luYyhlbnZQYXRoKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZW52UGF0aCwgXCJ1dGYtOFwiKTtcbiAgICBmb3IgKGNvbnN0IHJhdyBvZiBjb250ZW50LnNwbGl0KC9cXHI/XFxuLykpIHtcbiAgICAgIGNvbnN0IGxpbmUgPSByYXcudHJpbSgpO1xuICAgICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aChcIiNcIikpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZXEgPSBsaW5lLmluZGV4T2YoXCI9XCIpO1xuICAgICAgaWYgKGVxIDwgMCkgY29udGludWU7XG4gICAgICBjb25zdCBrID0gbGluZS5zbGljZSgwLCBlcSkudHJpbSgpO1xuICAgICAgbGV0IHYgPSBsaW5lLnNsaWNlKGVxICsgMSkudHJpbSgpO1xuICAgICAgLy8gXHU1M0JCXHU1RjE1XHU1M0Y3XG4gICAgICBpZiAoKHYuc3RhcnRzV2l0aChcIlxcXCJcIikgJiYgdi5lbmRzV2l0aChcIlxcXCJcIikpIHx8ICh2LnN0YXJ0c1dpdGgoXCInXCIpICYmIHYuZW5kc1dpdGgoXCInXCIpKSkge1xuICAgICAgICB2ID0gdi5zbGljZSgxLCAtMSk7XG4gICAgICB9XG4gICAgICBpZiAoIShrIGluIHByb2Nlc3MuZW52KSkgcHJvY2Vzcy5lbnZba10gPSB2O1xuICAgIH1cbiAgfSBjYXRjaCB7fVxufVxuLy8gXHUyNjA1IEVTTSBcdTZBMjFcdTVGMEZcdTRFMEIgX19kaXJuYW1lIFx1NEUwRFx1NTNFRlx1NzUyOFx1RkYwQ1x1NzUyOCBpbXBvcnQubWV0YS51cmwgXHU3Qjk3XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcInVybFwiO1xuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi5cIiwgaW1wb3J0Lm1ldGEudXJsKSk7XG4vLyAuZW52IFx1NTcyOCB0b29uZmxvdy1nYW1lLXBsdWdpbnMvIFx1NjgzOVx1NzZFRVx1NUY1NVx1RkYwOHZ1ZSBcdTIxOTIgdG9vbmZsb3ctZmllbGQtc3Vydml2YWwgXHUyMTkyIHBsdWdpbnMgXHUyMTkyIHRvb25mbG93LWdhbWUtcGx1Z2luc1x1RkYwOVxue1xuICBjb25zdCBlbnZQYXRoID0gcmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vLi4vLi4vLmVudlwiKTtcbiAgbG9hZERvdGVudkxpZ2h0KGVudlBhdGgpO1xufVxuXG4vKiogXHU2NTQ1XHU0RThCXHU3NkVFXHU1RjU1XHU4QkZCXHU1M0Q2XHU0RTJEXHU5NUY0XHU0RUY2XHVGRjFBL3N0b3J5LWRhdGEvPHN0b3J5TmFtZT4vLi4uIFx1MjE5MiBcdThCRkJcdTUzRDZcdTVCRjlcdTVFOTRcdTY1ODdcdTRFRjYgKi9cbmZ1bmN0aW9uIHN0b3J5RGF0YVBsdWdpbih3b3Jrc2hvcHNSb290OiBzdHJpbmcpOiBQbHVnaW4ge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IFwic3RvcnktZGF0YVwiLFxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvc3RvcnktZGF0YVwiLCAocmVxLCByZXMpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSByZXNvbHZlKHdvcmtzaG9wc1Jvb3QsIGRlY29kZVVSSUNvbXBvbmVudChyZXEudXJsIS5yZXBsYWNlKC9eXFwvLywgXCJcIikpKTtcbiAgICAgICAgaWYgKCFmaWxlUGF0aC5zdGFydHNXaXRoKHdvcmtzaG9wc1Jvb3QpKSB7XG4gICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSA0MDM7XG4gICAgICAgICAgcmVzLmVuZChcIkZvcmJpZGRlblwiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gNDA0O1xuICAgICAgICAgIHJlcy5lbmQoXCJOb3QgZm91bmQ6IFwiICsgZmlsZVBhdGgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgsIFwidXRmLThcIik7XG4gICAgICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb25cIik7XG4gICAgICAgICAgcmVzLmVuZChjb250ZW50KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gNTAwO1xuICAgICAgICAgIHJlcy5lbmQoU3RyaW5nKGUpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIGRldi1ob3N0IFx1NEUyRFx1OTVGNFx1NEVGNlx1RkYxQVx1NUY1MyBDT05OPTEgXHU2NUY2XHVGRjBDXHU2M0QwXHU0RjlCXHU0RTAwXHU0RTJBXHU1MTg1XHU1RDRDIGlmcmFtZSArIEpTIFx1NkEyMVx1NjJERlx1NUJCRlx1NEUzQlx1NzY4NCBIVE1MXHUzMDAyXG4gKiAgXHU1MTczXHU5NTJFXHVGRjFBZGV2LWhvc3QgXHU5MDFBXHU4RkM3IC9zdG9yeS1kYXRhLzxzdG9yeU5hbWU+Ly4uLiBcdThCRkJcdTUzRDZcdTc3MUZcdTVCOUUgdGVzdF9zdGF0ZS5qc29uXHVGRjA4XHU1NDhDXHU2M0QyXHU0RUY2XHU2NzJDXHU0RjUzXHU1NDBDXHU0RTAwXHU0RUZEXHU2NTcwXHU2MzZFXHVGRjA5XHUzMDAyXG4gKiAgXHU1OTgyXHU2NzlDIFNUT1JZIFx1NkNBMVx1NEYyMCAvIFx1NjU4N1x1NEVGNlx1NEUwRFx1NUI1OFx1NTcyOCBcdTIxOTIgXHU3NkY0XHU2M0E1XHU2MkE1XHU5NTE5XHVGRjBDXHU4RkRFXHU0RTBEXHU0RTBBXHUzMDAyICovXG5mdW5jdGlvbiBkZXZIb3N0UGx1Z2luKGNvbm46IHN0cmluZywgc3Rvcnk6IHN0cmluZyk6IFBsdWdpbiB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogXCJkZXYtaG9zdFwiLFxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgIGlmICghY29ubiB8fCBjb25uID09PSBcIjBcIiB8fCBjb25uID09PSBcImZhbHNlXCIpIHJldHVybjtcbiAgICAgIGNvbnN0IFNUT1JZID0gc3RvcnkgfHwgXCJcIjtcbiAgICAgIGNvbnN0IFNUT1JZX1JPT1QgPSByZXNvbHZlKF9fZGlybmFtZSwgXCIuLi93b3Jrc2hvcHMvdG9vbmZsb3ctZmllbGQtc3Vydml2YWwvbWFwX2Rlc2lnblwiKTtcbiAgICAgIGNvbnN0IHN0b3J5VXJsID0gU1RPUllcbiAgICAgICAgPyBgL3N0b3J5LWRhdGEvdG9vbmZsb3ctZmllbGQtc3Vydml2YWwvbWFwX2Rlc2lnbi8ke2VuY29kZVVSSUNvbXBvbmVudChTVE9SWSl9L3Rlc3RfZGF0YS90ZXN0X3N0YXRlLmpzb25gXG4gICAgICAgIDogXCJcIjtcbiAgICAgIC8vIFx1MjYwNSBcdTY3MERcdTUyQTFcdTU2NjhcdTRFRTNcdTc0MDZcdUZGMUEvdG9vbi1hcGkvKiBcdTIxOTIge1NFUlZJQ0VfVVJMfS8qXHVGRjA4XHU5MDdGXHU1MTREXHU2RDRGXHU4OUM4XHU1NjY4XHU4REU4XHU1N0RGXHVGRjA5XG4gICAgICAvLyAgIFx1NUU3Nlx1NjI4QSBhdXRoX3Rva2VuIFx1NkNFOFx1NTE2NVx1NTIzMCBBdXRob3JpemF0aW9uIGhlYWRlclxuICAgICAgY29uc3QgU0VSVklDRV9VUkwgPSBwcm9jZXNzLmVudi5nYW1lX2FwcF9zZXJ2aWNlX3VybCB8fCBcImh0dHA6Ly9sb2NhbGhvc3Q6NjAwMDJcIjtcbiAgICAgIGNvbnN0IEFVVEhfVE9LRU4gPSBwcm9jZXNzLmVudi5hdXRoX3Rva2VuIHx8IFwiXCI7XG4gICAgICAvLyBcdTI2MDUgXHU3NzFGXHU1QjlFXHU2M0QyXHU0RUY2XHU1MTY1XHU1M0UzXHU2NTg3XHU0RUY2XHVGRjFBLS1jb25uIFx1NjJERlx1NzcxRlx1NUJCRlx1NEUzQlx1Njg2OVx1NzZGNFx1NjNBNVx1NTJBMFx1OEY3RFx1NUI4M1x1NjI2N1x1ODg0Q1x1RkYwOFx1ODU4NFx1NUJCRlx1NEUzQlx1N0I1Nlx1NzU2NVx1RkYwOVx1MzAwMlxuICAgICAgLy8gICBcdTY4NjlcdTUzRUFcdThEMUZcdThEMjNcdTMwMENcdTdGNTFcdTdFRENcdTRFRTNcdTc0MDYgKyBcdTRGMjBcdTUzQzIgKyBcdTU2REVcdTYzQTggc3RhdGVcdTMwMERcdUZGMENcdTZFMzhcdTYyMEYvXHU3Q0ZCXHU3RURGXHU5NzYyXHU2NzdGXHU1MTY4XHU5MEU4XHU5MDNCXHU4RjkxXHU4RDcwIGVudHJ5LmpzXHVGRjBDXG4gICAgICAvLyAgIFx1NEZERFx1OEJDMSAtLWNvbm4gXHU4QzAzXHU4QkQ1XHU5NEZFXHU4REVGXHU0RTBFXHUzMDBDXHU2M0QyXHU0RUY2XHU1Qjg5XHU4OEM1XHU1NDBFXHUzMDBEXHU5NEZFXHU4REVGXHU4ODRDXHU0RTNBXHU0RTAwXHU4MUY0XHUzMDAyXG4gICAgICBjb25zdCBFTlRSWV9QQVRIID0gcmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vZW50cnkuanNcIik7XG4gICAgICAvLyBcdTkwMUFcdTc1MjhcdTRFRTNcdTc0MDZcdUZGMUEvdG9vbi1hc3NldC88cGF0aD4gXHUyMTkyIHtTRVJWSUNFX1VSTH0vPHBhdGg+XHVGRjA4XHU1NkZFXHU3MjQ3L1x1OTdGM1x1OTg5MVx1N0I0OVx1OTc1OVx1NjAwMVx1OEQ0NFx1NkU5MFx1RkYwOVxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi90b29uLWFzc2V0XCIsIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSAocmVxLnVybCB8fCBcIi9cIikucmVwbGFjZSgvXlxcLy8sIFwiXCIpO1xuICAgICAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICAgICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhyZXEuaGVhZGVycykpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdiA9PT0gXCJzdHJpbmdcIikgaGVhZGVyc1trXSA9IHY7XG4gICAgICAgICAgICBlbHNlIGlmIChBcnJheS5pc0FycmF5KHYpKSBoZWFkZXJzW2tdID0gdi5qb2luKFwiLCBcIik7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChBVVRIX1RPS0VOKSBoZWFkZXJzW1wiYXV0aG9yaXphdGlvblwiXSA9IFwiQmVhcmVyIFwiICsgQVVUSF9UT0tFTjtcbiAgICAgICAgICBjb25zdCBwcm94eVJlcSA9IGh0dHAucmVxdWVzdChcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaG9zdG5hbWU6IG5ldyBVUkwoU0VSVklDRV9VUkwpLmhvc3RuYW1lLFxuICAgICAgICAgICAgICBwb3J0OiBuZXcgVVJMKFNFUlZJQ0VfVVJMKS5wb3J0IHx8IDgwLFxuICAgICAgICAgICAgICBtZXRob2Q6IHJlcS5tZXRob2QsXG4gICAgICAgICAgICAgIHBhdGg6IFwiL1wiICsgdGFyZ2V0UGF0aCxcbiAgICAgICAgICAgICAgaGVhZGVycyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAocHJveHlSZXMpID0+IHtcbiAgICAgICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSBwcm94eVJlcy5zdGF0dXNDb2RlIHx8IDUwMjtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocHJveHlSZXMuaGVhZGVycykpIHtcbiAgICAgICAgICAgICAgICBpZiAodikgcmVzLnNldEhlYWRlcihrLCB2IGFzIGFueSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcHJveHlSZXMucGlwZShyZXMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICApO1xuICAgICAgICAgIHByb3h5UmVxLm9uKFwiZXJyb3JcIiwgKGVycikgPT4geyByZXMuc3RhdHVzQ29kZSA9IDUwMjsgcmVzLmVuZChcInByb3h5IGVycm9yOiBcIiArIGVyci5tZXNzYWdlKTsgfSk7XG4gICAgICAgICAgcmVxLnBpcGUocHJveHlSZXEpO1xuICAgICAgICB9IGNhdGNoIChlKSB7IG5leHQoZSBhcyBhbnkpOyB9XG4gICAgICB9KTtcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoXCIvdG9vbi1hcGlcIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdSA9IG5ldyBVUkwocmVxLnVybCB8fCBcIi9cIiwgU0VSVklDRV9VUkwpO1xuICAgICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSB1LnBhdGhuYW1lICsgdS5zZWFyY2g7XG4gICAgICAgICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgICAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJlcS5oZWFkZXJzKSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiKSBoZWFkZXJzW2tdID0gdjtcbiAgICAgICAgICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodikpIGhlYWRlcnNba10gPSB2LmpvaW4oXCIsIFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gXHU2Q0U4XHU1MTY1IGF1dGggdG9rZW5cbiAgICAgICAgICBpZiAoQVVUSF9UT0tFTikge1xuICAgICAgICAgICAgaGVhZGVyc1tcImF1dGhvcml6YXRpb25cIl0gPSBcIkJlYXJlciBcIiArIEFVVEhfVE9LRU47XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIG5vZGUgZmV0Y2ggaW4gdml0ZSBtaWRkbGV3YXJlOiBcdTc1MjggaHR0cCBtb2R1bGVcbiAgICAgICAgICBjb25zdCBwcm94eVJlcSA9IGh0dHAucmVxdWVzdChcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaG9zdG5hbWU6IG5ldyBVUkwoU0VSVklDRV9VUkwpLmhvc3RuYW1lLFxuICAgICAgICAgICAgICBwb3J0OiBuZXcgVVJMKFNFUlZJQ0VfVVJMKS5wb3J0IHx8IDgwLFxuICAgICAgICAgICAgICBtZXRob2Q6IHJlcS5tZXRob2QsXG4gICAgICAgICAgICAgIHBhdGg6IHRhcmdldFBhdGgsXG4gICAgICAgICAgICAgIGhlYWRlcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgKHByb3h5UmVzKSA9PiB7XG4gICAgICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gcHJveHlSZXMuc3RhdHVzQ29kZSB8fCA1MDI7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHByb3h5UmVzLmhlYWRlcnMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHYpIHJlcy5zZXRIZWFkZXIoaywgdiBhcyBhbnkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHByb3h5UmVzLnBpcGUocmVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKTtcbiAgICAgICAgICBwcm94eVJlcS5vbihcImVycm9yXCIsIChlcnIpID0+IHtcbiAgICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gNTAyO1xuICAgICAgICAgICAgcmVzLmVuZChcInByb3h5IGVycm9yOiBcIiArIGVyci5tZXNzYWdlKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXEucGlwZShwcm94eVJlcSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBuZXh0KGUgYXMgYW55KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCBQQUdFID0gYDwhZG9jdHlwZSBodG1sPlxuPGh0bWwgbGFuZz1cInpoLUNOXCI+XG48aGVhZD5cbjxtZXRhIGNoYXJzZXQ9XCJ1dGYtOFwiPlxuPHRpdGxlPmRldi1ob3N0XHVGRjA4XHU2MkRGXHU3NzFGXHU1QkJGXHU0RTNCXHU2ODY5XHVGRjA5XHUyMDE0ICR7U1RPUlkgfHwgXCIobm8gc3RvcnkpXCJ9PC90aXRsZT5cbjxzdHlsZT5cbiAgYm9keXttYXJnaW46MDtwYWRkaW5nOjA7Zm9udC1mYW1pbHk6c3lzdGVtLXVpLHNhbnMtc2VyaWY7YmFja2dyb3VuZDojMWExYTFhO2NvbG9yOiNlZWV9XG4gICN3cmFwe3Bvc2l0aW9uOmZpeGVkO2luc2V0OjB9XG4gIGlmcmFtZXt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JvcmRlcjowO2Rpc3BsYXk6YmxvY2t9XG4gICNsb2d7cG9zaXRpb246Zml4ZWQ7bGVmdDo4cHg7Ym90dG9tOjhweDtiYWNrZ3JvdW5kOiMwMDBhO3BhZGRpbmc6OHB4IDEycHg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udDoxMnB4IG1vbm9zcGFjZTttYXgtd2lkdGg6NjAlO21heC1oZWlnaHQ6MzB2aDtvdmVyZmxvdzphdXRvO3otaW5kZXg6OTtsaW5lLWhlaWdodDoxLjV9XG4gICNiYWRnZXtwb3NpdGlvbjpmaXhlZDtyaWdodDo4cHg7dG9wOjhweDtiYWNrZ3JvdW5kOiNmMzM7Y29sb3I6I2ZmZjtwYWRkaW5nOjRweCAxMHB4O2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQ6MTJweCBtb25vc3BhY2U7ei1pbmRleDo5O21heC13aWR0aDo2MCU7dGV4dC1hbGlnbjpyaWdodH1cbiAgI2Vycm9ye3Bvc2l0aW9uOmZpeGVkO2luc2V0OjMwcHg7ZGlzcGxheTpub25lO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JhY2tncm91bmQ6IzFhMWExYTtjb2xvcjojZjg4O2ZvbnQ6MTRweCBtb25vc3BhY2U7ei1pbmRleDoxMDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjQwcHg7bGluZS1oZWlnaHQ6Mn1cbjwvc3R5bGU+XG48L2hlYWQ+XG48Ym9keT5cbjxkaXYgaWQ9XCJ3cmFwXCI+PGlmcmFtZSBpZD1cImdhbWVcIiBzcmM9XCIvP19faW5uZXI9MVwiPjwvaWZyYW1lPjwvZGl2PlxuPGRpdiBpZD1cImJhZGdlXCI+ZGV2LWhvc3QgKC0tY29ubiAke1NUT1JZfSk8L2Rpdj5cbjxkaXYgaWQ9XCJlcnJvclwiPjwvZGl2PlxuPGRpdiBpZD1cImxvZ1wiPjwvZGl2PlxuPHNjcmlwdD5cbmNvbnN0IFNUT1JZID0gJHtKU09OLnN0cmluZ2lmeShTVE9SWSl9O1xuY29uc3QgU1RPUllfVVJMID0gJHtKU09OLnN0cmluZ2lmeShzdG9yeVVybCl9O1xuY29uc3QgU0VSVklDRV9VUkwgPSAke0pTT04uc3RyaW5naWZ5KFNFUlZJQ0VfVVJMKX07XG4vLyBcdTI2MDUgXHU2Q0U4XHU1MTY1IGF1dGggdG9rZW5cdUZGMDhcdTRFQ0UgLi4vLmVudiBcdThCRkJcdUZGMDlcdUZGMENcdTZENEZcdTg5QzhcdTU2NjggZmV0Y2ggL3Rvb24tYXBpIFx1NjVGNlx1ODFFQVx1NTJBOFx1NUUyNlx1NEUwQVxuY29uc3QgQVVUSF9UT0tFTiA9ICR7SlNPTi5zdHJpbmdpZnkoQVVUSF9UT0tFTil9O1xuLy8gXHUyNjA1IFx1NzcxRlx1NUI5RVx1NjNEMlx1NEVGNlx1NTE2NVx1NTNFM1x1RkYwOFx1N0VERFx1NUJGOVx1OERFRlx1NUY4NFx1RkYwOVx1MjAxNFx1MjAxNFx1Njg2OVx1OTAxQVx1OEZDNyB2aXRlIC9AZnMgXHU1MkE4XHU2MDAxIGltcG9ydCBcdTVCODNcdUZGMENcdTYyNjdcdTg4NENcdTRFMEVcdTVCODlcdTg4QzVcdTU0MEVcdTRFMDBcdTgxRjRcdTc2ODRcdTkwM0JcdThGOTFcbmNvbnN0IEVOVFJZX1BBVEggPSAke0pTT04uc3RyaW5naWZ5KEVOVFJZX1BBVEgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIikpfTtcbndpbmRvdy5fX0FVVEhfVE9LRU5fXyA9IEFVVEhfVE9LRU47XG53aW5kb3cuX19TRVJWSUNFX1VSTF9fID0gU0VSVklDRV9VUkw7XG5sZXQgbGFzdFN0YXRlID0gbnVsbDtcbmxldCBzdG9yeURhdGEgPSBudWxsO1xuLy8gXHUyNjA1IFx1NUY1M1x1NTI0RFx1NTE3M1x1NTM2MVx1NTQwRFx1RkYwOFx1NzUzMVx1NUJBMlx1NjIzN1x1N0FFRlx1NkJDRlx1NUUyNyB0aWNrIFx1NEUwQVx1NjJBNVx1RkYxQm51bGwgPSBcdTY3MkFcdTc3RTUgXHUyMTkyIFx1OUVEOFx1OEJBNCBSVUlOUyBcdTRFMERcdTVCODlcdTUxNjhcdUZGMENcdTg5QzEgY3VycmVudFRoZW1lXHVGRjA5XG5sZXQgY3VycmVudExldmVsTmFtZSA9IG51bGw7XG4vLyBcdTI2MDUgXHU1OTE2XHU5MEU4XHU1M0VGXHU4QzAzXHU3NTI4XHU3Njg0IHN0YXRlIFx1NEZFRVx1NjUzOVx1NTY2OFx1RkYwOGJzayBldmFsdWF0ZSAvIGJyb3dzZXIgY29uc29sZSBcdTc2RjRcdTYzQTVcdThDMDNcdTc1MjhcdUZGMDlcbi8vIFx1NzUyOFx1NkNENVx1NzkzQVx1NEY4Qlx1RkYxQXdpbmRvdy5fX2Rldkhvc3RNb2RpZnkoeyBocDogOTk5LCBleHA6IDUwMDAsIGxldmVsOiAyMCB9KVxud2luZG93Ll9fZGV2SG9zdE1vZGlmeSA9IChwYXRjaCkgPT4ge1xuICBpZiAoIWxhc3RTdGF0ZSB8fCAhbGFzdFN0YXRlLmVudGl0aWVzKSByZXR1cm4gXCJubyBzdGF0ZVwiO1xuICBsZXQgYXBwbGllZCA9IDA7XG4gIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHBhdGNoKSkge1xuICAgIGNvbnN0IGVudCA9IGxhc3RTdGF0ZS5lbnRpdGllcy5maW5kKGUgPT4gZS5zaWRlID09PSBcInBsYXllclwiKTtcbiAgICBpZiAoZW50ICYmIGsgaW4gZW50KSB7IGVudFtrXSA9IHY7IGFwcGxpZWQrKzsgfVxuICB9XG4gIHJldHVybiBcImFwcGxpZWQgXCIgKyBhcHBsaWVkICsgXCIgdG8gcGxheWVyXCI7XG59O1xuLy8gXHUyNjA1IFx1NTkxNlx1OTBFOFx1NTNFRlx1OEMwM1x1NzUyOFx1NzY4NCBzdGF0ZSBcdTYzQTJcdTk0ODhcdUZGMUFcdThGRDRcdTU2REVcdTczQTlcdTVCQjYvXHU2NTRDXHU2MDJBXHU2NDU4XHU4OTgxXHVGRjA4YnNrIGV2YWx1YXRlIFx1NzUyOFx1RkYwOVxud2luZG93Ll9fZGV2SG9zdFN0YXRlID0gKCkgPT4ge1xuICBpZiAoIWxhc3RTdGF0ZSkgcmV0dXJuIHsgZXJyb3I6IFwibm8gc3RhdGVcIiB9O1xuICBjb25zdCBlbmVtaWVzID0gKGxhc3RTdGF0ZS5lbnRpdGllcyB8fCBbXSkuZmlsdGVyKGUgPT4gZS5zaWRlID09PSBcImVuZW15XCIpO1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBsYXN0U3RhdGUucGhhc2UsXG4gICAgdGljazogbGFzdFN0YXRlLnRpY2ssXG4gICAgbW9iTGV2ZWw6IGxhc3RTdGF0ZS5fbW9iTGV2ZWwsXG4gICAgbW9iRXBvY2g6IGxhc3RTdGF0ZS5fbW9iRXBvY2gsXG4gICAgdG90YWxFbnRpdGllczogKGxhc3RTdGF0ZS5lbnRpdGllcyB8fCBbXSkubGVuZ3RoLFxuICAgIGVuZW15Q291bnQ6IGVuZW1pZXMubGVuZ3RoLFxuICAgIGVuZW1pZXM6IGVuZW1pZXMuc2xpY2UoMCwgMjApLm1hcChlID0+ICh7IGlkOiBlLmlkLCBuYW1lOiBlLm5hbWUsIGxldmVsOiBlLmxldmVsLCBocDogZS5ocCwgYWxpdmU6IGUuYWxpdmUsIHg6IGUueCwgeTogZS55IH0pKSxcbiAgfTtcbn07XG4vLyBcdTI2MDUgZGV2LWhvc3QgXHU2QTIxXHU1RjBGXHU0RTBCXHVGRjBDXHU2QTIxXHU2MkRGIHRfcGx1Z2luX3Nlc3Npb25fZGF0YVx1RkYwOHJlYWwgaG9zdCBcdTRFMERcdTU3MjhcdUZGMENzdGFuZGFsb25lIFx1NUZDNVx1OTg3Qlx1ODFFQVx1NURGMVx1NUU5NFx1N0I1NFx1RkYwOVxuLy8gICBcdTY1NzBcdTYzNkVcdTVCNTggd2luZG93Ll9fZGV2SG9zdFBsdWdpbkRhdGFcdUZGMENcdThERThcdTc1MjhcdTYyMzcvXHU4REU4XHU0RjFBXHU4QkREXHU1MTcxXHU0RUFCIChzZXNzaW9uSWQ9XCJhbGxcIilcbndpbmRvdy5fX2Rldkhvc3RQbHVnaW5EYXRhID0gbmV3IE1hcCgpO1xud2luZG93Ll9fZGV2SG9zdFBsdWdpbkxpc3RlbmVycyA9IG5ldyBTZXQoKTtcbndpbmRvdy5fX2Rldkhvc3RQbHVnaW5FbWl0ID0gKGtleSkgPT4ge1xuICBmb3IgKGNvbnN0IGNiIG9mIHdpbmRvdy5fX2Rldkhvc3RQbHVnaW5MaXN0ZW5lcnMpIHtcbiAgICB0cnkgeyBjYihrZXkpOyB9IGNhdGNoIChlKSB7IGNvbnNvbGUud2FybihcIltkZXZIb3N0XSBsaXN0ZW5lciBlcnJcIiwgZSk7IH1cbiAgfVxufTtcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCAoZSkgPT4ge1xuICBjb25zdCBkID0gZT8uZGF0YTtcbiAgaWYgKCFkIHx8IGQudHlwZSAhPT0gXCJ0Zl9wbHVnaW5fZGF0YVwiKSByZXR1cm47XG4gIGNvbnN0IHsgcmVxSWQsIG9wLCBkYXRhS2V5LCB2YWx1ZSwgcGx1Z2luSWQsIHNlc3Npb25JZCwgc3RvcnkgfSA9IGQ7XG4gIGNvbnN0IGsgPSBKU09OLnN0cmluZ2lmeSh7IHA6IHBsdWdpbklkLCBzOiBzZXNzaW9uSWQgfHwgXCJhbGxcIiwgazogZGF0YUtleSB8fCBcIlwiIH0pO1xuICBsZXQgcmVzdWx0ID0gbnVsbDtcbiAgaWYgKG9wID09PSBcImdldFwiKSB7XG4gICAgY29uc3QgdiA9IHdpbmRvdy5fX3BkR2V0KGspO1xuICAgIHJlc3VsdCA9IHsgZGF0YUtleSwgdmFsdWU6IHYgPyB2LnZhbHVlIDogbnVsbCwgdXBkYXRlZEF0OiB2ID8gdi51cGRhdGVkQXQgOiAwIH07XG4gIH0gZWxzZSBpZiAob3AgPT09IFwic2V0XCIpIHtcbiAgICB3aW5kb3cuX19wZFNldChrLCB2YWx1ZSk7XG4gICAgcmVzdWx0ID0geyBkYXRhS2V5LCB2YWx1ZTogbnVsbCwgb2s6IHRydWUgfTtcbiAgfSBlbHNlIGlmIChvcCA9PT0gXCJsaXN0XCIpIHtcbiAgICBjb25zdCBrZXlzID0gW107XG4gICAgZm9yIChjb25zdCBrZXkgb2Ygd2luZG93Ll9fZGV2SG9zdFBsdWdpbkRhdGEua2V5cygpKSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGtleSk7XG4gICAgICBpZiAocGFyc2VkLnAgPT09IHBsdWdpbklkICYmIHBhcnNlZC5zID09PSAoc2Vzc2lvbklkIHx8IFwiYWxsXCIpKSBrZXlzLnB1c2gocGFyc2VkLmspO1xuICAgIH1cbiAgICByZXN1bHQgPSB7IGtleXMsIGRhdGFLZXk6IFwiXCIsIHZhbHVlOiBudWxsIH07XG4gIH0gZWxzZSBpZiAob3AgPT09IFwicmVtb3ZlXCIpIHtcbiAgICB3aW5kb3cuX19wZFJlbW92ZShrKTtcbiAgICByZXN1bHQgPSB7IGRhdGFLZXksIHZhbHVlOiBudWxsLCBvazogdHJ1ZSB9O1xuICB9XG4gIGlmIChyZXN1bHQpIHtcbiAgICAvLyBcdTI2MDUgXHU1NkRFXHU1MzA1XHU4OTgxXHU1M0QxXHU1MjMwIGdhbWUgaWZyYW1lXHVGRjA4XHU0RTBEXHU2NjJGIGRldi1ob3N0IFx1OTg3Nlx1NUM0Mlx1NjcyQ1x1OEVBQlx1NzY4NCBwYXJlbnRcdUZGMDlcbiAgICBjb25zdCBnYW1lV2luID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJnYW1lXCIpPy5jb250ZW50V2luZG93O1xuICAgIChnYW1lV2luIHx8IHdpbmRvdy5wYXJlbnQpLnBvc3RNZXNzYWdlKHsgdHlwZTogXCJ0Zl9wbHVnaW5fZGF0YV9yZXN1bHRcIiwgcmVxSWQsIG9rOiB0cnVlLCAuLi5yZXN1bHQgfSwgXCIqXCIpO1xuICB9XG59KTtcbmNvbnN0IGxvZyA9IChtKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJsb2dcIik7IGVsLnRleHRDb250ZW50ID0gbSArIFwiXFxcXG5cIiArIGVsLnRleHRDb250ZW50LnNsaWNlKDAsIDQwMDApOyB9O1xuY29uc3QgcG9zdCA9IChzdGF0ZSwgcmVzcG9uc2UpID0+IHtcbiAgaWYgKHN0YXRlICYmIHR5cGVvZiBzdGF0ZSA9PT0gXCJvYmplY3RcIikgc3RhdGUucmVzcG9uc2UgPSByZXNwb25zZSB8fCBcIlwiO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImdhbWVcIikuY29udGVudFdpbmRvdy5wb3N0TWVzc2FnZSh7IHR5cGU6IFwidGZfcGx1Z2luX3N0YXRlXCIsIHN0YXRlLCBhY3Rpb25zOiBbXCJpbml0XCIsXCJzdGFydFwiLFwidGlja1wiLFwic2tpbGxcIixcIml0ZW1cIixcInBhZ2VcIixcImV4aXRcIixcInJldml2ZVwiLFwic3lzXCIsXCJzeXNfc2VsbFwiLFwic3lzX3VzZV9pdGVtXCIsXCJzeXNfc29ydFwiLFwic3lzX3JpbmdfbW92ZVwiLFwic3lzX3VzZV9za2lsbFwiLFwic3lzX3Nob3BfcmVmcmVzaFwiLFwic3lzX3Nob3BfYnV5XCIsXCJzeXNfcGFydHlcIixcInN5c190ZWxlcG9ydFwiLFwic3lzX3RyYXZlbFwiXSwgcmVzcG9uc2U6IHJlc3BvbnNlIHx8IFwiXCIgfSwgXCIqXCIpO1xufTtcblxuLyogPT09PT09PT09PT09PT09PT0gXHU3NzFGXHU1QjlFXHU2M0QyXHU0RUY2IGVudHJ5LmpzIFx1NjI2N1x1ODg0Q1x1NTY2OFx1RkYwOFx1ODU4NFx1NUJCRlx1NEUzQlx1RkYwOSA9PT09PT09PT09PT09PT09PVxuICogXHU2ODY5XHU0RTBEXHU1MThEXHU4MUVBXHU1REYxXHU2QTIxXHU2MkRGXHU2RTM4XHU2MjBGXHU5MDNCXHU4RjkxXHVGRjFBbG9hZFN0b3J5RGF0YSgpIFx1NjJGRlx1NTIzMFx1NjcwRFx1NTJBMVx1NTY2OFx1NTNDMlx1NjU3MFx1NTM2MVx1NTQwRVx1RkYwQ1xuICogXHU2MjQwXHU2NzA5IGFjdGlvblx1RkYwOGluaXQvc3RhcnQvdGljay9za2lsbC9pdGVtL3BhZ2UvZXhpdC9yZXZpdmUvc3lzKlx1RkYwOVx1OTBGRFx1OEY2Q1x1NEVBNCBlbnRyeS5qc1x1RkYwQ1xuICogXHU0RTBFXHUzMDBDXHU2M0QyXHU0RUY2XHU1Qjg5XHU4OEM1XHU1NDBFXHUzMDBEXHU3NTMxXHU1QkJGXHU0RTNCIFBsdWdpbkV4ZWN1dG9yIFx1NjI2N1x1ODg0Q1x1NzY4NFx1OERFRlx1NUY4NFx1NEUwMFx1ODFGNFx1MzAwMlxuICogcGx1Z2luRGF0YVx1RkYwOHRfcGx1Z2luX3Nlc3Npb25fZGF0YSBcdTc2ODRcdTZBMjFcdTYyREZcdUZGMDlcdTRFMEVcdTUyNERcdTdBRUYgU0RLIFx1NzY4NCB0Zl9wbHVnaW5fZGF0YSBcdThCRjdcdTZDNDJcdTUxNzFcdTc1MjhcdTU0MENcdTRFMDBcdTRFRkRcdTVCNThcdTUwQThcdTMwMDJcbiAqL1xubGV0IGVudHJ5TW9kID0gbnVsbDtcbmxldCBlbnRyeUN0eCA9IG51bGw7XG5sZXQgZW50cnlTdGF0ZSA9IG51bGw7XG5sZXQgZW50cnlCcm9rZW4gPSBmYWxzZTtcbndpbmRvdy5fX2Rldkhvc3RQbHVnaW5TdGF0ZSA9ICgpID0+IChlbnRyeVN0YXRlID8geyBwaGFzZTogZW50cnlTdGF0ZS5waGFzZSwgdGljazogZW50cnlTdGF0ZS50aWNrLCBjYXJkOiBlbnRyeVN0YXRlLnBsYXllckNhcmQsIGJhZzogKGVudHJ5U3RhdGUucGxheWVyQ2FyZCB8fCB7fSkuaXRlbXMsIHJpbmc6IGVudHJ5U3RhdGUucmluZyB9IDogbnVsbCk7XG5cbi8vIFx1NjNEMlx1NEVGNlx1NEYxQVx1OEJERFx1NjU3MFx1NjM2RVx1RkYwOFx1NkEyMVx1NjJERiB0X3BsdWdpbl9zZXNzaW9uX2RhdGFcdUZGMDlcdUZGMUFcdTUxODVcdTVCNTggTWFwICsgbG9jYWxTdG9yYWdlIFx1NTNDQ1x1NTE5OVx1RkYwQ1x1NTIzN1x1NjVCMFx1NEUwRFx1NEUyMlxuY29uc3QgX19QRF9QUkVGSVggPSBcImRldmhvc3RfcGRfdjFfXCI7XG53aW5kb3cuX19wZEtleSA9IChwbHVnaW5JZCwgc2Vzc2lvbklkLCBkYXRhS2V5KSA9PiBKU09OLnN0cmluZ2lmeSh7IHA6IHBsdWdpbklkIHx8IFwiXCIsIHM6IHNlc3Npb25JZCB8fCBcImFsbFwiLCBrOiBkYXRhS2V5IHx8IFwiXCIgfSk7XG53aW5kb3cuX19wZEdldCA9IChrKSA9PiB7XG4gIGlmICh3aW5kb3cuX19kZXZIb3N0UGx1Z2luRGF0YS5oYXMoaykpIHJldHVybiB3aW5kb3cuX19kZXZIb3N0UGx1Z2luRGF0YS5nZXQoayk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmF3ID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oX19QRF9QUkVGSVggKyBrKTtcbiAgICBpZiAocmF3KSB7IGNvbnN0IHJlYyA9IEpTT04ucGFyc2UocmF3KTsgd2luZG93Ll9fZGV2SG9zdFBsdWdpbkRhdGEuc2V0KGssIHJlYyk7IHJldHVybiByZWM7IH1cbiAgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gIHJldHVybiBudWxsO1xufTtcbndpbmRvdy5fX3BkU2V0ID0gKGssIHZhbHVlKSA9PiB7XG4gIGNvbnN0IHJlYyA9IHsgdmFsdWUsIHVwZGF0ZWRBdDogRGF0ZS5ub3coKSB9O1xuICB3aW5kb3cuX19kZXZIb3N0UGx1Z2luRGF0YS5zZXQoaywgcmVjKTtcbiAgdHJ5IHsgbG9jYWxTdG9yYWdlLnNldEl0ZW0oX19QRF9QUkVGSVggKyBrLCBKU09OLnN0cmluZ2lmeShyZWMpKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gIHdpbmRvdy5fX2Rldkhvc3RQbHVnaW5FbWl0KEpTT04ucGFyc2Uoaykuayk7XG4gIHJldHVybiByZWM7XG59O1xud2luZG93Ll9fcGRSZW1vdmUgPSAoaykgPT4ge1xuICB3aW5kb3cuX19kZXZIb3N0UGx1Z2luRGF0YS5kZWxldGUoayk7XG4gIHRyeSB7IGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKF9fUERfUFJFRklYICsgayk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICB3aW5kb3cuX19kZXZIb3N0UGx1Z2luRW1pdChKU09OLnBhcnNlKGspLmspO1xufTtcblxuY29uc3QgRU5UUllfUExVR0lOX0lEID0gXCJjb20udG9vbmZsb3cubWluaWdhbWUtZmllbGQtc3Vydml2YWxcIjtcbmZ1bmN0aW9uIGJ1aWxkRW50cnlDdHgoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9ICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiICYmIHdpbmRvdy5fX1NUT1JZX1NFU1NJT05fSURfXykgfHwgXCJhbGxcIjtcbiAgZW50cnlDdHggPSB7XG4gICAgcGx1Z2luSWQ6IEVOVFJZX1BMVUdJTl9JRCxcbiAgICB1c2VySWQ6IDEsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGVzOiAoc3RvcnlEYXRhICYmIHN0b3J5RGF0YS5yb2xlcykgfHwgW10sXG4gICAgcGxheWVyQ2FyZDogKHdpbmRvdy5fX1NUT1JZX1BMQVlFUl9DQVJEX18gfHwge30pLFxuICAgIHdvcmxkQm9va0RpZ2VzdDogXCJcIixcbiAgICB0c0FwaToge1xuICAgICAgcGx1Z2luRGF0YToge1xuICAgICAgICBnZXQ6IGFzeW5jIChrKSA9PiB7IGNvbnN0IHJlYyA9IHdpbmRvdy5fX3BkR2V0KHdpbmRvdy5fX3BkS2V5KEVOVFJZX1BMVUdJTl9JRCwgc2Vzc2lvbklkLCBrKSk7IHJldHVybiByZWMgPyByZWMudmFsdWUgOiBudWxsOyB9LFxuICAgICAgICBzZXQ6IGFzeW5jIChrLCB2KSA9PiB7IHdpbmRvdy5fX3BkU2V0KHdpbmRvdy5fX3BkS2V5KEVOVFJZX1BMVUdJTl9JRCwgc2Vzc2lvbklkLCBrKSwgdik7IHJldHVybiBudWxsOyB9LFxuICAgICAgICByZW1vdmU6IGFzeW5jIChrKSA9PiB7IHdpbmRvdy5fX3BkUmVtb3ZlKHdpbmRvdy5fX3BkS2V5KEVOVFJZX1BMVUdJTl9JRCwgc2Vzc2lvbklkLCBrKSk7IHJldHVybiBudWxsOyB9LFxuICAgICAgICBsaXN0OiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgb3V0ID0gW107XG4gICAgICAgICAgZm9yIChjb25zdCBrZXkgb2Ygd2luZG93Ll9fZGV2SG9zdFBsdWdpbkRhdGEua2V5cygpKSB7XG4gICAgICAgICAgICB0cnkgeyBjb25zdCBwID0gSlNPTi5wYXJzZShrZXkpOyBpZiAocC5wID09PSBFTlRSWV9QTFVHSU5fSUQgJiYgcC5zID09PSBzZXNzaW9uSWQpIG91dC5wdXNoKHAuayk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gb3V0O1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIC8vIDMwMDEgXHU2ODY5XHU2Q0ExXHU2NzA5XHU2M0QyXHU0RUY2IGFnZW50IFx1OTAxQVx1OTA1M1x1RkYwOFx1NzcxRlx1NUI5RVx1NUJCRlx1NEUzQlx1OEQ3MCBydW5QbHVnaW5BZ2VudFx1RkYwOVx1RkYxQVxuICAgICAgLy8gXHU2MjlCXHU5NTE5XHU4QkE5IGVudHJ5LmpzIFx1ODQzRFx1NTIzMFx1NTE4NVx1N0Y2RVx1NTE1Q1x1NUU5NVx1RkYwOFx1NTczMFx1NTZGRSBmYWxsYmFja01hcCAvIFx1NTU0Nlx1NTdDRSBCVUlMVElOX1NIT1BfR09PRFNcdUZGMDlcdUZGMENcbiAgICAgIC8vIFx1NUU3Nlx1NTcyOFx1NEU4Qlx1NEVGNlx1OTFDQ1x1NjNEMFx1NzkzQVx1MzAwQ1x1OTY0RFx1N0VBN1x1MzAwRFx1MzAwMlx1NUI4OVx1ODhDNVx1NTQwRVx1OTRGRVx1OERFRlx1NEYxQVx1OEQ3MFx1NzcxRlx1NUI5RSBhZ2VudFx1MzAwMlxuICAgICAgYWdlbnQ6IHtcbiAgICAgICAgcnVuOiBhc3luYyAoYWdlbnROYW1lKSA9PiB7XG4gICAgICAgICAgbG9nKFwiXHUyNkEwIGVudHJ5LmFnZW50LnJ1bihcIiArIGFnZW50TmFtZSArIFwiKSBcdTU3MjggZGV2LWhvc3QgXHU2ODY5XHU0RTBEXHU1M0VGXHU3NTI4IFx1MjE5MiBcdTRGN0ZcdTc1MjhcdTUxODVcdTdGNkVcdTUxNUNcdTVFOTVcIik7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZGV2LWhvc3QgXHU2ODY5XHU2NUUwXHU2M0QyXHU0RUY2IGFnZW50IFx1OTAxQVx1OTA1M1wiKTtcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbiAgcmV0dXJuIGVudHJ5Q3R4O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkRW50cnlNb2R1bGUoKSB7XG4gIGlmIChlbnRyeU1vZCkgcmV0dXJuIGVudHJ5TW9kO1xuICBjb25zdCB1cmwgPSBcIi9AZnMvXCIgKyBFTlRSWV9QQVRIO1xuICBjb25zdCBtb2QgPSBhd2FpdCBpbXBvcnQoLyogQHZpdGUtaWdub3JlICovIHVybCk7XG4gIGlmICghbW9kIHx8IHR5cGVvZiBtb2QuaGFuZGxlX2FjdGlvbiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJlbnRyeS5qcyBcdTY3MkFcdTVCRkNcdTUxRkEgaGFuZGxlX2FjdGlvblwiKTtcbiAgZW50cnlNb2QgPSBtb2Q7XG4gIGxvZyhcIlx1MjcxMyBcdTVERjJcdTUyQTBcdThGN0RcdTc3MUZcdTVCOUVcdTYzRDJcdTRFRjZcdTUxNjVcdTUzRTMgZW50cnkuanNcdUZGMDhcdTg1ODRcdTVCQkZcdTRFM0JcdTZBMjFcdTVGMEZcdUZGMDlcIik7XG4gIHJldHVybiBtb2Q7XG59XG5cbi8qKiBcdTYyOEEgYWN0aW9uIFx1NEVBNFx1N0VEOSBlbnRyeS5qcyBcdTYyNjdcdTg4NENcdUZGMUJcdTYyMTBcdTUyOUZcdThGRDRcdTU2REUgdHJ1ZVx1RkYwQ1x1NTkzMVx1OEQyNVx1RkYwOFx1NTNFQVx1NjJBNVx1NEUwMFx1NkIyMVx1RkYwOVx1OEZENFx1NTZERSBmYWxzZSBcdTRFQTRcdTdFRDlcdTY1RTdcdTkwM0JcdThGOTFcdTUxNUNcdTVFOTUgKi9cbmFzeW5jIGZ1bmN0aW9uIHRyeUVudHJ5QWN0aW9uKGFjdGlvbiwgcGFyYW1zKSB7XG4gIGlmIChlbnRyeUJyb2tlbikgcmV0dXJuIGZhbHNlO1xuICB0cnkge1xuICAgIGNvbnN0IG1vZCA9IGF3YWl0IGxvYWRFbnRyeU1vZHVsZSgpO1xuICAgIGlmICghZW50cnlDdHgpIGJ1aWxkRW50cnlDdHgoKTtcbiAgICBpZiAoIWVudHJ5U3RhdGUgJiYgYWN0aW9uICE9PSBcImluaXRcIiAmJiBhY3Rpb24gIT09IFwic3RhcnRfaW5pdFwiICYmIGFjdGlvbiAhPT0gXCJzdGFydFwiKSB7XG4gICAgICBhd2FpdCBtb2QuaGFuZGxlX2FjdGlvbihcImluaXRcIiwge30sIG51bGwsIGVudHJ5Q3R4KTtcbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgbW9kLmhhbmRsZV9hY3Rpb24oYWN0aW9uLCBwYXJhbXMgfHwge30sIGVudHJ5U3RhdGUsIGVudHJ5Q3R4KTtcbiAgICBpZiAoIXJlcyB8fCAhcmVzLnN0YXRlKSByZXR1cm4gZmFsc2U7XG4gICAgZW50cnlTdGF0ZSA9IHJlcy5zdGF0ZTtcbiAgICAvLyBcdTUzQ0RcdTU0MTFcdTU0MENcdTZCNjVcdTUzQzJcdTY1NzBcdTUzNjFcdUZGMUFlbnRyeSBcdTUxODVcdTkwRTggcGF0Y2hDYXJkIFx1NjUzOVx1OEZDN1x1NzY4NCBjYXJkIFx1ODk4MVx1NjIxMFx1NEUzQVx1NTQwRVx1N0VFRCB0aWNrIFx1NzY4NCBjdHggXHU2NzY1XHU2RTkwXHVGRjBDXG4gICAgLy8gXHU1NDI2XHU1MjE5XHU0RTBCXHU0RTAwXHU0RTJBIHRpY2sgXHU3Njg0IHN5bmNDYXJkRnJvbUNvbnRleHQgXHU0RjFBXHU3NTI4XHU2NUU3IGNhcmQgXHU4OTg2XHU3NkQ2XHVGRjA4XHU1MzU2XHU1MUZBL1x1OEQyRFx1NEU3MFx1N0VEM1x1Njc5Q1x1NEUyMlx1NTkzMVx1RkYwOVxuICAgIGlmIChlbnRyeVN0YXRlLnBsYXllckNhcmQpIGVudHJ5Q3R4LnBsYXllckNhcmQgPSBlbnRyeVN0YXRlLnBsYXllckNhcmQ7XG4gICAgbGFzdFN0YXRlID0gZW50cnlTdGF0ZTtcbiAgICBwb3N0KGVudHJ5U3RhdGUsIHJlcy5yZXNwb25zZSB8fCBcIlwiKTtcbiAgICBsb2coXCJlbnRyeVx1MjE5MiBcIiArIGFjdGlvbiArIFwiIG9rXCIgKyAocmVzLnJlc3BvbnNlID8gXCIgLyBcIiArIHJlcy5yZXNwb25zZSA6IFwiXCIpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgZW50cnlCcm9rZW4gPSB0cnVlO1xuICAgIGxvZyhcIiEgZW50cnkuanMgXHU2MjY3XHU4ODRDXHU1OTMxXHU4RDI1XHVGRjBDXHU1NkRFXHU5MDAwXHU2ODY5XHU1MTg1XHU2NzJDXHU1NzMwXHU2QTIxXHU2MkRGXHVGRjFBXCIgKyAoZXJyICYmIGVyci5tZXNzYWdlID8gZXJyLm1lc3NhZ2UgOiBlcnIpKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyogXHU0RTMyXHU4ODRDXHU5NjFGXHU1MjE3XHVGRjFBXHU3NzFGXHU1QkJGXHU0RTNCXHU2NjJGXHU0RTMyXHU4ODRDXHU1OTA0XHU3NDA2IGFjdGlvbiBcdTc2ODRcdUZGMENcdTY4NjlcdThGRDlcdTkxQ0NcdTRFNUZcdTVGQzVcdTk4N0JcdTRFMzJcdTg4NENcdUZGMENcbiAgIFx1NTQyNlx1NTIxOVx1MzAwQ1x1NkJDRlx1NUUyNyB0aWNrICsgXHU1RTc2XHU1M0QxXHU3Njg0IHN5c18qIFx1NjRDRFx1NEY1Q1x1MzAwRFx1NEYxQVx1NUU3Nlx1NTNEMVx1NTE5OSBlbnRyeVN0YXRlIFx1OTAyMFx1NjIxMFx1NzJCNlx1NjAwMVx1NEU5Mlx1NzZGOFx1ODk4Nlx1NzZENlx1MzAwMlxuICAgdGljayBcdTc5RUZcdTUzOEJcdTY1RjZcdTc2RjRcdTYzQTVcdTRFMjJcdTVGMDNcdUZGMDhcdTRFMEJcdTRFMDBcdTVFMjdcdThGRDhcdTRGMUFcdTUxOERcdTY3NjVcdUZGMDlcdUZGMENcdTkwN0ZcdTUxNERcdTk2MUZcdTUyMTdcdThEOEFcdTZFREFcdThEOEFcdTk1N0ZcdTMwMDIgKi9cbmxldCBlbnRyeUNoYWluID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5sZXQgZW50cnlUaWNrUGVuZGluZyA9IGZhbHNlO1xuZnVuY3Rpb24gcXVldWVFbnRyeUFjdGlvbihhY3Rpb24sIHBhcmFtcykge1xuICBpZiAoYWN0aW9uID09PSBcInRpY2tcIikge1xuICAgIGlmIChlbnRyeVRpY2tQZW5kaW5nKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRydWUpO1xuICAgIGVudHJ5VGlja1BlbmRpbmcgPSB0cnVlO1xuICB9XG4gIGNvbnN0IHJ1biA9ICgpID0+IHRyeUVudHJ5QWN0aW9uKGFjdGlvbiwgcGFyYW1zKS5maW5hbGx5KCgpID0+IHtcbiAgICBpZiAoYWN0aW9uID09PSBcInRpY2tcIikgZW50cnlUaWNrUGVuZGluZyA9IGZhbHNlO1xuICB9KTtcbiAgY29uc3QgcCA9IGVudHJ5Q2hhaW4udGhlbihydW4sIHJ1bik7XG4gIGVudHJ5Q2hhaW4gPSBwLmNhdGNoKCgpID0+IHt9KTtcbiAgcmV0dXJuIHA7XG59XG5jb25zdCBzaG93RXJyb3IgPSAobXNnKSA9PiB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJlcnJvclwiKTtcbiAgZWwudGV4dENvbnRlbnQgPSBtc2c7XG4gIGVsLnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJ3cmFwXCIpLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgbG9nKFwiRVJST1I6IFwiICsgbXNnKTtcbn07XG5cbi8vIFx1NTQyRlx1NTJBOFx1NjVGNlx1NjJDOVx1NjcwRFx1NTJBMVx1NTY2OCBzdG9yeSBydW50aW1lIHN0YXRlXHUzMDAyXHU2RDQxXHU3QTBCXHVGRjFBXG4vLyAgIDEpIFx1NEVDRVx1NjcyQ1x1NTczMCB3b3Jrc2hvcHMvLi4uLyR7U1RPUll9L3N0b3J5Lmpzb24gXHU4QkZCIHNlc3Npb25JZC93b3JsZElkXHVGRjA4NCBcdTVCNTdcdTZCQjVcdUZGMENcdTRFMERcdTdFQ0ZcdTVFMzhcdTUzRDhcdUZGMDlcbi8vICAgMikgXHU3NTI4IHNlc3Npb25JZCBcdThDMDMgUE9TVCB7U0VSVklDRV9VUkx9L2dhbWUvc3RvcnlJbmZvXHVGRjA4XHU5MDFBXHU4RkM3IC90b29uLWFwaSBcdThENzAgdml0ZSBcdTRFRTNcdTc0MDZcdUZGMENcdTkwN0ZcdTUxNEQgQ09SU1x1RkYwOVxuLy8gICAzKSBcdTYyOEEgc2VydmVyIHJlc3BvbnNlLnN0YXRlLnBsYXllciArIC5ucGNzIFx1OEY2Q1x1NEUzQSB0ZXN0X3N0YXRlLmpzb24gXHU3Njg0IHJvbGVzIFx1NjU3MFx1N0VDNFx1NjgzQ1x1NUYwRlxuLy8gICA0KSBcdTU5MzFcdThEMjVcdTU2REVcdTkwMDBcdTUyMzBcdTY3MkNcdTU3MzAgdGVzdF9zdGF0ZS5qc29uXHVGRjA4XHU0RTBEXHU2MjUzXHU2NUFEXHU1RjAwXHU1M0QxXHVGRjA5XG5hc3luYyBmdW5jdGlvbiBsb2FkU3RvcnlEYXRhKCkge1xuICBpZiAoIVNUT1JZKSB7XG4gICAgc2hvd0Vycm9yKFwiXHU2NzJBXHU2MzA3XHU1QjlBIFNUT1JZXHVGRjFBXFxcXG5ucG0gcnVuIGRlYnVnIC0tIC0tc3Rvcnk9XHU0RjYwXHU3Njg0XHU2NTQ1XHU0RThCXHU1NDBEIC0tY29ublwiKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gMSkgXHU4QkZCXHU2NzJDXHU1NzMwIHN0b3J5Lmpzb24gXHU2MkZGIHNlc3Npb25JZC93b3JsZElkXG4gIGxldCBzZXNzaW9uSWQgPSBcIlwiO1xuICBsZXQgd29ybGRJZCA9IDA7XG4gIHRyeSB7XG4gICAgLy8gXHU2RDRGXHU4OUM4XHU1NjY4XHU5MUNDXHU2Q0ExIG5vZGUgXHU3Njg0IHJlc29sdmUvZXhpc3RzU3luYy9yZWFkRmlsZVN5bmNcdUZGMENcdTc1MjggZmV0Y2ggXHU4RDcwIHZpdGUgXHU5NzU5XHU2MDAxXHU2NzBEXHU1MkExXG4gICAgY29uc3Qgc3RvcnlNZXRhVXJsID0gXCIvc3RvcnktZGF0YS90b29uZmxvdy1maWVsZC1zdXJ2aXZhbC9tYXBfZGVzaWduL1wiICsgZW5jb2RlVVJJQ29tcG9uZW50KFNUT1JZKSArIFwiL3N0b3J5Lmpzb25cIjtcbiAgICBjb25zdCBtZXRhUiA9IGF3YWl0IGZldGNoKHN0b3J5TWV0YVVybCk7XG4gICAgaWYgKG1ldGFSLm9rKSB7XG4gICAgICBjb25zdCBtZXRhID0gYXdhaXQgbWV0YVIuanNvbigpO1xuICAgICAgc2Vzc2lvbklkID0gU3RyaW5nKG1ldGEuc2Vzc2lvbklkIHx8IFwiXCIpO1xuICAgICAgd29ybGRJZCA9IE51bWJlcihtZXRhLndvcmxkSWQgfHwgMCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZyhcIiEgc3RvcnkuanNvbiBIVFRQIFwiICsgbWV0YVIuc3RhdHVzICsgXCIgXHUyMTkyIGZhbGxiYWNrIGxvY2FsXCIpO1xuICAgICAgcmV0dXJuIGF3YWl0IGxvYWRTdG9yeUZyb21Mb2NhbCgpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZyhcIiEgcmVhZCBzdG9yeS5qc29uIGZhaWxlZDogXCIgKyBlLm1lc3NhZ2UgKyBcIiBcdTIxOTIgZmFsbGJhY2sgbG9jYWxcIik7XG4gICAgcmV0dXJuIGF3YWl0IGxvYWRTdG9yeUZyb21Mb2NhbCgpO1xuICB9XG4gIGlmICghc2Vzc2lvbklkKSB7XG4gICAgbG9nKFwiISBzdG9yeS5qc29uIFx1N0YzQSBzZXNzaW9uSWQgXHUyMTkyIGZhbGxiYWNrIGxvY2FsXCIpO1xuICAgIHJldHVybiBhd2FpdCBsb2FkU3RvcnlGcm9tTG9jYWwoKTtcbiAgfVxuLy8gMikgXHU4QzAzXHU2NzBEXHU1MkExXHU1NjY4XHVGRjA4XHU5MDFBXHU4RkM3IC90b29uLWFwaSBcdTRFRTNcdTc0MDZcdUZGMDlcbiAgdHJ5IHtcbiAgICBjb25zdCBoZWFkZXJzID0geyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9O1xuICAgIC8vIGRldi1ob3N0IFx1OTg3NVx1OTc2MiBmZXRjaCBcdTY1RjZcdTc2RjRcdTYzQTVcdTVFMjYgdG9rZW5cdUZGMDh2aXRlLmNvbmZpZy50cyBcdTZDRThcdTUxNjVcdTRFODYgd2luZG93Ll9fQVVUSF9UT0tFTl9fXHVGRjA5XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgJiYgd2luZG93Ll9fQVVUSF9UT0tFTl9fKSB7XG4gICAgICBoZWFkZXJzW1wiQXV0aG9yaXphdGlvblwiXSA9IFwiQmVhcmVyIFwiICsgd2luZG93Ll9fQVVUSF9UT0tFTl9fO1xuICAgIH1cbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goXCIvdG9vbi1hcGkvZ2FtZS9zdG9yeUluZm9cIiwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnMsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHNlc3Npb25JZCB9KSxcbiAgICB9KTtcbiAgICBpZiAoIXIub2spIHtcbiAgICAgIGxvZyhcIiEgc2VydmVyIHN0b3J5SW5mbyBIVFRQIFwiICsgci5zdGF0dXMgKyBcIiBcdTIxOTIgZmFsbGJhY2sgbG9jYWxcIik7XG4gICAgICByZXR1cm4gYXdhaXQgbG9hZFN0b3J5RnJvbUxvY2FsKCk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByLmpzb24oKTtcbiAgICBpZiAocmVzcD8uY29kZSAhPT0gMjAwIHx8ICFyZXNwPy5kYXRhKSB7XG4gICAgICBsb2coXCIhIHNlcnZlciByZXNwb25zZSBpbnZhbGlkIChjb2RlPVwiICsgcmVzcD8uY29kZSArIFwiKSBcdTIxOTIgZmFsbGJhY2sgbG9jYWxcIik7XG4gICAgICByZXR1cm4gYXdhaXQgbG9hZFN0b3J5RnJvbUxvY2FsKCk7XG4gICAgfVxuICAgIGNvbnN0IHNydkRhdGEgPSByZXNwLmRhdGE7XG4gICAgY29uc3Qgc3J2U3RhdGUgPSBzcnZEYXRhLnN0YXRlIHx8IHt9O1xuICAgIC8vIDMpIFx1OEY2Q1x1NjM2Mlx1RkYxQXN0YXRlLnBsYXllciArIHN0YXRlLm5wY3MgXHUyMTkyIHJvbGVzW11cbiAgICAvLyAgICBcdTI2MDUgXHU1M0MyXHU2NTcwXHU1MzYxXHVGRjA4cGFyYW1ldGVyQ2FyZEpzb25cdUZGMDlcdTVGQzVcdTk4N0JcdTVCOENcdTY1NzRcdTVFMjZcdTUxRkFcdUZGMUFlbnRyeS5qcyBcdTc1MjhcdTVCODNcdTY3ODRcdTVFRkFcdTgwQ0NcdTUzMDUvXHU2MjgwXHU4MEZEL1x1N0I0OVx1N0VBN1x1RkYwQ1xuICAgIC8vICAgICAgXHU1MjREXHU3QUVGXHU3Q0ZCXHU3RURGXHU5NzYyXHU2NzdGXHU3NkY0XHU2M0E1XHU4QkZCIHN0YXRlLnBsYXllckNhcmQgXHUyMTkyIFx1NEUwRVx1NjcwRFx1NTJBMVx1NTY2OFx1NjU3MFx1NjM2RVx1NEUwMFx1ODFGNFx1MzAwMlxuICAgIGNvbnN0IHJvbGVzID0gW107XG4gICAgY29uc3QgbnVtT3IgPSAodiwgZCkgPT4geyBjb25zdCBuID0gTnVtYmVyKHYpOyByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IGQ7IH07XG4gICAgLy8gXHU4OUQyXHU4MjcyXHU1NzI4XHU1NzMwXHU1NkZFXHU0RTBBXHU3Njg0XHU0RjREXHU3RjZFXHVGRjA4XHU4OUQyXHU4MjcyXHU1MzYxXHUzMDBDXHU0RjIwXHU5MDAxXHU1MjMwXHUzMDBEXHU3NTI4XHVGRjA5XHVGRjFBXHU1MTdDXHU1QkI5XHU1OTFBXHU3OUNEXHU1QjU3XHU2QkI1XHU1NDdEXHU1NDBEXG4gICAgY29uc3QgcG9zT2YgPSAobikgPT4ge1xuICAgICAgY29uc3QgcCA9IG4ucG9zaXRpb24gfHwgbi5wb3MgfHwge307XG4gICAgICByZXR1cm4ge1xuICAgICAgICBtYXBOYW1lOiBuLm1hcE5hbWUgfHwgbi5tYXAgfHwgbi5sZXZlbE5hbWUgfHwgbi5zY2VuZU5hbWUgfHwgcC5tYXBOYW1lIHx8IFwiXCIsXG4gICAgICAgIHg6IG51bU9yKG4ueCA/PyBwLngsIDApLFxuICAgICAgICB5OiBudW1PcihuLnkgPz8gcC55LCAwKSxcbiAgICAgIH07XG4gICAgfTtcbiAgICBpZiAoc3J2U3RhdGUucGxheWVyKSB7XG4gICAgICBjb25zdCBwID0gc3J2U3RhdGUucGxheWVyO1xuICAgICAgY29uc3QgY2FyZCA9IHAucGFyYW1ldGVyQ2FyZEpzb24gfHwgcC5wYXJhbWV0ZXJfY2FyZF9qc29uIHx8IHt9O1xuICAgICAgd2luZG93Ll9fU1RPUllfUExBWUVSX0NBUkRfXyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoY2FyZCkpO1xuICAgICAgY29uc3QgbHYgPSBudW1PcihjYXJkLmxldmVsLCBwLmF0dHJpYnV0ZXM/LmN1bHRpdmF0aW9uSW5zaWdodCB8fCAxKTtcbiAgICAgIGNvbnN0IHBvcyA9IHBvc09mKHApO1xuICAgICAgcm9sZXMucHVzaCh7XG4gICAgICAgIGlkOiBwLmlkIHx8IFwicGxheWVyXCIsXG4gICAgICAgIG5hbWU6IHAubmFtZSB8fCBcIlx1NzNBOVx1NUJCNlwiLFxuICAgICAgICByb2xlVHlwZTogcC5yb2xlVHlwZSB8fCBcInBsYXllclwiLFxuICAgICAgICAvLyBcdTI2MDUgc2VydmVyIGF2YXRhclBhdGggXCIvMS8uLi5cIiBcdTY1MzlcdTUxOTlcdTUyMzAgL3Rvb24tYXNzZXQvMS8uLi4gXHU4RDcwIHZpdGUgXHU0RUUzXHU3NDA2XG4gICAgICAgIGF2YXRhclBhdGg6IChwLmF2YXRhclBhdGggJiYgcC5hdmF0YXJQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSA/IFwiL3Rvb24tYXNzZXRcIiArIHAuYXZhdGFyUGF0aCA6IChwLmF2YXRhclBhdGggfHwgXCJcIiksXG4gICAgICAgIGRlc2NyaXB0aW9uOiBwLmRlc2NyaXB0aW9uIHx8IFwiXCIsXG4gICAgICAgIGluaXRpYWxfbGV2ZWw6IGx2LFxuICAgICAgICBsZXZlbDogbHYsXG4gICAgICAgIGhwOiBudW1PcihjYXJkLmhwLCAxMDApLFxuICAgICAgICBtYXhIcDogbnVtT3IoY2FyZC5ocCwgMTAwKSxcbiAgICAgICAgbXA6IG51bU9yKGNhcmQubXAsIDApLFxuICAgICAgICBleHA6IG51bU9yKGNhcmQuZXhwLCAwKSxcbiAgICAgICAgc2tpbGxzOiBBcnJheS5pc0FycmF5KGNhcmQuc2tpbGxzKSA/IGNhcmQuc2tpbGxzIDogW10sXG4gICAgICAgIGl0ZW1zOiBBcnJheS5pc0FycmF5KGNhcmQuaXRlbXMpID8gY2FyZC5pdGVtcyA6IFtdLFxuICAgICAgICBwYXJhbWV0ZXJDYXJkSnNvbjogY2FyZCxcbiAgICAgICAgbWFwTmFtZTogcG9zLm1hcE5hbWUsXG4gICAgICAgIHg6IHBvcy54LFxuICAgICAgICB5OiBwb3MueSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFtucGNJZCwgbnBjXSBvZiBPYmplY3QuZW50cmllcyhzcnZTdGF0ZS5ucGNzIHx8IHt9KSkge1xuICAgICAgY29uc3QgbiA9IG5wYztcbiAgICAgIGNvbnN0IGNhcmQgPSBuLnBhcmFtZXRlckNhcmRKc29uIHx8IG4ucGFyYW1ldGVyX2NhcmRfanNvbiB8fCB7fTtcbiAgICAgIGNvbnN0IGx2ID0gbnVtT3IoY2FyZC5sZXZlbCwgbi5pbml0aWFsX2xldmVsIHx8IDEpO1xuICAgICAgY29uc3QgcG9zID0gcG9zT2Yobik7XG4gICAgICByb2xlcy5wdXNoKHtcbiAgICAgICAgaWQ6IG4uaWQgfHwgbnBjSWQsXG4gICAgICAgIG5hbWU6IG4ubmFtZSB8fCBucGNJZCxcbiAgICAgICAgcm9sZVR5cGU6IG4ucm9sZVR5cGUgfHwgXCJucGNcIixcbiAgICAgICAgYXZhdGFyUGF0aDogKG4uYXZhdGFyUGF0aCAmJiBuLmF2YXRhclBhdGguc3RhcnRzV2l0aChcIi9cIikpID8gXCIvdG9vbi1hc3NldFwiICsgbi5hdmF0YXJQYXRoIDogKG4uYXZhdGFyUGF0aCB8fCBcIlwiKSxcbiAgICAgICAgZGVzY3JpcHRpb246IG4uZGVzY3JpcHRpb24gfHwgXCJcIixcbiAgICAgICAgaW5pdGlhbF9sZXZlbDogbHYsXG4gICAgICAgIGxldmVsOiBsdixcbiAgICAgICAgaHA6IG51bU9yKGNhcmQuaHAsIDEwMCksXG4gICAgICAgIG1heEhwOiBudW1PcihjYXJkLmhwLCAxMDApLFxuICAgICAgICBtcDogbnVtT3IoY2FyZC5tcCwgMCksXG4gICAgICAgIGV4cDogbnVtT3IoY2FyZC5leHAsIDApLFxuICAgICAgICBza2lsbHM6IEFycmF5LmlzQXJyYXkoY2FyZC5za2lsbHMpID8gY2FyZC5za2lsbHMgOiBbXSxcbiAgICAgICAgaXRlbXM6IEFycmF5LmlzQXJyYXkoY2FyZC5pdGVtcykgPyBjYXJkLml0ZW1zIDogW10sXG4gICAgICAgIHBhcmFtZXRlckNhcmRKc29uOiBjYXJkLFxuICAgICAgICBtYXBOYW1lOiBwb3MubWFwTmFtZSxcbiAgICAgICAgeDogcG9zLngsXG4gICAgICAgIHk6IHBvcy55LFxuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIG1hdGVyaWFscyBcdTUzNjBcdTRGNERcdUZGMUFcdTc1Mjggc2VydmVyIGludmVudG9yeSBcdThGNkNcdTYyMTAgbWF0ZXJpYWxzIFx1NjgzQ1x1NUYwRlx1RkYwOGRldi1ob3N0IFx1NTQwRVx1N0VFRFx1OEY2QyBpdGVtc1x1RkYwOVxuICAgIGNvbnN0IG1hdGVyaWFscyA9IChzcnZTdGF0ZS5pbnZlbnRvcnkgfHwgW10pLm1hcCgoaXQsIGlkeCkgPT4gKHtcbiAgICAgIG5hbWU6IGl0Lm5hbWUgfHwgKFwiXHU3MjY5XHU1NEMxXCIgKyAoaWR4ICsgMSkpLFxuICAgICAgY291bnQ6IDEsXG4gICAgICBlZmZlY3RUeXBlOiBcImhlYWxfaHBcIixcbiAgICAgIHN0YXRzOiB7IGhlYWw6IDAgfSxcbiAgICB9KSk7XG4gICAgc3RvcnlEYXRhID0ge1xuICAgICAgZGVzY3JpcHRpb246IHNydkRhdGEuY2hhcHRlclRpdGxlIHx8IFNUT1JZLFxuICAgICAgd29ybGQ6IHsgbmFtZTogc3J2RGF0YS53b3JsZD8ubmFtZSB8fCBTVE9SWSB9LFxuICAgICAgcm9sZXMsXG4gICAgICBtb25zdGVyczogW10sXG4gICAgICBtYXRlcmlhbHMsXG4gICAgfTtcbiAgICAvLyBcdTI2MDUgXHU2MjhBIHNlc3Npb25JZCBcdTY2QjRcdTk3MzJcdTdFRDkgZ2FtZSBpZnJhbWVcdUZGMDhcdTdDRkJcdTdFREZcdTk3NjJcdTY3N0ZcdTRFNzAvXHU1MzU2XHU3MjY5XHU1NEMxXHU4OTgxXHU1M0QxXHU4QkY3XHU2QzQyXHU1MjMwXHU2NzBEXHU1MkExXHU1NjY4XHVGRjA5XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIpIHdpbmRvdy5fX1NUT1JZX1NFU1NJT05fSURfXyA9IHNlc3Npb25JZDtcbiAgICBsb2coXCJcdTI3MTMgbG9hZGVkIHN0b3J5IGZyb20gc2VydmVyOiBcIiArIFNUT1JZICsgXCIgKHJvbGVzOiBcIiArIHJvbGVzLmxlbmd0aCArIFwiLCBtYXRlcmlhbHM6IFwiICsgbWF0ZXJpYWxzLmxlbmd0aCArIFwiLCBzZXNzaW9uOiBcIiArIHNlc3Npb25JZCArIFwiKVwiKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZyhcIiEgc2VydmVyIGZldGNoIGZhaWxlZDogXCIgKyBlLm1lc3NhZ2UgKyBcIiBcdTIxOTIgZmFsbGJhY2sgbG9jYWxcIik7XG4gICAgcmV0dXJuIGF3YWl0IGxvYWRTdG9yeUZyb21Mb2NhbCgpO1xuICB9XG59XG5cbi8vIFx1NTZERVx1OTAwMFx1RkYxQVx1OEJGQlx1NjcyQ1x1NTczMCB0ZXN0X3N0YXRlLmpzb25cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTdG9yeUZyb21Mb2NhbCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goU1RPUllfVVJMKTtcbiAgICBpZiAoIXIub2spIHtcbiAgICAgIHNob3dFcnJvcihcIlx1NjVFMFx1NkNENVx1OEJGQlx1NTNENiBzdG9yeSBcdTY1NzBcdTYzNkVcdUZGMUFcIiArIFNUT1JZX1VSTCArIFwiXFxcXG5IVFRQIFwiICsgci5zdGF0dXMgKyBcIlxcXFxuXHU4QkY3XHU3ODZFXHU4QkE0IC0tc3RvcnkgXHU1NDBEXHU3OUYwXHU2QjYzXHU3ODZFXCIpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBzdG9yeURhdGEgPSBhd2FpdCByLmpzb24oKTtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikgd2luZG93Ll9fU1RPUllfU0VTU0lPTl9JRF9fID0gXCJcIjtcbiAgICBsb2coXCJcdTI3MTMgbG9hZGVkIHN0b3J5IChsb2NhbCBmYWxsYmFjayk6IFwiICsgU1RPUlkgKyBcIiAocm9sZXM6IFwiICsgKHN0b3J5RGF0YS5yb2xlcz8ubGVuZ3RoIHx8IDApICsgXCIsIG1vbnN0ZXJzOiBcIiArIChzdG9yeURhdGEubW9uc3RlcnM/Lmxlbmd0aCB8fCAwKSArIFwiLCBtYXRlcmlhbHM6IFwiICsgKHN0b3J5RGF0YS5tYXRlcmlhbHM/Lmxlbmd0aCB8fCAwKSArIFwiKVwiKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHNob3dFcnJvcihcIlx1OEJGQlx1NTNENiBzdG9yeSBcdTU5MzFcdThEMjVcdUZGMUFcIiArIGUubWVzc2FnZSArIFwiXFxcXG5cIiArIFNUT1JZX1VSTCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vIFx1MjYwNSBlbnRpdHlfdHlwZXMuanNvblx1RkYwOFJvdHRlbi1Tb3VwIFx1NjAyQVx1NzI2OVx1Njc0M1x1NUEwMVx1NjU3MFx1NjM2RVx1RkYwQ1x1NjMwOSB0aGVtZSBcdTUyQTBcdTY3NDNcdTUyMzdcdTYwMkFcdUZGMDlcbmxldCBlbnRpdHlUeXBlcyA9IG51bGw7XG5hc3luYyBmdW5jdGlvbiBsb2FkRW50aXR5VHlwZXMoKSB7XG4gIGNvbnN0IHVybHMgPSBbXCIvZW50aXR5X3R5cGVzLmpzb25cIiwgXCIuL2VudGl0eV90eXBlcy5qc29uXCIsIFwiLi4vZW50aXR5X3R5cGVzLmpzb25cIl07XG4gIGZvciAoY29uc3QgdSBvZiB1cmxzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1KTtcbiAgICAgIGlmIChyLm9rKSB7XG4gICAgICAgIGVudGl0eVR5cGVzID0gYXdhaXQgci5qc29uKCk7XG4gICAgICAgIGxvZyhcIlx1MjcxMyBsb2FkZWQgZW50aXR5X3R5cGVzLmpzb24gKGVuZW1pZXM6IFwiICsgKGVudGl0eVR5cGVzLmVuZW1pZXM/Lmxlbmd0aCB8fCAwKSArXG4gICAgICAgICAgICBcIiwgdGhlbWVzOiBcIiArIE9iamVjdC5rZXlzKGVudGl0eVR5cGVzLmR1bmdlb25fdGhlbWVzIHx8IHt9KS5sZW5ndGggKyBcIilcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHsgLyogdHJ5IG5leHQgKi8gfVxuICB9XG4gIGxvZyhcIlx1MjZBMCBlbnRpdHlfdHlwZXMuanNvbiBub3QgZm91bmQsIGZhbGxpbmcgYmFjayB0byBzdG9yeSBtb25zdGVyc1wiKTtcbn1cblxuLy8gXHU1RjUzXHU1MjREXHU1MTczXHU1MzYxIFx1MjE5MiBkdW5nZW9uIHRoZW1lIFx1NjYyMFx1NUMwNFx1RkYwOFx1NEUwRSBtb2NrSG9zdC9tYXBDb25maWcuVEhFTUVfQllfTUFQTkFNRSBcdTVCRjlcdTlGNTBcdUZGMDlcbmNvbnN0IFRIRU1FX0JZX01BUE5BTUUgPSB7XG4gIFwiTXVsYmVycnkgVG93blwiOiBudWxsLFxuICBcIk11bGJlcnJ5IEZvcmVzdFwiOiBcIlJVSU5TXCIsXG4gIFwiTXVsYmVycnkgR3JhdmV5YXJkXCI6IFwiQ0FUQUNPTUJTXCIsXG4gIFwiTGljaCBMYWlyXCI6IFwiQ0FUQUNPTUJTXCIsXG4gIFwiTG9vdCBHb2JsaW4gTGFpclwiOiBcIlJVSU5TXCIsXG4gIFwiTXVsYmVycnkgRHVuZ2VvblwiOiBcIlJVSU5TXCIsIFwiTXVsYmVycnkgRHVuZ2VvbiAyXCI6IFwiUlVJTlNcIiwgXCJNdWxiZXJyeSBEdW5nZW9uIDNcIjogXCJSVUlOU1wiLFxuICBcIk11bGJlcnJ5IER1bmdlb24gNFwiOiBcIlJVSU5TXCIsIFwiTXVsYmVycnkgRHVuZ2VvbiA1XCI6IFwiUlVJTlNcIixcbiAgXCJGb3Jlc3QgRHVuZ2VvblwiOiBcIlJVSU5TXCIsIFwiRm9yZXN0IER1bmdlb24gMlwiOiBcIlJVSU5TXCIsIFwiRm9yZXN0IER1bmdlb24gM1wiOiBcIlJVSU5TXCIsXG4gIFwiRm9yZXN0IER1bmdlb24gNFwiOiBcIlJVSU5TXCIsIFwiRm9yZXN0IER1bmdlb24gNVwiOiBcIlJVSU5TXCIsXG4gIFwiS2luZ2RvbVwiOiBudWxsLFxuICBcIkxpY2ggQm9zc1wiOiBcIkNBVEFDT01CU1wiLFxufTtcbmZ1bmN0aW9uIGN1cnJlbnRUaGVtZShsZXZlbE5hbWUpIHtcbiAgaWYgKCFsZXZlbE5hbWUpIHJldHVybiBcIlJVSU5TXCI7XG4gIGlmIChUSEVNRV9CWV9NQVBOQU1FW2xldmVsTmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIFRIRU1FX0JZX01BUE5BTUVbbGV2ZWxOYW1lXTtcbiAgaWYgKC9ncmF2ZXlhcmR8bGljaHxjcnlwdHxjYXRhY29tYnx0b21iL2kudGVzdChsZXZlbE5hbWUpKSByZXR1cm4gXCJDQVRBQ09NQlNcIjtcbiAgaWYgKC9taW5lfGNhdmUvaS50ZXN0KGxldmVsTmFtZSkpIHJldHVybiBcIk1JTkVcIjtcbiAgaWYgKC9pY2V8ZnJvc3R8c25vdy9pLnRlc3QobGV2ZWxOYW1lKSkgcmV0dXJuIFwiSUNFXCI7XG4gIHJldHVybiBcIlJVSU5TXCI7XG59XG5cbi8vIFx1NjMwOSB0aGVtZSBcdTY3NDNcdTkxQ0RcdTRFQ0UgZW50aXR5X3R5cGVzIFx1NjJCRFx1NEUwMFx1NEUyQVx1NjU0Q1x1NEVCQVxuZnVuY3Rpb24gcGlja01vbnN0ZXJCeVdlaWdodCh0aGVtZSkge1xuICBpZiAoIWVudGl0eVR5cGVzIHx8ICF0aGVtZSB8fCAhZW50aXR5VHlwZXMuZHVuZ2Vvbl90aGVtZXMpIHJldHVybiBudWxsO1xuICBjb25zdCB0ID0gZW50aXR5VHlwZXMuZHVuZ2Vvbl90aGVtZXNbdGhlbWVdO1xuICBpZiAoIXQgfHwgdC5fZGVwcmVjYXRlZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRpc3QgPSB0Lm1vYl9kaXN0cmlidXRpb24gfHwge307XG4gIGNvbnN0IHRvdGFsID0gT2JqZWN0LnZhbHVlcyhkaXN0KS5yZWR1Y2UoKGEsIGIpID0+IGEgKyAodHlwZW9mIGIgPT09IFwibnVtYmVyXCIgPyBiIDogMCksIDApO1xuICBpZiAodG90YWwgPD0gMCkgcmV0dXJuIG51bGw7XG4gIGxldCByID0gTWF0aC5yYW5kb20oKSAqIHRvdGFsO1xuICBmb3IgKGNvbnN0IFt0eXBlLCB3XSBvZiBPYmplY3QuZW50cmllcyhkaXN0KSkge1xuICAgIHIgLT0gdztcbiAgICBpZiAociA8PSAwKSByZXR1cm4gZW50aXR5VHlwZXMuZW5lbWllcy5maW5kKChlKSA9PiBlLmVudGl0eV90eXBlID09PSB0eXBlKVxuICAgICAgfHwgZW50aXR5VHlwZXMuc3BlY2lhbF9lbmVtaWVzPy5maW5kKChlKSA9PiBlLmVudGl0eV90eXBlID09PSB0eXBlKSB8fCBudWxsO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBcdTYyOEEgdGVzdF9zdGF0ZS5qc29uIFx1NzY4NCBtYXRlcmlhbHMgXHU2NjIwXHU1QzA0XHU2MjEwIEl0ZW1TbG90XG5mdW5jdGlvbiBtYXRlcmlhbHNUb0l0ZW1zKG1hdGVyaWFscykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkobWF0ZXJpYWxzKSkgcmV0dXJuIFtdO1xuICByZXR1cm4gbWF0ZXJpYWxzLm1hcCgobSkgPT4ge1xuICAgIGxldCBzbG90VHlwZSA9IFwidXRpbGl0eVwiO1xuICAgIGlmIChtLmVmZmVjdFR5cGUgPT09IFwiaGVhbF9ocFwiKSBzbG90VHlwZSA9IFwiaHBcIjtcbiAgICBlbHNlIGlmIChtLmVmZmVjdFR5cGUgPT09IFwiaGVhbF9tcFwiIHx8IG0uZWZmZWN0VHlwZSA9PT0gXCJoZWFsX3NwXCIpIHNsb3RUeXBlID0gXCJtcFwiO1xuICAgIGVsc2UgaWYgKG0uZWZmZWN0VHlwZSA9PT0gXCJhdHRhY2tcIikgc2xvdFR5cGUgPSBcImF0a1wiO1xuICAgIGVsc2UgaWYgKG0uZWZmZWN0VHlwZSA9PT0gXCJidWZmXCIgfHwgbS5lZmZlY3RUeXBlID09PSBcImRlZmVuc2VcIikgc2xvdFR5cGUgPSBcImJ1ZmZcIjtcbiAgICBjb25zdCBoZWFsID0gKG0uc3RhdHMgJiYgdHlwZW9mIG0uc3RhdHMuaGVhbCA9PT0gXCJudW1iZXJcIikgPyBtLnN0YXRzLmhlYWwgOiAwO1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiBtLm5hbWUsXG4gICAgICBjb3VudDogbS5jb3VudCA/PyAxLFxuICAgICAgaGVhbDogKG0uZWZmZWN0VHlwZSA9PT0gXCJoZWFsX21wXCIgfHwgbS5lZmZlY3RUeXBlID09PSBcImhlYWxfc3BcIikgPyAwIDogaGVhbCxcbiAgICAgIG1wOiAgICAobS5lZmZlY3RUeXBlID09PSBcImhlYWxfbXBcIiB8fCBtLmVmZmVjdFR5cGUgPT09IFwiaGVhbF9zcFwiKSA/IGhlYWwgOiAwLFxuICAgICAgdHlwZTogc2xvdFR5cGUsXG4gICAgICBtYXRJZDogbS5tYXRJZCxcbiAgICAgIG1hdFR5cGU6IG0udHlwZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBtLmRlc2NyaXB0aW9uLFxuICAgICAgcHJpY2VCbGFjazogbS5wcmljZUJsYWNrLFxuICAgICAgc3RhdHM6IG0uc3RhdHMsXG4gICAgICBzaW5nbGVVc2U6IG0uc2luZ2xlVXNlLFxuICAgIH07XG4gIH0pO1xufVxuXG4vLyBcdTlFRDhcdThCQTQgNCBcdTRFMkFcdTYyODBcdTgwRkRcdUZGMDhcdTU0OENcdTYzRDJcdTRFRjYgbW9ja0hvc3QgXHU5RUQ4XHU4QkE0XHU1QkY5XHU5RjUwXHVGRjFBXHU4RkQxXHU2MjE4L1x1OEZEQ1x1N0EwQi9cdTZDQkJcdTc1OTcvXHU2MkE0XHU3NkZFXHVGRjA5XG5jb25zdCBERUZBVUxUX1NLSUxMUyA9IFtcbiAgeyBuYW1lOiBcIlx1NTFCMlx1NjVBOVwiLCBwb3dlcjogMjAsIGNvc3Q6IDAsIGNkOiAyNCwgY2RMZWZ0OiAwLCB0eXBlOiBcImF0a1wiLCByYW5nZTogXCJtZWxlZVwiIH0sXG4gIHsgbmFtZTogXCJcdTcwNkJcdTc0MDNcIiwgcG93ZXI6IDI1LCBjb3N0OiAwLCBjZDogMzAsIGNkTGVmdDogMCwgdHlwZTogXCJhdGtcIiwgcmFuZ2U6IFwicmFuZ2VkXCIgfSxcbiAgeyBuYW1lOiBcIlx1NkNCQlx1NzU5N1wiLCBwb3dlcjogMzAsIGNvc3Q6IDAsIGNkOiA0MCwgY2RMZWZ0OiAwLCB0eXBlOiBcImhlYWxcIiwgcmFuZ2U6IFwibWVsZWVcIiB9LFxuICB7IG5hbWU6IFwiXHU2MkE0XHU3NkZFXCIsIHBvd2VyOiAwLCBjb3N0OiAwLCBjZDogNjAsIGNkTGVmdDogMCwgdHlwZTogXCJidWZmXCIsIHJhbmdlOiBcIm1lbGVlXCIgfSxcbl07XG5cbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBhc3luYyAoZSkgPT4ge1xuICBjb25zdCBkID0gZT8uZGF0YTtcbiAgaWYgKCFkIHx8IHR5cGVvZiBkICE9PSBcIm9iamVjdFwiKSByZXR1cm47XG4gIGxvZyhcImlmcmFtZVx1MjE5MiBcIiArIEpTT04uc3RyaW5naWZ5KGQpLnNsaWNlKDAsIDI0MCkpO1xuICBpZiAoZC50eXBlID09PSBcInRmX3BsdWdpbl9sb2FkZWRcIikge1xuICAgIGxvZyhcIkhPU1Q6IHRmX3BsdWdpbl9sb2FkZWQgcmVjZWl2ZWQsIGxvYWRpbmcgc3RvcnkuLi5cIik7XG4gICAgY29uc3Qgb2sgPSBhd2FpdCBsb2FkU3RvcnlEYXRhKCk7XG4gICAgaWYgKCFvaykgeyBsb2coXCJIT1NUOiBsb2FkU3RvcnlEYXRhIGZhaWxlZFwiKTsgcmV0dXJuOyB9XG4gICAgYXdhaXQgbG9hZEVudGl0eVR5cGVzKCk7XG4gICAgbG9nKFwiSE9TVDogc3RvcnkrZW50aXR5VHlwZXMgbG9hZGVkLCBwdXNoaW5nIHNlbGVjdCBzdGF0ZVwiKTtcbiAgICAvLyBcdTI2MDUgXHU3NkY0XHU2M0E1XHU1NDBDXHU2QjY1XHU2M0E4IHNlbGVjdCBzdGF0ZVx1RkYwOFx1NEUwRFx1NzUyOCBzZXRUaW1lb3V0XHVGRjBDYmFja2dyb3VuZCB0YWIgXHU0RTBBXHU0RTBEXHU1M0VGXHU5NzYwXHVGRjA5XG4gICAgbGFzdFN0YXRlID0ge1xuICAgICAgcGhhc2U6IFwic2VsZWN0XCIsIHZlcnNpb246IDUsIHRpY2s6IDAsXG4gICAgICB3b3JsZDogeyB3OiAzMDAwLCBoOiAzMDAwIH0sXG4gICAgICByb2xlczogc3RvcnlEYXRhLnJvbGVzIHx8IFtdLFxuICAgICAgc2VsZWN0aW9uczogeyBwYXJ0aWNpcGFudHM6IFtdLCBzcGVjdGF0b3JzOiBbXSwgZW5lbWllczogW10gfSxcbiAgICAgIGVudGl0aWVzOiBbXSwgY2hlc3RzOiBbXSwgcG90aW9uczogW10sIGZsb2F0ZXJzOiBbXSxcbiAgICAgIHNraWxsczogREVGQVVMVF9TS0lMTFMsXG4gICAgICBpdGVtczogbWF0ZXJpYWxzVG9JdGVtcyhzdG9yeURhdGEubWF0ZXJpYWxzIHx8IFtdKSxcbiAgICAgIHNraWxsUGFnZTogMCwgaXRlbVBhZ2U6IDAsXG4gICAgICBleHA6IDAsIG1vbmV5OiAwLCBkcm9wczogW10sIGtpbGxzOiAwLFxuICAgICAgZXZlbnRzOiBbXCJkZXYtaG9zdCBcdTVERjJcdTYzQThcdTkwMDEgc2VsZWN0IFx1NzJCNlx1NjAwMVx1RkYwOFwiICsgU1RPUlkgKyBcIlx1RkYwOVwiXSxcbiAgICAgIHJlc3VsdDogbnVsbCxcbiAgICAgIG1hcDogbnVsbCwgbWFwU291cmNlOiBcImZhbGxiYWNrXCIsXG4gICAgfTtcbiAgICAvLyBcdTI2MDUgXHU3NzFGXHU1QjlFXHU2M0QyXHU0RUY2IGVudHJ5LmpzIFx1NjNBNVx1N0JBMVx1RkYwOFx1ODU4NFx1NUJCRlx1NEUzQlx1RkYwOVx1RkYxQWluaXQgXHU4RkQ0XHU1NkRFXHU1RTI2XHU2NzBEXHU1MkExXHU1NjY4XHU1M0MyXHU2NTcwXHU1MzYxXHU3Njg0IHNlbGVjdCBzdGF0ZVxuICAgIGlmIChhd2FpdCBxdWV1ZUVudHJ5QWN0aW9uKFwiaW5pdFwiLCB7fSkpIHtcbiAgICAgIGxvZyhcIkhPU1Q6IGVudHJ5LmpzIFx1NURGMlx1NjNBNVx1N0JBMVx1RkYwOGluaXQgXHUyMTkyIHNlbGVjdCBzdGF0ZVx1RkYwOVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcG9zdChsYXN0U3RhdGUpO1xuICAgIGxvZyhcImhvc3RcdTIxOTIgcHVzaGVkIHNlbGVjdCBzdGF0ZSAocm9sZXM6IFwiICsgbGFzdFN0YXRlLnJvbGVzLmxlbmd0aCArIFwiLCBpdGVtczogXCIgKyBsYXN0U3RhdGUuaXRlbXMubGVuZ3RoICsgXCIpXCIpO1xuICB9XG4gIC8vIFx1MjYwNSBcdTg1ODRcdTVCQkZcdTRFM0JcdUZGMUEtLWNvbm4gXHU2ODY5XHU0RTBCXHU2MjQwXHU2NzA5XHU1MkE4XHU0RjVDXHU0RjE4XHU1MTQ4XHU0RUE0XHU3RUQ5XHU3NzFGXHU1QjlFXHU2M0QyXHU0RUY2IGVudHJ5LmpzIFx1NjI2N1x1ODg0Q1x1RkYwOFx1NEUwRVx1MzAwQ1x1NUI4OVx1ODhDNVx1NTQwRVx1MzAwRFx1OERFRlx1NUY4NFx1NEUwMFx1ODFGNFx1RkYwOVxuICBpZiAoZC50eXBlID09PSBcInRmX3BsdWdpbl90aWNrXCIgJiYgdHlwZW9mIGQuYWN0aW9uID09PSBcInN0cmluZ1wiKSB7XG4gICAgaWYgKGF3YWl0IHF1ZXVlRW50cnlBY3Rpb24oZC5hY3Rpb24sIGQucGFyYW1zIHx8IHt9KSkgcmV0dXJuO1xuICB9XG4gIGlmIChkLnR5cGUgPT09IFwidGZfcGx1Z2luX3RpY2tcIiAmJiBkLmFjdGlvbiA9PT0gXCJzdGFydFwiKSB7XG4gICAgaWYgKCFzdG9yeURhdGEpIHsgc2hvd0Vycm9yKFwic3RvcnlEYXRhIFx1NjcyQVx1NTJBMFx1OEY3RFwiKTsgcmV0dXJuOyB9XG4gICAgY29uc3Qgc2VsID0gZC5wYXJhbXM/LnNlbGVjdGlvbnMgfHwge307XG4gICAgY29uc3Qgcm9sZXMgPSBzdG9yeURhdGEucm9sZXMgfHwgW107XG4gICAgY29uc3QgcGxheWVyUm9sZSA9IHJvbGVzLmZpbmQoKHIpID0+IHIucm9sZVR5cGUgPT09IFwicGxheWVyXCIpIHx8IHJvbGVzWzBdO1xuICAgIGNvbnN0IGVudHMgPSBbXTtcbiAgICBpZiAocGxheWVyUm9sZSkge1xuICAgICAgY29uc3QgbHYgPSBwbGF5ZXJSb2xlLmluaXRpYWxfbGV2ZWwgfHwgMTA7XG4gICAgICBjb25zdCBzID0gMSArIChsdiAtIDEpICogMC4zO1xuICAgICAgZW50cy5wdXNoKHtcbiAgICAgICAgaWQ6IHBsYXllclJvbGUuaWQgfHwgXCJwMVwiLCBuYW1lOiBwbGF5ZXJSb2xlLm5hbWUgfHwgXCJcdTczQTlcdTVCQjZcIiwgc2lkZTogXCJwbGF5ZXJcIixcbiAgICAgICAgeDogMCwgeTogMCwgdng6IDAsIHZ5OiAwLFxuICAgICAgICBocDogTWF0aC5mbG9vcigxMDAgKiBzKSwgbWF4SHA6IE1hdGguZmxvb3IoMTAwICogcyksXG4gICAgICAgIG1wOiBNYXRoLmZsb29yKDMwICsgbHYgKiA1KSwgbWF4TXA6IE1hdGguZmxvb3IoMzAgKyBsdiAqIDUpLFxuICAgICAgICBleHA6IDAsIGV4cFRvTmV4dDogTWF0aC5mbG9vcig1MCAqIE1hdGgucG93KDEuNSwgbHYgLSAxKSksXG4gICAgICAgIGxldmVsOiBsdiwgYXRrOiAzMCwgZGVmOiAxMCwgZmFjaW5nOiAwLCBjb29sZG93bjogMCwgYWxpdmU6IHRydWUsXG4gICAgICAgIGF2YXRhclBhdGg6IHBsYXllclJvbGUuYXZhdGFyUGF0aCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICAoc2VsLnBhcnRpY2lwYW50cyB8fCBbXSkuZm9yRWFjaCgoaWQsIGkpID0+IHtcbiAgICAgIC8vIHBhcnRpY2lwYW50cyBcdTUzRUZcdTgwRkRcdTY2MkYgaWQocjAyKSBcdTRFNUZcdTUzRUZcdTgwRkRcdTY2MkYgbmFtZShcdTg4RjRcdTUyQzcpXHVGRjBDXHU0RTI0XHU3OUNEXHU5MEZEXHU1QzFEXHU4QkQ1XHU1MzM5XHU5MTREXG4gICAgICBjb25zdCByID0gcm9sZXMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpIHx8IHJvbGVzLmZpbmQoKHgpID0+IHgubmFtZSA9PT0gaWQpO1xuICAgICAgaWYgKHIgJiYgKCFwbGF5ZXJSb2xlIHx8IHIuaWQgIT09IHBsYXllclJvbGUuaWQpKSB7XG4gICAgICAgIGNvbnN0IGx2ID0gci5pbml0aWFsX2xldmVsIHx8IDEwO1xuICAgICAgICBjb25zdCBzID0gMSArIChsdiAtIDEpICogMC4zO1xuICAgICAgICBlbnRzLnB1c2goe1xuICAgICAgICAgIGlkOiByLmlkLCBuYW1lOiByLm5hbWUsIHNpZGU6IFwiYWxseVwiLFxuICAgICAgICAgIHg6IE1hdGguY29zKGkpICogMTIsIHk6IE1hdGguc2luKGkpICogMTIsIHZ4OiAwLCB2eTogMCxcbiAgICAgICAgICBocDogTWF0aC5mbG9vcigxMDAgKiBzKSwgbWF4SHA6IE1hdGguZmxvb3IoMTAwICogcyksXG4gICAgICAgICAgbXA6IE1hdGguZmxvb3IoMzAgKyBsdiAqIDUpLCBtYXhNcDogTWF0aC5mbG9vcigzMCArIGx2ICogNSksXG4gICAgICAgICAgZXhwOiAwLCBleHBUb05leHQ6IE1hdGguZmxvb3IoNTAgKiBNYXRoLnBvdygxLjUsIGx2IC0gMSkpLFxuICAgICAgICAgIGxldmVsOiBsdiwgYXRrOiAyNSwgZGVmOiA4LCBmYWNpbmc6IDAsIGNvb2xkb3duOiAwLCBhbGl2ZTogdHJ1ZSwgYXZhdGFyUGF0aDogci5hdmF0YXJQYXRoLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBcdTI2MDUgXHU3NkY0XHU2M0E1XHU1NDBDXHU2QjY1XHU2M0E4IHBsYXlpbmcgc3RhdGVcdUZGMDhcdTc1Mjggc2V0VGltZW91dCgyMDApIFx1NTcyOCBiYWNrZ3JvdW5kIHRhYiBcdTRFMEFcdTRFMERcdTUzRUZcdTk3NjBcdUZGMENcbiAgICAvLyAgIGJzayBcdTYzQTdcdTUyMzZcdTUzRjBcdTY1RjZcdTY1NzRcdTRFMkEgc2V0VGltZW91dCBcdTk2MUZcdTUyMTdcdTg4QUJcdTgyODJcdTZENDFcdTUyMzAgMUh6XHVGRjBDc3RhcnQgYWN0aW9uIFx1NkMzOFx1OEZEQ1x1NTIzMFx1NEUwRFx1NEU4Nlx1RkYwOVxuICAgIGxhc3RTdGF0ZSA9IHtcbiAgICAgIHBoYXNlOiBcInBsYXlpbmdcIiwgdmVyc2lvbjogNSwgdGljazogMCxcbiAgICAgIHdvcmxkOiB7IHc6IDMwMDAsIGg6IDMwMDAgfSxcbiAgICAgIC8vIFx1MjYwNSBcdTRGRERcdTc1NTkgcm9sZXNcdUZGMUFwbGF5aW5nIFx1NjNBOFx1N0E3QSByb2xlcyBcdTIxOTIgb25Ib3N0U3RhdGUgXHU2NTc0XHU0RUZEXHU2NkZGXHU2MzYyIFx1MjE5MiBcdTkwMDlcdTRFQkFcdTk2MzZcdTZCQjVcdTY1RTBcdTg5RDJcdTgyNzJcdTUzRUZcdTkwMDlcbiAgICAgIHJvbGVzOiBzdG9yeURhdGEucm9sZXMgfHwgW10sXG4gICAgICBzZWxlY3Rpb25zOiB7IHBhcnRpY2lwYW50czogc2VsLnBhcnRpY2lwYW50cyB8fCBbXSwgc3BlY3RhdG9yczogc2VsLnNwZWN0YXRvcnMgfHwgW10sIGVuZW1pZXM6IHNlbC5lbmVtaWVzIHx8IFtdIH0sXG4gICAgICBlbnRpdGllczogZW50cywgY2hlc3RzOiBbXSwgcG90aW9uczogW10sIGZsb2F0ZXJzOiBbXSxcbiAgICAgIHNraWxsczogREVGQVVMVF9TS0lMTFMsXG4gICAgICBpdGVtczogbWF0ZXJpYWxzVG9JdGVtcyhzdG9yeURhdGEubWF0ZXJpYWxzIHx8IFtdKSxcbiAgICAgIHNraWxsUGFnZTogMCwgaXRlbVBhZ2U6IDAsXG4gICAgICBleHA6IDAsIG1vbmV5OiAwLCBkcm9wczogW10sIGtpbGxzOiAwLFxuICAgICAgZXZlbnRzOiBbXCJkZXYtaG9zdDogXHU2RTM4XHU2MjBGXHU1RjAwXHU1OUNCXHVGRjA4XCIgKyBTVE9SWSArIFwiXHVGRjA5XCJdLFxuICAgICAgcmVzdWx0OiBudWxsLFxuICAgICAgbWFwOiBudWxsLCBtYXBTb3VyY2U6IFwiZmFsbGJhY2tcIixcbiAgICB9O1xuICAgIHBvc3QobGFzdFN0YXRlKTtcbiAgICBsb2coXCJob3N0XHUyMTkyIHB1c2hlZCBwbGF5aW5nIHN0YXRlIChlbnRzOiBcIiArIGVudHMubGVuZ3RoICsgXCIpXCIpO1xuICB9XG4gIGlmIChkLnR5cGUgPT09IFwidGZfcGx1Z2luX3RpY2tcIiAmJiBkLmFjdGlvbiA9PT0gXCJ0aWNrXCIpIHtcbiAgICBpZiAoIWxhc3RTdGF0ZSkgcmV0dXJuO1xuICAgIC8vIFx1MjYwNSBcdTc1MjggNTBtcyBcdTk1RjRcdTk2OTRcdTc2ODRcIlx1NjcwRFx1NTJBMVx1NTY2OCB0aWNrXCJcdTIwMTRcdTIwMTRcdTZCQ0ZcdTZCMjFcdTVCQTJcdTYyMzdcdTdBRUZcdTUzRDEgdGZfcGx1Z2luX3RpY2tcdUZGMENcbiAgICAvLyAgIFx1NjI4QVx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NTQwOFx1NUU3Nlx1NTIzMCBsYXN0UGVuZGluZ1RpY2tcdUZGMENcdTc1MzFcdTY3MERcdTUyQTFcdTU2NjhcdTVCOUFcdTY1RjZcdTU2NjhcdTgxRUFcdTVERjFcdTlBNzFcdTUyQTggQUlcdTMwMDJcbiAgICAvLyAgIFx1OEZEOVx1OTA3Rlx1NTE0RFx1NEU4NiBiYWNrZ3JvdW5kIHRhYiBcdTRFMEEgc2V0VGltZW91dC9SQUYgXHU4OEFCXHU4MjgyXHU2RDQxXHU1QkZDXHU4MUY0IEFJIFx1NEUwRFx1OEREMVx1MzAwMlxuICAgIGlmICghd2luZG93Ll9kZXZIb3N0SW50ZXJ2YWwpIHtcbiAgICAgIHdpbmRvdy5fZGV2SG9zdEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBjb25zdCBwID0gd2luZG93Ll9kZXZIb3N0UGVuZGluZyB8fCB7fTtcbiAgICAgICAgd2luZG93Ll9kZXZIb3N0UGVuZGluZyA9IG51bGw7XG4gICAgICAgIC8vIFx1MjYwNSBcdTVCQTJcdTYyMzdcdTdBRUZcdTRFMEFcdTYyQTVcdTc2ODRcdTVGNTNcdTUyNERcdTUxNzNcdTUzNjFcdTU0MERcdUZGMDhcdThERTggZnJhbWUgXHU0RjIwXHU1MDNDXHU3Njg0XHU1NTJGXHU0RTAwXHU5MDFBXHU5MDUzXHU2NjJGIHRpY2sgXHU2RDg4XHU2MDZGXHVGRjA5XG4gICAgICAgIGlmIChwLmxldmVsTmFtZSkgY3VycmVudExldmVsTmFtZSA9IHAubGV2ZWxOYW1lO1xuICAgICAgICAvLyBcdTI2MDUgXHU3M0E5XHU1QkI2XHU1REYyXHU2QjdCXHVGRjA4b3Zlclx1RkYwOVx1MjE5MiBcdTdFRDNcdTdCOTdcdTc1M0JcdTk3NjJcdUZGMENcdTUwNUNcdThERDFcdTYyMThcdTY1OTcgQUkgLyBcdTUyMzdcdTYwMkFcdUZGMDhcdTVCQTJcdTYyMzdcdTdBRUYgbG9vcCBcdTRFNUZcdTVERjJcdTUwNUNcdTUzRDFcdUZGMDlcbiAgICAgICAgaWYgKGxhc3RTdGF0ZS5waGFzZSA9PT0gXCJvdmVyXCIpIHJldHVybjtcbiAgICAgICAgLy8gXHUyNjA1IFx1ODFFQVx1NURGMVx1OEJBMVx1NjU3MCB0aWNrXHVGRjA4cC50aWNrIFx1NjYyRlx1NUJBMlx1NjIzN1x1N0FFRlx1NzY4NFx1RkYwQ1x1NTNFRlx1ODBGRFx1NEUzQSAwXHVGRjA5XG4gICAgICAgIGxhc3RTdGF0ZS50aWNrID0gKGxhc3RTdGF0ZS50aWNrIHx8IDApICsgMTtcbiAgICAgICAgLy8gXHUyNjA1IFx1NUZDNVx1OTg3Qlx1NkJDRlx1NkIyMVx1OTFDRFx1NjVCMFx1OEJGQiBsYXN0U3RhdGUuZW50aXRpZXMgXHUyMDE0XHUyMDE0IFx1NEU0Qlx1NTI0RCBjb25zdCBlbnRzID0gLi4uIFx1NEYxQVx1NjI4QVx1NjVFN1x1NjU3MFx1N0VDNFx1NUYxNVx1NzUyOFxuICAgICAgICAvLyAgIFx1NTFCQlx1N0VEM1x1RkYwQ1x1OTFDRVx1NjAyQVx1NTQwQ1x1NkI2NVx1NkJCNVx1OTFDRFx1NUVGQSBsYXN0U3RhdGUuZW50aXRpZXMgXHU1NDBFXHU0RTBCXHU5NzYyXHU3Njg0XHU5MDNCXHU4RjkxXHU0RUNEXHU2NTM5XHU2NUU3XHU2NTcwXHU3RUM0XHVGRjBDXG4gICAgICAgIC8vICAgXHU1QkZDXHU4MUY0IHNlcnZlciBwdXNoIFx1NTFGQVx1NTNCQlx1NzY4NFx1NEVDRFx1NzEzNlx1NjYyRlx1NjVFNyAxMSBcdTUzRUFcdTkxQ0VcdTYwMkFcdUZGMDhkZXYtaG9zdCBcdTZDMzhcdThGRENcdTU3MjhcdTc1MjhcdTUyMDdcdTUxNzNcdTUyNERcdTc2ODRcdTVGMTVcdTc1MjhcdUZGMDlcdTMwMDJcbiAgICAgICAgY29uc3QgZW50cyA9IGxhc3RTdGF0ZS5lbnRpdGllcztcbiAgICAgICAgLy8gMS4gXHU5NTVDXHU1MENGXHU3M0E5XHU1QkI2XHU0RjREXHU1OUZGXHVGRjA4XHU1MjREXHU3QUVGXHU2NzQzXHU1QTAxXHVGRjA5XG4gICAgICAgIGNvbnN0IG1lID0gZW50cy5maW5kKChlKSA9PiBlLnNpZGUgPT09IFwicGxheWVyXCIpO1xuICAgICAgICBpZiAobWUpIHtcbiAgICAgICAgICBjb25zdCBwbGF5ZXJJbmZvID0gcC5wbGF5ZXIgfHwge307XG4gICAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShwbGF5ZXJJbmZvLngpKSBtZS54ID0gcGxheWVySW5mby54O1xuICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGxheWVySW5mby55KSkgbWUueSA9IHBsYXllckluZm8ueTtcbiAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHBsYXllckluZm8uZmFjaW5nKSkgbWUuZmFjaW5nID0gcGxheWVySW5mby5mYWNpbmc7XG4gICAgICAgICAgbWUudnggPSAwOyBtZS52eSA9IDA7XG4gICAgICAgICAgLy8gXHU4MUVBXHU3MTM2XHU1NkRFXHU1OTBEXG4gICAgICAgICAgaWYgKGxhc3RTdGF0ZS50aWNrICUgMTAgPT09IDApIG1lLm1wID0gTWF0aC5taW4obWUubWF4TXAsIChtZS5tcCB8fCAwKSArIDMpO1xuICAgICAgICAgIGlmIChsYXN0U3RhdGUudGljayAlIDMwID09PSAwKSBtZS5ocCA9IE1hdGgubWluKG1lLm1heEhwLCBtZS5ocCArIDEpO1xuICAgICAgICB9XG4gICAgICAvLyAyLiBcdTY1NENcdTRFQkEgQUlcdUZGMDhnYW1lLm1kIDYyLTY5XHVGRjA5XHVGRjFBXG4gICAgICAvLyAgICBcdTI0NjAgXHU0RkE2XHU2RDRCL1x1NTNEMVx1OEQ3N1x1NjUzQlx1NTFGQlx1OERERFx1NzlCQiA0bSBcdTIwMTRcdTIwMTQgNG0gXHU1MTg1XHU2MjREXHU4RkZEXHU1MUZCXG4gICAgICAvLyAgICBcdTI0NjEgXHU0RjI0XHU1QkIzXHU1MjI0XHU1QjlBXHVGRjFBXHU4RkQxXHU2MjE4IDAuNW0gLyBcdThGRENcdTdBMEIgNG1cbiAgICAgIC8vICAgIFx1MjQ2MiBcdTczQTlcdTVCQjZcdTkwMDNcdTUxRkEgNG0gXHUyMTkyIFx1OTFDRVx1NjAyQVx1NTA1Q1x1NkI2Mlx1OEZGRFx1NTFGQlx1MzAwMVx1OEQ3MFx1NTZERVx1NTFGQVx1NzUxRlx1NzBCOVx1RkYwOFx1NjJGNFx1N0VGM1x1RkYwOVxuICAgICAgY29uc3QgdGFyZ2V0ID0gbWU7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZW50cykge1xuICAgICAgICBpZiAoZS5zaWRlICE9PSBcImVuZW15XCIgfHwgIWUuYWxpdmUgfHwgIXRhcmdldCB8fCAhdGFyZ2V0LmFsaXZlKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgIGNvbnN0IGR4ID0gdGFyZ2V0LnggLSBlLng7XG4gICAgICAgIGNvbnN0IGR5ID0gdGFyZ2V0LnkgLSBlLnk7XG4gICAgICAgIGNvbnN0IGQyID0gTWF0aC5oeXBvdChkeCwgZHkpIHx8IDAuMDAxO1xuICAgICAgICBjb25zdCBpc1JhbmdlZCA9IGUuaXNSYW5nZWQgPT09IHRydWU7XG4gICAgICAgIGNvbnN0IGhvbWUgPSBlLmhvbWVYICE9PSB1bmRlZmluZWQgPyBlIDogbnVsbDtcbiAgICAgICAgLy8gXHUyNTAwXHUyNTAwIFx1NjJGNFx1N0VGM1x1RkYxQVx1NzlCQlx1NUYwMFx1NTFGQVx1NzUxRlx1NzBCOSA+IDRtIFx1NEUxNFx1NzNBOVx1NUJCNlx1NEUwRFx1NTcyOCA0bSBcdTY1M0JcdTUxRkJcdTU3MDhcdTUxODUgXHUyMTkyIFx1NTZERVx1NTFGQVx1NzUxRlx1NzBCOSBcdTI1MDBcdTI1MDBcbiAgICAgICAgY29uc3QgaG9tZUQgPSBob21lID8gTWF0aC5oeXBvdChlLnggLSBlLmhvbWVYLCBlLnkgLSBlLmhvbWVZKSA6IDA7XG4gICAgICAgIGlmIChkMiA+IDQpIHtcbiAgICAgICAgICAvLyBcdTgxMzFcdTYyMThcdUZGMUFcdThENzBcdTU0MTFcdTUxRkFcdTc1MUZcdTcwQjlcbiAgICAgICAgICBpZiAoaG9tZSAmJiBob21lRCA+IDAuMykge1xuICAgICAgICAgICAgY29uc3QgaHggPSBlLmhvbWVYIC0gZS54O1xuICAgICAgICAgICAgY29uc3QgaHkgPSBlLmhvbWVZIC0gZS55O1xuICAgICAgICAgICAgY29uc3QgaGQgPSBNYXRoLmh5cG90KGh4LCBoeSkgfHwgMC4wMDE7XG4gICAgICAgICAgICBjb25zdCBzcCA9IDIuMCAqIDAuMTtcbiAgICAgICAgICAgIGUueCArPSAoaHggLyBoZCkgKiBzcDsgZS55ICs9IChoeSAvIGhkKSAqIHNwO1xuICAgICAgICAgICAgZS5mYWNpbmcgPSBoeCA+IDAgPyAwIDogMTgwO1xuICAgICAgICAgIH1cbiAgICAgICAgICBlLmNvb2xkb3duID0gKGUuY29vbGRvd24gfHwgMCkgLSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFx1MjUwMFx1MjUwMCA0bSBcdTUxODVcdUZGMUFcdThGRkRcdTUxRkIgKyBcdTY1M0JcdTUxRkIgXHUyNTAwXHUyNTAwXG4gICAgICAgIGlmIChpc1JhbmdlZCkge1xuICAgICAgICAgIGlmIChkMiA+IDQpIHtcbiAgICAgICAgICAgIGNvbnN0IHNwID0gMi4wICogMC4xO1xuICAgICAgICAgICAgZS54ICs9IChkeCAvIGQyKSAqIHNwOyBlLnkgKz0gKGR5IC8gZDIpICogc3A7XG4gICAgICAgICAgfSBlbHNlIGlmIChkMiA8IDIuNSkge1xuICAgICAgICAgICAgY29uc3Qgc3AgPSAxLjUgKiAwLjE7XG4gICAgICAgICAgICBlLnggLT0gKGR4IC8gZDIpICogc3A7IGUueSAtPSAoZHkgLyBkMikgKiBzcDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGQyID4gMC40KSB7XG4gICAgICAgICAgICBjb25zdCBzcCA9IDIuMCAqIDAuMTtcbiAgICAgICAgICAgIGUueCArPSAoZHggLyBkMikgKiBzcDsgZS55ICs9IChkeSAvIGQyKSAqIHNwO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlLmZhY2luZyA9IGR4ID4gMCA/IDAgOiAxODA7XG4gICAgICAgIGUuY29vbGRvd24gPSAoZS5jb29sZG93biB8fCAwKSAtIDE7XG4gICAgICAgIC8vIFx1NEYyNFx1NUJCM1x1NTIyNFx1NUI5QVx1OERERFx1NzlCQlx1RkYxQVx1OEZEMVx1NjIxOCAwLjVtIC8gXHU4RkRDXHU3QTBCIDRtXHVGRjA4Z2FtZS5tZCA2My02NFx1RkYwOVxuICAgICAgICBjb25zdCBhdHRhY2tSYW5nZSA9IGlzUmFuZ2VkID8gNCA6IDAuNTtcbiAgICAgICAgaWYgKGQyIDwgYXR0YWNrUmFuZ2UgJiYgZS5jb29sZG93biA8PSAwKSB7XG4gICAgICAgICAgY29uc3QgZG1nID0gTWF0aC5tYXgoMSwgKGUuYXRrIHx8IDUpIC0gKHRhcmdldC5kZWYgfHwgMCkpO1xuICAgICAgICAgIHRhcmdldC5ocCA9IE1hdGgubWF4KDAsIHRhcmdldC5ocCAtIGRtZyk7XG4gICAgICAgICAgdGFyZ2V0LmhpdEZsYXNoTXMgPSAyNTA7XG4gICAgICAgICAgbGFzdFN0YXRlLmZsb2F0ZXJzLnB1c2goeyBpZDogXCJmXCIgKyBsYXN0U3RhdGUudGljayArIFwiX1wiICsgTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNiksIHRleHQ6IFwiLVwiICsgZG1nLCB4OiB0YXJnZXQueCwgeTogdGFyZ2V0LnkgLSAxMCwgbGlmZTogMTIsIGtpbmQ6IFwiZGFtYWdlXCIsIGNvbG9yOiBcIiNmZjVhNWFcIiB9KTtcbiAgICAgICAgICBlLmNvb2xkb3duID0gNDA7XG4gICAgICAgICAgaWYgKHRhcmdldC5ocCA8PSAwKSB7XG4gICAgICAgICAgICB0YXJnZXQuYWxpdmUgPSBmYWxzZTtcbiAgICAgICAgICAgIGxhc3RTdGF0ZS5ldmVudHMucHVzaChcIlttb2NrXSBcdTczQTlcdTVCQjZcdTg4QUIgXCIgKyBlLm5hbWUgKyBcIiBcdTUxRkJcdTUwMTJcIik7XG4gICAgICAgICAgICBsYXN0U3RhdGUucGhhc2UgPSBcIm92ZXJcIjtcbiAgICAgICAgICAgIGxhc3RTdGF0ZS5yZXN1bHQgPSB7IHJlYXNvbjogXCJkZWF0aFwiLCBleHA6IGxhc3RTdGF0ZS5leHAsIG1vbmV5OiBsYXN0U3RhdGUubW9uZXksIGRyb3BzOiBsYXN0U3RhdGUuZHJvcHMsIGtpbGxzOiBsYXN0U3RhdGUua2lsbHMsIHN1cnZpdmVkVGlja3M6IGxhc3RTdGF0ZS50aWNrIH07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyAzLiBcdTczQTlcdTVCQjZcdTgxRUFcdTUyQThcdTY1M0JcdTUxRkJcdUZGMDhcdTZCQ0YgMzAgdGlja1x1RkYwOVx1RkYxQVx1OEZEMVx1NjIxOCAwLjVtIC8gXHU4RkRDXHU3QTBCIDRtXHVGRjA4Z2FtZS5tZCA2M1x1RkYwOVxuICAgICAgaWYgKG1lICYmIG1lLmFsaXZlICYmIGxhc3RTdGF0ZS50aWNrICUgMzAgPT09IDApIHtcbiAgICAgICAgbGV0IGNsb3Nlc3QgPSBudWxsLCBtaW5EID0gSW5maW5pdHk7XG4gICAgICAgIGZvciAoY29uc3QgZSBvZiBlbnRzKSB7XG4gICAgICAgICAgaWYgKGUuc2lkZSAhPT0gXCJlbmVteVwiIHx8ICFlLmFsaXZlKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCBkZCA9IE1hdGguaHlwb3QoZS54IC0gbWUueCwgZS55IC0gbWUueSk7XG4gICAgICAgICAgY29uc3QgcmVhY2ggPSAwLjU7XG4gICAgICAgICAgaWYgKGRkIDwgcmVhY2ggJiYgZGQgPCBtaW5EKSB7IG1pbkQgPSBkZDsgY2xvc2VzdCA9IGU7IH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoY2xvc2VzdCkge1xuICAgICAgICAgIGNvbnN0IGRtZyA9IE1hdGgubWF4KDEsIChtZS5hdGsgfHwgMzApIC0gKGNsb3Nlc3QuZGVmIHx8IDApKTtcbiAgICAgICAgICBjbG9zZXN0LmhwID0gTWF0aC5tYXgoMCwgY2xvc2VzdC5ocCAtIGRtZyk7XG4gICAgICAgICAgY2xvc2VzdC5oaXRGbGFzaE1zID0gMjUwO1xuICAgICAgICAgIG1lLmFjdGlvbkJvYk1zID0gMzAwO1xuICAgICAgICAgIGxhc3RTdGF0ZS5mbG9hdGVycy5wdXNoKHsgaWQ6IFwiZlwiICsgbGFzdFN0YXRlLnRpY2sgKyBcIl9cIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCB0ZXh0OiBcIi1cIiArIGRtZywgeDogY2xvc2VzdC54LCB5OiBjbG9zZXN0LnkgLSAxMCwgbGlmZTogMTIsIGtpbmQ6IFwiZGFtYWdlXCIsIGNvbG9yOiBcIiNmZjVhNWFcIiB9KTtcbiAgICAgICAgICAvLyBcdTI2MDUgXHU5RUQ4XHU4QkE0XHU2NTNCXHU1MUZCXHU3Mjc5XHU2NTQ4XHVGRjFBXHU3RUEyXHU4MjcyXHU3MDZCXHU4MkIxICsgXHU1NDdEXHU0RTJEXHU3MjA2XHU3MEI4XG4gICAgICAgICAgaWYgKCFsYXN0U3RhdGUudmZ4KSBsYXN0U3RhdGUudmZ4ID0gW107XG4gICAgICAgICAgbGFzdFN0YXRlLnZmeC5wdXNoKHsgaWQ6IFwidmZ4X1wiICsgbGFzdFN0YXRlLnRpY2sgKyBcIl9cIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBraW5kOiBcInNwYXJrXCIsIGVudGl0eUlkOiBjbG9zZXN0LmlkLCB4OiBjbG9zZXN0LngsIHk6IGNsb3Nlc3QueSwgbGlmZTogOCwgdG90YWw6IDgsIGNvbG9yOiBcIiNmZjVhNWFcIiB9KTtcbiAgICAgICAgICBsYXN0U3RhdGUudmZ4LnB1c2goeyBpZDogXCJ2ZnhfXCIgKyBsYXN0U3RhdGUudGljayArIFwiX1wiICsgTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNiksIGtpbmQ6IFwiZXhwbG9zaW9uXCIsIGVudGl0eUlkOiBjbG9zZXN0LmlkLCB4OiBjbG9zZXN0LngsIHk6IGNsb3Nlc3QueSwgbGlmZTogNiwgdG90YWw6IDYsIGNvbG9yOiBcIiNmZjhjM2FcIiB9KTtcbiAgICAgICAgICBpZiAoY2xvc2VzdC5ocCA8PSAwKSB7XG4gICAgICAgICAgICBjbG9zZXN0LmFsaXZlID0gZmFsc2U7XG4gICAgICAgICAgICBsYXN0U3RhdGUua2lsbHMrKztcbiAgICAgICAgICAgIGxhc3RTdGF0ZS5tb25leSA9IChsYXN0U3RhdGUubW9uZXkgfHwgMCkgKyAzO1xuICAgICAgICAgICAgbWUuZXhwID0gKG1lLmV4cCB8fCAwKSArIChjbG9zZXN0LmxldmVsIHx8IDEpICogNTtcbiAgICAgICAgICAgIGxhc3RTdGF0ZS5ldmVudHMucHVzaChcIlttb2NrXSBcdTUxRkJcdTY3NDAgXCIgKyBjbG9zZXN0Lm5hbWUgKyBcIiAoK1wiICsgKChjbG9zZXN0LmxldmVsIHx8IDEpICogNSkgKyBcImV4cCArM21vbmV5KVwiKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIDQuIFx1NzZERlx1NTNDQiBBSVx1RkYxQVx1OERERlx1OTY4Rlx1NzNBOVx1NUJCNiArIFx1ODFFQVx1NTJBOFx1NjUzQlx1NTFGQlx1NjcwMFx1OEZEMVx1NjU0Q1x1NEVCQVx1RkYwOFx1NkJDRiAzMCB0aWNrXHVGRjA5XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgZW50cykge1xuICAgICAgICBpZiAoYS5zaWRlICE9PSBcImFsbHlcIiB8fCAhYS5hbGl2ZSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRhcmdldDIgPSBlbnRzLmZpbHRlcigoZSkgPT4gZS5zaWRlID09PSBcImVuZW15XCIgJiYgZS5hbGl2ZSkuc29ydCgoeCwgeSkgPT4gTWF0aC5oeXBvdCh4LnggLSBhLngsIHgueSAtIGEueSkgLSBNYXRoLmh5cG90KHkueCAtIGEueCwgeS55IC0gYS55KSlbMF07XG4gICAgICAgIGlmICh0YXJnZXQyKSB7XG4gICAgICAgICAgY29uc3QgZGQgPSBNYXRoLmh5cG90KHRhcmdldDIueCAtIGEueCwgdGFyZ2V0Mi55IC0gYS55KTtcbiAgICAgICAgICBpZiAoZGQgPCAxLjUgJiYgKGEuY29vbGRvd24gfHwgMCkgPD0gMCkge1xuICAgICAgICAgICAgY29uc3QgZG1nID0gTWF0aC5tYXgoMSwgKGEuYXRrIHx8IDI1KSAtICh0YXJnZXQyLmRlZiB8fCAwKSk7XG4gICAgICAgICAgICB0YXJnZXQyLmhwID0gTWF0aC5tYXgoMCwgdGFyZ2V0Mi5ocCAtIGRtZyk7XG4gICAgICAgICAgICB0YXJnZXQyLmhpdEZsYXNoTXMgPSAyNTA7XG4gICAgICAgICAgICBhLmFjdGlvbkJvYk1zID0gMzAwO1xuICAgICAgICAgICAgbGFzdFN0YXRlLmZsb2F0ZXJzLnB1c2goeyBpZDogXCJmXCIgKyBsYXN0U3RhdGUudGljayArIFwiX1wiICsgTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNiksIHRleHQ6IFwiLVwiICsgZG1nLCB4OiB0YXJnZXQyLngsIHk6IHRhcmdldDIueSAtIDEwLCBsaWZlOiAxMiwga2luZDogXCJkYW1hZ2VcIiwgY29sb3I6IFwiI2ZmNWE1YVwiIH0pO1xuICAgICAgICAgICAgYS5jb29sZG93biA9IDMwO1xuICAgICAgICAgICAgaWYgKHRhcmdldDIuaHAgPD0gMCkge1xuICAgICAgICAgICAgICB0YXJnZXQyLmFsaXZlID0gZmFsc2U7XG4gICAgICAgICAgICAgIGxhc3RTdGF0ZS5raWxscysrO1xuICAgICAgICAgICAgICBsYXN0U3RhdGUubW9uZXkgPSAobGFzdFN0YXRlLm1vbmV5IHx8IDApICsgMztcbiAgICAgICAgICAgICAgbGFzdFN0YXRlLmV2ZW50cy5wdXNoKFwiW21vY2tdIFx1NzZERlx1NTNDQiBcIiArIGEubmFtZSArIFwiIFx1NTFGQlx1Njc0MCBcIiArIHRhcmdldDIubmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyA1LiBcdTkxQ0VcdTYwMkFcdTc1MUZcdTYyMTBcdUZGMDhnYW1lLm1kIDY3LTY5XHVGRjA5XHVGRjFBXHU1MUZBXHU3NTFGXHU3MEI5L1x1N0I0OVx1N0VBNy9cdTdDN0JcdTU3OEJcdTY3NjVcdTgxRUFcdTU3MzBcdTU2RkUganNvblx1RkYwOG11bGJlcnJ5Rm9yZXN0Lmpzb25cbiAgICAgIC8vICAgIEFjdG9ycyBcdTVDNDJcdUZGMDlcdUZGMENcdTc1MzFcdTVCQTJcdTYyMzdcdTdBRUZcdTUyMDdcdTUxNzNcdTY1RjZcdTc1MUZcdTYyMTAgbWFwbW9iXyogXHU1RTc2XHU3RUNGIHRpY2subG9jYWxFbmVtaWVzIFx1NEUwQVx1NjJBNVx1MzAwMlxuICAgICAgLy8gICAgZGV2LWhvc3QgXHU0RTBEXHU5NjhGXHU2NzNBXHU1MjM3XHU2MDJBXHVGRjAxXHU1M0VBXHU1MDVBXHU0RTI0XHU0RUY2XHU0RThCXHVGRjFBXG4gICAgICAvLyAgICBcdTI0NjAgXHU2NTM2XHU1MjMwIGxvY2FsRW5lbWllcyBcdTZFMDVcdTUzNTVcdUZGMDhlcG9jaCBcdTUzRDhcdTUzMTYgPSBcdTUyMDdcdTU2RkUvXHU4ODY1XHU2MDJBXHVGRjA5XHUyMTkyIFx1NEVFNVx1NUI4M1x1NEUzQVx1NTFDNlx1OTFDRFx1NUVGQSBzZXJ2ZXIgXHU0RkE3XHU2NTRDXHU2MDJBXHU4ODY4XG4gICAgICAvLyAgICBcdTI0NjEgXHU2QjdCXHU0RUExXHU3Njg0XHU1NzMwXHU1NkZFXHU2MDJBXHU4QkIwIHJlc3Bhd25BdFx1RkYxQlx1NzNBOVx1NUJCNlx1NzlCQlx1NUYwMFx1OEJFNVx1NTczMFx1NTZGRSAzMCBcdTc5RDJcdTU0MEVcdTkxQ0RcdTY1QjBcdTc1MUZcdTYyMTBcdUZGMDhnYW1lLm1kXHVGRjFBXHU3OUJCXHU1RjAwXHU1RjUzXHU1MjREXHU1NzMwXHU1NkZFMzBcdTc5RDJcdTU0MEVcdTkxQ0RcdTY1QjBcdTc1MUZcdTYyMTBcdTkxQ0VcdTYwMkFcdUZGMDlcbiAgICAgIGNvbnN0IGxlID0gcC5sb2NhbEVuZW1pZXM7XG4gICAgICBpZiAobGUgJiYgQXJyYXkuaXNBcnJheShsZS5saXN0KSAmJiBsZS5lcG9jaCAhPT0gbGFzdFN0YXRlLl9tb2JFcG9jaCkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIltkZXZIb3N0XSBcdTY1MzZcdTUyMzBcdTY1QjBcdTZFMDVcdTUzNTUgZXBvY2g9XCIgKyBsZS5lcG9jaCArIFwiIGxpc3Q9XCIgKyBsZS5saXN0Lmxlbmd0aCArIFwiIChcdTRFNEJcdTUyNEQ9XCIgKyBsYXN0U3RhdGUuX21vYkVwb2NoICsgXCIpXCIpO1xuICAgICAgICBsYXN0U3RhdGUuX21vYkVwb2NoID0gbGUuZXBvY2g7XG4gICAgICAgIC8vIFx1NEZERFx1NzU1OVx1NzNBOVx1NUJCNi9cdTc2REZcdTUzQ0JcdUZGMENcdTUyMjBcdTk2NjQgc2VydmVyIFx1NEZBN1x1NTE2OFx1OTBFOFx1NjU0Q1x1NjAyQVx1RkYwOFx1NUJBMlx1NjIzN1x1N0FFRlx1NjYyRlx1Njc0M1x1NUEwMVx1RkYwOVxuICAgICAgICBjb25zdCBrZWVwID0gZW50cy5maWx0ZXIoKGUpID0+IGUuc2lkZSAhPT0gXCJlbmVteVwiKTtcbiAgICAgICAgY29uc3QgYm91bmRzID0gbGUuYm91bmRzIHx8IHsgbHg6IDI5LCBseTogMTkgfTtcbiAgICAgICAgZm9yIChjb25zdCBtIG9mIGxlLmxpc3QpIHtcbiAgICAgICAgICBrZWVwLnB1c2goe1xuICAgICAgICAgICAgaWQ6IG0uaWQsIG5hbWU6IG0ubmFtZSwgc2lkZTogXCJlbmVteVwiLFxuICAgICAgICAgICAgeDogbS54LCB5OiBtLnksIHZ4OiAwLCB2eTogMCxcbiAgICAgICAgICAgIGhwOiBtLmhwLCBtYXhIcDogbS5tYXhIcCB8fCBtLmhwLFxuICAgICAgICAgICAgbXA6IDAsIG1heE1wOiAwLCBleHA6IG0uZXhwIHx8IDAsIGV4cFRvTmV4dDogMCxcbiAgICAgICAgICAgIGxldmVsOiBtLmxldmVsIHx8IDEsIGF0azogbS5hdGssIGRlZjogbS5kZWYsXG4gICAgICAgICAgICBmYWNpbmc6IDE4MCwgY29vbGRvd246IDAsIGFsaXZlOiBtLmFsaXZlICE9PSBmYWxzZSxcbiAgICAgICAgICAgIGF2YXRhclBhdGg6IG0uYXZhdGFyUGF0aCwgaXNSYW5nZWQ6IG0uaXNSYW5nZWQgPT09IHRydWUsXG4gICAgICAgICAgICBob21lWDogbS54LCBob21lWTogbS55LCAgICAgICAgICAgIC8vIFx1MjYwNSBcdTYyRjRcdTdFRjNcdTUxRkFcdTc1MUZcdTcwQjkgPSBcdTU3MzBcdTU2RkUganNvbiBcdTc2ODRcdTUxRkFcdTc1MUZcdTcwQjlcbiAgICAgICAgICAgIG1hcE1vYjogdHJ1ZSwgICAgICAgICAgICAgICAgICAgICAgLy8gXHUyNjA1IFx1NjgwN1x1OEJCMFx1RkYxQVx1NTczMFx1NTZGRVx1NjAyQVx1RkYwOFx1NzlCQlx1NUYwMFx1NTczMFx1NTZGRSAzMHMgXHU5MUNEXHU3NTFGXHVGRjA5XG4gICAgICAgICAgICBfZGVhZEF0OiBtLmFsaXZlID09PSBmYWxzZSA/IDAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGFzdFN0YXRlLmVudGl0aWVzID0ga2VlcDtcbiAgICAgICAgbGFzdFN0YXRlLmV2ZW50cy5wdXNoKFwiW21vY2tdIFx1NTczMFx1NTZGRVx1OTFDRVx1NjAyQVx1NTQwQ1x1NkI2NVx1RkYwOFwiICsgbGUubGlzdC5sZW5ndGggKyBcIiBcdTUzRUFcdUZGMDlcIik7XG4gICAgICB9XG4gICAgICAvLyBcdTUxNzNcdTUzNjFcdTU0MERcdThEREZcdThFMkFcdUZGMDhcdTRFQzVcdTY1RTVcdTVGRDdcdTc1MjhcdUZGMENcdTRFMERcdTUwNUFcdTUyMzdcdTYwMkFcdTYzQTdcdTUyMzZcdUZGMDlcbiAgICAgIGlmIChjdXJyZW50TGV2ZWxOYW1lICE9PSBsYXN0U3RhdGUuX21vYkxldmVsKSB7XG4gICAgICAgIGxhc3RTdGF0ZS5fbW9iTGV2ZWwgPSBjdXJyZW50TGV2ZWxOYW1lO1xuICAgICAgfVxuICAgICAgLy8gNi4gXHU5OEQ4XHU1QjU3L3ZmeC9jZCBcdTg4NzBcdTUxQ0ZcbiAgICAgIGxhc3RTdGF0ZS5mbG9hdGVycyA9IGxhc3RTdGF0ZS5mbG9hdGVycy5maWx0ZXIoKGYpID0+IHsgZi5saWZlLS07IHJldHVybiBmLmxpZmUgPiAwOyB9KTtcbiAgICAgIGlmIChsYXN0U3RhdGUudmZ4KSBsYXN0U3RhdGUudmZ4ID0gbGFzdFN0YXRlLnZmeC5maWx0ZXIoKHYpID0+IHsgdi5saWZlLS07IHJldHVybiB2LmxpZmUgPiAwOyB9KTtcbiAgICAgIC8vIFx1MjYwNSBcdTYyODBcdTgwRkQgY2QgXHU2QkNGIHRpY2sgLTFcdUZGMDhjYXN0U2tpbGwgXHU2NUY2IGRldi1ob3N0IFx1NURGMlx1OEJCRSBjZExlZnQ9Y2RcdUZGMDlcbiAgICAgIGZvciAoY29uc3Qgc2sgb2YgbGFzdFN0YXRlLnNraWxscyB8fCBbXSkge1xuICAgICAgICBpZiAoc2suY2RMZWZ0ICYmIHNrLmNkTGVmdCA+IDApIHNrLmNkTGVmdCA9IE1hdGgubWF4KDAsIHNrLmNkTGVmdCAtIDEpO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlIG9mIGVudHMpIHtcbiAgICAgICAgaWYgKGUuaGl0Rmxhc2hNcyAmJiBlLmhpdEZsYXNoTXMgPiAwKSBlLmhpdEZsYXNoTXMgPSBNYXRoLm1heCgwLCBlLmhpdEZsYXNoTXMgLSAxMDApO1xuICAgICAgICBpZiAoZS5hY3Rpb25Cb2JNcyAmJiBlLmFjdGlvbkJvYk1zID4gMCkgZS5hY3Rpb25Cb2JNcyA9IE1hdGgubWF4KDAsIGUuYWN0aW9uQm9iTXMgLSAxMDApO1xuICAgICAgfVxuICAgICAgLy8gNy4gXHU1NkRFXHU2M0E4XG4gICAgICAgIHBvc3QobGFzdFN0YXRlKTtcbiAgICAgIH0sIDEwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFx1NUJBMlx1NjIzN1x1N0FFRlx1NTNEMVx1Njc2NSB0aWNrXHVGRjFBXHU3RjEzXHU1QjU4XHU1MjMwIHBlbmRpbmdcdUZGMENcdTc1MzFcdTY3MERcdTUyQTFcdTU2NjhcdTVCOUFcdTY1RjZcdTU2NjhcdTgxRUFcdTVERjFcdTUzRDZcbiAgICB3aW5kb3cuX2Rldkhvc3RQZW5kaW5nID0gZC5wYXJhbXMgfHwge307XG4gIH1cbiAgLy8gXHU1OTA0XHU3NDA2IHNraWxsIC8gaXRlbSBcdTdCNDlcdTUxNzZcdTRFRDYgYWN0aW9uXG4gIGlmIChkLnR5cGUgPT09IFwidGZfcGx1Z2luX3RpY2tcIiAmJiAoZC5hY3Rpb24gPT09IFwic2tpbGxcIiB8fCBkLmFjdGlvbiA9PT0gXCJpdGVtXCIgfHwgZC5hY3Rpb24gPT09IFwicGFnZVwiIHx8IGQuYWN0aW9uID09PSBcImV4aXRcIikpIHtcbiAgICBpZiAoIWxhc3RTdGF0ZSkgcmV0dXJuO1xuICAgIC8vIFx1MjYwNSBleGl0XHVGRjFBXHU2QTIxXHU2MkRGIGVudHJ5LmpzIGhhbmRsZV9hY3Rpb24oXCJleGl0XCIpIFx1NzY4NFx1N0VEM1x1N0I5N1x1RkYxQVxuICAgIC8vICAgcGhhc2U9b3Zlclx1RkYwQ3Jlc3VsdD17cmVhc29uOlwiZXhpdFwiLCBleHAsIG1vbmV5LCBkcm9wcywga2lsbHMsIHN1cnZpdmVkVGlja3N9XG4gICAgaWYgKGQuYWN0aW9uID09PSBcImV4aXRcIiAmJiBsYXN0U3RhdGUucGhhc2UgPT09IFwicGxheWluZ1wiKSB7XG4gICAgICBsYXN0U3RhdGUucGhhc2UgPSBcIm92ZXJcIjtcbiAgICAgIGxhc3RTdGF0ZS5yZXN1bHQgPSB7XG4gICAgICAgIHJlYXNvbjogXCJleGl0XCIsXG4gICAgICAgIGV4cDogbGFzdFN0YXRlLmV4cCB8fCAwLFxuICAgICAgICBtb25leTogbGFzdFN0YXRlLm1vbmV5IHx8IDAsXG4gICAgICAgIGRyb3BzOiBbLi4uKGxhc3RTdGF0ZS5kcm9wcyB8fCBbXSldLFxuICAgICAgICBraWxsczogbGFzdFN0YXRlLmtpbGxzIHx8IDAsXG4gICAgICAgIHN1cnZpdmVkVGlja3M6IGxhc3RTdGF0ZS50aWNrIHx8IDAsXG4gICAgICB9O1xuICAgICAgbGFzdFN0YXRlLmV2ZW50cy5wdXNoKFwiW21vY2tdIFx1NzNBOVx1NUJCNlx1NEUzQlx1NTJBOFx1OTAwMFx1NTFGQVx1RkYwOFx1OTFDRVx1NTkxNlx1NzUxRlx1NUI1OFx1N0VEM1x1Njc1Rlx1RkYwOVwiKTtcbiAgICB9XG4gICAgLy8gXHU3QjgwXHU1MzE2XHVGRjFBc2tpbGwvaXRlbSBcdTc2RjRcdTYzQTVcdTdFRDlcdTRFMkFcdTU2REVcdTUzMDVcdUZGMDhcdTU0MENcdTZCNjVcdUZGMENcdTRFMERcdThENzAgc2V0VGltZW91dFx1RkYwOVxuICAgIGlmIChkLmFjdGlvbiA9PT0gXCJza2lsbFwiICYmIGQucGFyYW1zKSB7XG4gICAgICBjb25zdCBtZTIgPSBsYXN0U3RhdGUuZW50aXRpZXMuZmluZCgoZSkgPT4gZS5zaWRlID09PSBcInBsYXllclwiKTtcbiAgICAgIGNvbnN0IHNrID0gbGFzdFN0YXRlLnNraWxscz8uW2QucGFyYW1zLmluZGV4XTtcbiAgICAgIGlmIChtZTIgJiYgc2spIHtcbiAgICAgICAgaWYgKCFsYXN0U3RhdGUudmZ4KSBsYXN0U3RhdGUudmZ4ID0gW107XG4gICAgICAgIGNvbnN0IGlkID0gXCJ2ZnhfXCIgKyBsYXN0U3RhdGUudGljayArIFwiX1wiICsgTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNik7XG4gICAgICAgIGlmIChzay5uYW1lID09PSBcIlx1NTFCMlx1NjVBOVwiKSB7XG4gICAgICAgICAgbGFzdFN0YXRlLnZmeC5wdXNoKHtcbiAgICAgICAgICAgIGlkLCBraW5kOiBcInNsYXNoX2FyY1wiLCBlbnRpdHlJZDogbWUyLmlkLFxuICAgICAgICAgICAgeDogbWUyLngsIHk6IG1lMi55LFxuICAgICAgICAgICAgZmFjaW5nOiBtZTIuZmFjaW5nLCBsaWZlOiAxMiwgdG90YWw6IDEyLFxuICAgICAgICAgICAgY29sb3I6IFwiI2ZmZlwiLCBzaXplOiAxLjYsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc2submFtZSA9PT0gXCJcdTcwNkJcdTc0MDNcIikge1xuICAgICAgICAgIC8vIFx1MjYwNSBcdTcwNkJcdTc0MDNcdTc2RUVcdTY4MDcgPSBcdTgzMDNcdTU2RjRcdTUxODVcdTY3MDBcdThGRDFcdTc2ODRcdTY1NENcdTRFQkFcdUZGMUJcdTYyNTNcdThGQzdcdTUzQkJcdTRFQTdcdTc1MUYgZG1nL1x1OThEOFx1NUI1Ny9cdTU0N0RcdTRFMkRcdTcyNzlcdTY1NDhcbiAgICAgICAgICBsZXQgdGFyZ2V0ID0gbnVsbCwgbWluRCA9IEluZmluaXR5O1xuICAgICAgICAgIGZvciAoY29uc3QgZTIgb2YgbGFzdFN0YXRlLmVudGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoZTIuc2lkZSAhPT0gXCJlbmVteVwiIHx8ICFlMi5hbGl2ZSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBkZCA9IE1hdGguaHlwb3QoZTIueCAtIG1lMi54LCBlMi55IC0gbWUyLnkpO1xuICAgICAgICAgICAgaWYgKGRkIDwgbWluRCAmJiBkZCA8IDEyKSB7IG1pbkQgPSBkZDsgdGFyZ2V0ID0gZTI7IH1cbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgdHggPSB0YXJnZXQgPyB0YXJnZXQueCA6IG1lMi54ICsgTWF0aC5jb3MoKG1lMi5mYWNpbmcgfHwgMCkgKiBNYXRoLlBJIC8gMTgwKSAqIDEwO1xuICAgICAgICAgIGNvbnN0IHR5ID0gdGFyZ2V0ID8gdGFyZ2V0LnkgOiBtZTIueSAtIE1hdGguc2luKChtZTIuZmFjaW5nIHx8IDApICogTWF0aC5QSSAvIDE4MCkgKiAxMDtcbiAgICAgICAgICBsYXN0U3RhdGUudmZ4LnB1c2goe1xuICAgICAgICAgICAgaWQsIGtpbmQ6IFwiZmlyZWJhbGxcIiwgZW50aXR5SWQ6IG1lMi5pZCxcbiAgICAgICAgICAgIHRhcmdldEVudGl0eUlkOiB0YXJnZXQ/LmlkLFxuICAgICAgICAgICAgeDogbWUyLngsIHk6IG1lMi55LFxuICAgICAgICAgICAgdGFyZ2V0WDogdHgsIHRhcmdldFk6IHR5LFxuICAgICAgICAgICAgZmFjaW5nOiBtZTIuZmFjaW5nLCBsaWZlOiAxNiwgdG90YWw6IDE2LFxuICAgICAgICAgICAgY29sb3I6IFwiI2ZmNmEwMFwiLCBzaXplOiAxLjAsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgLy8gXHUyNjA1IFx1NTQ3RFx1NEUyRFx1NEYyNFx1NUJCM1x1RkYwOFx1NUYzOVx1NEY1M1x1NTIzMFx1OEZCRVx1NTQwRVx1RkYwOVxuICAgICAgICAgIGlmICh0YXJnZXQpIHtcbiAgICAgICAgICAgIGNvbnN0IGRtZyA9IE1hdGgubWF4KDEsIChzay5wb3dlciB8fCAyMCkgKyBNYXRoLmZsb29yKChtZTIuYXRrIHx8IDMwKSAqIDAuNSkgLSAodGFyZ2V0LmRlZiB8fCAwKSk7XG4gICAgICAgICAgICB0YXJnZXQuaHAgPSBNYXRoLm1heCgwLCB0YXJnZXQuaHAgLSBkbWcpO1xuICAgICAgICAgICAgdGFyZ2V0LmhpdEZsYXNoTXMgPSAyNTA7XG4gICAgICAgICAgICBsYXN0U3RhdGUuZmxvYXRlcnMucHVzaCh7IGlkOiBcImZcIiArIGxhc3RTdGF0ZS50aWNrICsgXCJfXCIgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA2KSwgdGV4dDogXCItXCIgKyBkbWcsIHg6IHRhcmdldC54LCB5OiB0YXJnZXQueSAtIDEwLCBsaWZlOiAxMiwga2luZDogXCJkYW1hZ2VcIiwgY29sb3I6IFwiI2ZmNWE1YVwiIH0pO1xuICAgICAgICAgICAgbGFzdFN0YXRlLnZmeC5wdXNoKHsgaWQ6IFwidmZ4X1wiICsgbGFzdFN0YXRlLnRpY2sgKyBcIl9cIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBraW5kOiBcImV4cGxvc2lvblwiLCBlbnRpdHlJZDogdGFyZ2V0LmlkLCB4OiB0YXJnZXQueCwgeTogdGFyZ2V0LnksIGxpZmU6IDYsIHRvdGFsOiA2LCBjb2xvcjogXCIjZmY4YzNhXCIgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNrLm5hbWUgPT09IFwiXHU2Q0JCXHU3NTk3XCIpIHtcbiAgICAgICAgICBsYXN0U3RhdGUudmZ4LnB1c2goe1xuICAgICAgICAgICAgaWQsIGtpbmQ6IFwiaGVhbF9yaW5nXCIsIGVudGl0eUlkOiBtZTIuaWQsXG4gICAgICAgICAgICB4OiBtZTIueCwgeTogbWUyLnksXG4gICAgICAgICAgICBmYWNpbmc6IDAsIGxpZmU6IDE4LCB0b3RhbDogMTgsXG4gICAgICAgICAgICBjb2xvcjogXCIjN0NGRkIyXCIsIHNpemU6IDEuMCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChzay5uYW1lID09PSBcIlx1NjJBNFx1NzZGRVwiKSB7XG4gICAgICAgICAgbGFzdFN0YXRlLnZmeC5wdXNoKHtcbiAgICAgICAgICAgIGlkLCBraW5kOiBcImJ1ZmZfcmluZ1wiLCBlbnRpdHlJZDogbWUyLmlkLFxuICAgICAgICAgICAgeDogbWUyLngsIHk6IG1lMi55LFxuICAgICAgICAgICAgZmFjaW5nOiAwLCBsaWZlOiAzMCwgdG90YWw6IDMwLFxuICAgICAgICAgICAgY29sb3I6IFwiIzlDQ0ZGRlwiLCBzaXplOiAxLjAsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgc2suY2RMZWZ0ID0gc2suY2QgfHwgMDtcbiAgICAgIH1cbiAgICB9XG4gICAgcG9zdChsYXN0U3RhdGUpO1xuICB9XG4gIC8vIFx1MjYwNSBpdGVtXHVGRjFBXHU3OEU4XHU1MjAwXHU3N0YzL1x1NUYwMFx1NUM3MVx1NTIwMC9cdTY2QUVcdTUxNDlcdTRGNjlcdTUyNTEvXHU0RUVBXHU1RjBGXHU5NTdGXHU1MjUxIFx1MjE5MiBidWZmIFx1N0VEOVx1NzNBOVx1NUJCNlx1RkYwOFx1NTQ3RFx1NEUyRCthdGtcdUZGMDlcdUZGMENcdTkxNEQgYnVmZl9yaW5nIHZmeFxuICBpZiAoZC50eXBlID09PSBcInRmX3BsdWdpbl90aWNrXCIgJiYgZC5hY3Rpb24gPT09IFwiaXRlbVwiKSB7XG4gICAgaWYgKCFsYXN0U3RhdGUpIHJldHVybjtcbiAgICBjb25zdCBtZTMgPSBsYXN0U3RhdGUuZW50aXRpZXMuZmluZCgoZSkgPT4gZS5zaWRlID09PSBcInBsYXllclwiKTtcbiAgICBjb25zdCBpdCA9IGxhc3RTdGF0ZS5pdGVtcz8uW2QucGFyYW1zPy5pbmRleF07XG4gICAgaWYgKG1lMyAmJiBpdCkge1xuICAgICAgaWYgKCFsYXN0U3RhdGUudmZ4KSBsYXN0U3RhdGUudmZ4ID0gW107XG4gICAgICBjb25zdCBpZCA9IFwidmZ4X1wiICsgbGFzdFN0YXRlLnRpY2sgKyBcIl9cIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpO1xuICAgICAgbGFzdFN0YXRlLnZmeC5wdXNoKHsgaWQsIGtpbmQ6IFwiYnVmZl9yaW5nXCIsIGVudGl0eUlkOiBtZTMuaWQsIHg6IG1lMy54LCB5OiBtZTMueSwgZmFjaW5nOiAwLCBsaWZlOiAyNCwgdG90YWw6IDI0LCBjb2xvcjogXCIjRkZDQzU1XCIsIHNpemU6IDEuMCB9KTtcbiAgICAgIC8vIFx1MjYwNSBidWZmXHVGRjFBXHU0RTM0XHU2NUY2XHU1ODlFXHU1MkEwIGF0a1x1RkYwODMwIHRpY2tcdUZGMDlcdUZGMENcdTUzRTBcdTUyQTBcdTU3MjggbWUzLmF0a1xuICAgICAgaWYgKCFtZTMuX2F0a0J1ZmZMZWZ0TXMpIG1lMy5fYXRrQnVmZkxlZnRNcyA9IDA7XG4gICAgICBtZTMuX2F0a0J1ZmZMZWZ0TXMgPSAzMDtcbiAgICB9XG4gICAgcG9zdChsYXN0U3RhdGUpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBcdTI2MDUgcmV2aXZlXHVGRjFBXHU1OTBEXHU2RDNCXHU3M0E5XHU1QkI2XHVGRjA4XHU1MzRBXHU4ODQwXHU1NkRFXHU1NzNBXHVGRjA5XHVGRjBDXHU2RTA1XHU3QTdBXHU1NDY4XHU1NkY0XHU2NTRDXHU0RUJBXHU3RUQ5XHU3M0E5XHU1QkI2XHU1NTk4XHU2MDZGXHU3QTdBXHU5NUY0XG4gIGlmIChkLnR5cGUgPT09IFwidGZfcGx1Z2luX3RpY2tcIiAmJiBkLmFjdGlvbiA9PT0gXCJyZXZpdmVcIikge1xuICAgIGlmICghbGFzdFN0YXRlKSByZXR1cm47XG4gICAgY29uc3QgbWUyID0gbGFzdFN0YXRlLmVudGl0aWVzLmZpbmQoKGUpID0+IGUuc2lkZSA9PT0gXCJwbGF5ZXJcIik7XG4gICAgaWYgKG1lMikge1xuICAgICAgbWUyLmFsaXZlID0gdHJ1ZTtcbiAgICAgIG1lMi5ocCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IobWUyLm1heEhwIC8gMikpO1xuICAgICAgbWUyLmNvb2xkb3duID0gMDtcbiAgICB9XG4gICAgbGFzdFN0YXRlLmVudGl0aWVzID0gbGFzdFN0YXRlLmVudGl0aWVzLmZpbHRlcigoZSkgPT4gZS5zaWRlICE9PSBcImVuZW15XCIpO1xuICAgIGxhc3RTdGF0ZS5waGFzZSA9IFwicGxheWluZ1wiO1xuICAgIGxhc3RTdGF0ZS5yZXN1bHQgPSBudWxsO1xuICAgIGxhc3RTdGF0ZS5fd2F2ZVRpbWVyID0gMDtcbiAgICBsYXN0U3RhdGUuZXZlbnRzLnB1c2goXCJbbW9ja10gXHU1OTBEXHU2RDNCXHU2MjEwXHU1MjlGXHVGRjA4XHU1MzRBXHU4ODQwXHU1NkRFXHU1RjUyXHVGRjA5XCIpO1xuICAgIHBvc3QobGFzdFN0YXRlKTtcbiAgICBsb2coXCJob3N0XHUyMTkyIHJldml2ZSBcdTIxOTIgcGhhc2U9cGxheWluZ1wiKTtcbiAgfVxufSk7XG48L3NjcmlwdD5cbjwvYm9keT5cbjwvaHRtbD5gO1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9fX2Rldl9ob3N0XCIsIChfcmVxLCByZXMpID0+IHtcbiAgICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvaHRtbDsgY2hhcnNldD11dGYtOFwiKTtcbiAgICAgICAgcmVzLmVuZChQQUdFKTtcbiAgICAgIH0pO1xuICAgICAgLy8gLS1jb25uIFx1NkEyMVx1NUYwRlx1NEUwQlx1NjgzOVx1OERFRlx1NUY4NFx1NzZGNFx1NjNBNVx1OEZEQlx1NjJERlx1NzcxRlx1NUJCRlx1NEUzQlx1Njg2OVx1RkYwOFx1NzUyOFx1NjIzN1x1NEUwRFx1NzUyOFx1OEJCMCAvX19kZXZfaG9zdFx1RkYwOVxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShcIi9cIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGNvbnN0IHUgPSByZXEudXJsIHx8IFwiL1wiO1xuICAgICAgICAvLyA/X19pbm5lcj0xIFx1NjYyRiBkZXYtaG9zdCBcdTUxODVcdTVENEMgaWZyYW1lIFx1NzY4NFx1NjgwN1x1OEJCMFx1RkYwQ1x1NTJBMFx1OEY3RFx1NzcxRlx1NkI2M1x1NzY4NFx1NkUzOFx1NjIwRlx1NjcyQ1x1NEY1M1x1RkYwOFx1NEUwRFx1NTE4RFx1OTFDRFx1NUI5QVx1NTQxMVx1RkYwOVxuICAgICAgICBpZiAodS5pbmNsdWRlcyhcIl9faW5uZXI9MVwiKSkgcmV0dXJuIG5leHQoKTtcbiAgICAgICAgLy8gXHU5NzU5XHU2MDAxXHU4RDQ0XHU2RTkwIC8gXHU4RDQ0XHU2RTkwXHU4REVGXHU1Rjg0XHU5MDBGXHU0RjIwXG4gICAgICAgIGlmICh1ICE9PSBcIi9cIiAmJiAhdS5zdGFydHNXaXRoKFwiLz9cIikpIHJldHVybiBuZXh0KCk7XG4gICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJ0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLThcIik7XG4gICAgICAgIHJlcy5lbmQoUEFHRSk7XG4gICAgICB9KTtcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIFx1Njc4NFx1NUVGQVx1NEUzQVx1NTM1NVx1NEUyQVx1ODFFQVx1NTMwNVx1NTQyQiBIVE1MXHVGRjA4XHU1MTg1XHU4MDU0IEpTL0NTU1x1RkYwOVx1RkYwQ1xuICogXHU4RjkzXHU1MUZBXHU1MjMwXHU2M0QyXHU0RUY2IHVpL2dhbWUuaHRtbFx1RkYwQ1x1NzUzMVx1NTQwRVx1N0FFRiAvcGx1Z2luL2dldEFzc2V0IFx1NjNEMFx1NEY5Qlx1N0VEOSBpZnJhbWUgXHU1MkEwXHU4RjdEXHUzMDAyXG4gKlxuICogLS1zdG9yeSBcdTUzQzJcdTY1NzBcdTkwMUFcdThGQzcgY3Jvc3MtZW52IFx1NEYyMFx1NTE2NVx1RkYwQ1ZJVEVfU1RPUlkvVklURV9DT05OIFx1NzUzMSBWaXRlIFx1NkNFOFx1NTE2NVx1NTIzMFx1NTI0RFx1N0FFRlxuICogXHVGRjA4XHU1M0VBXHU2NzA5IFZJVEVfIFx1NTI0RFx1N0YwMFx1NzY4NCBlbnYgXHU1M0Q4XHU5MUNGXHU2MjREXHU0RjFBXHU2Q0U4XHU1MTY1XHVGRjA5XHUzMDAyXG4gKlxuICogLS1jb25uIFx1NkEyMVx1NUYwRlx1NEYxQVx1OTg5RFx1NTkxNlx1NkNFOFx1NTE4QyAvX19kZXZfaG9zdCBcdTYyREZcdTc3MUZcdTVCQkZcdTRFM0JcdTY4NjlcdTk4NzVcdTk3NjJcdUZGMUFcbiAqICAgXHU4QkJGXHU5NUVFIGh0dHA6Ly9sb2NhbGhvc3Q6MzAwMC9fX2Rldl9ob3N0IFx1NTM3M1x1NTNFRlx1NTcyOFx1NkQ0Rlx1ODlDOFx1NTY2OFx1NTE4NVx1OTAwOVx1NEVCQVx1MzAwMVx1NUYwMFx1NTlDQlx1NkUzOFx1NjIwRlx1RkYwOFx1NjVFMFx1OTcwMFx1NTNFNlx1NTQyRlx1NjcwRFx1NTJBMVx1RkYwOVx1MzAwMlxuICovXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XG4gIC8vIFx1NTJBMFx1OEY3RCAuZW52Ljxtb2RlPiBcdTY1ODdcdTRFRjZcdUZGMDhkZWJ1ZyBcdTZBMjFcdTVGMEZcdTRFMEJcdThENzAgLmVudi5kZWJ1Z1x1RkYwOVxuICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIHByb2Nlc3MuY3dkKCksIFwiXCIpO1xuICAvLyB3b3Jrc2hvcHMgXHU3NkVFXHU1RjU1XHU1NzI4IHZ1ZS8gXHU3Njg0IC4uLy4uL3dvcmtzaG9wcy9cbiAgY29uc3Qgd29ya3Nob3BzUm9vdCA9IHJlc29sdmUoX19kaXJuYW1lLCBcIi4uXCIsIFwiLi5cIiwgXCIuLlwiLCBcIndvcmtzaG9wc1wiKTtcbiAgcmV0dXJuIHtcbiAgICBwbHVnaW5zOiBbXG4gICAgICB2dWUoKSxcbiAgICAgIHZpdGVTaW5nbGVGaWxlKCksXG4gICAgICAvLyBcdTRFQzVcdTU3MjhcdTk3NUVcdTc1MUZcdTRFQTdcdTZBMjFcdTVGMEZcdTZDRThcdTUxOENcdTRFMkRcdTk1RjRcdTRFRjZcbiAgICAgIC4uLihtb2RlID09PSBcInByb2R1Y3Rpb25cIiA/IFtdIDogW3N0b3J5RGF0YVBsdWdpbih3b3Jrc2hvcHNSb290KSwgZGV2SG9zdFBsdWdpbihlbnYuQ09OTiA/PyBcIlwiLCBlbnYuU1RPUlkgPz8gXCJcIildKSxcbiAgICBdLFxuICAgIHNlcnZlcjoge1xuICAgICAgcG9ydDogMzAwMCxcbiAgICAgIC8vIFx1MjYwNSBcdTUxNDFcdThCQjggLS1jb25uIFx1NjJERlx1NzcxRlx1NUJCRlx1NEUzQlx1Njg2OVx1OTAxQVx1OEZDNyAvQGZzLyBcdTUyQThcdTYwMDEgaW1wb3J0IFx1NjNEMlx1NEVGNlx1NTE2NVx1NTNFMyBlbnRyeS5qc1xuICAgICAgLy8gICBcdUZGMDh2aXRlIFx1OUVEOFx1OEJBNFx1NTNFQVx1NTE0MVx1OEJCOCB3b3Jrc3BhY2Ugcm9vdD12dWUvIFx1NzZFRVx1NUY1NVx1RkYwQ2VudHJ5LmpzIFx1NTcyOFx1NTE3Nlx1NEUwQVx1NEUwMFx1N0VBN1x1RkYwOVxuICAgICAgZnM6IHtcbiAgICAgICAgYWxsb3c6IFtcbiAgICAgICAgICByZXNvbHZlKF9fZGlybmFtZSksICAgICAgICAgICAgICAvLyB2dWUvXG4gICAgICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi5cIiksICAgICAgICAvLyBwbHVnaW5zL3Rvb25mbG93LWZpZWxkLXN1cnZpdmFsL1xuICAgICAgICAgIHJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy4uLy4uXCIpLCAgLy8gdG9vbmZsb3ctZ2FtZS1wbHVnaW5zL1xuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGRlZmluZToge1xuICAgICAgLy8gVml0ZSBcdTlFRDhcdThCQTRcdTRFMERcdTZDRThcdTUxNjVcdTk3NUUgVklURV8gXHU1MjREXHU3RjAwXHU3Njg0XHU1M0Q4XHU5MUNGXHU1MjMwXHU1QkEyXHU2MjM3XHU3QUVGXHVGRjBDXHU4RkQ5XHU5MUNDXHU2NjNFXHU1RjBGXHU2NkI0XHU5NzMyXG4gICAgICBfX1NUT1JZX186IEpTT04uc3RyaW5naWZ5KGVudi5TVE9SWSA/PyBcIlwiKSxcbiAgICAgIF9fQ09OTl9fOiBKU09OLnN0cmluZ2lmeShlbnYuQ09OTiA/PyBcIlwiKSxcbiAgICB9LFxuICAgIGJhc2U6IFwiLi9cIixcbiAgICBidWlsZDoge1xuICAgICAgb3V0RGlyOiBcIi4uL3VpXCIsXG4gICAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICAgIGFzc2V0c0lubGluZUxpbWl0OiAxMDAgKiAxMDI0ICogMTAyNCxcbiAgICAgIHRhcmdldDogXCJlczIwMjBcIixcbiAgICB9LFxuICB9O1xufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF3ZCxTQUFTLGNBQWMsZUFBdUI7QUFDdGdCLFNBQVMsZUFBZTtBQUN4QixTQUFTLGNBQWMsa0JBQWtCO0FBQ3pDLE9BQU8sVUFBVTtBQUVqQixPQUFPLFNBQVM7QUFDaEIsU0FBUyxzQkFBc0I7QUF3Qi9CLFNBQVMscUJBQXFCO0FBOUJtUixJQUFNLDJDQUEyQztBQVVsVyxTQUFTLGdCQUFnQixTQUF1QjtBQUM5QyxNQUFJLENBQUMsV0FBVyxPQUFPLEVBQUc7QUFDMUIsTUFBSTtBQUNGLFVBQU0sVUFBVSxhQUFhLFNBQVMsT0FBTztBQUM3QyxlQUFXLE9BQU8sUUFBUSxNQUFNLE9BQU8sR0FBRztBQUN4QyxZQUFNLE9BQU8sSUFBSSxLQUFLO0FBQ3RCLFVBQUksQ0FBQyxRQUFRLEtBQUssV0FBVyxHQUFHLEVBQUc7QUFDbkMsWUFBTSxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQzNCLFVBQUksS0FBSyxFQUFHO0FBQ1osWUFBTSxJQUFJLEtBQUssTUFBTSxHQUFHLEVBQUUsRUFBRSxLQUFLO0FBQ2pDLFVBQUksSUFBSSxLQUFLLE1BQU0sS0FBSyxDQUFDLEVBQUUsS0FBSztBQUVoQyxVQUFLLEVBQUUsV0FBVyxHQUFJLEtBQUssRUFBRSxTQUFTLEdBQUksS0FBTyxFQUFFLFdBQVcsR0FBRyxLQUFLLEVBQUUsU0FBUyxHQUFHLEdBQUk7QUFDdEYsWUFBSSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQUEsTUFDbkI7QUFDQSxVQUFJLEVBQUUsS0FBSyxRQUFRLEtBQU0sU0FBUSxJQUFJLENBQUMsSUFBSTtBQUFBLElBQzVDO0FBQUEsRUFDRixRQUFRO0FBQUEsRUFBQztBQUNYO0FBR0EsSUFBTSxhQUFhLGNBQWMsd0NBQWU7QUFDaEQsSUFBTSxZQUFZLGNBQWMsSUFBSSxJQUFJLEtBQUssd0NBQWUsQ0FBQztBQUU3RDtBQUNFLFFBQU0sVUFBVSxRQUFRLFdBQVcsZUFBZTtBQUNsRCxrQkFBZ0IsT0FBTztBQUN6QjtBQUdBLFNBQVMsZ0JBQWdCLGVBQStCO0FBQ3RELFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLGdCQUFnQixRQUFRO0FBQ3RCLGFBQU8sWUFBWSxJQUFJLGVBQWUsQ0FBQyxLQUFLLFFBQVE7QUFDbEQsY0FBTSxXQUFXLFFBQVEsZUFBZSxtQkFBbUIsSUFBSSxJQUFLLFFBQVEsT0FBTyxFQUFFLENBQUMsQ0FBQztBQUN2RixZQUFJLENBQUMsU0FBUyxXQUFXLGFBQWEsR0FBRztBQUN2QyxjQUFJLGFBQWE7QUFDakIsY0FBSSxJQUFJLFdBQVc7QUFDbkI7QUFBQSxRQUNGO0FBQ0EsWUFBSSxDQUFDLFdBQVcsUUFBUSxHQUFHO0FBQ3pCLGNBQUksYUFBYTtBQUNqQixjQUFJLElBQUksZ0JBQWdCLFFBQVE7QUFDaEM7QUFBQSxRQUNGO0FBQ0EsWUFBSTtBQUNGLGdCQUFNLFVBQVUsYUFBYSxVQUFVLE9BQU87QUFDOUMsY0FBSSxVQUFVLGdCQUFnQixrQkFBa0I7QUFDaEQsY0FBSSxJQUFJLE9BQU87QUFBQSxRQUNqQixTQUFTLEdBQUc7QUFDVixjQUFJLGFBQWE7QUFDakIsY0FBSSxJQUFJLE9BQU8sQ0FBQyxDQUFDO0FBQUEsUUFDbkI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGO0FBS0EsU0FBUyxjQUFjLE1BQWMsT0FBdUI7QUFDMUQsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sZ0JBQWdCLFFBQVE7QUFDdEIsVUFBSSxDQUFDLFFBQVEsU0FBUyxPQUFPLFNBQVMsUUFBUztBQUMvQyxZQUFNLFFBQVEsU0FBUztBQUN2QixZQUFNLGFBQWEsUUFBUSxXQUFXLGlEQUFpRDtBQUN2RixZQUFNLFdBQVcsUUFDYixrREFBa0QsbUJBQW1CLEtBQUssQ0FBQywrQkFDM0U7QUFHSixZQUFNLGNBQWMsUUFBUSxJQUFJLHdCQUF3QjtBQUN4RCxZQUFNLGFBQWEsUUFBUSxJQUFJLGNBQWM7QUFJN0MsWUFBTSxhQUFhLFFBQVEsV0FBVyxhQUFhO0FBRW5ELGFBQU8sWUFBWSxJQUFJLGVBQWUsQ0FBQyxLQUFLLEtBQUssU0FBUztBQUN4RCxZQUFJO0FBQ0YsZ0JBQU0sY0FBYyxJQUFJLE9BQU8sS0FBSyxRQUFRLE9BQU8sRUFBRTtBQUNyRCxnQkFBTSxVQUFrQyxDQUFDO0FBQ3pDLHFCQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxRQUFRLElBQUksT0FBTyxHQUFHO0FBQ2hELGdCQUFJLE9BQU8sTUFBTSxTQUFVLFNBQVEsQ0FBQyxJQUFJO0FBQUEscUJBQy9CLE1BQU0sUUFBUSxDQUFDLEVBQUcsU0FBUSxDQUFDLElBQUksRUFBRSxLQUFLLElBQUk7QUFBQSxVQUNyRDtBQUNBLGNBQUksV0FBWSxTQUFRLGVBQWUsSUFBSSxZQUFZO0FBQ3ZELGdCQUFNLFdBQVcsS0FBSztBQUFBLFlBQ3BCO0FBQUEsY0FDRSxVQUFVLElBQUksSUFBSSxXQUFXLEVBQUU7QUFBQSxjQUMvQixNQUFNLElBQUksSUFBSSxXQUFXLEVBQUUsUUFBUTtBQUFBLGNBQ25DLFFBQVEsSUFBSTtBQUFBLGNBQ1osTUFBTSxNQUFNO0FBQUEsY0FDWjtBQUFBLFlBQ0Y7QUFBQSxZQUNBLENBQUMsYUFBYTtBQUNaLGtCQUFJLGFBQWEsU0FBUyxjQUFjO0FBQ3hDLHlCQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxRQUFRLFNBQVMsT0FBTyxHQUFHO0FBQ3JELG9CQUFJLEVBQUcsS0FBSSxVQUFVLEdBQUcsQ0FBUTtBQUFBLGNBQ2xDO0FBQ0EsdUJBQVMsS0FBSyxHQUFHO0FBQUEsWUFDbkI7QUFBQSxVQUNGO0FBQ0EsbUJBQVMsR0FBRyxTQUFTLENBQUMsUUFBUTtBQUFFLGdCQUFJLGFBQWE7QUFBSyxnQkFBSSxJQUFJLGtCQUFrQixJQUFJLE9BQU87QUFBQSxVQUFHLENBQUM7QUFDL0YsY0FBSSxLQUFLLFFBQVE7QUFBQSxRQUNuQixTQUFTLEdBQUc7QUFBRSxlQUFLLENBQVE7QUFBQSxRQUFHO0FBQUEsTUFDaEMsQ0FBQztBQUNELGFBQU8sWUFBWSxJQUFJLGFBQWEsQ0FBQyxLQUFLLEtBQUssU0FBUztBQUN0RCxZQUFJO0FBQ0YsZ0JBQU0sSUFBSSxJQUFJLElBQUksSUFBSSxPQUFPLEtBQUssV0FBVztBQUM3QyxnQkFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQ2xDLGdCQUFNLFVBQWtDLENBQUM7QUFDekMscUJBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxPQUFPLFFBQVEsSUFBSSxPQUFPLEdBQUc7QUFDaEQsZ0JBQUksT0FBTyxNQUFNLFNBQVUsU0FBUSxDQUFDLElBQUk7QUFBQSxxQkFDL0IsTUFBTSxRQUFRLENBQUMsRUFBRyxTQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssSUFBSTtBQUFBLFVBQ3JEO0FBRUEsY0FBSSxZQUFZO0FBQ2Qsb0JBQVEsZUFBZSxJQUFJLFlBQVk7QUFBQSxVQUN6QztBQUVBLGdCQUFNLFdBQVcsS0FBSztBQUFBLFlBQ3BCO0FBQUEsY0FDRSxVQUFVLElBQUksSUFBSSxXQUFXLEVBQUU7QUFBQSxjQUMvQixNQUFNLElBQUksSUFBSSxXQUFXLEVBQUUsUUFBUTtBQUFBLGNBQ25DLFFBQVEsSUFBSTtBQUFBLGNBQ1osTUFBTTtBQUFBLGNBQ047QUFBQSxZQUNGO0FBQUEsWUFDQSxDQUFDLGFBQWE7QUFDWixrQkFBSSxhQUFhLFNBQVMsY0FBYztBQUN4Qyx5QkFBVyxDQUFDLEdBQUcsQ0FBQyxLQUFLLE9BQU8sUUFBUSxTQUFTLE9BQU8sR0FBRztBQUNyRCxvQkFBSSxFQUFHLEtBQUksVUFBVSxHQUFHLENBQVE7QUFBQSxjQUNsQztBQUNBLHVCQUFTLEtBQUssR0FBRztBQUFBLFlBQ25CO0FBQUEsVUFDRjtBQUNBLG1CQUFTLEdBQUcsU0FBUyxDQUFDLFFBQVE7QUFDNUIsZ0JBQUksYUFBYTtBQUNqQixnQkFBSSxJQUFJLGtCQUFrQixJQUFJLE9BQU87QUFBQSxVQUN2QyxDQUFDO0FBQ0QsY0FBSSxLQUFLLFFBQVE7QUFBQSxRQUNuQixTQUFTLEdBQUc7QUFDVixlQUFLLENBQVE7QUFBQSxRQUNmO0FBQUEsTUFDRixDQUFDO0FBQ0QsWUFBTSxPQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUEsa0VBSU8sU0FBUyxZQUFZO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLG1DQVlaLEtBQUs7QUFBQTtBQUFBO0FBQUE7QUFBQSxnQkFJeEIsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLG9CQUNqQixLQUFLLFVBQVUsUUFBUSxDQUFDO0FBQUEsc0JBQ3RCLEtBQUssVUFBVSxXQUFXLENBQUM7QUFBQTtBQUFBLHFCQUU1QixLQUFLLFVBQVUsVUFBVSxDQUFDO0FBQUE7QUFBQSxxQkFFMUIsS0FBSyxVQUFVLFdBQVcsUUFBUSxPQUFPLEdBQUcsQ0FBQyxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkNBbU52QyxLQUFLO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFB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
