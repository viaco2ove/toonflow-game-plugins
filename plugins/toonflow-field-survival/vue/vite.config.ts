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
      // ★ 真实插件入口文件：--conn 拟真宿主桩直接加载它执行（薄宿主策略）。
      //   桩只负责「网络代理 + 传参 + 回推 state」，游戏/系统面板全部逻辑走 entry.js，
      //   保证 --conn 调试链路与「插件安装后」链路行为一致。
      const ENTRY_PATH = resolve(__dirname, "../entry.js");
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
  #log{position:fixed;left:8px;bottom:8px;background:#000a;padding:0;border-radius:6px;font:12px monospace;max-width:60%;max-height:60vh;overflow:hidden;z-index:9;line-height:1.5;box-shadow:0 2px 12px #0006;user-select:none}
  #log-header{display:flex;align-items:center;gap:6px;padding:4px 8px;background:#111;border-radius:6px 6px 0 0;cursor:move}
  #log-header .log-title{color:#888;font-size:11px;flex:1}
  #log-toggle{background:none;border:1px solid #444;color:#888;padding:0 5px;border-radius:3px;font-size:11px;cursor:pointer;line-height:1.4}
  #log-body{padding:6px 10px;max-height:calc(30vh - 28px);overflow:auto;white-space:pre-wrap}
  #log.collapsed #log-body{display:none}
  #log.collapsed{max-height:none}
  #log.collapsed #log-header{border-radius:6px}
  #badge{position:fixed;right:8px;top:8px;background:#f33;color:#fff;padding:4px 10px;border-radius:4px;font:12px monospace;z-index:9;max-width:60%;text-align:right}
  #error{position:fixed;inset:30px;display:none;align-items:center;justify-content:center;background:#1a1a1a;color:#f88;font:14px monospace;z-index:10;text-align:center;padding:40px;line-height:2}
