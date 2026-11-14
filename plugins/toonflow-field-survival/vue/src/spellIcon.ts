/**
 * ★ V2（2026-11-13）法术图标共享模块
 * ------------------------------------------------------------------
 * 背景：P2.5 的属性法术图标原本写在 App.vue 里（spellIconCache / spellIcon），
 *   V2 的「头顶徽章」也要用同一批图标 → 抽成独立模块，避免两份缓存两份实现。
 *
 * ★ 顺带修一个 P2.5 的隐患：
 *   原来 `img.src = src` 用**裸相对路径**（如 "images/spells/fire/fireball.png"）。
 *   在**宿主安装态**（iframe 走 /plugin/getAsset?pluginId=..&path=ui/game.html）
 *   浏览器会把它解析成 /plugin/images/spells/... → **404**（少了 getAsset 那一段）。
 *   现在统一走 resolveAssetPath()：getAsset 环境自动拼 path=ui/…&token=…，
 *   dev / standalone 环境回落到相对路径。
 */
import { resolveAssetPath } from "./assets";

/** 法术图标缓存（路径 → HTMLImageElement）；48 张上限，LRU 语义（Map 保序） */
const spellIconCache = new Map<string, HTMLImageElement>();

/** 缓存上限：V2 徽章图标与特效图标共用（战斗高峰会同时用到十几张） */
const SPELL_ICON_CACHE_MAX = 48;

/**
 * 取法术图标；未加载时触发异步加载，本帧返回 null（下一帧自然就绪）。
 * @param src 插件内相对路径（如 images/spells/fire/fireball.png）
 */
export function spellIcon(src: string): HTMLImageElement | null {
  if (!src) return null;
  let img = spellIconCache.get(src);
  if (img) {
    // LRU：命中后挪到末尾
    spellIconCache.delete(src);
    spellIconCache.set(src, img);
    return (img.complete && img.naturalWidth > 0) ? img : null;
  }
  if (spellIconCache.size >= SPELL_ICON_CACHE_MAX) {
    const oldest = spellIconCache.keys().next().value;
    if (oldest) spellIconCache.delete(oldest);
  }
  img = new Image();
  img.onload = () => { /* 下一帧 drawVfxLayer / drawHeadStatusLayer 自然取到 */ };
  img.onerror = () => { /* 图标缺失：调用方会退回文字兜底 */ };
  // ★ 关键：经 resolveAssetPath 解析，getAsset 环境才能正确加载（否则 404）
  img.src = resolveAssetPath(src);
  spellIconCache.set(src, img);
  return null;
}

/** 清空缓存（切故事 / 换资源包时用） */
export function clearSpellIconCache(): void {
  spellIconCache.clear();
}

/**
 * ★ 2026-11-14 修复「插件安装后技能图标不显示」：
 *   属性特效下拉（EffectTypeSelect.vue）原先把 **裸相对路径** 直接塞进
 *   `<img :src="iconSrc(o.v)">`，绕过了 resolveAssetPath()。
 *   在宿主安装态（iframe 基址 = /plugin/getAsset）浏览器会把
 *   "images/spells/x.png" 解析成 /plugin/images/spells/x.png → 无 token → 401
 *   「未提供token」→ 图标空白（canvas 特效层走 spellIcon() 所以是好的，
 *   只有 <img> 标签这条路坏）。
 *
 *   修法：所有 <img :src> 一律用本函数取 URL，不再自己拼裸路径。
 *   @param src 插件内相对路径（如 images/spells/fire/fireball.png）
 */
export function spellIconSrc(src: string): string {
  if (!src) return "";
  return resolveAssetPath(src);
}

/**
 * ★ V2_2（2026-11-13）effects_type → 法术图标路径表（与 entry.ts 的 EFFECT_ICON 同一份，
 *   前端需要独立一份：技能/物品面板的「属性特效」下拉要显示图标）。
 *   key 为空串 = 未设置属性 → 无图标。
 */
export const EFFECT_ICON: Record<string, string> = {
  normal: "images/spells/enchantment/sure_blade.png",
  fire: "images/spells/fire/fireball.png",
  water: "images/spells/ice/freeze.png",
  thunder: "images/spells/air/lightning_bolt.png",
  wind: "images/spells/air/tornado.png",
  earth: "images/spells/earth/iron_shot.png",
  metal: "images/spells/earth/iron_shot.png",
  wood: "images/spells/poison/poison_arrow.png",
  light: "images/spells/restoration/minor_heal.png",
  dark: "images/spells/necromancy/agony.png",
  poison: "images/spells/poison/alistairs_intoxication.png",
  bleed: "images/spells/necromancy/bolt_of_draining.png",
};

/** 解析 effects_type 的法术图标路径；缺省/未知 → ""（无图标） */
export function effectIcon(effectsType: unknown): string {
  return EFFECT_ICON[String(effectsType || "")] || "";
}
