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
ctx.roles.forEach((r) => { r.parameterCardJson = { name: r.name, gender: "男", age: 30, level: 1, hp: 100, exp: 0, personality: "沉稳", skills: ["斩铁"], items: [], other: [] }; });
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

// 10) ★ teleportTarget 一次性：sys_teleport 下发后，下一个 tick 必须清除（否则前端每 tick 拉回 = 绑住）
await run("sys_teleport", { roleId: "r02" });
const hasTp = !!s.teleportTarget;
await run("tick", { levelName: "Mulberry Forest", player: { x: s.entities[0].x, y: s.entities[0].y, facing: 0 } });
console.log("10. sys_teleport 后 teleportTarget 存在 =", hasTp, "；1 tick 后 =",
  s.teleportTarget ? "仍存在" : "已清除",
  hasTp && !s.teleportTarget ? "✅ 一次性下发，不会反复拉回" : "❌");

// 11) ★ 角色驻留地图：非组队角色不跟去新图；组队角色跟随；回原图原坐标归队
// 当前状态：r02 在 Mulberry Forest（非组队）、r03 在队（Mulberry Forest）
const r02Before = s.entities.find((e) => e.id === "r02");
const r02Pos = { x: r02Before.x, y: r02Before.y };
await run("tick", { levelName: "Dungeon1", player: { x: 0, y: 0, facing: 0 } });
const r02After = s.entities.find((e) => e.id === "r02");
const r03After = s.entities.find((e) => e.id === "r03");
const r02card3 = s.npcCards.find((c) => c.id === "r02");
console.log("11a. 切到 Dungeon1：r02（非组队）留在实体表 =", !!r02After,
  !r02After ? "✅ 不跟去新图" : "❌ 仍跟着玩家");
console.log("     r02 卡位置 =", r02card3?.mapName, JSON.stringify({ x: r02card3?.x, y: r02card3?.y }), "onMap =", r02card3?.onMap,
  r02card3?.mapName === "Mulberry Forest" && r02card3?.onMap === true ? "✅ 卡片显示原图坐标" : "❌");
console.log("     r03（组队）在同图 =", r03After?.mapName === "Dungeon1",
  "距玩家 =", r03After ? Math.hypot(r03After.x - 0, r03After.y - 0).toFixed(1) : "?",
  r03After?.mapName === "Dungeon1" ? "✅ 组队跟随跨图" : "❌");
await run("tick", { levelName: "Mulberry Forest", player: { x: 13, y: 4, facing: 0 } });
const r02Back = s.entities.find((e) => e.id === "r02");
console.log("11b. 回到 Mulberry Forest：r02 原坐标归队 =",
  r02Back ? JSON.stringify({ x: Math.round(r02Back.x * 10) / 10, y: Math.round(r02Back.y * 10) / 10 }) : "(无)",
  r02Back && Math.abs(r02Back.x - r02Pos.x) < 0.01 && Math.abs(r02Back.y - r02Pos.y) < 0.01 ? "✅ 原地不变" : "❌");

// 12) ★ 停车角色组队：从别的图接回当前图
await run("tick", { levelName: "Dungeon2", player: { x: 0, y: 0, facing: 0 } });
await run("sys_party", { roleId: "r02", follow: true });
const r02Joined = s.entities.find((e) => e.id === "r02");
console.log("12. r02（停在 Mulberry Forest）勾组队 → 出现在当前图 =", !!r02Joined,
  r02Joined?.mapName === "Dungeon2" ? "✅ 跨图接回入队" : "❌");
await run("sys_party", { roleId: "r02", follow: false });
const r02Left = s.entities.find((e) => e.id === "r02");
console.log("    退队后留在原地（Dungeon2） =", r02Left?.mapName === "Dungeon2" && !s.partyIds.includes("r02"),
  r02Left?.mapName === "Dungeon2" ? "✅ 脱离队伍留在原地" : "❌");