</style>
</head>
<body>
<div id="wrap"><iframe id="game" src="/?__inner=1&pluginId=com.toonflow.minigame-field-survival&sessionId=dev-host&story=${encodeURIComponent(STORY)}"></iframe></div>
<div id="badge">dev-host (--conn ${STORY})</div>
<div id="error"></div>
<div id="log"><div id="log-header"><span class="log-title">📋 log</span><button id="log-toggle">−</button></div><div id="log-body"></div></div>
<script>
// ★ #log 可拖动 + 可折叠
(function () {
  const logEl = document.getElementById("log");
  const logBody = document.getElementById("log-body");
  const logToggle = document.getElementById("log-toggle");
  const logHeader = document.getElementById("log-header");

  // --- 折叠 ---
  let collapsed = false;
  logToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    logEl.classList.toggle("collapsed", collapsed);
    logToggle.textContent = collapsed ? "+" : "−";
  });

  // --- 拖动 ---
  let dragging = false, dragOffX = 0, dragOffY = 0;
  logHeader.addEventListener("mousedown", (e) => {
    if (e.target === logToggle) return;
    dragging = true;
    const rect = logEl.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    logHeader.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    logEl.style.left = (e.clientX - dragOffX) + "px";
    logEl.style.top = (e.clientY - dragOffY) + "px";
    logEl.style.bottom = "auto";
    logEl.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; logHeader.style.cursor = "move"; }
  });
  logHeader.style.cursor = "move";
})();
const STORY = ${JSON.stringify(STORY)};
const STORY_URL = ${JSON.stringify(storyUrl)};
const SERVICE_URL = ${JSON.stringify(SERVICE_URL)};
// ★ 注入 auth token（从 ../.env 读），浏览器 fetch /toon-api 时自动带上
const AUTH_TOKEN = ${JSON.stringify(AUTH_TOKEN)};
// ★ 真实插件入口（绝对路径）——桩通过 vite /@fs 动态 import 它，执行与安装后一致的逻辑
const ENTRY_PATH = ${JSON.stringify(ENTRY_PATH.replace(/\\/g, "/"))};
window.__AUTH_TOKEN__ = AUTH_TOKEN;
window.__SERVICE_URL__ = SERVICE_URL;
// ★ 让 iframe 里能读到 window.__CONN__ / window.__STORY__（define 注入的是局部 const，运行时读不到）
window.__CONN__ = ${JSON.stringify(conn)};
window.__STORY__ = ${JSON.stringify(story)};
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
    // ★ 回包要发到 game iframe（不是 dev-host 顶层本身的 parent）
    const gameWin = document.getElementById("game")?.contentWindow;
    (gameWin || window.parent).postMessage({ type: "tf_plugin_data_result", reqId, ok: true, ...result }, "*");
  }
});
const log = (m) => {
  const el = document.getElementById("log-body");
  if (!el) return;
  el.textContent = m + '\\n' + el.textContent.slice(0, 4000);
};
const post = (state, response) => {
  if (state && typeof state === "object") state.response = response || "";
  document.getElementById("game").contentWindow.postMessage({ type: "tf_plugin_state", state, actions: ["init","start","tick","skill","item","page","exit","revive","sys","sys_sell","sys_use_item","sys_sort","sys_ring_move","sys_use_skill","sys_shop_refresh","sys_shop_buy","sys_party","sys_teleport","sys_travel"], response: response || "" }, "*");
};
// ★ 插件侧 agent 调用通道（App.vue 直接调，不走 entry.js）
// ★ 写入 window.top（跨 iframe boundary）：Vue 在 iframe 内，dev-host PAGE 在 top，
//   App.vue 的 Object.defineProperty getter 从 window.top.__agentRun_impl 读取。
const __impl = async (agentName, args) => {
  const n = String(agentName || "");
  if (n.indexOf("shop") >= 0) {
    await new Promise((r) => setTimeout(r, 240));
    return runMockShopAgent(args);
  }
  // ★ task-speaker-agent mock（dev-host 专用，返回 3 个选项 + 角色发言）
  if (n.indexOf("speaker") >= 0 || n.indexOf("task-speaker") >= 0) {
    await new Promise((r) => setTimeout(r, 600));
    const npcId = String(args?.npcId || "").toLowerCase();
    const mode = String(args?.mode || "options");
    // ★ 支持前缀匹配：npc_ally_huo_kui → huokui 组；npc_ally_ → 通用盟友
    const isAllyPrefix = npcId.startsWith("npc_ally_huo_kui") || npcId === "huokui";
    const isAlly = npcId.startsWith("npc_ally_");
    const DIALOGUE_MAP = {
    };
    // ★ 前缀兜底：npc_ally_huo_kui → huokui 组；npc_ally_* → 通用盟友组
    let dialogue = DIALOGUE_MAP[npcId];
    if (!dialogue) {
      if (isAllyPrefix) dialogue = DIALOGUE_MAP.huokui;
      else if (isAlly) dialogue = { options: ["（警觉地压低声音）…", "（拍了拍你的肩膀）…", "（若有所思）…"], speaker: "霍魁" };
    }
    dialogue = dialogue || {
      options: ["（点头）…", "（摇头）…", "（微笑）…"],
      speaker: "???",
    };
    if (mode === "options") {
      return { ok: true, output: { text: JSON.stringify(dialogue.options) } };
    }
    // ★ chosenText 优先（AI选项），其次 text（自定义输入）
    const chosenText = String(args?.chosenText ?? args?.text ?? "");
    return { ok: true, output: { text: dialogue.speaker + "：" + (chosenText || "（沉默）") } };
  }
  throw new Error("dev-host 桩无 agent 通道（" + n + "）");
};
(window.top ?? window).__agentRun_impl = __impl;

/* ================= 真实插件 entry.js 执行器（薄宿主） =================
 * 桩不再自己模拟游戏逻辑：loadStoryData() 拿到服务器参数卡后，
 * 所有 action（init/start/tick/skill/item/page/exit/revive/sys*）都转交 entry.js，
 * 与「插件安装后」由宿主 PluginExecutor 执行的路径一致。
 * pluginData（t_plugin_session_data 的模拟）与前端 SDK 的 tf_plugin_data 请求共用同一份存储。
 */
let entryMod = null;
let entryCtx = null;
let entryState = null;
let entryBroken = false;
window.__devHostPluginState = () => (entryState ? { phase: entryState.phase, tick: entryState.tick, card: entryState.playerCard, bag: (entryState.playerCard || {}).items, ring: entryState.ring } : null);

// 插件会话数据（模拟 t_plugin_session_data）：内存 Map + localStorage 双写，刷新不丢
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
/* 拟真世界书摘要：dev-host 桩没有真实世界书服务，用 test_state.json 的
 *   description / materials / monsters 拼一份与真实宿主同口径的「常驻世界书条目 + 故事物资」，
 *   否则商城 agent 读到的 worldBookDigest 恒为空串，生成结果等同降级。 */
