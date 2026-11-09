/**
 * chain-engine.test.mjs —— 主线任务链引擎端到端测试
 * ====================================================
 * 用真实故事数据（黑塔 main-quests.json）驱动真实引擎（entry.ts handle_action），
 * 验证主线链的全套行为：
 *   ① 链解锁（lockedBy）
 *   ② 线性推进（完成后自动开下一个节点）
 *   ③ 多分支抉择（awaiting_choice → 选一条）
 *   ④ 平行分支走完任一条即完成链
 *   ⑤ 放弃 = 失败 → 走 onFail 分支
 *   ⑥ 失败分支可继续推进
 *   ⑦ 暂停 / 继续（计时冻结与补偿）
 *   ⑧ 链失败后可「从头再来」
 *   ⑨ 链节点任务不进普通委托「可接」页
 *
 * 运行：node test-host/chain-engine.test.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { handle_action } from "../entry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORY_DIR = resolve(__dirname, "../../../workshops/toonflow-field-survival/map_design/黑塔：从超忆症开始成神/events/任务事件");

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
const pluginDataStore = new Map();
const context = {
  roles: [],
  worldName: "黑塔",
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

/**
 * 完成一个链节点的完整流程：接取 → 目标达成 → 交付。
 * 引擎要求节点处于 active 才能交付，所以必须先 accept。
 */
async function completeNode(state, chainId, nodeId, questId) {
  await call("sys_chain_node_accept", { id: chainId, node: nodeId }, state);
  state.quests[questId] = { id: questId, status: "done", kill: {}, gather: {}, talked: {}, arrived: false };
  return await call("sys_chain_turnin", { id: chainId, node: nodeId }, state);
}

/* ══════════════════════════════════════════════════════
   0) 播种链定义
   ══════════════════════════════════════════════════════ */
section("0. 链定义播种");
{
  const st = newState();
  const r = await call("sys_chain_pool", { chains: CHAINS }, st);
  ok(/链池已更新/.test(r.msg), "sys_chain_pool 接受链定义：" + r.msg);
  eq(r.state.chainBoard.length, CHAINS.length, "链池条数正确");
  const r2 = await call("sys_chain_board", {}, r.state);
  ok(/主线/.test(r2.msg), "sys_chain_board 返回概览：" + r2.msg);
}

/* ══════════════════════════════════════════════════════
   1) 链解锁（lockedBy）
   ══════════════════════════════════════════════════════ */
section("1. 链解锁（lockedBy）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  // MC2 依赖 MC1
  const r = await call("sys_chain_start", { id: "MC2" }, st);
  ok(/还未解锁/.test(r.msg), "MC2 在 MC1 完成前不可开始：" + r.msg);
  // MC1 无前置 → 可开始
  const r2 = await call("sys_chain_start", { id: "MC1" }, st);
  ok(/已接受/.test(r2.msg), "MC1 可直接开始：" + r2.msg);
  const cv = r2.state.chainView;
  const mc1 = cv.chains.find((c) => c.id === "MC1");
  eq(mc1.status, "running", "MC1 状态为 running");
  const active = mc1.nodes.find((n) => n.status === "active");
  eq(active.id, "MC1_1", "MC1 第一个节点被激活");
}

/* ══════════════════════════════════════════════════════
   2) 线性推进：完成后自动开下一个
   ══════════════════════════════════════════════════════ */
section("2. 线性推进（MC1_1 → MC1_2）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  // 直接把节点任务标记完成（模拟目标达成）
  st.quests["MCQ101"] = { id: "MCQ101", status: "done", kill: {}, gather: {}, talked: {}, arrived: false };
  const r = await call("sys_chain_turnin", { id: "MC1", node: "MC1_1" }, st);
  ok(/已交付/.test(r.msg), "MC1_1 交付成功：" + r.msg);
  const mc1 = r.state.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.nodes.find((n) => n.id === "MC1_1").status, "done", "MC1_1 = done");
  eq(mc1.nodes.find((n) => n.id === "MC1_2").status, "selectable", "MC1_2 自动开为 selectable");
  eq(mc1.status, "running", "MC1 仍为 running（链未走完）");
  ok(/下一个主线任务已开启/.test(r.msg), "提示指向下一个主线任务：" + r.msg);
}

