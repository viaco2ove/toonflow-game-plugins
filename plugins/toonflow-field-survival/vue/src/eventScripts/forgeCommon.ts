/**
 * 锻造大师 / 炼丹炉 共享工具
 * ================================
 * 两个事件脚本（E50_forge_master / E60_alchemy_furnace）共用的：
 *   - AI 生成与 JSON 解析
 *   - 物品/丹药校验
 *   - 背包筛选（升级/溶解时选目标）
 *   - 溶解返还预览
 */
import type { Ctx } from "./_ctx";

/** AI 生成的物品（校验后） */
export interface GeneratedItem {
  name: string;
  kind: string;
  rarity: string;
  heal: number;
  desc: string;
  price: number;
  atk: number;
  def: number;
  durability: number;
  lv?: number;
  effect?: { type: string; value: number; duration: number };
}

const ITEM_KINDS = ["material", "equipment", "weapon", "armor", "skill_book", "consumable"];
const RARITY_VALUES = ["common", "fine", "rare", "epic", "legend"];

/** 从 AI 返回文本里抽出第一个 JSON 对象（模型常包 ```json 围栏） */
export function extractJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** 校验并归一化 AI 生成结果（防越界值 / 空名 / 非法品质） */
export function normalizeGenerated(raw: any, fallback: Partial<GeneratedItem> = {}): GeneratedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || fallback.name || "").trim().slice(0, 20);
  if (!name) return null;
  const rarity = RARITY_VALUES.indexOf(String(raw.rarity)) >= 0
    ? String(raw.rarity)
    : String(fallback.rarity || "common");
  const kind = ITEM_KINDS.indexOf(String(raw.kind)) >= 0
    ? String(raw.kind)
    : String(fallback.kind || "material");
  const n = (v: any, d: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || d)));
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
    lv: raw.lv != null ? Math.max(1, Math.round(Number(raw.lv) || 1)) : undefined,
    effect: raw.effect && typeof raw.effect === "object"
      ? {
          type: String(raw.effect.type || "none").slice(0, 20),
          value: n(raw.effect.value, 0, 9999),
          duration: n(raw.effect.duration, 0, 9999),
        }
      : undefined,
  };
}

/** 稀有度中文名（弹窗展示用） */
export const RARITY_ZH: Record<string, string> = {
  common: "凡品",
  fine: "精品",
  rare: "灵品",
  epic: "仙品",
  legend: "神品",
};

/** 背包里的装备类物品（升级/溶解目标） */
export interface BagEntry {
  name: string;
  count: number;
  kind: string;
  rarity: string;
  heal: number;
  lv?: number;
  desc?: string;
}

/** ★ 背包筛选：可升级/溶解的装备（排除技能书和材料） */
export function pickEquipments(bag: BagEntry[]): BagEntry[] {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (/技能|秘籍|心得|卷轴|心法|功法|图纸|配方|药方/.test(b.name)) return false;
    return ["equipment", "weapon", "armor"].includes(b.kind)
      || /剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴|袍|盔|拳套|镯|项链/.test(b.name);
  });
}

/** ★ 背包筛选：可溶解的丹药（消耗品且有恢复值或增益描述） */
export function pickPills(bag: BagEntry[]): BagEntry[] {
  return bag.filter((b) => {
    if (!b.name) return false;
    if (/药方|配方|图纸/.test(b.name)) return false;
    return b.kind === "consumable" && (/丹|丸|散|膏|露|液|药/.test(b.name) || b.heal > 0);
  });
}

/**
 * ★ 背包筛选：锻造图纸
 *   原来只认「图纸|锻造法|铸造|秘方」，「虚空武器锻造术」「神兵铸造总纲」
 *   「龙鳞甲编缀图」这类会漏掉（实测 8 张图纸只筛出 5 张）。
 */
export function pickBlueprints(bag: BagEntry[]): BagEntry[] {
  return bag.filter((b) => {
    if (!b.name) return false;
    // 技能书「基础锻造术 / 初级铸造术」不是图纸（名字像，但 kind=skill_book）
    if (String(b.kind || "") === "skill_book") return false;
    if (/^(基础|初级|中级|高级|入门|精通|大师|宗师|简易|进阶)/.test(b.name)) return false;
    if (/药方|丹方|丹谱|药谱|配方/.test(b.name)) return false;
    return /图纸|图谱|锻造|铸造|秘法|秘方|总纲|编缀/.test(b.name);
  });
}

