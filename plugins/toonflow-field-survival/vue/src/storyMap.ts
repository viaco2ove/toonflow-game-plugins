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
  /**
   * zip 内**全量** entries（按原 zip 路径作 key）：
   *   - maps/*.json / story.json / entity_types.json / compiled_dawnlike.json 等 .json → 已 parse
   *   - 其它（.png/.gif/.xlsx/...）→ Uint8Array
   * 切故事时 tileset/images/story.json 全部来自这里，与 ui/maps 公共资源隔离。
   */
  files: Record<string, any>;
  /**
   * 关卡名 → Tiled JSON 的便捷索引（maps/<name>.json）。loadMapConfig 内部继续用。
   * key 不含 maps/ 前缀、不含 .json。
   */
  mapFiles?: Record<string, any>;
  /** first.map.json 解析结果（开局起始图声明），可选 */
  first?: any;
  /** story.json，可选 */
  story?: any;
  /** entity_types.json，可选 */
  entityTypes?: any;
  /** compiled_dawnlike.json（tileset 属性表），可选 */
  tileset?: any;
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

/** 地图包单次读取超时（毫秒）。17MB tbg 经「iframe → 宿主 → 后端 → 宿主 → iframe」全链
 *  （含 23MB 级 JSON 的 postMessage 结构化克隆），旧值 2000ms 在开局拥塞下无余量——
 *  实测空闲基线 0.2~0.5s，而进入 playing 的同刻切图 / chunk 加载 / 游戏 tick 全在抢主线程
 *  与后端，读取耗时可数倍放大，2s 上限会把「慢」误杀成「没有」。 */
const MAP_READ_TIMEOUT_MS = 10000;
/** force 强制重读（进入 playing 时）遇到传输故障的额外重试次数；确诊 miss 不重试 */
const MAP_READ_RETRY_TIMES = 2;
/** 重试间隔（毫秒）：给开局瞬时拥塞一个退避窗口 */
const MAP_READ_RETRY_DELAY_MS = 2000;

/** 一次 pluginData 读取的三种结局——必须区分，调用方的缓存/回退策略完全不同 */
type MapReadOutcome =
  | { kind: "hit"; value: any }
  /** 后端明确返回 null = 数据不存在（模板没传过）→ 可安全回退默认图并缓存结论 */
  | { kind: "miss" }
  /** 超时 / 异常 / 宿主报错 = 传输层故障，数据可能存在 → 绝不能当 miss 缓存，必须允许重试 */
  | { kind: "fail"; reason: string };

/**
 * 执行一次 pluginData 读取并归类结局。
 * 背景（2026-10-26 线上踩坑）：旧实现用 Promise.race 2s 超时，把「超时 / 异常 / 真 miss」
 * 统一吞成 null；开局拥塞时 17MB 地图包读取超时被误判为「模板不存在」，外层又把 loaded
 * 置为 true，整局游戏锁死在 ui/maps 默认图——而数据库里模板与会话注入其实一直都在。
 * @param read 真正发起读取的函数（pluginData.get / getTemplate 调用）
 * @param label 日志前缀（定位是哪一路读取，便于后端 [map-diag] 日志对照）
 * @param timeoutMs 超时毫秒数；超时归类为 fail（不是 miss），迟到响应同样按 fail 处理
 */
