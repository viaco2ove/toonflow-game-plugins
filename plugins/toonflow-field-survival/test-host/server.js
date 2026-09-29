#!/usr/bin/env node
/**
 * 拟真 host 服务（最简实现）—— 用于本地测试 --conn 模式。
 * 收到 iframe 的 postMessage 后，回推 select / playing 状态。
 * 用法：
 *   node test-host/server.js
 *   然后访问 http://localhost:5000
 */
const http = require("http");

const PORT = 5000;
const PLUGIN_URL = "http://localhost:3000/";

const ROLES = [
  { id: "p1", name: "测试玩家(宿主)", roleType: "player", initial_level: 10, avatarPath: "./public/test_data/toonflow_agme_cache/avatars/player/avatar.webp" },
  { id: "a1", name: "假数据-聂小可", roleType: "npc", initial_level: 10, avatarPath: "./public/test_data/toonflow_agme_cache/avatars/聂小可/avatar.webp" },
  { id: "a2", name: "假数据-裴勇", roleType: "npc", initial_level: 10, avatarPath: "./public/test_data/toonflow_agme_cache/avatars/裴勇/avatar.webp" },
  { id: "a3", name: "假数据-夜见", roleType: "npc", initial_level: 10, avatarPath: "./public/test_data/toonflow_agme_cache/avatars/夜见/avatar.webp" },
];

const SKILLS = [
  { name: "冲斩", power: 20, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee" },
  { name: "火球", power: 25, cost: 0, cd: 30, cdLeft: 0, type: "atk", range: "ranged" },
  { name: "治疗", power: 30, cost: 0, cd: 40, cdLeft: 0, type: "heal", range: "melee" },
  { name: "护盾", power: 0, cost: 0, cd: 60, cdLeft: 0, type: "buff", range: "melee" },
];
const ITEMS = [
  { name: "淬湮短刀", count: 1, heal: 0, type: "atk", matType: "weapon" },
  { name: "基础外伤包", count: 3, heal: 30, type: "hp" },
  { name: "平价抗湮抑制药剂", count: 2, heal: 30, type: "mp" },
];

const IFRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>test host</title>
<style>
  body{margin:0;padding:0;font-family:sans-serif}
  #iframe-wrap{position:fixed;inset:0}
  iframe{width:100%;height:100%;border:0;display:block}
  .log{position:fixed;left:8px;bottom:8px;background:#000a;color:#fff;padding:6px 10px;border-radius:6px;font:12px monospace;max-width:60%;max-height:30vh;overflow:auto;z-index:9}
</style>
</head><body>
<div id="iframe-wrap"><iframe id="game" src="${PLUGIN_URL}"></iframe></div>
<div class="log" id="log"></div>
<script>
const ROLES = ${JSON.stringify(ROLES)};
const SKILLS = ${JSON.stringify(SKILLS)};
const ITEMS = ${JSON.stringify(ITEMS)};

const log = (m) => {
  const el = document.getElementById("log");
  el.textContent = m + "\\n" + el.textContent.slice(0, 4000);
};

const postTo = (state) => {
  const game = document.getElementById("game");
  game.contentWindow.postMessage({ type: "tf_plugin_state", state, actions: ["init","start","tick","skill","item","page","exit"] }, "*");
};

window.addEventListener("message", (e) => {
  const d = e?.data;
  if (!d || typeof d !== "object") return;
  log("iframe→: " + JSON.stringify(d).slice(0, 200));

  if (d.type === "tf_plugin_loaded") {
    setTimeout(() => {
      const initState = {
        phase: "select", version: 5, tick: 0,
        world: { w: 3000, h: 3000 },
        roles: ROLES, selections: { participants: [], spectators: [], enemies: [] },
        entities: [], chests: [], potions: [], floaters: [],
        skills: SKILLS, items: ITEMS, skillPage: 0, itemPage: 0,
        exp: 0, money: 0, drops: [], kills: 0, events: [], result: null,
        map: null, mapSource: "fallback",
      };
      postTo(initState);
      log("host→: pushed select state");
    }, 300);
  }

  if (d.type === "tf_plugin_tick" && d.action === "start") {
    const sel = d.params?.selections || {};
    const ents = [
      { id: "p1", name: "测试玩家(宿主)", side: "player", x: 0, y: 0, vx: 0, vy: 0,
        hp: 200, maxHp: 200, mp: 80, maxMp: 80, exp: 0, expToNext: 100, level: 10,
        atk: 30, def: 10, facing: 0, cooldown: 0, alive: true,
        avatarPath: "./public/test_data/toonflow_agme_cache/avatars/player/avatar.webp" },
    ];
    (sel.participants || []).forEach((id, i) => {
      const role = ROLES.find((r) => r.id === id);
      if (role) ents.push({
        id: role.id, name: role.name, side: "ally",
        x: Math.cos(i) * 12, y: Math.sin(i) * 12,
        vx: 0, vy: 0, hp: 150, maxHp: 150, mp: 50, maxMp: 50,
        exp: 0, expToNext: 100, level: role.initial_level || 10,
        atk: 25, def: 8, facing: 0, cooldown: 0, alive: true, avatarPath: role.avatarPath,
      });
    });
    setTimeout(() => {
      const playingState = {
        phase: "playing", version: 5, tick: 0,
        world: { w: 3000, h: 3000 },
        roles: [], selections: { participants: sel.participants || [], spectators: sel.spectators || [], enemies: sel.enemies || [] },
        entities: ents, chests: [], potions: [], floaters: [],
        skills: SKILLS, items: ITEMS, skillPage: 0, itemPage: 0,
        exp: 0, money: 0, drops: [], kills: 0, events: ["拟真模式启动（来自 --conn 测试 host）"], result: null,
        map: null, mapSource: "fallback",
      };
      postTo(playingState);
      window._lastState = playingState;
      log("host→: pushed playing state (entities: " + ents.length + ")");
    }, 500);
  }

  if (d.type === "tf_plugin_tick" && d.action === "tick") {
    // 真实宿主会镜像推进玩家坐标（前端上报了 player 坐标）
    // 这里简单 echo 状态：保留上一次的 entities，仅推进 tick
    setTimeout(() => {
      const last = window._lastState || { entities: [], events: [] };
      // 玩家坐标从 input 里取
      const player = (d.params?.player) || {};
      const ents = (last.entities || []).map((e) => {
        if (e.side === "player") {
          return { ...e, x: player.x ?? e.x, y: player.y ?? e.y, facing: player.facing ?? e.facing };
        }
        return e;
      });
      const newState = {
        phase: "playing", version: 5, tick: (d.params?.tick || 0) + 1,
        world: { w: 3000, h: 3000 }, roles: [],
        selections: { participants: [], spectators: [], enemies: [] },
        entities: ents, chests: [], potions: [], floaters: [],
        skills: [], items: [], skillPage: 0, itemPage: 0,
        exp: 0, money: 0, drops: [], kills: 0, events: [], result: null,
        map: null, mapSource: "fallback",
      };
      window._lastState = newState;
      postTo(newState);
    }, 100);
  }
});
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(IFRAME_HTML);
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});
server.listen(PORT, () => {
  console.log(`test host listening on http://localhost:${PORT}`);
  console.log(`it will load the plugin from ${PLUGIN_URL} as an iframe`);
});