/* ══════════════════════════════════════════════════════
   3) 多分支抉择（MC2_1 → 2A / 2B）
   ══════════════════════════════════════════════════════ */
/** 完整跑完 MC1（解锁 MC2 的前置） */
async function finishMC1(st) {
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  return await completeNode(st, "MC1", "MC1_3", "MCQ103");
}

/* ══════════════════════════════════════════════════════
   3) 多分支抉择（MC2_1 → 2A / 2B）
   ══════════════════════════════════════════════════════ */
section("3. 多分支抉择（MC2）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r1 = await finishMC1(st);
  ok(/全部节点完成/.test(r1.msg), "MC1 链完成：" + r1.msg);

  // 现在 MC2 应解锁
  const r2 = await call("sys_chain_start", { id: "MC2" }, st);
  ok(/已接受/.test(r2.msg), "MC2 可开始：" + r2.msg);
  st.quests["MCQ201"] = { id: "MCQ201", status: "done" };
  const r3 = await call("sys_chain_turnin", { id: "MC2", node: "MC2_1" }, st);
  ok(/分支/.test(r3.msg), "MC2_1 交付后提示分支：" + r3.msg);
  const mc2 = r3.state.chainView.chains.find((c) => c.id === "MC2");
  eq(mc2.status, "awaiting_choice", "MC2 进入 awaiting_choice");
  eq(mc2.awaitChoice.options.length, 2, "待抉择分支数 = 2");
  ok(mc2.awaitChoice.options.includes("MC2_2A") && mc2.awaitChoice.options.includes("MC2_2B"), "分支含 2A / 2B");
  // 两个分支此时都应 locked
  eq(mc2.nodes.find((n) => n.id === "MC2_2A").status, "locked", "MC2_2A 仍 locked（等玩家选）");

  // 选一条
  const r4 = await call("sys_chain_choose", { id: "MC2", node: "MC2_2B" }, st);
  ok(/已接受/.test(r4.msg), "选择 MC2_2B 成功：" + r4.msg);
  const mc2b = r4.state.chainView.chains.find((c) => c.id === "MC2");
  eq(mc2b.nodes.find((n) => n.id === "MC2_2B").status, "active", "MC2_2B 变为 active");
  eq(mc2b.nodes.find((n) => n.id === "MC2_2A").status, "locked", "MC2_2A 保持 locked（另一条路没走）");
}

/* ══════════════════════════════════════════════════════
   4) 平行分支走完任一条即完成链
   ══════════════════════════════════════════════════════ */
section("4. 平行分支：走完 2B 即完成 MC2");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await finishMC1(st);
  await call("sys_chain_start", { id: "MC2" }, st);
  st.quests["MCQ201"] = { id: "MCQ201", status: "done" };
  await call("sys_chain_turnin", { id: "MC2", node: "MC2_1" }, st);
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2B" }, st);
  st.quests["MCQ202B"] = { id: "MCQ202B", status: "done" };
  const r = await call("sys_chain_turnin", { id: "MC2", node: "MC2_2B" }, st);
  ok(/全部节点完成/.test(r.msg), "MC2 走 2B 分支即完成：" + r.msg);
  const mc2 = r.state.chainView.chains.find((c) => c.id === "MC2");
  eq(mc2.status, "completed", "MC2 = completed");
  // MC3 依赖 MC2 → 现在应解锁
  const r3 = await call("sys_chain_start", { id: "MC3" }, st);
  ok(/已接受/.test(r3.msg), "MC3 因 MC2 完成而解锁：" + r3.msg);
}

/* ══════════════════════════════════════════════════════
   5) 放弃 = 失败 → 走 onFail 分支
   ══════════════════════════════════════════════════════ */