async function probePluginData(
  read: () => Promise<any>,
  label: string,
  timeoutMs: number,
): Promise<MapReadOutcome> {
  let timedOut = false;
  // 定时器只负责标记超时、不中断 await：晚于超时到达的响应仍按 fail 归类，
  // 避免把一次「迟到的成功」当成命中（数据一致性风险）。
  const timer = window.setTimeout(() => { timedOut = true; }, timeoutMs);
  try {
    const value = await read();
    if (timedOut) {
      return { kind: "fail", reason: `${label} 响应晚于 ${timeoutMs}ms 超时到达` };
    }
    // pluginData 通道约定：宿主/后端错误会 reject（进下方 catch）；
    // 正常 resolve 且 value=null 即后端明确的「不存在」→ miss
    return value == null ? { kind: "miss" } : { kind: "hit", value };
  } catch (e: any) {
    return { kind: "fail", reason: `${label} 读取异常: ${String(e?.message || e)}` };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 把 pluginData 里的 map_visual 值归一化成 StoryMapBundle：
 *   形态① { files, first, story, entityTypes, tileset }（手动上传的已解包结构）→ 直接用；
 *     兼容旧形态 { files: { <文件名>: <json> }, first }（仅关卡 JSON），运行时用 mapFiles 兜底。
 *   形态② { format:"tbg", data:<base64> }（entry 从故事模板搬运的未解包结构）→ 解包（保留 zip 全量 entries）。
 */
async function normalizeBundle(v: any): Promise<StoryMapBundle | null> {
  if (!v || typeof v !== "object") {
    console.warn(`[field-survival] map_visual 读取结果: 非对象 (${typeof v})`);
    return null;
  }
if (v.files && (typeof v.files === "object")) {
    // ★ CLI 写入的 v.files 可能是数组（zip entry 名列表）而非对象（zip contents）。
    //   数组形态下 Object.keys 会变成 "0","1","2"...（数字 keys），误导消费者。
    //   真正的视觉数据在 v.data（base64 压缩流），一律走 tbgToVisFiles 重解。
    if (Array.isArray(v.files) && typeof v.data === "string") {
      console.info(`[field-survival] map_visual 形态①-数组（v.files 是 entry 名数组, ${v.files.length} 项），改走 v.data 重解 .tbg`);
      const unpacked = await tbgToVisFiles(v.data);
      if (!unpacked) {
        console.warn(`[field-survival] map_visual 数组形态 → tbg 解包失败（data length=${v.data.length}）`);
        return null;
      }
      const fileKeys = Object.keys(unpacked.files);
      const mapKeys = Object.keys(unpacked.mapFiles || {});
      console.info(`[field-survival] map_visual tbg 解包成功: 全量=${fileKeys.length} entries（maps 关卡=${mapKeys.length}（${mapKeys.slice(0, 5).join(", ")}${mapKeys.length > 5 ? "..." : ""}）, tileset=${unpacked.tileset ? "✓" : "✗"}, story=${unpacked.story ? "✓" : "✗"}, images=${fileKeys.filter((k) => /^images\//i.test(k)).length}）`);
      return {
        files: unpacked.files,
        mapFiles: unpacked.mapFiles,
        first: unpacked.first,
        story: unpacked.story,
        entityTypes: unpacked.entityTypes,
        tileset: unpacked.tileset,
      };
    }
    const files = v.files as Record<string, any>;
    const fileKeys = Object.keys(files);
    // 区分：旧形态（key 是裸文件名 mulberryTown 这种）vs 新形态（key 是 maps/mulberryTown.json 路径）。
    const looksLikePath = fileKeys.some((k) => k.includes("/") || k.endsWith(".json") || k.endsWith(".png") || k.endsWith(".gif") || k.endsWith(".xlsx"));
    if (looksLikePath) {
      // ★ 防护：形态①-new 必须有"过 Tiled 校验"（含 layers 数组）的关卡才算合法。
      //   历史曾被人/CLI 误传，把 sprite 帧 atlas 写成 { maps/0.json: ..., maps/1.json: ... }，
      //   这些 entries 不是 Tiled JSON（无 layers），必须拒绝当 0 关卡，避免脏数据当关卡列表消费。
      const mapFiles: Record<string, any> = {};
      for (const k of fileKeys) {
        const v2 = files[k];
        if (!/^maps\/[^/]+\.json$/i.test(k)) continue;
        if (!v2 || typeof v2 !== "object" || !Array.isArray(v2.layers)) continue;
        mapFiles[k.replace(/^maps\//i, "").replace(/\.json$/i, "")] = v2;
      }
      const tileset = files["compiled_dawnlike.json"] || v.tileset || null;
      const story = files["story.json"] || v.story || null;
      const entityTypes = files["entity_types.json"] || v.entityTypes || null;
      if (Object.keys(mapFiles).length === 0) {
        console.warn(`[field-survival] map_visual 形态①-new 拒绝：${fileKeys.length} entries 无一含 Tiled layers 数组（疑似 sprite atlas 误传）`);
        return null;
      }
      console.info(`[field-survival] map_visual 形态①-new（已解包全量）: files=${fileKeys.length}（maps 关卡=${Object.keys(mapFiles).length}, has tileset=${!!tileset}, has story=${!!story}）`);
      const sampleMapKeys = Object.keys(mapFiles).slice(0, 5);
      if (sampleMapKeys.length) console.info(`[field-survival]   样例关卡: ${sampleMapKeys.join(", ")}${Object.keys(mapFiles).length > 5 ? "..." : ""}`);
      return { files, mapFiles, first: v.first, story, entityTypes, tileset };
    }
    // 旧形态：files key 就是关卡名（mulberryTown / mulberryForest），同样防护
    const mapFiles: Record<string, any> = {};
    for (const k of fileKeys) {
      const v2 = files[k];
      if (v2 && typeof v2 === "object" && Array.isArray(v2.layers)) mapFiles[k] = v2;
    }
    if (Object.keys(mapFiles).length === 0) {
      console.warn(`[field-survival] map_visual 形态①-legacy 拒绝：${fileKeys.length} entries 无一含 Tiled layers 数组`);
      return null;
    }
    const tileset = v.tileset || null;
    const story = v.story || null;
    const entityTypes = v.entityTypes || null;
    console.info(`[field-survival] map_visual 形态①-legacy（仅关卡）: 关卡=${Object.keys(mapFiles).length} 张（${Object.keys(mapFiles).slice(0, 5).join(", ")}${Object.keys(mapFiles).length > 5 ? "..." : ""}）; tileset=${tileset ? "✓" : "✗"}, story=${story ? "✓" : "✗"}`);
    return { files, mapFiles, first: v.first, story, entityTypes, tileset };
  }
  if (v.format === "tbg" && typeof v.data === "string") {
    console.info(`[field-survival] map_visual 形态②（未解包 tbg）: data length = ${v.data.length} bytes (base64)`);
    const unpacked = await tbgToVisFiles(v.data);
    if (!unpacked) {
      console.warn(`[field-survival] map_visual tbg 解包失败`);
      return null;
    }
    const fileKeys = Object.keys(unpacked.files);
    const mapKeys = Object.keys(unpacked.mapFiles || {});
    console.info(`[field-survival] map_visual tbg 解包成功: 全量=${fileKeys.length} entries（maps 关卡=${mapKeys.length}（${mapKeys.slice(0, 5).join(", ")}${mapKeys.length > 5 ? "..." : ""}）, tileset=${unpacked.tileset ? "✓" : "✗"}, story=${unpacked.story ? "✓" : "✗"}, images=${fileKeys.filter((k) => /^images\//i.test(k)).length}）`);
    return {
      files: unpacked.files,
      mapFiles: unpacked.mapFiles,
      first: unpacked.first,
      story: unpacked.story,
      entityTypes: unpacked.entityTypes,
      tileset: unpacked.tileset,
    };
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
  // [field-survival] version,暂时手动编写版本日志
  console.info(`[field-survival] version:1.0.24`);
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
  if (!inIframe()) {
    // 独立预览（standalone / 本地 dev 直开）：无宿主数据通道，按「无包」缓存结论后回退
    loaded = true;
    bundle = null;
    return null;
  }

  /**
   * 单次「模板 → 会话」两级读取。
   * 任一级传输故障（fail）立即短路、交给上层退避重试；只有两级都给出明确结论
   * （命中可用包 / 确诊不存在）才返回最终结论，避免把开局拥塞造成的慢读取
   * 误判成「无包」而永久回退默认地图。
   */
  const tryReadOnce = async (): Promise<
    { ok: true; nb: StoryMapBundle } | { ok: false; miss: boolean; reason: string }
  > => {
    // ★ 统一通道：getTemplate（sessionId="all" 模板）
    const tpl = await probePluginData(
      () => (toonflowJsApi as any)?.pluginData?.getTemplate?.(_dataKey) ?? Promise.resolve(null),
      "map_visual 模板",
      MAP_READ_TIMEOUT_MS,
    );
    if (tpl.kind === "fail") {
      return { ok: false, miss: false, reason: tpl.reason };
    }
    if (tpl.kind === "hit") {
      console.info(
        `[field-survival] map_visual 模板读取结果: ${
          tpl.value.format === "tbg"
            ? `tbg 包（data ${(tpl.value.data?.length || 0)}B）`
            : tpl.value.files
              ? `files 结构（${Object.keys(tpl.value.files).length} entries）`
              : "未知形态"
        }`,
      );
      // 本地解包是纯 CPU 操作、无瞬时故障一说：解包失败 = 数据形态不可用，按 miss 处理
      let nb: StoryMapBundle | null = null;
      try {
        nb = await normalizeBundle(tpl.value);
      } catch (e: any) {
        return { ok: false, miss: true, reason: `模板解包异常: ${String(e?.message || e)}` };
      }
      if (nb && Object.keys(nb.files).length > 0) return { ok: true, nb };
      // 命中但解不出可用包（形态未知 / 解包为空）→ 确诊 miss，继续走会话兜底
    } else {
      console.info(`[field-survival] map_visual 模板读取结果: null（模板不存在）`);
    }
    // ── 退路①：模板读不到 → 读 entry 注入的本会话 map_visual ──
    console.info(`[field-survival] 模板未命中，退路读本会话 map_visual（entry.ensureStoryVisualMap 注入）`);
    const sv = await probePluginData(
      () => (toonflowJsApi as any)?.pluginData?.get?.("map_visual") ?? Promise.resolve(null),
      "会话 map_visual",
      MAP_READ_TIMEOUT_MS,
    );
    if (sv.kind === "fail") {
      return { ok: false, miss: false, reason: sv.reason };
    }
    if (sv.kind === "hit") {
      console.info(
        `[field-survival] 会话 map_visual 读取结果: ${
          sv.value.format === "tbg" ? "tbg 包" : sv.value.files ? "files 结构" : "未知形态"
        }`,
      );
      let nb2: StoryMapBundle | null = null;
      try {
        nb2 = await normalizeBundle(sv.value);
      } catch (e: any) {
        return { ok: false, miss: true, reason: `会话包解包异常: ${String(e?.message || e)}` };
      }
      if (nb2 && Object.keys(nb2.files).length > 0) return { ok: true, nb: nb2 };
      return { ok: false, miss: true, reason: "会话 map_visual 解包为空 / 形态未知" };
    }
    console.info(`[field-survival] 会话 map_visual 读取结果: null（本会话未注入）`);
    return { ok: false, miss: true, reason: "模板与会话 map_visual 均不存在（未上传过故事视觉包）" };
  };

  // force（进入 playing 的强制重读）遇传输故障要退避重试；确诊 miss 立即回退默认图，
  // 不浪费「无视觉包」故事的开局时间
  const attempts = force ? 1 + MAP_READ_RETRY_TIMES : 1;
  let lastMiss = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = await tryReadOnce();
    if (r.ok) {
      bundle = r.nb;
      break;
    }
    lastMiss = r.miss;
    _fallbackReason = r.reason;
    if (r.miss || attempt >= attempts) break;
    console.info(
      `[field-survival] 地图包读取第 ${attempt}/${attempts} 次失败（传输故障），${MAP_READ_RETRY_DELAY_MS}ms 后重试…`,
    );
    await new Promise((resolve) => window.setTimeout(resolve, MAP_READ_RETRY_DELAY_MS));
  }

  if (bundle) {
    // 关键统计：关卡 JSON 数（maps/*.json）+ 资源 entries 总数（tileset/images/story.json 等）
    const mapKeys = Object.keys(bundle.mapFiles || {});
    const totalEntries = Object.keys(bundle.files).length;
    const imageCount = Object.keys(bundle.files).filter((k) => /^images\//i.test(k)).length;
    const hasTileset = !!bundle.tileset;
    const hasStory = !!bundle.story;
    _getOk = true;
    _fileNames = mapKeys;
    console.info(
      `[field-survival] 已加载故事视觉地图包 ${_dataKey}：关卡 ${mapKeys.length} 张（${mapKeys.join(", ")}）+ 全量 entries ${totalEntries}（images=${imageCount}, tileset=${hasTileset ? "✓" : "✗"}, story.json=${hasStory ? "✓" : "✗"}）${bundle.first ? " + first.map.json" : ""}`,
    );

    // 关卡名列表单独打一行（关卡数 <= 30 时全列；>30 截断样例；>200 进一步压缩）
    const _mapPaths = mapKeys.map((k) => `maps/${k}.json`);
    if (_mapPaths.length === 0) {
      console.info(`[field-survival] 地图json（maps/xxx.json） 文件名列表{ （无） }`);
    } else if (_mapPaths.length <= 30) {
      console.info(`[field-survival] 地图json（maps/xxx.json） 文件名列表{ ${_mapPaths.join(", ")} }`);
    } else if (_mapPaths.length <= 200) {
      const head = _mapPaths.slice(0, 10).join(", ");
      const tail = _mapPaths.slice(-5).join(", ");
      console.info(`[field-survival] 地图json（maps/xxx.json） 文件名列表{ ${head}, ...（${_mapPaths.length - 15} 个略）..., ${tail} }`);
    } else {
      console.info(`[field-survival] 地图json（maps/xxx.json） 文件名列表{ ${_mapPaths.length} 条疑似脏数据（首 5: ${_mapPaths.slice(0, 5).join(", ")}） }`);
    }
    // 只有真正拿到包才缓存「已加载」结论
    loaded = true;
  } else {
    // 失败两种结局要区分缓存策略：
    //  - 确诊 miss（数据确实不存在）：缓存「无包」结论，后续非 force 调用不再重复拉取；
    //  - 传输故障（超时/异常，数据可能存在）：不置 loaded，保持未加载态，
    //    切图 / 后续流程可自动重试——修复旧实现「一次超时 → loaded=true → 整局锁死默认图」。
    loaded = lastMiss;
    bundle = null;
  }
  // ── 调试总结：成功/失败 + 退路回默认 ──
  if (_getOk && bundle) {
    const totalEntries = Object.keys(bundle.files).length;
    console.info(`[field-survival] 故事集是否从数据库获取成功: ✅ 是（关卡 ${_fileNames.length} 张 + 全量 entries ${totalEntries}）`);
    console.info(`[field-survival] 故事集关卡名: ${_fileNames.join(", ")}${bundle.first ? " + first.map.json" : ""}`);
  } else {
    console.info(`[field-survival] 故事集是否从数据库获取成功: ❌ 否（${_fallbackReason}）`);
    console.info(`[field-survival] 故事集获取失败。退路回默认地图数据: ui/maps 目录 (first.map.json + 回退 storyMapBase())`);
  }
  return bundle;
}

/** 取缓存的地图包（同步，未加载返回 null） */
export function getStoryMapBundle(): StoryMapBundle | null {
  return bundle;
}

/** 取某张地图的原始 JSON（兼容三种形态：mapFiles[name] / files["maps/<name>.json"] / files[name] 旧形态） */
export function getStoryMapRaw(file: string): any | null {
  if (!bundle || !file) return null;
  if (bundle.mapFiles && bundle.mapFiles[file] != null) return bundle.mapFiles[file];
  if (bundle.files && bundle.files[`maps/${file}.json`] != null) return bundle.files[`maps/${file}.json`];
  if (bundle.files && bundle.files[file] != null) return bundle.files[file];
  return null;
}

/** 取 first.map.json 解析结果；无则 null */
export function getStoryFirstMap(): any | null {
  return bundle?.first ?? null;
}

/**
 * 取故事视觉地图包内的任意 entry（按 zip 内路径）。
 * 例：getStoryMapEntry("compiled_dawnlike.json") 取 tileset 属性表；
 *     getStoryMapEntry("images/compiled_tileset_32x32.png") 取 Uint8Array。
 * 切故事时 tileset/images/story.json 全部从这里取，与公共资源解耦。
 */
export function getStoryMapEntry(path: string): any | null {
  if (!bundle || !path) return null;
  // 兼容：去前导 /
  const p = String(path).replace(/^\/+/, "");
  if (bundle.files && bundle.files[p] != null) return bundle.files[p];
  return null;
}

/** 便利：取 tileset 属性表（compiled_dawnlike.json） */
export function getStoryTileset(): any | null {
  return bundle?.tileset ?? getStoryMapEntry("compiled_dawnlike.json");
}

/**
 * ★ 取故事视觉包内的图集（数据库 map_visual 里的 images/compiled_tileset_32x32.png）
 *   → 转成可绘制的 blob URL。
 *
 * 「安装插件后」的正式数据源就是数据库里这份包（CLI `-u` 打包上传）；
 * dev 模式不走这条（直接读 workshops 本地最新），public/ 只是兜底。
 *
 * @returns blob URL；包内无图集时返回 null（调用方保留当前图集）。
 */
export function getStoryTilesetObjectUrl(): string | null {
  const entry = getStoryMapEntry("images/compiled_tileset_32x32.png");
  if (!entry) return null;
  try {
    // 包内 entry 可能是 Uint8Array / ArrayBuffer / base64 字符串 / Blob
    let blob: Blob | null = null;
    if (entry instanceof Uint8Array) {
      blob = new Blob([entry], { type: "image/png" });
    } else if (entry instanceof ArrayBuffer) {
      blob = new Blob([entry], { type: "image/png" });
    } else if (entry instanceof Blob) {
      blob = entry;
    } else if (typeof entry === "string") {
      // base64（可能带 data: 前缀）
      const b64 = entry.includes(",") ? entry.slice(entry.indexOf(",") + 1) : entry;
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      blob = new Blob([u8], { type: "image/png" });
    }
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn("[field-survival] 包内图集转 blob 失败:", e);
    return null;
  }
}

/** 便利：取 story.json */
export function getStoryMeta(): any | null {
  return bundle?.story ?? getStoryMapEntry("story.json");
}

/** 便利：取 entity_types.json */
export function getStoryEntityTypes(): any | null {
  return bundle?.entityTypes ?? getStoryMapEntry("entity_types.json");
}

/**
 * 取当前故事视觉包内的全部关卡名（mapFiles 的 key，裸名如 "mulberryTown"，不含 maps/ 和 .json）。
 * 用于地图面板 / 大地图节点：替代 mapConfig.ts 硬编码的 LEVEL_FILES。
 * 无 bundle（未加载 / 非 iframe / 故事无 map_visual）→ 返回 []。
 */
export function getStoryLevelNames(): string[] {
  console.info(`[field-survival] getStoryLevelNames: ${bundle.mapFiles ? Object.keys(bundle.mapFiles).length : 0} 张`);
  if (!bundle || !bundle.mapFiles) return [];
  return Object.keys(bundle.mapFiles);
}
