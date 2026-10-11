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
import type { Ctx, EventsFile, EventDef } from "../../../../../workshops/toonflow-field-survival/map_design/通天传授-收徒系统/events/shared/_ctx";

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

// ─── 事件加载 ───
// ★ 事件文件与地图同源加载：fetch events/maps/<mapFile>.events.json
//   - dev（vite dev server）：走 /story-data/ 中间件（vite.config.ts:storyDataPlugin）读 workshops 真实文件
//   - dev-host / 生产：地图集打包时 events/ 与 maps/ 同目录部署（同一条 assetUrl 链）
//   - fetch 全部失败 → 本图无事件，静默返回
const EVENTS_BASES = [
  "/story-data/toonflow-field-survival/map_design/通天传授-收徒系统/events/maps/",
  "events/maps/",
  "./events/maps/",
];

export async function loadMapEvents(mapFile: string): Promise<void> {
  loadedEvents.value = null;
  firedIds.value = new Set();
  for (const base of EVENTS_BASES) {
    try {
      const r = await fetch(base + `${mapFile}.events.json`);
      if (!r.ok) continue;
      const data = await r.json() as EventsFile;
      if (data.version !== 1 || !Array.isArray(data.events)) continue;
      loadedEvents.value = data;
      console.info("[eventEngine] 已加载事件:", mapFile, data.events.length, "条 (from", base.slice(0, 30) + ")");
      return;
    } catch { /* try next base */ }
  }
}

// ─── 脚本执行 ───
// ★ 脚本文件在构建期内联（vue/src/eventScripts/，与 workshops/events/scripts 同步维护——
//   校验脚本 validate_events.mjs 检查两边一致）。import.meta.glob 限定在 src/ 内，Vite 正常编译。
const scriptModules = import.meta.glob("./eventScripts/*.ts", { eager: false });

async function runScript(name: string): Promise<void> {
  const key = Object.keys(scriptModules).find(k => k.endsWith(`/${name}.ts`));
  if (!key) {
    console.warn("[eventEngine] run_script 找不到脚本:", name);
    return;
  }
  const mod = await scriptModules[key]() as { default: (ctx: Ctx) => Promise<void> };
  const ctx = makeCtx();
  await mod.default(ctx);
}

// ─── ctx 构造（_ctx.ts 接口的运行时实现） ───
function makeCtx(): Ctx {
  return {
    player: (hooks?.player() || { id: "player", name: "陆川", side: "player" as const, x: 0, y: 0, hp: 1, maxHp: 1 }) as Ctx["player"],
    mapName: hooks?.currentMapFile() || "",
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
async function runActions(ev: EventDef): Promise<void> {
  for (const a of ev.actions || []) {
    switch (a.type) {
      case "set_flag":
        await makeCtx().save.setFlag(a.key, a.value);
        break;
      case "del_flag":
        await makeCtx().save.delFlag(a.key);
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
        await runScript(a.script);
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
    }
  }
}

// ─── 事件触发入口 ───
async function fireEvent(ev: EventDef): Promise<void> {
  if (firedIds.value.has(ev.id)) return; // 防重入
  firedIds.value.add(ev.id);
  try {
    if (await checkConditions(ev)) {
      console.info("[eventEngine] 触发事件:", ev.id);
      await runActions(ev);
    }
  } catch (e) {
    console.error("[eventEngine] 事件执行异常:", ev.id, e);
  } finally {
    // 条件不满足时允许下次再判（如 flag 在别处被改）——这里选择"一次机会"策略，
    // 与"判定通过"型事件语义一致；连续触发型事件（area_enter 反复进）v0.2 再加
  }
}

// ─── 公开钩子（App.vue 调用） ───

/** 初始化（App.vue onMounted 时调一次） */
export function initEventEngine(h: EventHooks): void {
  hooks = h;
}

/** 切图后调用：加载新图事件 + 触发 enter_map */
export async function onMapEntered(mapFile: string): Promise<void> {
  await loadMapEvents(mapFile);
  const evs = loadedEvents.value?.events || [];
  for (const ev of evs) {
    if (ev.trigger.type === "enter_map") void fireEvent(ev);
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