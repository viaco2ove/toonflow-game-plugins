// entry.js 冒烟测试：组队跟随默认关闭 + 打击特效生成/衰减
import { handle_action } from "../../entry.js";

const ctx = { roles: [
  { id: "p1", name: "玩家", roleType: "player", initial_level: 5 },
  { id: "r02", name: "裴勇", initial_level: 10 },
  { id: "r03", name: "林婉", initial_level: 8 },
]};

let s = null;
const run = async (action, params) => {
  const res = await handle_action(action, params || {}, s, ctx);
  if (res?.state) s = res.state;
  return res;
};

// 1) init → start：partyIds 必须为空（不自动组队）
await run("init", {});
await run("start", { selections: { participants: ["r02"], spectators: [], enemies: [] } });
console.log("1. start 后 partyIds =", JSON.stringify(s.partyIds), s.partyIds.length === 0 ? "✅ 默认不组队" : "❌ 仍自动组队");

// 2) 塞两只怪到玩家身边，跑 1 个 tick：怪攻击玩家 → 玩家 hitFlashMs + vfx(spark/explosion)
s.entities.push({ id: "mob_1", name: "野狼", side: "enemy", x: s.entities[0].x + 0.3, y: s.entities[0].y, vx: 0, vy: 0, hp: 500, maxHp: 500, atk: 8, def: 1, level: 2, facing: 0, cooldown: 0, alive: true, isLocal: true, homeX: s.entities[0].x + 3, homeY: s.entities[0].y + 3 });
s.entities.push({ id: "mob_2", name: "野猪", side: "enemy", x: s.entities[0].x - 0.3, y: s.entities[0].y + 0.2, vx: 0, vy: 0, hp: 500, maxHp: 500, atk: 8, def: 1, level: 2, facing: 0, cooldown: 0, alive: true, isLocal: true, homeX: s.entities[0].x - 3, homeY: s.entities[0].y + 3 });
await run("tick", { levelName: "Mulberry Forest", player: { x: s.entities[0].x, y: s.entities[0].y, facing: 0 } });
const player = s.entities.find((e) => e.side === "player");
const kinds = (s.vfx || []).map((v) => v.kind);
console.log("2. 玩家被咬后 hitFlashMs =", player.hitFlashMs, player.hitFlashMs > 0 ? "✅" : "❌");
console.log("   vfx kinds =", JSON.stringify([...new Set(kinds)]), kinds.includes("spark") && kinds.includes("explosion") ? "✅ 打击特效已生成" : "❌ 无打击特效");

// 3) 技能施放 → 按名归类特效（怪 500 血不会被秒，四个技能都打得到）
s.skills[0] = { name: "冲斩", power: 20, cost: 0, cd: 24, cdLeft: 0 };
s.skills[1] = { name: "火球", power: 25, cost: 0, cd: 30, cdLeft: 0 };
s.skills[2] = { name: "治疗", power: 30, cost: 0, cd: 40, cdLeft: 0 };
s.skills[3] = { name: "护盾", power: 0, cost: 0, cd: 60, cdLeft: 0 };
await run("skill", { index: 0 });
await run("skill", { index: 1 });
await run("skill", { index: 2 });
await run("skill", { index: 3 });
const k2 = new Set((s.vfx || []).map((v) => v.kind));
console.log("3. 技能特效 kinds =", JSON.stringify([...k2]));
for (const k of ["slash_arc", "fireball", "heal_ring", "buff_ring"]) console.log(`   ${k}:`, k2.has(k) ? "✅" : "❌");

// 4) 组队跟随：勾选 → ally + 跟随参战；取消 → 还原 neutral/ally，不再跟随
await run("sys_party", { roleId: "r02", follow: true });
const ally = s.entities.find((e) => e.id === "r02");
console.log("4. r02 组队后 side =", ally.side, "inParty =", s.partyIds.includes("r02"), ally.side === "ally" && s.partyIds.includes("r02") ? "✅" : "❌");
await run("sys_party", { roleId: "r02", follow: false });
console.log("   r02 退队后 side =", ally.side, "inParty =", s.partyIds.includes("r02"), !s.partyIds.includes("r02") && ally.side !== "enemy" ? "✅（非敌方外观）" : "❌");