section("5. 放弃=失败，走 onFail 分支（MC3_1 → MC3_1F）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await finishMC1(st);
  await call("sys_chain_start", { id: "MC2" }, st);
  st.quests["MCQ201"] = { id: "MCQ201", status: "done" };
  await call("sys_chain_turnin", { id: "MC2", node: "MC2_1" }, st);
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2A" }, st);
  st.quests["MCQ202A"] = { id: "MCQ202A", status: "done" };
  await call("sys_chain_turnin", { id: "MC2", node: "MC2_2A" }, st);
  await call("sys_chain_start", { id: "MC3" }, st);
  // 放弃 MC3_1
  const r = await call("sys_chain_abandon", { id: "MC3", node: "MC3_1" }, st);
  ok(/失败/.test(r.msg), "放弃 MC3_1 视为失败：" + r.msg);
  const mc3 = r.state.chainView.chains.find((c) => c.id === "MC3");
  eq(mc3.nodes.find((n) => n.id === "MC3_1").status, "failed", "MC3_1 = failed");
  eq(mc3.nodes.find((n) => n.id === "MC3_1").failReason, "abandon", "失败原因 = abandon");
  eq(mc3.nodes.find((n) => n.id === "MC3_1F").status, "selectable", "失败分支 MC3_1F 被开启");
  ok(mc3.status !== "failed", "MC3 未整体失败（还有失败分支可走）");
}

/* ══════════════════════════════════════════════════════
   6) 失败分支可继续推进到链完成
   ══════════════════════════════════════════════════════ */
section("6. 失败分支继续推进 → MC3 完成");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await finishMC1(st);
  await call("sys_chain_start", { id: "MC2" }, st);
  st.quests["MCQ201"] = { id: "MCQ201", status: "done" };
  await call("sys_chain_turnin", { id: "MC2", node: "MC2_1" }, st);
  await call("sys_chain_choose", { id: "MC2", node: "MC2_2A" }, st);
  st.quests["MCQ202A"] = { id: "MCQ202A", status: "done" };
  await call("sys_chain_turnin", { id: "MC2", node: "MC2_2A" }, st);
  await call("sys_chain_start", { id: "MC3" }, st);
  await call("sys_chain_abandon", { id: "MC3", node: "MC3_1" }, st);
  // 接受失败分支
  const r1 =   await call("sys_chain_node_accept", { id: "MC3", node: "MC3_1F" }, st);
  ok(/已接受/.test(r1.msg), "接受失败分支 MC3_1F：" + r1.msg);
  st.quests["MCQ301F"] = { id: "MCQ301F", status: "done" };
  const r2 = await call("sys_chain_turnin", { id: "MC3", node: "MC3_1F" }, st);
  const mc3 = r2.state.chainView.chains.find((c) => c.id === "MC3");
  eq(mc3.nodes.find((n) => n.id === "MC3_2").status, "selectable", "MC3_2 被开启（失败分支汇入主线）");
  // MC3_2 需先接取才能交付
  await call("sys_chain_node_accept", { id: "MC3", node: "MC3_2" }, st);
  st.quests["MCQ302"] = { id: "MCQ302", status: "done" };
  const r3 = await call("sys_chain_turnin", { id: "MC3", node: "MC3_2" }, st);
  ok(/全部节点完成/.test(r3.msg), "MC3 经失败分支仍能完成：" + r3.msg);
}

/* ══════════════════════════════════════════════════════
   7) 暂停 / 继续
   ══════════════════════════════════════════════════════ */
section("7. 暂停 / 继续");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  const r1 = await call("sys_chain_pause", { id: "MC1", node: "MC1_1" }, st);
  ok(/已暂停/.test(r1.msg), "暂停 MC1_1：" + r1.msg);
  let mc1 = r1.state.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.nodes.find((n) => n.id === "MC1_1").status, "paused", "MC1_1 = paused");
  // 暂停时不能交付
  st.quests["MCQ101"] = { id: "MCQ101", status: "done" };
  const r2 = await call("sys_chain_turnin", { id: "MC1", node: "MC1_1" }, st);
  ok(/暂停/.test(r2.msg), "暂停中不可交付：" + r2.msg);
  const r3 = await call("sys_chain_resume", { id: "MC1", node: "MC1_1" }, st);
  ok(/已继续/.test(r3.msg), "继续 MC1_1：" + r3.msg);
  mc1 = r3.state.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.nodes.find((n) => n.id === "MC1_1").status, "active", "MC1_1 回到 active");
  // 继续后可交付
  const r4 = await call("sys_chain_turnin", { id: "MC1", node: "MC1_1" }, st);
  ok(/已交付/.test(r4.msg), "继续后可交付：" + r4.msg);
}

