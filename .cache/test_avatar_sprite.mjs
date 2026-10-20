// ★ 实体形象系统单测（customSprite 通道：canvas 走立绘，npcCard 走头像）
// 2026-10-19 b838613 → 2026-10-19 二改（customSprite 通道）
//
// 跑法：node .cache/test_avatar_sprite.mjs

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY = path.resolve("plugins/toonflow-field-survival/entry.js");
if (!fs.existsSync(ENTRY)) {
  console.error("entry.js 缺失：先 cd plugins/toonflow-field-survival/vue && node_modules/esbuild/bin/esbuild ../entry.ts --outfile=../entry.js --bundle=false --format=esm --target=es2020");
  process.exit(1);
}
const mod = await import(pathToFileURL(ENTRY).href + "?t=" + Date.now());
if (typeof mod.handle_action !== "function") { console.error("缺 handle_action"); process.exit(1); }

let pass = 0, fail = 0;
const T = [];
function ok(name, cond, info) { if (cond) { pass++; T.push("✅ " + name); } else { fail++; T.push("❌ " + name + (info ? " :: " + info : "")); } }

function baseState(extra = {}) {
  return {
    phase: "playing", version: 3, tick: 100, world: { w: 3000, h: 3000 },
    roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [{ id: "r1", name: "玩家", side: "player", x: 0, y: 0, hp: 100, maxHp: 100, level: 1, atk: 1, facing: 0, cooldown: 0, alive: true, avatarPath: "orig.png" }],
    chests: [], potions: [], floaters: [], skills: [], items: [], skillPage: 0, itemPage: 0,
    playerCard: { name: "t" },
    spriteGallery: [], spriteBinds: {}, spriteGen: { status: "idle" }, spriteRevision: 0,
    exp: 0, money: 0, drops: [], kills: 0, events: [], map: null, regions: [], town: null,
    result: null, partyIds: [], parked: {}, ...extra,
  };
}
function makeCtx({ stored, agentRun, persistHook } = {}) {
  const api = { get: async () => stored || null, set: async (k, v) => { if (persistHook) persistHook(k, v); }, list: async () => [] };
  return { tsApi: { pluginData: api, agent: { run: agentRun || (async () => ({ ok: false, error: "no agent" })) } }, playerCard: {}, roles: [] };
}
async function call(action, params, state, ctx) { return await mod.handle_action(action, params, state, ctx); }

// §1 sys_sprite_generate：成功入图库 + 状态字段
{
  const s = baseState();
  const persists = [];
  const ctx = makeCtx({ agentRun: async (n, i) => n === "field-survival-sprite-gener" ? { ok: true, output: { image: "data:image/png;base64,GEN1", prompt: i.prompt } } : { ok: false }, persistHook: (k, v) => persists.push({ k, gal: (v.spriteGallery || []).length, binds: Object.keys(v.spriteBinds || {}) }) });
  const r = await call("sys_sprite_generate", { prompt: "黑发红衣的游侠" }, s, ctx);
  ok("§1.1 generate resp 含「已生成」", /已生成/.test(r.response));
  ok("§1.2 spriteGallery 追加 1 项", (r.state.spriteGallery || []).length === 1);
  ok("§1.3 spriteRevision >= 2", (r.state.spriteRevision | 0) >= 2);
  ok("§1.4 spriteGen.status=done", r.state.spriteGen && r.state.spriteGen.status === "done");
  ok("§1.5 图库项的 image 是 data:URL", (r.state.spriteGallery[0].image || "").startsWith("data:"));
  ok("§1.6 persistSys 把 spriteGallery 写入 sys_state", persists.some(p => p.k === "sys_state" && p.gal >= 1));
  ok("§1.7 防重入：同帧连点第二次直接被拒", (await call("sys_sprite_generate", { prompt: "x" }, { ...r.state, spriteGen: { status: "running" } }, makeCtx({ agentRun: async () => ({ ok: false }) }))).response.includes("还在生成"));
}
{
  const r = await call("sys_sprite_generate", { prompt: "   " }, baseState(), makeCtx());
  ok("§1.8 缺提示词给出友好提示", /请先填写/.test(r.response));
}

