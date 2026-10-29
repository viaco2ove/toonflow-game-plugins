/**
 * 野外生存插件 — 入口文件（2.5D 动作生存）
 *
 * 后端通过 PluginExecutor 动态 import 本模块，调用
 *   handle_action(action, params, state, context)
 *
 * 动作：
 *   init    -> 返回选人阶段状态（roles / playerCard 由后端注入 ctx）
 *   start   -> params { participants, spectators, enemies } 开局
 *   tick    -> params { input:{ dx, dy, moveTo, attack } } 实时推进一帧
 *   skill   -> params { index } 释放技能（取用户参数卡技能）
 *   item    -> params { index } 使用物品格
 *   page    -> params { kind: "skill"|"item", delta } 翻页
 *   sys     -> 打开系统面板（上报关卡列表 / 当前地图，初始化商城）
 *   sys_sell / sys_use_item / sys_sort / sys_ring_move
 *           -> 背包卖出 / 使用 / 排序 / 纳戒存取（与用户动态参数卡同步）
 *   sys_shop_refresh / sys_shop_buy -> 商城刷新 / 购买（消耗货币）
 *   sys_party / sys_teleport / sys_travel -> 组队跟随 / 传送角色 / 大地图传送
 *   sys_chat -> 对话功能：调用角色发言器 agent，台词同步到 Toonflow-game-web 聊天框
 *   exit    -> 主动退出，产出 result（奖励汇总）
 */

/** ★ 插件自带 agent 提示词（2026-10-20：宿主 src/agents/plugins.prompts.ts 已删除，
 *  插件自己的 agent 提示词写在插件里，不污染宿主）。编译走 esbuild --bundle 模式，
 *  这些 import 会被内联进单文件 entry.js，不产生运行时外部依赖。 */
import {
  PROMPT_FIELD_SURVIVAL_AI_BRAIN,
  PROMPT_FIELD_SURVIVAL_ALCHEMY_PILL,
  PROMPT_FIELD_SURVIVAL_FORGE_ITEM,
  PROMPT_FIELD_SURVIVAL_ITEM_UPGRADE,
  PROMPT_FIELD_SURVIVAL_MAP_GENER,
  PROMPT_FIELD_SURVIVAL_QUEST_GENER,
  PROMPT_FIELD_SURVIVAL_SHOP_GENER,
  PROMPT_FIELD_SURVIVAL_SPRITE_GENER,
  getAgentSystemPrompt,
} from "./src/agents/plugins.prompts";

interface PluginGameContext {
  pluginId: string;
  pluginDir: string;
  manifest: any;
  userId?: number;
  sessionId?: string;
  roles?: Array<Record<string, unknown>>;
  playerCard?: Record<string, unknown>;
  /** ★ v6：当前世界身份（故事绑定视觉地图模板；tick.ts / MiniGameController 注入） */
  worldId?: number;
  worldName?: string;
  /** 后端插件 API（toonflowTsApi）：pluginData（t_plugin_session_data）+ agent */
  tsApi?: {
    pluginData: {
      get(dataKey: string): Promise<any>;
      /** ★ v6：读 sessionId="all" 的故事模板（CLI -u 按 story 播种）；旧后端无此方法时不可用 */
      getTemplate?(dataKey: string): Promise<any>;
      set(dataKey: string, value: unknown): Promise<void>;
      list(): Promise<string[]>;
      remove(dataKey: string): Promise<void>;
    };
    agent: {
      run(
        agentName: string,
        input: Record<string, unknown>
      ): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }>;
    };
  };
}

/* ============================================================
   地图 / 比例尺 / 土块 / Chunk 常量（对齐 25d_ai_game 风格）
   ============================================================

   25d_ai_game (Godot 3D) 的关键参数：
     ground_size = 300.0 (m), ground_height = 5.0 (m)
     block_size  = 0.5 (m, 0.5m 立方体)
     chunk_size  = 32 blocks = 16 m/chunk

   toonflow-field-survival 改造后：
     ground_size = 3000 (m)              ← 整体可玩区扩 10×
     ground_height= 100 (m)（暂未对顶视图生效，预留挖地）
     block_size  = 0.5 (m)               ← 单方块
     chunk_size  = 32 blocks = 16 m/chunk
     scale_meter = 1.0 (默认 1 米 = 1 单位)

   内部坐标系：
     WORLD = {w: 3000, h: 3000} 单位：米。
     所有角色 / 装饰物 / 宝箱 / 血瓶 / 怪物的 x/y 现在都是「米」。
     前端 canvas 通过 scale_meter * zoom 把米 → 屏幕像素绘制。
*/

const TERRAIN_BLOCK_SIZE_M = 0.5;       // 单个土块 0.5 m
const CHUNK_SIZE_BLOCKS = 32;            // 每个 chunk 32 块
const CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * TERRAIN_BLOCK_SIZE_M; // 16 m
const TERRAIN_GROUND_SIZE_M = 3000;      // 总地面 3000 m × 3000 m
const TERRAIN_GROUND_HEIGHT_M = 100;     // 地下 100 m（预留）
const TERRAIN_SCALE_METER = 1.0;         // 1 米 = 1 单位（与 chunk 16m 对齐）

/** map-gener agent 产出的地图数据（sanitize 后的结构） */
interface MapData {
  theme: string;
  narration: string;
  zones: Array<{ name: string; x: number; y: number; r: number; kind: string; desc: string }>;
  enemy_archetypes: Array<{
    id: string; name: string; lv: number; hp: number; atk: number; def: number;
    speed: number; bounty: { exp: number; money: number }; color: string;
  }>;
  chests: Array<{ x: number; y: number; tier: number; loot: { exp: number; money: number; item: string } }>;
  potions: Array<{ x: number; y: number; heal: number }>;
  waves: Array<{ archetype: string; count: number; interval: number }>;
  notes: string;
}

/** 保底地图（ctx.tsApi / agent 不可用时）——坐标全部以「米」为单位 */
function fallbackMap(): MapData {
  // 玩家出生 (1500, 1500) = 地图中心
  return {
    theme: "野外·清晨",
    narration: "薄雾笼罩着这片荒野，远处传来低沉的嘶吼。收拢心神，活下去。",
    zones: [
      { name: "营地", x: 1500, y: 1500, r: 200, kind: "safe",   desc: "相对开阔的临时营地" },
      { name: "荒地", x: 2100, y: 1900, r: 260, kind: "danger", desc: "视野开阔的危险荒地" },
      { name: "废墟", x:  800, y: 1000, r: 220, kind: "loot",   desc: "可能残留物资的废墟" },
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "荒野游荡者", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" },
    ],
    chests: [
      { x:  800, y: 1000, tier: 1, loot: { exp: 15, money: 12, item: "干粮"   } },
      { x: 2200, y:  900, tier: 2, loot: { exp: 20, money: 18, item: "急救包" } },
      { x: 1700, y: 2400, tier: 1, loot: { exp: 12, money:  9, item: "工具卷" } },
    ],
    potions: [
      { x:  600, y: 1800, heal: 40 },
      { x: 1900, y:  900, heal: 40 },
      { x: 2400, y: 2300, heal: 40 },
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: `fallback map（agent 不可用）- 世界 ${TERRAIN_GROUND_SIZE_M}m，块 ${TERRAIN_BLOCK_SIZE_M}m，chunk ${CHUNK_SIZE_M}m`,
  };
}

/** 从故事动态数据拼 storyDigest（喂给 map-gener agent） */
function buildStoryDigest(ctx?: PluginGameContext): string {
  const parts: string[] = [];
  const card = (ctx?.playerCard || {}) as Record<string, any>;
  const roles = Array.isArray(ctx?.roles) ? ctx!.roles! : [];
  const roleLines = roles.slice(0, 12).map((r) => {
    const rr = (r || {}) as Record<string, any>;
    const skills = Array.isArray(rr.skills) ? rr.skills.map(String).slice(0, 4).join("/") : "";
    return `- ${String(rr.name || rr.id || "?")}（${String(rr.roleType || "?")}）lv${Number(rr.level || 1)} hp${Number(rr.hp || 100)}${skills ? " 技能:" + skills : ""}`;
  });
  parts.push("[参战/候选角色]\n" + (roleLines.join("\n") || "（无）"));
  const playerName = String(card.name || "");
  const cardSkills = Array.isArray(card.skills) ? card.skills.map((s: any) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  const cardItems = Array.isArray(card.items) ? card.items.map((s: any) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  parts.push(
    `[用户参数卡]\n名称:${playerName || "（无名）"} lv${Number(card.level || 1)} hp${Number(card.hp || 100)} 金钱${Number(card.money || 0)} 经验${Number(card.exp || 0)}\n技能:${cardSkills.slice(0, 8).join("/") || "（无）"}\n物品:${cardItems.slice(0, 12).join("/") || "（无）"}`
  );
  return parts.join("\n\n");
}

/**
 * 生成/维护地图数据：
 *  1) ctx.tsApi 可用 → 调 field-survival-map-gener agent（故事动态数据 → 地图 JSON），
 *     结果 sanitize 后存 t_plugin_session_data.map_data；
 *  2) 不可用/失败 → 保底地图（也存 map_data，保证可玩）。
 * 地图数据不进 plugin_state（plugin_state 每帧全量写回，地图只在开局/维护时写）。
 */
/** ★ fix③：宿主 agent 超时上限——/plugin/tick(action=start) 不能被地图生成无限期挂住，
 *  超时即抛错走 fallback 分支，保证 web 端「开始游戏」一定有响应。 */
const MAP_AGENT_TIMEOUT_MS = 12000;

/** 给 Promise 加超时（宿主 agent 卡死时的兜底） */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p.finally(() => { if (timer) clearTimeout(timer as any); }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]);
}

async function ensureMapData(ctx?: PluginGameContext): Promise<MapData> {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  // ★ fix③：本会话已有可用地图 → 直接复用（start 立即返回，不再每次开局都等 LLM）
  try {
    const stored = await tsApi.pluginData.get("map_data");
    if (stored && Array.isArray((stored as any).enemy_archetypes) && (stored as any).enemy_archetypes.length) {
      return stored as MapData;
    }
  } catch { /* 读取失败 → 继续走生成 */ }
  try {
    const r = await withTimeout(
      tsApi.agent.run("field-survival-map-gener", {
        storyDigest: buildStoryDigest(ctx),
        systemPrompt: PROMPT_FIELD_SURVIVAL_MAP_GENER,
      }),
      MAP_AGENT_TIMEOUT_MS,
      `map agent 超时（>${MAP_AGENT_TIMEOUT_MS}ms）`,
    );
    const map = (r?.output || fallbackMap()) as MapData;
    if (!Array.isArray(map.enemy_archetypes) || !map.enemy_archetypes.length) {
      (map as any).enemy_archetypes = fallbackMap().enemy_archetypes;
    }
    await tsApi.pluginData.set("map_data", map);
    return map;
  } catch {
    const map = fallbackMap();
    try { await tsApi.pluginData.set("map_data", map); } catch { /* ignore */ }
    return map;
  }
}

/**
 * ★ v6 故事绑定视觉地图模板注入（2026-10-13）：
 *   插件原来把视觉 Tiled 世界（mulberryTown.json 等）安装时烘焙进 ui/maps/，
 *   所有故事/用户共用同一份。本函数把「按当前故事」纠正过来：
 *     1. 取 context.worldName（tick.ts / MiniGameController v6 注入的当前世界名）；
 *     2. 读模板 getTemplate("map_visual:<worldName>")（CLI -u 写在 sessionId="all"），
 *        回退旧 key "map_data:<worldName>"（用户历史上传的模板）；
 *     3. 原样写进本会话 map_visual → 前端 storyMap.loadStoryMapBundle 消费，
 *        loadLevelByName/loadMapConfig/loadStartLevelName 优先渲染这套世界；
 *     4. 本会话已有 map_visual（手动上传过 / 上次已注入）→ 跳过，绝不覆盖用户上传。
 *   无 worldName / 无模板 / 后端无 getTemplate → 静默跳过（回退 ui/maps，零回归）。
 */
async function ensureStoryVisualMap(context?: PluginGameContext, s?: FieldSurvivalState): Promise<any | null> {
  const D = (msg: string, extra?: any) =>
    console.log("[map-diag] " + msg, JSON.stringify(extra ?? {}));
  const who = {
    pluginId: (context as any)?.pluginId,
    userId: (context as any)?.userId,
    sessionId: (context as any)?.sessionId,
    worldId: (context as any)?.worldId,
    worldName: (context as any)?.worldName,
  };
  try {
    const worldName = str((context as any)?.worldName, "");
     console.log("[map-diag] enter ensureStoryVisualMap");
    D("enter ensureStoryVisualMap", who);
    if (!worldName) { D("SKIP: worldName 为空 → 走 ui/maps 通用回退", who); return null; }
    const api = (context as any)?.tsApi?.pluginData;
    if (!api || typeof api.get !== "function" || typeof api.set !== "function") {
      D("SKIP: tsApi.pluginData 不可用", who); return null;
    }
    if (typeof api.getTemplate !== "function") {
      console.log("[map-diag] SKIP: getTemplate 不存在（旧后端）");
      D("SKIP: getTemplate 不存在（旧后端）", who); return null;
    }
    let existing: any = null;
    let getErr = "";
    try {
      existing = await api.get("map_visual");
    } catch (e: any) { getErr = String(e?.message || e); }
    D("会话 map_visual 读取结果", {
      ...who,
      hit: !!(existing && (existing.files || existing.format === "tbg")),
      shape: existing ? (existing.format === "tbg" ? "tbg" : (existing.files ? "files" : "unknown")) : "null",
      fileNames: existing?.files ? Object.keys(existing.files).slice(0, 12) : undefined,
      err: getErr || undefined,
    });
    if (existing && (existing.files || existing.format === "tbg")) return existing;
    const keys = ["map_visual:" + worldName, "map_data:" + worldName];
    for (const k of keys) {
      let tpl: any = null;
      let err = "";
      try {
        tpl = await api.getTemplate(k);
      } catch (e: any) { err = String(e?.message || e); }
      D("故事模板查询 " + k, {
        ...who,
        hit: !!(tpl && (tpl.format === "tbg" || tpl.files)),
        format: tpl?.format,
        fileNames: tpl?.files ? Object.keys(tpl.files).slice(0, 12) : undefined,
        err: err || undefined,
      });
      if (tpl && (tpl.format === "tbg" || tpl.files)) {
        await api.set("map_visual", tpl);
        if (s) (s as any).mapVisualFrom = k;
        console.log("[field-survival] 故事视觉地图模板已注入会话 map_visual：" + k);
        D("INJECTED: 模板已写入本会话 map_visual", { ...who, from: k });
        return tpl;
      }
    }
    D("MISS: 所有候选模板均未命中 → 走 ui/maps 通用回退", who);
  } catch (e: any) { D("ERROR: " + String(e?.message || e), who); }
  return null;
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface Entity {
  id: string;
  name: string;
  /** 阵营：player=用户 / ally=友方角色 / enemy=敌对角色 / spectator=观战 */
  side: "player" | "ally" | "enemy" | "spectator";
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  level: number;
  /** ★ game.md 等级系统：蓝量（满蓝 = 100 + 等级*10 + 道具/技能加成） */
  mp?: number;
  maxMp?: number;
  /** ★ game.md 等级系统：当前经验 / 下级所需经验（= 当前等级*100），玩家实体上同步 */
  exp?: number;
  expToNext?: number;
  /** ★ game.md 等级系统：防御（1 + 等级*10 + 道具/技能加成） */
  def?: number;
  avatarPath?: string;
  /** ★ 自定义立绘：data:URL（角色面板→实体形象→AI生成/上传）。优先于 tileset 渲染 */
  customSprite?: { image: string; prompt?: string; refCount?: number; source?: "ai" | "upload"; createdAt?: number } | null;
  facing: number;
  cooldown: number;
  alive: boolean;
  /** 巢点/生成点（野怪 AI 归位用），宿主实体统一挂在字段上 */
  homeX?: number;
  homeY?: number;
}

/* ── ★ 任务板系统（spec：events/任务事件/任务板.事件.md + 任务参考.list.md）────────
   数据契约见 workshops/.../赦夜人冥夜走廊-第二季/events/任务事件/任务参考.list.md
   任务定义 questBoard 可由三种来源下发：
     · CLI 上传故事包 → pluginData["quest_defs"]
     · 宿主/事件脚本 → action sys_quest_pool
     · AI 生成      → action sys_quest_generate（task-speaker-agent）
   进度 s.quests 只在宿主侧权威，随 sys_state 持久化。
   ────────────────────────────────────────────────────────── */
export interface QuestObjective {
  kind: "kill" | "gather" | "arrive" | "talk" | "explore";
  /** kill=野怪名（包含匹配）/ gather=物品名 / talk·explore=NPC 名或 zone 名 */
  target?: string;
  count?: number;
  /** arrive/explore 的目标地图（前端关卡名） */
  map?: string;
  /** ★ 原始地图写法（quests.json 里的 slug，如 mulberryDungeon1）。
   *  map 会被 normQuestMap 归一成运行时显示名（"Mulberry Dungeon"），但前端 switchLevel /
   *  sys_travel 认的是关卡 key（slug）——跨图寻路必须用这个原始值，否则传送目标不存在。 */
  mapRaw?: string;
  x?: number;
  y?: number;
  radius?: number;
  /** true = 必须玩家点「到达/交付」按钮（护送·送达） */
  confirm?: boolean;
  uid?: string;
}
export interface QuestDef {
  id: string;
  title: string;
  type: "kill" | "gather" | "escort" | "deliver" | "explore" | "talk";
  giver?: string;
  map?: string;
  desc?: string;
  level?: number;
  objectives: QuestObjective[];
  reward?: { exp?: number; money?: number; items?: Array<{ name: string; count: number }> };
  repeat?: boolean;
  /** 限时（tick，1 tick = 100ms）；0/缺省 = 不限时 */
  timeLimitTicks?: number;
  turnInMap?: string;
  /** 护送/送达：接取时生成的跟随货物 */
  cargo?: { name?: string; hp?: number; gid?: number };
  /** 交付时从背包扣除的物品；缺省按 objectives 里 gather 目标同名扣 */
  consume?: Array<{ name: string; count: number }>;
  /** 完成时写的玩家 flag（供事件系统 flag_check 用） */
  flags?: { accept?: string; done?: string };
  /** AI 生成时的来源标记 */
  from?: string;
}
export interface QuestProgress {
  id: string;
  status: "active" | "done" | "turned" | "failed";
  kill?: Record<string, number>;
  gather?: Record<string, number>;
  arrived?: boolean;
  talked?: Record<string, number>;
  cargoId?: string;
  acceptedTick?: number;
  acceptedMap?: string;
  turnedTick?: number;
  /** 失败原因：timeout=限时超时；cargo=护送货物被打掉（缺省=货物） */
  failReason?: "timeout" | "cargo";
}

interface Chest { id: string; x: number; y: number; opened: boolean; tier?: number; loot?: Record<string, any>;
  /** ★ 击杀掉落宝箱的落地 tick：用于开启保护期（先让玩家看见宝箱，再允许走近开启） */
  bornTick?: number; }
interface Potion { id: string; x: number; y: number; heal: number; }
interface SkillSlot { name: string; power: number; cost: number; cd: number; cdLeft: number;
  type?: "atk" | "heal" | "buff"; range?: "melee" | "ranged"; lv?: number; buff_type?: string; effects_type?: string;
  /** ★ 快捷栏占位空格（补齐到 4 的整数倍用）：前端置灰、点击无效 */
  empty?: boolean; }
interface ItemSlot { name: string; count: number; heal: number; kind?: string;
  /** ★ 快捷栏占位空格（补齐到 4 的整数倍用）：前端置灰、点击无效 */
  empty?: boolean; }
/** ★ 实体形象图库条目（AI 生成 / 上传参考图后生成） */
interface SpriteEntry {
  /** 图库条目 id（sp_<tick>_<rand>） */
  id: string;
  /** 形象图：data:URL / http(s) URL / 站内绝对路径 */
  image: string;
  /** 生成提示词（上传来源为空串） */
  prompt: string;
  /** 参考图张数（仅记录数量，不存大图） */
  refCount?: number;
  /** 来源：ai=agent 生成；upload=直接上传采用 */
  source: "ai" | "upload";
  createdAt: number;
  /** 背景分离结果（仅 ai）：厂商名 = 已透明化；skipped = 未配置/未分离；空 = 旧数据 */
  matting?: string;
}
/** 形象图库上限：pluginData.set 整体上传 sys_state，base64 体积要控 */
const SPRITE_GALLERY_MAX = 16;
/** AI 生图 agent 名（后端 PluginAgentRunner 注册；dev-host 走 mock 或同链 agentRun） */
const SPRITE_GEN_AGENT = "field-survival-sprite-gener";
/** 生图 agent 超时：图片模型推理 30~90s，留足余量 */
const SPRITE_AGENT_TIMEOUT_MS = 150000;

/** 形象绑定查询：返回该角色的形象 override（无则 null）。
 *  返回整条 SpriteEntry（不仅是 image），让 entity.customSprite 拿到 prompt/source */
function spriteOverrideFor(s: FieldSurvivalState, id: unknown): { image: string; prompt?: string; source?: string; createdAt?: number } | null {
  const k = String(id ?? "");
  if (!k) return null;
  const b = (s as any).spriteBinds as Record<string, any> | undefined;
  const v = b ? b[k] : null;
  if (!v || typeof v !== "object") return null;
  const img = str((v as any).image, "");
  if (!img) return null;
  return {
    image: img,
    prompt: str((v as any).prompt, "") || undefined,
    source: str((v as any).source, "preset") || undefined,
    createdAt: Math.round(num((v as any).createdAt, 0)) || undefined,
  };
}

export interface FieldSurvivalState {
  phase: "select" | "playing" | "over";
  version: number;
  tick: number;
  world: { w: number; h: number };
  roles: Array<Record<string, unknown>>;
  selections: {
    participants: string[];
    spectators: string[];
    enemies: string[];
  };
  entities: Entity[];
  chests: Chest[];
  potions: Potion[];
  floaters: Array<{ id: string; text: string; x: number; y: number; life: number }>;
  /** ★ game.md 打击特效：宿主侧生成的战斗粒子（kind 与前端 drawVfxLayer 对齐） */
  vfx?: Array<Record<string, any>>;
  /** game.md 技能修改：用户改过的技能参数（按归一技能名存），持久化到 t_plugin_session_data */
  skillMeta?: Record<string, { power: number; cost: number; cd: number; type: string; range: string; lv: number; buff_type: string; effects_type?: string }>;
  /** ★ game.md 物品修改：用户改过的物品参数（按展示名存），持久化到 t_plugin_session_data */
  itemMeta?: Record<string, ItemMeta>;
  /** ★ 野怪击杀奖励：全局掉落表（[{name,w}]）；地图 archetype.dropTable 优先 */
  dropTable?: Array<{ name: string; w: number }>;
  /** ★ 野怪击杀奖励：暗核授予技能的候选池（宿主/前端用 sys_skill_pool 下发）；空 = 让 AI 自由生成 */
  skillPool?: string[];
  /** ★ 野怪击杀奖励：本次使用核类物品命中了「AI 判技能」骰子（handle_action 消费后清） */
  _pendingCoreGrant?: boolean;
  /** ★ 任务板：可接/已接任务定义（宿主/CLI/AI 下发，随 sys_state 持久化） */
  questBoard?: QuestDef[];
  /** ★ 任务板：玩家任务进度（宿主侧权威，key = QuestDef.id） */
  quests?: Record<string, QuestProgress>;
  /** ★ 任务板：最近一次操作的反馈文案（前端 toast） */
  questNotice?: string;
  /** ★ 任务板：AI 对某个任务的回答（sys_quest_ask 结果） */
  questAiText?: string;
  /** ★ 任务板：正在等待 AI 回答（前端显示「思考中」） */
  _questAsking?: boolean;
  /** ★ 任务板：前端渲染视图（宿主每 tick 重算，前端只读） */
  questView?: {
    available: Array<Record<string, any>>;
    active: Array<Record<string, any>>;
    done: Array<Record<string, any>>;
    turned: Array<Record<string, any>>;
    playerLevel: number;
  };
  // 用户参数卡派生
  skills: SkillSlot[];
  items: ItemSlot[];
  skillPage: number;
  itemPage: number;
  playerCard: Record<string, unknown>;
  map?: MapData | null;
  mapSource?: "agent" | "fallback" | "stored";
  /** ★ v4：区域运行时状态（城镇 + 6 野区） */
  regions?: RegionState[];
  /** ★ v4：城镇（安全区）建筑与中立角色 */
  town?: TownData | null;
  /** ★ fix⑤：前端 localEnemies 上报的当前关卡边界（半宽/半高，米）；有值时野怪生成与 AI 均夹进该范围 */
  mapBounds?: { lx: number; ly: number } | null;
  /** ★ fix⑤：前端 localEnemies 世代号（同世代重复上报视为宿主状态回推，直接忽略） */
  localMobsEpoch?: number;
  /** ★ v5：系统面板 —— 当前地图名（前端上报） */
  levelName?: string;
  /** ★ v5：纳戒（存物品与技能） */
  ring?: RingStore;
  /** ★ 对话功能：最近一次 sys_chat 的结果（前端按 reqId 配对取回，走 state 通道而非 HTTP 回包）
   *  结构：{ reqId, ok, mode, speaker, text, options, error } */
  chatResult?: {
    reqId: string;
    ok: boolean;
    mode: string;
    speaker?: string;
    text?: string;
    options?: string[];
    error?: string;
  } | null;
  /** ★ 通用 AI agent 调用结果（事件系统 ctx.ai.generate 用）
   *  结构：{ reqId, ok, text, error } —— 独立于 chatResult 单槽位，
   *  避免「锻造生成」与「角色对话」互相覆盖。 */
  agentResult?: {
    reqId: string;
    ok: boolean;
    text?: string;
    error?: string;
  } | null;
  /** ★ v5：组队跟随的角色 id 列表 */
  partyIds?: string[];
  /** ★ v5：角色卡（含地图名与坐标，落 t_plugin_session_data） */
  npcCards?: NpcCard[];
  /** ★ P1 打击感：震屏剩余帧数（>0 时前端 canvas 随机偏移） */
  screenShake?: number;
  /** ★ P1 打击感：震屏强度（像素）；screenShake 归零时同步清零 */
  screenShakeIntensity?: number;
  /** ★ P1 打击感：顿帧剩余帧数（>0 时前端跳过本次渲染） */
  hitStopFrames?: number;
  /** ★ AI 托管频率判据：玩家战斗状态（宿主权威，前端只读）
   *  level: none（无威胁）| skirmish（遭遇战，未交手）| engaged（交战中）
   *  · damage() 是所有伤害的唯一入口 → 玩家参与伤害即置 engaged
   *  · engaged 保持 COMBAT_HOLD_TICKS 后降为 skirmish；skirmish 且附近无威胁则降为 none
   *  · 等级跃迁时产生 combatTransition，供前端派发 AI 事件（边沿触发） */
  playerCombat?: {
    level: "none" | "skirmish" | "engaged";
    /** 最后一次玩家参与的伤害结算时刻（tick） */
    lastCombatTick: number;
    /** 当前等级升起的时刻（tick） */
    sinceTick: number;
    /** 附近敌人数（skirmish 判据） */
    nearbyEnemies: number;
    /** ★ 本 tick 发生的等级跃迁（none→skirmish→engaged），前端消费一次后清空 */
    combatTransition?: { from: "none" | "skirmish" | "engaged"; to: "none" | "skirmish" | "engaged"; tick: number };
  };
  /** ★ v5：背包物品展示元数据（稀有度 / 类型 / 恢复量 / 估价） */
  bagMeta?: Record<string, BagItem>;
  /** ★ v5：背包自定义排列顺序（物品名数组） */
  bagOrder?: string[];
  /** ★ 技能栏自定义排列顺序（skillKey 数组；与快捷栏、技能面板同步） */
  skillOrder?: string[];
  /** ★ v5：商城商品 */
  shopGoods?: ShopGood[];
  shopSource?: "agent" | "builtin";
  /** ★ v5：大地图节点（前端上报的关卡列表） */
  mapNodes?: MapNode[];
  /** ★ v5：面板数据版本号（用于前端感知传送等一次性指令） */
  sysRevision?: number;
  teleportTarget?: TeleportTarget | null;
  travelTarget?: TeleportTarget | null;
  /** ★ v5：回写宿主的用户动态参数卡补丁（items / skills / money），宿主消费后清空 */
  writeback?: Record<string, any> | null;
  /** ★ 方案一：点击自动逼近目标（玩家点击怪物后写入，localTick 消费后清空） */
  autoApproach?: { targetId: string; skillIdx: number; phase: "moving" | "casting" } | null;
  /** ★ 斧头破坏模式：使用斧类物品后置 true，点击障碍物可破坏（使用其他技能/物品清零） */
  axeMode?: boolean;
  /** ★ 实体形象：AI 生成 / 上传的图库条目（随 sys_state 持久化，可删除） */
  spriteGallery?: SpriteEntry[];
  /** ★ 实体形象：roleId → 形象图（整条 SpriteEntry；图库删除时被一并解绑）。
   *   玩家与 NPC 通用，绑定后渲染走 entity.customSprite 通道（canvas 走 walk 2 帧），
   *   刷新不丢；不在图库的「预选内置形象」临时绑定也走这里。 */
  spriteBinds?: Record<string, { image: string; prompt?: string; source?: "ai" | "upload" | "preset"; createdAt?: number }>;
  /** ★ 实体形象：AI 生成状态（前端弹窗轮询显示） */
  spriteGen?: { status: "idle" | "running" | "done" | "error"; message?: string; at?: number };
  /** ★ 实体形象：面板数据版本号（生成/删除/绑定后自增，前端感知刷新） */
  spriteRevision?: number;
  // 结算
  exp: number;
  money: number;
  drops: string[];
  kills: number;
  events: string[];
  result: null | {
    reason: "exit" | "death";
    exp: number;
    money: number;
    drops: string[];
    kills: number;
    survivedTicks: number;
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/* ============================================================
   世界边界（与 25d_ai_game 的 map_config.json 完全一致）

     size = 3000m × 3000m, origin = (0, 0), 范围 ±1500 米
     所有 entity / 装饰物 / 宝箱 / 血瓶坐标单位：米
   ============================================================ */

/** x/z 范围（米），±1500 */
const WORLD_X_RANGE: [number, number] = [-1500, 1500];
const WORLD_Z_RANGE: [number, number] = [-1500, 1500];
/** 玩家出生点：mulberryTown 中心（Rotten-Soup mulberryTown.json Actors 层 PLAYER 在 (34,32) tile → 世界 (12.5, 4) ≈ (13, 4)） */
const PLAYER_SPAWN = { x: 13, y: 4 };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clampX = (v: number) => clamp(v, WORLD_X_RANGE[0] + 10, WORLD_X_RANGE[1] - 10);
const clampY = (v: number) => clamp(v, WORLD_Z_RANGE[0] + 10, WORLD_Z_RANGE[1] - 10);
const rndX  = () => rnd(WORLD_X_RANGE[0] + 80, WORLD_X_RANGE[1] - 80);
const rndY  = () => rnd(WORLD_Z_RANGE[0] + 80, WORLD_Z_RANGE[1] - 80);

/* ---- 战斗距离参数（米） ----
   MOVE_SPEED_M = 3 米/秒（一 tick 位移 = MOVE_SPEED_M × TICK_DT_S = 0.3 米）
   ★ 修复：原注释写作"3 米/帧"，与前端 3 米/秒 相差 10 倍，是位移异常/瞬移的根因之一
   ★ v4：敌人探测半径 = MOB_DETECT_M = 10 米（此前 MOB_VIEW_M=80 从未被敌人分支引用，
         野怪无视距离全图直线追击 —— 现在 10 米探测 → 追击 → 12 米脱战归位）
   mob 攻击 = 1 米（进入攻击位）；盟友视野 = 80 米；盟友跟随 = 2.5 米；盟友攻击 = 0.5 米
   开箱/拾血瓶 = 2 米；技能作用范围 = 30 米
   */
const MOVE_SPEED_M = 3.0;      // 米/秒
const TICK_DT_S = 0.1;         // 一次 tick = 100ms（与前端 TICK_MS 对齐）
const MOB_VIEW_M   = 80;       // ★ v4：仅盟友 AI 追击射程兜底用（敌人改用 MOB_DETECT_M）
/** ★ game.md《野怪和攻击机制》：近战距离 1.0 米（从 0.5m 调大，消除视觉死区——
 *  0.5m 时怪停在玩家身边但模型体积导致实际距离 0.8~1m，看起来"呆着不打"；
 *  1.0m 让怪继续逼近直到真正贴身，攻击环同步告知玩家何时可打） */
const MOB_ATK_M    = 1.0;
const ALLY_ATK_M   = 0.5;
/** ★ game.md：野怪发起攻击的距离 = 4 米 —— 怪不打进玩家身边 4m 内，友军（护卫）不动手，
 *  且友军索敌锚点是「玩家」而不是友军自身（此前锚在友军身上，友军阵位散开 12m 后
 *  会挑离自己近的远怪围殴，出现「面前的不打、打很远的」）。 */
const ALLY_ENGAGE_M = 4;
/** 友军跟随阵位半径：2.5m（此前 12m —— 友军站位散得太开，是「打远的」帮凶） */
const ALLY_FOLLOW_GAP_M = 2.5;
/** 护送货物离玩家超过这个距离 → 判定为「坐标还留在旧图 / 刚跨图」，直接贴回身边（不再慢慢追） */
const QUEST_CARGO_SNAP_M = 6;
const CHEST_PICKUP_M  = 2;
/** ★ 击杀掉落宝箱的开启保护期（tick，100ms/拍）：1.2 秒内不许自动开箱。
 *  否则近战击杀时玩家就站在掉落点旁 → 下一帧立刻被吃掉，玩家永远「看不见地上有宝箱」。 */
const CHEST_GRACE_TICKS = 12;
const POTION_PICKUP_M = 2;
/** ★ game.md：远程野怪/远程武器/远程技能 距离 4 米（此前 30 米） */
const SKILL_RANGE_M   = 4;
// ── AI 托管专用常量（移植自 cache/entry.js，确保 entry.ts 重编不丢 AI 能力）──
const AI_MANAGED_ENGAGE_M = 13;        // AI托管角色独立索敌半径（米）
const AI_GATHER_TICKS = 30;            // 采集中耗时（tick）
const AI_GATHER_COOLDOWN_TICKS = 200;  // 采集点冷却（tick）
const AI_GATHER_ARRIVE_M = 1.2;        // 采集到达判定（米）
const AI_INTERACT_M = 2;               // 交互到达判定（米）
const AI_BAG_MAX_SLOTS = 8;            // AI 私藏格数上限（与 sensor.ts inventoryFull 判据一致）

/* ── ★ 野怪击杀奖励（spec：events/野怪击杀奖励.事件.md）────────────────
   链路：击杀野怪 → 概率在尸体处掉宝箱 → 走过去开启 → 物资（含暗核）
        → 使用暗核 → 经验 + 有概率触发 AI 判定获得什么技能
   数据驱动点（都不是硬编码故事内容）：
     · 掉落表：地图 enemy_archetypes[].dropTable 或 s.dropTable（[{name,w}]）
     · 技能池：s.skillPool（宿主/前端可下发，action sys_skill_pool）
     · 核类物品判定：itemMeta[name].grant==="skill" 或 CORE_ITEM_RE
   ────────────────────────────────────────────────────────── */
const KILL_DROP_CHEST_P = 0.35;   // 击杀掉宝箱概率
/** 宝箱物资默认掉落表（w=权重；地图 archetype.dropTable 可整体覆盖） */
const DEFAULT_DROP_TABLE: Array<{ name: string; w: number }> = [
  { name: "干粮", w: 26 }, { name: "荧光石", w: 18 }, { name: "兽骨", w: 16 },
  { name: "野兽皮", w: 14 }, { name: "锋利的爪", w: 12 }, { name: "暗核", w: 14 },
  // ★ 药瓶（2026-10-18）：Q05「送药到药铺」要求采集 药瓶×1，但全工程没有任何产出口
  //   → 该任务永远交不了。宝箱里放成药（药品补给）是最自然的兜底来源，权重给低一点。
  { name: "药瓶", w: 10 },
];
/** 「核类物品」名命中规则（暗核 / 湮核 / 源核 / 核晶…）：使用 → 经验 + 概率 AI 授技 */
const CORE_ITEM_RE = /暗核|湮核|源核|核晶|兽核/;
/** 「斧类物品」名命中规则（斧头 / 铁斧 / 伐木斧…）：使用 → 进入障碍破坏模式 */
const AXE_RE = /斧/;
const CORE_USE_EXP = 40;          // 使用一个核类物品给的经验
const CORE_SKILL_P = 0.5;         // 触发 AI 判定「获得什么技能」的概率
const CORE_AGENT_TIMEOUT_MS = 20000;  // 问 AI「给什么技能」的超时（超时走兜底，不卡玩家）
/** AI 未返回 / 未命中池子时的兜底技能名（仍走 inferSkillType 推断类型） */
const CORE_FALLBACK_SKILLS = ["碎石击", "疾风步", "回气术"];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/* ── ★ 任务板常量 ───────────────────────────────────────────── */
const QUEST_TITLE_MAX = 12;          // 任务标题最长字数（与技能名同口径，超了静默截断）
const QUEST_ARRIVE_DEFAULT_R = 3;    // arrive/explore 默认判定半径（米）
const QUEST_CARGO_PREFIX = "questcargo_";  // 护送货物实体 id 前缀
const QUEST_AGENT_TIMEOUT_MS = 20000;      // 问 AI（任务详情/追问）超时
const QUEST_GEN_TIMEOUT_MS = 25000;        // AI 生成委托超时（输出 JSON 数组，给足窗口；后端 agent 20s 内必返）
const QUEST_TYPE_SET = new Set(["kill", "gather", "escort", "deliver", "explore", "talk"]);
const QUEST_KIND_SET = new Set(["kill", "gather", "arrive", "talk", "explore"]);
/** ★ 采集目标别名表（上位词 → 具体物名）。
 *  背景：任务写「木材」、事件脚本产出「松木 / 沉香木 / 朽木」——双向 includes 都不成立
 *  （"松木".includes("木材")=false、"木材".includes("松木")=false）→ 进度永远 0，
 *  Q11「备足柴火」实测卡死。这里把目标展开成可接受物名集合再求交。
 *  ★ 只加「上位词→具体物名」这一种方向；具体物名之间的宽松匹配交给原 includes 逻辑。
 *  新增词条只追加数组，不影响已有匹配。 */
const QUEST_GATHER_ALIAS: Record<string, string[]> = {
  木材: ["松木", "沉香木", "朽木", "木料", "木柴"],
  木料: ["松木", "沉香木", "朽木", "木材", "木柴"],
  药材: ["夜合花", "血参", "当归", "黄芪", "灵芝"],
  草药: ["夜合花", "血参", "当归", "黄芪", "灵芝"],
};

/* ============================================================
   ★ v4 区域刷新（Region Respawn）+ 城镇安全区 + 敌人探测/脱战
   ------------------------------------------------------------
   1) 世界按「城镇（安全区） + 6 个野区」划分（正六边形拓扑，区域名见 WORLD_REGIONS）；
      主角出生地 = 城镇（安全区，名字跟随当前地图），镇内布置建筑与中立角色，城镇永不刷新野怪。
   2) 每个野区各自维护刷新计时：玩家离开该区域 45 秒后刷新一次野怪
      （补满该区域配额）；玩家在场时计时挂起；不再用 enemies.length===0 触发。
   3) 敌人探测半径 = MOB_DETECT_M（10 米），超出 MOB_DISENGAGE_M（12 米）脱战，
      归位到巢点（homeX/homeY）附近游荡。
   4) 敌人复活 = 区域刷新机制重新生成（死亡实体当帧从世界移除，不再残留 alive=false）。
   ============================================================ */

/** 区域刷新间隔：玩家离开该区域 45 秒后刷新一次（45s / 0.1s = 450 tick） */
const REGION_RESPAWN_SEC = 45;
const REGION_RESPAWN_TICKS = REGION_RESPAWN_SEC * 10;    // TICK_DT_S = 0.1
/** ★ game.md：野怪发起攻击的距离 = 4 米（探测=进入战斗） */
const MOB_DETECT_M = 4;
/** ★ game.md：超过 4 米野怪自己回到出生点（脱战归位；与探测同值，无迟滞带） */
const MOB_DISENGAGE_M = 4;
/** 离出生点超过此距离 → 归位（game.md：超过 4 米回出生点） */
const MOB_LEASH_R_M = 4;
/** 巢点周围游荡半径（必须在 MOB_LEASH_R_M 之内，否则游荡本身就触发归位抖动） */
const MOB_WANDER_R_M = 3;
/** 野怪落点距城镇边界的最小缓冲（保证城镇安全区内部无野怪） */
const TOWN_SPAWN_BUFFER_M = 20;

type RegionKind = "safe" | "forest" | "shore" | "mine" | "ruin" | "marsh" | "wild";

interface RegionDef {
  id: string;
  name: string;
  /** 短名（小地图/世界图标签，2 字） */
  short: string;
  kind: RegionKind;
  x: number; y: number; r: number;
  safe: boolean;
  /** 区域等级（决定野怪血量/攻击成长） */
  lv: number;
  /** 野怪配额（区域刷新时补满到这个数量） */
  mobs: number;
  desc: string;
}

/** 区域划分方案：城镇居中（安全区），6 个野区环绕（环半径 480 m，区域半径 240 m） */
const WORLD_REGIONS: RegionDef[] = [
  { id: "town",  name: "城镇",     short: "城镇", kind: "safe",   x: 0,    y: 0,     r: 160, safe: true,  lv: 0, mobs: 0, desc: "玩家出生的城镇（安全区）：商铺、民居、水井与中立居民，不刷新野怪" },
  { id: "wood",  name: "东岭林场", short: "东岭", kind: "forest", x: 480,  y: 0,     r: 240, safe: false, lv: 1, mobs: 4, desc: "低矮林地，狼群与哥布林斥候游荡" },
  { id: "shore", name: "东北浅滩", short: "东北", kind: "shore",  x: 240,  y: 416,   r: 240, safe: false, lv: 1, mobs: 3, desc: "水边滩地，毒蛇与蝙蝠出没" },
  { id: "mine",  name: "西北矿丘", short: "西北", kind: "mine",   x: -240, y: 416,   r: 240, safe: false, lv: 2, mobs: 4, desc: "废弃矿丘，骷髅兵与哥布林盘踞" },
  { id: "ruin",  name: "西郊废墟", short: "西郊", kind: "ruin",   x: -480, y: 0,     r: 240, safe: false, lv: 2, mobs: 4, desc: "残垣断壁，骷髅兵与荒野游荡者" },
  { id: "marsh", name: "西南沼地", short: "西南", kind: "marsh",  x: -240, y: -416,  r: 240, safe: false, lv: 3, mobs: 5, desc: "沼泽泥地，毒蛇群与巨狼" },
  { id: "wild",  name: "东南荒原", short: "东南", kind: "wild",   x: 240,  y: -416,  r: 240, safe: false, lv: 3, mobs: 5, desc: "开阔荒原，成群野兽巡行" },
];

/**
 * ★ 区域列表 → 写入 map.zones（前端主地图/小地图据此显示区域名）。
 *
 * 修复「所有地图中央都显示『晨曦镇』」：
 *   之前这里无条件把 WORLD_REGIONS 写进 map.zones，而 WORLD_REGIONS[0] 的
 *   name 是硬编码的「晨曦镇」→ 任何地图（森林/墓地/地牢/修真图）中央都被画上
 *   「晨曦镇」三个字，纯属串图。
 *   现在按当前地图名生成区域名：
 *     · 城镇安全区（kind=safe）→ 用当前地图的显示名（如「城镇」「大罗宗外门」）；
 *     · 其余野区 → 保留原名（它们是野外分区，与具体地图无关）。
 *
 * @param mapDisplayName 当前地图显示名（中文优先，空则回退 levelName / 通用词）
 * @param levelName      当前关卡名（英文/驼峰），显示名缺失时兜底
 */
function buildZonesForMap(mapDisplayName: string, levelName: string): MapData["zones"] {
  const label = (mapDisplayName || levelName || "").trim();
  return WORLD_REGIONS.map((r) => ({
    name: r.id === "town" ? (label || "城镇") : r.name,
    x: r.x, y: r.y, r: r.r, kind: r.kind, desc: r.desc,
  }));
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 技能名归一：剥离「（lv2，描述…）」等后缀 / 对象残留 */
function cleanSkillName(v: unknown): string {
  let n = v && typeof v === "object" ? str((v as any).name ?? (v as any).skill ?? "") : str(v);
  n = n.replace(/\[object Object\]/g, " ");
  n = n.replace(/[（(][^）)]*[）)]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[·、,，;；:：]+$/, "").trim();
  return n;
}
function skillKey(v: unknown): string {
  return cleanSkillName(v).toLowerCase();
}
function sameSkill(a: unknown, b: unknown): boolean {
  const ka = skillKey(a);
  return !!ka && ka === skillKey(b);
}
/** 按名字推断默认 type/range（参数卡同步过来的技能未显式配置时用） */
function inferSkillType(name: string): { type: "atk" | "heal" | "buff"; range: "melee" | "ranged" } {
  const n = String(name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return { type: "heal", range: "melee" };
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return { type: "buff", range: "melee" };
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return { type: "atk", range: "ranged" };
  return { type: "atk", range: "melee" };
}
/** game.md buff 类型：防御/攻击/持续伤害/晕眩/无敌/加速 */
const BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"];
/** 括号深度感知拆分：只在括号外按分隔符切技能（「A（lv1，失控）（lv1）、B（lv2）」不会切烂注记） */
function splitSkillList(raw) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(raw)) {
    if (ch === "\uFF08" || ch === "(") depth += 1;
    else if (ch === "\uFF09" || ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && "\u3001,\uFF0C;\uFF1B/|".includes(ch)) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
/** ★ 快捷栏一页几格（HUD 物品栏 / 技能栏固定 4 列；前后端必须一致） */
const QUICKBAR_PAGE_SIZE = 4;

/** ★ 快捷栏补齐：把列表补到 padTo 的整数倍（至少一页），空格用 empty 占位。
 *  以前是「补齐到固定 8 格」，结果背包/技能超过 8 个时第 9 个起永远翻不出来。 */
function padQuickbar<T>(list: T[], padTo: number, make: () => T): T[] {
  const target = Math.max(padTo, Math.ceil(list.length / padTo) * padTo);
  while (list.length < target) list.push(make());
  return list;
}

/** ★ 快捷栏页码夹紧：物品/技能列表变短（用光/丢弃）后，页码不能停在不存在的页上 */
function clampQuickbarPages(s: FieldSurvivalState): void {
  const ip = Math.max(1, Math.ceil((s.items || []).length / QUICKBAR_PAGE_SIZE));
  const sp = Math.max(1, Math.ceil((s.skills || []).length / QUICKBAR_PAGE_SIZE));
  s.itemPage = Math.min(Math.max(0, Math.round(num(s.itemPage, 0))), ip - 1);
  s.skillPage = Math.min(Math.max(0, Math.round(num(s.skillPage, 0))), sp - 1);
}

/** ★ 技能排序：参数卡 skills 是「源之力（lv1，失控）（lv1）」这种带注记的脏字符串，
 *  直接按下标移动会把注记也一起搬乱。这里按 skillKey 分组（同名技能的多份原始条目
 *  算一组，内部相对顺序不变），再按 order 给出的名字顺序重排；
 *  order 里没点到的技能保持原相对顺序排在后面。返回重排后的原始条目数组。 */
function reorderCardSkills(card: Record<string, any> | undefined, order: string[]): unknown[] {
  const raw = Array.isArray(card?.skills) ? (card as Record<string, any>).skills as unknown[] : [];
  const groups = new Map<string, unknown[]>();
  const seq: string[] = [];
  raw.forEach((x) => {
    const k = skillKey(x);
    if (!k) return;
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); seq.push(k); }
    g.push(x);
  });
  if (!groups.size) return [];
  const keys = (order || []).map((n) => skillKey(n)).filter((k) => !!k && groups.has(k));
  seq.forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  const out: unknown[] = [];
  keys.forEach((k) => { (groups.get(k) as unknown[]).forEach((x) => out.push(x)); });
  return out;
}

/** ★ 断线重连 / 宿主参数卡回灌时，按 s.skillOrder 还原技能顺序
 *  （宿主可能还没收到写回，直接用它下发的 skills 会把顺序冲掉） */
function applyCardSkillOrder(card: Record<string, any>, order?: string[]): void {
  if (!Array.isArray(order) || !order.length) return;
  if (!Array.isArray(card?.skills) || !card.skills.length) return;
  const next = reorderCardSkills(card, order);
  if (next.length) card.skills = next;
}

/** 从用户参数卡取技能（拆分 / 同名合并取最高 lv），套用 skillMeta 用户修改。
 *  ★ fix①：原实现「同名技能按出现次数改名」→ 参数卡里重复出现的技能会变成
 *    「暗核共鸣2 / 暗核共鸣3 / 源之力2 / 源之力3」这种**假技能**占满快捷栏，
 *    把真正的新技能挤到第 9 格之后（快捷栏只有 8 格 → 永远翻不出来）。
 *    现在同名只保留一格，lv 取最大值。
 *  ★ fix②：不再硬编码 8 格上限，只补到 4 的整数倍（快捷栏一页 4 格）。 */
function buildSkills(card: Record<string, unknown> | undefined, padTo = QUICKBAR_PAGE_SIZE, meta?: Record<string, any>): SkillSlot[] {
  const raw = Array.isArray(card?.skills) ? (card!.skills as unknown[]) : [];
  const seen = new Map<string, number>(); // 归一化技能名 → names 下标
  const names: string[] = [];
  const lvs: number[] = [];
  raw.forEach((s) => {
    const parts = typeof s === "string" ? splitSkillList(s) : [s];
    parts.forEach((p) => {
      const nm = cleanSkillName(p).slice(0, 12);
      if (!nm) return;
      const lvM = String(typeof p === "string" ? p : str((p as any)?.name)).match(/lv\s*(\d+)/i);
      const lv = lvM ? Math.max(1, Math.round(Number(lvM[1]))) : 1;
      const at = seen.get(nm.toLowerCase());
      if (at == null) {
        seen.set(nm.toLowerCase(), names.length);
        names.push(nm);
        lvs.push(lv);
      } else {
        lvs[at] = Math.max(lvs[at] || 1, lv);
      }
    });
  });
  const out: SkillSlot[] = names.map((name, i) => {
    const base = inferSkillType(name);
    const m = meta && meta[skillKey(name)];
    return {
      name,
      power: num(m?.power, 12 + i * 3),
      cost: num(m?.cost, 0),
      cd: num(m?.cd, 24 + i * 6),
      cdLeft: 0,
      type: m?.type || base.type,
      range: m?.range || base.range,
      lv: num(m?.lv, lvs[i] || 1),
      buff_type: m?.buff_type || "",
      effects_type: m?.effects_type || "",
    };
  });
  return padQuickbar(out, padTo, () => ({
    name: "", power: 0, cost: 0, cd: 0, cdLeft: 0, empty: true,
  }));
}

/** 从用户参数卡取物品，补足占位物品。
 * ★ HUD 物品栏显示修复：原来直接把 "银鲳×16（钓鱼累积…）" 整串当 name + 写死 count=2，
 *   导致 HUD 显示 "银鲳×16（…）×2"，且 useItem 拿带尾巴的字符串去 useBagItem.find(name)
 *   匹配不到合并后的纯名 "银鲳" → 静默返回 "不在背包中" → 点击没反应、不消耗、无特效。
 *   现在按 parseItemRaw 解析（剥注记/×N），用纯名 + 实际合并数量；同名多份合并到一格。
 * ★ fix③：原来只生成固定 8 格（`n=8`），第 9 件起的物品**永远翻不出来**
 *   （快捷栏一页 4 格 → 最多 2 页就回到第一页，用户看到的现象）。
 *   现在不设上限，只补到 4 的整数倍。
 * ★ fix④：同名合并原来写的是 `counts[counts.length-1] += p.count`，只对**连续**同名正确；
 *   背包里出现 A,B,A 这种非连续同名时，A 的数量会被加到 B 上。改为按名下标累加。 */
function buildItems(card: Record<string, unknown> | undefined, padTo = QUICKBAR_PAGE_SIZE): ItemSlot[] {
  const raw = Array.isArray(card?.items) ? (card!.items as unknown[]) : [];
  const parsed = raw.map(parseItemRaw).filter((p) => p && p.name && p.count > 0);
  const seen = new Map<string, number>(); // 归一化物品名 → 下标
  const names: string[] = [];
  const counts: number[] = [];
  parsed.forEach((p) => {
    const k = itemKey(p.name);
    if (!k) return;
    const at = seen.get(k);
    if (at == null) {
      seen.set(k, names.length);
      names.push(p.name);
      counts.push(p.count);
    } else {
      counts[at] += p.count;
    }
  });
  const out: ItemSlot[] = names.map((name, i) => {
    const meta = parsed.find((p) => itemKey(p.name) === itemKey(name));
    const kind = meta?.kind || guessKind(name);
    const heal = meta?.heal ?? defaultHeal(name, kind);
    return { name, count: counts[i], kind, heal };
  });
  return padQuickbar(out, padTo, () => ({ name: "", count: 0, heal: 0, empty: true }));
}

function makeEntity(
  role: Record<string, unknown> | undefined,
  side: Entity["side"],
  x: number,
  y: number,
  idx: number,
): Entity {
  const hp = num(role?.hp, side === "enemy" ? 60 : 100) || 100;
  return {
    id: str(role?.id, `${side}_${idx}`),
    name: str(role?.name, side === "enemy" ? `野兽${idx + 1}` : `角色${idx + 1}`),
    side,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    atk: side === "enemy" ? 8 : 14,
    level: num(role?.level, 1) || 1,
    avatarPath: str(role?.avatarPath) || undefined,
    facing: 0,   // 角度制：0=右 90=下 180=左 270=上
    cooldown: 0,
    alive: true,
  };
}

function emptyState(ctx?: PluginGameContext): FieldSurvivalState {
  const card = (ctx?.playerCard || {}) as Record<string, unknown>;
  const _wn = str((ctx as any)?.worldName, "");
  const _wid = (ctx as any)?.worldId;
  return {
    phase: "select",
    version: 3,                  // v3：3000m 世界 + 米单位 + scale 元数据
    tick: 0,
    // ★ v6+：把宿主注入的当前世界身份写进 state 顶层，前端可同步从 state.value 拿到。
    //   init/start_init 会再覆盖一次（兜底）。Map 数据绑定 / 角色面板 / 事件源都靠它。
    ...(_wn ? { worldName: _wn } : {}),
    ...(_wid != null && _wid !== "" ? { worldId: _wid } : {}),
    world: { w: WORLD_X_RANGE[1] - WORLD_X_RANGE[0], h: WORLD_Z_RANGE[1] - WORLD_Z_RANGE[0] },
    /** v3 增强：玩家出生点 (0,0) */
    spawn: { ...PLAYER_SPAWN },
    /** v3 增强：scale / 视距配置 */
    scale: {
      meter: TERRAIN_SCALE_METER,
      block_size: TERRAIN_BLOCK_SIZE_M,
      chunk_size_blocks: CHUNK_SIZE_BLOCKS,
      chunk_size_meters: CHUNK_SIZE_M,
      ground_size: TERRAIN_GROUND_SIZE_M,
      ground_height: TERRAIN_GROUND_HEIGHT_M,
      x_range: [...WORLD_X_RANGE],
      z_range: [...WORLD_Z_RANGE],
    },
    roles: Array.isArray(ctx?.roles) ? ctx!.roles! : [],
    selections: { participants: [], spectators: [], enemies: [] },
    /** ★ fix⑤：前端 localEnemies 状态（开局未上报 bounds 时按世界边界处理） */
    mapBounds: null,
    localMobsEpoch: 0,
    entities: [],
    chests: [],
    potions: [],
    floaters: [],
    vfx: [],   // ★ game.md 打击特效：宿主侧生成的战斗粒子（spark/explosion/slash_arc/fireball/heal_ring/buff_ring）
    skills: buildSkills(card),
    items: buildItems(card),
    skillMeta: {},
    itemMeta: {},
    skillPage: 0,
    itemPage: 0,
    playerCard: card,
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: [],
    map: null,
    mapSource: "fallback",
    regions: [],                 // ★ v4：由 initRegions() 填充（城镇 + 6 野区）
    town: null,                  // ★ v4：由 ensureTown() 填充（建筑 + 中立角色）
    // ★ 实体形象：图库 / 角色绑定 / 生成状态（persistSys 持久化）
    spriteGallery: [],
    spriteBinds: {},
    spriteGen: { status: "idle", message: "", at: 0 },
    spriteRevision: 0,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// 战斗与推进
// ---------------------------------------------------------------------------

/** 按地图 archetypes 生成一波敌人/宝箱/血瓶（无地图时回退内置逻辑）
 *  ★ v3：怪物 spawn 在玩家周围 ±100 米（玩家在 (0,0)，开局就能看见） */
/** ★ fix③：波次/敌人落点统一围绕玩家当前位置（而不是全图随机） */
function spawnAnchor(s: FieldSurvivalState, minM: number, maxM: number): { x: number; y: number } {
  const p = s.entities.find((e) => e.side === "player");
  const cx = p ? p.x : PLAYER_SPAWN.x;
  const cy = p ? p.y : PLAYER_SPAWN.y;
  const angle = rnd(0, Math.PI * 2);
  const distM = minM + rnd(0, maxM - minM);
  return { x: clampX(cx + Math.cos(angle) * distM), y: clampY(cy + Math.sin(angle) * distM) };
}

function spawnWave(s: FieldSurvivalState, wave: number) {
  // 找玩家（怪物围着他刷）
  const player = s.entities.find((e) => e.side === "player");
  const px = player?.x ?? PLAYER_SPAWN.x;
  const py = player?.y ?? PLAYER_SPAWN.y;

  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length)
    ? s.map.enemy_archetypes
    : null;
  if (archs) {
    const wavesCfg = (s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }]);
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count; i++) {
      const angle = rnd(0, Math.PI * 2);
      const dist = 30 + rnd(0, 70);              // 30-100 米
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy",
        clampX(px + Math.cos(angle) * dist),
        clampY(py + Math.sin(angle) * dist),
        i,
      );
      e.atk = Math.round(arch.atk + (wave - 1) * 1.5);
      (e as any).bounty = { ...arch.bounty };
      (e as any).def = arch.def;
      s.entities.push(e);
    }
    // 宝箱/血瓶只在第一波铺设（地图数据，x/y 已在 ±1500 范围内）
    if (wave === 1) {
      (s.map?.chests || []).forEach((c, i) => {
        s.chests.push({ id: `chest_map_${i}`, x: clampX(c.x), y: clampY(c.y), opened: false, ...(c as any) });
      });
      (s.map?.potions || []).forEach((p, i) => {
        s.potions.push({ id: `potion_map_${i}`, x: clampX(p.x), y: clampY(p.y), heal: num(p.heal, 40) });
      });
    }
    return;
  }
  // 内置回退
  const count = Math.min(2 + wave, 6);
  for (let i = 0; i < count; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 30 + rnd(0, 70);
    const e = makeEntity(
      { id: `enemy_${s.tick}_${i}`, name: `野兽 ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy",
      clampX(px + Math.cos(angle) * dist),
      clampY(py + Math.sin(angle) * dist),
      i,
    );
    e.atk = 7 + wave * 2;
    s.entities.push(e);
  }
  for (let i = 0; i < 2; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 25 + rnd(0, 30);
    s.chests.push({ id: `chest_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist), y: clampY(py + Math.sin(angle) * dist), opened: false });
  }
  for (let i = 0; i < 3; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 20 + rnd(0, 25);
    s.potions.push({ id: `potion_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist), y: clampY(py + Math.sin(angle) * dist), heal: 18 });
  }
}

function pushEvent(s: FieldSurvivalState, text: string) {
  s.events.push(text);
  if (s.events.length > 40) s.events = s.events.slice(-40);
}

function floater(s: FieldSurvivalState, text: string, x: number, y: number) {
  s.floaters.push({ id: `f_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, text, x, y, life: 24 });
  if (s.floaters.length > 30) s.floaters = s.floaters.slice(-30);
}

/** ★ game.md 打击特效：宿主侧推送 VFX 粒子（kind 与前端 drawVfxLayer 对齐） */
function pushVfx(s: FieldSurvivalState, p: Record<string, any>) {
  if (!Array.isArray((s as any).vfx)) (s as any).vfx = [];
  (s as any).vfx.push({ id: `vfx_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, ...p });
  if ((s as any).vfx.length > 60) (s as any).vfx = (s as any).vfx.slice(-60);
}

/**
 * ★ game.md「默认 4 个技能特效沿用」：按技能名归类特效
 *   远程类 → 火球(atk/ranged)  治疗类 → 治疗(heal)
 *   加强类 → 护盾(buff)        其余 → 冲斩(atk/melee)
 */
function skillFxKind(skill: { name: string; type?: string; range?: string }): "melee" | "ranged" | "heal" | "buff" {
  // ★ game.md 技能修改：显式 type/range 优先（atk+melee→冲斩刀光 / atk+ranged→火球 / heal→治疗环 / buff→护盾环）
  const t = String((skill as any)?.type || "");
  if (t === "heal") return "heal";
  if (t === "buff") return "buff";
  if (t === "atk") return str((skill as any)?.range, "melee") === "ranged" ? "ranged" : "melee";
  const n = String(skill?.name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return "heal";
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return "buff";
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return "ranged";
  return "melee";
}

// ════════════════════════════════════════════════════════════════
// ★ AI 托管子系统（移植自 cache/entry.js，确保 entry.ts 为真源、重编不被覆盖）
//   设计：AI 大脑经前端 sendAICommand → ai_command action 改 state 标记；
//   本文件 tick 循环按标记驱动 ally；采集产出交由前端事件引擎（地图集脚本）。
// ════════════════════════════════════════════════════════════════

/** ★ AI 采集到点：只打到达标记，产出交给前端事件引擎（地图集脚本） */
function resolveAIGather(s: any, ent: any, g: any) {
  ent._aiGatherArrived = { zoneName: String(g.zoneName || ""), tick: s.tick, reqId: String(g.reqId || "") };
  pushEvent(s, ent.name + " 到达" + (g.zoneName || "野外") + "，开始采集");
  floater(s, "采集中...", ent.x, ent.y - 30);
  pushVfx(s, { kind: "spark", entityId: ent.id, x: ent.x, y: ent.y, life: 10, total: 10, color: "#9CFF6B" });
  if (!s.aiGatherCd || typeof s.aiGatherCd !== "object") s.aiGatherCd = {};
  s.aiGatherCd[ent.id + "|" + (g.zoneName || "_")] = s.tick + AI_GATHER_COOLDOWN_TICKS;
  g.paid = true;
  return true;
}

/** ★ AI 交互：到点后给目标挂对话气泡 */
function resolveAIInteract(s: any, ent: any, it: any) {
  const tgt = s.entities.find((e: any) => e.id === it.targetId && e.alive);
  if (!tgt) return false;
  pushEvent(s, `${ent.name} 与 ${tgt.name} 交谈`);
  floater(s, "…", tgt.x, tgt.y - 30);
  if (!Array.isArray(s.aiTalks)) s.aiTalks = [];
  s.aiTalks.push({
    id: `t_${s.tick}_${Math.random().toString(36).slice(2, 6)}`,
    from: ent.name, to: tgt.name, targetId: tgt.id, x: tgt.x, y: tgt.y, life: 30,
  });
  if (s.aiTalks.length > 20) s.aiTalks = s.aiTalks.slice(-20);
  it.done = true;
  return true;
}

/** ★ AI 托管每 tick 执行器：采集到点结算 / 交互到点触发 / 超时清理 */
function tickAIOrders(s: any) {
  const ents = Array.isArray(s.entities) ? s.entities : [];
  ents.forEach((ent: any) => {
    const g = ent._aiGather;
    if (g && !g.paid) {
      const arrived = dist(ent, { x: g.x, y: g.y }) <= AI_GATHER_ARRIVE_M;
      const elapsed = s.tick - (g.startedTick || s.tick);
      if (arrived && elapsed >= AI_GATHER_TICKS) {
        const cdKey = `${ent.id}|${g.zoneName || "_"}`;
        const cdUntil = num((s.aiGatherCd || {})[cdKey], 0);
        if (s.tick >= cdUntil) {
          ent.actionBobMs = 300;
          resolveAIGather(s, ent, g);
        } else {
          g.paid = true;
        }
      } else if (elapsed > AI_GATHER_TICKS * 6) {
        g.paid = true;
      }
      if (g.paid) delete ent._aiGather;
    }
    const it = ent._aiInteract;
    if (it && !it.done) {
      const tgt = s.entities.find((e: any) => e.id === it.targetId && e.alive);
      if (!tgt) {
        it.done = true;
      } else if (dist(ent, tgt) <= AI_INTERACT_M) {
        ent.actionBobMs = 300;
        resolveAIInteract(s, ent, it);
      } else if (s.tick - (it.startedTick || s.tick) > 600) {
        it.done = true;
      }
      if (it.done) delete ent._aiInteract;
    }
  });
}

/** 按权重抽一项（掉落表用）。表空 / 权重全 0 → null */
function pickWeighted<T extends { w?: number }>(list: T[] | undefined | null): T | null {
  const arr = Array.isArray(list) ? list.filter((x) => x && typeof x === "object") : [];
  if (!arr.length) return null;
  const total = arr.reduce((a, b) => a + Math.max(0, num((b as any).w, 1)), 0);
  if (total <= 0) return arr[Math.floor(rnd(0, arr.length))] || null;
  let r = rnd(0, total);
  for (const it of arr) {
    r -= Math.max(0, num((it as any).w, 1));
    if (r <= 0) return it;
  }
  return arr[arr.length - 1] || null;
}

/** 是否「核类物品」（暗核）：使用 → 给经验 + 有概率触发 AI 判技能。
 *  判定顺序：itemMeta[name].grant === "skill" / .core === true（数据驱动）→ 名字命中 CORE_ITEM_RE */
function isCoreItem(s: FieldSurvivalState, it: { name?: string } | undefined): boolean {
  const nm = str(it?.name);
  if (!nm) return false;
  const meta = ((s.itemMeta || {}) as Record<string, any>)[nm];
  if (meta && typeof meta === "object") {
    if (String(meta.grant || "") === "skill" || meta.core === true) return true;
  }
  return CORE_ITEM_RE.test(nm);
}

/** ★ 野怪击杀奖励①：击杀野怪 → 概率在尸体处掉一个宝箱（走过去开启）
 *  掉落表优先级：实体 dropTable（来自地图 enemy_archetypes[].dropTable）→ s.dropTable → DEFAULT_DROP_TABLE */
function dropKillChest(s: FieldSurvivalState, target: Entity): void {
  if (Math.random() >= KILL_DROP_CHEST_P) return;
  const table =
    (Array.isArray((target as any).dropTable) && (target as any).dropTable.length
      ? (target as any).dropTable
      : Array.isArray(s.dropTable) && s.dropTable.length
        ? s.dropTable
        : DEFAULT_DROP_TABLE) as Array<{ name: string; w: number }>;
  const pick = pickWeighted(table);
  const item = str(pick?.name, "干粮");
  const bounty = (target as any).bounty as { exp?: number; money?: number } | undefined;
  const lv = Math.max(1, Math.round(num(target.level, 1)));
  const exp = Math.max(5, Math.round(num(bounty?.exp, 8 + lv * 4) * 0.5));
  const money = Math.max(3, Math.round(num(bounty?.money, 5 + lv * 3) * 0.5));
  // ★ fix（2026-10-16）：「杀了整张图也不见地上有宝箱」的第二个原因 ——
  //   宝箱原来**正好掉在尸体坐标**上，而近战击杀时玩家就站在尸体旁（<CHEST_PICKUP_M=2），
  //   于是下一 tick 的「走近自动开箱」立刻把它吃掉：宝箱存在过，但玩家**永远看不到**，
  //   只看到一行「打开宝箱：干粮」的日志。
  //   两处修正：
  //     ① 掉落点从尸体随机散开 0.7~1.7 米（像"从尸体里崩出来"，不在脚下）；
  //     ② 带 bornTick，开启判定前有 CHEST_GRACE_TICKS 的保护期，先让玩家看见宝箱落地。
  const ang = rnd(0, Math.PI * 2);
  const off = 0.7 + rnd(0, 1.0);
  const cx = clampX(target.x + Math.cos(ang) * off);
  const cy = clampY(target.y + Math.sin(ang) * off);
  s.chests = Array.isArray(s.chests) ? s.chests : [];
  s.chests.push({
    id: `chest_kill_${s.tick}_${s.chests.length}`,
    x: cx,
    y: cy,
    opened: false,
    loot: { exp, money, item },
    tier: 1,
    bornTick: Math.round(num(s.tick, 0)),
  } as Chest);
  floater(s, "掉落宝箱", cx, cy - 40);
  pushEvent(s, `${target.name} 掉落了一个宝箱`);
}

/**
 * ★ 站桩假人回血（宿主侧，2026-10-29 新增/修）
 * ======================================
 * 「站桩模式」的设计：假人站着挨打，血条自动回复，**不还手、不给经验**。
 *
 * ★ 为什么必须放在宿主（而不是前端 E70 脚本的 setInterval）：
 *   假人的 hp 是**宿主权威**字段 —— 玩家打它的伤害在 entry.ts `damage()` 里结算。
 *   若「伤害在宿主、回血在前端」，两边各记一份账，永远对不上：
 *     宿主 damage() 185 → 113，回推给前端；
 *     前端合并时用自己的 185 覆盖 → 下一次上报又把 185 写回宿主 → **伤害被完全抹掉**。
 *   （实测：连打 3 刀，事件日志「普攻命中 伤害 72」×3，血量恒 185 不动。）
 *   ★ 伤害与回血**同源**（都在宿主）→ 账才对得上，前端只需做「模式切换 + UI」。
 *
 * 回血规则（与原 E70 前端实现一致，保持玩家可见的行为不变）：
 *   - 频率：每 1 秒（10 tick）一次
 *   - 血量：最大血量的 5%（至少 1 点），不超过 maxHp
 *   - 被打到 0 血 → 原地复活（满血）
 */
const STAND_REGEN_TICKS = 10;             // 每 10 tick（= 1 秒）回一次
const STAND_REGEN_RATIO = 0.05;           // 每次回 5%
/** 每 tick 递减的回血计时器（挂在实体上，不污染 Entity 类型） */
const STAND_REGEN_TIMER = "__standRegenTimer";

function standDummyRegen(s: FieldSurvivalState): void {
  for (const e of s.entities) {
    const ex = e as any;
    if (ex.trainingDummy !== true) continue;
    if (String(ex.dummyMode || "") !== "stand") continue;
    if (e.alive === false) continue;
    // 计时器递减
    let t = Math.max(0, num(ex[STAND_REGEN_TIMER], 0) - 1);
    // 被打到 0 血（死亡淡出期）→ 原地复活（满血）
    if (e.hp <= 0) {
      e.hp = Math.max(1, Math.round(num(e.maxHp, e.hp) || 1));
      (ex as any).deathMs = undefined;
      t = 0;
    } else if (t <= 0) {
      // 到点回血：5%（至少 1 点）
      const maxHp = Math.max(1, Math.round(num(e.maxHp, e.hp) || 1));
      if (e.hp < maxHp) {
        e.hp = Math.min(maxHp, e.hp + Math.max(1, Math.round(maxHp * STAND_REGEN_RATIO)));
      }
      t = STAND_REGEN_TICKS;
    }
    ex[STAND_REGEN_TIMER] = t;
  }
}

function damage(s: FieldSurvivalState, target: Entity, amount: number, attacker?: Entity) {
  // ★ AI 托管：玩家战斗状态打点（damage 是所有伤害的唯一入口 —— 普攻/技能/AI 攻击/怪物攻击都走这里）
  //   玩家参与（挨打或出手）即视为进入交战 → engaged。
  //   判据放在这里而不是「附近有敌人」，是因为战斗的开始必然产生一次伤害结算。
  if (amount > 0 && (target?.side === "player" || attacker?.side === "player")) {
    const pc = (s.playerCombat ||= {
      level: "none" as const,
      lastCombatTick: 0,
      sinceTick: 0,
      nearbyEnemies: 0,
    });
    pc.lastCombatTick = s.tick;
    if (pc.level !== "engaged") {
      pc.sinceTick = s.tick;
      pc.level = "engaged";
    }
  }
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  // ★ game.md 普攻特效：被击者白闪 + 命中火花/爆炸；攻击者小跳（amount=0 的「未命中」占位不触发）
  if (amount > 0) {
    (target as any).hitFlashMs = 250;
    pushVfx(s, { kind: "spark", entityId: target.id, x: target.x, y: target.y, life: 8, total: 8, color: "#ff5a5a" });
    pushVfx(s, { kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
    if (attacker) (attacker as any).actionBobMs = 300;
    floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
    // ★ P1 打击感：震屏 + 顿帧 + 击退（entry.ts 驱动，通过 state 传前端）
    s.screenShake = 6; s.screenShakeIntensity = 4;
    s.hitStopFrames = 3;
    if (attacker) {
      const dx = target.x - attacker.x, dy = target.y - attacker.y;
      const d = Math.hypot(dx, dy) || 1;
      (target as any).knockbackVx = (dx / d) * 0.4;
      (target as any).knockbackVy = (dy / d) * 0.4;
    }
  }
  //  ★ fix：必须加 `!(target as any).deathMs` 守卫 ——
  //   死亡淡出期（400ms = 4 tick）内 alive 仍为 true（见下方注释，故意不清 alive），
  //   此时再打这具尸体，`hp <= 0 && alive` 会**再次**成立 →
  //   击杀计数/经验/金钱/掉落宝箱被重复结算（实测：连打 3 下 kills +3、掉宝箱多摇 3 次）。
  //   表现：HUD 击杀数虚高、击杀类任务提前完成、一具尸体掉多个宝箱。
  //   deathMs 归零时同帧会置 alive=false，所以死亡后不会再进来。
  if (target.hp <= 0 && target.alive && !(target as any).deathMs) {
    (target as any).deathMs = 400;   // ★ P1 打击感：死亡淡出 400ms（alive 不清，等淡出结束后 tick 循环清）
    // target.alive = false;           // ← 不清！alive=false 会让前端不渲染实体，看不到淡出
    // ★ 任务板：护送货物被打掉 → 对应任务判失败（玩家可在任务板放弃后重接）
    if (String(target.id).startsWith(QUEST_CARGO_PREFIX)) {
      const qid = String(target.id).slice(QUEST_CARGO_PREFIX.length);
      const qp = (s.quests || {})[qid];
      if (qp && qp.status === "active") {
        qp.status = "failed";
        qp.failReason = "cargo";
        qp.cargoId = "";
        const qd = questById(s, qid);
        s.questNotice = `护送失败：${qd ? qd.title : qid}（货物被打掉了）`;
        pushEvent(s, `护送失败：${qd ? qd.title : qid}`);
      }
    }
    if ((target as any).trainingDummy === true) {
      // ★ 练习假人被摧毁：不给经验/金钱/掉落/宝箱（设计文档：模拟实战模式击碎才有经验，
      //   而那笔经验由事件脚本按 flag 发——这里只做"倒下"表现）。
      //   模拟实战模式下写 flag `dummy_destroyed_<实体id>`（事件脚本据此判定）；
      //   站桩模式下事件脚本自会回血，不写 flag。
      //   ★ setPlayerFlag 走 pluginData（player_flags 表）——与事件引擎 flagCache 同源。
      //   damage() 是同步函数拿不到 ctx，这里 fire-and-forget（后端 handle_action 闭包里的 context）。
      const dummyMode = String((target as any).dummyMode || "");
      if (dummyMode !== "stand") {
        const dummyFlagKey = `dummy_destroyed_${target.id}`;
        void setPlayerFlag(ctxRef?.(), dummyFlagKey, true);
        pushEvent(s, `${target.name} 散架了`);
      } else {
        // ★ 站桩模式：假人被打到 0 血不是「散架」，而是**原地复活**（standDummyRegen 负责回满）。
        //   文案要区分，否则玩家会以为站桩假人被永久打死了。
        pushEvent(s, `${target.name} 重新立了起来`);
      }
    } else if (target.side === "enemy") {
      s.kills += 1;
      // 优先地图 archetype 的赏金（map-gener agent 产出）
      const bounty = (target as any).bounty as { exp?: number; money?: number } | undefined;
      const expGain = bounty?.exp != null ? Math.round(num(bounty.exp, 10)) : 8 + target.level * 4;
      const moneyGain = bounty?.money != null ? Math.round(num(bounty.money, 8)) : 5 + target.level * 3;
      gainPlayerExp(s, expGain);      // ★ 等级系统：经验累加 + 升级判定（满血满蓝重算）
      s.money += moneyGain;
      if (Math.random() < 0.5) {
        const drop = ["野兽皮", "锋利的爪", "兽骨"][Math.floor(Math.random() * 3)];
        s.drops.push(drop);
      }
      // ★ 野怪击杀奖励①：概率在尸体处掉宝箱（玩家走过去开启，loot 里可能开出暗核）
      dropKillChest(s, target);
      // ★ 任务板：击杀类任务进度（名字包含匹配："尸傀王" 也算 "尸傀"）
      noteQuestKill(s, target.name);
      pushEvent(s, `击败 ${target.name}，获得 ${expGain} 经验、${moneyGain} 金钱`);
      // ★ v5：与用户组队的角色分享经验并升级
      grantPartyExp(s, expGain);
    } else {
      pushEvent(s, `${target.name} 倒下了`);
    }
  }
}

/* ============================================================
   ★ AI 托管：玩家战斗状态（频率判据，宿主权威）
   ------------------------------------------------------------
   为什么必须在宿主算：AI 的感知半径只有 13 米，而敌人在 20 米外时
   AI 根本看不到玩家被围 —— 这正是「玩家挨打、队友反应慢」的根因。
   宿主持有全部实体，能算准「玩家身边有没有威胁」。

   三态：
     engaged  — 玩家刚参与过伤害，且在 COMBAT_HOLD_TICKS 内（30s）
     skirmish — engaged 超时，但附近仍有敌人（未脱离接触）
     none     — 以上都不满足
   ============================================================ */

/** engaged 保持时长（30s = 300 tick，tick = 100ms） */
const COMBAT_HOLD_TICKS = 300;
/** skirmish 判据：附近多少米内有活敌 */
const COMBAT_NEARBY_ENEMY_M = 20;

/** 更新玩家战斗状态等级，并记录跃迁（供前端派发 AI 事件做边沿触发） */
function updatePlayerCombatState(s: FieldSurvivalState, player: Entity): void {
  const pc = (s.playerCombat ||= {
    level: "none" as const,
    lastCombatTick: -999999,
    sinceTick: 0,
    nearbyEnemies: 0,
  });

  // ① 统计玩家附近的活敌（skirmish 判据）
  let near = 0;
  for (const e of s.entities) {
    if (e.side !== "enemy" || e.alive === false) continue;
    if (dist(player, e) <= COMBAT_NEARBY_ENEMY_M) near += 1;
  }
  pc.nearbyEnemies = near;

  // ② 判定目标等级
  const prev = pc.level;
  let next: "none" | "skirmish" | "engaged" = prev;
  if (s.tick - pc.lastCombatTick <= COMBAT_HOLD_TICKS) {
    next = "engaged";
  } else if (near > 0) {
    next = "skirmish";
  } else {
    next = "none";
  }

  // ③ 跃迁：记录 from→to（前端消费一次后清空）
  if (next !== prev) {
    pc.level = next;
    pc.sinceTick = s.tick;
    pc.combatTransition = { from: prev, to: next, tick: s.tick };
    // 玩家脱离战斗时清掉「最近一次交战」的时间戳，避免下次交战被误判为 engaged
    if (next === "none") pc.lastCombatTick = -999999;
  }
}

function moveTowards(e: Entity, tx: number, ty: number, speed: number) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 0 : 180;   // 角度制：0=右 180=左
}

/* ------------------------------------------------------------
   ★ v4 区域系统工具（区域判定 / 城镇 / 区域刷新 / 野怪生成）
   ------------------------------------------------------------ */

/** 判断坐标落在哪个区域（城镇优先；野区取最近中心 —— 与六边形拓扑等价） */
function regionAt(x: number, y: number): RegionDef {
  const p = { x, y };
  const town = WORLD_REGIONS[0];
  if (dist(p, town) <= town.r) return town;
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** 离给定坐标最近的野区（城镇出生点用：敌对角色落点不在城镇内） */
function nearestWildRegion(x: number, y: number): RegionDef {
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/* ============================================================
   ★ fix⑤（缺口①）前端 localEnemies 载荷接管
   ------------------------------------------------------------
   前端 App.vue 在「本地敌怪集合结构性变化」时，把整份清单随 tick 上报：
     localEnemies = { epoch, bounds: { lx, ly }, list: [ 敌怪实体… ] }
     - list  ：mapmob_* / localmob_* / zone_* 三前缀的敌怪（前端权威集合）
     - bounds：当前关卡半宽/半高（米），如 Mulberry Forest 仅 ±29 m
   此前宿主对本载荷无任何处理逻辑 → 宿主实体表里没有这批怪，
   于是「玩家攻击不到野怪（恒未命中）」「野怪不攻击（宿主侧无此怪）」。
   本段实现：按 epoch 幂等重建宿主敌怪表，使其进入既有「野怪 AI + skill 命中判定」，
   并把野怪 AI 的游荡/追击/归位与生成落点夹进 bounds。
   ============================================================ */

/** 前端权威敌怪的 id 前缀（与 App.vue localEnemiesPayload 的过滤条件一致） */
const LOCAL_ENEMY_PREFIXES = ["mapmob_", "localmob_", "zone_"];

/** 是否「前端权威敌怪」的 id */
function isLocalEnemyId(id: unknown): boolean {
  const v = str(id);
  return LOCAL_ENEMY_PREFIXES.some((p) => v.startsWith(p));
}

/* ============================================================
   ★ 敌人碰撞（宿主侧）
   ------------------------------------------------------------
   墙的位置只有 iframe 侧知道（tileset 的 blocked 属性 + 地图 JSON 都在前端解），
   所以前端随 tick 把压缩位图传过来（params.walkGrid，只在切图那一次）：
     walkGrid = { epoch, grid: { v, cols, rows, firstGid, blocked, vision } }
   拿到网格后，敌人在 step() 的积分阶段改走带碰撞的位移：
   撞墙不是原地抖，而是按「与期望方向最接近」的顺序试其余方向 → 沿墙绕行。
   没收到网格 / 解码失败 → 完全退化为原来的直线位移（行为与旧版一致，不会崩）。

   ⚠️ 本段是 vue/src/collision.ts（stepWithAvoidance / resolveMove / isFreeAround）
      的**内联镜像**。宿主入口刻意不加任何 import：宿主加载器不一定支持相对/跨目录
      导入，一旦加载失败整个插件就挂，风险远大于这点重复。
      改算法时请同步三处：vue/src/collision.ts、entry.ts、entry.js。
   ============================================================ */

/** 宿主侧的最小网格（只需要挡住 / 不挡住；视野位图前端自己用） */
interface EnemyNavGrid { cols: number; rows: number; blocked: Uint8Array }
/** 当前关卡可行走网格；null = 无碰撞（与旧行为完全一致） */
let enemyNav: EnemyNavGrid | null = null;
/** 已应用的网格世代号（幂等，避免每 tick 重复解码同一份 base64） */
let enemyNavEpoch = "";
/** 敌人碰撞半径（米）。比玩家的 0.4 略小：1 米宽的窄门里不至于卡住 */
const ENEMY_NAV_R = 0.38;
/** ★ v6：ally / AI 托管角色碰撞半径。与敌人同值（同为 32px 精灵贴图，
 *   体型一致）；比玩家 0.4 小一点，避免 ally 跟玩家抢同一格时互相挤住。 */
const AI_NAV_R = 0.38;

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → 字节。不依赖 atob（宿主运行时未必有） */
function b64ToBytes(b64: string): Uint8Array | null {
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
  if (!clean) return null;
  const n = clean.length;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = B64_ALPHABET.indexOf(clean.charAt(i));
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

/**
 * 应用前端上报的网格。epoch 幂等；解码失败 → 保留旧网格（不降级成"无碰撞"，
 * 否则一次坏包就会让敌人穿墙一整局）。
 */
function applyEnemyNavPayload(payload: any): void {
  if (!payload || typeof payload !== "object") return;
  const epoch = str((payload as any).epoch, "");
  if (epoch && epoch === enemyNavEpoch) return;
  const pkt = (payload as any).grid;
  if (!pkt || num((pkt as any).v, 0) !== 1) return;
  const cols = num((pkt as any).cols, 0);
  const rows = num((pkt as any).rows, 0);
  const total = cols * rows;
  if (!(cols > 0) || !(rows > 0) || total > 4000000) return;
  const bytes = b64ToBytes(str((pkt as any).blocked, ""));
  if (!bytes || bytes.length !== total) {
    console.warn("[field-survival] walkGrid 载荷解码失败，保持上一份网格：", bytes?.length, total);
    return;
  }
  enemyNav = { cols, rows, blocked: bytes };
  enemyNavEpoch = epoch;
}

function navBlocked(g: EnemyNavGrid, gx: number, gz: number): boolean {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;   // 越界一律挡
  return g.blocked[gz * g.cols + gx] === 1;
}

/** 以 (x, y) 为中心、半径 r 的方内是否全可走（与玩家同一套判定） */
function navFree(g: EnemyNavGrid, x: number, y: number, r: number): boolean {
  const toGx = (mx: number) => Math.floor(mx + g.cols / 2);
  const toGz = (my: number) => Math.floor(my + g.rows / 2);
  if (r <= 0) return !navBlocked(g, toGx(x), toGz(y));
  const left = toGx(x - r);
  const right = toGx(x + r);
  const top = toGz(y - r);
  const bottom = toGz(y + r);
  return (
    !navBlocked(g, left, top) && !navBlocked(g, right, top) &&
    !navBlocked(g, left, bottom) && !navBlocked(g, right, bottom)
  );
}

/** 分轴求解：X 被挡只丢 X、Z 继续 → 撞墙可沿墙滑行；起点已在墙里则放行（自解困） */
function navResolve(
  g: EnemyNavGrid, x: number, y: number, nx: number, ny: number, r: number,
): { x: number; y: number } {
  if (!navFree(g, x, y, r)) return { x: nx, y: ny };
  let outX = x;
  let outY = y;
  if (navFree(g, nx, y, r)) outX = nx;
  if (navFree(g, outX, ny, r)) outY = ny;
  return { x: outX, y: outY };
}

/** 八向候选（顺序即"优先直行，然后偏 45°，最后偏 90°"） */
const NAV_DIRS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 带局部避障的一步位移：期望方向优先，被挡就按点积（方向相似度）试其余方向。
 * 不做 A*（几十只怪每 tick 各跑一次 A* 开销太大）；效果是沿墙绕行而不是原地抖。
 */
function navStep(
  g: EnemyNavGrid, x: number, y: number, dx: number, dy: number, step: number, r: number,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return { x, y };
  const ux = dx / len;
  const uy = dy / len;
  const order = NAV_DIRS
    .map(([ax, ay]) => {
      const l = Math.hypot(ax, ay);
      const nx = ax / l;
      const ny = ay / l;
      return { nx, ny, dot: nx * ux + ny * uy };
    })
    .filter((c) => c.dot > -0.35)                 // 不往回走
    .sort((a, b) => b.dot - a.dot);
  for (const c of order) {
    const nx = x + c.nx * step;
    const ny = y + c.ny * step;
    if (navFree(g, nx, ny, r)) return { x: nx, y: ny };
  }
  return navResolve(g, x, y, x + ux * step, y + uy * step, r);
}

/** 环状 BFS 找最近可站格（刷点压在墙上时用） */
function navNearestFree(
  g: EnemyNavGrid, x: number, y: number, r: number, maxRing = 8,
): { x: number; y: number } | null {
  const cgx = Math.floor(x + g.cols / 2);
  const cgz = Math.floor(y + g.rows / 2);
  const center = (gx: number, gz: number) => ({
    x: gx - g.cols / 2 + 0.5,
    y: gz - g.rows / 2 + 0.5,
  });
  if (navFree(g, x, y, r)) return { x, y };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let d = -ring; d <= ring; d++) {
      const cand: Array<[number, number]> = [
        [cgx + d, cgz - ring], [cgx + d, cgz + ring],
        [cgx - ring, cgz + d], [cgx + ring, cgz + d],
      ];
      for (const [gx, gz] of cand) {
        const c = center(gx, gz);
        if (navFree(g, c.x, c.y, r)) return c;
      }
    }
  }
  return null;
}

/** 带碰撞的一步敌方位移（无网格 → 原样直线位移，行为与旧版一致） */
function moveEnemyCollide(e: Entity, dx: number, dy: number): void {
  if (!enemyNav) { e.x += dx; e.y += dy; return; }
  const step = Math.hypot(dx, dy);
  if (step < 1e-6) return;
  const p = navStep(enemyNav, e.x, e.y, dx, dy, step, ENEMY_NAV_R);
  e.x = p.x;
  e.y = p.y;
}

/**
 * 把落在墙里 / 越界的敌怪挪到最近的合法格。
 * 刷点来源五花八门（Tiled 对象、环状随机、安全区推出），逐个改源头易漏 →
 * 统一在每 tick 的积分阶段做一次廉价纠正（合法位置的怪是 no-op）。
 */
function unstickEnemies(s: FieldSurvivalState): void {
  if (!enemyNav) return;
  for (const e of s.entities) {
    if (e.side !== "enemy" || !e.alive) continue;
    if (navFree(enemyNav, e.x, e.y, ENEMY_NAV_R)) continue;
    const c = navNearestFree(enemyNav, e.x, e.y, ENEMY_NAV_R);
    if (!c) continue;
    e.x = c.x;
    e.y = c.y;
    if ("homeX" in (e as any) && !navFree(enemyNav, num((e as any).homeX, c.y), ENEMY_NAV_R)) {
      (e as any).homeX = c.x;
    }
    if ("homeY" in (e as any) && !navFree(enemyNav, c.x, num((e as any).homeY), ENEMY_NAV_R)) {
      (e as any).homeY = c.y;
    }
  }
}

/**
 * 当前关卡 AI 边界（半宽/半高，米）：有前端 bounds 用 bounds，否则回退世界边界 ±1490
 */
function mapBound(s: FieldSurvivalState): { lx: number; ly: number } {
  const b = s.mapBounds;
  if (b && num(b.lx, 0) > 0 && num(b.ly, 0) > 0) return { lx: num(b.lx, 0), ly: num(b.ly, 0) };
  return { lx: WORLD_X_RANGE[1] - 10, ly: WORLD_Z_RANGE[1] - 10 };
}

/** 把坐标夹进当前关卡边界（仅用于野怪生成 / AI 落点，不改玩家位姿镜像） */
function clampToBound(s: FieldSurvivalState, x: number, y: number): { x: number; y: number } {
  const b = mapBound(s);
  return { x: clamp(x, -b.lx, b.lx), y: clamp(y, -b.ly, b.ly) };
}

/**
 * ★ 默认落点（库里没有该角色位置信息时才用）：在第一张图的可活动区域按索引均分分散，
 *   不再围着玩家出生点扎堆。只保证落在地图边界内；
 *   「不在墙里 / 障碍物里」由拿到前端 walkGrid 后的 fixSpawnWithNav 兜底校正。
 */
function defaultSpawnPoint(s: FieldSurvivalState, i: number, n: number): { x: number; y: number } {
  // 原点 (0,0) 为中心，20 米半径内按索引均分角度 + 随机半径 → 零散分布
  const cnt = Math.max(1, n | 0);
  const ang = ((i % cnt) / cnt) * Math.PI * 2 + rnd(0, Math.PI * 0.35);
  const rad = 6 + Math.random() * 14; // 6~20 米
  return clampToBound(s, Math.cos(ang) * rad, Math.sin(ang) * rad);
}

/**
 * ★ 拿到前端 walkGrid 后，把「未经碰撞校正」的落点推到最近可走格（防落进墙里 / 障碍物里）。
 *   start 那一刻必然没有 nav（网格来自前端上报），所以采用两段式：先落点 + 打标，后校正。
 */
function fixSpawnWithNav(s: FieldSurvivalState): void {
  if (!enemyNav || !Array.isArray(s.entities)) return;
  for (const e of s.entities) {
    if (!e || !(e as any)._needNavFix) continue;
    const free = navNearestFree(enemyNav, e.x, e.y, 0.4, 12)
      || navNearestFree(enemyNav, e.x, e.y, 0.4, 24);
    if (free) {
      e.x = free.x;
      e.y = free.y;
      (e as any).homeX = free.x;
      (e as any).homeY = free.y;
    }
    delete (e as any)._needNavFix;
  }
}

/** 某野区是否完全落在当前关卡之外（是 → 本图不存在该野区，不排刷，避免"每张图都有野怪"） */
function regionOutOfMap(s: FieldSurvivalState, r: RegionDef): boolean {
  const b = s.mapBounds;
  if (!b || !(num(b.lx, 0) > 0) || !(num(b.ly, 0) > 0)) return false;
  return Math.abs(r.x) - r.r >= num(b.lx, 0) || Math.abs(r.y) - r.r >= num(b.ly, 0);
}

/**
 * 按前端上报重建「当前关卡敌怪表」：
 *   ① epoch 未变（宿主状态回推）→ 幂等跳过；
 *   ② 先移除旧的 mapmob_/localmob_/zone_ 敌怪（含死亡残留与上一张图的怪）；
 *   ③ 按 list 逐个重建为宿主 Entity（homeX/homeY 取上报值或当前位，均夹进 bounds）。
 * 返回实际重建数量。
 */
function applyLocalEnemies(s: FieldSurvivalState, payload: any): number {
  // ★ fix⑥（缺口②）：前端 sendTick 只在 localMobsEpoch 变化时才发 localEnemies，
  //   但后端 applyLocalEnemies 假设每次 tick 都带。导致首次上报后后续 tick 永远收不到
  //   → entities 被清空 → AI 永远空跑 → 玩家永远不被攻击。
  //   修复：当本次 payload 为空（epoch 未变化），保留现有的本地敌怪不清空。
  if (!payload || typeof payload !== "object") {
    // 有已上线的本地敌怪 → 保持不动（别把上次建好的敌人又清掉）
    if (num(s.localMobsEpoch, 0) > 0) return -1; // -1 表示"保留"
    return 0;
  }
  const epoch = num((payload as any).epoch, 0);
  if (epoch > 0 && num(s.localMobsEpoch, 0) === epoch) {
    // ★ fix⑦：该世代"已接管"的前提是本地怪实体还在。start 重建 / restoreSys 恢复 /
    //   handleLevelChange 等路径会清空 entities 却保留 localMobsEpoch 标记 →
    //   此后前端永远发同一 epoch，后端永远 return 0 → 敌怪表死锁为空、AI 空跑
    //   （实测：tick 正常推进、events 显示"接入 11 只"但 entities 0 敌人）。
    //   怪还在 → 正常忽略回推；怪丢了 → fallthrough 幂等重建（1120 行先清残留再建）。
    //
    // ★★ 2026-10-29 下午误加又撤回的「同步 stand 假人 hp 到宿主」：
    //   当时为了让「站桩回血」传到宿主，在 epoch 相同时把前端上报的 hp 写回宿主。
    //   **这是错的** —— 前端上报的 hp 是**合并产物**（含前端的 clientOwnsHp 优先规则），
    //   不是权威值。宿主 damage() 扣的血（185→113）会被前端上报的 185 直接覆盖回去
    //   → **伤害被完全抹掉**（实测：连打 3 刀「普攻命中 伤害 72」，血量恒 185 不动）。
    //   ★ 正确口径：**hp 全程归宿主管**（伤害结算方），回血也必须在宿主做（见 step() 的
    //     standDummyRegen），前端只负责「站桩/实战」模式切换与 UI。
    const alive = s.entities.filter((e) => e.side === "enemy" && isLocalEnemyId(e.id)).length;
    if (alive > 0) return 0;
  }
  const b = ((payload as any).bounds || {}) as Record<string, unknown>;
  const lx = num(b.lx, 0);
  const ly = num(b.ly, 0);
  if (lx > 0 && ly > 0) s.mapBounds = { lx, ly };
  const list: any[] = Array.isArray((payload as any).list) ? (payload as any).list : [];
  // ② 清旧（幂等：重建前先清，避免跨图 / 跨世代残留）
  //   ★ 假人无论 side 都按 id 清 —— 否则中立假人（side=neutral）绕过过滤，
  //   每次 epoch 重建都再 push 一份 → 假人越积越多（实测 4 个变 12 个）。
  s.entities = s.entities.filter((e) =>
    !((e.side === "enemy" || (e as any).trainingDummy === true) && isLocalEnemyId(e.id)));
  // ②b 清掉「宿主自行在世界野区（240~480 m）刷出的怪」：
  //     前端上报了 bounds（小地图关卡）→ 前端权威清单代表当前关卡的敌怪，
  //     宿主 mob_ 怪必须**全清**（不能只清界外——野区半径 240m、边缘可延伸到 0，
  //     落在小地图 bounds 内的宿主怪会残留在安全区/城镇里，表现为"城里一堆野怪"）。
  //     非 mob_ 的宿主敌怪（如用户选择的敌对角色）仍只清界外的，防误删。
  if (lx > 0 && ly > 0) {
    s.entities = s.entities.filter((e) => {
      if (e.side !== "enemy" || isLocalEnemyId(e.id)) return true;
      return String(e.id).startsWith("mob_")
        ? false
        : Math.abs(e.x) <= lx && Math.abs(e.y) <= ly;
    });
  }
  // ③ 重建
  let built = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const side = str((raw as any).side);
    // ★ 练习假人无论 side 都要接管（stand=neutral 站桩 / duel+enemy 实战）；
    //   重建后 side 以前端为准 —— 不能强制 side="enemy"，否则中立假人被宿主
    //   当敌怪（AI 会追击玩家），站桩模式直接失效。
    const isDummy = (raw as any).trainingDummy === true;
    if (!isDummy && side && side !== "enemy") continue;              // 只接管敌怪（假人例外）
    if ((raw as any).alive === false) continue;                      // 已阵亡的不重建
    const id = str((raw as any).id);
    if (!id) continue;
    const lv = Math.max(1, Math.round(num((raw as any).level, 1)));
    const maxHp = Math.max(1, Math.round(num((raw as any).maxHp, num((raw as any).hp, 60)) || 60));
    const at = clampToBound(s, num((raw as any).x, 0), num((raw as any).y, 0));
    const e = makeEntity({ id, name: str((raw as any).name, "野怪"), hp: maxHp, level: lv }, "enemy", at.x, at.y, built);
    const ex = e as any;
    // ★ 假人：side 以前端为准（neutral=站桩没开打 / enemy=脚本已让实战开打）。
    //   makeEntity 只能造 enemy，这里覆写回来；宿主 AI 读 dummyMode 决定站桩不动。
    if (isDummy) e.side = (side === "ally" || side === "neutral" || side === "enemy") ? side as any : "neutral";
    e.hp = clamp(Math.round(num((raw as any).hp, maxHp)), 1, maxHp);  // 保留前端当前血量
    e.maxHp = maxHp;
    e.atk = Math.max(1, Math.round(num((raw as any).atk, e.atk)));
    e.facing = num((raw as any).facing, e.facing);
    e.cooldown = Math.max(0, Math.round(num((raw as any).cooldown, 0)));
    const home = clampToBound(s, num((raw as any).homeX, at.x), num((raw as any).homeY, at.y));
    ex.isLocal = true;                                               // 标记：AI 受 bounds 约束
    ex.regionId = str((raw as any).regionId, "local");
    ex.homeX = home.x;
    ex.homeY = home.y;
    ex.aiState = "idle";
    ex.wanderTimer = 0;
    //  ★ fix（练习假人）：必须把 trainingDummy / dummyMode 一起带过来 ——
    //   前端上报的实体里有这两个字段（switchLevel 注入时打的），
    //   但重建走的是 makeEntity（只认 id/name/hp/level 等固定字段），
    //   不显式透传就丢了 → 宿主侧 damage() 的
    //   `if (target.trainingDummy === true)` 永远不成立 →
    //     ① 假人被击碎时不写 `dummy_destroyed_<实体id>` flag
    //        （事件脚本轮询这个 flag 发经验 → 击碎永远没奖励）；
    //     ② 假人被当普通野怪结算 → 击杀计数/金钱/掉落全错。
    //   dummyMode 决定是「站桩」（不写 flag，脚本自己回血）还是「模拟实战」（写 flag）。
    if ((raw as any).trainingDummy === true) {
      ex.trainingDummy = true;
      ex.dummyMode = str((raw as any).dummyMode, "") || undefined;
    }
    if ((raw as any).bounty && typeof (raw as any).bounty === "object") ex.bounty = { ...(raw as any).bounty };
    //  ★ fix：`dropTable` 必须一起带过来 —— 地图 `enemy_archetypes[].dropTable`
    //   是「这张图的怪掉什么」的权威配置（如走廊层 BOSS 必掉暗核）。
    //   原来只透传 bounty，dropTable 被丢掉 → dropKillChest 只能落回 DEFAULT_DROP_TABLE，
    //   地图配的掉落表形同虚设（前端 localEnemiesPayload 是把整份实体发过来的，字段就在里面）。
    if (Array.isArray((raw as any).dropTable) && (raw as any).dropTable.length) {
      ex.dropTable = (raw as any).dropTable.map((d: any) => ({ name: str(d?.name, ""), w: num(d?.w, 1) }))
        .filter((d: any) => d.name);
    }
    s.entities.push(e);
    built += 1;
  }
  s.localMobsEpoch = epoch > 0 ? epoch : num(s.localMobsEpoch, 0);
  return built;
}

/** 各区域野怪名称（刻意与前端 mobKeyFor 的精灵映射对齐：
 *  狼/兽→orc、蛇→snake、蝠→bat、骷髅→skeleton、默认→goblin） */
const REGION_MOB_NAMES: Record<string, string[]> = {
  wood:  ["巨狼", "哥布林斥候"],
  shore: ["毒蛇", "蝙蝠"],
  mine:  ["骷髅兵", "哥布林斥候"],
  ruin:  ["骷髅兵", "荒野游荡者"],
  marsh: ["毒蛇", "巨狼"],
  wild:  ["哥布林斥候", "巨狼", "荒野游荡者"],
};

/** 野怪属性模板（无地图数据时的内置保底，与前端兜底野怪同源） */
const MOB_PRESETS: Record<string, { hp: number; atk: number }> = {
  "哥布林斥候": { hp: 30, atk: 6 },
  "巨狼":       { hp: 60, atk: 10 },
  "毒蛇":       { hp: 25, atk: 8 },
  "蝙蝠":       { hp: 20, atk: 5 },
  "骷髅兵":     { hp: 50, atk: 12 },
  "荒野游荡者": { hp: 40, atk: 6 },
};

let _mobSeq = 0;

/** 初始化区域运行时状态（进入 playing 时调用；旧 state 缺 regions 时在 tick 里自愈补建） */
function initRegions(s: FieldSurvivalState): void {
  s.regions = WORLD_REGIONS.map((r) => ({
    id: r.id, name: r.name, short: r.short, kind: r.kind,
    x: r.x, y: r.y, r: r.r, safe: r.safe, lv: r.lv, mobs: r.mobs, desc: r.desc,
    aliveCount: 0, playerInside: false, leftTick: -1, nextSpawnTick: -1, spawnCount: 0,
  }));
}

/** 某区域内当前存活的野怪数量 */
function countAliveInRegion(s: FieldSurvivalState, regionId: string): number {
  let n = 0;
  for (const e of s.entities) {
    if (e.side === "enemy" && e.alive !== false && (e as any).regionId === regionId) n++;
  }
  return n;
}

/** 在区域内取一个合法落点（避让城镇安全缓冲；尽量不贴脸玩家） */
function regionSpawnPoint(s: FieldSurvivalState, region: RegionDef): { x: number; y: number } {
  const player = s.entities.find((e) => e.side === "player");
  const town = WORLD_REGIONS[0];
  let x = region.x, y = region.y;
  for (let t = 0; t < 8; t++) {
    const a = rnd(0, Math.PI * 2);
    const d = region.r * (0.35 + rnd(0, 0.55));      // 0.35r ~ 0.9r：落点留在本区域内
    // ★ fix⑤：落点同时夹进「当前关卡 bounds」（前端上报）与世界边界
    const cb = clampToBound(s, region.x + Math.cos(a) * d, region.y + Math.sin(a) * d);
    const cx = clampX(cb.x);
    const cy = clampY(cb.y);
    if (Math.hypot(cx - town.x, cy - town.y) < town.r + TOWN_SPAWN_BUFFER_M) continue;  // 不进城镇
    if (player && player.alive && Math.hypot(cx - player.x, cy - player.y) < 12) continue;  // 不贴脸
    x = cx; y = cy;
    break;
  }
  return { x, y };
}

/** 在指定区域生成 n 只野怪（★ v4：敌人复活即由此重新生成，不再依赖 alive=false 残留实体） */
function spawnRegionMobs(s: FieldSurvivalState, region: RegionDef, n: number): void {
  const names = REGION_MOB_NAMES[region.id] || ["荒野游荡者"];
  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length) ? s.map.enemy_archetypes : null;
  const lv = Math.max(1, region.lv);
  for (let i = 0; i < n; i++) {
    const name = names[(_mobSeq + i) % names.length];
    const at = regionSpawnPoint(s, region);
    const preset = MOB_PRESETS[name] || { hp: 40, atk: 6 };
    const arch = archs ? archs[(_mobSeq + i) % archs.length] : null;
    const hp = Math.round((arch ? num(arch.hp, preset.hp) * 0.6 : preset.hp) + (lv - 1) * 10);
    const e = makeEntity({ id: `mob_${region.id}_${_mobSeq++}`, name, hp, level: lv }, "enemy", at.x, at.y, i);
    e.atk = Math.round((arch ? num(arch.atk, preset.atk) * 0.6 : preset.atk) + (lv - 1) * 2);
    (e as any).regionId = region.id;
    (e as any).homeX = at.x;
    (e as any).homeY = at.y;
    (e as any).aiState = "idle";
    (e as any).wanderTimer = 0;
    (e as any).bounty = (arch && (arch as any).bounty)
      ? { ...(arch as any).bounty }
      : { exp: 8 + lv * 4, money: 5 + lv * 3 };
    s.entities.push(e);
  }
}

/** 区域刷新计时器：玩家离开某区域 → 该区域 45 秒后刷新一次（补满配额） */
function regionTick(s: FieldSurvivalState, player: Entity): void {
  // ★ 前端已接管敌怪管理（localEnemies 权威清单）→ 宿主世界野区排刷全部停用：
  //   否则宿主会把世界坐标的 mob_ 怪刷进小地图 bounds 内，城镇安全区也会出现野怪
  if (num(s.localMobsEpoch, 0) > 0) return;
  if (!Array.isArray(s.regions) || !s.regions.length) initRegions(s);
  if (!s.town || !(s.town as any).buildings) ensureTown(s);
  const cur = regionAt(player.x, player.y);
  for (const r of s.regions!) {
    const inside = r.id === cur.id;
    r.aliveCount = countAliveInRegion(s, r.id);
    if (inside) {
      // 玩家在场：刷新计时挂起（不刷新），清除"刚离开"排期
      r.playerInside = true;
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    const wasInside = r.playerInside;
    r.playerInside = false;
    if (r.safe) continue;                              // 城镇（安全区）永不刷新野怪
    // ★ fix⑤（缺口①）：区域圆心落在当前关卡之外 → 本图不存在该野区，不排刷
    //   （否则任何一张小地图都会被宿主的世界级六野区持续补怪，表现为"每张图都有野怪"）
    if (regionOutOfMap(s, r)) {
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    if (wasInside || r.nextSpawnTick < 0) {
      // 玩家刚离开该区域（或从未排期）→ 从此刻起 45 秒后刷新一次
      r.leftTick = s.tick;
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;
      continue;
    }
    if (s.tick >= r.nextSpawnTick) {
      const gap = Math.max(0, r.mobs - r.aliveCount);
      if (gap > 0) {
        spawnRegionMobs(s, r, gap);
        r.spawnCount += 1;
        pushEvent(s, `「${r.name}」重新聚集了 ${gap} 只野怪`);
      }
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;  // 持续驻留刷新（每 45s 一次）
    }
  }
}

/**
 * 城镇（安全区）建筑清单
 *
 * 坐标单位「米」，矩形中心 + 宽高。
 * w / h 现在是「瓦片数」（1 瓦片 ≈ 1 米，与 Rotten-Soup mulberryTown.json
 * 单格对齐），前端按 tileset 真实像素平铺绘制。
 *   - inn   6×7 大体量双段屋顶（与 RS 大屋相近）
 *   - shop  5×6 中型铺面
 *   - house 4×5 标准民居（mulberryTown.json 主要房屋尺寸）
 *   - well  2×2 水井
 */
const TOWN_BUILDINGS: Array<{ kind: string; name: string; x: number; y: number; w: number; h: number }> = [

];

/** 城镇中立角色（不参与战斗，仅作安全区氛围） */
const TOWN_NPCS: Array<{ name: string; x: number; y: number }> = [
];

/** 建立城镇（安全区）：建筑清单 + 中立角色实体（幂等） */
function ensureTown(s: FieldSurvivalState): void {
  const town = WORLD_REGIONS[0];
  if (!s.town || !(s.town as any).buildings) {
    // 城镇名跟随当前关卡（不再一律「晨曦镇」）
    const townName = str(s.levelName, "") || town.name;
    s.town = {
      id: town.id, name: townName, x: town.x, y: town.y, r: town.r, safe: true,
      buildings: TOWN_BUILDINGS.map((b, i) => ({ ...b, id: `b_${i}` })),
      npcs: TOWN_NPCS.map((n, i) => ({ id: `npc_${i}`, ...n })),
    };
  }
  if (!s.entities.some((e) => e.side === "neutral")) {
    TOWN_NPCS.forEach((n, i) => {
      const e = makeEntity({ id: `npc_${i}`, name: n.name, hp: 200 }, "neutral", n.x, n.y, i);
      e.atk = 0;
      e.facing = [0, 90, 180, 270][i % 4];
      (e as any).regionId = town.id;
      (e as any).homeX = n.x;
      (e as any).homeY = n.y;
      (e as any).aiState = "npc";
      s.entities.push(e);
    });
  }
}

function step(s: FieldSurvivalState, input: any, poseHint?: any) {
  // 速度统一为"米/秒"，位移按 MOVE_SPEED_M × TICK_DT_S 积分
  const speed = MOVE_SPEED_M;
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;

  /* ★ 关键修复（坐标双写）：玩家位姿的权威在客户端。
     game.html 每 100ms 已在本地推进一次玩家坐标，并通过 tick 参数的 player 字段上报；
     宿主侧只镜像该结果，不再用 input.dx/dy 重复积分玩家，
     避免双写导致位移被回退（走一小步就停）或松手后瞬移。 */
  const pose = poseHint || input?.player;
  if (pose && Number.isFinite(num(pose.x, NaN)) && Number.isFinite(num(pose.y, NaN))) {
    player.x = clampX(num(pose.x, player.x));
    player.y = clampY(num(pose.y, player.y));
    player.facing = num(pose.facing, player.facing);
    player.vx = 0;
    player.vy = 0;
  } else {
    // 兼容旧客户端（未上报 player）：退化为宿主侧积分，速度同样按 米/秒 × dt
    const dx = num(input?.dx, 0);
    const dy = num(input?.dy, 0);
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      const len = Math.hypot(dx, dy) || 1;
      player.vx = (dx / len) * speed;
      player.vy = (dy / len) * speed;
      player.facing = dx > 0 ? 0 : dx < 0 ? 180 : (dy > 0 ? 90 : 270);
    } else if (input?.moveTo) {
      const tx = num(input.moveTo.x, player.x);
      const ty = num(input.moveTo.y, player.y);
      if (dist(player, { x: tx, y: ty }) > 1.0) moveTowards(player, tx, ty, speed);   // 米/秒
      else { player.vx = 0; player.vy = 0; }
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }

  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  // ★ v5：只有「组队跟随」勾选中的角色才跟随用户参战；未组队的原地待命
  const partyIds = Array.isArray(s.partyIds) ? s.partyIds : [];
  // ★ AI 托管：把 _aiManaged 标记的角色也加入驱动列表（即使不在 partyIds）
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive && (partyIds.indexOf(e.id) >= 0 || (e as any)._aiManaged));

  allies.forEach((a, i) => {
    // ★ AI 托管：检查是否设了 AI 目标（_aiMoveTo / _aiAttackTarget）；否则用默认行为
    const aiTarget = (a as any)._aiAttackTarget ? s.entities.find((e: any) => e.id === (a as any)._aiAttackTarget && e.alive) : null;
    const aiMove = (a as any)._aiMoveTo;
    const isAIManaged = !!(a as any)._aiManaged;

    // 攻击目标：AI 指定 > （入队角色锚玩家 4m / AI托管角色独立感知 13m）
    let target: Entity | null = aiTarget;
    if (!target) {
      if (partyIds.indexOf(a.id) >= 0) {
        // 入队角色：保持 entry.ts 既有修正——锚定玩家身边 4m 的敌人，避免「打远的」
        target = enemies
          .filter((e: any) => dist(player, e) < ALLY_ENGAGE_M)
          .reduce<Entity | null>((best, e) =>
            !best || dist(player, e) < dist(player, best) ? e : best, null);
      } else if (isAIManaged) {
        // AI 托管（未入队）：独立感知 13m 内最近敌人
        target = enemies
          .filter((e: any) => dist(a, e) < AI_MANAGED_ENGAGE_M)
          .reduce<Entity | null>((best, e) =>
            !best || dist(a, e) < dist(best, e) ? e : best, null);
      }
    }

    // 移动目标：AI 指定 > 队伍 anchor（跟玩家）> AI 角色原地待命
    let moveX: number, moveY: number, doMove = true;
    if (aiMove && (s.tick - ((a as any)._aiMoveToTick || 0)) < 600) {  // 60秒内有效
      moveX = aiMove.x;
      moveY = aiMove.y;
      if (dist(a, aiMove) < 0.5) {
        delete (a as any)._aiMoveTo;
        delete (a as any)._aiMoveToTick;
      }
    } else if (partyIds.indexOf(a.id) >= 0) {
      const anchor = {
        x: player.x + Math.cos((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
        y: player.y + Math.sin((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
      };
      moveX = anchor.x;
      moveY = anchor.y;
    } else {
      // AI 托管但不在队伍：原地待命（不主动移动，等大脑 ai_command）
      doMove = false;
      moveX = a.x;
      moveY = a.y;
    }

    /* ★ v6 避障（修 AI 卡墙）：原来 moveTowards 是「直线给速度」，
     *   撞墙时 isActionComplete 的 dist<0.8 永不满足 → AI 卡在移动态 60 秒
     *   （_aiMoveTo 超时才清）。改为复用 enemyNav 的 navStep（八向局部避障，
     *   注释见 navStep：「沿墙绕行而不是原地抖」）。无网格（切图首拍）退回直线。 */
    const dstX = target ? target.x : moveX;
    const dstY = target ? target.y : moveY;
    if (enemyNav && (target || doMove)) {
      const step = speed * 0.8 * TICK_DT_S;
      const p = navStep(enemyNav, a.x, a.y, dstX - a.x, dstY - a.y, step, AI_NAV_R);
      a.x = p.x;
      a.y = p.y;
      if (Math.abs(dstX - a.x) > 2) a.facing = dstX > a.x ? 0 : 180;
    } else if (target) {
      moveTowards(a, target.x, target.y, speed * 0.92);
    } else if (doMove) {
      moveTowards(a, moveX, moveY, speed * 0.8);
    }
    if (target && dist(a, target) < ALLY_ATK_M && a.cooldown <= 0) {
      damage(s, target, a.atk, a);
      a.cooldown = 30;
    }
  });
  // ★ AI 托管订单执行：采集到点结算 / 交互到点触发（必须在移动循环之后）
  tickAIOrders(s);

  // ★ #ai 指令通用应用器：任意非玩家/非 ally 实体（NPC / neutral / 未入队角色）带 _aiMoveTo 即移动。
  //   AI 托管勾选只决定 ally 循环是否接管；#ai 命令要对「任意对话角色」生效，故这里通用处理。
  s.entities.forEach((a) => {
    if (a.side === "player" || a.side === "ally") return;
    const mv = (a as any)._aiMoveTo;
    if (!mv) return;
    // ★ v6 避障：与 ally 循环同源——NPC 被 #ai 派活时也走 navStep，撞墙能绕而不是卡 60s
    if (enemyNav) {
      const step = speed * 0.8 * TICK_DT_S;
      const p = navStep(enemyNav, a.x, a.y, mv.x - a.x, mv.y - a.y, step, AI_NAV_R);
      a.x = p.x;
      a.y = p.y;
      if (Math.abs(mv.x - a.x) > 2) a.facing = mv.x > a.x ? 0 : 180;
    } else {
      moveTowards(a, mv.x, mv.y, speed * 0.8);
    }
    if (dist(a, mv) < 0.5) {
      delete (a as any)._aiMoveTo;
      delete (a as any)._aiMoveToTick;
    }
  });

  // ★ v4 敌人 AI：探测半径 10 米（MOB_DETECT_M）→ 追击 → 2 米攻击
  //          → 超出 12 米（MOB_DISENGAGE_M）脱战 → 归位巢点并在 8 米内游荡
  // ★ 站桩假人回血（2026-10-29 修）：**回血与伤害必须同源（都在宿主）**，
  //   否则两边永远对不上账。之前的做法是「伤害在宿主、回血在前端 E70 脚本」，
  //   结果：宿主 damage() 把血打到 113，前端合并时用自己的 185 覆盖回来 →
  //   **伤害被完全抹掉**（实测连打 3 刀「伤害 72」，血量恒 185）。
  standDummyRegen(s);
  enemies.forEach((e) => {
    const ex = e as any;
    //  ★ 练习假人「站桩模式」：站桩 = 站着挨打，**不追击、不攻击**。
    //   dummyMode 由前端事件脚本设置（stand/duel），宿主 AI 必须认它 ——
    //   否则站桩假人也会冲过来打玩家（实测：选「站桩模式」后假人照样扑上来）。
    //   模拟实战（duel / 未设置）→ 走正常敌人 AI，会追击会攻击。
    if (ex.trainingDummy === true && String(ex.dummyMode || "") === "stand") {
      e.vx = 0; e.vy = 0;
      ex.aiState = "idle";
      return;
    }
    const prey = [player, ...allies].filter((t) => t.alive)
      .reduce<Entity | null>((best, t) => (!best || dist(e, t) < dist(e, best) ? t : best), null);
    const home = { x: num(ex.homeX, e.x), y: num(ex.homeY, e.y) };   // 巢点（无则取当前位）
    const preyIn = prey ? dist(e, prey) : Infinity;
    // ① 追击态：超出脱战半径 → 停止追击（转归位）；否则贴身攻击/继续接近
    if (ex.aiState === "chase") {
      if (!prey || preyIn > MOB_DISENGAGE_M) {
        ex.aiState = "return";
        e.vx = 0; e.vy = 0;
        return;
      }
      if (preyIn > MOB_ATK_M) { const t = clampToBound(s, prey!.x, prey!.y); moveTowards(e, t.x, t.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk, e); e.cooldown = 45; }
      return;
    }
    // ② 巡逻态：探测半径内发现玩家/盟友 → 进入追击
    if (prey && preyIn <= MOB_DETECT_M) {
      ex.aiState = "chase";
      if (preyIn > MOB_ATK_M) { const t = clampToBound(s, prey.x, prey.y); moveTowards(e, t.x, t.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk, e); e.cooldown = 45; }
      return;
    }
    // ③ 脱战/巡逻：离巢超过 8 米 → 归位；否则在巢点周围小范围游荡（绝不全图直线追）
    if (ex.aiState !== "idle" && ex.aiState !== "npc") { ex.aiState = "idle"; ex.wanderTimer = 0; }
    if (dist(e, home) > MOB_LEASH_R_M) {
      moveTowards(e, home.x, home.y, speed * 0.55);
      ex.wanderTimer = 0;
      return;
    }
    if (!(num(ex.wanderTimer, 0) > 0)) {
      const wa = rnd(0, Math.PI * 2);
      const wr = rnd(2, MOB_WANDER_R_M);
      // ★ fix⑤：游荡点同样夹进当前关卡边界（森林 ±29 m 时不再飘到界外）
      const w = clampToBound(s, home.x + Math.cos(wa) * wr, home.y + Math.sin(wa) * wr);
      ex.wanderX = w.x;
      ex.wanderY = w.y;
      ex.wanderTimer = Math.round(rnd(30, 90));
    }
    ex.wanderTimer = num(ex.wanderTimer, 0) - 1;
    const wx = num(ex.wanderX, home.x);
    const wy = num(ex.wanderY, home.y);
    if (Math.hypot(wx - e.x, wy - e.y) > 1) moveTowards(e, wx, wy, speed * 0.35);
    else { e.vx = 0; e.vy = 0; }
  });

  // 积分、冷却、越界（边界 ±1490 = WORLD ±1500 - 10，与前端 WORLD_LIMIT_M 一致；速度 m/s × dt）
  // ★ fix⑤：前端权威敌怪（isLocal）改用「当前关卡 bounds」夹取，避免被推出本图可行走区
  // ★ 敌人碰撞：先把上一帧落在墙里/界外的怪挪出来，再积分；位移走带避障的 navStep
  unstickEnemies(s);
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    // ★ 打击特效衰减：hitFlashMs / actionBobMs 每 tick -100ms（与 dev-host 同步）
    if ((e as any).hitFlashMs > 0) (e as any).hitFlashMs = Math.max(0, (e as any).hitFlashMs - 100);
    if ((e as any).actionBobMs > 0) (e as any).actionBobMs = Math.max(0, (e as any).actionBobMs - 100);
    // ★ P1 打击感：击退速度每 tick ×0.75 衰减，归零后清除
    if ((e as any).knockbackVx != null || (e as any).knockbackVy != null) {
      e.vx += (e as any).knockbackVx || 0;
      e.vy += (e as any).knockbackVy || 0;
      (e as any).knockbackVx = ((e as any).knockbackVx || 0) * 0.75;
      (e as any).knockbackVy = ((e as any).knockbackVy || 0) * 0.75;
      if (Math.abs((e as any).knockbackVx) < 0.001) (e as any).knockbackVx = undefined;
      if (Math.abs((e as any).knockbackVy) < 0.001) (e as any).knockbackVy = undefined;
    }
    // ★ P1 打击感：死亡淡出衰减（每 tick -100ms，归零后标记 alive=false 移除）
    if ((e as any).deathMs != null && (e as any).deathMs > 0) {
      (e as any).deathMs = Math.max(0, (e as any).deathMs - 100);
      if ((e as any).deathMs === 0) e.alive = false;
    }
    const nx = e.x + e.vx * TICK_DT_S;
    const ny = e.y + e.vy * TICK_DT_S;
    if (e.side === "enemy" && (e as any).isLocal) {
      const p = clampToBound(s, nx, ny);
      if (enemyNav) moveEnemyCollide(e, p.x - e.x, p.y - e.y);
      else { e.x = p.x; e.y = p.y; }
    } else if (e.side === "enemy" && enemyNav) {
      // 宿主自己刷的敌怪也走同一套碰撞（只加碰撞，边界夹取保持原逻辑不变）
      moveEnemyCollide(e, clampX(nx) - e.x, clampY(ny) - e.y);
    } else {
      e.x = clampX(nx);
      e.y = clampY(ny);
    }
  });
  s.skills.forEach((k) => { if (k.cdLeft > 0) k.cdLeft -= 1; });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);
  // ★ 打击特效衰减：vfx life 每 tick -1
  const _vfx = (s as any).vfx;
  if (Array.isArray(_vfx) && _vfx.length) (s as any).vfx = _vfx.filter((v: any) => { v.life -= 1; return v.life > 0; });

  // 宝箱：走过去开启（优先地图 loot）
  s.chests.forEach((c) => {
    if (c.opened) return;
    // ★ 保护期：刚掉落的宝箱 1.2 秒内不许自动开（先让玩家看见它落在地上）
    if (c.bornTick != null && Math.round(num(s.tick, 0)) - Math.round(num(c.bornTick, 0)) < CHEST_GRACE_TICKS) return;
    if (dist(player, c) < CHEST_PICKUP_M) {
      c.opened = true;
      const loot = (c as any).loot as { exp?: number; money?: number; item?: string } | undefined;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["生锈的钥匙", "干粮", "荧光石"][Math.floor(Math.random() * 3)];
      gainPlayerExp(s, expGain);      // ★ 等级系统：开箱经验同样走升级判定
      s.money += moneyGain;
      s.drops.push(drop);
      // ★ 野怪击杀奖励：开箱物资真的进背包（原本只进 s.drops 日志，暗核点不到「使用」）
      addBagItemToCard(s, drop, 1);
      floater(s, `宝箱 +${expGain}exp`, c.x, c.y);
      floater(s, `+${drop}`, c.x, c.y - 22);
      pushEvent(s, `打开宝箱：${drop}，+${expGain} 经验，+${moneyGain} 金钱`);
    }
  });

  // 血瓶：走过去回血
  s.potions = s.potions.filter((p) => {
    if (dist(player, p) >= POTION_PICKUP_M) return true;
    const before = player.hp;
    player.hp = clamp(player.hp + p.heal, 0, player.maxHp);
    floater(s, `+${Math.round(player.hp - before)}`, player.x, player.y - 24);
    pushEvent(s, `拾取血瓶，恢复 ${Math.round(player.hp - before)} 点生命`);
    return false;
  });

  // ★ v4 区域刷新：敌人复活改为「随区域刷新机制重新生成」——
  //   先把本帧阵亡的敌人实体从世界移除（不再保留 alive=false 的残留实体）
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && e.alive === false));

  // ★ v4 每个区域各自维护刷新计时：玩家离开该区域 45 秒后刷新一次野怪
  //   （城镇安全区不刷新；不再用 enemies.length===0 触发清场补波）
  regionTick(s, player);

  // ★ AI 托管：更新玩家战斗状态等级（频率判据，宿主权威）
  updatePlayerCombatState(s, player);

  // 死亡判定
  if (!player.alive && s.phase === "playing") {
    s.phase = "over";
    s.result = {
      reason: "death",
      exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick,
    };
    pushEvent(s, "你倒下了……");
  }
}

/* ============================================================
   ★ v5：系统面板（背包 / 纳戒 / 商城 / 技能 / 地图 / 角色卡）
   ------------------------------------------------------------
   · 背包 / 技能 / 金钱 与用户「动态参数卡」双向同步：
       插件侧改动 → state.writeback → 宿主写回 stateJson 参数卡；
       宿主每 tick 注入的 ctx.playerCard 是外部改动的权威来源。
   · 纳戒 / 队伍 / 角色卡位置 / 背包顺序 / 商城 → t_plugin_session_data(sys_state)
   · 商城物资 = 商城 agent（故事动态数据 + 常驻世界书）+ 插件自带物资
   ============================================================ */

export interface BagItem {
  name: string; count: number; quantity?: number; kind: string; rarity: string; heal: number; price: number; desc?: string;
  /** ★ game.md 物品修改：战斗参数（mergeBag 时从 itemMeta / 推断默认合并） */
  power?: number; cost?: number; cd?: number; cdLeft?: number;
  type?: "atk" | "heal" | "buff" | "attribute"; range?: "melee" | "ranged";
  lv?: number; buff_type?: string;
  durability?: number; durabilityLeft?: number;
  attribute_type?: string; attribute_value?: number;
  /** ★ P2 技能属性特效 */
  effects_type?: string;
}
/** ★ game.md 物品修改：itemMeta 持久化结构（t_plugin_session_data） */
export interface ItemMeta {
  power: number; cost: number; cd: number;
  type: "atk" | "heal" | "buff" | "attribute"; range: "melee" | "ranged";
  lv: number; buff_type: string;
  durability: number; durabilityLeft: number;
  attribute_type: string; attribute_value: number;
  /** ★ game.md：数量与描述（描述保留参数卡原注记全文） */
  quantity: number; description: string;
  /** ★ P2 技能属性特效（空串/缺省 = 走默认 VFX） */
  effects_type?: string;
}
export interface ShopGood { id: string; name: string; price: number; kind: string; rarity: string; heal: number; desc?: string; from: string; cat?: string; }
export interface NpcCard {
  id: string; name: string; side: string; enemy: boolean;
  level: number; hp: number; maxHp: number; exp: number; alive: boolean;
  /** ★ game.md 等级系统：蓝量 / 下级升级所需经验（= 等级*100） */
  mp?: number; maxMp?: number; next_level_exp?: number;
  mapName: string; x: number; y: number; inParty: boolean; avatarPath?: string;
  /** ★ 实体立绘（与 avatarPath 独立：data:URL 时 canvas 走自定义图） */
  customSprite?: { image: string; prompt?: string; source?: "ai" | "upload" | "preset"; createdAt?: number } | null;
  /** ★ game.md 角色卡：动态参数卡（结构化字段由前端展开渲染，实时值已由宿主覆盖） */
  parameterCardJson?: Record<string, any> | null;
}
export interface RingStore { items: BagItem[]; skills: string[]; }
export interface MapNode { name: string; x: number; y: number; }
export interface TeleportTarget { mapName: string; x: number; y: number; name: string; rev: number; }
export interface SysSnapshot {
  ring: RingStore; party: string[]; npcCards: NpcCard[];
  bagMeta: Record<string, BagItem>; bagOrder: string[];
  shop: ShopGood[]; level: string;
}

/** 系统面板持久化 dataKey（t_plugin_session_data） */
const SYS_DATA_KEY = "sys_state";
// ★ game.md 对话功能：AI 故事角色位置/地图信息的持久化键（写入 t_plugin_session_data 表）
const AI_STORY_ROLES_KEY = "ai_story_roles";
/** 每 N 帧把系统数据落一次库（避免每 tick 都写） */
const SYS_PERSIST_EVERY_TICKS = 20;

/** ★ P2 技能属性特效：effects_type → VFX 主色调（md/游戏特效.md P2 对照表） */
const EFFECT_COLOR: Record<string, string> = {
  normal:  "#eeeeee",
  fire:    "#ff4422",
  water:   "#33bbff",
  thunder: "#f8ff33",
  wind:    "#a8ffdd",
  earth:   "#b88646",
  metal:   "#ffdd66",
  wood:    "#46cc55",
  light:   "#fffcd0",
  dark:    "#662288",
  poison:  "#88dd22",
  bleed:   "#bb1122",
};
/** 解析 effects_type 主色调；缺省/未知 → fallback（沿用默认色） */
function effectColor(effectsType: unknown, fallback: string): string {
  const c = EFFECT_COLOR[String(effectsType || "")];
  return c || fallback;
}

/** ★ P2.5 属性法术图标：effects_type → public/images/spells 下的 26×26 像素图标（前端 drawIconBurst 叠加渲染） */
const EFFECT_ICON: Record<string, string> = {
  normal:  "images/spells/enchantment/sure_blade.png",
  fire:    "images/spells/fire/fireball.png",
  water:   "images/spells/ice/freeze.png",
  thunder: "images/spells/air/lightning_bolt.png",
  wind:    "images/spells/air/tornado.png",
  earth:   "images/spells/earth/iron_shot.png",
  metal:   "images/spells/earth/iron_shot.png",
  wood:    "images/spells/poison/poison_arrow.png",
  light:   "images/spells/restoration/minor_heal.png",
  dark:    "images/spells/necromancy/agony.png",
  poison:  "images/spells/poison/alistairs_intoxication.png",
  bleed:   "images/spells/necromancy/bolt_of_draining.png",
};
/** 解析 effects_type 法术图标路径；缺省/未知 → ""（不叠图标） */
function effectIcon(effectsType: unknown): string {
  return EFFECT_ICON[String(effectsType || "")] || "";
}

/** 稀有度 → 基础估价（卖出按 40% 折算） */
const RARITY_PRICE: Record<string, number> = { common: 8, fine: 22, rare: 60, epic: 180, legend: 520 };
const RARITY_LIST = ["common", "fine", "rare", "epic", "legend"];
const KIND_LIST = ["consumable", "material", "equipment", "skill_book", "quest"];

/** 插件自带商城物资（商城 agent 不可用时的常备补给） */
const BUILTIN_SHOP_GOODS: ShopGood[] = [
  { id: "b_huiqi", name: "回气散", price: 30, kind: "consumable", rarity: "common", heal: 30, desc: "恢复 30 点生命", from: "builtin" },
  { id: "b_jijiu", name: "急救包", price: 60, kind: "consumable", rarity: "fine", heal: 60, desc: "恢复 60 点生命", from: "builtin" },
  { id: "b_ganliang", name: "干粮", price: 12, kind: "consumable", rarity: "common", heal: 14, desc: "恢复 14 点生命", from: "builtin" },
  { id: "b_zhixuecao", name: "止血草", price: 20, kind: "material", rarity: "common", heal: 0, desc: "常见草药，可入药", from: "builtin" },
  { id: "b_yinguang", name: "荧光石", price: 45, kind: "material", rarity: "fine", heal: 0, desc: "泛着微光的矿石", from: "builtin" },
  { id: "b_duanjian", name: "精钢短剑", price: 220, kind: "equipment", rarity: "rare", heal: 0, desc: "攻击 +6", from: "builtin" },
  { id: "b_hufu", name: "皮甲护符", price: 160, kind: "equipment", rarity: "fine", heal: 0, desc: "防御 +4", from: "builtin" },
  { id: "b_xinde", name: "基础技能心得", price: 320, kind: "skill_book", rarity: "rare", heal: 0, desc: "习得一项基础技能", from: "builtin" },
];

/**
 * ★ 锻造大师 / 炼丹炉的售卖清单**不在插件里**。
 *   清单属于各张地图集自己的业务数据（故事包 data/shop.*.json），
 *   由事件脚本读取后经 ctx.ui.openShopPanel({ goods }) 交给前端渲染；
 *   购买时前端把该件商品原样带回 sys_shop_buy（见下方 params.good 分支）。
 *   插件只提供「面板 + 购买/打造/升级/溶解」这些通用能力。
 *   规范依据：md/curr_design/toonflow-field-survival/maps_help/规范.md
 *   「严重违规事项：把地图集独有的业务写到插件里」。
 */

function normRarity(v: any): string {
  const r = String(v ?? "").toLowerCase().trim();
  return RARITY_LIST.indexOf(r) >= 0 ? r : "common";
}

function guessKind(name: string): string {
  const n = String(name || "");
  if (/技能|秘籍|心得|卷轴|心法|功法/.test(n)) return "skill_book";
  if (/剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴/.test(n)) return "equipment";
  if (/丹|散|药|水|包|粮|汤|肉|鱼|果|酒|茶|露/.test(n)) return "consumable";
  return "material";
}

function defaultHeal(name: string, kind: string): number {
  if (kind !== "consumable") return 0;
  const n = String(name || "");
  if (/急救|大补|灵药|仙丹|回天/.test(n)) return 60;
  if (/回气|伤药|灵泉|清心|愈合/.test(n)) return 30;
  if (/干粮|粮|肉|果|汤|鱼/.test(n)) return 14;
  return 20;
}

/* ============================================================
   ★ 锻造大师 / 炼丹炉：AI 生成 + 背包读写 + 溶解返还
   ============================================================ */

/** 从 AI 返回文本里抽出第一个 JSON 对象（模型常包 ```json 围栏） */
function extractJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** AI 生成的物品（已校验 + 归一化） */
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

/** 校验并归一化 AI 生成的物品（防止越界值 / 空名 / 非法品质） */
function normalizeGeneratedItem(raw: any, fallback: { name: string; kind: string; rarity: string; heal: number; desc: string; price: number }): GeneratedItem {
  const rarity = RARITY_VALUES.indexOf(String(raw?.rarity)) >= 0 ? String(raw.rarity) : fallback.rarity;
  const kind = ITEM_KINDS.indexOf(String(raw?.kind)) >= 0 ? String(raw.kind) : fallback.kind;
  const name = String(raw?.name || fallback.name).trim().slice(0, 20) || fallback.name;
  return {
    name,
    kind,
    rarity,
    heal: Math.max(0, Math.min(9999, Math.round(num(raw?.heal, fallback.heal)))),
    desc: String(raw?.desc || fallback.desc).slice(0, 60),
    price: Math.max(1, Math.round(num(raw?.price, fallback.price))),
    atk: Math.max(0, Math.min(9999, Math.round(num(raw?.atk, 0)))),
    def: Math.max(0, Math.min(9999, Math.round(num(raw?.def, 0)))),
    durability: Math.max(0, Math.min(99999, Math.round(num(raw?.durability, 0)))),
    lv: raw?.lv != null ? Math.max(1, Math.round(num(raw.lv, 1))) : undefined,
    effect: raw?.effect && typeof raw.effect === "object"
      ? {
          type: String(raw.effect.type || "none").slice(0, 20),
          value: Math.max(0, Math.min(9999, Math.round(num(raw.effect.value, 0)))),
          duration: Math.max(0, Math.min(9999, Math.round(num(raw.effect.duration, 0)))),
        }
      : undefined,
  };
}

/** ★ 溶解返还算法：按品质 × 等级算材料
 *  common×1 / fine×2 / rare×4 / epic×8 / legend×15
 *  铁矿石 = lv × 倍率；灵石碎屑 = floor(lv × 倍率 / 3) */
const DISSOLVE_RARITY_MULT: Record<string, number> = {
  common: 1, fine: 2, rare: 4, epic: 8, legend: 15,
};
/**
 * ★ 图纸 / 药方 → 实际产物名（后端兜底版，与 vue/src/eventScripts/forgeCommon.ts 同规则）
 *   「铁剑图纸」→「铁剑」、「九转回魂丹配方」→「九转回魂丹」
 *   返回 "" = 图纸没写明产物（随机丹方残卷之类），让 AI 自由发挥。
 */
const BP_SUFFIXES = [
  "铸造总纲", "铸造秘法", "铸造术", "铸造法",
  "锻造总纲", "锻造秘法", "锻造术", "锻造法",
  "炼制秘法", "炼法", "制法",
  "编缀图", "图纸", "图谱", "图",
  "总纲", "拓本", "残卷", "秘法", "秘方", "配方", "丹方", "药方", "丹谱", "药谱",
];
const BP_MEANINGLESS = /^(随机|上古|未知|残缺|古老|残破|无字|空白|神秘|传说|神兵|虚空)$/;
function blueprintProductName(blueprintName: string): string {
  let s = String(blueprintName || "").trim();
  if (!s) return "";
  for (let i = 0; i < 4; i++) {
    let hit = false;
    for (const suf of BP_SUFFIXES) {
      if (s.length >= suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); hit = true; break; }
    }
    if (!hit) break;
  }
  s = s.replace(/(铸造|锻造|炼制|编缀|制作|的)+$/, "").trim();
  if (s.length < 2 || BP_MEANINGLESS.test(s)) return "";
  return s;
}
/** 名字是否像「图纸 / 药方」这类载体（拦 AI 把图纸本身当产物） */
function looksLikeBlueprintName(name: string): boolean {
  const s = String(name || "");
  if (!s) return false;
  return /图纸|图谱|编缀图|总纲|拓本|残卷|秘法|秘方|配方|丹方|药方|丹谱|药谱|锻造法|锻造术|铸造法|铸造术/.test(s);
}

function calcDissolveReturns(rarity: string, lv: number): { ore: number; stone: number } {
  const mult = DISSOLVE_RARITY_MULT[rarity] || 1;
  const l = Math.max(1, Math.round(lv));
  return {
    ore: Math.max(1, l * mult),
    stone: Math.max(0, Math.floor((l * mult) / 3)),
  };
}

/** ★ 丹药溶解返还：按恢复量换算草药 */
function calcPillDissolveReturns(heal: number): { herb: number; lingzhi: number } {
  const h = Math.max(1, Math.round(heal));
  return {
    herb: Math.max(1, Math.round(h / 20)),
    lingzhi: Math.max(0, Math.round(h / 100)),
  };
}

/** ★ 读取玩家背包（给事件脚本选目标用） */
function listPlayerBag(s: FieldSurvivalState): Array<{ name: string; count: number; kind: string; rarity: string; heal: number; lv?: number; desc?: string }> {
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  return bag.map((b) => ({
    name: b.name,
    count: Math.max(1, Math.round(num(b.count, 1))),
    kind: String(b.kind || "material"),
    rarity: String(b.rarity || "common"),
    heal: Math.round(num(b.heal, 0)),
    lv: b.lv != null ? Math.round(num(b.lv, 1)) : undefined,
    desc: b.desc,
  }));
}

/** ★ 从玩家背包移除物品（溶解/升级替换用） */
function removeFromPlayerBag(s: FieldSurvivalState, name: string, count = 1): boolean {
  const nm = str(name).trim().slice(0, 20);
  if (!nm) return false;
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const target = bag.find((x) => sameName(x.name, nm));
  if (!target) return false;
  const n = Math.max(1, Math.round(num(count, 1)));
  if (target.count > n) {
    target.count -= n;
  } else {
    const idx = bag.findIndex((x) => sameName(x.name, nm));
    if (idx >= 0) bag.splice(idx, 1);
  }
  patchCard(s, { items: serializeBag(bag, card.items) });
  applyBagAttributes(s);
  return true;
}

/** ★ 锻造大师：随机生成物品（AI 不可用时的兜底） */
function rollForgeItem(input: string, _level: number): { name: string; kind: string; rarity: string; heal: number; desc: string; price: number } {
  const prefixes = ["粗制", "精锻", "寒铁", "烈焰", "疾风", "雷霆", "暗影", "圣光", "龙骨", "陨星"];
  const bodies = ["剑", "刀", "枪", "弓", "杖", "甲", "盔", "靴", "盾", "戒指", "护符", "拳套"];
  const suffixes = ["", "·破晓", "·噬魂", "·龙纹", "·星陨", "·霜华", "·焚天", "·幽冥"];
  const r = Math.random();
  const rarity = r < 0.40 ? "common" : r < 0.75 ? "fine" : r < 0.95 ? "rare" : r < 0.99 ? "epic" : "legend";
  let name: string;
  if (input && input.trim()) {
    name = input.trim().slice(0, 12);
  } else {
    const pre = prefixes[Math.floor(Math.random() * prefixes.length)];
    const body = bodies[Math.floor(Math.random() * bodies.length)];
    const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
    name = `${pre}${body}${suf}`;
  }
  const rarityPrice: Record<string, number> = { common: 15, fine: 50, rare: 150, epic: 400, legend: 1000 };
  const price = Math.max(10, rarityPrice[rarity] || 10);
  const kind = /剑|刀|枪|弓|杖|甲|盔|靴|盾|戒指|护符|拳套/.test(name) ? "equipment" : "material";
  const desc = `随机打造的${name}（${rarity}）`;
  return { name, kind, rarity, heal: 0, desc, price };
}

/** ★ 炼丹炉：随机生成丹药（AI 不可用时的兜底） */
function rollAlchemyPill(input: string, _level: number): { name: string; kind: string; rarity: string; heal: number; desc: string; price: number } {
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
    const pre = prefixes[Math.floor(Math.random() * prefixes.length)];
    const body = bodies[Math.floor(Math.random() * bodies.length)];
    const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
    name = `${pre}${body}${suf}`;
  }
  const baseHeal: Record<string, number> = { common: 20, fine: 50, rare: 120, epic: 300, legend: 800 };
  const heal = baseHeal[rarity] || 20;
  const price = Math.max(10, heal * 2);
  const desc = `随机炼制的${name}（${rarity}），恢复 ${heal} 点生命`;
  return { name, kind: "consumable", rarity, heal, desc, price };
}

/** 参数卡里的物品项（字符串 "干粮×3" / "干粮（备注）" 或对象）→ BagItem */
/** 物品名归一：剥离「×N」数量、「（描述…）」后缀、对象残留与货币尾注，限长 20（与 entry.js 同口径） */
function cleanName(v: any): string {
  let n = v && typeof v === "object" ? str(v.name ?? v.item ?? v.itemName ?? "") : str(v);
  n = n.replace(/\[object Object\]/g, " ");
  n = n.replace(/[（(][^）)]*[）)]/g, " ");
  n = n.replace(/[×xX*]\s*\d+\s*(个|件|尾|份|瓶|颗|张|本)?/g, " ");
  n = n.replace(/\s*单[尾个件份瓶颗张本]\s*\d*\s*金.*$/g, " ");
  n = n.replace(/\s*\d+\s*金.*$/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[·、,，;；:：]+$/, "").trim();
  return n.slice(0, 20);
}
function itemKey(v: any): string {
  return cleanName(v).toLowerCase();
}
/** 展示名/参数名可能写法不同（带描述 vs 不带），匹配一律走归一键 */
function sameName(a: any, b: any): boolean {
  const ka = itemKey(a);
  return !!ka && ka === itemKey(b);
}
function parseItemRaw(raw: any): BagItem {
  if (raw && typeof raw === "object") {
    const name = str((raw as any).name ?? (raw as any).item ?? "");
    const kind = KIND_LIST.indexOf(String((raw as any).kind)) >= 0 ? String((raw as any).kind) : guessKind(name);
    return {
      name,
      count: Math.max(1, Math.round(num((raw as any).count, 1))),
      kind,
      rarity: normRarity((raw as any).rarity),
      heal: Math.max(0, Math.round(num((raw as any).heal, defaultHeal(name, kind)))),
      price: Math.max(0, Math.round(num((raw as any).price, 0))),
      desc: str((raw as any).desc, "") || undefined,
    };
  }
  const text = str(raw).trim();
  if (!text) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
  // ★ 物品字符串归一修复：先剥括号注记（"（钓鱼累积…）"/"（鲜美的河鱼）" 等自由文本尾注），
  //   再用剥后剩下的字符串剥 ×N。原顺序反过来遇到 "银鲳×16（…）" 会因正则要求
  //   ×N 紧接结尾而失败，最终 name 留下 "银鲳×16"、count=1 → HUD 显示错位 + useItem
  //   拿带尾巴 name 找不到 bag 项 → 静默 "不在背包中"。两步法：剥括号 → 剥 ×N → 兜底空 desc。
  const noParen = text.replace(/[（(][^）)]*[）)]\s*$/, "").trim() || text;
  const m = noParen.match(/^(.*?)[×xX*]\s*(\d+)\s*$/);
  if (m) {
    // ★ 同下：清除 "[object Object]" 残留（带 ×N 后缀的脏条目）
    const name = m[1].replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
    if (!name) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
    const kind = guessKind(name);
    return { name, count: Math.max(1, parseInt(m[2], 10) || 1), kind, rarity: "common", heal: defaultHeal(name, kind), price: 0 };
  }
  const p = text.match(/[（(](.*?)[)）]\s*$/);
  // ★ 清除 "[object Object]" 残留（历史脏数据经 String(obj) 写入参数卡）：
  //   清空后 name 为空 → itemsFromCard/serializeBag 过滤掉 → 下次背包重写自动清除脏条目
  const name = noParen.replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
  const kind = guessKind(name);
  return { name, count: 1, kind, rarity: "common", heal: defaultHeal(name, kind), price: 0, desc: p ? p[1] : undefined };
}

function itemsFromCard(card: any): BagItem[] {
  const arr = Array.isArray(card?.items) ? card.items : [];
  return arr.map(parseItemRaw).filter((i) => i.name && i.count > 0);
}

/** 合并同名物品 + 套用元数据 + 按自定义顺序排列（imeta = 物品战斗参数元数据） */
function mergeBag(raw: BagItem[], meta?: Record<string, BagItem>, order?: string[], imeta?: Record<string, ItemMeta>): BagItem[] {
  const map = new Map<string, BagItem>();
  raw.forEach((it) => {
    const m = meta ? meta[it.name] : undefined;
    // ★ game.md 物品修改：战斗参数元数据（itemMeta，按展示名存）合并进背包项
    const im = imeta ? (imeta[it.name] || imeta[it.name.toLowerCase()]) : undefined;
    const bt = inferItemType(it.name, it.kind);
    const cur = map.get(it.name);
    if (cur) { cur.count += it.count; return; }
    map.set(it.name, {
      name: it.name,
      count: it.count,
      quantity: it.count,
      kind: it.kind !== "material" || !m ? it.kind : m.kind,
      rarity: it.rarity !== "common" || !m ? it.rarity : m.rarity,
      heal: it.heal || (m ? m.heal : 0) || defaultHeal(it.name, it.kind),
      price: it.price || (m ? m.price : 0),
      desc: im?.description || it.desc || (m ? m.desc : undefined),
      power: num(im?.power, it.kind === "equipment" ? 10 : 0),
      cost: num(im?.cost, 0),
      cd: Math.max(0, num(im?.cd, 0)),
      cdLeft: 0,
      type: (im?.type || bt.type) as BagItem["type"],
      range: (im?.range || bt.range) as BagItem["range"],
      lv: Math.max(1, num(im?.lv, 1)),
      buff_type: im?.buff_type || "",
      durability: num(im?.durability, -1),
      durabilityLeft: num(im?.durabilityLeft, num(im?.durability, -1)),
      attribute_type: im && "attribute_type" in im ? im.attribute_type : inferItemAttrType(it.name),
      attribute_value: num(im?.attribute_value, defaultItemAttrValue(it.name)),
      effects_type: im?.effects_type || "",
    });
  });
  const list = Array.from(map.values());
  const idx = new Map<string, number>();
  (order || []).forEach((n, i) => idx.set(n, i));
  return list.sort((a, b) => {
    const ia = idx.has(a.name) ? (idx.get(a.name) as number) : 9999;
    const ib = idx.has(b.name) ? (idx.get(b.name) as number) : 9999;
    return ia - ib;
  });
}

function serializeBag(bag: BagItem[], cardItems?: any[]): string[] {
  // ★ game.md quantity/description：重写参数卡时保留原条目描述注记（「银鲤×3（钓鱼累积，暂未售出，单尾800金）」→「银鲤×7（钓鱼累积…）」）
  if (Array.isArray(cardItems)) {
    const flat: any[] = [];
    cardItems.forEach((x) => {
      if (typeof x === "string") splitSkillList(x).forEach((p) => { if (cleanName(p)) flat.push(p.trim()); });
      else flat.push(x);
    });
    const used = new Set<string>();
    const out: string[] = [];
    flat.forEach((x) => {
      const p = parseItemRaw(x);
      if (!p.name) return;
      const b = bag.find((y) => sameName(y.name, p.name) && !used.has(itemKey(y.name)));
      if (!b || !(b.count > 0)) return;
      used.add(itemKey(b.name));
      const d = p.desc ? `（${p.desc}）` : "";
      out.push(b.count > 1 ? `${b.name}×${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    bag.forEach((b) => {
      if (!b.count || used.has(itemKey(b.name))) return;
      used.add(itemKey(b.name));
      const d = b.desc ? `（${b.desc}）` : "";
      out.push(b.count > 1 ? `${b.name}×${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    return out;
  }
  return bag.filter((i) => i.name && i.count > 0).map((i) => (i.count > 1 ? `${i.name}×${i.count}` : i.name));
}

function sellPrice(it: BagItem): number {
  if (it.price > 0) return Math.max(1, Math.round(it.price * 0.4));
  const base = RARITY_PRICE[it.rarity] || RARITY_PRICE.common;
  const k = it.kind === "equipment" ? 1.5 : it.kind === "skill_book" ? 2 : 1;
  return Math.max(1, Math.round(base * k));
}

/** ★ game.md 背包物品：特效类型 [atk, heal, buff, attribute]（attribute = 纯属性点，使用不消耗） */
const ITEM_TYPES = ["atk", "heal", "buff", "attribute"] as const;
/** ★ game.md attribute_type：Defense/Attack/Life/Blue（放背包即被动加成） */
const ITEM_ATTR_TYPES = ["Defense", "Attack", "Life", "Blue"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

/** 按名/品类推断默认 type/range（未显式修改过的物品走推断） */
function inferItemType(name: string, kind: string): { type: ItemType; range: "melee" | "ranged" } {
  const n = String(name || "");
  if (kind === "skill_book") return { type: "buff", range: "melee" };
  if (kind === "equipment" || /刀|剑|枪|弓|弩|斧|杖|匕|爪|锤/.test(n)) return { type: "atk", range: /弓|弩|杖/.test(n) ? "ranged" : "melee" };
  if (/力量|攻击|加攻/.test(n)) return { type: "attribute", range: "melee" };
  return { type: "heal", range: "melee" };
}
/** 按名推断被动属性类型（「力量+4」→ Attack 之类） */
function inferItemAttrType(name: string): string {
  const n = String(name || "");
  if (/防御|护甲|加防|体魄|磐/.test(n)) return "Defense";
  if (/蓝|法力|灵力|魔力/.test(n)) return "Blue";
  if (/生命|血量|体质/.test(n)) return "Life";
  if (/力量|攻击|加攻/.test(n)) return "Attack";
  return "";
}
/** 按名推断被动属性数值（「力量+4」→ 4；「魔力+10」→ 10） */
function defaultItemAttrValue(name: string): number {
  const m = String(name || "").match(/[＋+]\s*(\d+)/);
  return m ? Math.round(Number(m[1])) : 0;
}
/** 耐久剩余写回 itemMeta（背包每次从参数卡重建，durabilityLeft 必须落持久层） */
function setItemDurLeft(s: FieldSurvivalState, name: string, v: number): void {
  const cur = (s.itemMeta || {})[name] || ({} as Partial<ItemMeta>);
  s.itemMeta = { ...(s.itemMeta || {}), [name]: { ...cur, durabilityLeft: v } as ItemMeta };
}
/** ★ game.md 背包被动加成：bag 中 attribute_type ∈ Defense/Attack/Life/Blue 的物品按 attribute_value 累加 */
function bagAttributeBonus(s: FieldSurvivalState): Record<string, number> {
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const bonus: Record<string, number> = { Defense: 0, Attack: 0, Life: 0, Blue: 0 };
  bag.forEach((it) => {
    const v = Math.round(num(it.attribute_value, 0));
    if (v !== 0 && (ITEM_ATTR_TYPES as readonly string[]).indexOf(it.attribute_type || "") >= 0) bonus[it.attribute_type as string] += v;
  });
  return bonus;
}
/* ============================================================================
   ★ game.md 等级系统（满血满蓝公式 / 经验阈值 / 升级 / 角色卡同步）
   ----------------------------------------------------------------------------
   满血HP = 100 + 等级*10 + 道具血量加成 + 技能永久血量加成
   满蓝MP = 100 + 等级*10 + 道具蓝量加成 + 技能永久蓝量加成
   攻击   = 10  + 等级*10 + 道具攻击加成 + 技能永久攻击加成
   防御   = 1   + 等级*10 + 道具防御加成 + 技能永久防御加成
   升级   = exp ≥ 当前level*100 → level+1 / 扣阈值保留溢出 / 阈值 = 新level*100 / 重算满血满蓝
   ========================================================================== */
const STAT_BASE = { hp: 100, mp: 100, atk: 10, def: 1 };
const STAT_PER_LEVEL = 10;                 // 每级四维成长
const PLAYER_ATTR_KEYS = ["Life", "Blue", "Attack", "Defense"] as const;
type PlayerAttrKey = (typeof PLAYER_ATTR_KEYS)[number];

/** 技能永久加成点数：skillMeta[技能].perm_{Life|Blue|Attack|Defense} 或参数卡 perm_bonus / permanent_attributes */
function permAttributeBonus(s: FieldSurvivalState): Record<string, number> {
  const out: Record<string, number> = { Life: 0, Blue: 0, Attack: 0, Defense: 0 };
  const card = (s.playerCard || {}) as Record<string, any>;
  const add = (k: string, v: any): void => {
    if ((PLAYER_ATTR_KEYS as readonly string[]).indexOf(k) >= 0) out[k] += Math.round(num(v, 0));
  };
  ["permanent_attributes", "perm_bonus", "perm_attr", "attribute_bonus"].forEach((key) => {
    const m = card[key];
    if (m && typeof m === "object") Object.keys(m).forEach((k) => add(k, (m as any)[k]));
  });
  const meta = (s.skillMeta || {}) as Record<string, any>;
  Object.keys(meta).forEach((k) => {
    const m = meta[k];
    if (!m || typeof m !== "object") return;
    PLAYER_ATTR_KEYS.forEach((ak) => {
      add(ak, m[`perm_${ak}`]);
      if (m.permanent && typeof m.permanent === "object") add(ak, m.permanent[ak]);
    });
  });
  return out;
}

/** 满血 / 满蓝 / 攻击 / 防御（公式值，不含当前 hp/mp） */
function playerMaxStats(s: FieldSurvivalState, level?: number): { maxHp: number; maxMp: number; atk: number; def: number } {
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(level, num(me?.level, 1))));
  const bag = bagAttributeBonus(s);
  const perm = permAttributeBonus(s);
  const sum = (k: PlayerAttrKey): number => Math.round(num(bag[k], 0) + num(perm[k], 0));
  return {
    maxHp: Math.max(1, STAT_BASE.hp + lv * STAT_PER_LEVEL + sum("Life")),
    maxMp: Math.max(0, STAT_BASE.mp + lv * STAT_PER_LEVEL + sum("Blue")),
    atk: Math.max(1, STAT_BASE.atk + lv * STAT_PER_LEVEL + sum("Attack")),
    def: Math.max(0, STAT_BASE.def + lv * STAT_PER_LEVEL + sum("Defense")),
  };
}

/** 升级阈值：next_level_exp = 当前 level * 100 */
function playerNextExp(level: number): number {
  return Math.max(1, Math.round(num(level, 1))) * 100;
}

/** 刷新玩家实体的经验显示字段（HUD：EXP me.exp/me.expToNext） */
function refreshPlayerExpFields(s: FieldSurvivalState): void {
  const me = playerEntity(s);
  if (!me) return;
  const card = (s.playerCard || {}) as Record<string, any>;
  const lv = Math.max(1, Math.round(num(me.level, 1)));
  const exp = Math.max(0, Math.round(num(s.exp, num(card.exp, 0))));
  s.exp = exp;
  me.exp = exp;
  me.expToNext = playerNextExp(lv);
}

/** 等级称号：优先读「等级-称号对照表」，无对应等级 → 空字符串；无对照表 → 返回 null（保留原称号） */
const LEVEL_DESC_MAP_KEYS = ["level_desc_map", "level_titles", "level_title_map", "level_desc_table", "等级称号表"];
function resolveLevelDesc(card: Record<string, any>, level: number): string | null {
  for (const key of LEVEL_DESC_MAP_KEYS) {
    const m = card?.[key];
    if (m && typeof m === "object") {
      const v = (m as any)[String(level)] ?? (m as any)[level];
      return v == null ? "" : String(v);
    }
  }
  return null;
}

/** 等级/经验/HP/MP 同步到「动态角色卡」（变化才回写，避免每帧 writeback） */
function syncPlayerCardStats(s: FieldSurvivalState, patch?: Record<string, any>): void {
  const me = playerEntity(s);
  if (!me) return;
  const lv = Math.max(1, Math.round(num(me.level, 1)));
  const exp = Math.max(0, Math.round(num(me.exp, num(s.exp, 0))));
  const next = playerNextExp(lv);
  const hp = Math.round(num(me.hp, 0));
  const maxHp = Math.round(num(me.maxHp, 0));
  const mp = Math.round(num(me.mp, 0));
  const maxMp = Math.round(num(me.maxMp, 0));
  const extra = patch || {};
  const sig = [lv, exp, next, hp, maxHp, mp, maxMp, JSON.stringify(extra)].join("|");
  if ((me as any)._cardStatSig === sig) return;
  (me as any)._cardStatSig = sig;
  patchCard(s, { level: lv, exp, next_level_exp: next, hp, maxHp, mp, maxMp, ...extra });
}

/** 升级判定：exp ≥ level*100 → 升级（支持连续多级），溢出经验保留，重算满血满蓝 + 写称号 */
function checkPlayerLevelUp(s: FieldSurvivalState): number {
  const me = playerEntity(s);
  if (!me) return 0;
  let lv = Math.max(1, Math.round(num(me.level, 1)));
  let exp = Math.max(0, Math.round(num(s.exp, 0)));
  let ups = 0;
  while (exp >= playerNextExp(lv)) {
    exp -= playerNextExp(lv);   // ② 扣除「升级前」阈值（③ 下一轮用新 level*100）
    lv += 1;                    // ① 等级 +1
    ups += 1;
  }
  if (!ups) { refreshPlayerExpFields(s); return 0; }
  me.level = lv;
  s.exp = exp;
  applyBagAttributes(s, { full: true });        // ⑤ 按满血满蓝公式重算 hp/mp
  const card = (s.playerCard || {}) as Record<string, any>;
  const desc = resolveLevelDesc(card, lv);      // ④ 等级称号
  syncPlayerCardStats(s, desc == null ? {} : { level_desc: desc });
  floater(s, `Lv.${lv} ↑`, me.x, me.y - 40);
  pushEvent(s, `升级到 Lv.${lv}（经验 ${exp}/${playerNextExp(lv)}，HP/MP 已按公式补满）`);
  return ups;
}

/** 玩家获得经验：累加 → 升级判定 → 角色卡同步（模糊描述不加经验，由 AI 层写 other） */
function gainPlayerExp(s: FieldSurvivalState, amount: number): void {
  const gain = Math.round(num(amount, 0));
  if (gain <= 0) return;
  s.exp = Math.max(0, Math.round(num(s.exp, 0)) + gain);
  checkPlayerLevelUp(s);
  syncPlayerCardStats(s);
}

/** 满血满蓝恢复（game.md 5：睡觉/住宿/药剂/恢复技能/剧情治愈 → 直接补满，描述写 other） */
function restorePlayerFull(s: FieldSurvivalState, reason: string): void {
  const me = playerEntity(s);
  if (!me) return;
  applyBagAttributes(s, { full: true });
  const card = (s.playerCard || {}) as Record<string, any>;
  const other = (Array.isArray(card.other) ? card.other.map((x: any) => String(x)) : []).slice(-20);
  const note = `${reason}：🎉 恭喜您已恢复到最佳状态（HP ${Math.round(me.hp)}/${Math.round(me.maxHp)}，MP ${Math.round(num(me.mp, 0))}/${Math.round(num(me.maxMp, 0))}）`;
  other.push(note);
  syncPlayerCardStats(s, { other });
  floater(s, "满血满蓝", me.x, me.y - 40);
  pushEvent(s, note);
}

/** 开局：等级/经验取「动态角色卡」，四维按公式重算，当前 hp/mp 取卡面值并夹进上限 */
function initPlayerFromCard(s: FieldSurvivalState, playerRole: any): void {
  const me = playerEntity(s);
  if (!me) return;
  const card = ((s.playerCard && Object.keys(s.playerCard).length)
    ? (s.playerCard as Record<string, any>)
    : ((playerRole?.parameterCardJson || playerRole?.parameter_card_json || {}) as Record<string, any>)) || {};
  if (!s.playerCard || !Object.keys(s.playerCard).length) s.playerCard = { ...card };
  me.level = Math.max(1, Math.round(num(card.level, num(playerRole?.initial_level, num(me.level, 1)))));
  s.exp = Math.max(0, Math.round(num(card.exp, num(s.exp, 0))));
  const st = playerMaxStats(s, me.level);
  me.maxHp = st.maxHp;
  me.maxMp = st.maxMp;
  me.atk = st.atk;
  me.def = st.def;
  me.hp = clamp(num(card.hp, st.maxHp), 0, st.maxHp);
  const cardMp = num(card.mp, NaN);
  me.mp = clamp(Number.isFinite(cardMp) ? cardMp : st.maxMp, 0, st.maxMp);
  refreshPlayerExpFields(s);
  syncPlayerCardStats(s);
}

/** 被动加成落到玩家实体（四维按 game.md 公式重算；full=true 时补满血满蓝） */
function applyBagAttributes(s: FieldSurvivalState, opts?: { full?: boolean }): void {
  const me = playerEntity(s);
  if (!me) return;
  const st = playerMaxStats(s);
  me.maxHp = st.maxHp;
  me.maxMp = st.maxMp;
  me.atk = st.atk;
  me.def = st.def;
  if (opts?.full) {
    me.hp = me.maxHp;
    me.mp = st.maxMp;
  } else {
    me.hp = clamp(num(me.hp, st.maxHp), 0, me.maxHp);
    me.mp = clamp(num(me.mp, st.maxMp), 0, st.maxMp);
  }
  refreshPlayerExpFields(s);
}
/**
 * ★ game.md 背包物品使用（HUD 物品栏 / 背包面板共用）：
 *   heal → 治疗环 + 回血；buff → 护盾环；atk/attribute → 普攻效果（近战冲斩 / 远程火球）
 *   无专属特效的统一走「角色小跳 + 飘字」（actionBobMs + floater）
 *   durability：-1 永久；>0 每用一次 -1，用完损毁 1 个；attribute 使用不消耗
 */
/** 把物品合并进玩家背包（参数卡 items 链），返回合并后的数量。
 *  ★ 野怪击杀奖励：开箱产出的物资（含暗核）必须真的进背包，否则玩家点不到「使用」。 */
function addBagItemToCard(s: FieldSurvivalState, name: string, count = 1): number {
  const nm = str(name).trim().slice(0, 20);
  const n = Math.max(1, Math.round(num(count, 1)));
  if (!nm) return 0;
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const exist = bag.find((x) => sameName(x.name, nm));
  if (exist) exist.count += n;
  else bag.push({ name: nm, count: n, kind: guessKind(nm), heal: 0, mp: 0 } as BagItem);
  patchCard(s, { items: serializeBag(bag, card.items) });   // patchCard 内会重建 s.items
  applyBagAttributes(s);
  // ★ 任务板：采集类任务进度（记累计获得，用掉不影响已完成的进度）
  noteQuestGather(s, nm, n);
  return exist ? exist.count : n;
}

/* ============================================================
   ★ 任务板系统（quests）
   ------------------------------------------------------------
   定义来源：pluginData["quest_defs"]（CLI 上传） / sys_quest_pool（宿主·事件）
             / sys_quest_generate（AI 生成）
   进度来源：damage() 击杀 · addBagItemToCard 入包 · sys_chat 对话 · sys_quest_arrive 到达
   状态机：active → done（目标达成，待交）→ turned（已领奖）｜active → failed（护送货物被打掉）
   ============================================================ */
function cleanTitle(v: unknown): string { return str(v).trim().slice(0, QUEST_TITLE_MAX); }

/** ★ 任务数据里的地图名归一：slug（mulberryTown）→ 运行时关卡显示名（Mulberry Town）
 *  · quests.json / AI 产出常写文件名 slug，而 s.levelName 用的是显示名（"Mulberry Town"），
 *    不归一会让所有带 map 的任务全被判成「别处发布」、arrive 校验永远不通过。 */
/** ★ key 必须写成**真实地图文件名**的 camelCase（maps/mulberryDungeon1.json）：
 *  反查表会把它直接当关卡 key 透给前端 switchLevel，全小写会 loadLevelByName 找不到文件。 */
const QUEST_MAP_SLUGS: Record<string, string> = {
  mulberryTown: "Mulberry Town",
  mulberryForest: "Mulberry Forest",
  mulberryGraveyard: "Mulberry Graveyard",
  mulberryDungeon: "Mulberry Dungeon",
  /** ★ 故意与上一行同值：老存档把 mulberryDungeon1 归一成了 "Mulberry Dungeon"（层号丢失），
   *  反查表按「同显示名取最长 slug」就能还原成 mulberryDungeon1（真实地图文件）。改这里会破坏自愈。 */
  mulberryDungeon1: "Mulberry Dungeon",
  mulberryDungeon2: "Mulberry Dungeon 2",
  mulberryDungeon3: "Mulberry Dungeon 3",
  mulberryDungeon4: "Mulberry Dungeon 4",
  mulberryDungeon5: "Mulberry Dungeon 5",
  forestDungeon: "Forest Dungeon",
  forestDungeon1: "Forest Dungeon 1",
  forestDungeon2: "Forest Dungeon 2",
  forestDungeon3: "Forest Dungeon 3",
  forestDungeon4: "Forest Dungeon 4",
  forestDungeon5: "Forest Dungeon 5",
  lichLair: "Lich Lair",
  lootGoblinLair: "Loot Goblin Lair",
  kingdom: "Kingdom",
};
/** slug 查找索引（大小写 / 空格 / 下划线 / 连字符都不敏感） */
const QUEST_MAP_SLUG_INDEX: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const [slug, disp] of Object.entries(QUEST_MAP_SLUGS)) idx[slug.toLowerCase()] = disp;
  return idx;
})();
/** 紧凑写法 → 真实 camelCase key（"mulberrydungeon1" → "mulberryDungeon1"） */
const QUEST_MAP_COMPACT: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const slug of Object.keys(QUEST_MAP_SLUGS)) idx[slug.toLowerCase().replace(/[\s_-]/g, "")] = slug;
  return idx;
})();
function normQuestMap(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "";
  const hit = QUEST_MAP_SLUG_INDEX[s.toLowerCase().replace(/[\s_-]/g, "")];
  return hit || s;
}

/** ★ 归一显示名 → 关卡 key 反查表（修历史存档污染）
 *  老版本持久化 questBoard 时只存了归一后的 map（"Mulberry Dungeon"），新版本恢复时
 *  （见 restoreQuestBoard）会把它当成 raw 再归一次，于是 mapRaw 被写成显示名，
 *  跨图寻路拿这个非关卡 key 去 switchLevel → loadLevelByName 找不到文件 → 静默失败
 *  （表现：点了寻路，玩家原地不动、任务一直挂着）。
 *  · 同一显示名对应多个 slug（mulberrydungeon / mulberrydungeon1 都是 "Mulberry Dungeon"）
 *    时取**更长的**那个 —— 带层号的才是真实关卡文件（maps/mulberryDungeon1.json）。 */
const QUEST_MAP_KEY_REV: Record<string, string> = (() => {
  const rev: Record<string, string> = {};
  for (const [slug, disp] of Object.entries(QUEST_MAP_SLUGS)) {
    const k = disp.trim().toLowerCase();
    const prev = rev[k];
    if (!prev || slug.length > prev.length) rev[k] = slug;
  }
  return rev;
})();

/** 任务里的原始地图写法 → 关卡 key（camelCase 原样保留，如 "mulberryDungeon1"）
 *  · 已是 slug → 原样返回（新数据走这条）
 *  · 是归一名 / 中文显示名（老存档）→ 反查回 slug
 *  · 完全陌生 → 原样返回（前端还有一层按 mapFiles 的兜底解析） */
function rawQuestMapKey(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "";
  const rev = QUEST_MAP_KEY_REV[s.toLowerCase()];
  if (rev) return rev;                        // 显示名（含老存档污染）→ 真实关卡 key
  const compact = QUEST_MAP_COMPACT[s.toLowerCase().replace(/[\s_-]/g, "")];
  if (compact) return compact;                // 大小写 / 分隔符变体 → 真实 key
  return s;                                   // 已是 key 或未知写法 → 原样
}

/** 任意地图写法 → 可比较的紧凑 key（"Mulberry Town" / "mulberryTown" 等价）。
 *  仅用于**判定是否同一张图**，不要拿它去切图（切图要原始 camelCase key）。 */
function questMapKey(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "";
  const rev = QUEST_MAP_KEY_REV[s.toLowerCase()];
  const base = (rev || s).toLowerCase();
  const compact = base.replace(/[^0-9a-z]/g, "");
  // ⚠️ 纯中文 / 纯符号名（"桑镇"）紧凑化后是空串 —— 必须退回原文，
  //    否则「桑镇」和「桑林」都会变成 ""，被误判成同一张图（到达校验直接放行）。
  return compact || base;
}

function questList(s: FieldSurvivalState): QuestDef[] {
  return Array.isArray(s.questBoard) ? s.questBoard.filter((q) => q && str(q.id)) : [];
}
function questById(s: FieldSurvivalState, id: string): QuestDef | null {
  const k = str(id).trim();
  return questList(s).find((q) => String(q.id) === k) || null;
}
function ensureProg(s: FieldSurvivalState, id: string): QuestProgress {
  if (!s.quests || typeof s.quests !== "object") s.quests = {};
  const k = String(id);
  if (!s.quests[k]) s.quests[k] = { id: k, status: "active" };
  return s.quests[k];
}

/** 目标需求数量（缺省 1） */
function objNeed(o: QuestObjective): number {
  const c = Math.round(num(o.count, 1));
  return c > 0 ? c : 1;
}
/** 目标已有数量（按 objective 的 target 记 key，包含匹配在累加侧处理） */
function objHave(o: QuestObjective, p: QuestProgress): number {
  if (o.kind === "kill") return num((p.kill || {})[str(o.target)], 0);
  if (o.kind === "gather") return num((p.gather || {})[str(o.target)], 0);
  if (o.kind === "talk") return num((p.talked || {})[str(o.uid || o.target)], 0);
  if (o.kind === "arrive" || o.kind === "explore") return p.arrived ? 1 : 0;
  return 0;
}
function objectivesMet(def: QuestDef, p: QuestProgress): boolean {
  const objs = Array.isArray(def.objectives) ? def.objectives : [];
  if (!objs.length) return false;
  return objs.every((o) => objHave(o, p) >= objNeed(o));
}

/** 目标达成 → status 转 done（只做一次，用于弹「可交任务」提示） */
function refreshQuestStatus(s: FieldSurvivalState, def: QuestDef): void {
  const p = (s.quests || {})[String(def.id)];
  if (!p || p.status !== "active") return;
  if (!objectivesMet(def, p)) return;
  p.status = "done";
  s.questNotice = `「${def.title}」已完成，回任务板交任务`;
  pushEvent(s, `任务完成：${def.title}`);
}

/** ★ 进度钩子①：击杀野怪（名字包含匹配，"尸傀王" 也算 "尸傀"） */
function noteQuestKill(s: FieldSurvivalState, mobName: string): void {
  const nm = str(mobName).trim();
  if (!nm) return;
  for (const def of questList(s)) {
    const p = (s.quests || {})[String(def.id)];
    if (!p || p.status !== "active") continue;
    let hit = false;
    for (const o of def.objectives || []) {
      if (o.kind !== "kill") continue;
      const t = str(o.target).trim();
      if (!t) continue;
      if (nm === t || nm.includes(t) || t.includes(nm)) {
        if (!p.kill) p.kill = {};
        p.kill[t] = num(p.kill[t], 0) + 1;
        hit = true;
      }
    }
    if (hit) refreshQuestStatus(s, def);
  }
}

/** ★ 物品名是否满足采集目标（原双向 includes + 别名表展开）。
 *  · "夜行尸傀" 命中 "尸傀" → includes 就够
 *  · "松木" 命中 "木材" → 必须走 QUEST_GATHER_ALIAS
 */
function questGatherMatch(itemName: string, target: string): boolean {
  const nm = str(itemName).trim();
  const t = str(target).trim();
  if (!nm || !t) return false;
  if (nm === t || nm.includes(t) || t.includes(nm)) return true;
  const alias = QUEST_GATHER_ALIAS[t];
  if (alias) {
    for (const a of alias) {
      if (!a) continue;
      if (nm === a || nm.includes(a) || a.includes(nm)) return true;
    }
  }
  return false;
}

/** ★ 进度钩子②：物品入包（记累计获得，用掉不影响） */
function noteQuestGather(s: FieldSurvivalState, itemName: string, count = 1): void {
  const nm = str(itemName).trim();
  const n = Math.max(1, Math.round(num(count, 1)));
  if (!nm) return;
  for (const def of questList(s)) {
    const p = (s.quests || {})[String(def.id)];
    if (!p || p.status !== "active") continue;
    let hit = false;
    for (const o of def.objectives || []) {
      if (o.kind !== "gather") continue;
      const t = str(o.target).trim();
      if (!t) continue;
      if (questGatherMatch(nm, t)) {
        if (!p.gather) p.gather = {};
        p.gather[t] = num(p.gather[t], 0) + n;
        hit = true;
      }
    }
    if (hit) refreshQuestStatus(s, def);
  }
}

/** ★ 进度钩子③：与目标 NPC 对话过（sys_chat 命中 uid 或名字） */
function noteQuestTalk(s: FieldSurvivalState, uid: string, npcName: string): void {
  const u = str(uid).trim();
  const nm = str(npcName).trim();
  if (!u && !nm) return;
  for (const def of questList(s)) {
    const p = (s.quests || {})[String(def.id)];
    if (!p || p.status !== "active") continue;
    let hit = false;
    for (const o of def.objectives || []) {
      if (o.kind !== "talk") continue;
      const key = str(o.uid || o.target).trim();
      if (!key) continue;
      if ((u && key === u) || (nm && (key === nm || nm.includes(key) || key.includes(nm)))) {
        if (!p.talked) p.talked = {};
        p.talked[key] = num(p.talked[key], 0) + 1;
        hit = true;
      }
    }
    if (hit) refreshQuestStatus(s, def);
  }
}

/** ★ 进度钩子④（每 tick）：非 confirm 的 arrive/explore 目标走到即完成；护送货物跟随玩家 */
function syncQuestArriveAuto(s: FieldSurvivalState): void {
  const me = playerEntity(s);
  if (!me) return;
  const lv = str(s.levelName);
  for (const def of questList(s)) {
    const p = (s.quests || {})[String(def.id)];
    if (!p) continue;
    // 护送货物：跟随玩家（不依赖队伍/组队逻辑，自持一段跟随）
    if (p.status === "active" && p.cargoId) {
      const cargo = (s.entities || []).find((e) => String(e.id) === String(p.cargoId));
      if (cargo && cargo.alive !== false) {
        const d = dist(cargo, me);
        // ★ 直接位移跟随（不依赖 step() 的速度积分，避免货物被其它 AI 分支抢走控制权）
        if (d > 2.2) {
          if (d > QUEST_CARGO_SNAP_M) {
            // ★ 离得太远 = 切图/传送后它还带着旧图坐标（或玩家刚跨图）→ 直接贴回身边。
            //   靠 3.2m/s 的跟随要追十几秒，玩家会以为「货物跟丢了」（2026-10-18 实测 38m）。
            const ang = rnd(0, Math.PI * 2);
            (cargo as Entity).x = me.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M;
            (cargo as Entity).y = me.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M;
          } else {
            const stepLen = Math.min(d - 2.0, 0.32);   // 每 tick 上限 ≈ 3.2 m/s
            const ux = (me.x - cargo.x) / (d || 1);
            const uy = (me.y - cargo.y) / (d || 1);
            (cargo as Entity).x += ux * stepLen;
            (cargo as Entity).y += uy * stepLen;
            (cargo as Entity).facing = ux > 0 ? 0 : 180;
          }
        }
        (cargo as Entity).vx = 0;
        (cargo as Entity).vy = 0;
        // 货物地图名始终跟玩家当前图一致（跨图后 handleLevelChange 若没跑到也不会误判丢失）
        if (String((cargo as any).mapName) !== lv) (cargo as any).mapName = lv;
      }
    }
    if (p.status !== "active") continue;
    for (const o of def.objectives || []) {
      if (o.kind !== "arrive" && o.kind !== "explore") continue;
      if (o.confirm === true) continue;      // 要点按钮的交给 sys_quest_arrive
      if (str(o.map) && questMapKey(str(o.map)) !== questMapKey(lv)) continue;
      if (o.x === undefined || o.y === undefined) continue;
      const r = Math.max(0.5, num(o.radius, QUEST_ARRIVE_DEFAULT_R));
      if (dist(me, { x: num(o.x, 0), y: num(o.y, 0) }) <= r) {
        p.arrived = true;
        refreshQuestStatus(s, def);
      }
    }
  }
}

/** ★ 进度钩子⑤（每 tick）：限时任务（timeLimitTicks）超时 → 判失败
 *  · 只对 status=active 的任务计时（acceptedTick 在接取时写入）
 *  · 超时后 status=failed + failReason=timeout，玩家可在任务板放弃后重接
 *  · 1 tick = 100ms（与 state.tick 递增节奏一致） */
function checkQuestTimeouts(s: FieldSurvivalState): void {
  const now = Math.round(num(s.tick, 0));
  for (const def of questList(s)) {
    const tl = Math.round(num(def.timeLimitTicks, 0));
    if (!(tl > 0)) continue;
    const p = (s.quests || {})[String(def.id)];
    if (!p || p.status !== "active") continue;
    const at = Math.round(num(p.acceptedTick, now));
    if (now - at < tl) continue;
    p.status = "failed";
    p.failReason = "timeout";
    p.cargoId = "";
    removeQuestCargo(s, p);
    s.questNotice = `任务超时失败：${def.title}（限时 ${(tl / 10).toFixed(0)} 秒）`;
    pushEvent(s, `任务超时失败：${def.title}`);
  }
}

/** 判定玩家当前是否满足某个 arrive/explore 目标（点「到达」时校验） */
function questArriveOk(s: FieldSurvivalState, def: QuestDef): { ok: boolean; msg: string } {
  const me = playerEntity(s);
  if (!me) return { ok: false, msg: "玩家不存在" };
  const lv = str(s.levelName);
  // ★ 2026-10-18：纯 gather 任务没有 arrive 目标 → 永不 atDest（之前循环跑空就 ok:true，误弹「到达」）
  const hasArrive = (def.objectives || []).some((o) => o.kind === "arrive" || o.kind === "explore");
  if (!hasArrive) return { ok: false, msg: "无 arrive 目标" };
  for (const o of def.objectives || []) {
    if (o.kind !== "arrive" && o.kind !== "explore") continue;
    const r = Math.max(0.5, num(o.radius, QUEST_ARRIVE_DEFAULT_R));
    if (str(o.map) && questMapKey(str(o.map)) !== questMapKey(lv)) return { ok: false, msg: `还没到 ${o.map}` };
    if (o.x === undefined || o.y === undefined) return { ok: true, msg: "" };
    const d = dist(me, { x: num(o.x, 0), y: num(o.y, 0) });
    if (d > r) return { ok: false, msg: `还差 ${d.toFixed(1)} 米到目的地` };
  }
  return { ok: true, msg: "" };
}

/** 接取护送任务：在玩家身边生成货物实体 */
function spawnQuestCargo(s: FieldSurvivalState, def: QuestDef, p: QuestProgress): void {
  const me = playerEntity(s);
  if (!me) return;
  const cfg = (def.cargo || {}) as { name?: string; hp?: number; gid?: number };
  const hp = Math.max(1, Math.round(num(cfg.hp, 50)));
  const id = QUEST_CARGO_PREFIX + String(def.id);
  // ★ 先把场上同 id 的残留（含死亡淡出中的尸体 / 上一具被打掉的壳）清掉再生成，
  //   否则 `some(e => e.id === id)` 早退会让「找回货物」复活的是一具死尸。
  for (let i = (s.entities || []).length - 1; i >= 0; i--) {
    if (String((s.entities || [])[i].id) === id) (s.entities as Entity[]).splice(i, 1);
  }
  p.cargoId = id;
  const ang = rnd(0, Math.PI * 2);
  const e = {
    id,
    name: str(cfg.name).trim().slice(0, 12) || "货物",
    side: "ally",
    x: me.x + Math.cos(ang) * 1.2,
    y: me.y + Math.sin(ang) * 1.2,
    vx: 0, vy: 0,
    hp, maxHp: hp,
    mp: 0, maxMp: 0,
    exp: 0, expToNext: 0,
    level: Math.max(1, Math.round(num(def.level, 1))),
    atk: 0, def: 0, speed: 2.2,
    facing: 180, cooldown: 0, alive: true,
    homeX: me.x, homeY: me.y,
    camp: "friendly",
    entity_type: "QUEST_CARGO",
    gid: num(cfg.gid, 0) || undefined,
    _questCargo: String(def.id),
  } as unknown as Entity;
  (s.entities as Entity[]).push(e);
  p.cargoId = id;
}
function removeQuestCargo(s: FieldSurvivalState, p: QuestProgress): void {
  const id = str(p.cargoId);
  if (!id) return;
  const i = (s.entities || []).findIndex((e) => String(e.id) === id);
  if (i >= 0) s.entities.splice(i, 1);
  p.cargoId = "";
}

/** 把任意来源（AI / JSON / 参数卡）的任务对象收敛成合法 QuestDef；非法返回 null */
function normalizeQuestDef(raw: any, idx = 0): QuestDef | null {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id).trim() || `Q${String(idx + 1).padStart(2, "0")}`;
  const title = cleanTitle(raw.title || raw.name || id);
  if (!title) return null;

  // objectives
  const objectives: QuestObjective[] = [];
  const rawObjs = Array.isArray(raw.objectives) ? raw.objectives : [];
  for (const o of rawObjs) {
    if (!o || typeof o !== "object") continue;
    const kind = str((o as any).kind).trim();
    if (!QUEST_KIND_SET.has(kind)) continue;
    const obj: QuestObjective = { kind: kind as QuestObjective["kind"] };
    const t = str((o as any).target).trim();
    if (t) obj.target = t.slice(0, 20);
    const c = Math.round(num((o as any).count, 1));
    obj.count = c > 0 ? c : 1;
    const mRaw = str((o as any).map).trim();
    const m = normQuestMap(mRaw);
    if (m) obj.map = m;
    // ★ mapRaw 必须是**关卡 key**（maps/<key>.json），前端跨图寻路直接拿它切图。
    //   历史存档里 map 被归一过，这里反查回 slug；新数据（quests.json 原始 slug）原样保留。
    if (mRaw) obj.mapRaw = rawQuestMapKey(mRaw);
    if ((o as any).x !== undefined && (o as any).y !== undefined) {
      obj.x = num((o as any).x, 0); obj.y = num((o as any).y, 0);
    }
    if ((o as any).radius !== undefined) obj.radius = Math.max(0.5, num((o as any).radius, QUEST_ARRIVE_DEFAULT_R));
    if ((o as any).confirm === true) obj.confirm = true;
    const u = str((o as any).uid).trim();
    if (u) obj.uid = u;
    objectives.push(obj);
  }
  if (!objectives.length) {
    // 没有 objectives → 从 type/target/count 推断一条
    const t = str((raw as any).target).trim().slice(0, 20);
    const c = Math.max(1, Math.round(num((raw as any).count, 1)));
    if (t && c > 0) {
      const inferred: QuestObjective = { kind: "kill", target: t, count: c };
      objectives.push(inferred);
    }
  }

  // type：显式合法 > 从 objectives 推断 > 兜底
  let type = str((raw as any).type).trim();
  if (!QUEST_TYPE_SET.has(type)) {
    const first = objectives[0];
    if (first?.kind === "kill") type = "kill";
    else if (first?.kind === "gather") type = "gather";
    else if (first?.kind === "talk") type = "talk";
    else if (first?.kind === "arrive" || first?.kind === "explore") {
      type = (raw as any).cargo ? "escort" : (first.kind === "explore" ? "explore" : "deliver");
    } else type = "explore";
  }

  const def: QuestDef = {
    id,
    title,
    type: type as QuestDef["type"],
    giver: str((raw as any).giver).trim() || "任务板",
    objectives,
  };
  const map = normQuestMap((raw as any).map);
  if (map) def.map = map;
  const desc = str((raw as any).desc ?? (raw as any).description).trim();
  if (desc) def.desc = desc.slice(0, 200);
  const lv = Math.round(num((raw as any).level, 0));
  if (lv > 0) def.level = lv;
  if ((raw as any).repeat === true) def.repeat = true;
  const tl = Math.round(num((raw as any).timeLimitTicks, 0));
  if (tl > 0) def.timeLimitTicks = tl;
  const tim = str((raw as any).turnInMap).trim();
  if (tim) def.turnInMap = tim;
  if ((raw as any).cargo && typeof (raw as any).cargo === "object") {
    def.cargo = {
      name: str((raw as any).cargo.name).trim().slice(0, 12) || "货物",
      hp: Math.max(1, Math.round(num((raw as any).cargo.hp, 50))),
      gid: Math.round(num((raw as any).cargo.gid, 0)) || undefined,
    };
  }
  if (Array.isArray((raw as any).consume)) {
    const cs = (raw as any).consume
      .map((c: any) => ({ name: str(c?.name).trim().slice(0, 20), count: Math.max(1, Math.round(num(c?.count, 1))) }))
      .filter((c: any) => !!c.name);
    if (cs.length) def.consume = cs;
  }
  if ((raw as any).flags && typeof (raw as any).flags === "object") {
    const f = (raw as any).flags as Record<string, any>;
    const fl: { accept?: string; done?: string } = {};
    if (str(f.accept).trim()) fl.accept = str(f.accept).trim();
    if (str(f.done).trim()) fl.done = str(f.done).trim();
    if (fl.accept || fl.done) def.flags = fl;
  }
  const rw = (raw as any).reward;
  if (rw && typeof rw === "object") {
    const reward: QuestDef["reward"] = {};
    const exp = Math.round(num((rw as any).exp, 0));
    const money = Math.round(num((rw as any).money, 0));
    if (exp > 0) reward.exp = exp;
    if (money > 0) reward.money = money;
    const items = Array.isArray((rw as any).items)
      ? (rw as any).items
          .map((it: any) => ({ name: str(it?.name).trim().slice(0, 20), count: Math.max(1, Math.round(num(it?.count, 1))) }))
          .filter((it: any) => !!it.name)
      : [];
    if (items.length) reward.items = items;
    if (reward.exp || reward.money || reward.items) def.reward = reward;
  }
  const from = str((raw as any).from).trim();
  if (from) def.from = from;
  return def;
}

/** 写玩家 flag（与事件系统同源：t_plugin_session_data，key=player_flags） */
async function setPlayerFlag(ctx: PluginGameContext | undefined, key: string, value: unknown): Promise<void> {
  const api = ctx?.tsApi?.pluginData;
  if (!api?.get || !api?.set) return;
  const k = str(key).trim();
  if (!k) return;
  try {
    const cur = (await api.get("player_flags")) as Record<string, unknown> | null;
    const next = { ...((cur && typeof cur === "object" ? cur : {}) as Record<string, unknown>), [k]: value };
    await api.set("player_flags", next);
  } catch { /* 落库失败不阻断玩法 */ }
}

/** 从玩家背包扣物品（交任务消耗用） */
function removeBagItemFromCard(s: FieldSurvivalState, name: string, count = 1): number {
  const nm = str(name).trim();
  const n = Math.max(1, Math.round(num(count, 1)));
  if (!nm) return 0;
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const slot = bag.find((x) => sameName(x.name, nm));
  if (!slot) return 0;
  const take = Math.min(n, Math.max(0, Math.round(num(slot.count, 0))));
  slot.count -= take;
  const next = bag.filter((x) => Math.round(num(x.count, 0)) > 0);
  patchCard(s, { items: serializeBag(next, card.items) });
  applyBagAttributes(s);
  return take;
}

/** 供前端渲染的任务视图（available / active / done / turned） */
function buildQuestView(s: FieldSurvivalState): void {
  const board = questList(s);
  const me = playerEntity(s);
  const lv = str(s.levelName);
  const mapRow = (def: QuestDef, status: string) => {
    const p = (s.quests || {})[String(def.id)];
    const objectives = (def.objectives || []).map((o) => ({
      kind: o.kind,
      target: str(o.target),
      have: p ? objHave(o, p) : 0,
      need: objNeed(o),
      confirm: o.confirm === true,
      map: str(o.map),
      /** ★ 原始关卡 key（跨图寻路传送用；map 是归一后的运行时名）
       *  读时再兜一层 rawQuestMapKey：某些恢复路径会跳过 normalizeQuestDef（老存档 / 直接赋值），
       *  这里保证前端**永远**拿到能直接喂给 switchLevel 的 key。 */
      mapRaw: rawQuestMapKey(str(o.mapRaw) || str(o.map)),
      /** ★ arrive/explore 目的地坐标（前端寻路 + 画「目的地」图标用） */
      x: o.x,
      y: o.y,
      radius: o.radius,
    }));
    const met = p ? objectivesMet(def, p) : false;
    return {
      id: String(def.id),
      title: def.title,
      type: def.type,
      giver: str(def.giver) || "任务板",
      desc: str(def.desc),
      level: Math.max(1, Math.round(num(def.level, 1))),
      status,
      repeat: def.repeat === true,
      /** ★ 限时任务：剩余 tick（-1 = 不限时 / 非进行中）；前端据此显示倒计时 */
      timeLimitTicks: Math.max(0, Math.round(num(def.timeLimitTicks, 0))),
      remainTicks: (() => {
        const tl = Math.round(num(def.timeLimitTicks, 0));
        if (!(tl > 0) || !p || p.status !== "active") return -1;
        const now = Math.round(num(s.tick, 0));
        const at = Math.round(num(p.acceptedTick, now));
        return Math.max(0, tl - (now - at));
      })(),
      failReason: p ? str((p as any).failReason) : "",
      objectives,
      reward: def.reward || { exp: 0, money: 0, items: [] },
      canTurnIn: status === "done",
      canArrive: status === "active" && (def.objectives || []).some((o) => (o.kind === "arrive" || o.kind === "explore") && o.confirm === true),
      /** 当前位置是否已满足 arrive 判定（前端据此点亮「到达」） */
      atDest: status === "active" ? questArriveOk(s, def).ok : false,
      progress: objectives.map((o) => `${o.target || o.kind} ${o.have}/${o.need}`).join("，"),
      met,
      cargoAlive: p && p.cargoId ? !!(s.entities || []).find((e) => String(e.id) === String(p.cargoId) && e.alive !== false) : false,
      /** ★ 货物是否丢失（护送任务进行中/因货失败时）—— 前端据此显示「找回货物」 */
      cargoLost: !!(p && p.cargoId && (p.status === "active" || p.status === "failed")
        && !(s.entities || []).find((e) => String(e.id) === String(p.cargoId) && e.alive !== false)),
      /** ★ 第一个 arrive/explore 目标的便捷字段（寻路 / 地图标 / 到达按钮共用） */
      destMap: (() => {
        const o = (def.objectives || []).find((x) => x.kind === "arrive" || x.kind === "explore");
        return o ? str(o.map) : "";
      })(),
      /** ★ 目的地关卡 key（跨图寻路 sys_travel / switchLevel 用） */
      destMapRaw: (() => {
        const o = (def.objectives || []).find((x) => x.kind === "arrive" || x.kind === "explore");
        return o ? rawQuestMapKey(str(o.mapRaw) || str(o.map)) : "";
      })(),
      destX: (() => {
        const o = (def.objectives || []).find((x) => x.kind === "arrive" || x.kind === "explore");
        return o ? o.x : undefined;
      })(),
      destY: (() => {
        const o = (def.objectives || []).find((x) => x.kind === "arrive" || x.kind === "explore");
        return o ? o.y : undefined;
      })(),
      destRadius: (() => {
        const o = (def.objectives || []).find((x) => x.kind === "arrive" || x.kind === "explore");
        return o ? Math.max(0.5, num(o.radius, QUEST_ARRIVE_DEFAULT_R)) : QUEST_ARRIVE_DEFAULT_R;
      })(),
    };
  };
  // 可接：本图（或全图）任务 + 未接 / 已放弃 / repeat 且已交
  const available: any[] = [];
  const active: any[] = [];
  const done: any[] = [];
  const turned: any[] = [];
  for (const def of board) {
    const p = (s.quests || {})[String(def.id)];
    const st = p ? String(p.status) : "";
    if (st === "active" || st === "failed") active.push(mapRow(def, st));
    else if (st === "done") done.push(mapRow(def, "done"));
    else if (st === "turned") {
      if (def.repeat) available.push(mapRow(def, "available"));
      else turned.push(mapRow(def, "turned"));
    } else {
      if (!def.map || !lv || questMapKey(def.map) === questMapKey(lv)) available.push(mapRow(def, "available"));
      else available.push(mapRow(def, "away"));
    }
  }
  (s as any).questView = { available, active, done, turned, playerLevel: Math.max(1, Math.round(num(me?.level, 1))) };
}

/** 从 pluginData["quest_defs"] 载入任务定义
 *  · 板子为空 → 直接载入（避免覆盖宿主已下发的内容）
 *  · 板子上只剩「AI 兜底」临时委托（from=ai-fallback）→ 清掉它们再载入故事任务表
 *    （task-speaker-agent 是台词发言器，不会产出任务 JSON，兜底委托只是占位，
 *      故事任务表一旦可用就应让位，否则板上永远只有一条同样的兜底任务） */
async function ensureQuestDefs(ctx: PluginGameContext | undefined, s: FieldSurvivalState): Promise<number> {
  const board = Array.isArray(s.questBoard) ? s.questBoard : [];
  // 兜底委托识别：from=ai-fallback（新）；历史版本 from 被误标成 "ai" 但 id 以 QAI 开头
  const isFallback = (q: any) => {
    const f = str((q as any).from);
    return f === "ai-fallback" || (f === "ai" && /^QAI/.test(String((q as any).id)));
  };
  const onlyFallback = board.length > 0 && board.every(isFallback);
  if (board.length && !onlyFallback) return 0;
  if (onlyFallback) s.questBoard = [];
  const get = ctx?.tsApi?.pluginData?.get;
  if (!get) return 0;
  try {
    const raw = await get("quest_defs");
    const arr = Array.isArray(raw) ? raw
      : Array.isArray((raw as any)?.quests) ? (raw as any).quests
      : Array.isArray((raw as any)?.defs) ? (raw as any).defs
      : [];
    const defs = arr.map((x: any, i: number) => normalizeQuestDef(x, i)).filter(Boolean) as QuestDef[];
    if (!defs.length) return 0;
    s.questBoard = defs;
    return defs.length;
  } catch { return 0; }
}

/** ★ 把 AI 新增的任务定义回写 pluginData["quest_defs"]，跨会话长期保留
 *  · 与既有 quest_defs 按 id 合并（既有优先，绝不覆盖宿主/CLI 下发的故事任务表）
 *  · 写 { version:1, quests:[...] } —— 与故事任务表 quests.json 同构，ensureQuestDefs 可直接读回 */
async function persistQuestDefs(ctx: PluginGameContext | undefined, newDefs: QuestDef[]): Promise<void> {
  const api = ctx?.tsApi?.pluginData;
  const set = api?.set;
  if (!set || !newDefs.length) return;
  try {
    let existing: any[] = [];
    if (api?.get) {
      const raw = await api.get("quest_defs");
      existing = Array.isArray(raw) ? raw
        : Array.isArray((raw as any)?.quests) ? (raw as any).quests
        : Array.isArray((raw as any)?.defs) ? (raw as any).defs
        : [];
    }
    const seen = new Set(existing.map((x: any) => String(x?.id ?? "")));
    const merged = [...existing];
    for (const d of newDefs) {
      const id = String(d.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(d);
    }
    if (merged.length === existing.length) return;   // 无新增 → 不写，避免无谓落库
    await set("quest_defs", { version: 1, quests: merged });
  } catch { /* 落库失败不阻断玩法 */ }
}

/** ★ AI 生成可接任务：调 field-survival-quest-gener（后端专用「只输出 JSON」agent），
 *   输出收敛成 QuestDef[] 并入 board，并回写 pluginData["quest_defs"] 长期保留。
 *   agent 缺失 / 超时 / 输出不合法 → 兜底 3 条不同类型委托（保证面板永远可用）。 */
async function generateQuestsByAI(s: FieldSurvivalState, ctx: PluginGameContext | undefined, n = 3): Promise<number> {
  const count = Math.max(1, Math.min(6, Math.round(num(n, 3))));
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(me?.level, 1)));
  let arr: any[] = [];
  let fallbackUsed = false;
  try {
    const run = ctx?.tsApi?.agent?.run;
    if (run) {
      const r: any = await withTimeout(
        run("field-survival-quest-gener", {
          storyDigest: buildStoryDigest(ctx),
          mapName: str(s.levelName),
          playerLevel: lv,
          count,
          systemPrompt: PROMPT_FIELD_SURVIVAL_QUEST_GENER,
          /** 已发布任务标题，agent 据此避免重复 */
          existingTitles: questList(s).map((q) => str(q.title)).filter(Boolean).slice(0, 40),
        }),
        QUEST_GEN_TIMEOUT_MS,
        "quest-gener agent 超时",
      );
      const out = r?.output;
      const got = Array.isArray(out?.quests) ? out.quests
        : Array.isArray(out) ? out
        : Array.isArray(out?.defs) ? out.defs
        : [];
      if (got.length) arr = got;
    }
  } catch { /* AI 不可用 → 兜底 */ }
  if (!arr.length) {
    // ★ 兜底：3 条不同类型委托（id 按板上已有 QAI 序号递增，保证多次生成不撞 id）
    fallbackUsed = true;
    let aiSeq = 0;
    for (const q of questList(s)) {
      const m = /^QAI(\d+)/.exec(String(q.id));
      if (m) aiSeq = Math.max(aiSeq, Number(m[1]));
    }
    const nid = (k: number) => `QAI${String(aiSeq + k).padStart(2, "0")}`;
    arr = [
      { id: nid(1), title: "清剿周边湮物", type: "kill", objectives: [{ kind: "kill", target: "湮物", count: 5 }] },
      { id: nid(2), title: "采集应急物资", type: "gather", objectives: [{ kind: "gather", target: "木材", count: 4 }] },
      { id: nid(3), title: "探查附近区域", type: "explore", objectives: [{ kind: "explore", map: str(s.levelName), radius: 6, confirm: true }] },
    ];
  }
  const existIds = new Set(questList(s).map((q) => String(q.id)));
  const existTitles = new Set(questList(s).map((q) => str(q.title)));
  const addedDefs: QuestDef[] = [];
  for (const item of arr) {
    // 兜底委托标记 ai-fallback：故事任务表（quest_defs）可用时应被 ensureQuestDefs 让位
    const def = normalizeQuestDef({ ...(item || {}), from: fallbackUsed ? "ai-fallback" : "ai" }, addedDefs.length);
    if (!def) continue;
    if (existIds.has(String(def.id))) def.id = `${def.id}_${Date.now() % 10000}`;
    existIds.add(String(def.id));
    // 同标题已在板上（含兜底委托重复点击）→ 跳过，不再堆一模一样的任务
    if (existTitles.has(str(def.title))) continue;
    existTitles.add(str(def.title));
    if (!Array.isArray(s.questBoard)) s.questBoard = [];
    s.questBoard.push(def);
    addedDefs.push(def);
  }
  // ★ ③ AI 委托落库：跨会话长期保留（下次进游戏 ensureQuestDefs 会读回）
  await persistQuestDefs(ctx, addedDefs);
  return addedDefs.length;
}

/** ★ AI 回答任务详情 / 玩家追问（结果写 s.questAiText） */
async function askQuestByAI(s: FieldSurvivalState, ctx: PluginGameContext | undefined, def: QuestDef, question: string): Promise<string> {
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(me?.level, 1)));
  const p = (s.quests || {})[String(def.id)];
  const prog = (def.objectives || [])
    .map((o) => `${o.kind}:${str(o.target) || ""} ${p ? objHave(o, p) : 0}/${objNeed(o)}`)
    .join("；");
  const prompt =
    `任务：${def.title}（${def.type}）\n描述：${str(def.desc)}\n进度：${prog || "未接取"}\n` +
    `奖励：${num(def.reward?.exp, 0)}exp / ${num(def.reward?.money, 0)}金\n` +
    `玩家问题：${question || "这个任务该怎么做？给我一点提示。"}\n` +
    `用任务板/雇主的口吻回答，不超过 80 字，只输出回答本身。`;
  try {
    if (!ctx?.tsApi?.agent) return "（任务板没人应答——宿主未接入 AI）";
    const r = await withTimeout(
      ctx.tsApi.agent.run("task-speaker-agent", {
        npcId: "quest_board",
        npcName: "任务板",
        npcCard: { id: "quest_board", name: "任务板", roleType: "npc", level: lv, description: str(def.desc) || "张贴委托的木牌" },
        isNeutral: true,
        userText: prompt,
        lastResp: null,
        mode: "response",
        context: { storyDigest: buildStoryDigest(ctx), playerLevel: lv },
      }),
      QUEST_AGENT_TIMEOUT_MS,
      "quest agent 超时",
    );
    const t = String(r?.output?.text || "").trim();
    return t || "（任务板沉默了一会，什么也没说）";
  } catch {
    return "（任务板没人应答——AI 超时或不可用）";
  }
}

/** ★ 野怪击杀奖励③：问 AI「吸收暗核后获得什么技能」，写进 skillMeta + 参数卡技能列表。
 *  · 有 `s.skillPool` → AI 只从池里挑一个（故事一致性最好）
 *  · 无池 → AI 按故事自由生成一个（字段仍被收敛进合法枚举）
 *  · AI 不可用 / 超时 / 输出不合法 → 兜底随机（池内优先，其次 CORE_FALLBACK_SKILLS）
 *  · 已拥有同名技能 → 不重复占格，改为 lv+1（威力 ×1.25） */
async function grantCoreSkill(s: FieldSurvivalState, ctx?: PluginGameContext): Promise<string> {
  const pool = Array.isArray(s.skillPool)
    ? Array.from(new Set(s.skillPool.map((x) => cleanSkillName(x).slice(0, 12)).filter(Boolean)))
    : [];
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(me?.level, 1)));
  const prompt = pool.length
    ? `宿主吸收了一枚暗核。请只从下列技能里选一个最契合当前处境的，只输出这一个技能名，不要任何解释文字：\n${pool.map((n) => "- " + n).join("\n")}`
    : `宿主吸收了一枚暗核，湮源要赋予宿主一项新技能。只输出一个 JSON 对象，不要任何解释文字：\n{"name":"技能名(不超过12个字)","power":30到80的整数,"cost":0到20的整数,"cd":30到120的整数,"type":"atk或heal或buff","range":"melee或ranged","effects_type":"dark或fire或water或thunder或wind或earth或metal或wood或light或poison或bleed或normal","desc":"一句描述"}`;

  let picked = "";
  let meta: Record<string, any> | null = null;
  try {
    if (ctx?.tsApi?.agent) {
      const r = await withTimeout(
        ctx.tsApi.agent.run("task-speaker-agent", {
          npcId: "core",
          npcName: "湮源",
          npcCard: { id: "core", name: "湮源", roleType: "npc", level: lv, description: "寄生在宿主体内的湮源意识体，解析暗核并把力量赋予宿主" },
          isNeutral: false,
          userText: prompt,
          lastResp: null,
          mode: "response",
          context: { storyDigest: buildStoryDigest(ctx), playerLevel: lv },
        }),
        CORE_AGENT_TIMEOUT_MS,
        "core agent 超时",
      );
      const raw = String(r?.output?.text || "")
        .replace(/^\s*```[a-zA-Z]*\s*/, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      if (raw) {
        try {
          const j = JSON.parse(raw);
          if (j && str((j as any).name)) { picked = cleanSkillName((j as any).name).slice(0, 12); meta = j as Record<string, any>; }
        } catch { /* 不是 JSON → 纯文本 */ }
        if (!picked && pool.length) {
          // ★ 有池时池内匹配；纯描述文字（"暗核已解析……宿主"）一律不收
          //   之前会把整段描述截 12 字当技能名 → 出现"暗核已解析......宿主"这种诡异条目
          picked = pool.find((n) => raw.includes(n)) || "";
        }
        if (!picked && !pool.length) {
          // ★ 仅在无池（自由生成）时才接受纯文本第一行作为技能名
          picked = cleanSkillName(raw.split(/\n/)[0]).slice(0, 12);
        }
      }
    }
  } catch { /* AI 不可用 / 超时 → 走兜底 */ }

  if (pool.length && !pool.includes(picked)) picked = "";   // 有池时绝不接受池外名字
  if (!picked) {
    picked = pool.length
      ? (pool[Math.floor(rnd(0, pool.length))] || "")
      : (CORE_FALLBACK_SKILLS[Math.floor(rnd(0, CORE_FALLBACK_SKILLS.length))] || "碎石击");
  }
  if (!picked) return "";

  const key = skillKey(picked);
  const prevMeta = ((s.skillMeta || {}) as Record<string, any>)[key] || {};
  const prevSlot = (s.skills || []).find((k) => skillKey(k.name) === key);
  const base = inferSkillType(picked);
  const isUp = !!prevSlot;
  const newLv = Math.max(1, Math.round(num(prevSlot?.lv, num(prevMeta.lv, 1))) + (isUp ? 1 : 0));
  const basePower = num(prevMeta.power, isUp ? num(prevSlot?.power, 12) : 12 + Math.floor(rnd(0, 10)));
  const m = {
    power: Math.max(1, Math.round(num(meta?.power, isUp ? basePower * 1.25 : basePower))),
    cost: Math.max(0, Math.round(num(meta?.cost, num(prevMeta.cost, isUp ? num(prevSlot?.cost, 0) : 0)))),
    cd: Math.max(1, Math.round(num(meta?.cd, num(prevMeta.cd, isUp ? num(prevSlot?.cd, 24) : 24 + Math.floor(rnd(0, 18)))))),
    type: (["atk", "heal", "buff"] as const).includes(String(meta?.type) as any) ? String(meta?.type) : (prevMeta.type || base.type),
    range: String(meta?.range) === "ranged" ? "ranged" : (prevMeta.range || base.range),
    lv: newLv,
    buff_type: BUFF_TYPES.includes(String(meta?.buff_type)) ? String(meta?.buff_type) : (prevMeta.buff_type || ""),
    effects_type: typeof meta?.effects_type === "string" ? meta.effects_type : (prevMeta.effects_type || ""),
  };
  s.skillMeta = { ...(s.skillMeta || {}), [key]: m };

  // 参数卡「技能」只存名字列表：已有 → 替换成新 lv 注记；没有 → 追加
  const card = (s.playerCard || {}) as Record<string, any>;
  const flat: string[] = [];
  (Array.isArray(card.skills) ? card.skills : []).forEach((x: any) => {
    if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (cleanSkillName(p)) flat.push(p.trim()); });
    else { const n = str(x?.name); if (n) flat.push(n); }
  });
  const annotated = newLv > 1 ? `${picked}（lv${newLv}）` : picked;
  const at = flat.findIndex((x) => skillKey(x) === key);
  if (at >= 0) flat[at] = annotated; else flat.push(annotated);
  patchCard(s, { skills: flat });   // patchCard 内部会自动 s.skills = buildSkills(...)

  const tLabel = m.type === "heal" ? "治疗" : m.type === "buff" ? `强化(${m.buff_type || "-"})` : (m.range === "ranged" ? "远程" : "近战");
  pushEvent(s, isUp ? `暗核共鸣：「${picked}」提升至 lv${newLv}（${tLabel}）` : `暗核解析完成：习得「${picked}」（${tLabel}·lv${newLv}）`);
  if (me) {
    floater(s, isUp ? `${picked} lv${newLv}` : `习得 ${picked}`, me.x, me.y - 60);
    pushVfx(s, { kind: "buff_ring", entityId: me.id, x: me.x, y: me.y, life: 30, total: 30, color: effectColor(m.effects_type, "#9CCFFF"), icon: effectIcon(m.effects_type), size: 1.0 });
  }
  return isUp ? `，「${picked}」提升至 lv${newLv}` : `，湮源解析出技能「${picked}」`;
}

function useBagItem(s: FieldSurvivalState, name: string): string {
  const me = playerEntity(s);
  if (!me || !me.alive) return "角色不可用";
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const it = bag.find((x) => x.name === name);
  if (!it || it.count <= 0) return `「${name}」不在背包中`;
  // ★ 斧头破坏模式：使用斧类物品 → 进入破坏模式（不消耗、不攻击）
  if (AXE_RE.test(it.name)) {
    s.axeMode = true;
    pushEvent(s, `举起斧头：点击前方障碍物可进行破坏（使用其他技能/物品会收起斧头）`);
    return `举起斧头，进入破坏模式`;
  }
  // ★ 使用了其他物品 → 收起斧头
  s.axeMode = false;
  const t = it.type || "heal";
  (me as any).actionBobMs = 300;
  floater(s, `使用 ${it.name}`, me.x, me.y - 34);
  let consumed = true;
  let msg = `使用 ${it.name}`;
  if (isCoreItem(s, it)) {
    // ★ 野怪击杀奖励②：核类物品（暗核）→ 吸收：给经验 + 有概率触发 AI 判定「获得什么技能」
    //   技能本身由 handle_action 在本次请求里异步问 AI 后写入（_pendingCoreGrant 标记）
    gainPlayerExp(s, CORE_USE_EXP);
    pushVfx(s, { kind: "buff_ring", entityId: me.id, x: me.x, y: me.y, life: 30, total: 30, color: effectColor((it as any).effects_type, "#9CCFFF"), icon: effectIcon((it as any).effects_type), size: 1.0 });
    floater(s, `+${CORE_USE_EXP}exp`, me.x, me.y - 52);
    pushEvent(s, `吸收 ${it.name}，+${CORE_USE_EXP} 经验`);
    msg += `，湮源吸收 +${CORE_USE_EXP} 经验`;
    if (Math.random() < CORE_SKILL_P) (s as any)._pendingCoreGrant = true;
  } else if (t === "heal") {
    const heal = it.heal || defaultHeal(it.name, it.kind);
    const before = me.hp;
    if (heal > 0) me.hp = clamp(me.hp + heal, 0, me.maxHp);
    pushVfx(s, { kind: "heal_ring", entityId: me.id, x: me.x, y: me.y, life: 18, total: 18, color: effectColor(it.effects_type, "#7CFFB2"), icon: effectIcon(it.effects_type), size: 1.0 });
    if (heal > 0) { floater(s, `+${Math.round(me.hp - before)}`, me.x, me.y - 52); msg += `，恢复 ${Math.round(me.hp - before)} 生命`; }
  } else if (t === "buff") {
    pushVfx(s, { kind: "buff_ring", entityId: me.id, x: me.x, y: me.y, life: 30, total: 30, color: effectColor(it.effects_type, "#9CCFFF"), icon: effectIcon(it.effects_type), size: 1.0 });
    if (it.buff_type) msg += `（${it.buff_type}）`;
  } else {
    // atk / attribute：普攻效果；attribute 是纯属性点，使用不消耗但有小跳 + 普攻特效
    const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(me, e) < SKILL_RANGE_M);
    if ((it.range || "melee") === "ranged" && targets[0]) {
      pushVfx(s, { kind: "fireball", entityId: me.id, targetEntityId: targets[0].id, x: me.x, y: me.y, targetX: targets[0].x, targetY: targets[0].y, facing: me.facing, life: 16, total: 16, color: effectColor(it.effects_type, "#ff6a00"), icon: effectIcon(it.effects_type), size: 1.0 });
    } else {
      pushVfx(s, { kind: "slash_arc", entityId: me.id, x: me.x, y: me.y, facing: me.facing, life: 12, total: 12, color: effectColor(it.effects_type, "#fff"), icon: effectIcon(it.effects_type), size: 1.6 });
    }
    if (num(it.power, 0) > 0 && targets.length) {
      damage(s, targets[0], num(it.power, 0), me);
      msg += `，命中 ${targets[0].name}`;
    }
    if (t === "attribute") { consumed = false; msg += `（属性点 ${it.attribute_type || "-"}+${it.attribute_value || 0}）`; }
  }
  let nextBag = bag;
  if (consumed) {
    const dur = Math.round(num(it.durability, -1));
    if (dur < 0) {
      // ★ 永久（durability=-1）：不扣物品，不扣耐久，剩余继续用
      //   历史 bug：dur<=0 走统一 count-1 → 永久品被当成一次性消耗，用一次就没了
      //   现在明确三档语义：
      //     dur < 0  → 永久（不消耗）
      //     dur = 0  → 一次性物品（每次使用 count -1）
      //     dur > 0  → 有限耐久（同一件内 left 递减，left 用尽才 count -1 换新）
      nextBag = bag;
    } else if (dur === 0) {
      nextBag = bag
        .map((x) => (x.name === it.name ? { ...x, count: x.count - 1 } : x))
        .filter((x) => x.count > 0);
    } else {
      let left = Math.round(num(it.durabilityLeft, dur));
      left -= 1;
      if (left <= 0) {
        nextBag = bag
          .map((x) => (x.name === it.name ? { ...x, count: x.count - 1 } : x))
          .filter((x) => x.count > 0);
        setItemDurLeft(s, it.name, dur); // 换上新的一件，耐久重置
        pushEvent(s, `${it.name} 耐久耗尽，损毁 1 个`);
      } else {
        setItemDurLeft(s, it.name, left);
        pushEvent(s, `${it.name} 耐久 ${left}/${dur}`);
      }
    }
  }
  patchCard(s, { items: serializeBag(nextBag, card.items) });
  applyBagAttributes(s);
  return msg;
}

function playerEntity(s: FieldSurvivalState): Entity | undefined {
  return s.entities.find((e) => e.side === "player");
}

/** 写回宿主 + 本地参数卡同步（patch 含 items / skills 时同步快捷栏） */
function patchCard(s: FieldSurvivalState, patch: Record<string, any>): void {
  const card = { ...((s.playerCard || {}) as Record<string, any>), ...patch };
  s.playerCard = card;
  s.writeback = { ...((s.writeback || {}) as Record<string, any>), ...patch };
  s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
  if (Array.isArray(patch.items)) { s.items = buildItems(card); clampQuickbarPages(s); }
  if (Array.isArray(patch.skills)) { s.skills = buildSkills(card, QUICKBAR_PAGE_SIZE, s.skillMeta); clampQuickbarPages(s); }
}

/** 宿主注入的参数卡若被外部改动，以宿主为准（保证与动态参数卡同步）
 *  ★ 2026-10-19 修复（刷新丢物品的根因）：
 *    ctx.playerCard 是「开局快照」——商城买卖 / 暗核吸收 / 技能卖出只写插件自己的
 *    sys_state 与 s.playerCard，服务端卡永远不知道这些操作。若每次同步都整体以 ctx
 *    为准，刷新后 restoreSys 刚恢复出来的物品、扣掉的金币、卖掉的技能会被立刻冲回
 *    旧值（dev-host 实测：买完 9 件/86323 金 → 刷新变回 8 件/86418 金；
 *    卖出技能也会在下一个 tick 原地复活）。
 *    字段归属规则：
 *      ① items / money / skills 归插件会话所有 —— 已恢复存档时以 s 为准
 *         （s 连该字段都没有时才退回 ctx）；
 *      ② level / exp / hp / mp 等剧情字段仍以 ctx 为准
 *         （AI 剧情直接改角色卡 → 回灌玩家实体，这是既有设计）。
 */
function syncCardFromContext(s: FieldSurvivalState, ctx?: PluginGameContext): void {
  const card = (ctx?.playerCard || {}) as Record<string, any>;
  if (!card || !Object.keys(card).length) return;
  const cur = (s.playerCard || {}) as Record<string, any>;
  const restored = (s as any)._sysRestored === true;
  const cardItems = Array.isArray(card.items) ? card.items.length : 0;
  const curItems = Array.isArray(cur.items) ? cur.items.length : 0;
  if (!restored && cardItems === 0 && curItems > 0) {
    // 未恢复存档但 s 已有物品（本会话刚买过）→ 同样保留，别被空卡冲掉
    return;
  }
  // 已恢复存档：以 ctx 为底（剧情字段），但 items/money/skills 用 s 的（插件经济权威）
  const base: Record<string, any> = restored ? { ...card } : (card as Record<string, any>);
  if (restored) {
    if (Array.isArray(cur.items)) base.items = cur.items;
    if (cur.money != null) base.money = cur.money;
    if (Array.isArray(cur.skills) && cur.skills.length) base.skills = cur.skills;
  }
  const sig = (c: any) => JSON.stringify([
    c?.items ?? null, c?.money ?? null, c?.skills ?? null,
    c?.level ?? null, c?.exp ?? null, c?.hp ?? null, c?.mp ?? null,   // ★ 等级系统字段
  ]);
  if (sig(base) === sig(cur)) return;
  // ★ 技能排序：宿主下发的参数卡可能还没收到写回（顺序是旧的），
  //   先用持久化的 skillOrder 还原再 build，避免排序被冲掉。
  //   这里只对 skills 做浅拷贝，避免改到宿主 context 对象本身。
  let cardForBuild: Record<string, any> = base;
  if (Array.isArray(s.skillOrder) && s.skillOrder.length) {
    cardForBuild = { ...base };
    applyCardSkillOrder(cardForBuild, s.skillOrder);
  }
  s.playerCard = cardForBuild;
  s.items = buildItems(cardForBuild);
  s.skills = buildSkills(cardForBuild, QUICKBAR_PAGE_SIZE, s.skillMeta);
  clampQuickbarPages(s);
  // ★ 等级系统：AI 剧情在角色卡上直接改动的 等级/经验/HP/MP 回灌到玩家实体（数据一致性）
  const me = playerEntity(s);
  if (me) {
    if (card.level != null) me.level = Math.max(1, Math.round(num(card.level, me.level)));
    if (card.exp != null) s.exp = Math.max(0, Math.round(num(card.exp, s.exp)));
    if (card.hp != null) me.hp = Math.max(0, Math.round(num(card.hp, me.hp)));
    if (card.mp != null) me.mp = Math.max(0, Math.round(num(card.mp, me.mp)));
    refreshPlayerExpFields(s);
  }
}

/* ============================================================
   ★ 程序生成实体形象（2026-10-20）：不调图片模型，本地按提示词画一张像素小人。
   · 纯 TS：手写 PNG 编码（zlib store + CRC32），零运行时依赖
   · 关键词上色（发色/衣服/肤色）+ 提示词种子随机（同词同图，异词异图）
   · 用于「程序生成」按钮；AI 生成失败不再有 mock 兜底 → 直接报错
   ============================================================ */

/** zlib store 格式（deflate BTYPE=00 不压缩）：zlib header + stored blocks + adler32。
 *  PNG IDAT 允许 store deflate → 免去 node:zlib / CompressionStream 依赖，
 *  后端 node 与 dev-host 浏览器两端都能同步出图。96px 图 store 后约 50KB，可接受。 */
function adler32(buf: Buffer): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function zlibStore(raw: Buffer): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x78, 0x01])];
  // stored block 每块最多 65535 字节
  for (let off = 0; off < raw.length; off += 65535) {
    const slice = raw.subarray(off, Math.min(off + 65535, raw.length));
    const final = off + 65535 >= raw.length ? 1 : 0;
    const head = Buffer.alloc(5);
    head[0] = final; // BFINAL + BTYPE=00
    head.writeUInt16LE(slice.length, 1);
    head.writeUInt16LE(~slice.length & 0xffff, 3);
    chunks.push(head, slice);
  }
  const ad = Buffer.alloc(4);
  ad.writeUInt32BE(adler32(raw), 0);
  chunks.push(ad);
  return Buffer.concat(chunks);
}
/** PNG 最小编码器：RGBA 像素数组 → PNG data:URL（filter 0 + zlib store） */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  // 每行前置 filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** 提示词 → 种子（djb2）+ mulberry32 PRNG：同提示词稳定出同一张 */
function spritePromptRng(prompt: string): () => number {
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) h = ((h << 5) + h + prompt.charCodeAt(i)) | 0;
  let a = (h ^ 0x9e3779b9) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 提示词关键词 → 颜色（找不到关键词就随机取色板） */
const SPRITE_PALETTES: Record<string, string[]> = {
  hair: {
    银发: ["#d8d8e8", "#c0c0d8"], 白发: ["#f0f0f0"], 金发: ["#e8c84a", "#d4a836"], 黄发: ["#e8c84a"],
    黑发: ["#2a2a35"], 蓝发: ["#3a6ac8", "#2a55b0"], 红发: ["#c8402a"], 棕发: ["#8a5a32"], 褐发: ["#8a5a32"],
    绿发: ["#3aa85a"], 紫发: ["#8a4ac8"], 粉发: ["#e88ab0"], 灰发: ["#9a9aa8"],
  },
  cloth: {
    黑衣: ["#26262e", "#1c1c24"], 白衣: ["#e8e8e8"], 红衣: ["#b03028"], 蓝衣: ["#2a4aa0"],
    绿衣: ["#2a7a42"], 法袍: ["#4a3a8a", "#3a2a7a"], 皮甲: ["#7a5230"], 布衣: ["#8a7a5a"],
    铠甲: ["#8a8a96"], 重甲: ["#6a6a78"], 长袍: ["#4a4a6a"], 游侠: ["#3a5a3a"], 法师: ["#4a3a8a"],
  },
};
function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * 按提示词程序化画 96×96 像素小人（4x chunky → 画布按 96 逻辑像素画，导出 96px）。
 * 结构参考 Rotten-Soup 预选形象：正面站姿，头/身/腿分块 + 1px 描边感。
 */
function renderSpriteProgrammatically(prompt: string): string {
  const W = 96, H = 96;
  const rng = spritePromptRng(prompt);
  const pick = (arr: string[]): string => arr[Math.floor(rng() * arr.length)] || arr[0];
  let hair = "#5a4632", cloth = "#3a5a3a";
  const lower = prompt;
  for (const [k, v] of Object.entries(SPRITE_PALETTES.hair)) { if (lower.includes(k)) { hair = pick(v); break; } }
  for (const [k, v] of Object.entries(SPRITE_PALETTES.cloth)) { if (lower.includes(k)) { cloth = pick(v); break; } }
  const skinHex = ["#e8b88a", "#d8a878", "#c89868"][Math.floor(rng() * 3)];
  const hairC = hexToRgb(hair), clothC = hexToRgb(cloth), skinC = hexToRgb(skinHex);
  const edgeC: [number, number, number] = [24, 24, 30];
  const px = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, c: [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const rect = (x0: number, y0: number, w: number, h: number, c: [number, number, number]): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c);
  };
  // —— 头（16,14 → 30x26）+ 描边
  rect(16, 14, 30, 26, hairC);
  // 脸（头发覆盖上半，露脸区）
  rect(20, 26, 22, 12, skinC);
  // 刘海：头顶 3-4 行全发色 + 两侧鬓角
  rect(16, 14, 30, 8, hairC);
  rect(16, 22, 5, 12, hairC);
  rect(41, 22, 5, 12, hairC);
  // 眼睛（2px 深色）+ 嘴
  rect(25, 31, 3, 3, edgeC);
  rect(34, 31, 3, 3, edgeC);
  rect(29, 36, 4, 1, [122, 58, 58]);
  // —— 身体（衣服，18,42 → 26x26），手臂两侧用衣色加深
  rect(18, 42, 26, 26, clothC);
  rect(14, 44, 5, 16, clothC);   // 左臂
  rect(43, 44, 5, 16, clothC);   // 右臂
  rect(14, 58, 5, 4, skinC);     // 左手
  rect(43, 58, 5, 4, skinC);     // 右手
  // 衣领高光
  rect(26, 42, 10, 2, [Math.min(255, clothC[0] + 50), Math.min(255, clothC[1] + 50), Math.min(255, clothC[2] + 50)]);
  // 腰带
  rect(18, 54, 26, 3, edgeC);
  // —— 腿（20,68 → 8x14 / 34,68 → 8x14）+ 鞋
  rect(20, 68, 8, 14, edgeC);
  rect(34, 68, 8, 14, edgeC);
  rect(19, 82, 10, 5, [70, 50, 34]);
  rect(33, 82, 10, 5, [70, 50, 34]);
  // —— 噪点纹理（衣/发 8% 概率暗化，出布料颗粒感）
  for (let y = 14; y < 84; y++) {
    for (let x = 14; x < 48; x++) {
      if (rng() < 0.08) {
        const i = (y * W + x) * 4;
        if (px[i + 3] === 255) { px[i] = Math.max(0, px[i] - 22); px[i + 1] = Math.max(0, px[i + 1] - 22); px[i + 2] = Math.max(0, px[i + 2] - 22); }
      }
    }
  }
  return encodePngDataUrl(W, H, px);
}

/** ★ 实体形象：调后端生图 agent 生成一张角色形象图
 *
 *  input 契约（与后端 PluginAgentRunner 的 sprite 分支对齐）：
 *    { prompt, refImages: string[]（data:URL / http(s)，≤3 张）, size, aspectRatio }
 *  返回 { url } 或 { image } 或 { base64 }；纯 base64 由这里补 data:URL 前缀。
 *
 *  说明：插件侧不直接持有图片模型，必须经宿主 agent 通道；后端未注册该 agent 时
 *  返回 ok:false，前端提示「宿主未接入生图模型」，不影响预选/绑定功能。
 */
async function generateSpriteByAI(
  s: FieldSurvivalState,
  context: PluginGameContext | undefined,
  prompt: string,
  refImages: string[],
): Promise<{ ok: boolean; image?: string; error?: string; matting?: string }> {
  const run = context?.tsApi?.agent?.run;
  if (!run) return { ok: false, error: "宿主未接入 AI（agent 通道不可用）" };
  // 参考图必须是后端可读的形态（data:URL / http(s)）；插件内相对路径后端读不到
  const refs = (Array.isArray(refImages) ? refImages : [])
    .map((x) => String(x || "").trim())
    .filter((x) => x.startsWith("data:") || /^https?:/i.test(x))
    .slice(0, 3);
  const card = (s.playerCard || {}) as Record<string, any>;
  const input = {
    prompt: prompt.slice(0, 800),
    refImages: refs,
    style: "2.5d-topdown-pixel",
    size: "1K",
    aspectRatio: "1:1",
    playerName: str(card.name, ""),
    level: Math.round(num(card.level, 1)),
    /** 系统提示词由插件自带传入（宿主不再持有插件提示词） */
    systemPrompt: PROMPT_FIELD_SURVIVAL_SPRITE_GENER,
  };
  try {
    const r = await withTimeout(
      run(SPRITE_GEN_AGENT, input),
      SPRITE_AGENT_TIMEOUT_MS,
      `生图超时（>${Math.round(SPRITE_AGENT_TIMEOUT_MS / 1000)}s）`,
    );
    if (!r || r.ok === false) return { ok: false, error: str(r?.error, "生图失败") };
    const out: any = r.output || {};
    const img = str(out.url || out.image || out.dataUrl || out.base64 || out.path, "");
    if (!img) return { ok: false, error: "生图 agent 未返回图片" };
    const image = /^(data:|https?:|\/)/i.test(img) ? img : `data:image/png;base64,${img}`;
    return { ok: true, image, matting: str(out.matting, "") || undefined };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** ★ 实体形象：把绑定应用到实体（含 parked）——绑定/解绑后立即生效，不用等下一次 ensureNpcCards */
function applySpriteBindToEntities(s: FieldSurvivalState, target: string): void {
  const ov = spriteOverrideFor(s, target);
  const setOn = (e: any) => {
    if (!e) return;
    if (ov) {
      // ★ 写入 entity.customSprite 通道：渲染层优先于 tileset，画 canvas 上的整张图
      (e as any).customSprite = {
        image: ov.image,
        prompt: ov.prompt,
        source: ov.source,
        createdAt: ov.createdAt,
      };
    } else {
      // 解绑 → 清掉 customSprite，entity 回退到 tileset 渲染
      delete (e as any).customSprite;
    }
  };
  (s.entities || []).forEach((e) => { if (String(e.id) === target) setOn(e); });
  const parkedObj: any = (s as any).parked || {};
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((pe: any) => {
      if (String(pe?.id) === target) setOn(pe);
    });
  });
}

/** 角色卡：主体 = 当前 AI 故事对话的动态角色卡（s.roles，与 web 端 play-role-strip 同源），
 *  无论有没有被选择上场全部显示；地图实体只合并运行时信息（位置/血量/经验/组队） */
function ensureNpcCards(s: FieldSurvivalState, levelName: string): void {
  const prev = new Map<string, NpcCard>((s.npcCards || []).map((c) => [String(c.id), c]));
  // ★ 优先按当前 binds 把 entity.avatarPath 同步到「应显示的图」
  //   （删除/解绑后 entity 还没被外部改，prev 里的 avatarPath 是上次的绑定值，
  //    直接用作 buildCard 兜底会回弹；先让 entity 与 binds 对齐再走 buildCard）
  (s.entities || []).forEach((e) => { if (e) applySpriteBindToEntities(s, String(e.id)); });
  const parkedObjPre: any = (s as any).parked || {};
  Object.keys(parkedObjPre).forEach((k) => {
    (Array.isArray(parkedObjPre[k]) ? parkedObjPre[k] : []).forEach((pe: any) => {
      if (pe) applySpriteBindToEntities(s, String(pe.id));
    });
  });
  const party = s.partyIds || [];
  const roles = Array.isArray(s.roles) ? (s.roles as any[]) : [];
  const entByKey = new Map<string, any>();
  (s.entities || []).forEach((e) => {
    entByKey.set(String(e.id), e);
    if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
  });
  // ★ 停车实体（停在别的地图）也参与匹配：角色卡要显示"他在哪张图哪个位置"
  const parkedObj: any = (s as any).parked || {};
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((e: any) => {
      if (!entByKey.has(String(e.id))) entByKey.set(String(e.id), e);
      if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
    });
  });
  const sel: any = (s as any).selections || {};
  const inSel = (arr: any, r: any): boolean =>
    Array.isArray(arr) && arr.some((x) => String(x) === String(r.id) || String(x) === String(r.name));
  const sideOfRole = (r: any): string => {
    const e = entByKey.get(String(r.id)) || entByKey.get(String(r.name));
    if (e) return e.side;
    if (String(r.roleType) === "player") return "player";
    if (inSel(sel.participants, r)) return "ally";
    if (inSel(sel.enemies, r)) return "enemy";
    if (inSel(sel.spectators, r)) return "spectator";
    return "neutral";
  };
  const buildCard = (role: any, forcedSide?: string): NpcCard => {
    const e = entByKey.get(String(role.id)) || entByKey.get(String(role.name)) || null;
    const old = prev.get(String(role.id));
    const side = forcedSide || sideOfRole(role);
    const onMap = !!e;
    const pcRaw = side === "player" && s.playerCard && Object.keys(s.playerCard || {}).length
      ? (s.playerCard as Record<string, any>)
      : (role.parameterCardJson || role.parameter_card_json) || (old && (old as any).parameterCardJson) || null;
    let pc: Record<string, any> | null = null;
    if (pcRaw && typeof pcRaw === "object") {
      pc = { ...pcRaw };
      pc.level = Math.max(1, Math.round(num(e ? (e as any).level : num(role.initial_level, num(pc.level, 1)), 1)));
      if (e) {
        pc.hp = Math.round(num((e as any).hp, num(pc.hp, 0)));
        pc.maxHp = Math.round(num((e as any).maxHp, num(pc.maxHp, pc.hp)));
        // ★ 等级系统：蓝量以实体为权威（满蓝公式 = 100 + 等级*10 + 加成）
        pc.mp = Math.round(num((e as any).mp, num(pc.mp, 0)));
        pc.maxMp = Math.round(num((e as any).maxMp, num(pc.maxMp, pc.mp)));
      }
      if (side === "player") {
        pc.money = num((s.playerCard as any)?.money, num(pc.money, 0));
        pc.exp = Math.round(num((s.playerCard as any)?.exp, num(s.exp, 0)));
        // ★ 等级系统：与玩家实体保持一致（等级/经验/满血满蓝）
        pc.level = Math.max(1, Math.round(num(e ? (e as any).level : pc.level, 1)));
      } else if (e) {
        pc.exp = Math.round(num(old?.exp, num(pc.exp, 0)));
      }
      pc.next_level_exp = pc.level * 100;
    }
    return {
      id: String(role.id),
      name: role.name,
      side,
      enemy: side === "enemy",
      level: Math.max(1, Math.round(num(e ? (e as any).level : num(role.initial_level, num(old?.level, 1)), 1))),
      hp: Math.round(e ? (e as any).hp : num(old?.hp, num(pc?.hp, 0))),
      maxHp: Math.round(e ? (e as any).maxHp : num(old?.maxHp, num(pc?.maxHp, 0))),
      exp: Math.round(num(old?.exp, 0)),
      alive: e ? !!(e as any).alive : (old ? old.alive !== false : true),
      mapName: side === "player" ? (levelName || old?.mapName || "") : (((e as any) && (e as any).mapName) || old?.mapName || ""),
      x: Math.round(e ? (e as any).x : num(old?.x, Math.random() * 100)),
      y: Math.round(e ? (e as any).y : num(old?.y, Math.random() * 100)),
      inParty: party.indexOf(String(role.id)) >= 0,
      /** ★ 头像通道与实体形象（customSprite）严格分离：更换实体形象不得影响悬浮头像 */
      avatarPath: (e && (e as any).avatarPath) || role.avatarPath || (old && old.avatarPath) || undefined,
      /** ★ 实体立绘通道（独立于头像：data:URL 时 canvas 走 customSprite 渲染） */
      customSprite: (() => {
        const so = spriteOverrideFor(s, role.id);
        if (so && so.image) return { image: so.image, prompt: so.prompt, source: so.source as any, createdAt: so.createdAt };
        return e ? ((e as any).customSprite || null) : null;
      })(),
      parameterCardJson: pc,
    } as NpcCard;
  };
  const cards: NpcCard[] = [];
  const seen = new Set<string>();
  const pushCard = (role: any, forcedSide?: string): void => {
    if (!role || seen.has(String(role.id))) return;
    seen.add(String(role.id));
    seen.add(String(role.name));
    cards.push(buildCard(role, forcedSide));
  };
  if (roles.length) {
    const playerRole = roles.find((r) => String(r?.roleType) === "player") || null;
    if (playerRole) pushCard(playerRole, "player");
    roles.forEach((r) => pushCard(r));
  } else {
    // 兜底：故事角色列表缺失时退回地图实体（避免空面板）
    (s.entities || []).forEach((e) => pushCard({ id: e.id, name: e.name, avatarPath: e.avatarPath }, e.side));
  }
  s.npcCards = cards;
  // ★ 实体形象：应用 binds → 写 entity.customSprite（applySpriteBindToEntities）
  //   不再写 entity.avatarPath（那是头像小图通道，customSprite 走 canvas 立绘通道）
  (s.entities || []).forEach((e) => {
    if (e) applySpriteBindToEntities(s, String(e.id));
  });
  const parkedSprite: any = (s as any).parked || {};
  Object.keys(parkedSprite).forEach((k) => {
    (Array.isArray(parkedSprite[k]) ? parkedSprite[k] : []).forEach((pe: any) => {
      if (pe) applySpriteBindToEntities(s, String(pe.id));
    });
  });
}

/** ★ game.md 角色位置问题：没有位置信息的角色，默认生成到 (0,0) 附近可活动区域（不落障碍） */
const ROLE_SPAWN_R_M = 2.5;
function spawnRoleEntity(s: FieldSurvivalState, role: any): Entity | null {
  if (!role) return null;
  const exist = s.entities.find((x) => x.id === String(role.id) || x.name === String(role.name));
  if (exist) return exist;
  const sel: any = (s as any).selections || {};
  const inSel = (arr: any): boolean =>
    Array.isArray(arr) && arr.some((x) => String(x) === String(role.id) || String(x) === String(role.name));
  // ★ AI 故事角色区分：roleType 决定阵营（player→player, npc/system/general→ally）
  const roleType = str((role as any)?.roleType);
  let side: string;
  if (roleType === "player") side = "player";
  else if (inSel(sel.enemies)) side = "enemy";
  else if (inSel(sel.participants)) side = "ally";
  else if (roleType === "npc" || roleType === "system" || roleType === "general") side = "ally";
  else side = "spectator";
  // ★ 默认落点：第一张图可活动区域按索引均分分散（不再围着玩家出生点扎堆）
  const allyCount0 = s.entities.filter((x) => x.side === "ally").length;
  const dp = defaultSpawnPoint(s, allyCount0, Math.max(6, allyCount0 + 1));
  let target: { x: number; y: number } = { x: dp.x, y: dp.y };
  // 优先 enemyNav 避障；搜不到时加大半径重试（maxRing=8 对 50 米外随机落点太容易漏）
  if (enemyNav) {
    const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8)
      || navNearestFree(enemyNav, target.x, target.y, 0.4, 20);
    if (free) target = free;
  }
  const e = makeEntity(role, side as any, target.x, target.y, s.entities.length);
  e.homeX = e.x;
  e.homeY = e.y;
  (e as any).mapName = s.levelName || "";
  (e as any).roleType = roleType;
  // ★ 中立/通用角色保持非攻击状态（不会主动追玩家）
  if (side === "enemy") {
    (e as any).aiState = "idle";
    (e as any).regionId = (nearestWildRegion(e.x, e.y) || ({} as any)).id;
  } else {
    (e as any).aiState = "idle";
  }
  s.entities.push(e);
  return e;
}

/** ★ game.md 角色位置：角色驻留地图 —— 他在哪个地图就在哪个地图，不因玩家切图而改变。
 *  只有组队中的角色跟随玩家跨图（落点 = 玩家身边）；脱离队伍就地留下。
 *  非组队角色从当前实体表摘除、停进 s.parked[地图名]，玩家回到该图时原坐标归队。 */
const START_MAP_NAME = "Mulberry Town";
/** 角色唯一键：id 优先，退化到 name */
function roleKeyOf(e: any): string {
  return String((e && (e.id || e.name)) || "");
}
/** 从所有地图的 parked 中摘除指定角色，返回首个命中实体（全图去重） */
function unparkRole(s: any, rid: any): any {
  if (!s || !s.parked || typeof s.parked !== "object") return null;
  const key = String(rid || "");
  if (!key) return null;
  let hit: any = null;
  Object.keys(s.parked).forEach((k) => {
    const arr = Array.isArray(s.parked[k]) ? s.parked[k] : [];
    s.parked[k] = arr.filter((x) => {
      const same = String(x && ((x as any).id || (x as any).name)) === key;
      if (same && !hit) hit = x;
      return !same;
    });
  });
  return hit;
}
/** 把角色停进指定地图的 parked：先全图去重，再做坐标有效性兜底（越界/NaN 用 home 或原点） */
function parkRole(s: any, e: any, mapName: string): void {
  if (!s || !e) return;
  const key = String(mapName || e.mapName || s.levelName || "");
  if (!key) return;
  if (!s.parked || typeof s.parked !== "object") s.parked = {};
  unparkRole(s, roleKeyOf(e));
  let x = num(e.x, NaN), y = num(e.y, NaN);
  if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1000 || Math.abs(y) > 1000) {
    x = num(e.homeX, 0);
    y = num(e.homeY, 0);
    if (!isFinite(x) || !isFinite(y)) { x = 0; y = 0; }
  }
  e.x = x;
  e.y = y;
  e.mapName = key;
  if (!Array.isArray(s.parked[key])) s.parked[key] = [];
  (s.parked[key] as any[]).push(e);
}
/** 归一化：entities 内同 id 去重；parked 与 entities 互斥、parked 跨图去重（历史脏数据收敛） */
function dedupeRoles(s: any): void {
  if (!s) return;
  const seen = new Set<string>();
  if (Array.isArray(s.entities)) {
    s.entities = s.entities.filter((e: any) => {
      if (!e) return false;
      if (String((e as any).side) === "enemy") return true; // 野怪由前端按图管理，不参与角色去重
      const k = roleKeyOf(e);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (s.parked && typeof s.parked === "object") {
    Object.keys(s.parked).forEach((k) => {
      const arr = Array.isArray(s.parked[k]) ? s.parked[k] : [];
      s.parked[k] = arr.filter((e: any) => {
        if (!e) return false;
        const key = roleKeyOf(e);
        if (!key) return false;
        if (seen.has(key)) return false; // 当前图已有 → 丢弃停车副本，避免双份
        seen.add(key);
        return true;
      });
    });
  }
}
function handleLevelChange(s: FieldSurvivalState, snapParty: boolean): void {
  if (!Array.isArray(s.entities)) return;
  const lv = s.levelName || "";
  const parkedAny = s as any;
  parkedAny.parked = parkedAny.parked && typeof parkedAny.parked === "object" ? parkedAny.parked : {};
  dedupeRoles(s); // ★ 先收敛历史脏数据（分身 / 跨图双份）
  const party = (s.partyIds || []).map((x) => String(x));
  const player = s.entities.find((e2) => e2.side === "player");
  const seen = new Set<string>();
  const stay: Entity[] = [];
  (s.entities || []).forEach((e2) => {
    if (e2.side === "player") { (e2 as any).mapName = lv; stay.push(e2); seen.add(roleKeyOf(e2)); return; }
    // ★ 护送货物（questcargo_<questId>）：必须跟随玩家跨图。
    //   否则它会走下面的「ally 分支」——没有 mapName → 默认回 start_map、又不在 partyIds
    //   → 被 parkRole 停回原图，玩家到新图后 s.entities 里找不到它 → cargoAlive=false
    //   → 任务板显示「货物：已丢失」（2026-10-17 实测：护送去 Mulberry Forest 一传送就丢）。
    if (String(e2.id).startsWith(QUEST_CARGO_PREFIX) || String((e2 as any).entity_type) === "QUEST_CARGO") {
      (e2 as any).mapName = lv;
      // ★ 吸附**不能**依赖 snapParty：sys_travel 走的是 handleLevelChange(s, false)，
      //   不吸附的话货物会带着旧图坐标留在原地，只能靠每 tick 3.2m/s 的跟随慢慢追
      //   （2026-10-18 实测：跨图传送后货物在 38m 外，要追十几秒，像「跟丢了」）。
      //   护送货物本来就该黏在玩家身上，任何切图都直接贴过去。
      if (player) {
        const ang = rnd(0, Math.PI * 2);
        const cb = clampToBound(s, player.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M, player.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M);
        e2.x = cb.x;
        e2.y = cb.y;
        e2.vx = 0;
        e2.vy = 0;
      }
      stay.push(e2);
      seen.add(roleKeyOf(e2));
      return;
    }
    if (String(e2.side) === "enemy") {
      // 本地怪（mapmob_/localmob_/zone_）由前端 localEnemies 按当前地图重建；
      // 切图时若不丢弃，会被带入下一张图（如 Town 出现 Dungeon 的怪）。
      if ((e2 as any).isLocal || isLocalEnemyId(e2.id)) return;
      stay.push(e2);
      return;
    } // 非本地野怪保留；本地怪由前端按图管理
    if (!(e2 as any).mapName) (e2 as any).mapName = (s as any).startMapName || START_MAP_NAME; // 未定位角色默认回 start_map，不随玩家跨图
    if (party.indexOf(String(e2.id)) >= 0) {
      // 组队：跟随玩家到当前图，落在玩家身边
      (e2 as any).mapName = lv;
      if (snapParty && player) {
        const ang = rnd(0, Math.PI * 2);
        const cb = clampToBound(s, player.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M, player.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M);
        e2.x = cb.x;
        e2.y = cb.y;
      }
      stay.push(e2);
      seen.add(roleKeyOf(e2));
    } else if ((e2 as any).mapName === lv) {
      stay.push(e2);
      seen.add(roleKeyOf(e2));
    } else {
      parkRole(s, e2, (e2 as any).mapName); // 角色驻留原图（含坐标校验与全图去重）
    }
  });
  const back = Array.isArray(parkedAny.parked[lv]) ? parkedAny.parked[lv] : [];
  back.forEach((e2: any) => {
    const k = roleKeyOf(e2);
    if (k && seen.has(k)) return; // 当前图已存在同 id → 丢弃停车副本
    e2.mapName = lv;
    stay.push(e2);
    seen.add(k);
  });
  parkedAny.parked[lv] = [];
  s.entities = stay;
}

/** 组队角色随击杀获得经验并升级 */
function grantPartyExp(s: FieldSurvivalState, expGain: number): void {
  const party = s.partyIds || [];
  if (!party.length || expGain <= 0) return;
  const share = Math.max(1, Math.round(expGain * 0.6));
  party.forEach((pid) => {
    const c = (s.npcCards || []).find((x) => x.id === pid);
    if (!c) return;
    c.exp = Math.round(num(c.exp, 0)) + share;
    let ups = 0;
    while (c.exp >= playerNextExp(num(c.level, 1))) {
      c.exp -= playerNextExp(num(c.level, 1));   // 扣「升级前」阈值，溢出保留
      c.level = Math.max(1, Math.round(num(c.level, 1))) + 1;
      ups += 1;
    }
    // ★ 等级系统：NPC 也按满血满蓝公式重算（无背包/技能永久加成 → 走基础公式）
    c.maxHp = STAT_BASE.hp + c.level * STAT_PER_LEVEL;
    c.maxMp = STAT_BASE.mp + c.level * STAT_PER_LEVEL;
    if (ups > 0) { c.hp = c.maxHp; c.mp = c.maxMp; }
    else {
      c.hp = clamp(num(c.hp, c.maxHp), 0, c.maxHp);
      c.mp = clamp(num(c.mp, c.maxMp), 0, c.maxMp);
    }
    c.next_level_exp = playerNextExp(c.level);
    const e = s.entities.find((x) => x.id === pid);
    if (e) {
      e.level = c.level; e.maxHp = c.maxHp; e.hp = c.hp;
      e.maxMp = c.maxMp; e.mp = c.mp;
      e.exp = c.exp; e.expToNext = playerNextExp(c.level);
    }
  });
  const lead = s.entities.find((e) => e.id === party[0]);
  if (lead) floater(s, `队伍 +${share}exp`, lead.x, lead.y - 26);
}

/** 系统数据 → t_plugin_session_data */
async function persistSys(context: PluginGameContext | undefined, s: FieldSurvivalState): Promise<void> {
  const api = context?.tsApi?.pluginData;
  if (!api?.set) return;
  try {
    await api.set(SYS_DATA_KEY, {
      ring: s.ring || { items: [], skills: [] },
      party: s.partyIds || [],
      npcCards: s.npcCards || [],
      bagMeta: s.bagMeta || {},
      bagOrder: s.bagOrder || [],
      skillOrder: s.skillOrder || [],
      shop: s.shopGoods || [],
      level: s.levelName || "",
      skillMeta: s.skillMeta || {},
      itemMeta: s.itemMeta || {},
      // ★ 2026-10-19 修复：刷新丢物品/钱
      //   旧版只存 bagMeta/bagOrder 但 itemsFromCard(card) 只读 card.items，
      //   刷新后 card.items 是默认空数组 → 商城买的东西全部消失。
      //   现在把 playerCard 的关键字段一起持久化；restoreSys 反向读回。
      card: {
        items: Array.isArray((s.playerCard || {}).items) ? (s.playerCard as any).items : [],
        money: Math.round(num((s.playerCard as any)?.money, 0)),
        level: Math.round(num((s.playerCard as any)?.level, 1)) || 1,
        exp: Math.round(num((s.playerCard as any)?.exp, 0)),
        hp: Math.round(num((s.playerCard as any)?.hp, 0)),
        mp: Math.round(num((s.playerCard as any)?.mp, 0)),
        skills: Array.isArray((s.playerCard as any)?.skills) ? (s.playerCard as any).skills : [],
      },
      // ★ 任务板：任务定义 + 玩家进度（掉线重连按 id 续上）
      questBoard: s.questBoard || [],
      quests: s.quests || {},
      // ★ 角色驻留地图：ally/spectator 角色停在别的地图（s.parked）→ 持久化到 t_plugin_session_data
      parked: (s as any).parked || {},
      // ★ 实体形象：生成图库 + 角色绑定（刷新后形象不丢）
      spriteGallery: Array.isArray(s.spriteGallery) ? s.spriteGallery : [],
      spriteBinds: (s as any).spriteBinds || {},
    });
    // ★ game.md 对话功能：AI 故事角色位置/地图信息单独持久化（dataKey=ai_story_roles → t_plugin_session_data），
    //   后续开新局时 AI 聊天窗口能直接读到「陈彦现在在 mulberry_forest 地图 (12.3, -5.6)」，不用再遍历 entities。
    const aiRoles = collectAiStoryRoles(s);
    await api.set(AI_STORY_ROLES_KEY, {
      roles: aiRoles,
      level: s.levelName || "",
      updatedAt: Date.now(),
    });
  } catch { /* 落库失败不阻断玩法 */ }
}

/** ★ game.md 对话功能：收集所有 AI 故事角色的位置/地图信息（写入 t_plugin_session_data）
 *  包括 s.entities 中可见的 + s.parked 中驻留在别的地图的 */
function collectAiStoryRoles(s: FieldSurvivalState): Array<{
  id: string; name: string; roleType: string; side: string;
  x: number; y: number; mapName: string; alive: boolean; updatedAt: number;
}> {
  const arr: Array<{
    id: string; name: string; roleType: string; side: string;
    x: number; y: number; mapName: string; alive: boolean; updatedAt: number;
  }> = [];
  const ents = Array.isArray(s.entities) ? s.entities : [];
  for (const e of ents) {
    if (!e) continue;
    const rt = String((e as any).roleType || "");
    // 玩家自己 / 地图内置 NPC (TOWN_NPCS, side=neutral) / 怪物 都不进 AI 故事角色列表
    if (e.side === "player") continue;
    if (e.side === "enemy") continue;
    if (e.side === "neutral") continue;
    if (!rt) continue;
    arr.push({
      id: String(e.id || e.name || ""),
      name: String(e.name || e.id || ""),
      roleType: rt,
      side: String(e.side || ""),
      x: Math.round(num(e.x, 0) * 100) / 100,
      y: Math.round(num(e.y, 0) * 100) / 100,
      mapName: String((e as any).mapName || s.levelName || ""),
      alive: (e as any).alive !== false,
      updatedAt: Date.now(),
    });
  }
  // ★ 角色驻留地图：parked 中的角色也要加入 AI 故事角色列表（即使停在别的地图）
  const parkedObj: any = (s as any).parked || {};
  const roleMap = new Map((Array.isArray(s.roles) ? s.roles : []).map((r: any) => [String(r.id), r]));
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((pe: any) => {
      if (!pe || !pe.id) return;
      const role = roleMap.get(String(pe.id)) || roleMap.get(String(pe.name));
      const rt2 = role ? String(role.roleType || "") : "";
      if (!rt2) return;
      // parked 实体没有 side，用 _baseSide 兜底
      const side2 = String(pe._baseSide || pe.side || "ally");
      arr.push({
        id: String(pe.id),
        name: String(pe.name || pe.id),
        roleType: rt2,
        side: side2,
        x: Math.round(num(pe.x, 0) * 100) / 100,
        y: Math.round(num(pe.y, 0) * 100) / 100,
        mapName: String(pe.mapName || k || ""),
        alive: pe.alive !== false,
        updatedAt: Date.now(),
      });
    });
  });
  return arr;
}

/** t_plugin_session_data → 系统数据 */
async function restoreSys(context: PluginGameContext | undefined, s: FieldSurvivalState): Promise<void> {
  const api = context?.tsApi?.pluginData;
  if (!api?.get) return;
  try {
    const d: any = await api.get(SYS_DATA_KEY);
    if (!d || typeof d !== "object") return;
    if (d.skillMeta && typeof d.skillMeta === "object") s.skillMeta = d.skillMeta;
    if (d.itemMeta && typeof d.itemMeta === "object") s.itemMeta = d.itemMeta;
    if (d.ring && typeof d.ring === "object") {
      s.ring = {
        items: Array.isArray(d.ring.items) ? d.ring.items : [],
        skills: Array.isArray(d.ring.skills) ? d.ring.skills.map(String) : [],
      };
    }
    // ★ game.md 组队跟随：队伍只在本次会话内由角色卡面板勾选决定，
    //   不再恢复旧存档（旧版本曾把全部友方角色自动编入队伍，恢复会继承错误的自动跟随）
    if (Array.isArray(d.party)) s.partyIds = [];
    if (Array.isArray(d.npcCards)) s.npcCards = d.npcCards;
    if (d.bagMeta && typeof d.bagMeta === "object") s.bagMeta = d.bagMeta;
    if (Array.isArray(d.bagOrder)) s.bagOrder = d.bagOrder.map(String);
    // ★ 2026-10-19 修复：刷新丢物品/钱
    //   把持久化的 playerCard 关键字段灌回 s.playerCard（与 persistSys 对齐）
    //   必须在 buildItems/buildSkills 之前调用 → s.items / s.skills 才能拿到对的数量
    if (d.card && typeof d.card === "object") {
      const cur = (s.playerCard || {}) as Record<string, any>;
      const next = { ...cur };
      if (Array.isArray(d.card.items)) next.items = d.card.items.map((x: any) => x);
      if (typeof d.card.money === "number") next.money = d.card.money;
      if (typeof d.card.level === "number") next.level = d.card.level;
      if (typeof d.card.exp === "number") next.exp = d.card.exp;
      if (typeof d.card.hp === "number") next.hp = d.card.hp;
      if (typeof d.card.mp === "number") next.mp = d.card.mp;
      if (Array.isArray(d.card.skills)) next.skills = d.card.skills.map((x: any) => x);
      s.playerCard = next;
    }
    // ★ 技能排序：恢复 skillOrder（随后在 syncCardFromContext 里套回参数卡 skills 顺序）
    if (Array.isArray(d.skillOrder)) s.skillOrder = d.skillOrder.map(String).filter(Boolean);
    if (Array.isArray(d.shop) && d.shop.length) s.shopGoods = d.shop;
    if (str(d.level)) s.levelName = str(d.level, "");
    // ★ 角色驻留地图：恢复 s.parked（ally/spectator 角色停在别的地图的位置）
    if (d.parked && typeof d.parked === "object") (s as any).parked = d.parked;
    // ★ 实体形象：恢复图库与绑定（过滤掉结构不合法的条目，防止旧存档脏数据打崩渲染）
    if (Array.isArray(d.spriteGallery)) {
      s.spriteGallery = d.spriteGallery
        .filter((g: any) => g && typeof g.image === "string" && g.image)
        .map((g: any) => ({
          id: str(g.id, `sp_${Math.random().toString(36).slice(2, 8)}`),
          image: String(g.image),
          prompt: str(g.prompt, ""),
          refCount: Math.round(num(g.refCount, 0)),
          source: str(g.source, "ai") === "upload" ? "upload" : "ai",
          createdAt: Math.round(num(g.createdAt, Date.now())),
        }));
    }
    if (d.spriteBinds && typeof d.spriteBinds === "object") {
      const binds: Record<string, any> = {};
      for (const [k, v] of Object.entries(d.spriteBinds as Record<string, any>)) {
        if (!k) continue;
        // ★ 兼容老存档 {id: imageStr} 与新格式 {id: {image, prompt, source, createdAt}}
        if (typeof v === "string" && v) {
          binds[String(k)] = { image: v, source: /^data:/i.test(v) ? "upload" : "preset" };
        } else if (v && typeof v === "object") {
          const img = str((v as any).image, "");
          if (!img) continue;
          binds[String(k)] = {
            image: img,
            prompt: str((v as any).prompt, ""),
            source: str((v as any).source, "preset") as any,
            createdAt: Math.round(num((v as any).createdAt, Date.now())),
          };
        }
      }
      (s as any).spriteBinds = binds;
    }
    // ★ 任务板：恢复任务定义与玩家进度（按 id 续上，不清零）
    if (Array.isArray(d.questBoard)) {
      s.questBoard = d.questBoard.map((x: any, i: number) => normalizeQuestDef(x, i)).filter(Boolean) as QuestDef[];
    }
    if (d.quests && typeof d.quests === "object") {
      const q: Record<string, QuestProgress> = {};
      for (const [k, v] of Object.entries(d.quests as Record<string, any>)) {
        if (!v || typeof v !== "object") continue;
        const st2 = str((v as any).status, "active");
        q[String(k)] = {
          id: String(k),
          status: (["active", "done", "turned", "failed"].includes(st2) ? st2 : "active") as QuestProgress["status"],
          kill: (v as any).kill && typeof (v as any).kill === "object" ? (v as any).kill : {},
          gather: (v as any).gather && typeof (v as any).gather === "object" ? (v as any).gather : {},
          talked: (v as any).talked && typeof (v as any).talked === "object" ? (v as any).talked : {},
          arrived: (v as any).arrived === true,
          cargoId: str((v as any).cargoId, ""),
          acceptedTick: Math.round(num((v as any).acceptedTick, 0)),
          acceptedMap: str((v as any).acceptedMap, ""),
          turnedTick: Math.round(num((v as any).turnedTick, 0)),
          failReason: (["timeout", "cargo"].includes(str((v as any).failReason)) ? str((v as any).failReason) : undefined) as QuestProgress["failReason"],
        };
      }
      s.quests = q;
    }
    // ★ 任务进度容器兜底：库里没存过 quests 时保持 {}（否则首次 sys_quest_accept
    //   写 s.quests[id] 会因 undefined 抛错，被宿主当作 entry.js 执行失败）。
    if (!s.quests || typeof s.quests !== "object") s.quests = {};
    // ★ 角色位置权威（ai_story_roles）：上次会话每个角色停在哪张图、哪个坐标。
    //   开局必须按这份数据就位——否则角色会被强行拉回 start_map，上一局的驻留全丢。
    try {
      const rd = await api.get(AI_STORY_ROLES_KEY);
      if (rd && Array.isArray((rd as any).roles)) {
        const m: Record<string, { x: number; y: number; mapName: string; name: string }> = {};
        for (const r of (rd as any).roles) {
          const k = String((r as any)?.id || (r as any)?.name || "");
          const nm = String((r as any)?.name || "");
          if (!k && !nm) continue;
          const rec = {
            x: num((r as any).x, 0),
            y: num((r as any).y, 0),
            mapName: str((r as any).mapName, ""),
            name: nm || k,
          };
          // 同一角色多条记录（库里可能存在重复 id）→ 后写覆盖前写，取最新位置
          if (k) m[k] = rec;
          if (nm) m["name:" + nm] = rec;
        }
        (s as any)._savedRolePos = m;
        if (!s.levelName && str((rd as any).level)) s.levelName = str((rd as any).level, "");
      }
    } catch { /* 读取失败走默认 spawn */ }
  } catch { /* 读取失败走默认 */ }
}

/** 从库里（ai_story_roles）取该角色上次保存的位置/地图；库里没有则返回 null（走默认 spawn） */
function savedRolePos(s: FieldSurvivalState, r: any): { x: number; y: number; mapName: string; name: string } | null {
  const m = (s as any)?._savedRolePos;
  if (!m || typeof m !== "object" || !r) return null;
  return m[String(r.id || "")] || m["name:" + String(r.name || "")] || null;
}

/** 商城：商城 agent（故事动态数据 + 常驻世界书）→ 商品；失败/为空则用插件自带物资 */
async function refreshShop(context: PluginGameContext | undefined, s: FieldSurvivalState, forceAgent = false): Promise<string[]> {
  const notes: string[] = [];
  const builtin = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
  let story: ShopGood[] = [];
  const run = context?.tsApi?.agent?.run;
  if (run) {
    try {
      console.log("[商城] 调用 field-survival-shop-gener agent, context.tsApi.agent.run 存在:", typeof run);
      const r: any = await withTimeout(
        run("field-survival-shop-gener", {
          storyDigest: buildStoryDigest(context),
          worldBookDigest: str((context as any)?.worldBookDigest, ""),
          playerCard: s.playerCard || {},
          systemPrompt: PROMPT_FIELD_SURVIVAL_SHOP_GENER,
        }),
        20000,
        "shop agent timeout",
      );
      console.log("[商城] agent 返回原始数据:", JSON.stringify(r).slice(0, 300));
      const goods = r?.output?.goods;
      if (Array.isArray(goods) && goods.length > 0) {
        story = goods.slice(0, 14).map((g: any, i: number): ShopGood => {
          // ★ fix：g.name 可能是对象 {cn/zh/name/label/title}，必须走 str() 兜底
          const rawName = str(g?.name, `物资${i + 1}`).slice(0, 20);
          const kind = KIND_LIST.indexOf(String(g?.kind)) >= 0 ? String(g.kind) : guessKind(rawName);
          return {
            id: `s_${i}_${rawName}`,
            name: rawName,
            price: Math.max(1, Math.round(num(g?.price, 50))),
            kind,
            rarity: normRarity(g?.rarity),
            heal: Math.max(0, Math.round(num(g?.heal, defaultHeal(rawName, kind)))),
            desc: str(g?.desc, "").slice(0, 60),
            from: "story",
          };
        });
        console.log("[商城] agent 故事物资生成成功，共", story.length, "件:", story.map((x) => x.name).join(", "));
      } else {
        const errMsg = r?.error ? String(r.error).slice(0, 60) : (goods ? "agent 返回空数组" : "agent 未返回 goods 字段");
        console.log("[商城] agent 返回异常:", errMsg);
        notes.push(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
      console.error("[商城] agent 调用异常:", msg);
      notes.push(msg);
    }
  } else {
    console.warn("[商城] context.tsApi.agent.run 不存在，商城 agent 不可用，降级为内置物资");
  }
  s.shopGoods = [...story, ...builtin];
  s.shopSource = story.length ? "agent" : "builtin";
  if (notes.length) pushEvent(s, `商城生成降级：${notes[0]}`);
  return notes;
}

/**
 * ★ 把前端传上来的商品对象归一成 ShopGood（地图集自带货单的购买通道）。
 *   货单在故事包里、由事件脚本下发，插件侧没有权威副本可查，
 *   所以 sys_shop_buy 允许直接带 good 上来；这里只做字段校验与钳制，
 *   价格必须是正整数（防止 undefined → 白拿）。
 */
function normalizeShopGoodParam(v: any): ShopGood | null {
  if (!v || typeof v !== "object") return null;
  const name = str(v.name).trim().slice(0, 40);
  const price = Math.round(num(v.price, 0));
  if (!name || !(price > 0)) return null;
  const kind = KIND_LIST.indexOf(str(v.kind)) >= 0 ? str(v.kind) : guessKind(name);
  return {
    id: str(v.id) || `story_${name}`,
    name,
    price,
    kind,
    rarity: normRarity(v.rarity),
    heal: Math.max(0, Math.round(num(v.heal, defaultHeal(name, kind)))),
    desc: str(v.desc).slice(0, 120),
    from: str(v.from) || "story",
    cat: str(v.cat) || undefined,
  };
}

// ---------------------------------------------------------------------------
// handle_action
// ---------------------------------------------------------------------------

/** ★ fix④（缺口②）：候选角色是否就是玩家本人（宿主 roles 里混入了用户角色，按 id / name 双判） */
function isPlayerRole(cand: any, playerRole: any): boolean {
  const cid = str(cand?.id);
  const cname = str(cand?.name);
  const pid = str(playerRole?.id);
  const pname = str(playerRole?.name);
  if (pid && cid && cid === pid) return true;
  if (pname && cname && cname === pname) return true;
  return false;
}

/** ★ 兼容旧存档：旧版 buildItems / buildSkills 会把空格子写成「物品4 / 备用物1」，
 *  并把重复出现的技能改名成「暗核共鸣2 / 暗核共鸣3」占格。
 *  老存档不重建的话，用户刷新页面看到的还是那批假格子（要等下一局 start 才清）。
 *  这里按「假名字特征」一次性识别并从参数卡重建。 */
function normalizeQuickbarLegacy(s: FieldSurvivalState): void {
  const items = Array.isArray(s.items) ? s.items : [];
  const skills = Array.isArray(s.skills) ? s.skills : [];
  const card = (s.playerCard || {}) as Record<string, unknown>;
  const badItem = items.some((it) => /^(物品\d+|备用物\d+)$/.test(String(it?.name || "")));
  const names = new Set(skills.map((k) => String(k?.name || "")));
  const badSkill = skills.some((k) => {
    const n = String(k?.name || "");
    if (/^(技能\d+|备用技\d+)$/.test(n)) return true;
    // 去重残留：X2 / X3，且同一列表里还存在 X
    const m = n.match(/^(.+?)(\d+)$/);
    return !!m && names.has(m[1]);
  });
  if (!badItem && !badSkill) return;
  if (badItem && Array.isArray(card.items)) s.items = buildItems(card);
  if (badSkill && Array.isArray(card.skills)) s.skills = buildSkills(card, QUICKBAR_PAGE_SIZE, s.skillMeta);
  clampQuickbarPages(s);
}

/** ★ 最近一次 handle_action 的 context 引用（damage() 等无 ctx 的深层函数 fire-and-forget 用） */
let lastPluginContext: PluginGameContext | undefined;
function ctxRef(): PluginGameContext | undefined { return lastPluginContext; }

export async function handle_action(
  action: string,
  params: Record<string, any>,
  state: Record<string, any>,
  context: PluginGameContext,
): Promise<{ code: number; message: string; state: FieldSurvivalState; response?: string; actions?: string[] }> {
  lastPluginContext = context;
  const s: FieldSurvivalState =
    state && Object.keys(state).length > 0 && ((state as any).version === 2 || (state as any).version === 3 || (state as any).version === 4)
      ? (state as unknown as FieldSurvivalState)
      : emptyState(context);

  /* ★ 2026-10-21 崩溃修复：旧版本存档 version 对得上但缺数组字段时，
   *   会把残缺 state 当完整 state 复用 → 前端 state.entities 为 undefined
   *   → state.value?.entities.find() 直接 NPE（安卓端 ui/game.html 崩）。
   *   这里统一补齐所有数组字段（缺才补，不动已有数据）。 */
  if (!Array.isArray((s as any).entities)) (s as any).entities = [];
  if (!Array.isArray((s as any).roles)) (s as any).roles = [];
  if (!Array.isArray((s as any).items)) (s as any).items = [];
  if (!Array.isArray((s as any).skills)) (s as any).skills = [];
  if (!Array.isArray((s as any).spriteGallery)) (s as any).spriteGallery = [];

  const okResp = (msg: string) => ({ code: 0, message: "ok", state: s, response: msg });

  // ★ 旧存档里的「备用物N / 暗核共鸣2」等假格子：进任何 action 时顺手重建一次
  normalizeQuickbarLegacy(s);

  switch (action) {
    case "init":
    case "start_init": {
      // ★ 强制重置为初始选人状态，不依赖旧 state
      // 无论之前是 playing/over，第二次进入都必须回到 select 阶段
      const fresh = emptyState(context);
      // ★ v6：故事绑定视觉地图模板尽早注入（init 早于选人面板，前端 onMounted 即可读到）
      console.log("[map-diag] start_init");
      await ensureStoryVisualMap(context);
      // ★ 把宿主注入的当前世界身份写进 state 顶层（前端 storyMap / 角色面板 / 事件等
      //   都能从 state.value?.worldName 直接拿到，避开 ?story= URL 方案与 tsApi.ctx 的可用性问题）。
      const _wn = str((context as any)?.worldName, "");
      const _wid = (context as any)?.worldId;
      if (_wn) (fresh as any).worldName = _wn;
      if (_wid != null && _wid !== "") (fresh as any).worldId = _wid;
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "请选择友方 / 观战 / 敌对角色后开始" };
    }

    case "start": {
      const sel = (params?.selections || params || {}) as Record<string, any>;
      const participants: string[] = Array.isArray(sel.participants) ? sel.participants.map(String) : [];
      const spectators: string[] = Array.isArray(sel.spectators) ? sel.spectators.map(String) : [];
      const enemies: string[] = Array.isArray(sel.enemies) ? sel.enemies.map(String) : [];
      const roles = Array.isArray(context?.roles) ? context.roles : [];
      const byId = (id: string) => roles.find((r) => String((r as any).id) === id || String((r as any).name) === id);
      const playerRole = roles.find((r) => String((r as any).roleType) === "player") || roles[0];

      s.selections = { participants, spectators, enemies };
      // ★ 必须在生成实体「之前」恢复库数据：要拿到上局的 level 与每个角色的位置/地图，
      //   否则 ally 会先按 start_map 默认落点生成，库里的驻留位置被覆盖（上一局白玩）。
      await restoreSys(context, s);
      (s as any)._sysRestored = true;
      if (!(s as any).parked || typeof (s as any).parked !== "object") (s as any).parked = {};
      // ★ 任务板：库里没恢复出任务定义时，读 CLI 上传的 quest_defs（故事包自带任务表）
      await ensureQuestDefs(context, s);
      buildQuestView(s);
      // ★ 本局关卡：库里上局 level 优先（按库恢复），其次前端上报，最后兜底 start_map
      const curLv = str(str((params as any)?.levelName) || s.levelName || "", "") || "Mulberry Town";
      s.levelName = curLv;
      s.entities = [];
      // ★ fix⑦：新开局清空实体后必须同时清 localMobsEpoch——restoreSys 会把上局的
      //   epoch 一并恢复，若不清，前端继续发同一 epoch 会被 applyLocalEnemies 当作
      //   "已接管"忽略 → 敌怪表死锁为空（配合 fix⑦ 的丢失重建兜底，双保险）。
      s.localMobsEpoch = 0;
      // ★ fix: 玩家/ally/spectator 统一归属 start_map（不依赖 map?.theme）
      // ★ 玩家出生点：优先读 ctx.tiledSpawn（dev-host 端从 Tiled JSON 的 entity_type=PLAYER|SPAWN_POINT
      //   对象解析出来的 { x, y }，编辑地图时挪动 SPAWN_POINT 即可改玩家出现位置），
      //   没有则用 PLAYER_SPAWN 默认值
      const tiledSpawn = (context && (context as any).tiledSpawn) || null;
      const px = tiledSpawn && Number.isFinite(tiledSpawn.x) ? tiledSpawn.x : PLAYER_SPAWN.x;
      const py = tiledSpawn && Number.isFinite(tiledSpawn.y) ? tiledSpawn.y : PLAYER_SPAWN.y;
      const startMapName = (tiledSpawn && tiledSpawn.mapName) || "Mulberry Town";
      const playerEnt = makeEntity(playerRole as any, "player", px, py, 0);
      (playerEnt as any).mapName = curLv;
      s.entities.push(playerEnt);
      // ★ game.md 等级系统：等级/经验取参数卡，四维按公式重算（HP/MP 取卡面值并夹进满值上限）
      initPlayerFromCard(s, playerRole as any);
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        // ★ fix④（缺口②）：参展列表里若混入玩家本人（宿主 roles 含用户角色、前端默认 push 玩家 id），
        //   不再生成一份同名友方 —— 否则开局即出现"另一个我"跟着自己跑
        if (isPlayerRole(r, playerRole)) return;
        // ★ 默认落点：第一张图可活动区域按索引均分分散（不再围着玩家出生点扎堆）
        const dp = defaultSpawnPoint(s, i, participants.length);
        const allyEntity = makeEntity(r, "ally", dp.x, dp.y, i);
        // ★ 按库恢复位置：库里记着该角色上局停在哪张图、哪个坐标 → 直接就位。
        //   库里没有记录的新角色才走默认落点。
        const savedPos = savedRolePos(s, r);
        if (savedPos) {
          allyEntity.x = savedPos.x;
          allyEntity.y = savedPos.y;
          (allyEntity as any).mapName = savedPos.mapName || startMapName;
        } else {
          (allyEntity as any).mapName = startMapName; // fix: ally belongs to start_map, NOT follow player across maps
          // ★ start 时 enemyNav 必然为 null（网格来自前端上报）→ 先落点打标，
          //   拿到 walkGrid 后由 fixSpawnWithNav 推到最近可走格，保证不在墙里 / 障碍物里
          if (enemyNav) {
            const free = navNearestFree(enemyNav, dp.x, dp.y, 0.4, 8);
            if (free) { allyEntity.x = free.x; allyEntity.y = free.y; }
          } else {
            (allyEntity as any)._needNavFix = true;
          }
        }
        // ★ 角色停在别的地图 → 进 parked，玩家切到那张图才看得见他们（在原地）
        if ((allyEntity as any).mapName !== curLv) {
          const pk = String((allyEntity as any).mapName);
          ((s as any).parked[pk] = (s as any).parked[pk] || []).push(allyEntity);
        } else {
          s.entities.push(allyEntity);
        }
      });
      // ★ v4：敌对角色落在「最近的野区」内
      //   （玩家出生于城镇安全区，若沿用"围绕玩家 30~60 米"的落点会落进城镇内部）
      const startRegion = nearestWildRegion(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      enemies.forEach((id, i) => {
        const r = byId(id);
        // ★ fix④（缺口②）：玩家本人不会被复制成"敌对角色"（同 id / 同名的 1:1 排除）
        if (r && isPlayerRole(r, playerRole)) return;
        const at = regionSpawnPoint(s, startRegion);
        const e = r
          ? makeEntity(r, "enemy", at.x, at.y, i)
          : makeEntity({ id, name: id }, "enemy", at.x, at.y, i);
        (e as any).regionId = startRegion.id;
        (e as any).homeX = at.x;
        (e as any).homeY = at.y;
        (e as any).aiState = "idle";
        s.entities.push(e);
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (!r) return;
        const se: any = { ...makeEntity(r, "spectator", -40, -40 + s.entities.length * 4, 0), alive: true, mapName: startMapName };
        const sp = savedRolePos(s, r);
        if (sp) { se.x = sp.x; se.y = sp.y; se.mapName = sp.mapName || startMapName; }
        if (se.mapName !== curLv) {
          (s as any).parked[String(se.mapName)] = (s as any).parked[String(se.mapName)] || [];
          (s as any).parked[String(se.mapName)].push(se);
        } else {
          s.entities.push(se);
        }
      });
      // ★ 不再自动 spawn 无明确阵营的 AI 故事角色（避免地图上冒出莫名 NPC）；
      //   玩家自己 / participants / spectators / enemies 已在上方生成；
      //   角色卡面板仍会展示所有 AI 故事角色（仅位置为空 → 不会出实体）。
      // ★ map-gener agent：用故事动态数据生成地图（存 t_plugin_session_data.map_data）
      // ★ v6：先注入当前故事的视觉地图模板（本会话已有 map_visual 则跳过），再取玩法元数据
      await ensureStoryVisualMap(context, s);
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";

      // ★ v4：区域划分（城镇安全区 + 6 野区）写入 map.zones —— 主地图与小地图据此显示区域名称
      //   城镇区名跟随当前关卡名（不再一律写死「晨曦镇」→ 换图后串名）。
      //   中文显示名由前端 getLevelDisplayName 二次修正（能读 Tiled JSON 里的中文名）。
      if (s.map) {
        s.map.zones = buildZonesForMap("", curLv);
      }
      // ★ v4：建立城镇（安全区：建筑 + 中立角色）与区域运行时状态
      ensureTown(s);
      initRegions(s);
      // ★ v4：初始铺怪 —— 每个野区各刷满自己的配额（城镇配额 0，安全区内无野怪）
      WORLD_REGIONS.forEach((r) => { if (!r.safe && r.mobs > 0) spawnRegionMobs(s, r, r.mobs); });
      // ★ v4：宝箱 / 血瓶仍按地图数据铺设一次（区域刷新只补野怪，不重置宝箱）
      if (!s.chests.length) {
        (s.map?.chests || []).forEach((c, i) => {
          s.chests.push({
            ...(c as any),
            id: `chest_map_${i}`,
            x: clampX(num((c as any).x, 0)),
            y: clampY(num((c as any).y, 0)),
            opened: false,
          });
        });
      }
      if (!s.potions.length) {
        (s.map?.potions || []).forEach((p, i) => {
          s.potions.push({
            id: `potion_map_${i}`,
            x: clampX(num((p as any).x, 0)),
            y: clampY(num((p as any).y, 0)),
            heal: num((p as any).heal, 40),
          });
        });
      }
      // 兜底：地图数据没给宝箱 / 血瓶时，按野区（非城镇）各铺 3 个
      if (!s.chests.length) {
        ["wood", "ruin", "wild"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid) as RegionDef;
          const at = regionSpawnPoint(s, r);
          s.chests.push({ id: `chest_${rid}_${i}`, x: at.x, y: at.y, opened: false, loot: { exp: 12 + i * 5, money: 10 + i * 4, item: "干粮" } });
        });
      }
      if (!s.potions.length) {
        ["shore", "mine", "marsh"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid) as RegionDef;
          const at = regionSpawnPoint(s, r);
          s.potions.push({ id: `potion_${rid}_${i}`, x: at.x, y: at.y, heal: 24 + i * 6 });
        });
      }
      // ★ v5：恢复系统面板持久化数据（纳戒 / 队伍 / 角色卡 / 背包顺序 / 商城）
      // ★ 已在实体生成前恢复过一次（要拿角色位置）；这里不再重复，
      //   否则库里的旧 parked 会覆盖刚按 ai_story_roles 归位好的驻留数据。
      if (!(s as any)._sysRestored) await restoreSys(context, s);
      // ★ 修复：restoreSys 恢复 skillMeta 后必须重跑 buildSkills（否则 syncCardFromContext
      //   可能因 card 未变而 return，skills 仍是空 effects_type）
      s.skills = buildSkills(s.playerCard || {}, QUICKBAR_PAGE_SIZE, s.skillMeta);
      s.items = buildItems(s.playerCard || {});   // ★ 开局重建物品栏（顺带清掉旧存档里的「备用物N」假格子）
      clampQuickbarPages(s);
      syncCardFromContext(s, context); // ★ start 也同步参数卡
      if (str((params as any)?.levelName)) s.levelName = str((params as any).levelName, s.levelName || "");
      // ★ fix：开局 levelName 与前端对齐（前端 DEFAULT_START_LEVEL = "Mulberry Town"）。
      //   不再用 map.theme（如"野外·清晨"）兜底——theme 与前端关卡名分属两套命名，
      //   混用会让 ally.mapName 对齐到 theme，第一个 tick 上报 "Mulberry Town" 时
      //   handleLevelChange 把 ally park 进 theme 名下的错误地图（ally 凭空消失）。
      if (!s.levelName) s.levelName = startMapName;
      // ★ 库里 sys_state.parked 与 ai_story_roles 可能同时记录了同一角色，
      //   归位后先去重再落库，否则开局即出现分身（原本要等到第一次切图才收敛）。
      dedupeRoles(s);
      // ★ game.md 对话功能：AI 故事角色 spawn 完毕 → 立即把位置/地图信息写入 t_plugin_session_data
      await persistSys(context, s);
      // fix: _levelAt 必须初始化为当前 levelName，防止残留旧值导致 tick 误触发 handleLevelChange
      (s as any)._levelAt = s.levelName || startMapName;
      // ★ 按数据库权威：库里记录的上局地图与前端开局地图（DEFAULT_START_LEVEL）不一致时，
      //   通过 teleportTarget 通道让前端跟着切过去（前端 watch 它 → switchLevel）。
      //   否则前端停在 start_map、宿主 levelName 是上局的图 → 第一个 tick 上报的
      //   levelName 与 ally.mapName 不符 → 全员被 park 出当前图（开局看不到 ally）。
      if (s.levelName && s.levelName !== startMapName) {
        const me0 = s.entities.find((e2: any) => e2.side === "player");
        s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
        (s as any).teleportTarget = {
          mapName: s.levelName,
          x: me0 ? (me0 as any).x : 0,
          y: me0 ? (me0 as any).y : 0,
          name: s.levelName,
          rev: s.sysRevision,
        };
      }
      // fix: entity mapName 对齐到最终 levelName（ally/spectator 用 startMapName 初始化，
      //   但 levelName 可能是 "MulberryTown" 或其他值，handleLevelChange 依赖精确匹配）
      const finalStartMap = s.levelName || startMapName;
      (s.entities || []).forEach((e: any) => {
        if (e.side === "enemy") return;
        if (!e.mapName || e.mapName === startMapName) e.mapName = finalStartMap;
      });
      // ★ game.md 组队跟随：开局默认【不】组队——只有角色卡面板勾选「组队跟随」的角色
      //   才会跟随用户帮打怪（未组队角色原地待命，绝不自动跟随）
      if (!Array.isArray(s.partyIds)) s.partyIds = [];
      ensureNpcCards(s, s.levelName || "");
      // ★ game.md 商城：开局即建货源（商城 agent 故事物资 + 插件自带物资），不等第一次 tick
      if (!s.shopGoods || !s.shopGoods.length) await refreshShop(context, s);
      s.writeback = null;
      s.phase = "playing";
      s.tick = 0;
      const theme = str(s.map?.theme, "野外");
      const narration = str(s.map?.narration, "");
      s.events = [
        narration || `进入「${theme}」：操作你的角色，击杀敌人、开启宝箱、拾取血瓶。`,
      ];
      return okResp(`进入「${theme}」`);
    }

    case "tick": {
      if (s.phase !== "playing") return okResp("");
      // ★ P1 打击感：震屏/顿帧衰减（每 tick -1 帧）
      if (s.screenShake !== undefined && s.screenShake > 0) {
        s.screenShake -= 1;
        if (s.screenShake === 0) s.screenShakeIntensity = 0;
      }
      if (s.hitStopFrames !== undefined && s.hitStopFrames > 0) s.hitStopFrames -= 1;
      s.writeback = null;          // ★ v5：上一帧回写已由宿主消费，清空避免重复写
      // ★ teleportTarget 一次性：下发一拍后立刻清除，否则每次 tick 响应都会
      //   重新触发前端传送 watch，把玩家反复拉回目标点（表现 = 被绑住）
      if ((s as any).teleportTarget) (s as any).teleportTarget = null;
      s.tick += 1;
      // ★ fix⑤（缺口①）：前端上报 localEnemies（{epoch,bounds,list}）时，先据此重建当前关卡敌怪表
      const localBuilt = applyLocalEnemies(s, (params as any)?.localEnemies);
      // ★ 敌人碰撞：前端只在切图那一次带上可行走网格（tileset 属性只有 iframe 侧解过）
      applyEnemyNavPayload((params as any)?.walkGrid);
      // ★ 拿到本图碰撞网格后，把开局 / 动态生成的未校正落点推到最近可走格（防卡墙 / 卡障碍）
      fixSpawnWithNav(s);
      // ★ v5：同步系统面板（当前地图名 / 参数卡外部改动 / 角色卡位置 / 队伍）
      // fix: tick levelName 来自前端 currentLevelName ref，只有 switchLevel 完成后才会更新。
      //   sys_travel 设置了 s.levelName=target 但前端还没切图 → levelName 还是旧值。
      //   不加 guard 会把 target 覆盖回旧值，导致 handleLevelChange 错误触发，entities 全消失。
      if (str((params as any)?.levelName)) {
        const incomingLv = str((params as any).levelName);
        const ackLv = (s as any)._levelAt || "";
        if ((s as any)._travelPending) {
          // sys_travel 发起、前端尚未完成切图：忽略前端旧地图名，
          // 直到前端上报目标名才解除 pending（防止 pending target 被旧值覆盖）
          if (incomingLv === s.levelName) (s as any)._travelPending = false;
        } else {
          // 无 pending 传送：前端上报即权威（含走路穿传送门的 switchLevel——
          // ★ fix：此前三条件 guard 在"走路切图"时全部不匹配 → levelName 永不更新
          //   → handleLevelChange 永不触发 → 未组队 ally 不进 parked，两张图都画同一批角色）
          s.levelName = incomingLv;
          void ackLv;
        }
        // else: keep s.levelName as-is (sys_travel's pending target); front will switchLevel
        // and the next tick will carry the new value (matches s.levelName) → safe to adopt.
      }
      syncCardFromContext(s, context);
      applyBagAttributes(s); // ★ game.md 背包被动属性加成（Defense/Attack/Life/Blue）
      syncPlayerCardStats(s); // ★ game.md 等级系统：等级/经验/HP/MP → 动态角色卡（变化才回写）
      ensureNpcCards(s, s.levelName || "");
      if (s.tick % SYS_PERSIST_EVERY_TICKS === 0) void persistSys(context, s);
      step(s, params?.input || params, params?.player);   // ★ fix③：把客户端上报的权威位姿透传给 step
      // ★ 角色驻留地图：检测到玩家换图后，非组队角色留在原图（停车），组队角色跟来
      if (s.levelName && s.levelName !== (s as any)._levelAt) {
        handleLevelChange(s, true);
        (s as any)._levelAt = s.levelName;
        ensureNpcCards(s, s.levelName || "");
      }
      // ★ 任务板：非 confirm 的到达目标走到即完成 + 护送货物跟随 + 限时超时 + 重算任务视图
      syncQuestArriveAuto(s);
      checkQuestTimeouts(s);
      buildQuestView(s);
      // ★ fix（事件日志被污染）：**只在「敌怪表真的变了」时报一次**，不要每 tick 报。
      //   前端 localEnemies 清单每 tick 都带（epoch 相同则宿主忽略），
      //   若这里无条件 pushEvent → 事件日志每秒刷一条「当前关卡敌怪已接入宿主 AI（N 只）」，
      //   把真正的战斗事件冲掉（实测 376 tick 里刷了 35 条）。
      //   判定：本次重建的只数与上次不同，或本地敌怪世代号变了 → 才算「变了」。
      if (localBuilt > 0) {
        const _lb = (s as any)._lastLocalBuilt ?? -1;
        const _le = num(s.localMobsEpoch, 0);
        const _lpe = (s as any)._lastLocalEpoch ?? -1;
        if (_lb !== localBuilt || _lpe !== _le) {
          (s as any)._lastLocalBuilt = localBuilt;
          (s as any)._lastLocalEpoch = _le;
          pushEvent(s, `当前关卡敌怪已接入宿主 AI（${localBuilt} 只）`);
        }
      }
      return okResp("");
    }

    case "skill": {
      if (s.phase !== "playing") return okResp("");
      s.axeMode = false; // ★ 斧头破坏模式：使用技能即收起
      const idx = num(params?.index, 0);
      const slotIdx = s.skillPage * QUICKBAR_PAGE_SIZE + idx;
      const skill = s.skills[slotIdx];
      const player = s.entities.find((e) => e.side === "player");
      if (!skill || skill.empty || !skill.name || !player || !player.alive) return okResp("");
      if (skill.cdLeft > 0) return okResp(`${skill.name} 冷却中`);
      // ★ 空放：无目标也正常施放（特效/CD 照常），只是没有伤害结算
      const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(player, e) < SKILL_RANGE_M);
      skill.cdLeft = skill.cd;
      // ★ v5：通用特效（无专属特效时）—— 角色小跳 + 飘字
      (player as any).actionBobMs = 300;
      floater(s, skill.name, player.x, player.y - 34);
      // ★ game.md 技能特效：远程→火球 / 治疗→治疗环 / 加强→护盾环 / 其余→冲斩刀光
      const fx = skillFxKind(skill);
      if (fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: player.id, x: player.x, y: player.y, life: 18, total: 18, color: effectColor((skill as any).effects_type, "#7CFFB2"), icon: effectIcon((skill as any).effects_type), size: 1.0 });
      } else if (fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: player.id, x: player.x, y: player.y, life: 30, total: 30, color: effectColor((skill as any).effects_type, "#9CCFFF"), icon: effectIcon((skill as any).effects_type), size: 1.0 });
      } else if (fx === "ranged") {
        const t0 = targets[0];
        pushVfx(s, {
          kind: "fireball", entityId: player.id, targetEntityId: t0?.id,
          x: player.x, y: player.y, targetX: t0?.x ?? player.x, targetY: t0?.y ?? player.y,
          facing: player.facing, life: 16, total: 16, color: effectColor((skill as any).effects_type, "#ff6a00"), icon: effectIcon((skill as any).effects_type), size: 1.0,
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: player.id, x: player.x, y: player.y, facing: player.facing, life: 12, total: 12, color: effectColor((skill as any).effects_type, "#fff"), icon: effectIcon((skill as any).effects_type), size: 1.6 });
      }
      targets.slice(0, 3).forEach((t) => damage(s, t, skill.power, player));
      pushEvent(s, targets.length ? `施放 ${skill.name}，命中 ${Math.min(3, targets.length)} 个目标` : `施放 ${skill.name}`);
      return okResp(targets.length ? `${skill.name}` : `${skill.name}（空放）`);
    }

    /* ============ ★ 方案一 + 三：点击自动逼近 & 普攻 ============ */
    case "goto_enemy": {
      if (s.phase !== "playing") return okResp("");
      const targetId = str(params?.targetId, "");
      const skillIdx = num(params?.skillIdx, 0);
      const target = s.entities.find((e) => e.id === targetId && e.alive !== false);
      if (!target) return okResp("目标已消失");
      s.autoApproach = { targetId, skillIdx, phase: "moving" };
      return okResp(`正在接近 ${target.name}…`);
    }

    case "attack": {
      if (s.phase !== "playing") return okResp("");
      const player = s.entities.find((e) => e.side === "player");
      if (!player || !player.alive) return okResp("");
      // ★ 方案三：普攻——在 SKILL_RANGE_M 内找最近活敌，短冷却无消耗
      //   ★ 练习假人（trainingDummy，side=neutral）也算合法攻击目标——
      //   玩家点了假人 → damage() 正常结算；kills/exp 走下面的 dummy 特判（不给经验）
      const enemies = s.entities.filter((e) =>
        (e.side === "enemy" || (e as any).trainingDummy === true) && e.alive !== false);
      const inRange = enemies.filter((e) => dist(player, e) < SKILL_RANGE_M);
      if (!inRange.length) return okResp("附近没有敌人");
      const target = inRange.reduce((best, e) => (!best || dist(player, e) < dist(player, best) ? e : best), inRange[0]);
      const dmg = Math.max(1, Math.round(player.atk * 0.6));
      (player as any).actionBobMs = 200;
      floater(s, "普攻", player.x, player.y - 34);
      // ★ P2：普攻带当前武器/主手物品的 effects_type（从 playerCard 第一件 atk 装备推断，无则默认白）
      const mainItem = mergeBag(itemsFromCard(s.playerCard || {}), s.bagMeta, s.bagOrder, s.itemMeta).find((x) => (x.type || "") === "atk");
      pushVfx(s, { kind: "slash_arc", entityId: player.id, x: player.x, y: player.y, facing: player.facing, life: 12, total: 12, color: effectColor(mainItem?.effects_type, "#fff"), size: 1.2 });
      damage(s, target, dmg, player);
      pushEvent(s, `普攻命中 ${target.name}，伤害 ${dmg}`);
      return okResp(`普攻 → ${target.name} -${dmg}`);
    }

    case "item": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.itemPage * QUICKBAR_PAGE_SIZE + idx;
      const item = s.items[slotIdx];
      if (!item || item.empty || !item.name || item.count <= 0) return okResp("");
      // ★ game.md 物品栏使用：与背包面板同一套 type 分路特效 / 耐久 / 属性逻辑
      return okResp(useBagItem(s, item.name));
    }

    /* ============ ★ v5：系统面板（背包 / 纳戒 / 商城 / 技能 / 地图 / 角色卡）============ */

    case "sys": {
      // 前端打开系统面板时上报已知关卡（大地图）与当前地图名
      const levels = Array.isArray(params?.levels) ? params.levels.map(String).filter(Boolean) : [];
      const displayNames = Array.isArray(params?.displayNames) ? params.displayNames.map(String) : [];
      if (levels.length) {
        s.mapNodes = levels.map((n, i) => ({
          name: n,
          display: displayNames[i] || n,
          x: 160 + (i % 4) * 260,
          y: 140 + Math.floor(i / 4) * 200,
        }));
      }
      if (str(params?.levelName)) s.levelName = str(params.levelName, s.levelName || "");
      if (!s.ring) s.ring = { items: [], skills: [] };
      if (!Array.isArray(s.partyIds)) s.partyIds = [];
      if (!s.shopGoods || !s.shopGoods.length) await refreshShop(context, s);
      ensureNpcCards(s, s.levelName || "");
      await persistSys(context, s);
      return okResp("");
    }

    case "sys_sell": {
      const name = str(params?.name);
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      const card = (s.playerCard || {}) as Record<string, any>;
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      const it = bag.find((x) => x.name === name);
      if (!it) return okResp(`背包里没有「${name}」`);
      const sold = Math.min(ask, it.count);
      const gain = sellPrice(it) * sold;
      const nextBag = bag
        .map((x) => (x.name === name ? { ...x, count: x.count - sold } : x))
        .filter((x) => x.count > 0);
      patchCard(s, { items: serializeBag(nextBag, card.items), money: Math.round(num(card.money, 0)) + gain });
      pushEvent(s, `卖出 ${name}×${sold}，获得 ${gain} 金钱`);
      const me = playerEntity(s);
      if (me) floater(s, `+${gain} 金`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`卖出 ${name}×${sold}（+${gain} 金）`);
    }

    case "sys_use_item": {
      // 背包 / 物品栏点击使用：type 分路特效 / 耐久 / 属性逻辑统一在 useBagItem
      const name = str(params?.name);
      const msg = useBagItem(s, name);
      // ★ 野怪击杀奖励③：核类物品命中骰子 → 问 AI「获得什么技能」并写入参数卡
      let tail = "";
      if ((s as any)._pendingCoreGrant) {
        (s as any)._pendingCoreGrant = false;
        tail = await grantCoreSkill(s, context);
      }
      await persistSys(context, s);
      return okResp(msg + tail);
    }

    case "sys_skill_pool": {
      // ★ 野怪击杀奖励：下发「暗核可授予的技能池」（宿主 / 前端 / 事件脚本可调用）
      //   params.pool: string[]；params.meta: { 技能名: skillMeta 字段 }（可选，缺省按名字推断）
      const pool = Array.isArray(params?.pool) ? params.pool.map((x: unknown) => cleanSkillName(x).slice(0, 12)).filter(Boolean) : [];
      s.skillPool = pool;
      const metaIn = (params?.meta && typeof params.meta === "object" ? params.meta : null) as Record<string, any> | null;
      if (metaIn) {
        s.skillMeta = { ...(s.skillMeta || {}) };
        Object.keys(metaIn).forEach((k) => {
          const nm = cleanSkillName(k).slice(0, 12);
          if (!nm) return;
          const m = metaIn[k] || {};
          (s.skillMeta as any)[skillKey(nm)] = {
            power: Math.max(0, Math.round(num(m.power, 12))),
            cost: Math.max(0, Math.round(num(m.cost, 0))),
            cd: Math.max(1, Math.round(num(m.cd, 24))),
            type: (["atk", "heal", "buff"] as const).includes(String(m.type) as any) ? String(m.type) : inferSkillType(nm).type,
            range: String(m.range) === "ranged" ? "ranged" : inferSkillType(nm).range,
            lv: Math.max(1, Math.round(num(m.lv, 1))),
            buff_type: BUFF_TYPES.includes(String(m.buff_type)) ? String(m.buff_type) : "",
            effects_type: typeof m.effects_type === "string" ? m.effects_type : "",
          };
        });
        s.skills = buildSkills(s.playerCard || {}, QUICKBAR_PAGE_SIZE, s.skillMeta);
        clampQuickbarPages(s);
      }
      await persistSys(context, s);
      return okResp(`技能池已更新（${pool.length} 项）：${pool.slice(0, 8).join("、")}`);
    }

    /* ============================================================
       ★ 任务板（spec：events/任务事件/任务板.事件.md）
       ============================================================ */
    case "sys_quest_pool": {
      // 下发/覆盖任务定义（宿主 / 事件脚本 / CLI 上传 quest_defs）
      const arr = Array.isArray(params?.defs) ? params.defs
        : Array.isArray(params?.quests) ? params.quests
        : Array.isArray(params) ? (params as any)
        : [];
      const defs = arr.map((x: any, i: number) => normalizeQuestDef(x, i)).filter(Boolean) as QuestDef[];
      if (!defs.length) return okResp("任务池为空（未提供 defs）");
      const mode = str(params?.mode, "merge");
      if (mode === "replace") s.questBoard = defs;
      else {
        const map = new Map(questList(s).map((q) => [String(q.id), q]));
        defs.forEach((d) => map.set(String(d.id), d));
        s.questBoard = Array.from(map.values());
      }
      buildQuestView(s);
      await persistSys(context, s);
      return okResp(`任务板已更新（${s.questBoard.length} 条，本次 ${defs.length} 条）`);
    }

    case "sys_quest_board": {
      // 打开任务板：重算视图（可接 / 进行中 / 待交 / 已交）
      if (!Array.isArray(s.questBoard) || !s.questBoard.length) {
        const n = await ensureQuestDefs(context, s);
        if (n > 0) pushEvent(s, `任务板载入 ${n} 条委托`);
      }
      syncQuestArriveAuto(s);
      buildQuestView(s);
      const v = (s as any).questView || { available: [], active: [], done: [], turned: [] };
      return okResp(`任务板：可接 ${v.available.length} · 进行中 ${v.active.length} · 待交 ${v.done.length}`);
    }

    case "sys_quest_accept": {
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      // ★ fix：这里**不能**用 ensureProg() 预创建进度 —— 它会先生成 {id,status:"active"}，
      //   紧接着的 `p.status === "active"` 守卫就把「首次接取」误判成「已经在进行中」并提前返回，
      //   结果 acceptedTick / kill·gather·talked 计数容器 / cargoId 全部缺失：
      //     · 限时任务（timeLimitTicks）acceptedTick 缺失 → 永不超时
      //     · 护送任务 cargo 不生成 → 护送玩法失效
      //   改为只读既有进度做守卫（s.quests 容器本身仍需保证存在）。
      if (!s.quests || typeof s.quests !== "object") s.quests = {};
      const existing = s.quests[String(def.id)];
      if (existing && existing.status === "active") return okResp(`「${def.title}」已经在进行中`);
      if (existing && existing.status === "done") return okResp(`「${def.title}」已完成，去交任务`);
      if (existing && existing.status === "turned" && !def.repeat) return okResp(`「${def.title}」已经交过了`);
      // 重接 / 首次接取：清空进度
      const prevCargo = existing?.cargoId;
      if (prevCargo) removeQuestCargo(s, existing!);
      s.quests[String(def.id)] = {
        id: String(def.id), status: "active", kill: {}, gather: {}, talked: {},
        arrived: false, cargoId: "", acceptedTick: s.tick, acceptedMap: str(s.levelName),
      };
      if (def.type === "escort" || def.cargo) spawnQuestCargo(s, def, ensureProg(s, def.id));
      if (def.flags?.accept) await setPlayerFlag(context, def.flags.accept, true);
      buildQuestView(s);
      await persistSys(context, s);
      return okResp(`已接取「${def.title}」${def.cargo ? "（货物已交给你，别弄丢了）" : ""}`);
    }

    case "sys_quest_turnin": {
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      const p = (s.quests || {})[String(def.id)];
      if (!p || p.status === "turned") return okResp(`「${def.title}」已经交过了`);
      if (p.status !== "done") {
        const why = p.status === "failed"
          ? (str((p as any).failReason) === "timeout" ? "限时已过，请放弃后重接" : "护送失败，请放弃后重接")
          : "目标未达成";
        return okResp(`「${def.title}」还没完成（${why}）`);
      }
      // 交付：扣物品（deliver 的 consume，缺省按 gather 目标同名扣）
      const consume = Array.isArray(def.consume) && def.consume.length
        ? def.consume
        : (def.objectives || []).filter((o) => o.kind === "gather" && str(o.target))
            .map((o) => ({ name: str(o.target), count: objNeed(o) }));
      for (const c of consume) {
        if (!str(c.name)) continue;
        removeBagItemFromCard(s, str(c.name), Math.max(1, Math.round(num(c.count, 1))));
      }
      // 发奖
      const exp = Math.round(num(def.reward?.exp, 0));
      const money = Math.round(num(def.reward?.money, 0));
      if (exp > 0) gainPlayerExp(s, exp);
      if (money > 0) s.money += money;
      const got: string[] = [];
      for (const it of def.reward?.items || []) {
        if (!str(it.name)) continue;
        addBagItemToCard(s, str(it.name), Math.max(1, Math.round(num(it.count, 1))));
        got.push(`${it.name}×${Math.max(1, Math.round(num(it.count, 1)))}`);
      }
      removeQuestCargo(s, p);
      p.status = "turned";
      p.turnedTick = s.tick;
      p.cargoId = "";
      if (def.flags?.done) await setPlayerFlag(context, def.flags.done, true);
      const rw = [exp > 0 ? `${exp}exp` : "", money > 0 ? `${money}金` : "", got.join("、")].filter(Boolean).join("、");
      s.questNotice = `「${def.title}」已交，奖励：${rw || "无"}`;
      pushEvent(s, `交还任务：${def.title}（${rw || "无奖励"}）`);
      buildQuestView(s);
      await persistSys(context, s);
      return okResp(`「${def.title}」已交付，获得 ${rw || "无奖励"}`);
    }

    case "sys_quest_recover_cargo": {
      // ★ 找回丢失的护送货物：在玩家身边重新生成（"直接回到用户旁边"）。
      //   · 进行中但货物被打掉 → 原地补一个；
      //   · 因货物被打掉而 failed → 连任务一起救活（status 回 active、重置限时计时），
      //     超时失败的不救（那是玩家自己没赶上，救回来会立刻再超时）。
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      const p = (s.quests || {})[String(def.id)];
      if (!p || (p.status !== "active" && p.status !== "failed")) {
        return okResp(`「${def.title}」不在进行中，无法找回货物`);
      }
      // 已有活货物 → 不用找回
      const alive = (s.entities || []).find(
        (e) => String(e.id) === String(p.cargoId) && e.alive !== false,
      );
      if (alive && p.cargoId) return okResp("货物还在，不用找回");
      const wasFailedByCargo = p.status === "failed" && str((p as any).failReason) === "cargo";
      spawnQuestCargo(s, def, p);
      if (wasFailedByCargo) {
        p.status = "active";
        (p as any).failReason = "";
        // 限时任务：按"重新接取"计（否则 acceptedTick 还是老的，下一 tick 立刻又判超时）
        p.acceptedTick = Math.round(num(s.tick, 0));
      }
      refreshQuestStatus(s, def);
      buildQuestView(s);
      await persistSys(context, s);
      pushEvent(s, `找回货物：${def.title}`);
      return okResp(
        wasFailedByCargo
          ? `货物已找回（「${def.title}」重新开始，箱子就在你身边）`
          : `货物已找回（${def.title}），就在你身边`,
      );
    }

    case "sys_quest_abandon": {
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      const p = (s.quests || {})[String(def.id)];
      if (!p || p.status === "turned") return okResp(`「${def.title}」无需放弃`);
      removeQuestCargo(s, p);
      delete (s.quests || {})[String(def.id)];
      buildQuestView(s);
      await persistSys(context, s);
      return okResp(`已放弃「${def.title}」${def.repeat ? "（可重新接取）" : ""}`);
    }

    case "sys_quest_arrive": {
      // 点「到达」/「交付」：校验玩家真的在目的地（或目标地图）才认
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      const p = (s.quests || {})[String(def.id)];
      if (!p || p.status !== "active") return okResp(`「${def.title}」不在进行中`);
      const chk = questArriveOk(s, def);
      if (!chk.ok) return okResp(chk.msg || "还没到目的地");
      p.arrived = true;
      refreshQuestStatus(s, def);
      buildQuestView(s);
      await persistSys(context, s);
      const done = (s.quests || {})[String(def.id)]?.status === "done";
      return okResp(done ? `已到达目的地，「${def.title}」可以交了` : `已记录到达（${def.title}）`);
    }

    case "sys_quest_ask": {
      // 问 AI 任务详情 / 玩家追问（结果写 s.questAiText，前端按 _questAsking 显示思考中）
      const id = str(params?.id).trim();
      const def = questById(s, id);
      if (!def) return okResp("没有这个任务");
      const q = str(params?.question ?? params?.text).trim();
      s._questAsking = true;
      const ans = await askQuestByAI(s, context, def, q);
      s._questAsking = false;
      s.questAiText = ans;
      return okResp(ans);
    }

    case "sys_quest_generate": {
      // AI 按故事生成本图可接任务（并入 questBoard）
      const n = Math.round(num(params?.n, num(params?.count, 3)));
      const added = await generateQuestsByAI(s, context, n);
      buildQuestView(s);
      await persistSys(context, s);
      return okResp(added > 0 ? `任务板新增 ${added} 条委托` : "AI 没能生成新委托（可稍后再试）");
    }

    /* ============================================================
       ★ 实体形象（系统 → 角色 → 实体形象）
       · 预选：player_sprites 目录下的内置像素形象（前端直连，不需要后端动作）
       · AI 生成：提示词 + 可选参考图（预选图 / 上传图）→ 后端生图 agent
       · 图库：生成结果可删除，可选用为「用户」或任意角色 的形象
       ============================================================ */
    case "sys_sprite_generate": {
      const prompt = str(params?.prompt).trim();
      if (!prompt) return okResp("请先填写形象描述（例如：银发黑衣的游侠，背负长弓）");
      const refs = Array.isArray(params?.refImages) ? (params.refImages as unknown[]).map(String) : [];
      const programmatic = params?.programmatic === true;
      // 防重入：上一次还在生成时直接拒绝（避免连点烧额度）
      if (s.spriteGen?.status === "running") return okResp("上一张形象还在生成中，请稍候…");
      s.spriteGen = { status: "running", message: "", at: Date.now() };
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;

      /* ★ 2026-10-20：programmatic=true → 本地程序生成（不调图片模型、不烧额度）。
       *   AI 生成失败不再有 mock 兜底（用户明确要求去掉），失败直接报错。 */
      let r: { ok: boolean; image?: string; error?: string; matting?: string };
      if (programmatic) {
        try {
          r = { ok: true, image: renderSpriteProgrammatically(prompt), matting: "local" };
        } catch (e: any) {
          r = { ok: false, error: "程序生成失败：" + String(e?.message || e) };
        }
      } else {
        r = await generateSpriteByAI(s, context, prompt, refs);
      }
      if (!r.ok || !r.image) {
        s.spriteGen = { status: "error", message: r.error || "生成失败", at: Date.now() };
        s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
        return okResp("形象生成失败：" + (r.error || "未知错误"));
      }
      const entry: SpriteEntry = {
        id: `sp_${Math.round(num(s.tick, 0))}_${Math.random().toString(36).slice(2, 8)}`,
        image: r.image,
        prompt: prompt.slice(0, 200),
        refCount: refs.length,
        source: "ai",
        createdAt: Date.now(),
        matting: r.matting,
      };
      const gal = Array.isArray(s.spriteGallery) ? s.spriteGallery.slice() : [];
      gal.unshift(entry);
      // 超上限：优先淘汰「最旧的、且没被任何角色使用」的条目；全在用则保留（宁可超也不删正在用的）
      const boundImages = new Set(Object.values(s.spriteBinds || {}).map((v: any) => v && v.image).filter(Boolean));
      while (gal.length > SPRITE_GALLERY_MAX) {
        let dropAt = -1;
        for (let i = gal.length - 1; i >= 0; i--) {
          if (!boundImages.has(gal[i].image)) { dropAt = i; break; }
        }
        if (dropAt < 0) break;
        gal.splice(dropAt, 1);
      }
      s.spriteGallery = gal;
      s.spriteGen = { status: "done", message: programmatic ? "程序生成成功" : "生成成功", at: Date.now() };
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      pushEvent(s, `${programmatic ? "程序生成" : "生成"}实体形象：${prompt.slice(0, 16)}`);
      return okResp(programmatic ? "程序形象已生成，可在「我的生成」里选用或删除" : "形象已生成，可在「我的生成」里选用或删除");
    }

    case "sys_sprite_bind": {
      // 把某个形象绑定给目标角色（target = 角色 id；"PLAYER" 或空 = 用户自己）
      // image 是 data:URL 或插件内相对路径；可选 prompt/source（preset 走 source="preset"）
      let target = str(params?.target).trim();
      const image = str(params?.image).trim();
      if (!image) return okResp("请选择要使用的形象");
      if (!target || target === "PLAYER") {
        const pr = (Array.isArray(s.roles) ? s.roles : []).find(
          (r: any) => String(r?.roleType) === "player",
        ) as any;
        target = pr ? String(pr.id) : "PLAYER";
      }
      const src = str(params?.source, "") as "" | "preset" | "ai" | "upload";
      const promptText = str(params?.prompt, "");
      const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
      binds[target] = {
        image,
        prompt: promptText || undefined,
        // ★ 默认 source：data:URL 走 upload；./ 或 / 开头走 preset；空时按 image 头猜
        source: src || (/^data:/i.test(image) ? "upload" : (image.startsWith("./") || image.startsWith("/")) ? "preset" : "preset"),
        createdAt: Math.round(num(params?.createdAt, Date.now())),
      };
      (s as any).spriteBinds = binds;
      applySpriteBindToEntities(s, target);
      ensureNpcCards(s, s.levelName || "");
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      const nm = str(((s.npcCards || []).find((c) => String(c.id) === target) || {}).name, target);
      return okResp(`已为「${nm}」更换形象`);
    }

    case "sys_sprite_unbind": {
      // 取消形象绑定 → 实体回退到 tileset 渲染
      const target = str(params?.target).trim();
      if (!target) return okResp("缺少目标角色");
      const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
      delete binds[target];
      (s as any).spriteBinds = binds;
      applySpriteBindToEntities(s, target);
      ensureNpcCards(s, s.levelName || "");
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      return okResp("已恢复原始形象");
    }

    case "sys_sprite_gallery_del": {
      // 删除一张生成的形象；若正被使用，先解绑（实体回退到 tileset）
      const id = str(params?.id).trim();
      const gal = Array.isArray(s.spriteGallery) ? s.spriteGallery.slice() : [];
      const idx = gal.findIndex((g) => String(g.id) === id);
      if (idx < 0) return okResp("形象不存在（可能已删除）");
      const img = gal[idx].image;
      gal.splice(idx, 1);
      s.spriteGallery = gal;
      const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
      const toUnbind: string[] = [];
      Object.keys(binds).forEach((k) => {
        if (binds[k] && binds[k].image === img) {
          delete binds[k];
          toUnbind.push(k);
        }
      });
      (s as any).spriteBinds = binds;
      // ★ 写回后再 apply——否则 spriteOverrideFor 仍能读到旧 binds（闭包引用），实体不被恢复
      toUnbind.forEach((k) => applySpriteBindToEntities(s, k));
      ensureNpcCards(s, s.levelName || "");
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      return okResp("已删除该形象");
    }

    case "sys_sprite_flip": {
      // 左右翻转一张图库形象（AI 生成有时面向右边，用户要求可翻转）：
      // 替换图库条目 image，并同步所有「绑定图 == 旧图」的绑定，让已使用的角色立即换向
      const id = str(params?.id).trim();
      const image = str(params?.image).trim();
      const gal = Array.isArray(s.spriteGallery) ? s.spriteGallery.slice() : [];
      const idx = gal.findIndex((g) => String(g.id) === id);
      if (idx < 0) return okResp("形象不存在（可能已删除）");
      if (!image) return okResp("缺少翻转后的图片");
      const oldImg = gal[idx].image;
      if (oldImg === image) return okResp("图片未变化，无需翻转");
      gal[idx] = { ...gal[idx], image };
      s.spriteGallery = gal;
      const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
      const flippedTargets: string[] = [];
      Object.keys(binds).forEach((k) => {
        if (binds[k] && binds[k].image === oldImg) {
          binds[k] = { ...binds[k], image };
          flippedTargets.push(k);
        }
      });
      (s as any).spriteBinds = binds;
      // ★ 写回后再 apply——否则 spriteOverrideFor 仍读到旧 binds（闭包引用），实体不换向
      flippedTargets.forEach((k) => applySpriteBindToEntities(s, k));
      ensureNpcCards(s, s.levelName || "");
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      return okResp("已左右翻转该形象");
    }

    case "sys_sprite_gallery_clear": {
      // 清空图库（绑定的形象一并解绑）
      const gal = Array.isArray(s.spriteGallery) ? s.spriteGallery : [];
      const imgs = new Set(gal.map((g) => g.image));
      s.spriteGallery = [];
      const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
      const toUnbind: string[] = [];
      Object.keys(binds).forEach((k) => {
        if (binds[k] && imgs.has(binds[k].image)) {
          delete binds[k];
          toUnbind.push(k);
        }
      });
      (s as any).spriteBinds = binds;
      toUnbind.forEach((k) => applySpriteBindToEntities(s, k));
      ensureNpcCards(s, s.levelName || "");
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      await persistSys(context, s);
      return okResp("已清空生成的形象");
    }

    case "sys_sprite_upload": {
      // 上传图片直接入图库（不走 AI）。data:URL 来自前端文件选择，体积已压到 ≤512px JPEG
      const image = str(params?.image).trim();
      if (!/^data:image\//i.test(image)) return okResp("上传数据不合法（需 data:URL）");
      const target = str(params?.target).trim();
      const entry: SpriteEntry = {
        id: `up_${Math.round(num(s.tick, 0))}_${Math.random().toString(36).slice(2, 8)}`,
        image,
        prompt: str(params?.prompt, "").slice(0, 200),
        refCount: 0,
        source: "upload",
        createdAt: Date.now(),
      };
      const gal = Array.isArray(s.spriteGallery) ? s.spriteGallery.slice() : [];
      gal.unshift(entry);
      const boundImages = new Set(Object.values(s.spriteBinds || {}).map((v: any) => v && v.image).filter(Boolean));
      while (gal.length > SPRITE_GALLERY_MAX) {
        let dropAt = -1;
        for (let i = gal.length - 1; i >= 0; i--) {
          if (!boundImages.has(gal[i].image)) { dropAt = i; break; }
        }
        if (dropAt < 0) break;
        gal.splice(dropAt, 1);
      }
      s.spriteGallery = gal;
      s.spriteRevision = Math.round(num(s.spriteRevision, 0)) + 1;
      // 可选：上传后立即绑定
      if (target && target !== "PLAYER") {
        const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
        binds[target] = { image, prompt: entry.prompt, source: "upload", createdAt: entry.createdAt };
        (s as any).spriteBinds = binds;
        applySpriteBindToEntities(s, target);
        ensureNpcCards(s, s.levelName || "");
      } else if (target === "PLAYER") {
        const pr = (Array.isArray(s.roles) ? s.roles : []).find(
          (r: any) => String(r?.roleType) === "player",
        ) as any;
        const tid = pr ? String(pr.id) : "PLAYER";
        const binds = { ...((s as any).spriteBinds as Record<string, any> || {}) };
        binds[tid] = { image, prompt: entry.prompt, source: "upload", createdAt: entry.createdAt };
        (s as any).spriteBinds = binds;
        applySpriteBindToEntities(s, tid);
        ensureNpcCards(s, s.levelName || "");
      }
      await persistSys(context, s);
      return okResp(target ? "已上传并绑定" : "已上传至图库");
    }

    case "sys_sort": {
      // 排列顺序：kind=item（默认，背包）/ kind=skill（技能栏）
      // 前端「上移 / 下移」按钮与拖拽排序都走这里（提交完整顺序数组）
      const kind = str(params?.kind, "item");
      const order = Array.isArray(params?.order) ? params.order.map(String).filter(Boolean) : [];
      const card = (s.playerCard || {}) as Record<string, any>;
      if (kind === "skill") {
        const next = reorderCardSkills(card, order);
        if (!next.length) return okResp("技能栏为空，无法排序");
        // skillOrder 存归一化技能名：断线重连/宿主回灌时用来还原顺序
        s.skillOrder = next.map((x) => skillKey(x)).filter(Boolean);
        patchCard(s, { skills: next });
        await persistSys(context, s);
        return okResp("技能顺序已更新");
      }
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, order.length ? order : s.bagOrder);
      s.bagOrder = bag.map((x) => x.name);
      patchCard(s, { items: serializeBag(bag, card.items) });
      await persistSys(context, s);
      return okResp("背包顺序已更新");
    }

    case "sys_ring_move": {
      // 背包 ⇄ 纳戒（物品 / 技能）
      const kind = str(params?.kind, "item");
      const name = str(params?.name);
      const to = str(params?.to, "ring") === "bag" ? "bag" : "ring";
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      if (!name) return okResp("缺少名称");
      if (!s.ring) s.ring = { items: [], skills: [] };
      const card = (s.playerCard || {}) as Record<string, any>;
      if (kind === "skill") {
        // ★ 纳戒技能修复：参数卡 skills 是带「lv/括号」注记的字符串（"源之力（lv1，失控）（lv1）"），
        //   前端 sendTick 上报的是 cleanSkillName 后的纯名"源之力"；原 indexOf 全等比对失败
        //   → 静默 "技能「源之力」不在技能栏"。统一改归一键（skillKey）比对。
        const skills = Array.isArray(card.skills)
          ? card.skills.map((x: any) => (typeof x === "string" ? x : str((x as any)?.name))).filter(Boolean)
          : [];
        const ringSkills = s.ring.skills || [];
        if (to === "ring") {
          const nameKey = skillKey(name);
          const at = skills.findIndex((x) => skillKey(x) === nameKey);
          if (at < 0) return okResp(`技能「${name}」不在技能栏`);
          const realName = cleanSkillName(skills[at]) || name;
          s.ring.skills = Array.from(new Set([...ringSkills, realName]));
          patchCard(s, { skills: skills.filter((_, i) => i !== at) });
          pushEvent(s, `技能 ${realName} 已存入纳戒`);
          await persistSys(context, s);
          return okResp(`已存入纳戒：${realName}`);
        } else {
          const nameKey = skillKey(name);
          const at = ringSkills.findIndex((x) => skillKey(x) === nameKey);
          if (at < 0) return okResp(`纳戒里没有技能「${name}」`);
          const realName = cleanSkillName(ringSkills[at]) || name;
          s.ring.skills = ringSkills.filter((_, i) => i !== at);
          patchCard(s, { skills: Array.from(new Set([...skills, realName])) });
          pushEvent(s, `技能 ${realName} 已从纳戒取出`);
          await persistSys(context, s);
          return okResp(`已取出：${realName}`);
        }
      }
      // 物品走归一键（itemKey），应对参数卡「银鲳×16（钓鱼累积…）」剥完的纯名 + bagMeta 元数据别名
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      const nameKey = itemKey(name);
      if (to === "ring") {
        const at = bag.findIndex((x) => itemKey(x.name) === nameKey);
        if (at < 0) return okResp(`背包里没有「${name}」`);
        const it = bag[at];
        const realName = it.name;
        const moved = Math.min(ask, it.count);
        const ringItems = s.ring.items || [];
        const exist = ringItems.find((x) => itemKey(x.name) === nameKey);
        if (exist) exist.count += moved;
        else ringItems.push({ ...it, count: moved });
        s.ring.items = ringItems;
        const nextBag = bag
          .map((x, i) => (i === at ? { ...x, count: x.count - moved } : x))
          .filter((x) => x.count > 0);
        patchCard(s, { items: serializeBag(nextBag, card.items) });
        pushEvent(s, `${realName}×${moved} 已存入纳戒`);
        await persistSys(context, s);
        return okResp(`已存入纳戒：${realName}`);
      } else {
        const ringItems = s.ring.items || [];
        const at = ringItems.findIndex((x) => itemKey(x.name) === nameKey);
        if (at < 0) return okResp(`纳戒里没有「${name}」`);
        const it = ringItems[at];
        const realName = it.name;
        const moved = Math.min(ask, it.count);
        const exist = bag.find((x) => itemKey(x.name) === nameKey);
        if (exist) exist.count += moved;
        else bag.push({ ...it, count: moved });
        s.ring.items = ringItems.filter((_, i) => i !== at);
        s.bagMeta = { ...(s.bagMeta || {}), [realName]: { ...it, count: 0 } };
        patchCard(s, { items: serializeBag(bag, card.items) });
        pushEvent(s, `${realName}×${moved} 已从纳戒取出`);
        await persistSys(context, s);
        return okResp(`已取出：${realName}`);
      }
    }

    case "sys_rest": {
      // ★ game.md 5：睡觉 / 住宿 / 休息过夜 → 直接满血满蓝，恢复描述写入角色卡 other
      if (s.phase !== "playing") return okResp("");
      const meRest = playerEntity(s);
      if (!meRest || !meRest.alive) return okResp("角色不可用");
      (meRest as any).actionBobMs = 300;
      restorePlayerFull(s, str(params?.reason, "休息"));
      return okResp(`🎉 恭喜您已恢复到最佳状态！HP ${Math.round(meRest.hp)}/${Math.round(meRest.maxHp)}，MP ${Math.round(num(meRest.mp, 0))}/${Math.round(num(meRest.maxMp, 0))}`);
    }

    case "sys_use_skill": {
      // 系统面板「技能」页 / 快捷栏点击使用：无专属特效时统一走「小跳 + 飘字」
      const skName = str(params?.name);
      const skIdx = num(params?.index, -1);
      const meSk = playerEntity(s);
      if (!meSk || !meSk.alive) return okResp("角色不可用");
      const si = skIdx >= 0 ? skIdx : s.skills.findIndex((k) => k.name === skName);
      const sk = s.skills[si];
      if (!sk) return okResp(`技能「${skName}」不存在`);
      if (sk.cdLeft > 0) return okResp(`${sk.name} 冷却中`);
      sk.cdLeft = sk.cd;
      (meSk as any).actionBobMs = 300;
      floater(s, sk.name, meSk.x, meSk.y - 34);
      const skTargets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(meSk, e) < SKILL_RANGE_M);
      // ★ game.md 技能特效（与「skill」共用一套归类）：远程→火球 / 治疗→治疗环 / 加强→护盾环 / 其余→冲斩刀光
      const _fx = skillFxKind(sk);
      if (_fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 18, total: 18, color: effectColor((sk as any).effects_type, "#7CFFB2"), icon: effectIcon((sk as any).effects_type), size: 1.0 });
      } else if (_fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 30, total: 30, color: effectColor((sk as any).effects_type, "#9CCFFF"), icon: effectIcon((sk as any).effects_type), size: 1.0 });
      } else if (_fx === "ranged") {
        const _t0 = skTargets[0];
        pushVfx(s, {
          kind: "fireball", entityId: meSk.id, targetEntityId: _t0?.id,
          x: meSk.x, y: meSk.y, targetX: _t0?.x ?? meSk.x, targetY: _t0?.y ?? meSk.y,
          facing: meSk.facing, life: 16, total: 16, color: effectColor((sk as any).effects_type, "#ff6a00"), icon: effectIcon((sk as any).effects_type), size: 1.0,
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: meSk.id, x: meSk.x, y: meSk.y, facing: meSk.facing, life: 12, total: 12, color: effectColor((sk as any).effects_type, "#fff"), icon: effectIcon((sk as any).effects_type), size: 1.6 });
      }
      if (!skTargets.length) {
        pushEvent(s, `施放 ${sk.name}（空放，无目标）`);
        return okResp(`${sk.name}（空放）`);
      }
      skTargets.slice(0, 3).forEach((t) => damage(s, t, sk.power, meSk));
      pushEvent(s, `施放 ${sk.name}，命中 ${Math.min(3, skTargets.length)} 个目标`);
      return okResp(`${sk.name}`);
    }

    case "sys_skill_edit": {
      // ★ game.md 技能修改：修改后保存到 t_plugin_session_data（skillMeta + 参数卡技能名列表）
      const idx = Math.round(num(params?.index, -1));
      const sk = s.skills[idx];
      if (!sk) return okResp("技能不存在");
      const oldKey = skillKey(sk.name);
      const nm = cleanSkillName(str(params?.name, sk.name)).slice(0, 12) || sk.name;
      sk.name = nm;
      sk.power = Math.max(0, Math.round(num(params?.power, sk.power)));
      sk.cost = Math.max(0, Math.round(num(params?.cost, sk.cost)));
      sk.cd = Math.max(1, Math.round(num(params?.cd, sk.cd)));
      sk.type = (["atk", "heal", "buff"] as const).includes(params?.type as any) ? (str(params?.type) as any) : (sk.type || "atk");
      sk.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      sk.lv = Math.max(1, Math.round(num(params?.lv, sk.lv || 1)));
      sk.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      sk.effects_type = (typeof params?.effects_type === "string") ? params.effects_type : (sk.effects_type || "");
      s.skillMeta = { ...(s.skillMeta || {}), [skillKey(nm)]: { power: sk.power, cost: sk.cost, cd: sk.cd, type: sk.type, range: sk.range, lv: sk.lv, buff_type: sk.buff_type, effects_type: sk.effects_type } };
      // 参数卡「技能」只保存技能名称列表：改名/升级时替换原条目（带 lv 注记）
      const card = (s.playerCard || {}) as Record<string, any>;
      const flat: string[] = [];
      (Array.isArray(card.skills) ? card.skills : []).forEach((x: any) => {
        if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (cleanSkillName(p)) flat.push(p.trim()); });
        else { const n = str(x?.name); if (n) flat.push(n); }
      });
      const at = flat.findIndex((x) => skillKey(x) === oldKey);
      const annotated = sk.lv! > 1 ? `${nm}（lv${sk.lv}）` : nm;
      if (at >= 0) flat[at] = annotated; else flat.push(annotated);
      patchCard(s, { skills: flat });
      pushEvent(s, `技能「${nm}」参数已修改并保存`);
      await persistSys(context, s);
      const tLabel = sk.type === "heal" ? "治疗" : sk.type === "buff" ? `强化(${sk.buff_type || "-"})` : sk.range === "ranged" ? "远程" : "近战";
      return okResp(`「${nm}」已保存（${tLabel}·lv${sk.lv}）`);
    }

    case "sys_skill_sell": {
      // ★ 系统面板-技能页签：统一卖出价 5 金；skillMeta 保留（将来可再学回而不丢等级）
      //   金钱加到 playerCard.money（与 sys_sell 物品卖出保持一致）
      const idx = Math.round(num(params?.index, -1));
      const card = (s.playerCard || {}) as Record<string, any>;
      const flat: string[] = [];
      (Array.isArray(card.skills) ? card.skills : []).forEach((x: any) => {
        if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (cleanSkillName(p)) flat.push(p.trim()); });
        else { const n = str(x?.name); if (n) flat.push(n); }
      });
      const skill = flat[idx];
      if (!skill) return okResp(`技能不存在（下标 ${idx} 越界）`);
      const GAIN = 5;
      flat.splice(idx, 1);   // 从参数卡技能列表移除
      patchCard(s, { skills: flat, money: Math.round(num(card.money, 0)) + GAIN });
      pushEvent(s, `售出「${skill}」，获得 ${GAIN} 金`);
      const me = playerEntity(s);
      if (me) floater(s, `+${GAIN} 金`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`卖出「${skill}」（+${GAIN} 金）`);
    }

    case "sys_item_edit": {
      // ★ game.md 物品修改：修改后保存到 t_plugin_session_data（itemMeta + 参数卡物品名列表）
      const idx = Math.round(num(params?.index, -1));
      const card = (s.playerCard || {}) as Record<string, any>;
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const it = idx >= 0 ? bag[idx] : bag.find((x) => x.name === str(params?.name));
      if (!it) return okResp("物品不存在");
      const oldName = it.name;
      const nm = str(params?.name, it.name).trim().slice(0, 20) || it.name;
      it.name = nm;
      it.power = Math.max(0, Math.round(num(params?.power, it.power || 0)));
      it.cost = Math.max(0, Math.round(num(params?.cost, it.cost || 0)));
      it.cd = Math.max(0, Math.round(num(params?.cd, it.cd || 0)));
      it.type = ((ITEM_TYPES as readonly string[]).includes(str(params?.type)) ? str(params?.type) : (it.type || "heal")) as ItemType;
      it.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      it.lv = Math.max(1, Math.round(num(params?.lv, it.lv || 1)));
      it.buff_type = (BUFF_TYPES as readonly string[]).includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      it.durability = clamp(Math.round(num(params?.durability, it.durability == null ? -1 : it.durability)), -1, 99999);
      it.attribute_type = (ITEM_ATTR_TYPES as readonly string[]).includes(str(params?.attribute_type)) ? str(params?.attribute_type) : "";
      it.attribute_value = Math.round(num(params?.attribute_value, it.attribute_value || 0));
      it.effects_type = (typeof params?.effects_type === "string") ? params.effects_type : (it.effects_type || "");
      // ★ game.md quantity/description：先汇总原条目数量与描述，再决定写回值
      const flat: string[] = [];
      (Array.isArray(card.items) ? card.items : []).forEach((x: any) => {
        if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (p.trim()) flat.push(p.trim()); });
        else { const n2 = str(x?.name); if (n2) flat.push(n2); }
      });
      let total = 0;
      let desc = "";
      // 参数卡物品是自由文本（「银鲤×3（钓鱼累积…）」），比对前先归一（剥注记/×N）
      const normName = (v: string) => String(v || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const oldNk = normName(oldName);
      flat.forEach((x) => {
        const p = parseItemRaw(x);
        if (!p.name || normName(p.name) !== oldNk) return;
        total += p.count;
        if (p.desc && !desc) desc = p.desc;
      });
      if (!total) total = it.count;
      const qty = params?.quantity != null ? Math.max(1, Math.round(num(params.quantity, total))) : total;
      const descNew = str(params?.description, "");
      const descFinal = descNew || desc;
      const metaEntry: ItemMeta = {
        power: it.power!, cost: it.cost!, cd: it.cd!,
        type: it.type as ItemType, range: it.range as "melee" | "ranged",
        lv: it.lv!, buff_type: it.buff_type!,
        durability: it.durability!, durabilityLeft: it.durability!,
        attribute_type: it.attribute_type!, attribute_value: it.attribute_value!,
        quantity: qty, description: descFinal,
        effects_type: it.effects_type!,
      };
      s.itemMeta = { ...(s.itemMeta || {}) };
      if (oldName !== nm) delete s.itemMeta[oldName];
      s.itemMeta[nm] = metaEntry;
      // 参数卡「物品」只保存名称列表：展平后替换同名条目（数量取 qty、lv>1 加 lv 注记、描述注记保留/更新）
      const annotated = `${nm}${qty > 1 ? `×${qty}` : ""}${it.lv! > 1 ? `（lv${it.lv}）` : ""}${descFinal ? `（${descFinal}）` : ""}`;
      const at = flat.findIndex((x) => normName(parseItemRaw(x).name) === oldNk);
      const kept = flat.filter((x) => normName(parseItemRaw(x).name) !== oldNk);
      kept.splice(Math.max(0, Math.min(at < 0 ? kept.length : at, kept.length)), 0, annotated);
      patchCard(s, { items: kept });
      applyBagAttributes(s);
      pushEvent(s, `物品「${nm}」参数已修改并保存`);
      await persistSys(context, s);
      const tLabel2 = it.type === "heal" ? "治疗" : it.type === "buff" ? `强化(${it.buff_type || "-"})` : it.type === "attribute" ? `属性(${it.attribute_type || "-"})` : it.range === "ranged" ? "远程" : "近战";
      const dLabel = it.durability! < 0 ? "永久" : `耐久${it.durability}`;
      return okResp(`「${nm}」已保存（${tLabel2}·${dLabel}·×${qty}）`);
    }

    case "sys_shop_refresh": {
      // ★ 前端传 agent:true 时强制走 agent（不清空旧 story 列表）；否则仅 agent 成功时保留
      const forceAgent = params?.agent === true;
      if (forceAgent) {
        s.shopGoods = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
        s.shopSource = "builtin";
      }
      await refreshShop(context, s, forceAgent);
      await persistSys(context, s);
      const src = s.shopSource === "agent" ? "商城agent·故事物资" : "插件常备物资";
      // ★ 回复带时间戳：连续两次刷新若货源一致，文本不同才能触发前端 response watch
      const ts = new Date().toTimeString().slice(0, 8);
      return okResp(`商城已刷新 ${ts}（${(s.shopGoods || []).length} 件商品，货源：${src}）`);
    }

    case "sys_shop_buy": {
      const id = str(params?.id);
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      // ★ 货源查找顺序：
      //   ① 本次会话的商城货源（refreshShop 写入的 shopGoods）
      //   ② 插件自带常备物资（保证商城 agent 挂掉也能买到药）
      //   ③ ★ 前端随命令带回的 good —— 地图集自带货单（锻造大师/炼丹炉等）
      //      货单在故事包里，插件侧没有权威副本，只能由前端把该件商品原样带上来。
      const good =
        (s.shopGoods || []).find((g) => g.id === id)
        || BUILTIN_SHOP_GOODS.find((g) => g.id === id)
        || normalizeShopGoodParam(params?.good);
      if (!good) return okResp("商品不存在");
      const card = (s.playerCard || {}) as Record<string, any>;
      const money = Math.round(num(card.money, 0));
      const cost = Math.round(good.price) * ask;
      if (money < cost) return okResp(`金钱不足：需要 ${cost}，现有 ${money}`);
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const exist = bag.find((x) => x.name === good.name);
      if (exist) exist.count += ask;
      else bag.push({ name: good.name, count: ask, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc });
      s.bagMeta = {
        ...(s.bagMeta || {}),
        [good.name]: { name: good.name, count: 0, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc },
      };
      patchCard(s, { items: serializeBag(bag, card.items), money: money - cost });
      // ★ 买东西也算「获得」（与 addBagItemToCard 同口径）——否则「去商城买齐材料」的
      //   采集类任务永远不计进度。
      noteQuestGather(s, good.name, ask);
      pushEvent(s, `购买 ${good.name}×${ask}，花费 ${cost} 金钱`);
      const me = playerEntity(s);
      if (me) floater(s, `-${cost} 金`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`购买 ${good.name}×${ask}`);
    }

    case "sys_item_add": {
      // ★ 事件系统（地图集 area_enter 脚本）的产出入包链。
      //   前端 eventEngine ctx.bag.give → App.vue evGiveItem → 本 case。
      //   与 sys_shop_buy 同款（扣费=0）：合并参数卡物品 → 写回 playerCard → persistSys。
      //   缺这个 case 时命令会掉进 default 静默返回，玩家采集产物直接蒸发。
      const addName = str(params?.name).trim().slice(0, 20);
      const addCount = Math.max(1, Math.round(num(params?.count, 1)));
      if (!addName) return okResp("sys_item_add: 缺少 name");
      // ★ 必须走 addBagItemToCard（内部含 noteQuestGather）。
      //   原先这里手写了一遍 mergeBag + patchCard，**绕过了采集进度钩子** →
      //   事件脚本（夜采药圃 / 木材堆 / 林中采药）的产出永远不给任务计数，
      //   Q02「夜合花×3」、Q11「木材×6」进度恒 0（2026-10-18 实测）。
      addBagItemToCard(s, addName, addCount);
      pushEvent(s, `获得 ${addName}×${addCount}`);
      const meAdd = playerEntity(s);
      if (meAdd) floater(s, `+${addName}`, meAdd.x, meAdd.y - 30);
      await persistSys(context, s);
      return okResp(`获得 ${addName}×${addCount}`);
    }

    case "ai_bag_add": {
      // ★ AI 托管角色的采集产出：写 entity._aiBag（角色私藏）。
      //   与 sys_item_add 分开的原因：s.items 是玩家参数卡派生的共享背包，
      //   AI 产出若走那条链会全部混进玩家腰包；而 sensor.ts 的 inventoryFull 判 _aiBag。
      const aiRoleId = str(params?.roleId || params?.entityId);
      const aiName = str(params?.name).trim().slice(0, 20);
      const aiCount = Math.max(1, Math.round(num(params?.count, 1)));
      if (!aiRoleId) return okResp("ai_bag_add: 缺少 roleId");
      if (!aiName) return okResp("ai_bag_add: 缺少 name");
      const aiEnt = s.entities.find((x: any) => x.id === aiRoleId);
      if (!aiEnt) return okResp(`ai_bag_add: 角色「${aiRoleId}」不在场`);
      const bagArr: Array<{ name: string; count: number }> = Array.isArray((aiEnt as any)._aiBag)
        ? (aiEnt as any)._aiBag
        : ((aiEnt as any)._aiBag = []);
      const slot = bagArr.find((x) => sameName(x.name, aiName));
      if (slot) slot.count += aiCount;
      else if (bagArr.length < AI_BAG_MAX_SLOTS) bagArr.push({ name: aiName, count: aiCount });
      else return okResp(`${aiEnt.name} 私藏已满（${AI_BAG_MAX_SLOTS} 格），${aiName} 未能收入`);
      pushEvent(s, `${aiEnt.name} 采集获得 ${aiName}×${aiCount}`);
      floater(s, `+${aiName}`, aiEnt.x, aiEnt.y - 30);
      // ★ 私藏随 entities 回推即持久，不走 persistSys（那是玩家角色卡专用）
      return okResp(`${aiEnt.name} 获得 ${aiName}×${aiCount}`);
    }

    case "ai_command": {
      // ★ AI 托管通道：前端 AI 决策系统 → sendTick → 改 state（每 tick 由 AI 重新决策覆盖，不需持久化）
      const rid = str(params?.roleId || params?.entityId);
      if (!rid) return okResp("ai_command: 缺少 roleId");
      const ent = s.entities.find((x: any) => x.id === rid);
      if (!ent) return okResp(`ai_command: 实体 ${rid} 不在场上`);
      const cmd = String(params?.action || params?.type || "");
      switch (cmd) {
        case "move": {
          const tx = Number(params?.x);
          const ty = Number(params?.y);
          if (!Number.isFinite(tx) || !Number.isFinite(ty)) return okResp("ai_command.move: 坐标无效");
          (ent as any)._aiMoveTo = { x: tx, y: ty };
          (ent as any)._aiMoveToTick = s.tick;
          return okResp(`AI 移动: ${ent.name} → (${tx.toFixed(1)}, ${ty.toFixed(1)})`);
        }
        case "attack": {
          const targetId = str(params?.targetId);
          if (!targetId) return okResp("ai_command.attack: 缺少 targetId");
          (ent as any)._aiAttackTarget = targetId;
          (ent as any)._aiAttackTick = s.tick;
          return okResp(`AI 攻击: ${ent.name} → ${targetId}`);
        }
        case "stop": {
          delete (ent as any)._aiMoveTo;
          delete (ent as any)._aiMoveToTick;
          delete (ent as any)._aiAttackTarget;
          delete (ent as any)._aiAttackTick;
          delete (ent as any)._aiManaged;
          return okResp(`AI 停止: ${ent.name}`);
        }
        case "_mark_managed": {
          (ent as any)._aiManaged = true;
          return okResp(`AI 托管标记: ${ent.name}`);
        }
        case "stopMove": {
          delete (ent as any)._aiMoveTo;
          delete (ent as any)._aiMoveToTick;
          return okResp(`AI 停止移动: ${ent.name}`);
        }
        case "gather": {
          const gx = Number(params?.x);
          const gy = Number(params?.y);
          const zoneName = str(params?.zoneName);
          if (!Number.isFinite(gx) || !Number.isFinite(gy)) return okResp("ai_command.gather: 坐标无效");
          (ent as any)._aiMoveTo = { x: gx, y: gy };
          (ent as any)._aiMoveToTick = s.tick;
          (ent as any)._aiGather = { zoneName, x: gx, y: gy, startedTick: s.tick, paid: false, reqId: str(params?.reqId) };
          return okResp(`AI 采集: ${ent.name} → ${zoneName || "(未知区域)"}`);
        }
        case "interact": {
          const itId = str(params?.targetId);
          if (!itId) return okResp("ai_command.interact: 缺少 targetId");
          const tgt = s.entities.find((x: any) => x.id === itId && x.alive);
          if (!tgt) return okResp(`ai_command.interact: 目标 ${itId} 不在场`);
          (ent as any)._aiInteract = { targetId: itId, startedTick: s.tick, done: false };
          (ent as any)._aiMoveTo = { x: tgt.x, y: tgt.y };
          (ent as any)._aiMoveToTick = s.tick;
          return okResp(`AI 交互: ${ent.name} → ${tgt.name}`);
        }
        case "useSkill": {
          s.axeMode = false; // ★ 斧头破坏模式：AI 释放技能即收起
          const skName = str(params?.skillName);
          if (!skName) return okResp("ai_command.useSkill: 缺少 skillName");
          const sk = (Array.isArray(s.skills) ? s.skills : []).find((k: any) => k && k.name === skName);
          if (!sk) return okResp(`ai_command.useSkill: 技能「${skName}」不可用`);
          if (num(sk.cdLeft, 0) > 0) return okResp(`ai_command.useSkill: ${skName} 冷却中`);
          const skCost = Math.max(0, Math.round(num(sk.cost, 0)));
          if (num((ent as any).mp, 0) < skCost) return okResp(`ai_command.useSkill: ${ent.name} 蓝量不足`);
          sk.cdLeft = Math.max(1, Math.round(num(sk.cd, 5)));
          (ent as any).mp = Math.max(0, num((ent as any).mp, 0) - skCost);
          (ent as any).actionBobMs = 300;
          floater(s, sk.name, ent.x, ent.y - 34);
          const skPower = Math.max(1, Math.round(num(sk.power, 0)) + Math.round(num((ent as any).atk, 10) * 0.5));
          const skTargets = s.entities.filter((e: any) => e.side === "enemy" && e.alive && dist(ent, e) <= SKILL_RANGE_M);
          const explicitId = str(params?.targetId);
          const ordered = explicitId
            ? [...skTargets].sort((a: any, b: any) => (a.id === explicitId ? -1 : b.id === explicitId ? 1 : 0))
            : skTargets;
          const skFx = sk.type === "heal" ? "heal" : sk.type === "buff" ? "buff" : sk.range === "ranged" ? "ranged" : "melee";
          if (skFx === "heal") {
            const healAmt = Math.max(Math.round(num(sk.power, 20)), skCost * 2);
            (ent as any).hp = Math.min(num((ent as any).maxHp, num((ent as any).hp, 0) + healAmt), num((ent as any).hp, 0) + healAmt);
            pushVfx(s, { kind: "heal_ring", entityId: ent.id, x: ent.x, y: ent.y, life: 18, total: 18, color: effectColor(sk.effects_type, "#7CFFB2"), icon: effectIcon(sk.effects_type), size: 1 });
            pushEvent(s, `${ent.name} 释放 ${sk.name}，恢复 ${healAmt}HP`);
            return okResp(`${sk.name}（治疗）`);
          }
          if (skFx === "buff") {
            (ent as any).buffs = Array.isArray((ent as any).buffs) ? (ent as any).buffs : [];
            if (!(ent as any).buffs.includes(sk.name)) (ent as any).buffs.push(sk.name);
            pushVfx(s, { kind: "buff_ring", entityId: ent.id, x: ent.x, y: ent.y, life: 30, total: 30, color: effectColor(sk.effects_type, "#9CCFFF"), icon: effectIcon(sk.effects_type), size: 1 });
            pushEvent(s, `${ent.name} 释放 ${sk.name}${sk.buff_type ? `（${sk.buff_type}）` : ""}`);
            return okResp(`${sk.name}（强化）`);
          }
          const skT0 = ordered[0];
          pushVfx(s, skFx === "ranged"
            ? { kind: "fireball", entityId: ent.id, targetEntityId: skT0 ? skT0.id : undefined, x: ent.x, y: ent.y, targetX: skT0 ? skT0.x : ent.x, targetY: skT0 ? skT0.y : ent.y, facing: num((ent as any).facing, 0), life: 16, total: 16, color: effectColor(sk.effects_type, "#ff6a00"), icon: effectIcon(sk.effects_type), size: 1 }
            : { kind: "slash_arc", entityId: ent.id, x: ent.x, y: ent.y, facing: num((ent as any).facing, 0), life: 12, total: 12, color: effectColor(sk.effects_type, "#fff"), icon: effectIcon(sk.effects_type), size: 1.6 });
          if (!ordered.length) {
            pushEvent(s, `${ent.name} 释放 ${sk.name}（空放）`);
            return okResp(`${sk.name}（空放）`);
          }
          const hitCount = Math.min(3, ordered.length);
          ordered.slice(0, 3).forEach((t: any) => damage(s, t, skPower, ent));
          pushEvent(s, `${ent.name} 释放 ${sk.name}，命中 ${hitCount} 个目标`);
          return okResp(`${sk.name}（命中 ${hitCount}）`);
        }
        case "useItem": {
          const itHeal = Math.max(0, Math.round(num(params?.heal, 0)));
          const itMp = Math.max(0, Math.round(num(params?.mp, 0)));
          const itName = str(params?.itemName, "物品");
          if (itHeal <= 0 && itMp <= 0) return okResp(`ai_command.useItem: ${itName} 无恢复效果`);
          const beforeHp = num((ent as any).hp, 0);
          const beforeMp = num((ent as any).mp, 0);
          if (itHeal > 0) (ent as any).hp = Math.min(num((ent as any).maxHp, beforeHp + itHeal), beforeHp + itHeal);
          if (itMp > 0) (ent as any).mp = Math.min(num((ent as any).maxMp, beforeMp + itMp), beforeMp + itMp);
          const gotHp = Math.round(num((ent as any).hp, 0) - beforeHp);
          const gotMp = Math.round(num((ent as any).mp, 0) - beforeMp);
          const gained = [];
          if (gotHp > 0) gained.push(`+${gotHp}HP`);
          if (gotMp > 0) gained.push(`+${gotMp}MP`);
          pushEvent(s, `${ent.name} 使用 ${itName}${gained.length ? " " + gained.join(" ") : ""}`);
          if (gotHp > 0) pushVfx(s, { kind: "heal_ring", entityId: ent.id, x: ent.x, y: ent.y, life: 18, total: 18, color: "#7CFFB2", size: 1 });
          return okResp(`${itName}${gained.length ? " " + gained.join(" ") : ""}`);
        }
        default:
          return okResp(`ai_command: 未知 action '${cmd}'`);
      }
    }

    case "sys_party": {
      // 组队跟随开关（敌对角色与用户自身不可组队）
      const rid = str(params?.roleId);
      if (!rid) return okResp("缺少角色");
      const summon = !!params?.summon;
      const flag = params?.follow;
      const follow = !(flag === false || flag === 0 || flag === "0" || flag === "false");
      let e = s.entities.find((x) => x.id === rid || x.name === rid);
      if (e && e.side === "enemy") return okResp("敌对角色无法组队");
      // ★ 组队/召唤：角色停在别的地图（s.parked）→ 先接回当前图
      if (!e && (follow || summon)) {
        const parkedObj: any = (s as any).parked || {};
        for (const k of Object.keys(parkedObj)) {
          const arr = Array.isArray(parkedObj[k]) ? parkedObj[k] : [];
          const idx = arr.findIndex((x: any) => String(x.id) === rid || String(x.name) === rid);
          if (idx >= 0) {
            e = arr.splice(idx, 1)[0];
            s.entities.push(e);
            break;
          }
        }
      }
      // ★ game.md 组队/召唤：角色还没上场（无实体）时，先按角色位置规则生成到可活动区域
      if (!e && (follow || summon)) {
        const role = (s.roles as any[] || []).find((r) => String(r?.id) === rid || String(r?.name) === rid);
        e = spawnRoleEntity(s, role) || undefined as any;
      }
      if (e && (follow || summon)) (e as any).mapName = s.levelName || (e as any).mapName;

      // ★ 召唤模式：只把角色传到玩家旁边并设为友方，不入队、不跟随
      if (summon) {
        if (e) {
          if (!(e as any)._baseSide) (e as any)._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
          // TP 到玩家身边（角度均分分布，避免多个 ally 扎堆）
          const me = playerEntity(s);
          if (me) {
            // 统计已存在的 ally 数量，用于角度均分（0-index）
            const allyCount = s.entities.filter((ee) => ee.side === "ally" && ee.id !== e.id).length;
            const ang = (allyCount / Math.max(1, allyCount + 1)) * Math.PI * 2 + rnd(0, Math.PI * 0.5);
            const dist = 2 + Math.random() * 2;
            const allyXBase =0;
            const allyYBase =0;
            // const p = clampToBound(s, me.x + Math.cos(ang) * dist, me.y + Math.sin(ang) * dist);
            const p = clampToBound(s, allyXBase + Math.cos(ang) * dist, allyYBase + Math.sin(ang) * dist);
            e.x = p.x;
            e.y = p.y;
            (e as any).homeX = e.x;
            (e as any).homeY = e.y;
          }
        }
        ensureNpcCards(s, s.levelName || "");
        pushEvent(s, `${e?.name || rid} 已召唤到你身边（不加入队伍）`);
        await persistSys(context, s);
        return okResp(`已召唤 ${e?.name || rid} 到身边`);
      }

      const set = new Set(s.partyIds || []);
      if (follow) set.add(rid); else set.delete(rid);
      s.partyIds = Array.from(set);
      if (e) {
        if (follow) {
          // 记住入队前的阵营（ally/neutral/spectator），退队时还原——中立 NPC 退队不能变成敌人样
          if (!(e as any)._baseSide) (e as any)._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
          // ★ AI 托管标记：前端通过 sys_party(aiManaged:true) 标记（AI 托管与组队跟随相互独立）
          if (params?.aiManaged) (e as any)._aiManaged = true;
        } else {
          // ★ 取消组队：保存角色当前位置到 parked，下次召唤/入队时可以恢复位置
          const mapName = (e as any).mapName || s.levelName || "";
          if (!s.parked) s.parked = {};
          if (!s.parked[mapName]) s.parked[mapName] = [];
          // 去重（同一角色只保留最新位置）
          (s.parked[mapName] as any[]) = (s.parked[mapName] as any[]).filter((x) => String(x.id) !== String(e.id));
          (s.parked[mapName] as any[]).push({ id: e.id, name: e.name, x: e.x, y: e.y, mapName });
          e.side = (e as any)._baseSide || "spectator";
          // ★ 取消组队：同步清理 AI 托管标记，避免 entry.ts 重编译后残留 _aiManaged 仍被主循环接管
          delete (e as any)._aiManaged;
          delete (e as any)._aiMoveTo;
          delete (e as any)._aiMoveToTick;
          delete (e as any)._aiAttackTarget;
          delete (e as any)._aiAttackTick;
          // ★ 清零速度：取消组队后 tick 还会按残留 vx/vy 继续位移，必须归零才能就地停留
          e.vx = 0; e.vy = 0;
          (e as any).wanderTimer = 0;
        }
      }
      ensureNpcCards(s, s.levelName || "");
      pushEvent(s, `${e?.name || rid} ${follow ? "加入队伍，开始跟随你战斗" : "已脱离队伍"}`);
      await persistSys(context, s);
      return okResp(follow ? "已组队跟随" : "已取消跟随");
    }

    case "sys_teleport": {
      // 传送到角色身边：把目标地图/坐标交给前端（前端负责切图与落点）
      const rid = str(params?.roleId);
      ensureNpcCards(s, s.levelName || "");
      let c = (s.npcCards || []).find((x) => x.id === rid || x.name === rid);
      if (!c) return okResp("角色不存在");
      // ★ game.md 角色位置问题：没有位置信息的角色，默认生成到可活动区域再传送
      if (!(c as any).onMap) {
        const role = ((s.roles as any[]) || []).find((r) => String(r?.id) === String(c!.id) || String(r?.name) === String(c!.name));
        const e = spawnRoleEntity(s, role);
        if (e) {
          ensureNpcCards(s, s.levelName || "");
          c = (s.npcCards || []).find((x) => x.id === String(c!.id)) || c;
          pushEvent(s, `${c!.name} 已生成到可活动区域`);
        }
      }
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      s.teleportTarget = {
        mapName: c.mapName || s.levelName || "",
        x: c.x,
        y: c.y,
        name: c.name,
        rev: s.sysRevision,
      };
      pushEvent(s, `传送到 ${c.name} 身边（${c.mapName || "当前地图"}）`);
      await persistSys(context, s);
      return okResp(`已传送到 ${c.name} 身边`);
    }

    case "sys_travel": {
      // 大地图传送：目标关卡交给前端 switchLevel
      const target = str(params?.mapName);
      if (!target) return okResp("缺少目标地图");
      s.levelName = target;
      // ★ fix：_levelAt 必须设为 target（不是 ""），否则下一 tick 的 levelName guard
      //   会因为 !ackLv=true 把前端旧 levelName 写回 state，覆盖掉 target，
      //   导致 handleLevelChange 用错误地图触发，entities 全部从 entities[] 消失。
      (s as any)._levelAt = target;
      // ★ 标记"传送中"：前端切图完成前会上报旧地图名，tick guard 据此忽略旧值，
      //   直到前端上报 target 才解除（走路穿传送门的前端自主切图不走此标记）
      (s as any)._travelPending = true;
      handleLevelChange(s, false);
      ensureNpcCards(s, target);
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      // ★ 落点：优先用目标地图 Tiled SPAWN_POINT/PLAYER（编辑器可配），否则 (0,0)
      const ts2 = (context && (context as any).tiledSpawn) || null;
      const useSpawn = ts2 && ts2.mapName === target && Number.isFinite(ts2.x) && Number.isFinite(ts2.y);
      // ★ 大地图传送统一走 teleportTarget 通道（前端只 watch 它；travelTarget 从无人消费，是死代码）
      (s as any).teleportTarget = {
        mapName: target,
        x: useSpawn ? ts2.x : 0,
        y: useSpawn ? ts2.y : 0,
        name: target,
        rev: s.sysRevision,
      };
      pushEvent(s, `传送至「${target}」`);
      await persistSys(context, s);
      return okResp(`已传送至「${target}」`);
    }

    case "sys_chat": {
      // ★ game.md 对话功能：调用角色发言器 agent（task-speaker-agent）
      // mode="options" → 返回 AI 生成的3个发言选项（不显示角色台词）
      // mode="response" → 返回角色台词，用户选了选项或发了自定义消息后调用
      const npcId = str(params?.npcId, "");
      const npcName = str(params?.npcName, "???");
      const userText = params?.userText as string | null | undefined;
      const lastResp = str(params?.lastResp, "");
      const mode = str(params?.mode, "response");
      /** ★ 前端生成的请求 id：结果写进 state.chatResult，前端按它配对取回（HTTP 回包会被 tick 覆盖） */
      const reqId = str(params?.reqId, "");
      if (!npcId) return okResp("缺少角色标识");
      // ★ 任务板：对话类任务进度（uid 取 mapnpc_<uid>_<ts> 的第 2 段，与事件系统同口径）
      noteQuestTalk(s, String(npcId).split("_")[1] || "", npcName);

      // 查找角色
      const npcEntity = s.entities.find((e) => e.id === npcId);
      // ★ 用 string 化：Entity.side 的联合类型不含 "neutral"（地图 NPC 是运行时扩展阵营），
      //   直接比较会触发 TS2367（与既有基线同类），转 string 避免新增类型错误。
      const npcSide = String(npcEntity?.side || "");
      const roleEntry = ((s.roles as any[]) || []).find(
        (r) => String(r?.id) === npcId || String(r?.name) === npcId,
      );
      const entityName = String((npcEntity as any)?.name || "").trim();
      /** ★ 身份判定：有角色卡 / 有实体名 / 调用方传了真名 → 都以自己的身份说话。
       *   只有「既无卡又无名的中立实体」才算旁白 —— 城镇地图 NPC（side=neutral）不是旁白！ */
      const hasIdentity =
        !!roleEntry?.name ||
        (entityName !== "" && entityName !== "NPC") ||
        (npcName !== "" && npcName !== "???" && npcName !== "NPC");
      const isNeutral = npcSide === "neutral" && !hasIdentity;
      const roleName = isNeutral
        ? "旁白"
        : str(roleEntry?.name || entityName || npcName, npcName);
      /** ★ 角色卡：故事角色用动态卡；地图 NPC 用实体信息现拼（让 agent 知道它是谁、在哪） */
      const npcCard = isNeutral
        ? null
        : (roleEntry || {
            id: npcId,
            name: roleName,
            roleType: npcSide === "ally" ? "ally" : "npc",
            description: String((npcEntity as any)?.desc || (npcEntity as any)?.dialog || ""),
            level: (npcEntity as any)?.level ?? 1,
            entity_type: (npcEntity as any)?.entity_type,
            gid: (npcEntity as any)?.gid,
            mapName: s.levelName || "",
            x: (npcEntity as any)?.x,
            y: (npcEntity as any)?.y,
          });

      // 调用角色发言器 agent
      try {
        if (context?.tsApi?.agent) {
          const result = await context.tsApi.agent.run("task-speaker-agent", {
            npcId,
            npcName: roleName,
            npcCard,
            isNeutral,
            userText: userText ?? null,
            lastResp: lastResp || null,
            mode,
            context: {
              storyDigest: context?.sessionId ? `session:${context.sessionId}` : "",
              playerLevel: (s.entities.find((e) => e.side === "player")?.level) ?? 1,
            },
          });
          if (result?.ok && result?.output?.text) {
            // ★ 模型常把内容包进 ```json 代码围栏 → 先剥围栏再解析/展示
            const raw = String(result.output.text)
              .replace(/^\s*```[a-zA-Z]*\s*/, "")
              .replace(/\s*```\s*$/, "")
              .trim();
            // mode=options → 解析3个选项返回（agent 应返回 JSON array 或逗号分隔的3行）
            if (mode === "options") {
              let options: string[] = [];
              try {
                // 尝试 JSON array
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) options = parsed.slice(0, 3);
              } catch {
                // 尝试每行一个选项（去掉编号前缀如 "1. " / "① " 等）
                options = raw.split(/\n/).map((l: string) => l.replace(/^[0-9a-zA-Z一二三四五六七七八九十]+[.、)）]+/, "").trim()).filter(Boolean).slice(0, 3);
              }
              if (options.length === 0) throw new Error("agent 未返回有效选项");
              // ★ 写回 state：前端 watch state.chatResult 按 reqId 取回
              s.chatResult = { reqId, ok: true, mode, speaker: roleName, options };
              await persistSys(context, s);
              return okResp(JSON.stringify({ options }));
            }
            // mode=response → 返回角色台词
            s.chatResult = { reqId, ok: true, mode, speaker: roleName, text: raw };
            pushEvent(s, `${roleName}：${raw}`);
            await persistSys(context, s);
            return okResp(JSON.stringify({ speaker: roleName, text: raw, avatar: roleEntry?.avatarPath ?? undefined }));
          }
          if (result?.error) {
            console.warn("[field-survival] sys_chat agent error:", result.error);
            // ★ 失败也要回包，否则前端一直 pending
            s.chatResult = { reqId, ok: false, mode, error: String(result.error) };
            await persistSys(context, s);
            return okResp(JSON.stringify({ error: String(result.error), mode, npcName: roleName }));
          }
        }
      } catch (e) {
        console.warn("[field-survival] sys_chat agent call failed:", e);
        const msg = String((e as any)?.message || e || "角色发言器调用异常");
        s.chatResult = { reqId, ok: false, mode, error: msg };
        await persistSys(context, s);
        return okResp(JSON.stringify({ error: msg, mode, npcName: roleName }));
      }

      // ★ 角色发言器 agent 不可用时 → 直接报错，不兜底
      const errMsg = `角色发言器 agent 未配置或调用失败（${mode}）`;
      s.chatResult = { reqId, ok: false, mode, error: errMsg };
      await persistSys(context, s);
      return okResp(JSON.stringify({
        error: errMsg,
        fallback: false,
        mode,
        npcName: roleName,
      }));
    }

    case "sys_brain": {
      // ★ AI 托管大脑（v6）：把前端拼好的实时感知交给 LLM，结果写回 s.chatResult
      //   按 reqId 配对（前端 notifyBrainResult 只认 brain_ 前缀的 reqId）。
      //
      //   prompt 分工：systemPrompt 直接用插件常量 PROMPT_FIELD_SURVIVAL_AI_BRAIN
      //   （entry.ts 顶部已 import，esbuild 会内联），不让前端每拍传 ~1200 token 的长串；
      //   动态感知（角色设定 + 当前情况）由前端 brain.ts 拼成 userPrompt 传入。
      //
      //   通道复用 sys_chat 的成熟范式：ctx.tsApi.agent.run → PluginAgentRunner
      //   （内部按 input.systemPrompt 拼 messages 调 u.ai.text.invoke，15s 超时）。
      const reqId = str(params?.reqId, "");
      const entityName = str(params?.entityName, "???");
      const userPrompt = str(params?.userPrompt, "");
      // ★ 异常也必须写回包，否则前端 brainResultWaiters 会一直 pending 到超时
      const fail = (err: string) => {
        s.chatResult = { reqId, ok: false, error: err };
        persistSys(context, s);
        return okResp(JSON.stringify({ error: err }));
      };
      if (!reqId) return fail("缺少 reqId");
      if (!userPrompt.trim()) return fail("缺少 userPrompt（前端未提供实时感知）");
      try {
        if (!context?.tsApi?.agent) return fail("tsApi.agent 不可用");
        const result = await context.tsApi.agent.run("field-survival-ai-brain", {
          entityName,
          systemPrompt: PROMPT_FIELD_SURVIVAL_AI_BRAIN,
          userPrompt,
        });
        // 模型常把内容包进 ```json 围栏 → 先剥围栏（brain.ts 的正则已能容忍，这里再兜一层）
        const raw = result?.ok && result?.output?.text
          ? String(result.output.text)
              .replace(/^\s*```[a-zA-Z]*\s*/, "")
              .replace(/\s*```\s*$/, "")
              .trim()
          : "";
        if (!raw) return fail(String(result?.error || "LLM 返回空"));
        s.chatResult = { reqId, ok: true, text: raw };
        persistSys(context, s);
        return okResp("brain ok");
      } catch (e) {
        console.warn("[field-survival] sys_brain agent call failed:", e);
        return fail(String((e as any)?.message || e || "brain agent 调用异常"));
      }
    }

    case "page": {
      const kind = str(params?.kind, "skill");
      const delta = Math.round(num(params?.delta, 1));
      // ★ 翻页：4 格一页，最后一页再点回到第一页（前后端同一条规则）
      if (kind === "item") {
        const pages = Math.max(1, Math.ceil((s.items || []).length / QUICKBAR_PAGE_SIZE));
        s.itemPage = (((Math.round(num(s.itemPage, 0)) + delta) % pages) + pages) % pages;
      } else {
        const pages = Math.max(1, Math.ceil((s.skills || []).length / QUICKBAR_PAGE_SIZE));
        s.skillPage = (((Math.round(num(s.skillPage, 0)) + delta) % pages) + pages) % pages;
      }
      clampQuickbarPages(s);
      return okResp("");
    }

    case "revive": {
      // ★ 死亡弹窗「复活」：原地复活 —— 玩家坐标保持死亡处不变，
      //   血量恢复满、alive 复位、冷却与速度清零，phase 回到 playing 继续可玩。
      const player = s.entities.find((e) => e.side === "player");
      if (!player) return okResp("");
      // 仅死亡/结算态可复活；仍在战斗中且存活时忽略（避免当作回血道具滥用）
      if (s.phase === "playing" && player.alive) return okResp("");
      player.alive = true;
      player.hp = player.maxHp;
      player.vx = 0;
      player.vy = 0;
      // 复活保护：给场上存活敌人一段攻击冷却（2 秒），避免复活瞬间被贴脸秒杀
      s.entities.forEach((e) => {
        if (e.side === "enemy" && e.alive) e.cooldown = Math.max(e.cooldown || 0, 20);
      });
      s.result = null;
      s.phase = "playing";
      pushEvent(s, `你在原地复活（生命 ${Math.round(player.hp)}/${Math.round(player.maxHp)}）`);
      return { code: 0, message: "revive", state: s, response: "复活成功" };
    }

    case "exit":
    case "quit": {
      if (s.phase !== "playing") return okResp("");
      s.phase = "over";
      s.result = {
        reason: "exit",
        exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick,
      };
      pushEvent(s, "你主动结束了本次野外生存。");
      return { code: 0, message: "exit", state: s, response: "野外生存结束" };
    }

    case "sys_agent_run": {
      // ★ 通用 AI agent 调用通道（事件系统 ctx.ai.generate 用）
      //   独立于 chatResult 单槽位 → state.agentResult{reqId,...}，
      //   避免「锻造生成」与「角色对话」互相覆盖。
      const aReqId = str(params?.reqId, "");
      const aAgent = str(params?.agentName, "");
      const aPrompt = str(params?.prompt, "");
      const aFail = (err: string) => {
        s.agentResult = { reqId: aReqId, ok: false, error: err };
        persistSys(context, s);
        return okResp(JSON.stringify({ error: err }));
      };
      if (!aReqId) return aFail("缺少 reqId");
      if (!aAgent) return aFail("缺少 agentName");
      if (!aPrompt.trim()) return aFail("缺少 prompt");
      if (!context?.tsApi?.agent?.run) return aFail("tsApi.agent 不可用（宿主未接入 AI）");
      try {
        const aTimeout = Math.max(3000, Math.round(num(params?.timeoutMs, 20000)));
        // systemPrompt：前端传了就用前端传的；没传则按 agent 名从插件常量表取
        const aSystem = str(params?.systemPrompt, "") || getAgentSystemPrompt(aAgent);
        const r: any = await withTimeout(
          context.tsApi.agent.run(aAgent, { prompt: aPrompt, systemPrompt: aSystem }),
          aTimeout,
          "agent timeout",
        );
        const text = String(r?.output?.text ?? r?.text ?? r?.output ?? "");
        if (!text.trim()) {
          s.agentResult = { reqId: aReqId, ok: false, error: "agent 返回空内容" };
        } else {
          s.agentResult = { reqId: aReqId, ok: true, text };
        }
      } catch (e: any) {
        s.agentResult = { reqId: aReqId, ok: false, error: String(e?.message || e) };
      }
      await persistSys(context, s);
      return okResp("agent 调用完成");
    }

    case "sys_bag_list": {
      // ★ 事件系统读背包（升级/溶解时选目标）
      const list = listPlayerBag(s);
      return okResp(JSON.stringify(list));
    }

    case "sys_dummy_reward": {
      // ★ 练习假人（模拟实战）击碎奖励：加经验（设计文档：模拟实战模式击碎才有经验）
      const drExp = Math.max(0, Math.round(num(params?.exp, 0)));
      const drName = str(params?.name, "练习假人");
      if (drExp > 0) {
        const me = playerEntity(s);
        gainPlayerExp(s, drExp);
        if (me) floater(s, `+${drExp} 经验`, me.x, me.y - 30);
        pushEvent(s, `击碎 ${drName}，获得 ${drExp} 经验`);
        await persistSys(context, s);
      }
      return okResp(drExp > 0 ? `+${drExp} 经验` : "");
    }

    case "sys_bag_remove": {
      // ★ 事件系统移除背包物品（溶解/升级替换）
      const rmName = str(params?.name, "").trim().slice(0, 20);
      const rmCount = Math.max(1, Math.round(num(params?.count, 1)));
      if (!rmName) return okResp("缺少 name");
      const okRemove = removeFromPlayerBag(s, rmName, rmCount);
      if (okRemove) {
        pushEvent(s, `失去 ${rmName}×${rmCount}`);
        await persistSys(context, s);
      }
      return okResp(okRemove ? `已移除 ${rmName}×${rmCount}` : "物品不存在");
    }

    case "sys_forge_create": {
      // ★ 锻造大师打造：优先用 AI 生成（params.aiJson），失败回退随机算法
      const fCard = (s.playerCard || {}) as Record<string, any>;
      const fMoney = Math.round(num(fCard.money, 0));
      if (fMoney < 10) return okResp("金钱不足：打造需要 10 金钱");
      const fInput = str(params?.input, "");
      const fLevel = Math.round(num(fCard.level, 1));
      // AI 结果（前端 ctx.ai.generate 拿到后回传）；没有则走随机兜底
      const fRaw = extractJsonObject(str(params?.aiJson, ""));
      const fFallback = rollForgeItem(fInput, fLevel);
      const fItem = fRaw ? normalizeGeneratedItem(fRaw, fFallback) : { ...fFallback, atk: 0, def: 0, durability: 0 };
      // ★ 图纸：使用后消耗 1 张，且产物绝不能是图纸本身
      //   （老逻辑把图纸名当 input 喂 AI → 产出「铁剑图纸」，图纸还留包里越打越多）
      const fBlueprint = str(params?.blueprint, "").trim().slice(0, 20);
      if (looksLikeBlueprintName(fItem.name)) {
        fItem.name = blueprintProductName(fItem.name) || blueprintProductName(fBlueprint) || "无名器物";
      }
      patchCard(s, { money: fMoney - 10 });
      addBagItemToCard(s, fItem.name, 1);
      if (fBlueprint) removeFromPlayerBag(s, fBlueprint, 1);
      pushEvent(s, `锻造获得 ${fItem.name}（${fItem.rarity}）${fBlueprint ? `，消耗图纸「${fBlueprint}」` : ""}`);
      await persistSys(context, s);
      return okResp(`锻造完成！获得「${fItem.name}」`);
    }

    case "sys_alchemy_create": {
      // ★ 炼丹炉炼制：优先用 AI 生成（params.aiJson），失败回退随机算法
      const aCard = (s.playerCard || {}) as Record<string, any>;
      const aMoney = Math.round(num(aCard.money, 0));
      if (aMoney < 10) return okResp("金钱不足：炼丹需要 10 金钱");
      const aInput = str(params?.input, "");
      const aLevel = Math.round(num(aCard.level, 1));
      const aRaw = extractJsonObject(str(params?.aiJson, ""));
      const aFallback = rollAlchemyPill(aInput, aLevel);
      const aPill = aRaw ? normalizeGeneratedItem(aRaw, aFallback) : { ...aFallback, atk: 0, def: 0, durability: 0 };
      // ★ 药方：使用后消耗 1 张，产物绝不能是药方本身
      const aBlueprint = str(params?.blueprint, "").trim().slice(0, 20);
      if (looksLikeBlueprintName(aPill.name)) {
        aPill.name = blueprintProductName(aPill.name) || blueprintProductName(aBlueprint) || "无名丹药";
      }
      patchCard(s, { money: aMoney - 10 });
      addBagItemToCard(s, aPill.name, 1);
      if (aBlueprint) removeFromPlayerBag(s, aBlueprint, 1);
      pushEvent(s, `炼丹获得 ${aPill.name}（${aPill.rarity}）${aBlueprint ? `，消耗药方「${aBlueprint}」` : ""}`);
      await persistSys(context, s);
      return okResp(`炼丹完成！获得「${aPill.name}」`);
    }

    case "sys_item_upgrade": {
      // ★ 装备升级：移除旧装备 → 加入升级后的新装备
      const uCard = (s.playerCard || {}) as Record<string, any>;
      const uMoney = Math.round(num(uCard.money, 0));
      const uCost = Math.max(1, Math.round(num(params?.cost, 20)));
      if (uMoney < uCost) return okResp(`金钱不足：升级需要 ${uCost}，现有 ${uMoney}`);
      const oldName = str(params?.oldName, "").trim().slice(0, 20);
      if (!oldName) return okResp("缺少 oldName");
      const uRaw = extractJsonObject(str(params?.aiJson, ""));
      if (!uRaw) return okResp("AI 未返回有效升级数据");
      const uFallback = rollForgeItem(oldName, Math.round(num(uCard.level, 1)));
      const uItem = normalizeGeneratedItem(uRaw, uFallback);
      // 移除旧装备
      if (!removeFromPlayerBag(s, oldName, 1)) return okResp(`原装备「${oldName}」不在背包中`);
      patchCard(s, { money: uMoney - uCost });
      addBagItemToCard(s, uItem.name, 1);
      pushEvent(s, `升级装备：${oldName} → ${uItem.name}`);
      await persistSys(context, s);
      return okResp(`升级完成！「${uItem.name}」`);
    }

    case "sys_item_dissolve": {
      // ★ 溶解物品：移除物品 → 按品质算法返还材料
      const dName = str(params?.name, "").trim().slice(0, 20);
      if (!dName) return okResp("缺少 name");
      const dRarity = str(params?.rarity, "common");
      const dLv = Math.max(1, Math.round(num(params?.lv, 1)));
      const dHeal = Math.round(num(params?.heal, 0));
      const dIsPill = params?.isPill === true;
      if (!removeFromPlayerBag(s, dName, 1)) return okResp(`「${dName}」不在背包中`);
      const returns = dIsPill
        ? (() => { const r = calcPillDissolveReturns(dHeal); return { 草药: r.herb, 灵芝: r.lingzhi }; })()
        : (() => { const r = calcDissolveReturns(dRarity, dLv); return { 铁矿石: r.ore, 灵石碎屑: r.stone }; })();
      const giveText: string[] = [];
      for (const [k, v] of Object.entries(returns)) {
        const n = Math.round(num(v, 0));
        if (n > 0) { addBagItemToCard(s, k, n); giveText.push(`${k}×${n}`); }
      }
      pushEvent(s, `溶解 ${dName} → ${giveText.join("、") || "无返还"}`);
      await persistSys(context, s);
      return okResp(`溶解完成，获得 ${giveText.join("、") || "无返还"}`);
    }

    default:
      // ★ 防御：用户聊天消息触发 handle_action 时，若仍处于选人阶段则提示用户先选人开始
      if (s.phase === "select") {
        return { code: 0, message: "select_phase", state: s,
                 response: "请先在左侧面板选择角色并点击「开始」来启动野外生存。" };
      }
      return okResp("");
  }
}
