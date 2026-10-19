// ★ 实体形象系统单测：覆盖 generate / bind / unbind / gallery_del / 刷新恢复 / 字段归属
// 2026-10-19 新增——与 test_skill_sell/test_kill_reward 等并列。
//
// 跑法：node .cache/test_avatar_sprite.mjs
// 依赖：import('../plugins/toonflow-field-survival/entry.js')（已由 esbuild 编出）

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY = path.resolve("plugins/toonflow-field-survival/entry.js");
const SRC_TS = path.resolve("plugins/toonflow-field-survival/entry.ts");
if (!fs.existsSync(ENTRY)) {
  console.error("entry.js 缺失：先 cd plugins/toonflow-field-survival/vue && node_modules/esbuild/bin/esbuild ../entry.ts --outfile=../entry.js --bundle=false --format=esm --target=es2020");
  process.exit(1);
}

const mod = await import(pathToFileURL(ENTRY).href + "?t=" + Date.now());
if (typeof mod.handle_action !== "function") {
  console.error("entry.js 缺 handle_action");
  process.exit(1);
}

let pass = 0, fail = 0;
const T = [];

function ok(name, cond, info) {
  if (cond) { pass++; T.push("✅ " + name); }
  else { fail++; T.push("❌ " + name + (info ? " :: " + info : "")); }
}

function baseState(extra = {}) {
  return {
    phase: "playing", version: 3, tick: 100, world: { w: 3000, h: 3000 },
    roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [{ id: "r1", name: "玩家", side: "player", x: 0, y: 0, hp: 100, maxHp: 100, level: 1, atk: 1, facing: 0, cooldown: 0, alive: true, avatarPath: "orig.png" }],
    chests: [], potions: [], floaters: [], skills: [], items: [], skillPage: 0, itemPage: 0,
    playerCard: { name: "t" },
    spriteGallery: [], avatarBinds: {}, spriteGen: { status: "idle" }, spriteRevision: 0,
    exp: 0, money: 0, drops: [], kills: 0, events: [], map: null, regions: [], town: null,
    result: null, partyIds: [], parked: {}, ...extra,
  };
}

function makeCtx({ stored, agentRun, persistHook } = {}) {
  const api = { get: async () => stored || null, set: async (k, v) => { if (persistHook) persistHook(k, v); }, list: async () => [] };
  return { tsApi: { pluginData: api, agent: { run: agentRun || (async () => ({ ok: false, error: "no agent" })) } }, playerCard: {}, roles: [] };
}

async function call(action, params, state, ctx) {
  const r = await mod.handle_action(action, params, state, ctx);
  return r;
}

// ============================================================
// §1 sys_sprite_generate：成功入图库 + 状态字段
// ============================================================
{
  const s = baseState();
  const persists = [];
  const ctx = makeCtx({ agentRun: async (n, i) => n === "field-survival-sprite-gener" ? { ok: true, output: { image: "data:image/png;base64,GEN1", prompt: i.prompt } } : { ok: false }, persistHook: (k, v) => persists.push({ k, gal: (v.spriteGallery||[]).length, binds: Object.keys(v.avatarBinds||{}) }) });
  const r = await call("sys_sprite_generate", { prompt: "黑发红衣的游侠" }, s, ctx);
  ok("§1.1 generate resp 含「已生成」", /已生成/.test(r.response));
  ok("§1.2 spriteGallery 追加 1 项", (r.state.spriteGallery||[]).length === 1);
  ok("§1.3 spriteRevision >= 2", (r.state.spriteRevision|0) >= 2);
  ok("§1.4 spriteGen.status=done", r.state.spriteGen && r.state.spriteGen.status === "done");
  ok("§1.5 图库项的 image 是 data:URL", (r.state.spriteGallery[0].image || "").startsWith("data:"));
  ok("§1.6 persistSys 把 spriteGallery 写入 sys_state", persists.some(p => p.k === "sys_state" && p.gal >= 1));
  ok("§1.7 防重入：同帧连点第二次直接被拒", (await call("sys_sprite_generate", { prompt: "x" }, { ...r.state, spriteGen: { status: "running" } }, makeCtx({ agentRun: async () => ({ ok: false }) }))).response.includes("还在生成"));
}

