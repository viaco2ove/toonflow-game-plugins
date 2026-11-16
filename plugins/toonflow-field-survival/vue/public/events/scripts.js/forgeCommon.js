const ITEM_KINDS = ["material", "equipment", "weapon", "armor", "skill_book", "consumable"];
const RARITY_VALUES = ["common", "fine", "rare", "epic", "legend"];
function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
function normalizeGenerated(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || fallback.name || "").trim().slice(0, 20);
  if (!name) return null;
  const rarity = RARITY_VALUES.indexOf(String(raw.rarity)) >= 0 ? String(raw.rarity) : String(fallback.rarity || "common");
  const kind = ITEM_KINDS.indexOf(String(raw.kind)) >= 0 ? String(raw.kind) : String(fallback.kind || "material");
  const n = (v, d, max) => Math.max(0, Math.min(max, Math.round(Number(v) || d)));
  return {
    name,
    kind,
    rarity,
    heal: n(raw.heal, 0, 9999),
    desc: String(raw.desc || fallback.desc || "").slice(0, 60),
    price: Math.max(1, Math.round(Number(raw.price) || 10)),
    atk: n(raw.atk, 0, 9999),
    def: n(raw.def, 0, 9999),
    durability: n(raw.durability, 0, 99999),
    lv: raw.lv != null ? Math.max(1, Math.round(Number(raw.lv) || 1)) : void 0,
    effect: raw.effect && typeof raw.effect === "object" ? {
      type: String(raw.effect.type || "none").slice(0, 20),
      value: n(raw.effect.value, 0, 9999),
      duration: n(raw.effect.duration, 0, 9999)
    } : void 0
  };
}
const RARITY_ZH = {
  common: "凡品",
  fine: "精品",
  rare: "灵品",
  epic: "仙品",
  legend: "神品"
};
function pickEquipments(bag) {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (/技能|秘籍|心得|卷轴|心法|功法|图纸|配方|药方/.test(b.name)) return false;
    return ["equipment", "weapon", "armor"].includes(b.kind) || /剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴|袍|盔|拳套|镯|项链/.test(b.name);
  });
}
function pickPills(bag) {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (/药方|配方|图纸/.test(b.name)) return false;
    return b.kind === "consumable" && (/丹|丸|散|膏|露|液|药/.test(b.name) || b.heal > 0);
  });
}
function pickBlueprints(bag) {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (String(b.kind || "") === "skill_book") return false;
    if (/^(基础|初级|中级|高级|入门|精通|大师|宗师|简易|进阶)/.test(b.name)) return false;
    if (/药方|丹方|丹谱|药谱|配方/.test(b.name)) return false;
    return /图纸|图谱|锻造|铸造|秘法|秘方|总纲|编缀/.test(b.name);
  });
}
function pickRecipes(bag) {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (String(b.kind || "") === "skill_book") return false;
    if (/^(基础|初级|中级|高级|入门|精通|大师|宗师|简易|进阶)/.test(b.name)) return false;
    if (/图纸|图谱|锻造|铸造/.test(b.name)) return false;
    return /药方|丹方|丹谱|药谱|配方|秘方|拓本|残卷/.test(b.name);
  });
}
const BP_SUFFIXES = [
  "铸造总纲",
  "铸造秘法",
  "铸造术",
  "铸造法",
  "锻造总纲",
  "锻造秘法",
  "锻造术",
  "锻造法",
  "炼制秘法",
  "炼法",
  "制法",
  "编缀图",
  "图纸",
  "图谱",
  "图",
  "总纲",
  "拓本",
  "残卷",
  "秘法",
  "秘方",
  "配方",
  "丹方",
  "药方",
  "丹谱",
  "药谱"
];
const BP_MEANINGLESS = /^(随机|上古|未知|残缺|古老|残破|无字|空白|神秘|传说|神兵|虚空)$/;
function blueprintProduct(blueprintName) {
  let s = String(blueprintName || "").trim();
  if (!s) return "";
  for (let i = 0; i < 4; i++) {
    let hit = false;
    for (const suf of BP_SUFFIXES) {
      if (s.length >= suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  s = s.replace(/(铸造|锻造|炼制|编缀|制作|的)+$/, "").trim();
  if (s.length < 2) return "";
  if (BP_MEANINGLESS.test(s)) return "";
  return s;
}
function looksLikeBlueprint(name) {
  const s = String(name || "");
  if (!s) return false;
  return /图纸|图谱|编缀图|总纲|拓本|残卷|秘法|秘方|配方|丹方|药方|丹谱|药谱|锻造法|锻造术|铸造法|铸造术/.test(s);
}
const DISSOLVE_MULT = { common: 1, fine: 2, rare: 4, epic: 8, legend: 15 };
function calcDissolveReturns(rarity, lv) {
  const mult = DISSOLVE_MULT[rarity] || 1;
  const l = Math.max(1, Math.round(lv));
  return { ore: Math.max(1, l * mult), stone: Math.max(0, Math.floor(l * mult / 3)) };
}
function calcPillDissolveReturns(heal) {
  const h = Math.max(1, Math.round(heal));
  return { herb: Math.max(1, Math.round(h / 20)), lingzhi: Math.max(0, Math.round(h / 100)) };
}
function returnsToText(returns) {
  return Object.entries(returns).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join("、");
}
async function aiGenerate(ctx, agentName, prompt, fallback = {}) {
  const text = await ctx.ai.generate(agentName, prompt, { timeoutMs: 2e4 });
  if (!text || !text.trim()) return null;
  const raw = extractJsonObject(text);
  if (!raw) return null;
  return normalizeGenerated(raw, fallback);
}
function randomForgeItem(input, level) {
  const prefixes = ["粗制", "精锻", "寒铁", "烈焰", "疾风", "雷霆", "暗影", "圣光", "龙骨", "陨星"];
  const bodies = ["剑", "刀", "枪", "弓", "杖", "甲", "盔", "靴", "盾", "戒指", "护符", "拳套"];
  const suffixes = ["", "·破晓", "·噬魂", "·龙纹", "·星陨", "·霜华", "·焚天", "·幽冥"];
  const r = Math.random();
  const rarity = r < 0.4 ? "common" : r < 0.75 ? "fine" : r < 0.95 ? "rare" : r < 0.99 ? "epic" : "legend";
  const name = input && input.trim() ? input.trim().slice(0, 12) : `${prefixes[Math.floor(Math.random() * prefixes.length)]}${bodies[Math.floor(Math.random() * bodies.length)]}${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  const prices = { common: 15, fine: 50, rare: 150, epic: 400, legend: 1e3 };
  const atk = ["equipment", "weapon", "armor"].includes(
    /剑|刀|枪|弓|杖|甲|盔|靴|盾|戒指|护符|拳套/.test(name) ? "equipment" : "material"
  ) ? Math.round(3 + level * 1.2 + Math.random() * 8) : 0;
  return {
    name,
    kind: /剑|刀|枪|弓|杖|甲|盔|靴|盾|戒指|护符|拳套/.test(name) ? "equipment" : "material",
    rarity,
    heal: 0,
    desc: `随机打造的${name}（${RARITY_ZH[rarity]}）`,
    price: prices[rarity] || 15,
    atk,
    def: Math.round(atk * 0.6),
    durability: 50 + level * 5
  };
}
function randomPill(input, level) {
  const prefixes = ["九转", "清心", "回春", "凝神", "聚气", "还魂", "霸王", "金刚", "回天", "悟道"];
  const bodies = ["丹", "丸", "散", "膏", "露", "液"];
  const suffixes = ["", "·上品", "·秘制", "·仙方", "·古方", "·灵炼"];
  const r = Math.random();
  const rarity = r < 0.4 ? "common" : r < 0.75 ? "fine" : r < 0.95 ? "rare" : r < 0.99 ? "epic" : "legend";
  let name;
  if (input && input.trim()) {
    name = input.trim().slice(0, 10);
    if (!/丹|丸|散|膏|露|液/.test(name)) name += "丹";
  } else {
    name = `${prefixes[Math.floor(Math.random() * prefixes.length)]}${bodies[Math.floor(Math.random() * bodies.length)]}${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  }
  const heals = { common: 20, fine: 50, rare: 120, epic: 300, legend: 800 };
  const heal = Math.round((heals[rarity] || 20) * (1 + level * 0.02));
  return {
    name,
    kind: "consumable",
    rarity,
    heal,
    desc: `随机炼制的${name}（${RARITY_ZH[rarity]}），恢复 ${heal} 点生命`,
    price: Math.max(10, heal * 2),
    atk: 0,
    def: 0,
    durability: 0
  };
}
function buildForgePrompt(input, level, typeHint = "", blueprint = "") {
  const bp = String(blueprint || "").trim();
  const lines = [
    "为 RPG 游戏生成一件物品。",
    `名称/方向：${input || "随机"}`,
    `玩家等级：${level}`,
    `类型偏好：${typeHint || "随机（material/equipment/weapon/armor/skill_book）"}`,
    "",
    "要求：",
    "1. 输出纯 JSON，不要任何解释文字",
    "2. 格式：",
    '{"name":"物品名（不超过8个汉字）","kind":"material|equipment|weapon|armor|skill_book","rarity":"common|fine|rare|epic|legend","heal":0,"desc":"描述（不超过30字）","price":50,"atk":0,"def":0,"durability":0}',
    "3. 品质概率：common 40% / fine 35% / rare 20% / epic 4% / legend 1%",
    "4. 只有 equipment/weapon/armor 才需要 atk/def/durability，其余填 0",
    "5. 价格与品质和等级挂钩"
  ];
  if (bp) {
    lines.push(
      "",
      "【按图纸制造】",
      `玩家正在使用图纸「${bp}」，你必须产出这张图纸记载的**成品**${input ? `「${input}」` : ""}。`,
      `严禁把「${bp}」或任何带「图纸/图谱/配方/丹方/秘法/总纲/拓本/残卷」字样的东西当作产物——图纸是消耗品，不会变成产出。`,
      "产物的 kind 必须是 equipment/weapon/armor（可锻造的成品），并按成品档次给出 atk/def/durability。"
    );
  }
  return lines.join("\n");
}
function buildAlchemyPrompt(input, level, typeHint = "", blueprint = "") {
  const bp = String(blueprint || "").trim();
  const lines = [
    "为 RPG 游戏生成一颗丹药。",
    `名称/方向：${input || "随机"}`,
    `玩家等级：${level}`,
    `类型偏好：${typeHint || "随机（回血/回蓝/增益/解毒/特殊）"}`,
    "",
    "要求：",
    "1. 输出纯 JSON，不要任何解释文字",
    "2. 格式：",
    '{"name":"丹药名（不超过6个汉字）","kind":"consumable","rarity":"common|fine|rare|epic|legend","heal":0,"desc":"描述（不超过30字）","price":60,"effect":{"type":"atk|def|spd|crit|all|exp|drop|none","value":0,"duration":0}}',
    "3. 品质概率：common 40% / fine 35% / rare 20% / epic 4% / legend 1%",
    "4. 回血丹药 heal>0 且 effect.type=none；增益丹药 heal=0 且 effect 必填",
    "5. effect.value 是百分比（1-50），duration 是秒数（30-300）"
  ];
  if (bp) {
    lines.push(
      "",
      "【按药方炼制】",
      `玩家正在使用药方「${bp}」，你必须炼出这张药方记载的**丹药**${input ? `「${input}」` : ""}。`,
      `严禁把「${bp}」或任何带「配方/丹方/药方/丹谱/秘方/拓本/残卷」字样的东西当作产物——药方是消耗品，不会变成产出。`,
      "产物 kind 必须是 consumable。"
    );
  }
  return lines.join("\n");
}
function buildUpgradePrompt(name, lv, nextLv, stats) {
  return [
    "升级一件 RPG 装备。",
    `原装备名称：${name}`,
    `当前等级：${lv} → 目标等级：${nextLv}`,
    `当前属性：${stats || "无"}`,
    "",
    "要求：",
    "1. 输出纯 JSON，不要任何解释文字",
    "2. 格式：",
    '{"name":"升级后名称","atk":0,"def":0,"durability":0,"desc":"描述（不超过30字）"}',
    "3. 属性比原来提升 20%~50%",
    "4. 名称保留原装备辨识度（可加 +1 / 精锻 / 强化 后缀）",
    "5. 原装备没有的属性填 0"
  ].join("\n");
}
export {
  RARITY_ZH,
  aiGenerate,
  blueprintProduct,
  buildAlchemyPrompt,
  buildForgePrompt,
  buildUpgradePrompt,
  calcDissolveReturns,
  calcPillDissolveReturns,
  extractJsonObject,
  looksLikeBlueprint,
  normalizeGenerated,
  pickBlueprints,
  pickEquipments,
  pickPills,
  pickRecipes,
  randomForgeItem,
  randomPill,
  returnsToText
};