function buildWorldBookDigest() {
  const d = storyData || {};
  const lines = [];
  lines.push("[世界观]" + String(d.description || STORY || ""));
  const mats = (d.materials || []).slice(0, 24).map((m) =>
    "- " + String(m.name || "") + "（" + String(m.subType || m.type || "") +
    "，官方价" + Number(m.priceOfficial || 0) + "）" + String(m.effect || m.description || "").slice(0, 60));
  if (mats.length) lines.push("[常驻物资/世界书条目]\\n" + mats.join("\\n"));
  const mons = (d.monsters || []).slice(0, 12).map((m) => String(m.name || m.id || ""));
  if (mons.length) lines.push("[常驻威胁]" + mons.join("/"));
  return lines.join("\\n\\n").slice(0, 4000);
}

/* 拟真商城 agent（dev-host 专用）：真实宿主走 runPluginAgent 调大模型，
 *  桩里没有 LLM 通道 —— 改为按「世界书物资 + 用户参数卡」确定性生成，
 *  返回结构与宿主一致（{ ok, output:{ goods:[{name,price,kind,rarity,heal,desc}] } }），
 *  保证「商城 agent → 生成物资类别 → 购买 → 落 t_plugin_session_data」可端到端拟真测试。 */
let __localMatsCache = null;
/** ★ 世界书补全：服务端 storyInfo 只回 inventory（玩家现有物品，无 type/价格），
 *  而「常驻世界书条目」应该是故事的完整物资录 —— 合并本地 test_data/test_state.json 的 materials。 */
async function mergeLocalMaterials() {
  const local = await loadLocalMaterials();
  if (!local || !local.length || !storyData) return;
  const have = new Set((storyData.materials || []).map((m) => String(m.name || "")));
  const add = local.filter((m) => !have.has(String(m.name || "")));
  if (add.length) {
    storyData.materials = (storyData.materials || []).concat(add);
    log("✓ 世界书物资合并：服务端 " + have.size + " + 本地 " + add.length + " = " + storyData.materials.length + " 条");
  }
}
/** 拉本地 test_data/test_state.json 的完整故事物资（41 条，带 type/priceOfficial/effect）。
 *  服务端 storyInfo 只回 inventory（自由文本、无价格），不足以支撑商城 agent，
 *  因此当服务端物资缺价格字段时回退到本地世界书物资池。 */
async function loadLocalMaterials() {
  if (__localMatsCache) return __localMatsCache;
  try {
    const r = await fetch("/story-data/toonflow-field-survival/map_design/" + encodeURIComponent(STORY) + "/test_data/test_state.json");
    if (!r.ok) return null;
    const d = await r.json();
    const m = (d && d.materials) || [];
    __localMatsCache = m.length ? m : null;
  } catch { __localMatsCache = null; }
  return __localMatsCache;
}

async function runMockShopAgent(args) {
  const serverMats = ((storyData && storyData.materials) || []).filter((m) => m && m.name);
  const usable = serverMats.filter((m) => Number(m.priceOfficial ?? m.priceBlack ?? 0) > 0);
  let mats = usable.length >= 6 ? usable : null;
  if (!mats) mats = (await loadLocalMaterials()) || serverMats;
  mats = mats.filter((m) => m && m.name);
  const card = (args && args.playerCard) || window.__STORY_PLAYER_CARD__ || {};
  const KIND_OF = { weapon: "equipment", armor: "equipment", tool: "equipment", light: "equipment", consumable: "consumable", resource: "material" };
  const rarityOf = (p) => (p >= 400 ? "legend" : p >= 180 ? "epic" : p >= 60 ? "rare" : p >= 22 ? "fine" : "common");
  const pool = mats.slice().sort(() => Math.random() - 0.5);
  const goods = pool.slice(0, 12).map((m) => {
    // 物品名归一：剥离「×N」与括号尾注（服务端 inventory 是自由文本，如「银鲤×4（…）」）
    let rawName = String(m.name || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").trim();
    if (!rawName) rawName = String(m.name || "物资");
    const kind = KIND_OF[String(m.type || "")] || "material";
    const price = Math.max(1, Math.round(Number(m.priceOfficial ?? m.priceBlack ?? 0) || 50));
    const stats = m.stats || {};
    let heal = 0;
    if (kind === "consumable") {
      heal = Number(stats.heal ?? stats.hp ?? 0);
      if (!heal) heal = /8\d|强效|大补/.test(String(m.effect || m.name || "")) ? 60 : 30;
      heal = Math.max(0, Math.round(heal));
    }
    return {
      name: rawName.slice(0, 20),
      price,
      kind,
      rarity: rarityOf(price),
      heal,
      desc: String(m.effect || m.description || m.subType || "").replace(/[（(][^）)]*[）)]/g, " ").slice(0, 28),
    };
  });
  log("✓ 商城agent（拟真）：世界书 " + mats.length + " 条 → 生成 " + goods.length + " 件故事物资（玩家 lv" + Number(card.level || 1) + "）");
  return { ok: true, output: { goods } };
}

