/**
 * tongtian-chain.test.mjs —— 通天传授-收徒系统 · 主线任务链数据验证
 * ==========================================================
 * 用真实故事数据（map_design/通天传授-收徒系统/events/任务事件/main-quests.json）
 * 驱动真实引擎（entry.ts handle_action），验证：
 *   ① 链定义能被引擎接受（8 条链全部 normalize 通过）
 *   ② lockedBy 编排：MC2 必须 MC1 完成后才解锁
 *   ③ MC1 线性推进到底 → 解锁 MC2
 *   ④ MC2 二选一分支：2_2A / 2_2B 走任一条都能完成链
 *   ⑤ MC4 失败分支：MC4_3 超时/放弃 → MC4_3F → 汇回 MC4_4
 *   ⑥ MC6 失败分支：MC6_2 → MC6_2F → 汇回 MC6_3
 *   ⑦ 支线 MS1/MS2 lockedBy=[]，开局即可选，且不进主线统计
 *   ⑧ 链节点任务不进普通委托「可接」页
 *   ⑨ 所有 talk 目标的 uid / 名称与地图实体一致（静态校验）
 *
 * 运行：node test-host/tongtian-chain.test.mjs
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { handle_action } from "../entry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../..");
const STORY_DIR = resolve(REPO, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统/events/任务事件");
const MAPS_DIR = resolve(REPO, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统/maps");

const mainQuests = JSON.parse(readFileSync(resolve(STORY_DIR, "main-quests.json"), "utf-8"));
const CHAINS = mainQuests.chains;

/* ── 迷你断言框架 ─────────────────────────────────── */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 60 - t.length))); }

/* ── 假宿主 ───────────────────────────────────────── */
/* ★ pluginDataStore 必须是**每个用例独立**的：引擎会把链进度持久化到
 *   pluginData["chain_state"]，若 store 跨用例共享，后一个用例会读到前一个
 *   用例留下的链状态（MC1 已 completed / awaiting_choice 已被消费），
 *   导致断言莫名其妙地失败。用例之间用 resetStore() 隔断。 */
let pluginDataStore = new Map();
function resetStore() { pluginDataStore = new Map(); }
const context = {
  roles: [],
  worldName: "通天传授-收徒系统",
  tsApi: {
    pluginData: {
      get: async (k) => pluginDataStore.get(k),
      set: async (k, v) => { pluginDataStore.set(k, v); },
    },
  },
};

function newState() {
  resetStore();
  return {
    version: 4, tick: 0, entities: [], roles: [], items: [], skills: [], spriteGallery: [],
    events: [], quests: {}, questBoard: [], money: 0,
  };
}
async function call(action, params, state) {
  const r = await handle_action(action, params, state, context);
  return { msg: r.response || "", state: r.state, code: r.code };
}

/** 完成一个链节点：接取 → 目标达成 → 交付
 *  注意：sys_chain_start / sys_chain_choose 本身就会把节点置为 active，
 *  这里只在节点仍非 active 时才补一次 accept。 */
async function completeNode(state, chainId, nodeId, questId) {
  const cur = nodeOf(state, chainId, nodeId);
  if (!cur || cur.status !== "active") {
    await call("sys_chain_node_accept", { id: chainId, node: nodeId }, state);
  }
  state.quests[questId] = { id: questId, status: "done", kill: {}, gather: {}, talked: {}, arrived: false };
  return await call("sys_chain_turnin", { id: chainId, node: nodeId }, state);
}

/** 让某个节点处于 active（接取但不交付） */
async function acceptNode(state, chainId, nodeId) {
  return await call("sys_chain_node_accept", { id: chainId, node: nodeId }, state);
}

function chainOf(state, id) {
  const view = state.chainView || {};
  const list = view.chains || [];
  return list.find((c) => c.id === id) || null;
}
function nodeOf(state, chainId, nodeId) {
  const c = chainOf(state, chainId);
  return c ? (c.nodes || []).find((n) => n.id === nodeId) : null;
}

/* ══════════════════════════════════════════════════════
   0) 数据结构静态校验
   ══════════════════════════════════════════════════════ */