// §2 sys_sprite_bind：customSprite 通道（取代旧 avatarPath 通道）
{
  const s = baseState();
  const r = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, s, makeCtx());
  const ent = r.state.entities[0];
  const card = (r.state.npcCards || []).find(c => c.id === "r1");
  ok("§2.1 bind 返回「更换形象」文案", /更换形象/.test(r.response));
  ok("§2.2 entity.customSprite 写入 data:URL", ent.customSprite && ent.customSprite.image === "data:image/png;base64,AV");
  ok("§2.3 entity.avatarPath 保留原故事卡", ent.avatarPath === "orig.png");
  ok("§2.4 npcCard.customSprite 写入（前端小头像/详情可用）", card && card.customSprite && card.customSprite.image === "data:image/png;base64,AV");
  ok("§2.5 npcCard.avatarPath 保持原头像（换实体形象不得影响悬浮头像）", card && card.avatarPath === "orig.png");
  ok("§2.6 spriteBinds 是对象形态（不再是 string）", r.state.spriteBinds.r1 && typeof r.state.spriteBinds.r1 === "object" && r.state.spriteBinds.r1.image);
}
{
  const r = await call("sys_sprite_bind", { target: "r1", image: "./images/player_sprites/4334.png" }, baseState(), makeCtx());
  ok("§2.7 预选路径（./ 开头）写入 customSprite.image", r.state.entities[0].customSprite && r.state.entities[0].customSprite.image === "./images/player_sprites/4334.png");
  ok("§2.8 预选路径 source 自动归 preset", r.state.entities[0].customSprite && r.state.entities[0].customSprite.source === "preset");
}
{
  const r = await call("sys_sprite_bind", { target: "PLAYER", image: "data:image/png;base64,AV" }, baseState(), makeCtx());
  ok("§2.9 target=PLAYER 自动解析为 r1", Object.keys(r.state.spriteBinds || {}).includes("r1"));
}
{
  const r = await call("sys_sprite_bind", { target: "r1", image: "  " }, baseState(), makeCtx());
  ok("§2.10 缺图给出友好提示", /请选择/.test(r.response));
}

// §3 sys_sprite_unbind：清 customSprite，avatarPath 保留
{
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, baseState(), makeCtx());
  const r2 = await call("sys_sprite_unbind", { target: "r1" }, r1.state, makeCtx());
  const ent = r2.state.entities[0];
  ok("§3.1 unbind 返回「恢复原始形象」", /恢复原始形象/.test(r2.response));
  ok("§3.2 spriteBinds 清空", Object.keys(r2.state.spriteBinds || {}).length === 0);
  ok("§3.3 entity.customSprite 清除", !ent.customSprite);
  ok("§3.4 entity.avatarPath 保留原故事卡值（不丢）", ent.avatarPath === "orig.png");
}
{
  const r = await call("sys_sprite_unbind", { target: "" }, baseState(), makeCtx());
  ok("§3.5 缺 target 提示「缺少目标」", /缺少目标/.test(r.response));
}

// §4 sys_sprite_gallery_del：删图 + 解绑
{
  const s = baseState({ spriteGallery: [{ id: "sp1", image: "data:image/png;base64,AV", prompt: "test", source: "ai", createdAt: 1 }] });
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,AV" }, s, makeCtx());
  const r2 = await call("sys_sprite_gallery_del", { id: "sp1" }, r1.state, makeCtx());
  ok("§4.1 del 返回「已删除」", /已删除/.test(r2.response));
  ok("§4.2 spriteGallery 清空", (r2.state.spriteGallery || []).length === 0);
  ok("§4.3 删图后绑定关系一并解除", Object.keys(r2.state.spriteBinds || {}).length === 0);
  ok("§4.4 删图后 entity.customSprite 清除", !r2.state.entities[0].customSprite);
  ok("§4.5 删图后 entity.avatarPath 仍是原故事卡", r2.state.entities[0].avatarPath === "orig.png");
}
{
  const r = await call("sys_sprite_gallery_del", { id: "no-such" }, baseState(), makeCtx());
  ok("§4.6 删不存在的 id 不报错", /形象不存在/.test(r.response) || /已删除/.test(r.response));
}

// §5 sys_sprite_gallery_clear：清空图库
{
  const s = baseState({ spriteGallery: [
    { id: "sp1", image: "data:image/png;base64,A", prompt: "a", source: "ai", createdAt: 1 },
    { id: "sp2", image: "data:image/png;base64,B", prompt: "b", source: "ai", createdAt: 2 },
  ] });
  const r1 = await call("sys_sprite_bind", { target: "r1", image: "data:image/png;base64,A" }, s, makeCtx());
  const r2 = await call("sys_sprite_gallery_clear", {}, r1.state, makeCtx());
  ok("§5.1 clear 返回「清空」", /清空/.test(r2.response));
  ok("§5.2 spriteGallery 变 0", (r2.state.spriteGallery || []).length === 0);
  ok("§5.3 引用图库的绑定一并解除", Object.keys(r2.state.spriteBinds || {}).length === 0);
}