function buildEntryCtx() {
  const sessionId = (typeof window !== "undefined" && window.__STORY_SESSION_ID__) || "all";
  entryCtx = {
    pluginId: ENTRY_PLUGIN_ID,
    userId: 1,
    sessionId,
    roles: (storyData && storyData.roles) || [],
    playerCard: (window.__STORY_PLAYER_CARD__ || {}),
    worldBookDigest: buildWorldBookDigest(),
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
      // 3001 桩没有插件 agent 的 LLM 通道（真实宿主走 runPluginAgent）：
      //   · 商城 agent → 走上面的拟真实现（世界书物资确定性生成），保证商城可端到端测试
      //   · 其它 agent（如 map-gener）→ 抛错让 entry.js 落到内置兜底，并在事件里提示「降级」
        agent: {
          run: async (agentName, args) => {
            const n = String(agentName || "");
            // ★ 角色发言器：--conn 拟真宿主必须走真实大模型，否则调不出真台词。
            //   桩在浏览器里没有 LLM 通道 → 由后端 /plugin/agentRun 代跑 runPluginAgent，
            //   与「插件安装后」entry.ts 里 ctx.tsApi.agent.run 是同一条执行链（同提示词、同模型配置）。
            if (n.indexOf("speaker") >= 0 || n.indexOf("task-speaker") >= 0) {
              try {
                const headers = { "Content-Type": "application/json" };
                if (typeof window !== "undefined" && window.__AUTH_TOKEN__) {
                  headers["Authorization"] = "Bearer " + window.__AUTH_TOKEN__;
                }
                const r = await fetch("/toon-api/plugin/agentRun", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ agentName: n, input: args || {}, aiConfigKey: "storyMiniGameModel" }),
                });
                const j = await r.json();
                if (j && j.code === 200 && j.data) {
                  const txt = String((j.data.output && j.data.output.text) || "").slice(0, 120);
                  log("✓ 角色发言器(真LLM) " + n + " mode=" + String((args||{}).mode || "response") + " → " + (j.data.ok ? txt : "失败 " + (j.data.error || "")));
                  return j.data;
                }
                const msg = (j && (j.msg || j.message)) || "后端 agentRun 返回异常";
                log("! 角色发言器调用失败：" + msg);
                return { ok: false, error: String(msg) };
              } catch (err) {
                const msg = String((err && err.message) || err);
                log("! 角色发言器请求异常：" + msg);
                return { ok: false, error: msg };
              }
            }
            if (n.indexOf("shop") >= 0) {
              await new Promise((r) => setTimeout(r, 240)); // 拟真网络 + 推理耗时
              return runMockShopAgent(args);
            }
            log("⚠ entry.agent.run(" + n + ") 在 dev-host 桩不可用 → 使用内置兜底");
            throw new Error("dev-host 桩无插件 agent 通道");
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
  if (!mod || typeof mod.handle_action !== "function") throw new Error("entry.js 未导出 handle_action");
  entryMod = mod;
  log("✓ 已加载真实插件入口 entry.js（薄宿主模式）");
  return mod;
}

