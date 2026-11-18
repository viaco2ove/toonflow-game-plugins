/**
 * sprite-asset.test.mjs —— sprite 资产外置端到端测试（entry.js 级）
 * ============================================================
 * 覆盖 2026-11-18 通信阻塞修复：base64 图不再进 state / sys_state，
 * 每张图独立 dataKey `sprite_asset:<assetId>`，state 里只存 `asset:<assetId>` 引用。
 *
 *   A1 生成外置     AI 生成大图 → gallery 条目是引用 + 资产 key 落库
 *   A2 state 纯净   整个 state 序列化后不含 data:image 长串
 *   A3 绑定引用化   spriteId 绑定 → binds/npcCards/entity.customSprite 全是引用
 *   A4 翻转新 id    flip 落【新】assetId（缓存失效安全）+ binds 同步
 *   A5 删除联动     gallery_del → 资产 key 被删
 *   A6 清空+force   gallery_clear → 资产全删 + sys_state 允许写空
 *   A7 旧档迁移     sys_state 旧格式 dataURL → restoreSys 搬到资产 key + 引用化
 *   A8 迁移幂等     再跑一次 restoreSys → 不产生重复资产 key
 *   A9 小图例外     小 dataURL（<4KB，如程序生成占位）原样存，不外置
 *
 * ★ 必须用编译后的 entry.js（esm）。运行：node test-host/sprite-asset.test.mjs
 */
import { handle_action } from "../entry.js";

/* ── 迷你断言框架 ─────────────────────────────────── */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 58 - t.length))); }

/* ── 假宿主 ───────────────────────────────────────── */
const pluginDataStore = new Map();
const context = {
  pluginId: "com.toonflow.minigame-field-survival",
  pluginDir: ".",
  manifest: {},
  userId: 1,
  sessionId: "sprite-asset-test",
  roles: [],
  worldName: "",
  tsApi: {
    pluginData: {
      get: async (k) => pluginDataStore.get(k),
      set: async (k, v) => { pluginDataStore.set(k, v); },
      list: async () => Array.from(pluginDataStore.keys()),
      remove: async (k) => { pluginDataStore.delete(k); },
    },
    agent: { run: async (name, input) => ({ ok: true, output: { image: BIG_PNG_A, note: "mock" } }) },
  },
};

async function call(action, params, state) {
  const r = await handle_action(action, params || {}, state, context);
  return { msg: r.response || "", state: r.state || state, code: r.code, data: r.data };
}

/* ── 测试素材 ─────────────────────────────────────── */
const BIG_PNG_A = "data:image/png;base64," + "A".repeat(20000);   // ~20KB 假大图 A
const BIG_PNG_B = "data:image/png;base64," + "B".repeat(18000);   // ~18KB 假大图 B
const BIG_PNG_C = "data:image/png;base64," + "C".repeat(16000);   // ~16KB 假大图 C（翻转产物用不上，备迁移孤儿图）
const SMALL_PNG = "data:image/png;base64,iVBORw0KGgo=";           // 小图（不外置）
const PRESET_PATH = "./images/player_sprites/hero.png";