// §6 sys_sprite_upload：上传图片直接入图库 + 可选绑定
{
  const r = await call("sys_sprite_upload", { target: "r1", image: "data:image/jpeg;base64,/9j/4AAQ" }, baseState(), makeCtx());
  const ent = r.state.entities[0];
  ok("§6.1 upload 写入 spriteGallery（来源 upload）", (r.state.spriteGallery[0] || {}).source === "upload");
  ok("§6.2 upload + target 同时绑定到 entity.customSprite", ent.customSprite && ent.customSprite.image === "data:image/jpeg;base64,/9j/4AAQ");
  ok("§6.3 upload 绑定后 spriteBinds[r1].source=upload", r.state.spriteBinds.r1 && r.state.spriteBinds.r1.source === "upload");
  ok("§6.4 upload 不带 target：仅入图库不绑定", (await call("sys_sprite_upload", { image: "data:image/jpeg;base64,/9j/4AAQ" }, baseState(), makeCtx())).response.includes("已上传至图库"));
  ok("§6.5 upload 拒绝非 data:URL", /不合法/.test((await call("sys_sprite_upload", { image: "http://x/y.png" }, baseState(), makeCtx())).response));
}

// §7 刷新恢复：start 后 entity.customSprite 与 npcCard.customSprite 都在
{
  const stored = {
    spriteGallery: [{ id: "sp1", image: "data:image/png;base64,AV", prompt: "test", source: "ai", createdAt: 1 }],
    spriteBinds: { r1: { image: "data:image/png;base64,AV", prompt: "t", source: "ai", createdAt: 1 } },
    card: { items: [], money: 0, level: 1, exp: 0, hp: 100, mp: 100, skills: [] },
    bagMeta: {}, bagOrder: [], skillOrder: [], shop: [], level: "Mulberry Town", parked: {},
  };
  const ctx = {
    tsApi: { pluginData: { get: async (k) => k === "sys_state" ? stored : null, set: async () => {}, list: async () => [] }, agent: { run: async () => ({ ok: false }) } },
    playerCard: {}, roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }],
  };
  const s = baseState();
  const r = await call("start", { selections: { participants: [], spectators: [], enemies: [] } }, s, ctx);
  const ent = r.state.entities.find(e => e.id === "r1");
  const card = (r.state.npcCards || []).find(c => c.id === "r1");
  ok("§7.1 刷新后 spriteGallery 恢复", (r.state.spriteGallery || []).length === 1);
  ok("§7.2 刷新后 spriteBinds 恢复（对象形态）", r.state.spriteBinds.r1 && r.state.spriteBinds.r1.image);
  ok("§7.3 刷新后 entity.customSprite 写入", ent && ent.customSprite && ent.customSprite.image === "data:image/png;base64,AV");
  ok("§7.4 刷新后 npcCard.customSprite 写入", card && card.customSprite && card.customSprite.image === "data:image/png;base64,AV");
  ok("§7.5 刷新后 entity.avatarPath 不变（仍是原故事卡）", ent && ent.avatarPath === "orig.png");
}

// §8 旧 string 形态 binds 兼容
{
  const stored = {
    spriteGallery: [],
    spriteBinds: { r1: "data:image/png;base64,OLD" },
    card: { items: [], money: 0, level: 1, exp: 0, hp: 100, mp: 100, skills: [] },
    bagMeta: {}, bagOrder: [], skillOrder: [], shop: [], level: "Mulberry Town", parked: {},
  };
  const ctx = {
    tsApi: { pluginData: { get: async (k) => k === "sys_state" ? stored : null, set: async () => {}, list: async () => [] }, agent: { run: async () => ({ ok: false }) } },
    playerCard: {}, roles: [{ id: "r1", name: "玩家", roleType: "player", avatarPath: "orig.png" }],
  };
  const s = baseState();
  const r = await call("start", { selections: { participants: [], spectators: [], enemies: [] } }, s, ctx);
  const ent = r.state.entities.find(e => e.id === "r1");
  ok("§8.1 旧 string 形态 binds 兼容：entity.customSprite 仍写入", ent && ent.customSprite && ent.customSprite.image === "data:image/png;base64,OLD");
  ok("§8.2 旧 string 形态 binds 兼容：spriteBinds 已升级为对象", r.state.spriteBinds.r1 && typeof r.state.spriteBinds.r1 === "object");
}

console.log(T.join("\n"));
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);