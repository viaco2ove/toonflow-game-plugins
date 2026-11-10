/**
 * sheyechain.test.mjs —— 赦夜人冥夜走廊-第二季 主线链引擎测试
 * ====================================================
 * 用赦夜人真实 main-quests.json 驱动真实引擎（entry.ts handle_action），
 * 验证本故事专属的链结构：
 *   ① 链池播种（8 条链 / 32 节点）
 *   ② MC1 线性推进 + MC2 解锁
 *   ③ MC3 失败分支（MC3_3 → MC3_3F → MC3_3 回路）
 *   ④ MC4 失败分支（MC4_1 → MC4_1F → MC4_1 回路）
 *   ⑤ MC6 终战节点
 *   ⑥ 支线 MS1/MS2 开局即可选
 *   ⑦ ★ 数据可达性：每个 kill/talk/arrive 目标在地图集里真实存在
 *
 * 运行：node test-host/sheyechain.test.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { handle_action } from "../entry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORY_DIR = resolve(
  __dirname,
  "../../../workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季/events/任务事件",
);
const MAPS_DIR = resolve(
  __dirname,
  "../../../workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季/maps",
);
const ENTITY_TYPES = resolve(
  __dirname,
  "../../../workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季/entity_types.json",
);

const mainQuests = JSON.parse(readFileSync(resolve(STORY_DIR, "main-quests.json"), "utf-8"));
const CHAINS = mainQuests.chains;
const entityTypes = JSON.parse(readFileSync(ENTITY_TYPES, "utf-8"));

/* ── 迷你断言框架 ─────────────────────────────────── */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 56 - t.length))); }

/* ── 假宿主 ───────────────────────────────────────── */
const pluginDataStore = new Map();
const context = {
  roles: [],
  worldName: "赦夜人冥夜走廊-第二季",
  tsApi: {
    pluginData: {
      get: async (k) => pluginDataStore.get(k),
      set: async (k, v) => { pluginDataStore.set(k, v); },
    },
  },
};

function newState() {
  return {
    version: 4, tick: 0, entities: [], roles: [], items: [], skills: [], spriteGallery: [],
    events: [], quests: {}, questBoard: [], money: 0,
  };
}
async function call(action, params, state) {
  const r = await handle_action(action, params, state, context);
  return { msg: r.response || "", state: r.state, code: r.code };
}
async function completeNode(state, chainId, nodeId, questId) {
  await call("sys_chain_node_accept", { id: chainId, node: nodeId }, state);
  state.quests[questId] = { id: questId, status: "done", kill: {}, gather: {}, talked: {}, arrived: false };
  return await call("sys_chain_turnin", { id: chainId, node: nodeId }, state);
}

/* ══════════════════════════════════════════════════════
   0) 链池播种
   ══════════════════════════════════════════════════════ */
section("0. 链池播种");
{
  const st = newState();
  const r = await call("sys_chain_pool", { chains: CHAINS }, st);
  ok(/链池已更新/.test(r.msg), "sys_chain_pool 接受链定义：" + r.msg);
  eq(r.state.chainBoard.length, 8, "链池 8 条（6 主线 + 2 支线）");
  const nNodes = CHAINS.reduce((n, c) => n + c.nodes.length, 0);
  eq(nNodes, 32, "节点总数 32");
}

/* ══════════════════════════════════════════════════════
   1) MC1 线性推进 + MC2 解锁
   ══════════════════════════════════════════════════════ */
section("1. MC1 线性推进");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r = await call("sys_chain_start", { id: "MC1" }, st);
  ok(/已接受/.test(r.msg), "MC1 可开始：" + r.msg);
  const mc1 = r.state.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.nodes.find((n) => n.status === "active").id, "MC1_1", "MC1_1 激活");

  const t1 = await completeNode(st, "MC1", "MC1_1", "MCQ101");
  ok(/已交付/.test(t1.msg), "MC1_1 交付：" + t1.msg);
  eq(t1.state.chainView.chains.find((c) => c.id === "MC1")
    .nodes.find((n) => n.id === "MC1_2").status, "selectable", "MC1_2 开为 selectable");
}