section("0. 数据结构静态校验");
{
  ok(Array.isArray(CHAINS) && CHAINS.length === 8, `共 8 条链（6 主线 + 2 支线），实际 ${CHAINS.length}`);

  // 链 id 唯一
  const ids = CHAINS.map((c) => c.id);
  ok(new Set(ids).size === ids.length, "链 id 唯一");

  // 节点边不悬空
  let dangling = 0;
  for (const c of CHAINS) {
    const nids = new Set(c.nodes.map((n) => n.id));
    for (const n of c.nodes) {
      for (const s of [...(n.onSuccess || []), ...(n.onFail || [])]) {
        if (!nids.has(s)) { dangling++; console.log("    ✗ 悬空边 " + c.id + "/" + n.id + " -> " + s); }
      }
    }
  }
  eq(dangling, 0, "所有 onSuccess/onFail 边均指向本链已有节点");

  // lockedBy 指向存在的链
  const cids = new Set(ids);
  let badLock = 0;
  for (const c of CHAINS) for (const l of c.lockedBy || []) if (!cids.has(l)) badLock++;
  eq(badLock, 0, "所有 lockedBy 指向存在的链");

  // quest id 前缀（引擎按 MCQ|MSQ 前缀识别链任务）
  let badPrefix = 0;
  for (const c of CHAINS) for (const n of c.nodes) {
    if (!/^(MCQ|MSQ)/.test(n.quest.id)) { badPrefix++; console.log("    ✗ " + n.quest.id); }
  }
  eq(badPrefix, 0, "所有节点 quest id 以 MCQ/MSQ 开头（链任务不进普通委托可接页）");

  // 链首节点唯一（有 onSuccess 的入边为 0 的节点）
  for (const c of CHAINS) {
    const targets = new Set();
    for (const n of c.nodes) for (const s of [...(n.onSuccess || []), ...(n.onFail || [])]) targets.add(s);
    const heads = c.nodes.filter((n) => !targets.has(n.id));
    ok(heads.length === 1, `${c.id} 恰有一个链首节点（实际 ${heads.length}：${heads.map((h) => h.id).join(",")}）`);
  }
}

/* ══════════════════════════════════════════════════════
   1) 地图实体核对（talk uid / arrive 坐标）
   ══════════════════════════════════════════════════════ */
section("1. 地图实体核对");
{
  const mapCache = new Map();
  function mapObjs(key) {
    if (mapCache.has(key)) return mapCache.get(key);
    const p = resolve(MAPS_DIR, key + ".json");
    if (!existsSync(p)) { mapCache.set(key, null); return null; }
    const m = JSON.parse(readFileSync(p, "utf-8"));
    const W = m.width, H = m.height;
    const out = new Map();
    for (const l of m.layers || []) {
      if (l.type !== "objectgroup") continue;
      for (const o of l.objects || []) {
        const props = Object.fromEntries((o.properties || []).map((x) => [x.name, x.value]));
        const names = [o.name, props.name, props.full_name].map((x) => String(x || "").trim()).filter(Boolean);
        out.set(String(o.id), { names, w: [o.x / 32 - W / 2, o.y / 32 - 1 - H / 2] });
      }
    }
    mapCache.set(key, out);
    return out;
  }

  let talkBad = 0, arriveBad = 0;
  for (const c of CHAINS) {
    for (const n of c.nodes) {
      const q = n.quest;
      for (const o of q.objectives || []) {
        const mp = o.map || q.map;
        const objs = mapObjs(mp);
        if (!objs) { console.log("    ✗ 地图不存在 " + mp); arriveBad++; continue; }
        if (o.kind === "talk") {
          const e = objs.get(String(o.uid));
          if (!e) { console.log(`    ✗ ${c.id}/${n.id} talk uid ${o.uid} 在 ${mp} 不存在`); talkBad++; }
          else if (!e.names.includes(o.target)) {
            console.log(`    ✗ ${c.id}/${n.id} talk 名称 "${o.target}" 不在 uid ${o.uid} 的名字集 ${JSON.stringify(e.names)}`);
            talkBad++;
          }
        }
        if (o.kind === "arrive" || o.kind === "explore") {
          let best = Infinity;
          for (const e of objs.values()) {
            const d = Math.hypot(e.w[0] - o.x, e.w[1] - o.y);
            if (d < best) best = d;
          }
          if (best > 6.5) {
            console.log(`    ✗ ${c.id}/${n.id} arrive "${o.target}" 附近 6.5 米内无实体（最近 ${best.toFixed(2)}）`);
            arriveBad++;
          }
        }
      }
    }
  }
  eq(talkBad, 0, "所有 talk 目标的 uid + 名称与地图实体一致");
  eq(arriveBad, 0, "所有 arrive/explore 坐标落在地图实体附近（≤6.5 米）");
}