// §1.8 缺提示词
{
  const r = await call("sys_sprite_generate", { prompt: "   " }, baseState(), makeCtx());
  ok("§1.8 缺提示词给出友好提示", /请先填写/.test(r.response));
}

// ============================================================
// §2 sys_sprite_bind：覆盖角色/实体头像
// ============================================================
{
  const s = baseState();
  const ctx = makeCtx();
  const r = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, s, ctx);
  ok("§2.1 bind 返回「更换形象」文案", /更换形象/.test(r.response));
  ok("§2.2 avatarBinds 含 r1", Object.keys(r.state.avatarBinds||{}).includes("r1"));
  ok("§2.3 实体 avatarPath 跟着改", r.state.entities[0].avatarPath === "data:image/png;base64,AV");
  ok("§2.4 npcCards 角色卡 avatarPath 跟着改", ((r.state.npcCards||[]).find(c => c.id === "r1") || {}).avatarPath === "data:image/png;base64,AV");
}

// §2.5 预选路径
{
  const r = await call("sys_sprite_bind", { target: "r1", image: "./images/player_sprites/4334.png" }, baseState(), makeCtx());
  ok("§2.5 预选路径也能 bind", r.state.entities[0].avatarPath === "./images/player_sprites/4334.png");
}

// §2.6 PLAYER 简写
{
  const r = await call("sys_sprite_bind", { target: "PLAYER", image: "data:image/png;base64,AV" }, baseState(), makeCtx());
  ok("§2.6 target=PLAYER 自动解析为 r1", Object.keys(r.state.avatarBinds||{}).includes("r1"));
}

// §2.7 缺图
{
  const r = await call("sys_sprite_bind", { target: "r1", image: "  " }, baseState(), makeCtx());
  ok("§2.7 缺图给出友好提示", /请选择/.test(r.response));
}

// ============================================================
// §3 sys_sprite_unbind：恢复原始
// ============================================================
{
  const s = baseState();
  // 先 bind 再 unbind
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, s, makeCtx());
  const r2 = await call("sys_sprite_unbind", { target: "r1" }, r1.state, makeCtx());
  ok("§3.1 unbind 返回「恢复原始形象」", /恢复原始形象/.test(r2.response));
  ok("§3.2 avatarBinds 清空", Object.keys(r2.state.avatarBinds||{}).length === 0);
  ok("§3.3 实体 avatarPath 恢复原值", r2.state.entities[0].avatarPath === "orig.png");
}

// §3.4 缺 target
{
  const r = await call("sys_sprite_unbind", { target: "" }, baseState(), makeCtx());
  ok("§3.4 缺 target 提示「缺少目标」", /缺少目标/.test(r.response));
}

// ============================================================
// §4 sys_sprite_gallery_del：删图 + 解绑
// ============================================================
{
  const s = baseState({ spriteGallery: [{ id: "sp1", image: "data:image/png;base64,AV", prompt: "test", source: "ai", createdAt: 1 }] });
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, s, makeCtx());
  const r2 = await call("sys_sprite_gallery_del", { id: "sp1" }, r1.state, makeCtx());
  ok("§4.1 del 返回「已删除」", /已删除/.test(r2.response));
  ok("§4.2 spriteGallery 清空", (r2.state.spriteGallery||[]).length === 0);
  ok("§4.3 删图后绑定关系一并解除", Object.keys(r2.state.avatarBinds||{}).length === 0);
  ok("§4.4 实体恢复原始形象", r2.state.entities[0].avatarPath === "orig.png");
}

// §4.5 删不存在的 id
{
  const r = await call("sys_sprite_gallery_del", { id: "no-such" }, baseState(), makeCtx());
  ok("§4.5 删不存在的 id 不报错", /形象不存在/.test(r.response) || /已删除/.test(r.response));
}