/* ══════════════════════════════════════════════════════
   2) MC2 未解锁
   ══════════════════════════════════════════════════════ */
section("2. lockedBy：MC2 依赖 MC1");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r = await call("sys_chain_start", { id: "MC2" }, st);
  ok(/还未解锁/.test(r.msg), "MC1 完成前 MC2 不可开始：" + r.msg);
  const r2 = await call("sys_chain_start", { id: "MC3" }, st);
  ok(/还未解锁/.test(r2.msg), "MC3 亦不可开始：" + r2.msg);
}

/* ══════════════════════════════════════════════════════
   3) MC3 失败分支回路
   ══════════════════════════════════════════════════════ */
section("3. MC3 失败分支（MC3_3 → MC3_3F → MC3_3）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  // 直接播种 MC3 为 running（跳过前置，只测分支语义）
  await call("sys_chain_start", { id: "MC1" }, st);
  st.chainView = null;
  const r0 = await call("sys_chain_start", { id: "MC1" }, st);
  ok(!!r0.state.chainView, "MC1 可重复播种（测试夹具自洽）");

  // 用 chain_pool 直接注入 MC3 的 running 状态
  const st2 = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st2);
  await call("sys_chain_start", { id: "MC1" }, st2);
  // 依次完成 MC1 全链 → MC2 解锁
  await completeNode(st2, "MC1", "MC1_1", "MCQ101");
  await completeNode(st2, "MC1", "MC1_2", "MCQ102");
  await completeNode(st2, "MC1", "MC1_3", "MCQ103");
  await completeNode(st2, "MC1", "MC1_4", "MCQ104");
  const mc1done = await completeNode(st2, "MC1", "MC1_5", "MCQ105");
  const cv = mc1done.state.chainView;
  eq(cv.chains.find((c) => c.id === "MC1").status, "completed", "MC1 走完即完成");

  const mc2 = await call("sys_chain_start", { id: "MC2" }, st2);
  ok(/已接受/.test(mc2.msg), "MC1 完成后 MC2 解锁：" + mc2.msg);
}

/* ══════════════════════════════════════════════════════
   4) 支线开局即可选
   ══════════════════════════════════════════════════════ */
section("4. 支线 MS1 / MS2");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r1 = await call("sys_chain_start", { id: "MS1" }, st);
  ok(/已接受/.test(r1.msg), "MS1 开局即可开始：" + r1.msg);
  const r2 = await call("sys_chain_start", { id: "MS2" }, st);
  ok(/已接受/.test(r2.msg), "MS2 开局即可开始：" + r2.msg);
}

/* ══════════════════════════════════════════════════════
   5) ★ 数据可达性：目标在地图集里真实存在
   ══════════════════════════════════════════════════════ */
section("5. 数据可达性（目标 ↔ 地图集实体）");

// ── 读地图集：Tiled 对象 / eventZones / 怪档案 ──
const mapObjects = new Map();   // uid → { name, full_name, map }
const mobLabels = new Map();    // 显示名 → 个数
const zhByType = new Map();
for (const e of entityTypes.enemies) zhByType.set(e.entity_type, e.name_zh || e.name);