/* ══════════════════════════════════════════════════════
   2) 引擎接受链定义
   ══════════════════════════════════════════════════════ */
section("2. 引擎接受链定义");
{
  const st = newState();
  const r = await call("sys_chain_pool", { chains: CHAINS }, st);
  ok(/链池已更新/.test(r.msg), "sys_chain_pool 接受：" + r.msg);
  const board = st.chainBoard || [];
  eq(board.length, 8, "chainBoard 载入 8 条链");
  ok(board.every((c) => c.nodes && c.nodes.length), "每条链都带节点");
  ok(board.every((c) => c.nodes.every((n) => n.quest && n.quest.id)), "每个节点 quest 完整");

  // 支线标记
  const sides = board.filter((c) => c.side).map((c) => c.id);
  ok(sides.includes("MS1") && sides.includes("MS2"), "MS1/MS2 标记为支线：" + sides.join(","));
}

/* ══════════════════════════════════════════════════════
   3) lockedBy 编排
   ══════════════════════════════════════════════════════ */
section("3. lockedBy 编排");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);

  const c1 = chainOf(st, "MC1"), c2 = chainOf(st, "MC2"), c6 = chainOf(st, "MC6");
  eq(c1.status, "available", "MC1 开局即可选");
  eq(c2.status, "locked", "MC2 开局锁定（lockedBy=MC1）");
  eq(c6.status, "locked", "MC6 开局锁定");

  // 支线开局即可选
  const ms1 = chainOf(st, "MS1"), ms2 = chainOf(st, "MS2");
  ok(ms1 && ms1.status === "available", "MS1 支线开局即可选（lockedBy=[]）");
  ok(ms2 && ms2.status === "available", "MS2 支线开局即可选");

  // 提前启动 MC2 应被拦截
  const r = await call("sys_chain_start", { id: "MC2" }, st);
  ok(/锁|未解锁|不能/.test(r.msg), "提前启动 MC2 被拦截：" + r.msg);
}

/* ══════════════════════════════════════════════════════
   4) MC1 线性推进 → 解锁 MC2
   ══════════════════════════════════════════════════════ */
section("4. MC1 线性推进 → 解锁 MC2");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);

  const r0 = await call("sys_chain_start", { id: "MC1" }, st);
  ok(/已接受/.test(r0.msg), "sys_chain_start MC1：" + r0.msg);
  eq(nodeOf(st, "MC1", "MC1_1").status, "active", "MC1_1 进入 active");

  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  eq(nodeOf(st, "MC1", "MC1_2").status, "selectable", "MC1_1 交付 → MC1_2 可接取");

  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  eq(nodeOf(st, "MC1", "MC1_3").status, "selectable", "MC1_2 交付 → MC1_3 可接取");

  await completeNode(st, "MC1", "MC1_3", "MCQ103");
  eq(chainOf(st, "MC1").status, "completed", "MC1_3 交付 → MC1 链完成");
  eq(chainOf(st, "MC2").status, "available", "MC1 完成 → MC2 解锁为 available");
}

/* ══════════════════════════════════════════════════════
   5) MC2 二选一分支（走 2_2A）
   ══════════════════════════════════════════════════════ */