/** 把 action 交给 entry.js 执行；成功返回 true，失败（只报一次）返回 false 交给旧逻辑兜底 */
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
    // 反向同步参数卡：entry 内部 patchCard 改过的 card 要成为后续 tick 的 ctx 来源，
    // 否则下一个 tick 的 syncCardFromContext 会用旧 card 覆盖（卖出/购买结果丢失）
    if (entryState.playerCard) entryCtx.playerCard = entryState.playerCard;
    lastState = entryState;
    post(entryState, res.response || "");
    log("entry→ " + action + " ok" + (res.response ? " / " + res.response : ""));
    return true;
  } catch (err) {
    entryBroken = true;
    log("! entry.js 执行失败，回退桩内本地模拟：" + (err && err.message ? err.message : err));
    return false;
  }
}

/* 串行队列：真宿主是串行处理 action 的，桩这里也必须串行，
   否则「每帧 tick + 并发的 sys_* 操作」会并发写 entryState 造成状态互相覆盖。
   tick 积压时直接丢弃（下一帧还会再来），避免队列越滚越长。 */
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
    //    ★ 参数卡（parameterCardJson）必须完整带出：entry.js 用它构建背包/技能/等级，
    //      前端系统面板直接读 state.playerCard → 与服务器数据一致。
    const roles = [];
    const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    // 角色在地图上的位置（角色卡「传送到」用）：兼容多种字段命名
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
        name: p.name || "玩家",
        roleType: p.roleType || "player",
        // ★ server avatarPath "/1/..." 改写到 /toon-asset/1/... 走 vite 代理
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
    // ★ 把 sessionId 暴露给 game iframe（系统面板买/卖物品要发请求到服务器）
    if (typeof window !== "undefined") window.__STORY_SESSION_ID__ = sessionId;
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
    if (typeof window !== "undefined") window.__STORY_SESSION_ID__ = "";
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
    await mergeLocalMaterials(); // ★ 世界书补全：服务端只回 inventory，本地 test_state.json 才是完整物资条录
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
    // ★ 真实插件 entry.js 接管（薄宿主）：init 返回带服务器参数卡的 select state
    if (await queueEntryAction("init", {})) {
      log("HOST: entry.js 已接管（init → select state）");
      return;
    }
    post(lastState);
    log("host→ pushed select state (roles: " + lastState.roles.length + ", items: " + lastState.items.length + ")");
  }
  // ★ 薄宿主：--conn 桩下所有动作优先交给真实插件 entry.js 执行（与「安装后」路径一致）
  if (d.type === "tf_plugin_tick" && typeof d.action === "string") {
    if (await queueEntryAction(d.action, d.params || {})) return;
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
      // ★ 不再自动生成"莫名奇妙"的 NPC ally——
      //   participants 必须在选人面板由用户显式勾选才生成实体；空数组 / 全是玩家本人 → 0 ally
      if (!r) return;
      if (playerRole && r.id === playerRole.id) return;
      const lv = r.initial_level || 10;
      const s = 1 + (lv - 1) * 0.3;
      // ★ 玩家中心 50 米半径随机（避开 5 米内）
      const ang = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 45;
      ents.push({
        id: r.id, name: r.name, side: "ally",
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, vx: 0, vy: 0,
        hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
        mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
        exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
        level: lv, atk: 25, def: 8, facing: 0, cooldown: 0, alive: true, avatarPath: r.avatarPath,
      });
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
        // /@fs/*、/src/* 等模块路径和静态资源透传（让 vite 自己处理）
        if (u.includes("/@fs") || u.includes("/src/") || u.includes("/node_modules/")) return next();
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
      host: true, // ★ 监听所有接口（包括 127.0.0.1 和 ::1），确保 bsk CDP 能连接
      // ★ 允许 --conn 拟真宿主桩通过 /@fs/ 动态 import 插件入口 entry.js
      //   （vite 默认只允许 workspace root=vue/ 目录，entry.js 在其上一级）
      fs: {
        allow: [
          resolve(__dirname),              // vue/
          resolve(__dirname, ".."),        // plugins/toonflow-field-survival/
          resolve(__dirname, "../../.."),  // toonflow-game-plugins/
        ],
      },
    },
    define: {
      // Vite 默认不注入非 VITE_ 前缀的变量到客户端，这里显式暴露
      __STORY__: JSON.stringify(env.STORY ?? ""),
      __CONN__: JSON.stringify(env.CONN ?? ""),
    },
    base: "./",
    build: {
      outDir: "../ui",
      emptyOutDir: false,
      assetsInlineLimit: 100 * 1024 * 1024,
      target: "es2020",
    },
  };
});