/* ══════════════════════════════════════════════════════
   8) 链失败后可「从头再来」
   ══════════════════════════════════════════════════════ */
section("8. 失败后从头再来");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  await call("sys_chain_abandon", { id: "MC1", node: "MC1_1" }, st);
  let mc1 = st.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.status, "failed", "MC1 因放弃且无 onFail 而失败");
  const r1 = await call("sys_chain_start", { id: "MC1" }, st);
  ok(/从头再来/.test(r1.msg), "失败链不可直接开始，提示重置：" + r1.msg);
  const r2 = await call("sys_chain_retry", { id: "MC1" }, st);
  ok(/已重置/.test(r2.msg), "sys_chain_retry 重置成功：" + r2.msg);
  mc1 = r2.state.chainView.chains.find((c) => c.id === "MC1");
  eq(mc1.status, "available", "重置后 MC1 回到 available（已解锁可重开）");
  eq(mc1.nodes.find((n) => n.id === "MC1_1").status, "locked", "重置后节点回到 locked");
  const r3 = await call("sys_chain_start", { id: "MC1" }, st);
  ok(/已接受/.test(r3.msg), "重置后可重新开始：" + r3.msg);
}

/* ══════════════════════════════════════════════════════
   9) 链节点不进普通委托「可接」页
   ══════════════════════════════════════════════════════ */
section("9. 链节点不进普通委托「可接」页");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r = await call("sys_chain_start", { id: "MC1" }, st);
  const qv = r.state.questView || (await call("sys_quest_board", {}, r.state)).state.questView;
  ok(!!qv, "questView 存在");
  const inAvailable = qv.available.filter((q) => String(q.id) === "MCQ101");
  eq(inAvailable.length, 0, "链节点 MCQ101 不在「可接」页");
  const inActive = qv.active.filter((q) => String(q.id) === "MCQ101");
  eq(inActive.length, 1, "链节点 MCQ101 在「进行中」页");
}

/* ══════════════════════════════════════════════════════
   10) 支线链独立统计
   ══════════════════════════════════════════════════════ */
section("10. 支线链（MS1）与主线分开统计");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  const r = await call("sys_chain_board", {}, st);
  const cv = r.state.chainView;
  ok(cv.mainTotal >= 8, `主线链总数 = ${cv.mainTotal}（应 ≥8）`);
  ok(cv.sideTotal >= 2, `支线链总数 = ${cv.sideTotal}（应 ≥2）`);
  const ms1 = cv.chains.find((c) => c.id === "MS1");
  ok(ms1 && ms1.side === true, "MS1 标记为支线");
}

/* ══════════════════════════════════════════════════════
   11) 系统「任务」页「★ 主线」标识（from / isChain / chainId）
   ══════════════════════════════════════════════════════ */
section("11. 系统任务页「★ 主线」标识字段");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  // 混一条普通委托，确认不会被误标成主线
  st.questBoard.push({
    id: "NQ_NORMAL", title: "普通委托", type: "kill",
    objectives: [{ kind: "kill", target: "湮物", count: 1 }], reward: {},
  });
  const r = await call("sys_quest_board", {}, st);
  const qv = r.state.questView;
  const all = [...(qv.available || []), ...(qv.active || []), ...(qv.done || []), ...(qv.turned || [])];
  const chainRow = all.find((q) => String(q.id) === "MCQ101");
  const normalRow = all.find((q) => String(q.id) === "NQ_NORMAL");
  ok(!!chainRow, "委托视图能查到链节点 MCQ101");
  eq(chainRow?.from, "chain:MC1:MC1_1", "from = chain:<chainId>:<nodeId>");
  eq(chainRow?.isChain, true, "isChain = true（前端据此显示 ★ 主线）");
  eq(chainRow?.chainId, "MC1", "chainId = MC1");
  ok(!!normalRow, "委托视图能查到普通委托 NQ_NORMAL");
  eq(normalRow?.isChain, false, "普通委托 isChain = false");
  eq(normalRow?.chainId, "", "普通委托 chainId 为空");
}