// ============================================================
// §5 sys_sprite_gallery_clear：清空图库
// ============================================================
{
  const s = baseState({ spriteGallery: [
    { id: "sp1", image: "data:image/png;base64,A", prompt: "a", source: "ai", createdAt: 1 },
    { id: "sp2", image: "data:image/png;base64,B", prompt: "b", source: "ai", createdAt: 2 },
  ] });
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,A" }, s, makeCtx());
  const r2 = await call("sys_sprite_gallery_clear", {}, r1.state, makeCtx());
  ok("§5.1 clear 返回「清空」", /清空/.test(r2.response));
  ok("§5.2 spriteGallery 变 0", (r2.state.spriteGallery||[]).length === 0);
  ok("§5.3 引用图库的绑定一并解除", Object.keys(r2.state.avatarBinds||{}).length === 0);
}

// ============================================================
// §6 刷新恢复：start 之后 spriteGallery/avatarBinds 全部从 sys_state 灌回
// ============================================================
{
  const stored = {
    spriteGallery: [{ id: "sp1", image: "data:image/png;base64,AV", prompt: "test", source: "ai", createdAt: 1 }],
    avatarBinds: { r1: "data:image/png;base64,AV" },
    card: { items: [], money: 0, level: 1, exp: 0, hp: 100, mp: 100, skills: [] },
    bagMeta: {}, bagOrder: [], skillOrder: [], shop: [], level: "Mulberry Town", parked: {},
  };
  const ctx = { tsApi: { pluginData: { get: async (k) => k === "sys_state" ? stored : null, set: async () => {}, list: async () => [] }, agent: { run: async () => ({ ok: false }) } }, playerCard: {}, roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }] };
  const s = baseState();
  const r = await call("start", { selections: { participants: [], spectators: [], enemies: [] } }, s, ctx);
  ok("§6.1 start 后 spriteGallery 恢复", (r.state.spriteGallery||[]).length === 1);
  ok("§6.2 start 后 avatarBinds 恢复", Object.keys(r.state.avatarBinds||{}).includes("r1"));
  ok("§6.3 玩家实体 avatarPath 用上恢复的图", r.state.entities.find(e => e.id === "r1").avatarPath === "data:image/png;base64,AV");
  ok("§6.4 角色卡 avatarPath 用上恢复的图", ((r.state.npcCards||[]).find(c => c.id === "r1") || {}).avatarPath === "data:image/png;base64,AV");
}

// ============================================================
// §7 字段归属：未绑定时用故事卡原图，不被空模板覆盖
// ============================================================
{
  // 模拟：syncCardFromContext 入口的 guard —— restoreSys 已恢复出非空图库，但 ctx.playerCard
  // 是空模板。如果 syncCardFromContext 无脑覆盖 → 实体/卡 avatarPath 丢失。
  // 本测试不直接调 syncCardFromContext（它是内部函数），但用 start → 后续 tick 的链路验证
  // 字段归属逻辑：restoreSys 恢复后, ensureNpcCards / applyAvatarBindToEntities 应使用已恢复的 binds。
  const stored = {
    spriteGallery: [{ id: "sp1", image: "data:image/png;base64,AV", prompt: "test", source: "ai", createdAt: 1 }],
    avatarBinds: { r1: "data:image/png;base64,AV" },
    card: { items: [], money: 0, level: 1, exp: 0, hp: 100, mp: 100, skills: [] },
    bagMeta: {}, bagOrder: [], skillOrder: [], shop: [], level: "Mulberry Town", parked: {},
  };
  // ctx.playerCard 是「开局模板」——空 items
  const ctx = { tsApi: { pluginData: { get: async (k) => k === "sys_state" ? stored : null, set: async () => {}, list: async () => [] }, agent: { run: async () => ({ ok: false }) } }, playerCard: { items: [], name: "t" }, roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }] };
  const s = baseState();
  const r = await call("start", { selections: { participants: [], spectators: [], enemies: [] } }, s, ctx);
  ok("§7.1 修复：restoreSys 后 entity 仍使用 binds 里的图（不丢）", r.state.entities.find(e => e.id === "r1").avatarPath === "data:image/png;base64,AV");
  ok("§7.2 修复：restoreSys 后 npcCards 仍使用 binds 里的图（不丢）", ((r.state.npcCards||[]).find(c => c.id === "r1") || {}).avatarPath === "data:image/png;base64,AV");
}

// ============================================================
console.log(T.join("\n"));
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