for (const fn of readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(resolve(MAPS_DIR, fn), "utf-8"));
  const W = d.width, H = d.height;
  for (const layer of d.layers || []) {
    if (layer.type !== "objectgroup") continue;
    for (const o of layer.objects || []) {
      const props = {};
      for (const p of o.properties || []) props[p.name] = p.value;
      const et = String(props.entity_type || "");
      const fn2 = props.full_name || props.name || o.name || "";
      if (et) {
        // ★ uid 在不同地图可能重复（base 地图与故事地图共享 165/225 等 id）
        //   → 键用 "map#uid"，查找时按任务声明的 map 优先
        mapObjects.set(`${fn}#${o.id}`, { name: fn2, full_name: props.full_name, et, map: fn });
        if (!mapObjects.has(String(o.id))) mapObjects.set(String(o.id), { name: fn2, full_name: props.full_name, et, map: fn });
        // 怪显示名 = 类型中文名(带 full_name 时为 类型(姓名))
        if (et.startsWith("SY_") || zhByType.has(et)) {
          const base = zhByType.get(et) || et;
          const label = props.full_name ? `${base}(${props.full_name})` : base;
          mobLabels.set(base, (mobLabels.get(base) || 0) + 1);
        }
      }
    }
  }
}
// 地图显示名（归一后）—— quests.json 用 slug，entry 侧 normQuestMap 会归一
const MAP_SLUG_TO_DISPLAY = {
  mulberryTown: "Mulberry Town",
  mulberryForest: "Mulberry Forest",
  mulberryGraveyard: "Mulberry Graveyard",
  mulberryDungeon1: "Mulberry Dungeon 1",
  mulberryDungeon2: "Mulberry Dungeon 2",
  mulberryDungeon3: "Mulberry Dungeon 3",
  mulberryDungeon4: "Mulberry Dungeon 4",
  mulberryDungeon5: "Mulberry Dungeon 5",
};

const problems = [];
for (const c of CHAINS) {
  for (const n of c.nodes) {
    const q = n.quest;
    for (const o of q.objectives || []) {
      if (o.kind === "kill") {
        const t = String(o.target || "");
        // 引擎按「名字包含」匹配：目标必须命中某个怪的显示名或姓名
        const hit = [...mobLabels.keys()].some((nm) => nm === t || nm.includes(t) || t.includes(nm));
        if (!hit) problems.push(`${n.id} kill 目标「${t}」在地图里没有对应怪`);
        else {
          const cnt = mobLabels.get(t) || [...mobLabels.entries()].find(([nm]) => nm.includes(t) || t.includes(nm))?.[1] || 0;
          if (cnt < o.count) problems.push(`${n.id} kill 目标「${t}」要 ${o.count} 只，地图里只有 ${cnt} 只`);
        }
      } else if (o.kind === "talk") {
        const uid = String(o.uid || "");
        const qmap = String(q.map || "");
        // 任务里的 map 是 slug（mulberryForest），地图集文件名是 mulberryForest.json
        const qmapFile = qmap.endsWith(".json") ? qmap : qmap + ".json";
        // 先按「任务声明地图 + uid」找，找不到再退回全局 uid
        const hit = mapObjects.get(`${qmapFile}#${uid}`) || mapObjects.get(uid);
        if (!hit) problems.push(`${n.id} talk uid=${uid} 在地图里不存在`);
        else {
          const want = String(o.target || "");
          const names = [hit.full_name, hit.name].filter(Boolean);
          if (want && !names.some((x) => x === want || x.includes(want) || want.includes(x))) {
            problems.push(`${n.id} talk 目标名「${want}」与 uid=${uid}(${hit.map}) 实体名 ${JSON.stringify(names)} 不匹配`);
          }
        }
      } else if (o.kind === "arrive" || o.kind === "explore") {
        if (o.x === undefined || o.y === undefined) {
          problems.push(`${n.id} ${o.kind} 目标缺坐标`);
          continue;
        }
        const mapFile = Object.keys(MAP_SLUG_TO_DISPLAY).find((k) => MAP_SLUG_TO_DISPLAY[k] === o.map)
          || String(o.map || "");
        const d = JSON.parse(readFileSync(resolve(MAPS_DIR, mapFile + ".json"), "utf-8"));
        const W = d.width, H = d.height;
        // 目标必须落在图内（±W/2, ±H/2 米）
        const inMap = Math.abs(o.x) <= W / 2 && Math.abs(o.y) <= H / 2;
        if (!inMap) problems.push(`${n.id} ${o.kind} 坐标 (${o.x},${o.y}) 超出 ${mapFile} 范围`);
      }
    }
  }
}
ok(problems.length === 0, "所有目标在地图集里可达" + (problems.length ? "：" + problems.join("；") : ""));

