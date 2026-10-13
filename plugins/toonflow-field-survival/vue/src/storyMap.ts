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

/** 缓存从 tf_plugin_state.state 里取到的故事名/id（init 后由 App.vue 写入） */
let _stateStoryName = "";
let _stateStoryId = "";

/**
 * 插件 App.vue 收到首条 tf_plugin_state 时调用，把世界名/ID 写进来。
 * 同源的 state.roles/entities 来自同一份后端状态，所以这是最稳的来源。
 */
export function setStoryContext(name: string, id?: string | number): void {
  if (name && !_stateStoryName) _stateStoryName = String(name);
  if (id != null && id !== "" && !_stateStoryId) _stateStoryId = String(id);
}

/** ★ App.vue 收到宿主 tf_plugin_state 时，可把当前会话ID 喂进来（便于日志/排查） */
export function setSessionContext(sessionId: string): void {
  if (sessionId) _stateSessionId = String(sessionId);
}

let _stateSessionId = "";

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
  if (!v || typeof v !== "object") {
    console.warn(`[field-survival] map_visual 读取结果: 非对象 (${typeof v})`);
    return null;
  }
  if (v.files && typeof v.files === "object") {
    console.info(`[field-survival] map_visual 形态①（已解包）: files keys = ${Object.keys(v.files).join(", ")}`);
    return { files: v.files as Record<string, any>, first: v.first };
  }
  if (v.format === "tbg" && typeof v.data === "string") {
    console.info(`[field-survival] map_visual 形态②（未解包 tbg）: data length = ${v.data.length} bytes (base64)`);
    const unpacked = await tbgToVisFiles(v.data);
    if (!unpacked) {
      console.warn(`[field-survival] map_visual tbg 解包失败`);
      return null;
    }
    console.info(`[field-survival] map_visual tbg 解包成功: files keys = ${Object.keys(unpacked.files).join(", ")}`);
    return { files: unpacked.files, first: unpacked.first };
  }
  console.warn(`[field-survival] map_visual 形态未知: keys = ${Object.keys(v).join(", ")}`);
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

// ── 调试输出：故事 / 地图集来源（用户要求打印的字段） ──
  // 故事名来源链（按可靠性从高到低）：
  //   ① plugin_state 里透出的 worldName（与角色列表同源，最稳）
  //   ② ctx.worldName（旧 tsApi）
  //   ③ ?story= URL 参数（宿主 ScenePlay 拼 iframe URL 时追加）
  //   ④ window.__STORY__（vite dev-host 注入）
  const _ctx = (toonflowJsApi as any)?.ctx || {};
  let _urlStory = "";
  let _urlWorldId = "";
  let _urlSessionId = "";
  try {
    const sp = new URLSearchParams(location.search);
    _urlStory = sp.get("story") || "";
    _urlWorldId = sp.get("worldId") || "";
    _urlSessionId = sp.get("sessionId") || "";
  } catch { /* ignore */ }
  const _storyName = String(
    _stateStoryName || _ctx.worldName || _urlStory || (window as any).__STORY__ || ""
  );
  // 故事id 优先级：setStoryContext 写入 → ctx.storyId/worldId → URL ?worldId= → 兜底"未知"
  const _storyId = String(
    _stateStoryId || _ctx.storyId || _ctx.worldId || _urlWorldId || "未知"
  );
  // 调试日志加会话id（便于排插桩/查数据落库归属）
  const _sessionId = String(_stateSessionId || _ctx.sessionId || _urlSessionId || "未知");
  console.info(`[field-survival] 故事名: ${_storyName}`);
  console.info(`[field-survival] 故事id: ${_storyId}`);
   console.info(`[field-survival] sessionid: ${_sessionId}`);
  // ★ 统一：CLI 写到 "map_visual:<故事名>" (sessionId="all")，前端用 getTemplate 拉
  const _dataKey = `map_visual:${_storyName}`;
  console.info(`[field-survival] 故事集获取方式: toonflowJsApi.pluginData.getTemplate("${_dataKey}")`);
  console.info(`[field-survival] 故事集 datakey: ${_dataKey} (sessionId=all)`);
  let _getOk = false;
  let _fileNames: string[] = [];
  let _fallbackReason = "";
  loaded = true;
  bundle = null;
  if (!inIframe()) return null;
  try {
    // ★ 统一通道：getTemplate（sessionId="all" 模板）
    const v = await withTimeout(
      (toonflowJsApi as any)?.pluginData?.getTemplate?.(_dataKey),
      2000
    );
    console.info(`[field-survival] map_visual 模板读取结果: ${v ? (v.format === "tbg" ? "tbg 包" : v.files ? "files 结构" : "未知形态") + ` (keys: ${v ? Object.keys(v).join(",") : "null"})` : "null"}`);
    let nb = await normalizeBundle(v);
    // ── 退路①：模板读不到（iframe 内拿不到 worldName）→ 读 entry 注入的本会话 map_visual ──
    if (!nb || Object.keys(nb.files).length === 0) {
      console.info(`[field-survival] 模板未命中，退路读本会话 map_visual（entry.ensureStoryVisualMap 注入）`);
      const sv = await withTimeout(
        (toonflowJsApi as any)?.pluginData?.get?.("map_visual"),
        2000
      );
      console.info(`[field-survival] 会话 map_visual 读取结果: ${sv ? (sv.format === "tbg" ? "tbg 包" : sv.files ? "files 结构" : "未知形态") : "null"}`);
      const nb2 = await normalizeBundle(sv);
      if (nb2 && Object.keys(nb2.files).length > 0) nb = nb2;
    }
    if (nb && Object.keys(nb.files).length > 0) {
      bundle = nb;
      const fileNames = Object.keys(bundle.files);
      _getOk = true;
      _fileNames = fileNames;
      console.info(
        `[field-survival] 已加载故事视觉地图包 ${_dataKey}（${fileNames.length} 张图）: ${fileNames.join(", ")}${bundle.first ? ` + first` : ""}`,
      );
    } else {
      _fallbackReason = nb ? "files 为空" : "normalize 返回 null（模板不存在 / 形态未知 / tbg 解包失败）";
    }
  } catch (e: any) {
    _fallbackReason = `读取异常: ${e?.message || e}`;
    bundle = null;
  }
  // ── 调试总结：成功/失败 + 退路回默认 ──
  console.info(`[field-survival] 故事集是否从数据库获取成功: ${_getOk ? `✅ 是（${_fileNames.length} 张图）` : `❌ 否`}`);
  if (!_getOk) {
    console.info(`[field-survival] 故事集获取失败。退路回默认地图数据: ui/maps 目录 (first.map.json + 回退 storyMapBase())`);
  } else {
    console.info(`[field-survival] 故事集 json 文件名: ${_fileNames.join(", ")}${bundle?.first ? " + first.map.json" : ""}`);
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