// 13) ★ game.md 技能同步与修改：
//     a) buildSkills 从参数卡技能名列表解析 lv；b) sys_skill_edit 修改参数并保存；
//     c) 参数卡技能名列表同步；d) skillMeta 持久化到 t_plugin_session_data
const savedBlobs = [];
ctx.tsApi = { pluginData: { set: async (k, v) => { savedBlobs.push({ k, v }); }, get: async () => null } };
ctx.playerCard = {
  name: "玩家", hp: 120, mp: 50, money: 10, exp: 30,
  skills: ["源之力（lv1，失控）（lv1）、暗核共鸣（lv2）、夜采直觉"],
};
await run("start", { selections: { participants: [], spectators: [], enemies: [] } });
const sk0 = s.skills[0];
console.log("13a. 参数卡技能同步：", JSON.stringify(s.skills.slice(0, 3).map((k) => `${k.name}/lv${k.lv}/${k.type}`)),
  sk0?.name === "源之力" && sk0?.lv === 1 && s.skills[1]?.name === "暗核共鸣" && s.skills[1]?.lv === 2 ? "✅ lv 已解析" : "❌");

const r13 = await run("sys_skill_edit", { index: 0, name: "源之力", power: 99, cost: 8, cd: 50, type: "atk", range: "ranged", lv: 2, buff_type: "" });
const sk0b = s.skills[0];
console.log("13b. 修改后：", JSON.stringify({ name: sk0b.name, power: sk0b.power, cost: sk0b.cost, cd: sk0b.cd, type: sk0b.type, range: sk0b.range, lv: sk0b.lv }),
  sk0b.power === 99 && sk0b.range === "ranged" && sk0b.lv === 2 ? "✅" : "❌", "|", r13?.response || "");

const cardSkills = s.playerCard?.skills;
console.log("13c. 参数卡技能名列表 =", JSON.stringify(cardSkills),
  Array.isArray(cardSkills) && cardSkills.some((x) => String(x).includes("源之力") && String(x).includes("lv2")) ? "✅ 已同步（带 lv 注记）" : "❌");

const blob = savedBlobs[savedBlobs.length - 1];
console.log("13d. 持久化 skillMeta =", JSON.stringify(blob?.v?.skillMeta?.["源之力"]),
  blob?.v?.skillMeta?.["源之力"]?.power === 99 ? "✅ t_plugin_session_data" : "❌");

// e) 修改后特效按显式 type/range 归类：atk+ranged → fireball
s.skills[0].cdLeft = 0;
const pl = s.entities.find((e) => e.side === "player");
s.entities.push({ id: "mob_9", name: "靶子", side: "enemy", x: pl.x + 1, y: pl.y, vx: 0, vy: 0, hp: 500, maxHp: 500, atk: 0, def: 0, level: 1, facing: 0, cooldown: 0, alive: true, isLocal: true });
await run("sys_use_skill", { index: 0, name: "源之力" });
const k13 = (s.vfx || []).map((v) => v.kind);
console.log("13e. atk+ranged 特效 =", JSON.stringify([...new Set(k13)]), k13.includes("fireball") ? "✅ 火球（显式 type/range 优先）" : "❌");

// 14) ★ game.md 背包物品同步与修改：
//     a) 参数卡物品同步（×N 合并、type/lv 推断）；b) sys_item_edit 保存 itemMeta + 参数卡物品名列表
ctx.playerCard = {
  ...ctx.playerCard,
  items: ["小刀", "银鲤×3（钓鱼累积，暂未售出，单尾800金）、银鲤×4", "力量+4"],
};
await run("start", { selections: { participants: [], spectators: [], enemies: [] } });
const bagNames = s.items.map((x) => `${x.name}×${x.count}/${x.type}`);
console.log("14a. 参数卡物品同步 =", JSON.stringify(bagNames),
  s.items[0]?.name === "小刀" && s.items[0]?.type === "atk" && s.items[1]?.name === "银鲤" && s.items[1]?.count === 7
  && s.items[2]?.name === "力量+4" && s.items[2]?.type === "attribute" ? "✅（小刀→atk、银鲤×7 合并、力量+4→attribute）" : "❌");

const r14 = await run("sys_item_edit", { index: 1, name: "银鲤", power: 5, cost: 0, cd: 10, type: "atk", range: "melee", lv: 1, buff_type: "", durability: 3, attribute_type: "", attribute_value: 0 });
console.log("14b. 修改银鲤 →", JSON.stringify({ type: s.itemMeta?.["银鲤"]?.type, power: s.itemMeta?.["银鲤"]?.power, durability: s.itemMeta?.["银鲤"]?.durability }),
  s.itemMeta?.["银鲤"]?.type === "atk" && s.itemMeta?.["银鲤"]?.durability === 3 ? "✅" : "❌", "|", r14?.response || "");