section("5. MC2 分支抉择（走 2_2A 礼制线）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  await completeNode(st, "MC1", "MC1_3", "MCQ103");
  await call("sys_chain_start", { id: "MC2" }, st);

  await completeNode(st, "MC2", "MC2_1", "MCQ201");
  eq(chainOf(st, "MC2").status, "awaiting_choice", "MC2_1 交付 → 链进入待抉择");
  const ch = chainOf(st, "MC2");
  const opts = (ch.awaitChoice && ch.awaitChoice.options) || [];
  ok(opts.includes("MC2_2A") && opts.includes("MC2_2B"), "抉择项含 2_2A / 2_2B：" + opts.join(","));
  eq(nodeOf(st, "MC2", "MC2_2A").status, "locked", "抉择前 MC2_2A 保持 locked");

  const rc = await call("sys_chain_choose", { id: "MC2", node: "MC2_2A" }, st);
  ok(/已接受/.test(rc.msg), "sys_chain_choose 选 2_2A：" + rc.msg);
  eq(nodeOf(st, "MC2", "MC2_2A").status, "active", "MC2_2A 变为 active（引擎直接接受）");
  eq(nodeOf(st, "MC2", "MC2_2B").status, "locked", "未选的 MC2_2B 保持锁定");

  await completeNode(st, "MC2", "MC2_2A", "MCQ202A");
  eq(nodeOf(st, "MC2", "MC2_3").status, "selectable", "MC2_2A 交付 → MC2_3 可接取");
  await completeNode(st, "MC2", "MC2_3", "MCQ203");
  eq(chainOf(st, "MC2").status, "completed", "MC2 走 2_2A 线完成");
  eq(chainOf(st, "MC3").status, "available", "MC2 完成 → MC3 解锁");
}

/* ══════════════════════════════════════════════════════
   6) MC2 走 2_2B 线也能完成（平行分支）
   ══════════════════════════════════════════════════════ */
section("6. MC2 平行分支（走 2_2B 拍板线）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  await completeNode(st, "MC1", "MC1_3", "MCQ103");
  await call("sys_chain_start", { id: "MC2" }, st);
  await completeNode(st, "MC2", "MC2_1", "MCQ201");
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2B" }, st);
  eq(nodeOf(st, "MC2", "MC2_2B").status, "active", "MC2_2B 变为 active");
  await completeNode(st, "MC2", "MC2_2B", "MCQ202B");
  eq(nodeOf(st, "MC2", "MC2_3").status, "selectable", "MC2_2B 交付 → 汇合到 MC2_3");
  await completeNode(st, "MC2", "MC2_3", "MCQ203");
  eq(chainOf(st, "MC2").status, "completed", "MC2 走 2_2B 线同样完成（任一路径即完成链）");
}

/* ══════════════════════════════════════════════════════
   7) MC4 失败分支（放弃 = 失败）
   ══════════════════════════════════════════════════════ */
section("7. MC4 失败分支 → MC4_3F → 汇回");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);
  // 直接把 MC1..MC3 推完
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  await completeNode(st, "MC1", "MC1_3", "MCQ103");
  await call("sys_chain_start", { id: "MC2" }, st);
  await completeNode(st, "MC2", "MC2_1", "MCQ201");
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2A" }, st);
  await completeNode(st, "MC2", "MC2_2A", "MCQ202A");
  await completeNode(st, "MC2", "MC2_3", "MCQ203");
  await call("sys_chain_start", { id: "MC3" }, st);
  await completeNode(st, "MC3", "MC3_1", "MCQ301");
  await completeNode(st, "MC3", "MC3_2", "MCQ302");
  await completeNode(st, "MC3", "MC3_3", "MCQ303");
  await completeNode(st, "MC3", "MC3_4", "MCQ304");

  await call("sys_chain_start", { id: "MC4" }, st);
  await completeNode(st, "MC4", "MC4_1", "MCQ401");
  await completeNode(st, "MC4", "MC4_2", "MCQ402");
  await acceptNode(st, "MC4", "MC4_3");
  eq(nodeOf(st, "MC4", "MC4_3").status, "active", "MC4_3 已接取（限时 3000t）");

  // 放弃 = 失败
  const ra = await call("sys_chain_abandon", { id: "MC4", node: "MC4_3" }, st);
  ok(/失败|放弃/.test(ra.msg), "放弃 MC4_3 = 失败：" + ra.msg);
  eq(nodeOf(st, "MC4", "MC4_3").status, "failed", "MC4_3 状态 failed");
  eq(nodeOf(st, "MC4", "MC4_3F").status, "selectable", "onFail 分支 MC4_3F 被开启");
  eq(chainOf(st, "MC4").status, "running", "MC4 链继续 running（未断链）");

  await completeNode(st, "MC4", "MC4_3F", "MCQ403F");
  eq(nodeOf(st, "MC4", "MC4_4").status, "selectable", "MC4_3F 交付 → 汇回 MC4_4");
  await completeNode(st, "MC4", "MC4_4", "MCQ404");
  eq(chainOf(st, "MC4").status, "completed", "MC4 经失败线仍能完成");
}

