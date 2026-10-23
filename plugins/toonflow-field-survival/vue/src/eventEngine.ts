/**
 * eventEngine.ts —— 事件系统运行时（前端侧）
 * ============================================
 * 职责：
 *   1. 加载当前地图的 events/maps/<mapFile>.events.json
 *   2. 把 trigger 绑定到游戏钩子（enter_map / interact / portal 等）
 *   3. 条件判定（读玩家 flag）+ 动作执行（写 flag / UI 反馈 / 传送）
 *   4. run_script → 动态 import events/scripts/<name>.ts 的 default 导出
 *
 * flag 存储：走 toonflowJsApi.pluginData（t_plugin_session_data，key=player_flags）
 *   - 与 entry.ts 的 persistSys / sys_state 同库不同 key，互不干扰
 *
 * 本模块与 UI 解耦：App.vue 传入 hooks 对象，事件引擎通过 hooks 与游戏交互。
 */
import { ref } from "vue";
import { assetUrl } from "./assets";
import type { Ctx, EventsFile, EventDef } from "../../../../../workshops/toonflow-field-survival/map_design//events/shared/_ctx";

// ─── 运行时状态 ───
const loadedEvents = ref<EventsFile | null>(null);
const firedIds = ref<Set<string>>(new Set()); // 本次会话已 fire 过的事件（防重入）
let hooks: EventHooks | null = null;

