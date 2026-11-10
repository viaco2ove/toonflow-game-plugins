/**
 * entityRegistry.ts —— 实体档案注册表（**数据驱动，零地图集业务**）
 * ============================================================
 * 设计原则（2026-11-10 用户明确要求）：
 *   **插件里不允许出现任何「某个地图集特有」的实体/名称/数值。**
 *   所有地图集特有的档案（怪物数值、中文名、贴图帧、NPC 对话名）都由
 *   **地图集自己的 entity_types.json** 声明，插件只负责通用解析。
 *
 * 数据源：地图集视觉包（map_visual:<故事>）里的 entity_types.json
 *   —— 与 maps/*.json、events/ 同一个 .tbg 包，一 story 一份，互不干扰。
 *
 * 字段约定（均为可选，缺失走通用兜底）：
 *   enemies[] / special_enemies[]:
 *     entity_type   必填，主键
 *     name_zh       头顶中文名（缺省回退 description_zh → name）
 *     hp / str / def 原始数值（Rotten-Soup 口径）
 *     hp_game / atk_game / level_game  覆盖用（游戏化调参后的数值）
 *     textures[]    图集 tile id（[0] 为主帧）—— 贴图由此数据驱动
 *     camp          hostile / friendly / neutral
 *   npc_dialogs    { "<dialog key>": "<中文名>" }  NPC dialog key → 中文名
 *   non_hostile_entity_types / corpse_entity_types / item_types
 *                   非敌对类型清单（原样透出，用于解析白名单）
 *
 * 兜底（地图集没声明时）：
 *   · 数值   → hp/str 派生，level 1
 *   · 中文名 → description_zh → name → entity_type
 *   · 贴图   → mobKeyFor(名字) 的通用猜帧（assets.ts，纯通用规则）
 *   · 怪白名单 → 地图集声明的 types ∪ 地图对象显式 camp=hostile
 */

import { getStoryEntityTypes } from "./storyMap";

export interface MobArchetype {
  /** 头顶显示名（中文优先） */
  name: string;
  hp: number;
  atk: number;
  def: number;
  level: number;
  /** 阵营 */
  camp: "hostile" | "friendly" | "neutral";
  /** 图集主帧 tile id（0 = 未声明，走通用猜帧） */
  spriteTile: number;
}

/** entity_type → 档案 */
const archetypes = new Map<string, MobArchetype>();
/** entity_type → 头顶中文名 */
const typeZh = new Map<string, string>();
/** entity_type → 图集帧 tile id 列表（[0]=主帧，[1]=走位帧，可选） */
const spriteTiles = new Map<string, number[]>();
/** entity_type → assets.ts 的通用 sprite key（地图集显式指定时优先） */
const spriteKeys = new Map<string, string>();
/** 已知「怪」类型（解析白名单） */
const mobTypes = new Set<string>();
/** 已知「非怪」类型（解析时不该当怪处理） */
const nonMobTypes = new Set<string>();
/** NPC dialog key → 中文名 */
const npcDialogZh = new Map<string, string>();

let loaded = false;
let loadedSource = "";

function toNum(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pickName(e: any): string {
  return String(
    e?.name_zh || e?.name_zh_cn || e?.description_zh || e?.name || e?.entity_type || "",
  );
}

function registerEnemy(e: any): void {
  const et = String(e?.entity_type || "").trim();
  if (!et) return;
  const hp = toNum(e?.hp_game ?? e?.hp, 30);
  const atk = toNum(e?.atk_game ?? e?.str, 6);
  const def = toNum(e?.def_game ?? e?.def, 0);
  const level = toNum(e?.level_game ?? e?.level, 1);
  const campRaw = String(e?.camp || (e?.hostile === false ? "neutral" : "hostile")).toLowerCase();
  const camp = (campRaw === "friendly" || campRaw === "neutral") ? campRaw : "hostile";
  const textures = Array.isArray(e?.textures) ? e.textures.map((x: any) => toNum(x, 0)) : [];
  const spriteTile = toNum(e?.sprite_tile ?? (textures.length ? textures[0] : 0), 0);

  const arch: MobArchetype = { name: pickName(e), hp, atk, def, level, camp, spriteTile };
  archetypes.set(et, arch);
  typeZh.set(et, arch.name);
  if (textures.length) spriteTiles.set(et, textures);
  const sk = String(e?.sprite_key || "").trim();
  if (sk) spriteKeys.set(et, sk);
  mobTypes.add(et);
  nonMobTypes.delete(et);
}

function registerNpcDialogs(obj: any): void {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v) npcDialogZh.set(String(k).trim().toUpperCase(), v);
  }
}