/* ══════════════════════════════════════════════════════
   8) MC6 失败分支
   ══════════════════════════════════════════════════════ */
section("8. MC6 失败分支 → MC6_2F → 汇回");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);
  // 推进到 MC6
  const seq = [
    ["MC1", [["MC1_1", "MCQ101"], ["MC1_2", "MCQ102"], ["MC1_3", "MCQ103"]]],
    ["MC2", [["MC2_1", "MCQ201"]]],
    ["MC3", [["MC3_1", "MCQ301"], ["MC3_2", "MCQ302"], ["MC3_3", "MCQ303"], ["MC3_4", "MCQ304"]]],
    ["MC4", [["MC4_1", "MCQ401"], ["MC4_2", "MCQ402"], ["MC4_3", "MCQ403"], ["MC4_4", "MCQ404"]]],
    ["MC5", [["MC5_1", "MCQ501"], ["MC5_2", "MCQ502"], ["MC5_3", "MCQ503"], ["MC5_4", "MCQ504"]]],
  ];
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  await completeNode(st, "MC1", "MC1_3", "MCQ103");
  await call("sys_chain_start", { id: "MC2" }, st);
  await completeNode(st, "MC2", "MC2_1", "MCQ201");
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2A" }, st);
  await completeNode(st, "MC2", "MC2_2A", "MCQ202A");
  await completeNode(st, "MC2", "MC2_3", "MCQ203");
  await call("sys_chain_start", { id: "MC3" }, st);
  await completeNode(st, "MC3", "MC3_1", "MCQ301");
  await completeNode(st, "MC3", "MC3_2", "MCQ302");
  await completeNode(st, "MC3", "MC3_3", "MCQ303");
  await completeNode(st, "MC3", "MC3_4", "MCQ304");
  await call("sys_chain_start", { id: "MC4" }, st);
  await completeNode(st, "MC4", "MC4_1", "MCQ401");
  await completeNode(st, "MC4", "MC4_2", "MCQ402");
  await completeNode(st, "MC4", "MC4_3", "MCQ403");
  await completeNode(st, "MC4", "MC4_4", "MCQ404");
  await call("sys_chain_start", { id: "MC5" }, st);
  await completeNode(st, "MC5", "MC5_1", "MCQ501");
  await completeNode(st, "MC5", "MC5_2", "MCQ502");
  await completeNode(st, "MC5", "MC5_3", "MCQ503");
  await completeNode(st, "MC5", "MC5_4", "MCQ504");

  eq(chainOf(st, "MC6").status, "available", "MC5 完成 → MC6 可选");

  await call("sys_chain_start", { id: "MC6" }, st);
  await completeNode(st, "MC6", "MC6_1", "MCQ601");
  await acceptNode(st, "MC6", "MC6_2");
  eq(nodeOf(st, "MC6", "MC6_2").status, "active", "MC6_2 已接取（限时 4000t）");

  const ra = await call("sys_chain_abandon", { id: "MC6", node: "MC6_2" }, st);
  ok(/失败|放弃/.test(ra.msg), "放弃 MC6_2 = 失败：" + ra.msg);
  eq(nodeOf(st, "MC6", "MC6_2F").status, "selectable", "onFail 分支 MC6_2F 被开启");
  await completeNode(st, "MC6", "MC6_2F", "MCQ602F");
  eq(nodeOf(st, "MC6", "MC6_3").status, "selectable", "MC6_2F 交付 → 汇回 MC6_3");
  await completeNode(st, "MC6", "MC6_3", "MCQ603");
  eq(nodeOf(st, "MC6", "MC6_4").status, "selectable", "MC6_3 交付 → MC6_4");
  await completeNode(st, "MC6", "MC6_4", "MCQ604");
  eq(chainOf(st, "MC6").status, "completed", "MC6 经失败线仍能完成");
}

