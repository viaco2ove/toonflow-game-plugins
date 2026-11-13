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