const cardItems14 = s.playerCard?.items;
console.log("14c. 参数卡物品名列表 =", JSON.stringify(cardItems14),
  Array.isArray(cardItems14) && cardItems14.some((x) => String(x).startsWith("银鲤×7")) ? "✅ 数量已合并 ×7" : "❌");

// 15) ★ 使用 atk 物品：普攻特效（近战→冲斩刀光）+ 耐久 -1
s.vfx = [];
const r15 = await run("sys_use_item", { name: "银鲤" });
const k15 = (s.vfx || []).map((v) => v.kind);
console.log("15a. 银鲤(atk) 使用特效 =", JSON.stringify([...new Set(k15)]), k15.includes("slash_arc") ? "✅ 冲斩刀光" : "❌", "|", r15?.response || "");
console.log("15b. 耐久 3→", s.itemMeta?.["银鲤"]?.durabilityLeft, "数量 7→", s.playerCard?.items?.find((x) => String(x).startsWith("银鲤"))?.split("×")[1]?.match(/^\d+/)?.[0] || s.playerCard?.items,
  s.itemMeta?.["银鲤"]?.durabilityLeft === 2 ? "✅ durabilityLeft 已扣" : "❌");

// 16) ★ 耐久用完损毁：连用 2 次后（2→1→0）损毁 1 个并重置耐久
await run("sys_use_item", { name: "银鲤" });
await run("sys_use_item", { name: "银鲤" });
const fishEntry = (s.playerCard?.items || []).find((x) => String(x).startsWith("银鲤"));
console.log("16. 三次使用后（耐久3）→", JSON.stringify({ durabilityLeft: s.itemMeta?.["银鲤"]?.durabilityLeft, entry: fishEntry }),
  s.itemMeta?.["银鲤"]?.durabilityLeft === 3 && String(fishEntry).startsWith("银鲤×6") ? "✅ 损毁 1 个 + 耐久重置" : "❌");

// 17) ★ attribute 物品：被动加成（放背包即生效）+ 使用不消耗（小跳+普攻特效）
const me17 = s.entities.find((e) => e.side === "player");
// 被动加成在首次背包操作（15a use）时已生效：基础 atk 14 + 力量+4 = 18
console.log("17a. 力量+4 被动加成：atk =", me17.atk, me17.atk === 18 ? "✅ Attack+4 生效（14 基础 + 4）" : "❌");
await run("tick", { levelName: "Mulberry Forest", player: { x: me17.x, y: me17.y, facing: 0 } });
console.log("    再跑 1 tick 后 atk =", me17.atk, me17.atk === 18 ? "✅ 幂等不重复叠加" : "❌");
s.vfx = [];
const cntBefore = (s.playerCard?.items || []).find((x) => String(x).startsWith("力量"));
const r17 = await run("sys_use_item", { name: "力量+4" });
const k17 = (s.vfx || []).map((v) => v.kind);
const cntAfter = (s.playerCard?.items || []).find((x) => String(x).startsWith("力量"));
console.log("17b. attribute 使用：", r17?.response || "", "| 特效 =", JSON.stringify([...new Set(k17)]),
  k17.includes("slash_arc") && String(cntAfter) === String(cntBefore) ? "✅ 不消耗 + 普攻特效 + 小跳" : "❌");

// 18) ★ HUD 物品栏（case "item"）与背包同一套逻辑：治疗类 → heal_ring
ctx.playerCard = { ...ctx.playerCard, items: ["金疮药"] };
await run("start", { selections: { participants: [], spectators: [], enemies: [] } });
const me18 = s.entities.find((e) => e.side === "player");
me18.hp = 10;
s.vfx = [];
const r18 = await run("item", { index: 0 });
const k18 = (s.vfx || []).map((v) => v.kind);
console.log("18. HUD 物品栏使用金疮药：hp", `${me18.hp}`, "特效 =", JSON.stringify([...new Set(k18)]),
  k18.includes("heal_ring") && me18.hp > 10 ? "✅ 治疗环 + 回血（itemMeta 未改时走 heal）" : "❌", "|", r18?.response || "");