/** App.vue 注入的游戏钩子 */
export interface EventHooks {
  /** 当前地图文件名（不含 .json），如 "mulberryTown" */
  currentMapFile(): string;
  /** 玩家实体（没有则 null） */
  player(): { id: string; x: number; y: number } | null;
  /** 实体按 Tiled object id 查（NPC/物件） */
  entityByTiledId(tiledId: string): { id: string; x: number; y: number; name?: string } | null;
  /** 右下角飘字 */
  toast(text: string, color?: string): void;
  /** 顶部字幕 */
  subtitle(text: string, durationMs?: number): void;
  /** HUD 事件流 */
  eventLog(text: string): void;
  /** 传送（走已有 teleportTarget 通道） */
  teleport(mapName: string, x: number, y: number): void;
  /** 确认对话框（采集/交互确认）：resolve(true)=确定 */
  confirm(opts: { title: string; detail?: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
  /** 发放物品到玩家背包（走 sys_item_add 通道，mock/真实宿主都能落账） */
  giveItem(name: string, count?: number): void;
  /** 发放物品到指定 AI 角色的私藏（entity._aiBag，走 ai_bag_add 通道）
   *  玩家自己的背包是参数卡派生的（entry.ts buildItems），AI 产出不能污染它：
   *  否则所有 AI 的采集都掉进玩家腰包，而 sensor 的 inventoryFull 判的是 _aiBag。 */
  giveItemToAi(roleId: string, name: string, count?: number): void;
  /** pluginData 读写（t_plugin_session_data） */
  pluginData: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
}

// ─── flag 缓存（会话内） ───
const FLAG_KEY = "player_flags";
let flagCache: Record<string, unknown> | null = null;
let flagDirty = false;

async function loadFlags(): Promise<Record<string, unknown>> {
  if (flagCache) return flagCache;
  try {
    const raw = await hooks?.pluginData.get(FLAG_KEY);
    flagCache = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    flagCache = {};
  }
  return flagCache;
}

async function saveFlags(): Promise<void> {
  if (!flagCache || !hooks) return;
  await hooks.pluginData.set(FLAG_KEY, flagCache);
  flagDirty = false;
}

/** ★ 清空会话内 flag 缓存（不落库）。
 *  为什么需要：flag 是「事件引擎（Vue 侧）」与「插件后端（entry.js）」共用的同一份
 *  t_plugin_session_data。后端在任务完成时也会写 flag（entry.ts setPlayerFlag），
 *  系统面板也会直接写 pluginData；这些写入绕过本模块缓存 → 判定会读到陈旧值。
 *  凡「可能已被外部改动」的时机（切图 / 重载事件 / 面板写 flag）都应先清缓存。 */
export function invalidateFlagCache(): void {
  flagCache = null;
}

/** ★ 强制重读 flag（返回最新值），供系统面板「重载事件」等使用 */
export async function reloadFlags(): Promise<Record<string, unknown>> {
  flagCache = null;
  return await loadFlags();
}

/** ★ 走事件引擎自身通道写 flag：保证缓存与库一致（避免外部直写造成的不一致） */
export async function setEventFlag(key: string, value: unknown): Promise<void> {
  await makeCtx().save.setFlag(key, value);
}

/** ★ 走事件引擎自身通道删 flag */
export async function delEventFlag(key: string): Promise<void> {
  await makeCtx().save.delFlag(key);
}

// ─── 事件加载 ───
// ★ 事件文件与地图同源加载：fetch events/maps/<mapFile>.events.json
//   - dev（vite dev server）：走 /story-data/ 中间件（vite.config.ts:storyDataPlugin）读 workshops 真实文件
//   - dev-host / 生产：走 assetUrl("events/maps/")（自动适配 getAsset + token 路径）
//   - fetch 全部失败 → 本图无事件，静默返回
import { STORY_EVENT_BASE_DEV } from "./mapConfig";

export async function loadMapEvents(mapFile: string): Promise<void> {
  loadedEvents.value = null;
  firedIds.value = new Set();
  // 每次调用时动态获取 assetUrl（确保 location.href 已设置）
  // ★ 修复 401 噪声：getAsset 环境（生产/真机 iframe）下 /story-data 中间件不存在且需鉴权→401，
  //   跳过该 dev 路径，直接用 assetUrl（getAsset+token）通道。
  // ★ 修复故事串号：dev 前缀必须与 mapConfig 的 STORY_MAP_BASE_DEV 用同一个故事名（?story=），
  //   否则进入「赦夜人第二季」时仍会读到「」下的 events 文件。
  const isGetAsset = (() => { try { return location.href.includes("getAsset"); } catch { return false; } })();
  const evBases = isGetAsset
    ? [assetUrl("events/maps/"), "events/maps/", "./events/maps/"]
    : [
        STORY_EVENT_BASE_DEV,
        assetUrl("events/maps/"),
        "events/maps/",
        "./events/maps/",
      ];
  for (const base of evBases) {
    try {
      const url = base + `${mapFile}.events.json`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json() as EventsFile;
      if (data.version !== 1 || !Array.isArray(data.events)) continue;
      loadedEvents.value = data;
      console.info("[eventEngine] 已加载事件:", mapFile, data.events.length, "条 (from", base.slice(0, 40) + ")");
      return;
    } catch (e) { console.warn("[eventEngine] fetch 失败:", base, e); /* try next base */ }
  }
  console.warn("[eventEngine] 未找到事件文件:", mapFile);
}

// ─── 脚本执行 ───
// ★ 脚本文件在构建期内联（vue/src/eventScripts/，与 workshops/events/scripts 同步维护——
//   校验脚本 validate_events.mjs 检查两边一致）。import.meta.glob 限定在 src/ 内，Vite 正常编译。
const scriptModules = import.meta.glob("./eventScripts/*.ts", { eager: false });

/** 执行者：roleId="" 表示玩家自己操作（默认）；非空表示 AI 托管角色触发。
 *  走 fireEvent → runActions → runScript 整条链透传，脚本据此决定
 *  confirm 是否弹窗、bag.give 进谁的背包。 */
export interface EventActor { roleId: string; name: string; }
const PLAYER_ACTOR: EventActor = { roleId: "", name: "player" };

async function runScript(name: string, actor: EventActor = PLAYER_ACTOR): Promise<void> {
  const key = Object.keys(scriptModules).find(k => k.endsWith(`/${name}.ts`));
  if (!key) {
    console.warn("[eventEngine] run_script 找不到脚本:", name);
    return;
  }
  const mod = await scriptModules[key]() as { default: (ctx: Ctx) => Promise<void> };
  const ctx = makeCtx(actor);
  await mod.default(ctx);
}

// ─── ctx 构造（_ctx.ts 接口的运行时实现） ───
function makeCtx(actor: EventActor = PLAYER_ACTOR): Ctx {
  const isAi = !!actor.roleId;
  return {
    player: (hooks?.player() || { id: "player", name: "陆川", side: "player" as const, x: 0, y: 0, hp: 1, maxHp: 1 }) as Ctx["player"],
    mapName: hooks?.currentMapFile() || "",
    actor: { roleId: actor.roleId, ai: isAi, name: actor.name || "player" },
    save: {
      getFlag: async <T,>(key: string): Promise<T | null> => {
        const f = await loadFlags();
        return (f[key] ?? null) as T | null;
      },
      setFlag: async (key: string, value: unknown): Promise<void> => {
        const f = await loadFlags();
        f[key] = value;
        await saveFlags();
      },
      delFlag: async (key: string): Promise<void> => {
        const f = await loadFlags();
        delete f[key];
        await saveFlags();
      },
      all: async (): Promise<Record<string, unknown>> => loadFlags(),
    },
    npc: {
      byUid: (uid: string) => (hooks?.entityByTiledId(uid) || null) as Ctx["npc"]["byUid"] extends (u: string) => infer R ? R : never,
      setLabel: () => { /* TODO: 头顶名运行时改写（v0.2） */ },
      move: () => { /* TODO: NPC 移动（v0.2） */ },
      faceTo: () => { /* TODO */ },
    },
    ui: {
      toast: (text: string, color?: string) => hooks?.toast(text, color),
      subtitle: (text: string, durationMs?: number) => hooks?.subtitle(text, durationMs),
      event: (text: string) => hooks?.eventLog(text),
      confirm: (opts: { title: string; detail?: string; confirmText?: string; cancelText?: string }) => {
        // ★ AI 托管采集：脚本问「是否就地采药？」是对玩家说的，不是对 AI 说的。
        //   真弹窗会让 AI 的采集 Promise 永远悬着（玩家不理就不 resolve），
        //   且已有弹窗时 evConfirmOpen 直接 return false → 本次采集空手而归。
        //   故 AI 执行者一律自动同意，只留一条事件日志。
        if (isAi) {
          hooks?.eventLog(`${actor.name} ${opts.title || "交互"}：自动确认`);
          return Promise.resolve(true);
        }
        return hooks?.confirm(opts) ?? Promise.resolve(false);
      },
    },
    bag: {
      // ★ 分流：AI 的产出进 _aiBag（不污染玩家参数卡派生的背包），玩家自己的照旧
      give: (name: string, count?: number) => {
        if (isAi) hooks?.giveItemToAi(actor.roleId, name, count);
        else hooks?.giveItem(name, count);
      },
    },
    level: {
      switchTo: (mapFile: string, x: number, y: number) => hooks?.teleport(mapFile, x, y),
      setLocked: (mapFile: string, locked: boolean) => {
        // 写 flag map_locked_<map>，portal 触发时由 App.vue 检查
        void (async () => {
          const f = await loadFlags();
          f[`map_locked_${mapFile}`] = locked;
          await saveFlags();
        })();
      },
    },
    audio: { play: () => { /* no-op（v0.2 接音频通道） */ } },
    llm: {
      speak: async (npcId: string, npcName: string, userText: string): Promise<string> => {
        // 走 sys_chat 通道（App.vue 的 chatResultWaiters 机制）—— v0.2 接入
        console.warn("[eventEngine] llm.speak 占位调用:", npcName, userText);
        return "";
      },
    },
    registerAction: () => { /* v0.2: 自定义动作注册表 */ },
  };
}

// ─── 条件判定 ───
async function checkConditions(ev: EventDef): Promise<boolean> {
  const flags = await loadFlags();
  for (const c of ev.conditions || []) {
    if (c.type === "flag_check") {
      const cur = flags[c.key];
      const op = c.op || (c.value !== undefined ? "eq" : "exists");
      if (op === "eq" && cur !== c.value) return false;
      if (op === "ne" && cur === c.value) return false;
      if (op === "exists" && cur === undefined) return false;
      if (op === "missing" && cur !== undefined) return false;
    }
    // phase_done / level_gte / random → v0.2
  }
  return true;
}

// ─── 动作执行 ───
async function runActions(ev: EventDef, actor: EventActor = PLAYER_ACTOR): Promise<void> {
  for (const a of ev.actions || []) {
    switch (a.type) {
      case "set_flag":
        await makeCtx(actor).save.setFlag(a.key, a.value);
        break;
      case "del_flag":
        await makeCtx(actor).save.delFlag(a.key);
        break;
      case "toast":
        hooks?.toast(a.text, a.color);
        break;
      case "subtitle":
        hooks?.subtitle(a.text, a.duration);
        break;
      case "event_log":
        hooks?.eventLog(a.text);
        break;
      case "teleport":
        hooks?.teleport(a.map, a.x, a.y);
        break;
      case "run_script":
        await runScript(a.script, actor);
        break;
      case "call_action":
        console.warn("[eventEngine] call_action v0.2 未实现:", a.name);
        break;
      case "llm_speak":
        await makeCtx().llm.speak(a.npcId, a.npcName, a.userText);
        break;
      case "wait":
        await new Promise(r => setTimeout(r, a.ms));
        break;
      // ★ v6 AI 托管：唤醒托管角色的大脑（地图集可以精确地在剧情节点上"戳"一下 AI）
      case "ai_trigger":
        await runAITrigger(a);
        break;
      // ★ v6 AI 托管：覆盖本图的 AI 决策间隔（地图集"个性自己的定时器"）
      case "ai_interval":
        await runAIInterval(a);
        break;
    }
  }
}

/* ============================================================
   ★ v6：AI 托管相关的两个新动作
   ------------------------------------------------------------
   设计文档：md/curr_design/.../ai托管/ai托管.agent.触发频率.md §1.3 / §4.1
   ============================================================ */

/** ai_interval 覆盖值（模块级：切图时清空，由 ai/mapInterval.ts 读取） */
let aiIntervalOverride: {
  engaged?: number; skirmish?: number; idle?: number; all?: number;
} | null = null;

/** ai_trigger 实现：向托管角色派发 AI 事件 */
async function runAITrigger(a: {
  priority?: "P0" | "P1" | "P2";
  reason?: string;
  /** 可选：只唤醒指定角色（"ally:萧肿" / 角色 id）；缺省 = 所有托管角色 */
  target?: string;
}): Promise<void> {
  const priority = a.priority || "P2";
  const reason = a.reason || "地图集触发";
  try {
    const { broadcastAIEvent } = await import("./ai");
    broadcastAIEvent(priority, reason, a.target);
  } catch (e) {
    console.warn("[eventEngine] ai_trigger 执行失败:", e);
  }
}

/** ai_interval 实现：设置本图 AI 间隔覆盖 */
async function runAIInterval(a: {
  engaged?: number; skirmish?: number; idle?: number; all?: number;
}): Promise<void> {
  aiIntervalOverride = { ...(aiIntervalOverride || {}), ...a };
  try {
    const { setMapIntervalOverride } = await import("./ai/mapInterval");
    setMapIntervalOverride(aiIntervalOverride);
    console.info("[eventEngine] ai_interval 覆盖已生效:", aiIntervalOverride);
  } catch (e) {
    console.warn("[eventEngine] ai_interval 设置失败:", e);
  }
}

/** 读取当前生效的 interval 覆盖（ai/mapInterval.ts 反向读取，避免循环依赖） */
export function getAIIntervalOverride(): {
  engaged?: number; skirmish?: number; idle?: number; all?: number;
} | null {
  return aiIntervalOverride;
}

// ─── 事件触发入口 ───
// repeat 事件（采集类 area_enter）：不进 firedIds 防重入，但加冷却（ms）防连点
const repeatCooldown = new Map<string, number>();
async function fireEvent(ev: EventDef, actor: EventActor = PLAYER_ACTOR): Promise<void> {
  // ★ v6：interval 事件按「重复事件」处理 —— 不占 firedIds（每次都要能 fire），
  //   冷却由 tickIntervalEvents 自己做（这里不再叠加 repeatCooldown，避免双重延迟）
  const isInterval = (ev.trigger as any)?.type === "interval";
  if (isInterval) {
    // 交给 tickIntervalEvents 的冷却控制，fireEvent 不做额外拦截
  } else if (ev.repeat) {
    const cd = repeatCooldown.get(ev.id) || 0;
    if (Date.now() < cd) return;
    repeatCooldown.set(ev.id, Date.now() + 3000);
  } else {
    if (firedIds.value.has(ev.id)) return; // 防重入
    firedIds.value.add(ev.id);
  }
  try {
    if (await checkConditions(ev)) {
      console.info("[eventEngine] 触发事件:", ev.id);
      await runActions(ev, actor);
    }
  } catch (e) {
    console.error("[eventEngine] 事件执行异常:", ev.id, e);
  } finally {
    // repeat 事件不占 firedIds；普通事件保持"一次机会"策略（条件不满足时允许下次再判）
  }
}

/** ★ 调试/UI 用：读取当前已加载的事件定义（供 EventPanel 显示） */
export function getLoadedEvents(): EventDef[] {
  return loadedEvents.value?.events || [];
}

/** ★ v6：读取当前已加载的完整事件文件（含顶层 ai 配置，供 mapInterval 读地图级覆盖） */
export function getLoadedEventsFile(): EventsFile | null {
  return loadedEvents.value;
}

/** ★ 调试/UI 用：读取当前已设置的 eventZones（供 EventPanel 显示区域） */
export function getEventZones(): EventZone[] {
  return evZones || [];
}

/** ★ 调试/UI 用：读取已 fire 的 repeat 事件次数 */
export function getRepeatHits(): Record<string, number> {
  const out: Record<string, number> = {};
  // 简化：当前用 Map 计数 1（fire 一次计一次）。用「冷却剩余是否>0」判断 fire 过
  // 真实计数需要 Map<id, count>，下面我们改个最小入侵版本
  for (const id of repeatCooldown.keys()) out[id] = (out[id] || 0) + 1;
  return out;
}

/** ★ 调试/UI 用：手动 fire 某事件（绕过触发器直接调 runActions） */
export async function fireEventManually(evId: string, actor: EventActor = PLAYER_ACTOR): Promise<boolean> {
  const ev = (loadedEvents.value?.events || []).find(e => e.id === evId);
  if (!ev) return false;
  // 临时清掉 firedIds / 冷却，让 runActions 跑一次
  const wasInFired = firedIds.value.has(ev.id);
  if (!ev.repeat) firedIds.value.delete(ev.id);
  repeatCooldown.delete(ev.id);
  // 直接复用 fireEvent 内部逻辑
  try { await fireEvent(ev, actor); } catch (e) { console.warn("[eventEngine] manual fire error", e); }
  return true;
}

// ─── 公开钩子（App.vue 调用） ───

/** 初始化（App.vue onMounted 时调一次） */
export function initEventEngine(h: EventHooks): void {
  hooks = h;
}

/** 切图后调用：加载新图事件 + 触发 enter_map */
export async function onMapEntered(mapFile: string): Promise<void> {
  // ★ 切图是「后端进度 flag 可能已变」的天然同步点：先清缓存，
  //   保证本次 enter_map 判定（如 q06_done → E09_q06_scouted）读到最新 flags。
  invalidateFlagCache();
  await loadMapEvents(mapFile);
  const evs = loadedEvents.value?.events || [];
  for (const ev of evs) {
    if (ev.trigger.type === "enter_map") void fireEvent(ev);
  }
  // ★ v6：重建 interval 定时器（新图可能有新的 interval 事件）+ 清空覆盖
  resetIntervalTimers(evs);
  aiIntervalOverride = null;
  try {
    const { clearMapIntervalOverride } = await import("./ai/mapInterval");
    clearMapIntervalOverride();
  } catch { /* mapInterval 不可用时忽略 */ }
}

/* ============================================================
   ★ v6：interval 定时器触发器
   ------------------------------------------------------------
   「地图集可以个性自己的定时器」的落点。现状三种触发器全是离散事件
   （enter_map / interact / area_enter），而 AI 托管需要的是「每隔一段时间
   想一下」—— 之前没有任何接口能满足这个诉求。

   约束（防止成为成本黑洞）：
     1. 必须配 ai_trigger 或 UI 动作；纯 interval+set_flag 是合法倒计时
     2. 不进 firedIds（和采集类 area_enter 一样可重复 fire），但加冷却防连点
     3. everyMs 有硬下界（2000ms），一张图写 500 会被钳制并打警告
   ============================================================ */

/** interval 事件 id → 下次触发时刻 */
const intervalTimers = new Map<string, number>();
/** interval 事件 id → 上次触发时刻（冷却用） */
const lastIntervalFire = new Map<string, number>();
/** interval 最小冷却（ms） */
const INTERVAL_MIN_COOLDOWN_MS = 1000;
/** everyMs 硬下界（ms）—— 低于此值 LLM 决策会堆积而非变快 */
const INTERVAL_EVERY_MS_FLOOR = 2000;
/** 单图 interval 事件数量上限 */
const INTERVAL_EVENTS_PER_MAP_MAX = 3;

/** 切图时重建 interval 定时器 + 校验事件数量/everyMs 合法性 */
function resetIntervalTimers(events: EventDef[]): void {
  intervalTimers.clear();
  lastIntervalFire.clear();
  const now = Date.now();
  const list = events.filter((ev) => (ev.trigger as any)?.type === "interval");
  if (list.length > INTERVAL_EVENTS_PER_MAP_MAX) {
    console.warn(
      `[eventEngine] 本图有 ${list.length} 个 interval 事件，超过上限 ${INTERVAL_EVENTS_PER_MAP_MAX}；` +
      `只有前 ${INTERVAL_EVENTS_PER_MAP_MAX} 个会生效（其余被忽略以控成本）`,
    );
  }
  for (const ev of list.slice(0, INTERVAL_EVENTS_PER_MAP_MAX)) {
    const t = ev.trigger as { type: "interval"; everyMs: number };
    const every = Number(t.everyMs);
    if (!Number.isFinite(every) || every < INTERVAL_EVERY_MS_FLOOR) {
      console.warn(
        `[eventEngine] ${ev.id}: everyMs=${t.everyMs} 低于硬下界 ${INTERVAL_EVERY_MS_FLOOR}ms，已钳制`,
      );
    }
    const effective = Math.max(INTERVAL_EVERY_MS_FLOOR, every || INTERVAL_EVERY_MS_FLOOR);
    intervalTimers.set(ev.id, now + effective);
  }
}

/** 当前玩家战斗等级（由 App.vue 每 tick 通过 setPlayerCombatLevel 同步） */
let currentCombatLevel: "none" | "skirmish" | "engaged" = "none";

/** App.vue 每 tick 同步玩家战斗等级（interval 的 when 条件判据） */
export function setPlayerCombatLevel(level: "none" | "skirmish" | "engaged"): void {
  currentCombatLevel = level;
}

/**
 * ★ v6：每 tick 调用，检查 interval 事件是否到期。
 * App.vue 的 tick 循环里与 tickZones 同级调用。
 */
export function tickIntervalEvents(): void {
  if (!intervalTimers.size) return;
  const evs = loadedEvents.value?.events || [];
  const now = Date.now();
  for (const ev of evs) {
    const t = ev.trigger as { type?: string; everyMs?: number; when?: string } | undefined;
    if (t?.type !== "interval") continue;
    if ((intervalTimers.get(ev.id) || 0) > now) continue;

    // when 条件判定
    if (t.when === "combat" && currentCombatLevel === "none") {
      intervalTimers.set(ev.id, now + Math.max(INTERVAL_EVERY_MS_FLOOR, t.everyMs || 0));
      continue;
    }
    if (t.when === "idle" && currentCombatLevel !== "none") {
      intervalTimers.set(ev.id, now + Math.max(INTERVAL_EVERY_MS_FLOOR, t.everyMs || 0));
      continue;
    }

    // 冷却防连点
    const last = lastIntervalFire.get(ev.id) || 0;
    const every = Math.max(INTERVAL_EVERY_MS_FLOOR, t.everyMs || 0);
    intervalTimers.set(ev.id, now + every);
    if (now - last < INTERVAL_MIN_COOLDOWN_MS) continue;
    lastIntervalFire.set(ev.id, now);

    void fireEvent(ev);
  }
}

/** NPC/物件交互时调用（uid = Tiled object id） */
export async function onInteract(tiledId: string): Promise<void> {
  const evs = loadedEvents.value?.events || [];
  for (const ev of evs) {
    if (ev.trigger.type === "interact" && String(ev.trigger.uid) === String(tiledId)) {
      await fireEvent(ev);
    }
  }
}

/** 进区域时调用（zone = 区域名） */
export async function onAreaEnter(zone: string): Promise<void> {
  const evs = loadedEvents.value?.events || [];
  for (const ev of evs) {
    if (ev.trigger.type === "area_enter" && ev.trigger.zone === zone) {
      await fireEvent(ev);
    }
  }
}

// ─── 区域进出检测（基于地图 JSON 顶层 eventZones，每 tick 由 App.vue 驱动） ───
export interface EventZone { name: string; x: number; y: number; r?: number; rx?: number; ry?: number }
let evZones: EventZone[] = [];
let currentZones = new Set<string>();

/** 切图时注入本图 eventZones（App.vue 从地图 JSON 读） */
export function setEventZones(zones: EventZone[]): void {
  evZones = zones || [];
  currentZones = new Set();
}

/** 每 tick 调用：玩家坐标 → 检测区域进出（进入触发 onAreaEnter） */
export async function tickZones(px: number, py: number): Promise<void> {
  const now = new Set<string>();
  for (const z of evZones) {
    const inside = (z.rx !== undefined && z.ry !== undefined)
      ? px >= z.x - z.rx && px <= z.x + z.rx && py >= z.y - z.ry && py <= z.y + z.ry
      : Math.hypot(z.x - px, z.y - py) <= (z.r ?? 5);
    if (inside) now.add(z.name);
  }
  // 新进入的区域 → 触发
  for (const name of now) {
    if (!currentZones.has(name)) await onAreaEnter(name);
  }
  currentZones = now;
}

/** 该 Tiled object id 是否挂着 interact 事件（App.vue 判断"事件接管 vs 弹聊天"用） */
export function eventUidsHas(tiledId: string): boolean {
  const evs = loadedEvents.value?.events || [];
  return evs.some(ev => ev.trigger.type === "interact" && String(ev.trigger.uid) === String(tiledId));
}