/**
 * 载入地图集声明的实体档案。
 * 幂等；数据源 = 当前故事视觉包里的 entity_types.json。
 * 地图集没带 entity_types.json → 走**通用兜底**（hp/str 派生 + 中文名猜帧），
 * 插件不内置任何怪物业务表。
 * @param force 强制重载（切故事 / 重新上传视觉包后）
 */
export function loadEntityRegistry(force = false): void {
  if (loaded && !force) return;
  archetypes.clear();
  typeZh.clear();
  spriteTiles.clear();
  spriteKeys.clear();
  mobTypes.clear();
  nonMobTypes.clear();
  npcDialogZh.clear();

  const data = getStoryEntityTypes();
  if (data && typeof data === "object") {
    for (const e of Array.isArray(data.enemies) ? data.enemies : []) registerEnemy(e);
    for (const e of Array.isArray(data.special_enemies) ? data.special_enemies : []) registerEnemy(e);
    for (const t of Array.isArray(data.non_hostile_entity_types) ? data.non_hostile_entity_types : []) {
      nonMobTypes.add(String(t).trim());
    }
    for (const t of Array.isArray(data.corpse_entity_types) ? data.corpse_entity_types : []) {
      nonMobTypes.add(String(t).trim());
    }
    for (const t of Array.isArray(data.item_types) ? data.item_types : []) {
      nonMobTypes.add(String(t).trim());
    }
    registerNpcDialogs(data.npc_dialogs);
    registerNpcDialogs(data.npc_dialog);
    loadedSource = "地图集 entity_types.json";
  } else {
    loadedSource = "(地图集未带 entity_types.json → 全部走通用兜底)";
    console.warn("[entityRegistry] 地图集未提供 entity_types.json：怪档案全部走通用兜底");
  }

  loaded = true;
  console.info(
    `[entityRegistry] 已载入实体档案：怪 ${mobTypes.size} 种 / 非怪 ${nonMobTypes.size} 种 / NPC 对话名 ${npcDialogZh.size} 个（来源：${loadedSource}）`,
  );
}

/** 档案查询（无声明 → null，调用方走通用兜底） */
export function getArchetype(entityType: string): MobArchetype | null {
  if (!loaded) loadEntityRegistry();
  return archetypes.get(String(entityType || "").trim()) || null;
}

/** 头顶中文名（无声明 → ""） */
export function getTypeZh(entityType: string): string {
  if (!loaded) loadEntityRegistry();
  return typeZh.get(String(entityType || "").trim()) || "";
}

/** 图集帧 tile id 列表（未声明 → []；[0]=主帧，[1]=走位帧） */
export function getSpriteTiles(entityType: string): number[] {
  if (!loaded) loadEntityRegistry();
  return spriteTiles.get(String(entityType || "").trim()) || [];
}

/** 地图集显式指定的 sprite_key（未声明 → ""） */
export function getSpriteKey(entityType: string): string {
  if (!loaded) loadEntityRegistry();
  return spriteKeys.get(String(entityType || "").trim()) || "";
}

/** 是否已知怪类型 */
export function isMobType(entityType: string): boolean {
  if (!loaded) loadEntityRegistry();
  return mobTypes.has(String(entityType || "").trim());
}

/** 是否已知非怪类型 */
export function isNonMobType(entityType: string): boolean {
  if (!loaded) loadEntityRegistry();
  return nonMobTypes.has(String(entityType || "").trim());
}

/** NPC dialog key → 中文名（无 → ""） */
export function getNpcDialogZh(dialogKey: string): string {
  if (!loaded) loadEntityRegistry();
  return npcDialogZh.get(String(dialogKey || "").trim().toUpperCase()) || "";
}

/** 供调试面板显示 */
export function registryInfo(): { source: string; mobs: number; nonMobs: number; npcNames: number } {
  return { source: loadedSource, mobs: mobTypes.size, nonMobs: nonMobTypes.size, npcNames: npcDialogZh.size };
}
