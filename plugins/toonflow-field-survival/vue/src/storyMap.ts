/**
 * storyMap — 当前会话的「视觉 Tiled 地图包」（故事绑定）
 *
 * 背景（2026-10-13 纠正）：
 *   插件有三套"地图"概念，别混：
 *     ① 视觉 Tiled 世界（mulberryTown.json 等 tiles/层/碰撞/传送门）——
 *        旧实现安装时烘焙进 ui/maps/，被 loadLevelByName 直接 fetch，
 *        **所有故事/用户共用同一份**（不绑故事）。
 *     ② map_data 元数据（theme/zones/mobs/chests/enemy_archetypes）——
 *        per-session 存 t_plugin_session_data，但只是玩法元数据，不换视觉世界。
 *     ③ map_data:<story> 模板（CLI plugin_session_data -u 上传的 .tbg 包，
 *        sessionId="all"）——运行时无人消费的死路径。
 *
 *   本模块把 ① 变成"绑当前会话/故事"：开局把该会话的视觉地图包读进缓存，
 *   loadLevelByName / loadMapConfig / loadStartLevelName 优先用它，
 *   读不到才回退现有 ui/maps（零回归）。
 *
 * 存储约定：
 *   t_plugin_session_data，dataKey = "map_visual"，per (userId, sessionId)：
 *     形态① { files: { mulberryTown: <Tiled json>, ... }, first: <first.map.json> }
 *           —— 前端 onUploadMap 手动上传时写的「已解包」结构；
 *     形态② { format: "tbg", encoding: "base64+zip", data: "<base64>", ... }
 *           —— entry.ensureStoryVisualMap 从故事模板（sessionId="all"）搬运来的
 *              「未解包」结构（CLI plugin_session_data -u 写的原样），本模块负责解包。
 *   files 的 key = 地图文件名（不含 .json），与 levelNameToFile(levelName) 对齐。
 *
 * 读取通道：toonflowJsApi.pluginData（iframe 内经宿主代发 /plugin/data，
 *   ScenePlay.vue 的 tf_plugin_data ↔ tf_plugin_data_result 对账）。
 *   仅在真宿主 iframe 内尝试（window.parent !== window）；standalone/dev 直读
 *   workshops（storyMapBase），不走 DB。带超时，失败/无包一律回退 null。
 */
import { toonflowJsApi } from "./toonflowJsApi";
import { tbgToVisFiles } from "./zipTbg";

export interface StoryMapBundle {
  /** 文件名(不含.json) → 原始 Tiled/普通地图 JSON */
  files: Record<string, any>;
  /** first.map.json 解析结果（开局起始图声明），可选 */
  first?: any;
}

let bundle: StoryMapBundle | null = null;
let loaded = false;

function inIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window;
  } catch {
    return false;
  }
}

/** 竞速超时：p  resolve/reject 都吞成值，超时返回 null（绝不挂起开局） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    Promise.resolve(p).then((v) => v).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * 把 pluginData 里的 map_visual 值归一化成 StoryMapBundle：
 *   形态① { files, first }（手动上传的已解包结构）→ 直接用；
 *   形态② { format:"tbg", data:<base64> }（entry 从故事模板搬运的未解包结构）→ 解包。
 */
async function normalizeBundle(v: any): Promise<StoryMapBundle | null> {
  if (!v || typeof v !== "object") return null;
  if (v.files && typeof v.files === "object") {
    return { files: v.files as Record<string, any>, first: v.first };
  }
  if (v.format === "tbg" && typeof v.data === "string") {
    const unpacked = await tbgToVisFiles(v.data);
    if (!unpacked) return null;
    return { files: unpacked.files, first: unpacked.first };
  }
  return null;
}

/**
 * 读取并缓存当前会话的视觉地图包。
 * - 非 iframe（standalone / 本地 dev 直开）：直接跳过，回退 storyMapBase / ui/maps。
 * - iframe 内：走 toonflowJsApi.pluginData.get("map_visual")，带 2s 超时；
 *   值为 {format:"tbg",data} 模板形态时本地解包（readZipEntries，无第三方依赖）。
 * @param force 强制重读（上传新地图后刷新缓存 / 进入 playing 时刷新用）
 */
export async function loadStoryMapBundle(force = false): Promise<StoryMapBundle | null> {
  if (loaded && !force) return bundle;
  loaded = true;
  bundle = null;
  if (!inIframe()) return null;
  try {
    const v = await withTimeout((toonflowJsApi as any)?.pluginData?.get("map_visual"), 2000);
    const nb = await normalizeBundle(v);
    if (nb && Object.keys(nb.files).length > 0) {
      bundle = nb;
      console.info(
        `[field-survival] 已加载会话视觉地图包 map_visual（${Object.keys(bundle.files).length} 张图）`,
      );
    }
  } catch {
    bundle = null;
  }
  return bundle;
}

/** 取缓存的地图包（同步，未加载返回 null） */
export function getStoryMapBundle(): StoryMapBundle | null {
  return bundle;
}

/** 取某张地图的原始 JSON（key = 文件名不含 .json）；无则 null */
export function getStoryMapRaw(file: string): any | null {
  if (!bundle || !file) return null;
  return bundle.files?.[file] ?? null;
}

/** 取 first.map.json 解析结果；无则 null */
export function getStoryFirstMap(): any | null {
  return bundle?.first ?? null;
}