/** ★ 背包筛选：药方 */
export function pickRecipes(bag: BagEntry[]): BagEntry[] {
  return bag.filter((b) => {
    if (!b.name) return false;
    // 技能书「初级炼丹术」不是药方
    if (String(b.kind || "") === "skill_book") return false;
    if (/^(基础|初级|中级|高级|入门|精通|大师|宗师|简易|进阶)/.test(b.name)) return false;
    if (/图纸|图谱|锻造|铸造/.test(b.name)) return false;
    return /药方|丹方|丹谱|药谱|配方|秘方|拓本|残卷/.test(b.name);
  });
}

/* ============================================================
   ★ 图纸 / 药方 → 实际产物名
   ------------------------------------------------------------
   这是「用图纸打造」的核心：图纸本身是**消耗品**，产出的必须是
   图纸记载的成品（铁剑图纸 → 铁剑），不能把「铁剑图纸」当成产物
   塞回背包（原来的 bug：AI 收到 input=「铁剑图纸」，就生成了一件
   名叫「铁剑图纸」的物品，图纸还留在包里，越打越多）。
   ============================================================ */

/** 图纸/药方名称尾部的「载体后缀」，长的必须排在前面 */
const BP_SUFFIXES = [
  "铸造总纲", "铸造秘法", "铸造术", "铸造法",
  "锻造总纲", "锻造秘法", "锻造术", "锻造法",
  "炼制秘法", "炼法", "制法",
  "编缀图", "图纸", "图谱", "图",
  "总纲", "拓本", "残卷", "秘法", "秘方", "配方", "丹方", "药方", "丹谱", "药谱",
];

/** 剥掉后缀后若只剩这些「没有指代」的词，视为图纸没写明产物 */
const BP_MEANINGLESS = /^(随机|上古|未知|残缺|古老|残破|无字|空白|神秘|传说|神兵|虚空)$/;

/**
 * 从图纸 / 药方名称推导出「它要制作的东西」。
 *   「铁剑图纸」→「铁剑」        「明月剑铸造秘法」→「明月剑」
 *   「龙鳞甲编缀图」→「龙鳞甲」  「九转回魂丹配方」→「九转回魂丹」
 *   「随机丹方残卷」→「」（产物未知，让 AI 自由发挥）
 * 返回 "" 表示图纸没写清产物，调用方应让 AI 随机生成。
 */
export function blueprintProduct(blueprintName: string): string {
  let s = String(blueprintName || "").trim();
  if (!s) return "";
  // 反复剥（「随机丹方残卷」→ 随机丹方 → 随机）
  for (let i = 0; i < 4; i++) {
    let hit = false;
    for (const suf of BP_SUFFIXES) {
      if (s.length >= suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); hit = true; break; }
    }
    if (!hit) break;
  }
  // 残留的动词性修饰
  s = s.replace(/(铸造|锻造|炼制|编缀|制作|的)+$/, "").trim();
  if (s.length < 2) return "";
  if (BP_MEANINGLESS.test(s)) return "";
  return s;
}

/** 物品名是否像「图纸 / 药方」这类载体（用于拦 AI 把图纸当产物返回） */
export function looksLikeBlueprint(name: string): boolean {
  const s = String(name || "");
  if (!s) return false;
  return /图纸|图谱|编缀图|总纲|拓本|残卷|秘法|秘方|配方|丹方|药方|丹谱|药谱|锻造法|锻造术|铸造法|铸造术/.test(s);
}

/** ★ 溶解返还算法（装备）：品质倍率 × 等级 */
const DISSOLVE_MULT: Record<string, number> = { common: 1, fine: 2, rare: 4, epic: 8, legend: 15 };
export function calcDissolveReturns(rarity: string, lv: number): { ore: number; stone: number } {
  const mult = DISSOLVE_MULT[rarity] || 1;
  const l = Math.max(1, Math.round(lv));
  return { ore: Math.max(1, l * mult), stone: Math.max(0, Math.floor((l * mult) / 3)) };
}

/** ★ 溶解返还算法（丹药）：按恢复量换算草药 */
export function calcPillDissolveReturns(heal: number): { herb: number; lingzhi: number } {
  const h = Math.max(1, Math.round(heal));
  return { herb: Math.max(1, Math.round(h / 20)), lingzhi: Math.max(0, Math.round(h / 100)) };
}