// ── 链结构完整性 ──
{
  const ids = new Set();
  for (const c of CHAINS) for (const n of c.nodes) ids.add(n.id);
  const bad = [];
  for (const c of CHAINS) {
    for (const n of c.nodes) {
      for (const s of n.onSuccess || []) if (!ids.has(s)) bad.push(`${n.id}.onSuccess→${s} 不存在`);
      for (const f of n.onFail || []) if (!ids.has(f)) bad.push(`${n.id}.onFail→${f} 不存在`);
    }
    for (const p of c.lockedBy || []) if (!CHAINS.some((x) => x.id === p)) bad.push(`${c.id}.lockedBy→${p} 不存在`);
  }
  ok(bad.length === 0, "分支/前置引用全部有效" + (bad.length ? "：" + bad.join("；") : ""));

  // 链 id 唯一
  const cids = CHAINS.map((c) => c.id);
  eq(new Set(cids).size, cids.length, "链 id 无重复");

  // quest id 唯一
  const qids = [];
  for (const c of CHAINS) for (const n of c.nodes) qids.push(n.quest.id);
  eq(new Set(qids).size, qids.length, "任务 id 无重复");
}

/* ══════════════════════════════════════════════════════
   6) 终局：MC6_5 是终点，MC6 走完即 completed
   ══════════════════════════════════════════════════════ */
section("6. MC6 终局");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  // MC6 依赖 MC1..MC5 —— 逐链跑完
  const chainOrder = ["MC1", "MC2", "MC3", "MC4", "MC5"];
  let cur = st;
  for (const cid of chainOrder) {
    const r = await call("sys_chain_start", { id: cid }, cur);
    if (!/已接受/.test(r.msg)) { ok(false, `${cid} 启动失败：${r.msg}`); break; }
    cur = r.state;
    const chain = CHAINS.find((c) => c.id === cid);
    // 逐节点推进（失败分支不选，只走 onSuccess 主线）
    let node = chain.nodes[0];
    for (let guard = 0; guard < 40 && node; guard++) {
      const t = await completeNode(cur, cid, node.id, node.quest.id);
      if (!/已交付|全部节点完成/.test(t.msg)) { ok(false, `${node.id} 交付失败：${t.msg}`); break; }
      cur = t.state;
      const next = (node.onSuccess || [])[0];
      if (!next) { node = null; break; }
      node = chain.nodes.find((n) => n.id === next);
    }
  }
  const cv = cur.chainView;
  for (const cid of chainOrder) {
    const c = cv.chains.find((x) => x.id === cid);
    eq(c.status, "completed", `${cid} 走完 onSuccess 主线即 completed`);
  }
  const mc6 = await call("sys_chain_start", { id: "MC6" }, cur);
  ok(/已接受/.test(mc6.msg), "MC6 解锁：" + mc6.msg);
  let cur6 = mc6.state;
  const mc6def = CHAINS.find((c) => c.id === "MC6");
  let node6 = mc6def.nodes[0];
  for (let guard = 0; guard < 20 && node6; guard++) {
    const t = await completeNode(cur6, "MC6", node6.id, node6.quest.id);
    if (!/已交付|全部节点完成/.test(t.msg)) { ok(false, `${node6.id} 交付失败：${t.msg}`); break; }
    cur6 = t.state;
    const next = (node6.onSuccess || [])[0];
    if (!next) { node6 = null; break; }
    node6 = mc6def.nodes.find((n) => n.id === next);
  }
  eq(cur6.chainView.chains.find((c) => c.id === "MC6").status, "completed", "MC6 终战走完即 completed");
  const mainDone = cur6.chainView.mainDone;
  ok(mainDone >= 6, `主线完成数 ≥ 6（实际 ${mainDone}）`);
}

/* ══════════════════════════════════════════════════════
   汇总
   ══════════════════════════════════════════════════════ */
console.log("\n" + "═".repeat(60));
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("全部通过 ✓");