/* ══════════════════════════════════════════════════════
   12) 主线「🧭 寻路」数据契约
   ══════════════════════════════════════════════════════ */
section("12. 主线节点寻路（nodeHasDest / questGoToDest 数据契约）");
{
  const st = newState();
  await call("sys_chain_pool", { chains: CHAINS }, st);
  await call("sys_chain_start", { id: "MC1" }, st);
  await completeNode(st, "MC1", "MC1_1", "MCQ101");
  await completeNode(st, "MC1", "MC1_2", "MCQ102");
  await call("sys_chain_node_accept", { id: "MC1", node: "MC1_3" }, st);
  const mc1 = st.chainView.chains.find((c) => c.id === "MC1");
  const n3 = mc1.nodes.find((n) => n.id === "MC1_3");
  const n1 = mc1.nodes.find((n) => n.id === "MC1_1");
  // 与 QuestPanel.vue 的 nodeHasDest 同口径（改前端函数时这里要同步）
  const hasDest = (n) => {
    if (!n) return false;
    if (typeof n.destX === "number" && typeof n.destY === "number") return !!(n.destMapRaw || n.destMap);
    return (n.objectives || []).some((o) =>
      (o.kind === "arrive" || o.kind === "explore") && typeof o.x === "number" && typeof o.y === "number");
  };
  eq(n3.questId, "MCQ103", "节点带 questId（chain-go 的 emit 参数）");
  eq(n3.destX, 16, "MC1_3 destX = 16");
  eq(n3.destY, 24, "MC1_3 destY = 24");
  ok(!!n3.destMapRaw, `MC1_3 destMapRaw 非空（${n3.destMapRaw}）`);
  eq(hasDest(n3), true, "带 arrive 坐标的节点 → 显示「🧭 寻路」");
  eq(hasDest(n1), false, "纯 talk 节点 → 不显示「🧭 寻路」");
  // questGoToDest 的跨图分支遍历 questView.active，同一 questId 必须能查到
  const qv = (await call("sys_quest_board", {}, st)).state.questView;
  const row = (qv.active || []).find((q) => String(q.id) === "MCQ103");
  ok(!!row, "MCQ103 在委托视图「进行中」页（questGoToDest 可查）");
  ok((row?.objectives || []).some((o) => o.kind === "arrive" && o.x === 16 && o.y === 24), "委托行透传 arrive 坐标");
  eq(row?.isChain, true, "该行同样带主线标识");
}

/* ══════════════════════════════════════════════════════
   13) 刷新后链定义重载（ensureChainDefs 守卫回归）
   ══════════════════════════════════════════════════════ */
section("13. 刷新后链定义重载（chainState 非空不能当已载入）");
{
  // 真机复现：sys_state 存档恢复出 chainState，但 chainBoard 是运行时字段、不进存档。
  // 旧实现拿 chainState 非空当「已载入」直接 return → 主线页空白、★主线 0、寻路全消失。
  const st = newState();
  st.chainState = { MC1: { id: "MC1", status: "running", nodes: {} } };
  st.chainBoard = [];
  pluginDataStore.set("chain_defs", { version: 1, chains: CHAINS });
  const r = await call("sys_chain_board", {}, st);
  eq(r.state.chainBoard.length, CHAINS.length, "chainState 非空 / chainBoard 空 → 仍从 chain_defs 重载链定义");
  eq((r.state.chainView?.chains || []).length, CHAINS.length, "chainView 恢复出全部链（主线页不再空白）");
  const r2 = await call("sys_chain_start", { id: "MC1" }, r.state);
  ok(!/没有这条主线/.test(r2.msg), "sys_chain_start MC1 不再回「没有这条主线」：" + r2.msg);
  pluginDataStore.delete("chain_defs");
}

/* ── 汇总 ─────────────────────────────────────────── */
console.log("\n" + "═".repeat(64));
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log("\n失败明细：");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log("全部通过 ✓");