/** ★ 返还清单转成「铁矿石×3、灵石碎屑×1」文本 */
export function returnsToText(returns: Record<string, number>): string {
  return Object.entries(returns)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}×${v}`)
    .join("、");
}

/**
 * ★ 调 AI 生成物品（ctx.ai.generate）
 * 失败（agent 不可用 / 超时 / 返回非 JSON）→ 返回 null，调用方走随机兜底。
 */
export async function aiGenerate(
  ctx: Ctx,
  agentName: string,
  prompt: string,
  fallback: Partial<GeneratedItem> = {},
): Promise<GeneratedItem | null> {
  const text = await ctx.ai.generate(agentName, prompt, { timeoutMs: 20000 });
  if (!text || !text.trim()) return null;
  const raw = extractJsonObject(text);
  if (!raw) return null;
  return normalizeGenerated(raw, fallback);
}

/** ★ 随机兜底：锻造物品（AI 不可用时） */
export function randomForgeItem(input: string, level: number): GeneratedItem {
  const prefixes = ["粗制", "精锻", "寒铁", "烈焰", "疾风", "雷霆", "暗影", "圣光", "龙骨", "陨星"];
  const bodies = ["剑", "刀", "枪", "弓", "杖", "甲", "盔", "靴", "盾", "戒指", "护符", "拳套"];
  const suffixes = ["", "·破晓", "·噬魂", "·龙纹", "·星陨", "·霜华", "·焚天", "·幽冥"];
  const r = Math.random();
  const rarity = r < 0.40 ? "common" : r < 0.75 ? "fine" : r < 0.95 ? "rare" : r < 0.99 ? "epic" : "legend";
  const name = input && input.trim()
    ? input.trim().slice(0, 12)
    : `${prefixes[Math.floor(Math.random() * prefixes.length)]}${bodies[Math.floor(Math.random() * bodies.length)]}${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  const prices: Record<string, number> = { common: 15, fine: 50, rare: 150, epic: 400, legend: 1000 };
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
    durability: 50 + level * 5,
  };
}

/** ★ 随机兜底：丹药（AI 不可用时） */
export function randomPill(input: string, level: number): GeneratedItem {
  const prefixes = ["九转", "清心", "回春", "凝神", "聚气", "还魂", "霸王", "金刚", "回天", "悟道"];
  const bodies = ["丹", "丸", "散", "膏", "露", "液"];
  const suffixes = ["", "·上品", "·秘制", "·仙方", "·古方", "·灵炼"];
  const r = Math.random();
  const rarity = r < 0.40 ? "common" : r < 0.75 ? "fine" : r < 0.95 ? "rare" : r < 0.99 ? "epic" : "legend";
  let name: string;
  if (input && input.trim()) {
    name = input.trim().slice(0, 10);
    if (!/丹|丸|散|膏|露|液/.test(name)) name += "丹";
  } else {
    name = `${prefixes[Math.floor(Math.random() * prefixes.length)]}${bodies[Math.floor(Math.random() * bodies.length)]}${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  }
  const heals: Record<string, number> = { common: 20, fine: 50, rare: 120, epic: 300, legend: 800 };
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
    durability: 0,
  };
}

/** ★ AI 物品打造 Prompt */
export function buildForgePrompt(input: string, level: number, typeHint = "", blueprint = ""): string {
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
    "5. 价格与品质和等级挂钩",
  ];
  if (bp) {
    lines.push(
      "",
      "【按图纸制造】",
      `玩家正在使用图纸「${bp}」，你必须产出这张图纸记载的**成品**${input ? `「${input}」` : ""}。`,
      `严禁把「${bp}」或任何带「图纸/图谱/配方/丹方/秘法/总纲/拓本/残卷」字样的东西当作产物——图纸是消耗品，不会变成产出。`,
      "产物的 kind 必须是 equipment/weapon/armor（可锻造的成品），并按成品档次给出 atk/def/durability。",
    );
  }
  return lines.join("\n");
}

/** ★ AI 丹药炼制 Prompt */
export function buildAlchemyPrompt(input: string, level: number, typeHint = "", blueprint = ""): string {
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
    "5. effect.value 是百分比（1-50），duration 是秒数（30-300）",
  ];
  if (bp) {
    lines.push(
      "",
      "【按药方炼制】",
      `玩家正在使用药方「${bp}」，你必须炼出这张药方记载的**丹药**${input ? `「${input}」` : ""}。`,
      `严禁把「${bp}」或任何带「配方/丹方/药方/丹谱/秘方/拓本/残卷」字样的东西当作产物——药方是消耗品，不会变成产出。`,
      "产物 kind 必须是 consumable。",
    );
  }
  return lines.join("\n");
}

/** ★ AI 装备升级 Prompt */
export function buildUpgradePrompt(name: string, lv: number, nextLv: number, stats: string): string {
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
    "5. 原装备没有的属性填 0",
  ].join("\n");
}