/* ══════════════════════════════════════════════════════
   9) 支线独立性 + 链任务不进普通委托「可接」页
   ══════════════════════════════════════════════════════ */
section("9. 支线独立 + 链任务不进普通委托可接页");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);

  await call("sys_chain_start", { id: "MS1" }, st);
  eq(chainOf(st, "MS1").status, "running", "MS1 支线可独立启动");
  eq(chainOf(st, "MC1").status, "available", "启动支线不影响主线 MC1（MC1 仍 available）");

  // 链节点 quest 不应出现在 questView.available
  await acceptNode(st, "MS1", "MS1_1");
  const qv = st.questView || {};
  const avail = (qv.available || []).map((q) => q.id);
  ok(!avail.includes("MSQ101"), "链节点任务不进入普通委托「可接」页");
  ok(!avail.includes("MCQ101"), "主线链节点任务不进入普通委托「可接」页");
}

/* ══════════════════════════════════════════════════════
   10) 暂停 / 继续（限时冻结）
   ══════════════════════════════════════════════════════ */
section("10. 暂停 / 继续（限时冻结）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_board", {}, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  eq(nodeOf(st, "MC1", "MC1_1").status, "active", "MC1_1 已接受（active）");

  const rp = await call("sys_chain_pause", { id: "MC1", node: "MC1_1" }, st);
  ok(/已暂停/.test(rp.msg), "sys_chain_pause：" + rp.msg);
  eq(nodeOf(st, "MC1", "MC1_1").status, "paused", "MC1_1 进入 paused");

  // 暂停中不可交付
  st.quests["MCQ101"] = { id: "MCQ101", status: "done" };
  const rt = await call("sys_chain_turnin", { id: "MC1", node: "MC1_1" }, st);
  ok(/暂停/.test(rt.msg), "暂停中不可交付：" + rt.msg);

  const rr = await call("sys_chain_resume", { id: "MC1", node: "MC1_1" }, st);
  ok(/已继续/.test(rr.msg), "sys_chain_resume：" + rr.msg);
  eq(nodeOf(st, "MC1", "MC1_1").status, "active", "MC1_1 恢复 active");
}

/* ══════════════════════════════════════════════════════
   11) 限时字段确实落到 quest 定义
   ══════════════════════════════════════════════════════ */
section("11. 限时 / 奖励字段落地");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const defs = st.chainBoard || [];
  const find = (cid, nid) => {
    const c = defs.find((x) => x.id === cid);
    return c ? c.nodes.find((n) => n.id === nid) : null;
  };
  eq(find("MC4", "MC4_3").quest.timeLimitTicks, 3000, "MC4_3 限时 3000t 生效");
  eq(find("MC6", "MC6_2").quest.timeLimitTicks, 4000, "MC6_2 限时 4000t 生效");
  eq(find("MC6", "MC6_2F").quest.timeLimitTicks, 2400, "MC6_2F 限时 2400t 生效");
  ok(find("MC3", "MC3_1").quest.flags?.done === "jade_slip_taken", "MC3_1 flags.done 写 jade_slip_taken");
  ok(find("MC1", "MC1_3").quest.flags?.done === "phase_1_done", "MC1_3 flags.done 写 phase_1_done（与 phase 事件联动）");
  ok(find("MC6", "MC6_4").quest.flags?.done === "breakthrough_done", "MC6_4 flags.done 写 breakthrough_done");
}