// 5) vfx 衰减：连续 tick 后 vfx 应清空
for (let i = 0; i < 35; i++) await run("tick", { levelName: "Mulberry Forest", player: { x: player.x, y: player.y, facing: 0 } });
console.log("5. 35 tick 后 vfx.length =", (s.vfx || []).length, (s.vfx || []).length === 0 ? "✅ 正常衰减" : "❌ 不衰减会糊屏");

// 6) 角色卡参数卡：ensureNpcCards 应挂 parameterCardJson 并用实时值覆盖
ctx.roles.forEach((r) => { r.parameterCardJson = { name: r.name, gender: "男", age: 30, level: 1, hp: 1, exp: 0, personality: "沉稳", skills: ["斩铁"], items: [], other: [] }; });
await run("tick", { levelName: "Mulberry Forest", player: { x: player.x, y: player.y, facing: 0 } });
const pc = s.npcCards.find((c) => c.side === "player");
const npcPc = s.npcCards.find((c) => c.id === "r02");
console.log("6. 玩家卡 parameterCardJson:", pc?.parameterCardJson ? "✅" : "❌", "| 等级覆盖 =", pc?.parameterCardJson?.level, "HP 覆盖 =", pc?.parameterCardJson?.hp);
console.log("   NPC r02 卡 parameterCardJson:", npcPc?.parameterCardJson ? "✅" : "❌", "| exp =", npcPc?.parameterCardJson?.exp, "next =", npcPc?.parameterCardJson?.next_level_exp);

// 7) ★ 角色卡主体 = 故事角色（s.roles），而非地图实体：全部角色显示，未上场 onMap=false
console.log("7. 角色卡数量 =", s.npcCards.length, "（应=3 个故事角色，地图野怪 mob_1/mob_2 不上卡）",
  s.npcCards.length === 3 && !s.npcCards.some((c) => String(c.id).startsWith("mob_")) ? "✅" : "❌");
const r03card = s.npcCards.find((c) => c.id === "r03");
console.log("   未上场 r03：onMap =", r03card?.onMap, "位置 =", r03card?.mapName || "(无)",
  r03card?.onMap === false && !r03card?.mapName ? "✅ 无位置信息" : "❌");
const r02card = s.npcCards.find((c) => c.id === "r02");
console.log("   上场 r02：onMap =", r02card?.onMap, "mapName =", r02card?.mapName,
  r02card?.onMap === true && r02card?.mapName === "Mulberry Forest" ? "✅ 实体位置已合并" : "❌");

// 8) 未上场角色「传送到」→ 先生成到可活动区域再传送
const before = s.entities.length;
const tp = await run("sys_teleport", { roleId: "r03" });
const r03ent = s.entities.find((e) => e.id === "r03");
const r03card2 = s.npcCards.find((c) => c.id === "r03");
console.log("8. r03 传送后实体数 =", before, "->", s.entities.length,
  "实体位置 =", r03ent ? r03ent.x.toFixed(1) + "," + r03ent.y.toFixed(1) : "(无)",
  r03ent && s.entities.length === before + 1 && r03card2?.onMap === true && r03card2?.mapName === "Mulberry Forest" ? "✅ 已生成到可活动区域并合并位置" : "❌",
  "|", tp?.response || "");

// 9) 未上场角色勾选组队 → 也先生成实体再入队
await run("sys_party", { roleId: "r03", follow: false });
await run("sys_party", { roleId: "r03", follow: true });
const r03inParty = s.partyIds.includes("r03");
console.log("9. r03 组队：inParty =", r03inParty, "实体 side =", s.entities.find((e) => e.id === "r03")?.side,
  r03inParty && s.entities.find((e) => e.id === "r03")?.side === "ally" ? "✅ 无实体角色组队时自动生成" : "❌");