/** 全树扫描：找 base64 大图泄漏（>4KB 的 data:image 串） */
function bigDataUrlsIn(o, out = [], depth = 0) {
  if (depth > 8 || o == null) return out;
  if (typeof o === "string") { if (/^data:image\//i.test(o) && o.length > 4096) out.push(o.slice(0, 40)); return out; }
  if (Array.isArray(o)) { for (const v of o) bigDataUrlsIn(v, out, depth + 1); return out; }
  if (typeof o === "object") { for (const v of Object.values(o)) bigDataUrlsIn(v, out, depth + 1); return out; }
  return out;
}

function newState(opts = {}) {
  const st = {
    phase: "playing", version: 3, tick: opts.tick ?? 100,
    world: { w: 3000, h: 3000 },
    roles: [
      { id: "role_player", name: "玩家", roleType: "player" },
      { id: "role_npc1", name: "阿桑", roleType: "npc" },
    ],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [
      { id: "role_player", name: "玩家", side: "player", x: 0, y: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, atk: 5, level: 1, mp: 50, maxMp: 50, facing: 0, cooldown: 0, alive: true },
      { id: "role_npc1", name: "阿桑", side: "ally", x: 1, y: 0, vx: 0, vy: 0, hp: 80, maxHp: 80, atk: 4, level: 1, mp: 30, maxMp: 30, facing: 0, cooldown: 0, alive: true },
    ],
    floaters: [], vfx: [], rangeIndicators: [],
    skills: [], items: [], chests: [], potions: [],
    events: [], drops: [], money: 0, exp: 0, kills: 0, skillPage: 0, itemPage: 0,
    playerCard: {}, skillMeta: {}, bagMeta: {}, bagOrder: [], itemMeta: {},
    quests: {}, questBoard: [], npcCards: [], partyIds: [], regions: [],
    spriteGallery: [], spriteRevision: 0,
  };
  return st;
}

const assetKeys = () => Array.from(pluginDataStore.keys()).filter((k) => k.startsWith("sprite_asset:"));

/* ════════════════ A1~A2：生成外置 + state 纯净 ════════════════ */
section("A1/A2 生成外置 + state 纯净");
{
  pluginDataStore.clear();
  const st = newState();
  const r = await call("sys_sprite_generate", { prompt: "银发游侠" }, st);
  const gal = r.state.spriteGallery || [];
  eq(gal.length, 1, "A1 图库条目数 1");
  ok(/^asset:sp_/.test(gal[0].image), `A1 条目 image 是 asset: 引用（实际 ${String(gal[0].image).slice(0, 30)}）`);
  const aid = gal[0].image.slice("asset:".length);
  const asset = pluginDataStore.get(`sprite_asset:${aid}`);
  ok(asset && asset.dataUrl === BIG_PNG_A, "A1 资产 key 落库且 dataUrl 完整");
  const leaks = bigDataUrlsIn(r.state);
  eq(leaks.length, 0, `A2 state 无大 dataURL 泄漏（${leaks.length} 处）`);
}

/* ════════════════ A3：绑定引用化 ════════════════ */
section("A3 绑定引用化（spriteId → binds/npcCards/entity）");
{
  pluginDataStore.clear();
  const st = newState();
  const g = await call("sys_sprite_generate", { prompt: "测试绑定" }, st);
  const gal = g.state.spriteGallery;
  const gid = gal[0].id;
  const ref = gal[0].image; // asset:sp_xxx
  const b = await call("sys_sprite_bind", { target: "role_npc1", spriteId: gid, source: "ai" }, g.state);
  const binds = b.state.spriteBinds || {};
  ok(binds.role_npc1 && binds.role_npc1.image === ref, "A3 binds.image = 引用");
  const ent = (b.state.entities || []).find((e) => e.id === "role_npc1");
  ok(ent && ent.customSprite && ent.customSprite.image === ref, "A3 entity.customSprite.image = 引用");
  const card = (b.state.npcCards || []).find((c) => c.id === "role_npc1");
  ok(card && card.customSprite && card.customSprite.image === ref, "A3 npcCards.customSprite.image = 引用");
  const leaks = bigDataUrlsIn(b.state);
  eq(leaks.length, 0, "A3 绑定后 state 仍无大 dataURL 泄漏");
}

/* ════════════════ A4：翻转落新 id ════════════════ */
section("A4 翻转落新 assetId + binds 同步");
{
  pluginDataStore.clear();
  const st = newState({ tick: 200 });
  const g = await call("sys_sprite_generate", { prompt: "翻转测试" }, st);
  const gal = g.state.spriteGallery;
  const gid = gal[0].id;
  await call("sys_sprite_bind", { target: "role_npc1", spriteId: gid }, g.state);
  const FLIPPED = "data:image/png;base64," + "F".repeat(15000);
  const f = await call("sys_sprite_flip", { id: gid, image: FLIPPED }, g.state);
  const gal2 = f.state.spriteGallery;
  ok(/^asset:sp_.+_f\d+$/.test(gal2[0].image), `A4 条目换成翻转新引用（${String(gal2[0].image).slice(0, 34)}）`);
  ok(gal2[0].image !== gal[0].image, "A4 新引用 ≠ 旧引用（缓存失效安全）");
  ok(pluginDataStore.get(`sprite_asset:${gal2[0].image.slice("asset:".length)}`)?.dataUrl === FLIPPED, "A4 翻转图落资产 key");
  eq(f.state.spriteBinds.role_npc1.image, gal2[0].image, "A4 binds 同步到新引用");
}

/* ════════════════ A5：删除联动 ════════════════ */
section("A5 gallery_del 删除资产 key");
{
  pluginDataStore.clear();
  const st = newState({ tick: 300 });
  const g = await call("sys_sprite_generate", { prompt: "删除测试" }, st);
  const gid = g.state.spriteGallery[0].id;
  const ref = g.state.spriteGallery[0].image;
  const aid = ref.slice("asset:".length);
  ok(pluginDataStore.has(`sprite_asset:${aid}`), "A5 前置：资产存在");
  const d = await call("sys_sprite_gallery_del", { id: gid }, g.state);
  ok(!pluginDataStore.has(`sprite_asset:${aid}`), "A5 资产 key 已删");
  eq((d.state.spriteGallery || []).length, 0, "A5 图库已清");
}

/* ════════════════ A6：清空 + _sysForceEmpty ════════════════ */
section("A6 gallery_clear 清资产 + 允许写空");
{
  pluginDataStore.clear();
  const st = newState({ tick: 400 });
  const g = await call("sys_sprite_generate", { prompt: "清空测试" }, st);
  const gid = g.state.spriteGallery[0].id;
  const aid = g.state.spriteGallery[0].image.slice("asset:".length);
  await call("sys_sprite_bind", { target: "role_npc1", spriteId: gid }, g.state);
  const c = await call("sys_sprite_gallery_clear", {}, g.state);
  ok(!pluginDataStore.has(`sprite_asset:${aid}`), "A6 资产 key 已删");
  eq((c.state.spriteGallery || []).length, 0, "A6 图库已清");
  eq(Object.keys(c.state.spriteBinds || {}).length, 0, "A6 绑定已解");
  // persistSys 落库：sys_state 里 spriteGallery 应该真的为空（forceEmpty 生效）
  await call("tick", {}, c.state);
  const persisted = pluginDataStore.get("sys_state");
  ok(Array.isArray(persisted?.spriteGallery) && persisted.spriteGallery.length === 0, "A6 sys_state.spriteGallery 写空（forceEmpty 生效）");
}

/* ════════════════ A7/A8：旧档迁移 + 幂等 ════════════════ */
section("A7/A8 旧档迁移 + 幂等");
{
  pluginDataStore.clear();
  // 种旧格式 sys_state（inline dataURL）
  pluginDataStore.set("sys_state", {
    spriteGallery: [
      { id: "sp_old1", image: BIG_PNG_A, prompt: "旧图1", source: "ai", createdAt: 1 },
      { id: "sp_old2", image: PRESET_PATH, prompt: "预置图", source: "ai", createdAt: 2 },
    ],
    spriteBinds: {
      role_player: { image: BIG_PNG_A, source: "ai", createdAt: 3 },      // 与图库同图 → 应复用条目引用
      role_npc1: { image: BIG_PNG_B, source: "upload", createdAt: 4 },    // 孤儿图 → legacy 资产
    },
  });
  const st = newState({ tick: 500 });
  const r = await call("start", { story: "迁移测试" }, st);
  const gal = r.state.spriteGallery || [];
  const binds = r.state.spriteBinds || {};
  const old1 = gal.find((g) => g.id === "sp_old1");
  const old2 = gal.find((g) => g.id === "sp_old2");
  ok(old1 && old1.image === "asset:sp_old1", `A7 旧图1 引用化（${String(old1?.image).slice(0, 26)}）`);
  ok(pluginDataStore.get("sprite_asset:sp_old1")?.dataUrl === BIG_PNG_A, "A7 旧图1 资产落库");
  ok(old2 && old2.image === PRESET_PATH, "A7 预置路径不迁移");
  ok(binds.role_player && binds.role_player.image === "asset:sp_old1", "A7 绑定复用图库条目引用");
  ok(/^asset:lg_/.test(binds.role_npc1?.image || ""), `A7 孤儿图 → 幂等 legacy 引用（${String(binds.role_npc1?.image || "").slice(0, 26)}）`);
  ok(pluginDataStore.get(`sprite_asset:${(binds.role_npc1?.image || "").slice("asset:".length)}`)?.dataUrl === BIG_PNG_B, "A7 孤儿图资产落库");
  // A8 幂等：再 start 一次（restoreSys 重跑），资产 key 集合不变
  const keysBefore = assetKeys().sort().join(",");
  const r2 = await call("start", { story: "迁移测试" }, r.state);
  const keysAfter = assetKeys().sort().join(",");
  eq(keysAfter, keysBefore, "A8 二次迁移不产生重复资产 key");
  eq(r2.state.spriteGallery.find((g) => g.id === "sp_old1").image, "asset:sp_old1", "A8 引用稳定");
}

/* ════════════════ A9：小图例外 ════════════════ */
section("A9 小 dataURL 原样存（不外置，4KB 阈值）");
{
  pluginDataStore.clear();
  const st = newState({ tick: 600 });
  // 直接 bind 一个 <4KB 的小 dataURL → 原样存 binds（不值得独立写库）
  const r = await call("sys_sprite_bind", { target: "role_npc1", image: SMALL_PNG, source: "upload" }, st);
  const b = r.state.spriteBinds.role_npc1;
  ok(b && b.image === SMALL_PNG, "A9 小 dataURL 不外置（原样保留）");
  eq(assetKeys().length, 0, "A9 未产生资产 key");
}

/* ── 汇总 ─────────────────────────────────────────── */
console.log("\n" + "═".repeat(62));
console.log(`通过 ${passed} / 失败 ${failures.length}`);
if (failures.length) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