/* ══════════════════════════════════════════════════════
   12. 链定义/链进度按故事隔离（2026-11-09 修复）
   ══════════════════════════════════════════════════════ */
section("12. 链定义按故事隔离（链 id 冲突不互相覆盖）");
{
  // 场景：同一账号先后装「黑塔」和「通天」两个故事，
  //  两边的链 id 都是 MC1..MC6/MS1/MS2 —— 旧实现固定读全局 "chain_defs"，
  //  后装的故事因 id 已存在被跳过 → 跑的是另一个故事的主线链。
  resetStore();
  const st = newState();

  // 播种黑塔链定义到「黑塔」故事槽
  const heitaChains = [{
    id: "MC1", title: "消失的同桌", nodes: [{
      id: "MC1_1",
      quest: { id: "MCQ101", title: "花名册第三行", type: "talk", objectives: [{ kind: "talk", target: "妈妈", uid: "10", count: 1 }] },
      onSuccess: [], onFail: [],
    }],
  }];
  await pluginDataStore.set("chain_defs:黑塔：从超忆症开始成神", { version: 1, chains: heitaChains });
  // 播种通天链定义到「通天」故事槽
  await pluginDataStore.set("chain_defs:通天传授-收徒系统", { version: 1, chains: CHAINS });

  // 引擎按 context.worldName 读对应故事槽
  await call("sys_chain_board", {}, st);
  const chains = (st.chainView && st.chainView.chains) || [];
  eq(chains.length, 8, "读到通天的 8 条链（不是黑塔的 1 条）");
  ok(chains.some((c) => c.id === "MC6"), "chainView 含 MC6（通天的链）");
  const mc1 = chains.find((c) => c.id === "MC1");
  ok(mc1 && mc1.title === "系统绑定", "MC1 是通天的「系统绑定」（不是黑塔的「消失的同桌」）");

  // 换故事上下文 → 读另一个故事槽
  const ctx2 = {
    roles: [],
    worldName: "黑塔：从超忆症开始成神",
    tsApi: context.tsApi,
  };
  const st2 = newState();
  await pluginDataStore.set("chain_defs:黑塔：从超忆症开始成神", { version: 1, chains: heitaChains });
  const r2 = await handle_action("sys_chain_board", {}, st2, ctx2);
  const chains2 = (r2.state.chainView && r2.state.chainView.chains) || [];
  eq(chains2.length, 1, "黑塔故事槽读到 1 条链");
  ok(chains2[0] && chains2[0].title === "消失的同桌", "黑塔故事槽是「消失的同桌」");

  // 老数据回退：全局 chain_defs 仍可读
  const st3 = newState();
  await pluginDataStore.set("chain_defs", { version: 1, chains: heitaChains });
  const ctx3 = { roles: [], worldName: "", tsApi: context.tsApi };
  const r3 = await handle_action("sys_chain_board", {}, st3, ctx3);
  const chains3 = (r3.state.chainView && r3.state.chainView.chains) || [];
  eq(chains3.length, 1, "老数据（全局 chain_defs）仍能回退读取");
}

/* ══════════════════════════════════════════════════════
   13. 链进度按故事隔离
   ══════════════════════════════════════════════════════ */
section("13. 链进度按故事隔离");
{
  resetStore();
  const st = newState();
  await pluginDataStore.set("chain_defs:通天传授-收徒系统", { version: 1, chains: CHAINS });
  await call("sys_chain_board", {}, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");

  // 进度应写进「通天」槽
  const saved = pluginDataStore.get("chain_state:通天传授-收徒系统");
  ok(saved && saved.chains && saved.chains.MC1, "链进度写入 chain_state:通天传授-收徒系统");
  ok(!pluginDataStore.get("chain_state"), "没有写进全局 chain_state（不与其他故事串）");
}

/* ── 汇总 ─────────────────────────────────────────── */
console.log("\n" + "═".repeat(64));
console.log(`结果：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.log("\n失败项：");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
