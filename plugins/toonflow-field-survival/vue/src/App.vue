<script setup lang="ts">
/**
 * 野外生存 —— 2.5D 动作生存（全屏）
 *
 * 阶段：select（选人）→ playing（全屏战斗）→ over（结算）
 * 实时推进通过宿主代发 /plugin/tick（见 bridge.sendTick）。
 *
 * 世界数据模型（与 25d_ai_game / map_config.json 一致）：
 *   - 整个游戏地图 3000×3000 米，origin (0,0)，X/Z 范围 ±1500
 *   - 单个土块 0.5 米；一个 chunk = 32 块 = 16 米
 *   - 默认 zoom = 20，相机看到 ±15 米（30×30 米窗口）
 *   - zoom ∈ [10, 30]：zoom 越大 → 视野越小（放大看脚下）
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { onHostState, sendToHost, sendTick, notifyLoaded, sendChat } from "./bridge";
import { toonflowJsApi } from "./toonflowJsApi";
import type { GameState, Entity, RoleOption, MapData } from "./types";
import DebugPanel from "./DebugPanel.vue";
import SystemPanel from "./SystemPanel.vue";
import {
  TILESET_URL, TILESET_COLS, TILE_SIZE, tileSrcRect, assetUrl, mobKeyFor,
  TILE_WATER_ID, TILE_POTION_ID,
  TILE_TREE_ID, TILE_DEADTREE_ID, TILE_CHEST_ID, TILE_CHEST_OPEN_ID,
  TILE_SHRUB_ID, TILE_MUSHROOM_ID, TILE_FLOWER_ID,
  TILE_GRASS_MAIN_ID,
  TILE_DIRT_MAIN_ID,
  TILE_HOUSE_ROOF_LEFT_ID, TILE_HOUSE_ROOF_MID_ID, TILE_HOUSE_ROOF_RIGHT_ID,
  TILE_HOUSE_TOP_LEFT_ID, TILE_HOUSE_TOP_MID_ID, TILE_HOUSE_TOP_RIGHT_ID,
  TILE_HOUSE_BOTTOM_ID, TILE_HOUSE_DOOR_ID, TILE_HOUSE_WINDOW_ID, TILE_HOUSE_WINDOW_RIGHT_ID,
  TILE_DIALOG_BUBBLE_ID, TILE_FENCE_POST_ID, TILE_FENCE_RAIL_ID,
  TILE_FARM_DIRT_ID, TILE_FARM_GREEN_ID, TILE_FARM_TOP_ID,
  GROUND_CELL_M, GROUND_BIOME_SCALE_M, GROUND_TONE_SCALE_M,
  GROUND_SAND_MAX, GROUND_DIRT_MAX, GROUND_TONE_SPLIT,
  GROUND_GRASS_TILES, GROUND_DIRT_TILES, GROUND_SAND_TILES,
  MOB_TILES, IMG_PLAYER, IMG_ALLY, IMG_ENEMY_CHAR,
  spriteTileId, resolveAssetPath,
} from "./assets";
import {
  TerrainScaleConfig, DEFAULT_SCALE,
} from "./terrainScale";
import { ChunkTerrainSystem } from "./chunkTerrain";
import { loadMapConfig, loadLevelByName, loadStartLevelName, DEFAULT_START_LEVEL, makeScaleFromMap, getTiledRaw, MOB_ARCHETYPES, ENTITY_TYPE_ZH, ENTITY_SPRITE_KEY, normalizeTiledMap, listLevelNames } from "./mapConfig";
import { bakeTiledMap } from "./mapBake";
import type { MapConfig } from "./mapConfig";
// ★ 网格碰撞（对齐 Rotten-Soup 的 Tile.blocked()）：从 tileset 的 blocked 属性建可行走网格
import {
  loadTileFlags,
  buildWalkGridAsync,
  buildWalkIndex,
  pickSpawn,
  resolveMove as resolveGridMove,
  gridStats,
  // ★ 点击寻路（A*）
  findPath,
  // ★ 敌人碰撞（局部避障：撞墙沿墙绕行，而不是原地抖）
  stepWithAvoidance,
  snapEnemySpawn,
  // ★ 战争迷雾（FOV）
  computeFov,
  // ★ 把网格传给宿主（敌人碰撞用）
  encodeWalkGridPacket,
  // ★ game.md 床碰撞：靠近床触发睡眠按钮
  isNearBed,
  // 调试用：网格 → ASCII
  metersToCell,
  type WalkGrid,
  type WalkIndex,
  type TileFlagTable,
} from "./collision";

const state = ref<GameState | null>(null);
const ready = ref(false);

/**
 * Debug 模式：
 *   - npm run dev  → 默认开启（Vite 启动时 import.meta.env.DEV = true）
 *   - npm run debug→ 强制开启（mode=debug）
 *   - npm run build→ 关闭（import.meta.env.PROD = true）
 *   也可通过 URL ?debug=0 强制关闭
 */
const debugMode = ref(
  (import.meta.env.DEV || import.meta.env.MODE === "debug") &&
  new URLSearchParams(location.search).get("debug") !== "0",
);

/* ----------------- 系统按钮（与 DebugPanel 拖拽一致） ----------------- */
const showSystemPanel = ref(false);
const sysBtnPos = ref({ x: 16, y: 16 });
const sysPanelPos = ref({ x: 70, y: 16 });
const SYS_DRAG_THRESHOLD = 6;
let sysDragStart: { x: number; y: number; px: number; py: number } | null = null;
let sysDragMoved = false;
let sysDragTarget: "btn" | "panel" | null = null;

function onSysBtnDragStart(e: PointerEvent) {
  sysDragStart = { x: e.clientX, y: e.clientY, px: sysBtnPos.value.x, py: sysBtnPos.value.y };
  sysDragMoved = false;
  sysDragTarget = "btn";
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener("pointermove", onSysDragMove);
  window.addEventListener("pointerup", onSysDragEnd);
}

function onSysPanelDragStart(e: PointerEvent) {
  // 仅在面板头部按下时允许拖动（@pointerdown 头部）
  sysDragStart = { x: e.clientX, y: e.clientY, px: sysPanelPos.value.x, py: sysPanelPos.value.y };
  sysDragMoved = false;
  sysDragTarget = "panel";
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener("pointermove", onSysDragMove);
  window.addEventListener("pointerup", onSysDragEnd);
}

function onSysDragMove(e: PointerEvent) {
  if (!sysDragStart || !sysDragTarget) return;
  const dx = e.clientX - sysDragStart.x;
  const dy = e.clientY - sysDragStart.y;
  if (!sysDragMoved && Math.hypot(dx, dy) > SYS_DRAG_THRESHOLD) sysDragMoved = true;
  if (!sysDragMoved) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (sysDragTarget === "btn") {
    sysBtnPos.value.x = Math.max(0, Math.min(W - 44, sysDragStart.px + dx));
    sysBtnPos.value.y = Math.max(0, Math.min(H - 44, sysDragStart.py + dy));
  } else {
    sysPanelPos.value.x = Math.max(0, Math.min(W - 420, sysDragStart.px + dx));
    sysPanelPos.value.y = Math.max(0, Math.min(H - 560, sysDragStart.py + dy));
  }
}

function onSysDragEnd() {
  sysDragStart = null;
  sysDragTarget = null;
  window.removeEventListener("pointermove", onSysDragMove);
  window.removeEventListener("pointerup", onSysDragEnd);
}

function onSysBtnClick(e: MouseEvent) {
  if (sysDragMoved) {
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  showSystemPanel.value = !showSystemPanel.value;
}

/* ----------------- 系统面板数据（v6：全部来自插件 state / 参数卡） ----------------- */
interface SysItem {
  id?: string; name: string; count: number; kind: string; rarity: string; heal: number; price: number; desc?: string;
  /** ★ game.md 物品修改：战斗参数（合并自 itemMeta / 按名推断） */
  power?: number; cost?: number; cd?: number; cdLeft?: number;
  type?: string; range?: string; lv?: number; buff_type?: string;
  durability?: number; durabilityLeft?: number; attribute_type?: string; attribute_value?: number;
  /** ★ game.md：数量与描述（描述保留参数卡原注记全文） */
  quantity?: number; description?: string;
  index?: number;
}
interface SysSkill { id?: string; name: string; power: number; cost: number; cd: number; cdLeft: number; index: number; type?: string; range?: string; lv?: number; buff_type?: string; }
interface SysRole { id: string; name: string; side: string; enemy: boolean; level: number; hp: number; maxHp: number; exp: number; alive: boolean; mapName: string; x: number; y: number; inParty: boolean; avatarPath?: string; parameterCardJson?: any; onMap?: boolean; roleType?: string; }
interface SysGood { id: string; name: string; price: number; kind: string; rarity: string; heal: number; desc?: string; from?: string; }

const RARITY_DEFAULT_PRICE: Record<string, number> = { common: 8, fine: 22, rare: 60, epic: 180, legend: 520 };
/** 面板底部提示（由插件 response 或本地动作文案驱动） */
const sysNotice = ref("");

/** ★ HUD 级醒目提示（睡眠恢复等）：系统面板没打开时也要看得见 */
const hudToast = ref("");
let toastTimer = 0;
function showToast(msg: string, ms = 4200): void {
  if (!msg) return;
  hudToast.value = msg;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { hudToast.value = ""; }, ms);
}

/** 插件下发的用户参数卡（宿主每 tick 注入 ctx.playerCard → state.playerCard） */
const sysCard = computed<Record<string, any>>(() => ((state.value as any)?.playerCard || {}) as Record<string, any>);
const sysGold = computed(() => Math.round(Number(sysCard.value?.money ?? 0)));

function guessKindLocal(name: string): string {
  const n = String(name || "");
  if (/技能|秘籍|心得|卷轴|心法|功法/.test(n)) return "skill_book";
  if (/剑|刀|枪|弓|甲|盾|护符|戒指|铠|斧|杖|靴|袍/.test(n)) return "equipment";
  if (/丹|散|药|水|包|粮|汤|肉|鱼|果|酒|茶|露/.test(n)) return "consumable";
  return "material";
}

function defaultHealLocal(name: string, kind: string): number {
  if (kind !== "consumable") return 0;
  const n = String(name || "");
  if (/急救|大补|灵药|仙丹|回天/.test(n)) return 60;
  if (/回气|伤药|灵泉|清心|愈合/.test(n)) return 30;
  if (/干粮|粮|肉|果|汤|鱼/.test(n)) return 14;
  return 20;
}

/** ★ game.md：按名/品类推断物品默认 type/range（与 entry inferItemType 同口径） */
function inferItemTypeLocal(name: string, kind: string): { type: string; range: string } {
  const n = String(name || "");
  if (kind === "skill_book") return { type: "buff", range: "melee" };
  if (kind === "equipment" || /刀|剑|枪|弓|弩|斧|杖|匕|爪|锤/.test(n)) return { type: "atk", range: /弓|弩|杖/.test(n) ? "ranged" : "melee" };
  if (/力量|攻击|加攻/.test(n)) return { type: "attribute", range: "melee" };
  return { type: "heal", range: "melee" };
}
/** ★ game.md：按名推断被动属性类型（与 entry inferItemAttrType 同口径） */
function inferItemAttrLocal(name: string): string {
  const n = String(name || "");
  if (/防御|护甲|加防|体魄|磐/.test(n)) return "Defense";
  if (/蓝|法力|灵力|魔力/.test(n)) return "Blue";
  if (/生命|血量|体质/.test(n)) return "Life";
  if (/力量|攻击|加攻/.test(n)) return "Attack";
  return "";
}

/** 解析参数卡里的字符串物品："银鲤×3" / "短刀（商城购入，8 金）" */
function parseItemStringLocal(raw: string): { name: string; count: number; price: number; desc: string } {
  const s = String(raw).trim();
  const pm = s.match(/[（(][^）)]*?(\d+)\s*金[）)]/);
  const price = pm ? Number(pm[1]) : 0;
  const dm = s.match(/[（(]([^）)]*)[）)]/);
  const desc = dm ? dm[1].trim() : "";
  // ★ 与 entry.js cleanName 同口径：×N（任意位置）、括号注记、货币尾注全部剥离
  const name = s
    .replace(/\[object Object\]/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[×xX*]\s*\d+\s*(个|件|尾|份|瓶|颗|张|本)?/g, " ")
    .replace(/\s*单[尾个件份瓶颗张本]\s*\d*\s*金.*$/g, " ")
    .replace(/\s*\d+\s*金.*$/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[·、,，;；:：]+$/, "")
    .trim()
    .slice(0, 20);
  const cm = s.match(/[×xX*]\s*(\d+)/);
  const count = cm ? Math.max(1, Number(cm[1])) : 1;
  return { name, count, price, desc };
}

/** 卖出单价（与插件 entry 的 sellPrice 同口径：有原价按 40%，否则按稀有度基价×品类系数） */
function sellPriceLocal(rarity: string, kind: string, rawPrice: number): number {
  if (rawPrice > 0) return Math.max(1, Math.round(rawPrice * 0.4));
  const base = RARITY_DEFAULT_PRICE[rarity] || RARITY_DEFAULT_PRICE.common;
  const k = kind === "equipment" ? 1.5 : kind === "skill_book" ? 2 : 1;
  return Math.max(1, Math.round(base * k));
}

/** 背包：parameterCardJson.items（string/object 混排）+ bagMeta 元数据 + itemMeta 战斗参数 + bagOrder 排列顺序 */
const sysBagItems = computed<SysItem[]>(() => {
  const card = sysCard.value || {};
  const meta = (((state.value as any)?.bagMeta || {}) as Record<string, any>);
  const imeta = (((state.value as any)?.itemMeta || {}) as Record<string, any>);
  const raw = Array.isArray(card.items) ? card.items : [];
  const merged = new Map<string, SysItem>();
  for (const it of raw) {
    let name = "";
    let count = 1;
    let rawPrice = 0;
    let note = "";
    if (typeof it === "string") {
      const p = parseItemStringLocal(it);
      name = p.name;
      count = p.count;
      rawPrice = p.price;
      note = p.desc;
    } else if (it && typeof it === "object") {
      name = String(it.name || "物品");
      count = Math.max(1, Number(it.count || 1));
      rawPrice = Number((it as any).price || 0);
      note = String((it as any).desc || "");
    } else {
      continue;
    }
    if (!name) continue;
    const prev = merged.get(name);
    if (prev) {
      prev.count += count;
      continue;
    }
    const objKind = it && typeof it === "object" ? String((it as any).kind || "") : "";
    const objRarity = it && typeof it === "object" ? String((it as any).rarity || "") : "";
    const m = meta[name] || {};
    const kind = String(objKind || m.kind || guessKindLocal(name));
    const rarity = String(objRarity || m.rarity || "common");
    const heal = Number((it && typeof it === "object" ? (it as any).heal : 0) || m.heal || defaultHealLocal(name, kind));
    const price = sellPriceLocal(rarity, kind, rawPrice || Number(m.price || 0));
    // ★ game.md 物品修改：战斗参数（itemMeta 按展示名存；无则按名/品类推断）
    const im = imeta[name] || {};
    const bt = inferItemTypeLocal(name, kind);
    const itype = String(im.type || bt.type);
    const dur = Math.round(Number(im.durability ?? -1));
    merged.set(name, {
      id: name, name, count, quantity: count, kind, rarity, heal, price,
      desc: im.description || im.desc || m.desc || note,
      description: String(im.description || note),
      power: Number(im.power ?? (kind === "equipment" ? 10 : 0)),
      cost: Number(im.cost ?? 0),
      cd: Number(im.cd ?? 0),
      cdLeft: 0,
      type: itype,
      range: String(im.range || (itype === "atk" ? bt.range : "melee")),
      lv: Math.max(1, Number(im.lv ?? 1)),
      buff_type: String(im.buff_type || ""),
      durability: dur,
      durabilityLeft: Math.round(Number(im.durabilityLeft ?? dur)),
      attribute_type: im.attribute_type !== undefined ? String(im.attribute_type) : inferItemAttrLocal(name),
      attribute_value: Number(im.attribute_value ?? 0),
    });
  }
  const list = Array.from(merged.values());
  const order = (((state.value as any)?.bagOrder || []) as string[]);
  list.sort((a, b) => {
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });
  list.forEach((it, i) => { it.index = i; });
  return list;
});

/** 技能栏：插件下发的 skills（第 i 项对应快捷栏第 i 格）；type/range/lv/buff_type 透传给技能面板（game.md 修改/特效归类） */
const sysSkills = computed<SysSkill[]>(() => {
  const arr = ((state.value as any)?.skills || []) as any[];
  return arr.map((s, i) => ({
    id: String(s.name || "skill") + "_" + i,
    name: String(s.name || "技能"),
    power: Number(s.power || 0),
    cost: Number(s.cost || 0),
    cd: Number(s.cd || 0),
    cdLeft: Number(s.cdLeft || 0),
    type: s.type,
    range: s.range,
    lv: s.lv,
    buff_type: s.buff_type,
    index: i,
  }));
});

/** 纳戒（插件落盘在 t_plugin_session_data） */
const sysRing = computed<{ items: SysItem[]; skills: string[] }>(() => {
  const r = (((state.value as any)?.ring || {}) as any);
  const items = (Array.isArray(r.items) ? r.items : []).map((it: any) => ({
    id: String(it.name || ""),
    name: String(it.name || "物品"),
    count: Math.max(1, Number(it.count || 1)),
    kind: String(it.kind || "material"),
    rarity: String(it.rarity || "common"),
    heal: Number(it.heal || 0),
    price: Number(it.price || 0),
    desc: it.desc,
  }));
  const skills = (Array.isArray(r.skills) ? r.skills : []).map((n: any) => String(n));
  return { items, skills };
});

const sysGoods = computed<SysGood[]>(() => (((state.value as any)?.shopGoods || []) as SysGood[]));
const sysGoodsSource = computed(() => String((state.value as any)?.shopSource || "builtin"));

function cardToRole(c: any, i: number): SysRole {
  const side = String(c?.side || "npc");
  return {
    id: String(c?.id || side + "_" + i),
    name: String(c?.name || "角色"),
    side,
    enemy: side === "enemy" || !!c?.enemy,
    level: Number(c?.level || 1),
    hp: Math.round(Number(c?.hp || 0)),
    maxHp: Math.round(Number(c?.maxHp || 0)),
    exp: Number(c?.exp || 0),
    alive: c?.alive !== false,
    mapName: String(c?.mapName || ""),
    x: Number(c?.x || 0),
    y: Number(c?.y || 0),
    inParty: !!c?.inParty,
    avatarPath: c?.avatarPath,
    parameterCardJson: c?.parameterCardJson || null,
    onMap: c?.onMap !== false,
    roleType: String(c?.roleType || ""),
  };
}

const sysPlayerRole = computed<SysRole | null>(() => {
  const cards = (((state.value as any)?.npcCards || []) as any[]);
  const idx = cards.findIndex(c => String(c?.side) === "player");
  if (idx >= 0) return cardToRole(cards[idx], idx);
  const me = state.value?.entities.find(e => e.side === "player");
  if (!me) return null;
  return {
    id: me.id,
    name: me.name || "玩家",
    side: "player",
    enemy: false,
    level: Number((me as any).level || 1),
    hp: Math.round(Number(me.hp || 0)),
    maxHp: Math.round(Number(me.maxHp || 0)),
    exp: 0,
    alive: me.alive !== false,
    mapName: currentLevelName.value,
    x: Number(me.x || 0),
    y: Number(me.y || 0),
    inParty: false,
    avatarPath: (me as any).avatarPath,
    parameterCardJson: (sysCard.value && Object.keys(sysCard.value).length)
      ? sysCard.value
      : ((state.value as any)?.roles || []).find((r: any) => String(r?.roleType) === "player")?.parameterCardJson || null,
  };
});

const sysNpcCards = computed<SysRole[]>(() => {
  const cards = (((state.value as any)?.npcCards || []) as any[]).filter(c => String(c?.side) !== "player");
  if (cards.length) return cards.map((c, i) => cardToRole(c, i));
  const ents = (state.value?.entities || []).filter(e => e.side !== "player");
  return ents.map((e, i) => cardToRole({ ...e, side: e.side === "enemy" ? "enemy" : "ally", mapName: currentLevelName.value }, i));
});

const sysMapNodes = computed<any[]>(() => (((state.value as any)?.mapNodes || []) as any[]));

const sysCurrentMp = computed(() => state.value?.entities.find(e => e.side === "player")?.mp ?? 0);
const sysCurrentMaxMp = computed(() => state.value?.entities.find(e => e.side === "player")?.maxMp ?? 0);
const sysPlayerX = computed(() => state.value?.entities.find(e => e.side === "player")?.x ?? 0);
const sysPlayerY = computed(() => state.value?.entities.find(e => e.side === "player")?.y ?? 0);

/* ----------------- 系统面板命令通道（前端 → 插件 → state 回推） ----------------- */
/** 已上报过的关卡名列表（避免重复上报） */
let sysLevelsReported = "";

function reportLevels(): void {
  let names: string[] = [];
  try {
    names = listLevelNames();
  } catch {
    names = [];
  }
  if (!names.length) {
    names = Array.from(new Set([currentLevelName.value, ...sysMapNodes.value.map((n: any) => String(n?.name || ""))].filter(Boolean)));
  }
  const key = names.join("|");
  if (!names.length || key === sysLevelsReported) return;
  sysLevelsReported = key;
  sendTick("sys", { levels: names });
}

const pendingSys = ref("");
let sysCmdTimer = 0;

/** 各系统命令的结果等待窗口：默认 3s；商城 agent 宿主侧要跑 15~20s，窗口必须盖住它 */
const SYS_CMD_WAIT_MS: Record<string, number> = { sys_shop_refresh: 25000 };

function runSysCmd(action: string, params: Record<string, any> = {}): void {
  pendingSys.value = action;
  sendTick(action, params);
  window.clearTimeout(sysCmdTimer);
  sysCmdTimer = window.setTimeout(() => { pendingSys.value = ""; }, SYS_CMD_WAIT_MS[action] ?? 3000);
}

/** 插件回推 response → 显示到面板底栏（仅系统命令触发时才提示） */
watch(
  () => String(((state.value as any)?.response) || ""),
  (resp) => {
    if (!resp || !pendingSys.value) return;
    const act = pendingSys.value;
    pendingSys.value = "";
    // ★ game.md 对话功能：sys_chat 的 response 是 JSON {speaker, text, avatar}
    if (act === "sys_chat") {
      try {
        const chatData = JSON.parse(resp);
        if (chatData?.speaker && chatData?.text) {
          const msg: ChatMessage = { speaker: chatData.speaker, text: chatData.text, avatar: chatData.avatar };
          chatMessages.value.push(msg);
          chatAgentResp.value = chatData.text; // 保存用于"继续"
          // 同步到宿主聊天框（宿主负责写入 Toonflow-game-web）
          sendChat(chatData.speaker, chatData.text, chatData.avatar);
        }
      } catch {
        // 非 JSON 直接显示
        sysNotice.value = resp;
      }
      chatPending.value = false;
      return;
    }
    sysNotice.value = resp;
    // ★ 睡眠/商城刷新的结果值得跳出面板提醒（睡眠→满血满蓝；商城→货源走没走 agent）
    if (act === "sys_rest" || act === "sys_shop_refresh") showToast(resp);
  }
);

/** 插件下发的传送目标 → 先切图（若目标不在本图），再落点 */
let lastTeleportRev = -1;
watch(
  () => ((state.value as any)?.teleportTarget || null),
  (tp) => {
    if (!tp) return;
    (state.value as any).teleportTarget = null;
    // ★ rev 去重兜底：宿主每个 tick 都回推 state，同一 rev 只允许传送一次，
    //   否则玩家会被反复拉回目标点（表现 = 点完传送被"绑住"）
    const rev = Number(tp?.rev ?? -1);
    if (rev >= 0) {
      if (rev === lastTeleportRev) return;
      lastTeleportRev = rev;
    }
    void applyTeleport(tp);
  },
  { deep: true }
);

/** 传送：先切图（若目标不在本图），再落点 */
async function applyTeleport(tp: any): Promise<void> {
  if (tp?.mapName && tp.mapName !== currentLevelName.value) {
    await switchLevel(String(tp.mapName));
  }
  const me = state.value?.entities.find(e => e.side === "player");
  if (me) {
    // ★ 落点安全化：夹进地图边界 + 吸附出墙/障碍（修复传送落进地图外暗区/墙里）
    const spot = freeEnemySpot(Number(tp?.x) || 0, Number(tp?.y) || 0);
    me.x = spot.x;
    me.y = spot.y;
    if (state.value?.events) state.value.events.push(`[传送] 已传送到 ${tp?.name || "目标位置"}`);
  }
}

/* ----------------- 系统面板事件处理 ----------------- */
function onSysSellItem(item: SysItem, count = 1) {
  sysNotice.value = `卖出 ${item.name} ×${count}`;
  runSysCmd("sys_sell", { name: item.name, count: Math.max(1, Math.floor(count)) });
}

function onSysUseItem(item: SysItem) {
  sysNotice.value = `使用 ${item.name}`;
  runSysCmd("sys_use_item", { name: item.name });
}

function onSysSort(from: number, to: number) {
  const names = sysBagItems.value.map(it => it.name);
  if (from < 0 || from >= names.length || to < 0 || to >= names.length) return;
  const [moved] = names.splice(from, 1);
  names.splice(to, 0, moved);
  sysNotice.value = "背包顺序已更新";
  runSysCmd("sys_sort", { order: names });
}

function onSysSortAuto() {
  const names = sysBagItems.value.map(it => it.name).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  sysNotice.value = "背包已按名称排序";
  runSysCmd("sys_sort", { order: names });
}

function onSysRingMove(name: string, to: string) {
  runSysCmd("sys_ring_move", { kind: "item", name, to: to === "bag" ? "bag" : "ring", count: 1 });
}

function onSysRingSkillMove(name: string, to: string) {
  runSysCmd("sys_ring_move", { kind: "skill", name, to: to === "bag" ? "bag" : "ring", count: 1 });
}

function onSysShopRefresh() {
  sysNotice.value = "正在刷新货源…";
  runSysCmd("sys_shop_refresh", {});
}

/** ★ game.md 商城：商城agent 按钮——主动调用商城 agent（故事动态参数 + 常驻世界书 → 物资类别） */
function onSysShopAgent() {
  sysNotice.value = "商城 agent 正在读取故事动态数据与世界书条目…";
  runSysCmd("sys_shop_refresh", { agent: true });
}

function onSysBuyItem(good: SysGood, count = 1) {
  sysNotice.value = `购买 ${good.name} ×${count}`;
  runSysCmd("sys_shop_buy", { id: good.id, name: good.name, count: Math.max(1, Math.floor(count)) });
}

function onSysUseSkill(skill: SysSkill) {
  sysNotice.value = `使用技能 ${skill.name}`;
  runSysCmd("sys_use_skill", { index: skill.index, name: skill.name });
}

/** game.md 技能修改：参数保存到 t_plugin_session_data（entry 侧 skillMeta + 参数卡技能名列表） */
function onSysEditSkill(p: any) {
  if (!p || p.index < 0) return;
  sysNotice.value = `修改技能 ${p.name || ""}`;
  runSysCmd("sys_skill_edit", p);
}

/** game.md 物品修改：参数保存到 t_plugin_session_data（entry 侧 itemMeta + 参数卡物品名列表） */
function onSysEditItem(p: any) {
  if (!p || p.index < 0) return;
  sysNotice.value = `修改物品 ${p.name || ""}`;
  runSysCmd("sys_item_edit", p);
}

function onSysTeleport(card: SysRole) {
  // game.md 传送到角色身边：仅排除用户自己，敌对角色也允许传送
  if (!card || card.side === "player") return;
  sysNotice.value = card.onMap === false ? `${card.name} 未上场，将生成到可活动区域后传送` : `传送到 ${card.name} 身边`;
  runSysCmd("sys_teleport", { roleId: card.id });
}

function onSysTravel(mapName: string) {
  if (!mapName || mapName === currentLevelName.value) return;
  sysNotice.value = `传送至 ${mapName}`;
  runSysCmd("sys_travel", { mapName });
}

function onSysFollow(id: string, on: boolean) {
  sysNotice.value = on ? "已加入队伍" : "已离开队伍";
  runSysCmd("sys_party", { roleId: id, follow: !!on });
}

watch(showSystemPanel, (on) => {
  if (on) {
    sysNotice.value = "";
    reportLevels();
  }
});

/** debug 面板选中的实体（用于在 canvas 上画高亮框）*/
const selectedEntityId = ref<string | null>(null);
function onSelectEntity(e: Entity | null) {
  selectedEntityId.value = e?.id || null;
}

/**
 * 🔄 横竖屏切换：false=横屏(960×372), true=竖屏(旋转90°用372×960显示)
 * */
const isRotated = ref(false);
/**
 * 屏幕元素是否旋转90 度
 */
const  isStageRotateOn =ref(false);

/** 地图主题（开局后从 state.map 取；也演示 toonflowJsApi 从插件数据表读 map_data） */
const mapTheme = ref("");
const mapZones = computed(() => state.value?.map?.zones || []);
const mapSourceLabel = computed(() => {
  const s = state.value?.mapSource;
  return s === "agent" ? "AI 地图" : s === "stored" ? "缓存地图" : s === "fallback" ? "默认地图" : "";
});
/** ★ 当前关卡野怪等级范围（null = 无野怪，[min, max] = 等级区间） */
const mapMobLevelRange = computed<[number, number] | null>(() => {
  const r = mapCfg.value?.mobLevelRange;
  return r && r.length === 2 ? r : null;
});
/** ★ 当前关卡野怪数量 */
const mapMobCount = computed(() => mapCfg.value?.mobs?.length ?? 0);

/* ---------------- 选人 ---------------- */
// ★ v6：reactive 数组（不是 ref）—— template 自动 unwrap ref 经常让我们传错对象，
//   改用 reactive 数组：template 拿到的就是数组本身，toggle 直接 push/splice 天然响应式
const participants = reactive<string[]>([]);
const spectators = reactive<string[]>([]);
const enemies = reactive<string[]>([]);

// 头像缓存（entityId -> HTMLImageElement）
const avatarCache = new Map<string, HTMLImageElement>();

function loadAvatar(avatarPath: string): HTMLImageElement {
  const cached = avatarCache.get(avatarPath);
  if (cached) return cached;
  const img = new Image();
  // ★ 头像路径解析：
  //   http(s) → 完整 URL（AI 故事角色头像）
  //   ./ 开头 → 插件自身资源（走 assetUrl：dev=Vite，prod=data URL）
  //   / 开头 → 宿主站内资源（补 origin）
  //   其他    → 当作相对路径走 assetUrl
  if (avatarPath.startsWith("http")) {
    img.src = avatarPath;
  } else if (avatarPath.startsWith("./")) {
    img.src = assetUrl(avatarPath.slice(2));
  } else if (avatarPath.startsWith("/")) {
    img.src = location.origin + avatarPath;
  } else {
    img.src = assetUrl(avatarPath);
  }
  avatarCache.set(avatarPath, img);
  return img;
}

function getEntityAvatar(e: Entity): HTMLImageElement | undefined {
  // 优先用 entity 上的 avatarPath
  if (e.avatarPath) return loadAvatar(e.avatarPath);
  // 否则从 roles 里找
  const role = roles.value.find((r) => r.id === e.id);
  if (role?.avatarPath) return loadAvatar(role.avatarPath);
  return undefined;
}

/** 取实体的头像路径（与 getEntityAvatar 同源，供动图解码使用） */
function entityAvatarPath(e: Entity): string | undefined {
  if (e.avatarPath) return e.avatarPath;
  const role = roles.value.find((r) => r.id === e.id);
  return role?.avatarPath || undefined;
}

/** 与 loadAvatar 完全一致的路径解析（http / ./ / 站内绝对路径 / 相对路径） */
function avatarUrlOf(avatarPath: string): string {
  if (avatarPath.startsWith("http")) return avatarPath;
  if (avatarPath.startsWith("./")) return assetUrl(avatarPath.slice(2));
  if (avatarPath.startsWith("/")) return location.origin + avatarPath;
  return assetUrl(avatarPath);
}

/**
 * ★ fix⑥（动图头像不播放的根因）：头像此前统一走 new Image() + ctx.drawImage()，
 *   而 drawImage 只绘制图像的「当前帧」—— 动画 WebP 经它画出来必然是一张静止图。
 *   这不是 canvas 不支持动图，而是这条绘制路径根本不驱动动画帧。
 *
 *   这里用 ImageDecoder（Chromium 94+，宿主运行在 127.0.0.1 属 secure context）
 *   把动图逐帧解码成 VideoFrame 缓存，绘制时按各帧 duration 自行轮播。
 *   解码失败 / 非动图 / 环境不支持 ImageDecoder 时标记为 "static"，
 *   自动回退到原来的静态 img 绘制，行为与改动前一致。
 */
interface AvatarAnim {
  frames: any[];
  /** 各帧时长（ms） */
  durations: number[];
  /** 各帧起始时刻（ms，累加） */
  starts: number[];
  /** 一轮总时长（ms） */
  total: number;
}
const avatarAnimCache = new Map<string, AvatarAnim | "static" | "pending">();

function ensureAvatarAnim(avatarPath: string): void {
  if (avatarAnimCache.has(avatarPath)) return;
  const Decoder = (window as any).ImageDecoder;
  if (typeof Decoder === "undefined") {
    avatarAnimCache.set(avatarPath, "static");
    return;
  }
  avatarAnimCache.set(avatarPath, "pending");
  const url = avatarUrlOf(avatarPath);
  void (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.arrayBuffer();
      const decoder = new Decoder({ data, type: res.headers.get("content-type") || "image/webp" });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      const n: number = track?.frameCount || 0;
      if (n <= 1) {
        avatarAnimCache.set(avatarPath, "static");
        return;
      }
      const frames: any[] = [];
      const durations: number[] = [];
      for (let i = 0; i < n; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        frames.push(image);
        durations.push(Math.max(16, Math.round((image.duration || 100000) / 1000)));
      }
      const starts: number[] = [];
      let acc = 0;
      for (const d of durations) { starts.push(acc); acc += d; }
      avatarAnimCache.set(avatarPath, { frames, durations, starts, total: acc || 1 });
    } catch {
      // 解码失败（跨域 / 非动图 / 旧内核）→ 回退静态，绝不影响主流程
      avatarAnimCache.set(avatarPath, "static");
    }
  })();
}

/** 返回该路径当前应绘制的那一帧；不是动图时返回 null（调用方回退静态 img） */
function avatarAnimFrame(avatarPath: string | undefined): any | null {
  if (!avatarPath) return null;
  ensureAvatarAnim(avatarPath);
  const entry = avatarAnimCache.get(avatarPath);
  if (!entry || entry === "static" || entry === "pending") return null;
  const t = performance.now() % entry.total;
  for (let i = entry.starts.length - 1; i >= 0; i--) {
    if (t >= entry.starts[i]) return entry.frames[i];
  }
  return entry.frames[0];
}

const roles = computed<RoleOption[]>(() => state.value?.roles || []);
const playerRole = computed(() => roles.value.find((r) => r.roleType === "player") || roles.value[0]);

/**
 * ★ 修复①：选人面板可选角色 = 全部角色 − 用户角色（roleType === "player"）。
 *   宿主 buildMiniGameRoleOptions 会把"用户角色 root.player"以 roleType:"player"
 *   注入 roles（宿主 MiniGameController.ts L5200 附近），而模板三组 chips 直接
 *   v-for="roles"，于是"用户自己"也被列进友方/观战/敌对候选：
 *     · 选中即被 entry.js 建成一个 ally（玩家身边多出一个与用户同名的角色）；
 *     · 甚至把玩家自己选成敌对角色（AI 自己打自己）。
 *   选人页应只展示"可被 AI 驱动的角色"，用户角色由宿主固定为玩家实体，不参与选择。
 */
const selectableRoles = computed<RoleOption[]>(() =>
  roles.value.filter((r) => String(r?.roleType) !== "player"),
);

/** ★ 当前玩家实体（HUD 模板用）；undefined 时让模板 fallback 走 ?? 默认值 */
const me = computed<Entity | undefined>(() => state.value?.entities.find((e) => e.side === "player"));

/* ★ game.md 等级系统：HUD 满值兜底
   满血HP = 100 + 等级*10 + 加成 / 满蓝MP = 100 + 等级*10 + 加成 / next_level_exp = 等级*100
   宿主未下发对应字段（老存档）时按公式推算，避免出现 0/0 或除零宽度 */
const hudLevel = computed(() => Math.max(1, Number(me.value?.level ?? 1) || 1));
const hudMaxHp = computed(() => Math.max(1, Math.round(Number(me.value?.maxHp ?? 0) || (100 + hudLevel.value * 10))));
const hudMaxMp = computed(() => Math.max(1, Math.round(Number(me.value?.maxMp ?? 0) || (100 + hudLevel.value * 10))));
const hudExpToNext = computed(() => Math.max(1, Math.round(Number(me.value?.expToNext ?? 0) || hudLevel.value * 100)));

// ★ v7：reactive 数组直接 push/splice 触发响应式（最简单可靠）
function toggle(arr: string[], id: string) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
}

function roleAvatar(r: RoleOption): string {
  const p = r?.avatarPath || "";
  if (!p) return "";
  // ★ fix②：统一用 resolveAssetPath。
  //   旧实现把宿主站内绝对路径（/1/game/scene/xxx.webp）也塞给 assetUrl，
  //   于是被拼成 /plugin/getAsset?pluginId=...&path=ui//1/game/scene/xxx.webp，
  //   服务端按插件目录解析 → 404（该 webp 实际由宿主 uploads 静态目录托管，
  //   /1/game/scene/xxx.webp 直取为 200 image/webp）。
  return resolveAssetPath(p);
}

const starting = ref(false);
/** ★ 上传地图：file input 引用与状态 */
const mapFileInput = ref<HTMLInputElement | null>(null);
const mapUploading = ref(false);

/**
 * 最小 zip 解析器（0/store + 8/deflate）。返回 [{name, bytes}]。
 * 不依赖第三方库，用浏览器原生 DecompressionStream（deflate-raw）。
 * 仅用于解析我们打包出来的 .tbg（zip deflate），够用。
 */
async function readZipEntries(buf: Uint8Array): Promise<{ name: string; bytes: Uint8Array }[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("不是 zip 文件（magic mismatch）");
  const entries: { name: string; bytes: Uint8Array }[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const sig = dv.getUint32(off, true);
    if (sig !== 0x04034b50) break;
    const method = dv.getUint16(off + 8, true);
    const compSize = dv.getUint32(off + 18, true);
    const uncompSize = dv.getUint32(off + 22, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const nameBytes = buf.slice(off + 30, off + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    let bytes: Uint8Array;
    if (method === 0) {
      bytes = data;
    } else if (method === 8) {
      // deflate raw
      const stream = new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      bytes = new Uint8Array(await stream);
    } else {
      throw new Error(`不支持的 zip method=${method}（仅 store/deflate）`);
    }
    if (uncompSize !== 0 && name && !name.endsWith("/")) entries.push({ name, bytes });
    off = dataStart + compSize;
  }
  return entries;
}
/** 上传成功短闪一下"已绑定"提示（3 秒后回到默认态） */
const mapUploadDone = ref(false);
let mapUploadDoneTimer = 0;
/** ★ ★ 防抖：玩家实体/物品/技能变更后写入 t_plugin_session_data，
 *   关掉小游戏 → AI 聊天窗口继续看得到最新值。 */
let saveDebounce = 0;
/** ★ fix③：开始游戏后的状态提示（宿主 /plugin/tick 响应慢时给出可解释的反馈） */
const startHint = ref("");
let startTimerSlow = 0;
let startTimerFail = 0;
function clearStartTimers() {
  if (startTimerSlow) { window.clearTimeout(startTimerSlow); startTimerSlow = 0; }
  if (startTimerFail) { window.clearTimeout(startTimerFail); startTimerFail = 0; }
}

/**
 * ★ fix④：像素风开关（复选框放在「退出」按钮旁）
 *  默认 true = 保持原有像素风渲染；取消勾选后：
 *    ① 画布 CSS 去掉 image-rendering: pixelated / crisp-edges；
 *    ② canvas 2D 打开双线性平滑（imageSmoothingEnabled=true + quality=high）。
 *  用户反馈的"整个界面都很模糊"正是低分辨率画布被像素化放大所致：关闭像素风后
 *  交给浏览器做平滑插值，观感立刻变清晰（代价是像素细节略柔）。
 */
const pixelMode = ref(localStorage.getItem("fs_pixel_mode") !== "0");
function onPixelModeChange() {
  try { localStorage.setItem("fs_pixel_mode", pixelMode.value ? "1" : "0"); } catch { /* ignore */ }
  applyCanvasSmoothing();
}
/**
 * 迷雾开关：持久化 + 重新打开时强制重算一次 FOV。
 * （refreshFov 按"跨格"节流，关掉再打开时玩家没跨格 → 不会自动重算，
 *   这里把 lastFovCell 置为无效值逼它重算。）
 */
function onFogToggle() {
  try { localStorage.setItem("fs_fog", fogEnabled.value ? "1" : "0"); } catch { /* ignore */ }
  lastFovCell = { gx: -999, gz: -999 };
  const me = state.value?.entities.find((e) => e.side === "player");
  if (me) refreshFov(me.x, me.y);
}
const fogEnabled = ref(localStorage.getItem("fs_fog") !== "0");
/** 按当前像素风开关同步 canvas 采样方式 */
function applyCanvasSmoothing() {
  const c = canvasEl.value;
  const g = c?.getContext("2d");
  if (!g) return;
  g.imageSmoothingEnabled = !pixelMode.value;
  try { (g as any).imageSmoothingQuality = pixelMode.value ? "low" : "high"; } catch { /* ignore */ }
}

function init_game(){
  // 初始化游戏
  // 例如生成地图数据，设置为游戏状态刚开始
}

function startGame() {
  if (starting.value) {
    console.log("starting.value not null");
    return
  };
  init_game();
  starting.value = true;
  sendTick("start", {
    selections: {
      participants: [...participants],
      spectators: [...spectators],
      enemies: [...enemies],
    },
  });
  // ★ fix③：原实现 2 秒后无条件重置按钮——宿主侧开始游戏要生成地图（较慢），
  //   「加载中…」在等待期凭空消失，用户看到的就是“点了开始、/plugin/tick 没返回、
  //   加载中效果就没了”。改为：
  //     · 加载态一直保持到宿主真的回包（onHostState 收到 playing/over 才清除）；
  //     · 8 秒未回包 → 提示“宿主响应较慢”（继续加载）；
  //     · 20 秒仍未回包 → 判定失败，恢复按钮并给出可重试的错误提示。
  startTimerSlow = window.setTimeout(() => {
    if (starting.value) startHint.value = "宿主响应较慢（正在生成地图），请稍候…";
  }, 8000);
  startTimerFail = window.setTimeout(() => {
    if (!starting.value) return;
    starting.value = false;
    startHint.value = "开始超时：宿主未返回 /plugin/tick(start) 响应，请检查服务端与插件会话后重试";
  }, 20000);
}

/* ---------------- 操作输入 ---------------- */
const input = ref({ dx: 0, dy: 0, moveTo: null as null | { x: number; y: number } });
const keys = new Set<string>();

function onKeyDown(e: KeyboardEvent) {
  keys.add(e.key.toLowerCase());
  syncKeys();
}
function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.key.toLowerCase());
  syncKeys();
}
function syncKeys() {
  let dx = 0;
  let dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  input.value.dx = dx;
  input.value.dy = dy;
  if (dx || dy) input.value.moveTo = null;
}

/* 虚拟摇杆 */
const stick = ref<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
const STICK_R = 52;
function stickStart(e: PointerEvent) {
  stick.value.active = true;
  stickMove(e);
}
function stickMove(e: PointerEvent) {
  if (!stick.value.active) return;
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2);
  let y = e.clientY - (r.top + r.height / 2);
  const d = Math.hypot(x, y);
  if (d > STICK_R) { x = (x / d) * STICK_R; y = (y / d) * STICK_R; }
  stick.value.x = x;
  stick.value.y = y;
  const nx = x / STICK_R;
  const ny = y / STICK_R;
  input.value.dx = Math.abs(nx) > 0.18 ? nx : 0;
  input.value.dy = Math.abs(ny) > 0.18 ? ny : 0;
  if (input.value.dx || input.value.dy) input.value.moveTo = null;
}
function stickEnd() {
  stick.value.active = false;
  stick.value.x = 0;
  stick.value.y = 0;
  input.value.dx = 0;
  input.value.dy = 0;
}

/* ---------------- 画布渲染 ---------------- */
const canvasEl = ref<HTMLCanvasElement | null>(null);

/* ============================================================
   地图 / 比例尺 / 缩放（来自 map_config.json）

   world_size = 3000 × 3000 米，origin = (0,0)，X/Z 范围 ±1500
   scale_meter = 1.0，block_size = 0.5 米，chunk_size = 32 块 = 16 米
   zoom ∈ [10, 30]，default = 20
   view_radius_m = 15 * (20/zoom) 米（地图配置 def_view 决定）

   显示区域算法：
     canvas 永远居中显示玩家世界坐标
     pixel_per_meter = min(canvas_w / view_w, canvas_h / (view_h * DEPTH))
     view_w, view_h 米 = def_view ± view_radius
   ============================================================ */

const mapCfg = ref<MapConfig | null>(null);
const terrainScale = computed<TerrainScaleConfig>(() =>
  mapCfg.value ? makeScaleFromMap(mapCfg.value) : DEFAULT_SCALE,
);

/** 当前 zoom（10-30, default 20） */
const zoom = ref(20);

/** 玩家世界坐标（米），从 state.entities[player] 派生 */
const playerPos = computed(() => {
  const s = state.value;
  if (!s) return { x: terrainScale.value.origin[0], y: terrainScale.value.origin[1] };
  const me = s.entities.find((e) => e.side === "player");
  if (me) return { x: me.x, y: me.y };
  // 兜底：用 state.spawn (entry.ts v3 引入) 或 origin
  if (s.spawn) return { x: s.spawn.x, y: s.spawn.y };
  return { x: terrainScale.value.origin[0], y: terrainScale.value.origin[1] };
});

/* 兼容旧变量（虽然名字难听，留着不破坏其它代码路径） */
let mapscale = 1;
let mapsize_def = { weight: 3000, height: 3000 };
let user_birth_location: [number, number] = [0, 0];
let _zoom_legacy = 2; // 旧值，已被 ref zoom 取代

/* 当前可见世界尺寸（米）—— 由 zoom 决定 */
const viewSizeMeters = computed<[number, number]>(() =>
  terrainScale.value.viewSizeMeters(zoom.value),
);

/* 缩放控制（zoom +/- 按钮，对应 Rotten-Soup 的 stage 缩放 / 25d_ai_game 的 camera zoom） */
function zoomIn() {
  zoom.value = terrainScale.value.clampZoom(zoom.value + 1);
}
function zoomOut() {
  zoom.value = terrainScale.value.clampZoom(zoom.value - 1);
}

let canvas_direction_def={
  horizontal_screen:{canvas_w:960, canvas_h:600},
  vertical_screen:{canvas_w:600, canvas_h:960}
}
let canvas_w =canvas_direction_def.vertical_screen.canvas_w;
let canvas_h = canvas_direction_def.vertical_screen.canvas_h;
/* 兜底常量（drawEntity / drawMonster 在未传入屏幕像素时的 fallback） */
const W_DEFAULT = canvas_w;
const H_DEFAULT = canvas_h;

const canvas_w_ref = ref(canvas_w);
const canvas_h_ref = ref(canvas_h);
/**
 * ★ fix⑤（画面模糊根因）：位图缓冲 / 逻辑坐标系 的比例系数 k。
 *
 * 逻辑坐标系（render() 里的 W×H、以及头像 40px / 字号 / 线宽等一切像素常量）
 * 始终保持原设计值不变；canvas 元素的 width/height 属性（= 真实位图密度）
 * 按「CSS 显示尺寸 × devicePixelRatio」放大，绘制时用 ctx.setTransform(k,…)
 * 一次性映射回逻辑坐标系。
 *
 * 这样视觉尺寸与所有绘制语义完全不变，只是位图从「1 个 CSS 像素 = 1 个位图像素」
 * 提升到「1 个物理像素 = 1 个位图像素」，彻底消除被浏览器放大数倍后的发虚。
 */
const renderScale = ref(1);
/** 设计基准：横屏 960×600 */
const DESIGN_W = 960;
const DESIGN_H = 600;
const MAX_LONG = 12000; // 画布长边上限，防爆显存


const world = computed(() => state.value?.world || { w: canvas_direction_def.vertical_screen.canvas_w, h: canvas_direction_def.vertical_screen.canvas_h });
/**
 * 🔄 按钮（req.md:57-58）：横竖屏切换
 *
 * 设计：手机默认竖屏 → 画布直接 960×600 纵向铺满屏幕（无黑边）
 *      点击 🔄 → 切横屏 → 画布旋转 90° 显示成 600×960（适合安卓 H5 横屏）
 * 内部分辨率与渲染坐标永不改变，只调 CSS 大小和 transform。
 */

function fitCanvas() {
  rotated_fun();
  fitCanvas_v5();
}

function fitCanvas_v5() {
  const c = canvasEl.value;
  if (!c) return;
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  if (availW <= 0 || availH <= 0) return;

  const BUF_H = canvas_h;
  const BUF_W = canvas_w;

  // 正常横屏：直接填满（cover）
  const scale = Math.max(availW / BUF_W, availH / BUF_H);
  const cssW = Math.max(1, Math.floor(BUF_W * scale));
  const cssH = Math.max(1, Math.floor(BUF_H * scale));
  c.style.width  = cssW + "px";
  c.style.height = cssH + "px";

  // ★ fix⑤（画面模糊根因修复）：旧实现把 canvas 的 width/height 属性直接设成
  //   BUF_W / BUF_H（逻辑尺寸，手机竖屏约 390×244），而 CSS 又把这块小位图放大到
  //   cssW×cssH（1300+ px）来铺满屏幕 —— 相当于一张 390px 宽的位图被浏览器
  //   放大数倍（且是非整数倍）显示。所以宿主下发的清晰头像 webp、像素精灵
  //   全都会被二次插值搞糊，跟素材本身清晰度没有任何关系。
  //   现改为：位图缓冲 = 实际显示尺寸 × devicePixelRatio，配合 render() 里的
  //   ctx.setTransform(k) 做到 1 个位图像素 = 1 个物理像素。
  //   上限取 2：手机 DPR 普遍是 2~3，取满 3 会让每帧填充像素涨到 9 倍，
  //   和上一轮做的移动端 30fps / 限频优化互相打架；DPR=2 已基本消除肉眼模糊。
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bufW = Math.max(1, Math.round(cssW * dpr));
  const bufH = Math.max(1, Math.round(cssH * dpr));
  canvas_w_ref.value = bufW;
  canvas_h_ref.value = bufH;
  renderScale.value = bufW / BUF_W;
  console.log("[fitCanvas_v5] css", cssW, cssH, "buffer", bufW, bufH, "dpr", window.devicePixelRatio, "k", renderScale.value.toFixed(3));
}



/**
 * 根据当前视口，算出横屏/竖屏两种模式下的逻辑画布尺寸
 * 横竖屏比例严格保持 16:10，只是宽高互换
 */
function calcCanvasDirection() {
  const vp = window.visualViewport ?? { width: window.innerWidth, height: window.innerHeight };
  const screenW = vp.width;
  const screenH = vp.height;

  const aspect = DESIGN_W / DESIGN_H; // 1.6

  // 横屏：宽>高，比例 1.6
  let hW: number, hH: number;
  if (screenW / screenH >= aspect) {
    hH = Math.min(screenH, MAX_LONG / aspect);
    hW = hH * aspect;
  } else {
    hW = Math.min(screenW, MAX_LONG);
    hH = hW / aspect;
  }

  // 竖屏：宽<高，比例 0.625（横屏宽高互换）
  let vW: number, vH: number;
  if (screenW / screenH <= 1 / aspect) {
    vW = Math.min(screenW, MAX_LONG * (1 / aspect));
  } else {
    vH = Math.min(screenH, MAX_LONG);
  }

  return {
    screen: { canvas_w: Math.round(hW), canvas_h: Math.round(hH) }
  };
}

function rotated_fun() {
  rotated_fun_v1();
}
function rotated_fun_v1() {
  const canvas_direction = calcCanvasDirection();
    // CSS hack旋转模式，使用竖屏配置
  canvas_w = canvas_direction.screen.canvas_w;
  canvas_h = canvas_direction.screen.canvas_h;
  console.log("set canvas size", canvas_w, canvas_h);
}



/** 🔄 按钮：横竖屏切换 */
/** 判断是否安卓App内嵌H5(WebView) */
function isAndroidAppWebView(): boolean {
  const ua = navigator.userAgent;
  const isAndroid = /android/i.test(ua);
  const isWebView = /; wv\)/.test(ua); // WebView标识
  return isAndroid && isWebView;
}

/** 🔄 横竖屏切换入口 */
async function toggleOrientation() {
  await toggleOrientation_android_app_h5();
}

async function toggleOrientation_android_app_h5() {
  // 目标状态：isRotated=false → 期望真实系统横竖屏；true → CSS旋转hack
  const wantLandscape = !isRotated.value;

  // ✅ 不是安卓App‑WebView，直接跳过系统锁屏，直接切CSS hack
  if (!isAndroidAppWebView()) {
    console.log("不是安卓App WebView，跳过系统方向锁，使用CSS rotate hack");
    isRotated.value = !isRotated.value;
    // pc 元素也不旋转
    //isStageRotateOn.value = !isRotated.value;
    rotated_fun();
    requestAnimationFrame(fitCanvas);
    return;
  }

  // 只有安卓App WebView才尝试调用系统锁API
  try {
    if (!window.screen?.orientation) {
      throw new Error("WebView环境不支持screen.orientation");
    }
    if (wantLandscape) {
      await screen.orientation.lock("landscape-primary");
    } else {
      await screen.orientation.lock("portrait-primary");
    }
    // 锁屏成功，关闭CSS旋转标记
    isRotated.value = false;
    console.log("✅ WebView系统方向锁定成功", wantLandscape ? "横屏" : "竖屏");
  } catch (err) {
    console.warn("⚠️ WebView系统锁屏失败，降级CSS rotate hack：", err);
    isRotated.value = !isRotated.value;
  }

  rotated_fun();
  requestAnimationFrame(fitCanvas);
}

function onCanvasClick(e: MouseEvent) {
  const c = canvasEl.value;
  if (!c) return;
  const r = c.getBoundingClientRect();

  // 屏幕点 → canvas 内部像素
  const cssX = e.clientX - r.left;
  const cssY = e.clientY - r.top;
  // CSS 显示尺寸 vs canvas 内部尺寸的比例
  const ratioX = c.width / r.width;
  const ratioY = c.height / r.height;
  const px = cssX * ratioX;
  const py = cssY * ratioY;

  // ★ v6：与 render() 的相机数学严格互逆（此前用 Math.min 导致非正方形画布下
  //   反投影比例偏小 ~W/H 倍，落点整体向外漂移——"点 A 特效落在 B、人物走到 B"）。
  //   render(): W = c.width/k, sx = round(max(W/vw, H/(vh*DEPTH)))，
  //   wx2px = (mx-pp.x)*sx + W/2 → 这里逐步求逆。
  const ts = terrainScale.value;
  const [vw, vh] = ts.viewSizeMeters(zoom.value);
  const kInv = renderScale.value > 0 ? renderScale.value : 1;
  const Wl = Math.round(c.width / kInv);
  const Hl = Math.round(c.height / kInv);
  const sxInv = Math.max(4, Math.round(Math.max(Wl / vw, Hl / (vh * DEPTH))));
  // 屏幕（逻辑像素）偏移 → 世界米偏移（相对玩家）
  const dx = (px / kInv - Wl / 2) / sxInv;
  const dy = (py / kInv - Hl / 2) / (sxInv * DEPTH);
  // dx, dy 是相对玩家的偏移，加 playerPos 即世界米
  const me = state.value?.entities.find((e) => e.side === "player");
  const ppx = me?.x ?? 0;
  const ppy = me?.y ?? 0;
  const tx = ppx + dx;
  const ty = ppy + dy;

  // 世界边界内夹取（点到图外也应该走到贴边，而不是把 moveTo 设到无穷远）
  const lim = worldLimitM();
  const tgt = {
    x: Math.max(-lim, Math.min(lim, tx)),
    y: Math.max(-lim, Math.min(lim, ty)),
  };
  input.value.moveTo = tgt;
  input.value.dx = 0;
  input.value.dy = 0;

  // ★ 点下即跑 A*：既给出"能不能到"的即时反馈（特效颜色），也直接填好路点队列，
  //   避免 localTick 首帧再算一次。
  const reachable = recomputeMoveToPath(tgt.x, tgt.y);
  pushClickFx(tgt.x, tgt.y, reachable);
}

/** 点击地面特效入队（超出上限则丢弃最旧的，避免连点导致数组无限增长） */
function pushClickFx(x: number, y: number, ok: boolean): void {
  clickFxList.push({ x, y, ok, t0: _animTick });
  if (clickFxList.length > 6) clickFxList.splice(0, clickFxList.length - 6);
}


// loadAvatar 已移除（角色身体改用 sprite sheet）

/**
 * 纵向压缩系数（2.5D 斜视角）。
 * Rotten-Soup 是正俯视：地块为正方形、纵向不做压缩。toonflow 旧值 0.62 把画面纵向压扁，
 * 表现为"地块变扁、树变矮胖"，与参照画面差距明显。v4 改为 1.0（等距俯视、正方形地块）。
 */
const DEPTH = 1.0;

// ============================================================
// 精灵资源管理（参考 pixi_game 的 PNG sprite sheet 方案）
// ============================================================

interface SpriteSheet {
  img: HTMLImageElement;
  fw: number;   // 单帧宽
  fh: number;   // 单帧高
  cols: number; // 列数
  ready: boolean;
}

/** 通用 PNG 精灵（单图或多帧横排，frameH=单帧高度） */
function loadSheet(src: string, fw: number, fh: number, cols = 1): SpriteSheet {
  const img = new Image();
  // ★ 必须先声明 sheet，再注册 onload 闭包（data URL 同步触发 onload，闭包若捕获未声明的 const 会 TDZ 抛错）
  const sheet: SpriteSheet = { img, fw, fh, cols, ready: !!(img.complete && img.naturalWidth > 0) };
  img.onload = () => { sheet.ready = true; };
  img.onerror = () => {
    console.warn('[field-survival] sprite load failed', src.substring(0, 30));
  };
  img.src = src;
  // ★ 兜底：onload 因任何原因没触发时，再做一次同步检查（缓存命中 / 极快解码）
  if (!sheet.ready && img.complete && img.naturalWidth > 0) sheet.ready = true;
  return sheet;
}

function onReady(s: SpriteSheet, cb: () => void) {
  if (s.ready) { cb(); return; }
  if (s.img.complete && s.img.naturalWidth > 0) {
    s.ready = true; cb();
  } else {
    s.img.onload = () => { s.ready = true; cb(); };
  }
}

/** 绘制单帧：(sx,sy)为源图帧坐标 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: SpriteSheet,
  sx: number, sy: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  if (!s.ready) return;
  ctx.drawImage(s.img, sx * s.fw, sy * s.fh, s.fw, s.fh, dx, dy, dw, dh);
}

// ----------------------------------------------------------
// 精灵加载（Rotten-Soup dawnlike 资源，相对路径引用 public/images/）
// 角色走 player_sprites/<id>.png 单图；地面/水/药水从 tileset 按 tile id 切片
// -------------------------------------------------------
const SHEET_PLAYER      = loadSheet(IMG_PLAYER, 32, 32);
const SHEET_ALLY        = loadSheet(IMG_ALLY, 32, 32);
const SHEET_ENEMY_CHAR  = loadSheet(IMG_ENEMY_CHAR, 32, 32);

// ★ tileset 大图只加载一次，所有 tile id 共用（同 Rotten-Soup 的 GameDisplay 方案）
const SHEET_TILESET    = loadSheet(TILESET_URL, TILE_SIZE, TILE_SIZE, TILESET_COLS);

/** 从 tileset 绘制指定 tile id */
function drawTile(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  dx: number, dy: number, dw: number, dh: number,
  flipX: boolean = false,
) {
  if (!SHEET_TILESET.ready) return;
  const { sx, sy, sw, sh } = tileSrcRect(tileId);
  if (flipX) {
    // 水平翻转：先把目标区域缩放为 (-dw, dh)，再 drawImage
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(SHEET_TILESET.img, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(SHEET_TILESET.img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

/* ============================================================
 * ★ 城镇建筑像素艺术绘制（与 Rotten-Soup mulberryTown.json 同构）
 *
 * 瓦片类型：
 *   - 屋顶（顶行）：左 / 中 / 右 = 9184 / 9185 / 9186（带斜面封边）
 *   - 墙体（中间行）：左 / 中 / 右 = 9304 / 9305 / 9306
 *   - 墙底（最底行）：9310（带阴影描边）
 *   - 门：9425（占 2 行高，靠最底，门口朝南）
 *   - 窗：9424 / 9426
 *   - 室内地面：9189（用于最底行中间 / 室内细节）
 *
 * 每种建筑 kind 有不同的尺寸与内部格局：
 *   - inn   6×7 大屋：屋顶 2 行 + 墙 4 行（含 2 行门面）+ 底 1 行
 *   - shop  5×6 中型铺面
 *   - house 4×5 标准民居
 *   - well  2×2 水井（特殊：圆顶石井）
 * ============================================================ */
interface TownBuilding {
  id: string;
  kind?: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 选瓦片：列索引 → (左/中/右) 屋顶 / 墙顶 / 墙底
 * 行索引：
 *   0        = 屋顶顶行（只有左 / 中 / 右三块）
 *   1        = 屋顶中行（同 0）
 *   2..h-2   = 墙身
 *   h-1      = 墙底
 *   门窗放 2..h-2 中间一行（朝南/朝相机）。
 */
function drawTownBuildingTiles(
  ctx: CanvasRenderingContext2D,
  b: TownBuilding,
  ppm: number,                 // pixels per meter（=每瓦片边长）
  wx2px: (x: number) => number,
  wz2py: (z: number) => number,
) {
  const kind = b.kind || "house";
  const w = Math.max(2, b.w | 0);
  const h = Math.max(2, b.h | 0);
  const cx = wx2px(b.x);
  const cy = wz2py(b.y);
  const tile = Math.max(4, Math.round(ppm)); // 单瓦片像素边长（与角色同尺度）
  const bw = w * tile;     // 建筑总宽（像素）
  const bh = h * tile;     // 建筑总高（像素）
  const x0 = cx - bw / 2;  // 建筑最左
  const y0 = cy - bh + 4;  // 建筑最上（与原"building"装饰物同一锚点）

  // —— 水井：单独绘制（圆顶石井 + 水面），不画方屋 ——
  if (kind === "well") {
    drawWellPixel(ctx, x0, y0, bw, bh, tile);
    return;
  }

  // 行类型：
  //   0            → 屋顶顶行
  //   1            → 屋顶中行
  //   2 .. h-2     → 墙身（门窗在此）
  //   h-1          → 墙底
  for (let row = 0; row < h; row++) {
    const ty = y0 + row * tile;
    for (let col = 0; col < w; col++) {
      const tx = x0 + col * tile;
      const isLeft   = col === 0;
      const isRight  = col === w - 1;
      const isMiddle = !isLeft && !isRight;
      const doorCol  = (w / 2) | 0;        // 朝南的门在中列
      const isDoorCol = isMiddle && col === doorCol;

      // 行 0/1：屋顶
      if (row === 0 || row === 1) {
        const tileId = isLeft
          ? TILE_HOUSE_ROOF_LEFT_ID
          : (isRight ? TILE_HOUSE_ROOF_RIGHT_ID : TILE_HOUSE_ROOF_MID_ID);
        drawTile(ctx, tileId, tx, ty, tile, tile);
        continue;
      }

      // 行 h-1：墙底
      if (row === h - 1) {
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, tx, ty, tile, tile);
        continue;
      }

      // 行 2 .. h-2：墙身
      //   - 左 / 右：墙顶左 / 右（带尖角）
      //   - 中列 + 是"门面行"：门（占两行 → 第二行重复画门，营造 2 格高门洞）
      //   - 中列 + 是"窗行"：窗（仅 shop / inn 偶数行放窗）
      //   - 其余：墙顶中
      const facadeRow = row === h - 2;       // 紧贴墙底的那行 = 门面行
      const windowRow = (kind === "shop" || kind === "inn") && !facadeRow && (row % 2 === 0);

      if (isLeft) {
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, tx, ty, tile, tile);
      } else if (isRight) {
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, tx, ty, tile, tile);
      } else if (isDoorCol && facadeRow) {
        drawTile(ctx, TILE_HOUSE_DOOR_ID, tx, ty, tile, tile);
      } else if (isDoorCol && row === h - 3) {
        // 门洞上方再画一行门（与门面行连成 2 格高门洞）
        drawTile(ctx, TILE_HOUSE_DOOR_ID, tx, ty, tile, tile);
      } else if (windowRow && (col === doorCol - 1 || col === doorCol + 1)) {
        // 门两侧的格子放窗
        drawTile(ctx, col < doorCol ? TILE_HOUSE_WINDOW_ID : TILE_HOUSE_WINDOW_RIGHT_ID, tx, ty, tile, tile);
      } else {
        drawTile(ctx, TILE_HOUSE_TOP_MID_ID, tx, ty, tile, tile);
      }
    }
  }
}

/**
 * 水井像素艺术：
 *   - 2×2 水井用 4 个瓦片拼出"石井 + 水面"：
 *     [木井栏顶] [木井栏顶]
 *     [石块环]   [水面]
 *   - tileset 中没有专用井 tile，借用屋顶中（9185）+ 墙底（9310）+ 水（4500）组合。
 */
function drawWellPixel(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, bw: number, bh: number, tile: number,
) {
  // 左上 / 右上：木井栏顶（屋顶中瓦片作为占位；没有专用井栏 tile，借用屋顶木纹）
  drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0,             y0,             tile, tile);
  drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + tile,     y0,             tile, tile);
  // 左下：石块（墙底瓦片带阴影边）
  drawTile(ctx, TILE_HOUSE_BOTTOM_ID,   x0,             y0 + tile,      tile, tile);
  // 右下：水面
  drawTile(ctx, TILE_WATER_ID,          x0 + tile,     y0 + tile,      tile, tile);
  // 井口轮廓：在水面中心画一个深色圆点（井口黑眼）
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  const cx = x0 + tile + tile / 2;
  const cy = y0 + tile + tile / 2;
  ctx.arc(cx, cy, tile * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ★ 像素艺术：用 imageSmoothingEnabled=false 保证像素清晰（不模糊）
function applyPixelPerfect(ctx: CanvasRenderingContext2D) {
  // ★ fix④：跟随「像素风」复选框——关闭时若仍强制 imageSmoothingEnabled=false，
  //   每帧绘制都会把它改回去，复选框就失效了。
  ctx.imageSmoothingEnabled = !pixelMode.value;
  if (!pixelMode.value) {
    try { (ctx as any).imageSmoothingQuality = "high"; } catch { /* ignore */ }
  }
}

// 地图装饰物（树木、水体、花木）位置 —— 优先从 mulberryTown.json 加载
interface Decoration { x: number; y: number; kind: "tree" | "water" | "bush" | "mushroom" | "flower" | "pot" | "rock" | "dead_tree" | "building" | "npc" | "fence" | "furniture" | "farm" | "road" | "portal"; id: string; variant?: number; name?: string; tileId?: number; layer?: number }
const mapDecorations = ref<Decoration[]>([]);
/** 装饰物按 chunk 索引（key = "cx,cz"）——按区域加载时只取当前 loaded_chunks 内的 */
const decorationsByChunk = new Map<string, Decoration[]>();

/** ★ 当前关卡名 + 切图中标记（防止重复触发）
 *  起始值仅为同步占位：onMounted 时会被 maps/first.map.json 的 start_map.value 覆盖
 *  （缺失 / 读取失败 → 回退 DEFAULT_START_LEVEL，即 "Mulberry Town"）。
 *  关卡切换的唯一入口是场景内 portal（LEVEL_TRANSITION）；宿主 theme 不参与切图。 */
const currentLevelName = ref(DEFAULT_START_LEVEL);
const levelSwitching = ref(false);
/** 切图过渡期标记（true = 本帧正在切图，丢弃所有旧图怪） */
const switchingLevel = ref(false);
/** ★ 最近一次切图完成时刻（ms）。onHostState 的 isLevelSwitch 兜底用它区分
 *   「切图后宿主还没采纳新怪的过渡帧」（不能丢刚 push 的新图怪）和
 *   「真·回老图场景」（老怪不能跟人）。 */

/* ============================================================
   ★ 修复③：本地敌怪「世代号」（刷怪权威统一的关键）
   ------------------------------------------------------------
   前端按地图数据生成的 mapmob_ / localmob_ / zone_ 敌怪是"前端权威集合"，
   宿主进程看不到它们，只知道自己 WORLD_REGIONS（±1500 m）里那份实体表 ——
   于是前端在森林（Tiled 60×40 m）里刷出的怪，宿主既不移动也不结算，
   表现为"野怪不攻击 / 玩家打不到野怪"。

   统一方案：前端在敌怪集合"结构性变化"时把整份清单上报宿主
   （switchLevel 重建、波次补怪、兜底补怪），宿主据此重建敌怪表，
   再由宿主统一跑 AI + 命中结算，最终位姿随 state 回流前端渲染。
   ============================================================ */
let localMobsEpoch = 1;        // 本地敌怪集合的版本号（每次重建 +1）
let localMobsSentEpoch = 0;    // 已上报给宿主的版本号（避免每帧重复上报）
/** 已在前端阵亡、等待宿主确认删除的本地敌怪（防止宿主整份推送把它们原地复活） */
const deadLocalEnemyIds = new Set<string>();
function bumpLocalMobsEpoch(): void {
  localMobsEpoch += 1;
  deadLocalEnemyIds.clear();
}

/**
 * ★ game.md 68-69（野怪刷新机制）：
 *   不离开地图不会刷新；离开当前地图 30 秒后重新生成野怪。
 *   levelLeaveState 记录每张图"上次离开时刻 + 离开时的死怪 id 集合"，
 *   switchLevel 再进图时据此决定死怪是保持死亡（<30s）还是重生（≥30s）。
 */
interface LevelLeaveRecord { leftAt: number; deadIds: Set<string>; }
const levelLeaveState = new Map<string, LevelLeaveRecord>();
/** 重建本图野怪时应保持死亡的怪（Tiled object id），由 switchLevel 设置 */
let pendingDeadMobIds: Set<string> = new Set();

/* ============================================================
   ★ 安全区 / 本地怪物信息发布（供 standalone mockHost 复用 App 侧判定）
   ============================================================ */

/** 当前关卡的 safe zone（无则空数组） */
function activeSafeZones(): Array<any> {
  const zones = ((state.value?.map?.zones?.length ? state.value.map.zones : mapCfg.value?.zones) || []) as Array<any>;
  return zones.filter((z) => z?.kind === "safe");
}

/**
 * ★ 把"当前关卡有哪些 safe zone"发布到 window，供同窗口的 mockHost 使用。
 *   mockHost 此前把 overworld.json 的整图当成城镇 safe 区（整张地图都是安全区），
 *   于是玩家在森林里也被判定为"在安全区"→ 波次不刷、野怪不追。
 */
function publishSafeZones(cfg: { zones?: any[] } | null | undefined): void {
  try {
    const zones = ((cfg?.zones || []) as Array<any>).filter((z) => z?.kind === "safe");
    (window as any).__mapSafeZones = zones;
  } catch { /* ignore */ }
}

/**
 * ★ 发布"当前关卡半宽/半高"（米），供同窗口 mockHost 把刷怪落点夹进本图范围。
 *   否则 mock 会按默认 3000×3000 世界刷怪，森林（60×40）里刷出来的怪在图外。
 */
function publishMapBounds(cfg: { size?: number[] } | null | undefined): void {
  try {
    const size = (cfg?.size as number[] | undefined) ?? [3000, 3000];
    (window as any).__mapHalfSize = {
      lx: Math.max(1, (size[0] ?? 3000) / 2 - 1),
      ly: Math.max(1, (size[1] ?? 3000) / 2 - 1),
    };
  } catch { /* ignore */ }
}

/**
 * ★ 把"App 侧本地敌怪"以拉取式钩子暴露给同窗口的 mockHost。
 *   mockHost 每 100ms 会用自己那份 state 整份覆盖前端，而它并不知道 App 生成的
 *   mapmob_* / localmob_* / zone_* 敌怪（森林野怪就是 mapmob_*）→ 会被整份覆盖抹掉。
 *   钩子让 mock 在推送前把它们并入自己的 state，从而"刷得出 + 会追人 + 能击杀"。
 *   真实宿主下该钩子无副作用（宿主进程读不到 window）。
 */
function publishLocalMapMobs(): void {
  try {
    (window as any).__collectLocalEnemies = () => {
      const list = ((state.value?.entities || []) as Array<any>).filter(
        (e) =>
          e?.side === "enemy" &&
          typeof e?.id === "string" &&
          (e.id.startsWith("mapmob_") || e.id.startsWith("localmob_") || e.id.startsWith("zone_")),
      );
      return list.map((e) => ({ ...e }));
    };
  } catch { /* ignore */ }
}

/**
 * ★ 修复③：把"本地敌怪清单 + 本地地图半宽半高"组装成 tick 上报载荷。
 *   仅当世代号变化时返回非 null（结构性变化才上报，避免每帧重复发送大数组）。
 *   bounds 用于让宿主把野怪 AI 的移动/归位/游荡夹进本图范围（森林只有 ±29 m），
 *   否则宿主的 MOB_WANDER_R_M=8 / MOB_DISENGAGE_M=12 会把怪推出玩家可走区域。
 */
function localEnemiesPayload(): { epoch: number; bounds: { lx: number; ly: number }; list: any[] } {
  // ★ 每帧都发（宿主按 epoch 变化才重建敌怪表，不会重复刷）。
  //   即使本帧 mapmob 数量为 0（城镇）也发空清单，dev-host 必须收到才清空 server 侧残留。
  const list = ((state.value?.entities || []) as Array<any>).filter(
    (e) =>
      e?.side === "enemy" &&
      typeof e?.id === "string" &&
      (e.id.startsWith("mapmob_") || e.id.startsWith("localmob_") || e.id.startsWith("zone_")),
  );
  // ★ 修复（bounds 恒为 0）：此前写的是 clampToMapBounds(0, 0) —— 那是把「点 (0,0)」
  //   夹进边界后返回的点，永远是 {x:0,y:0}，于是上报的 bounds 恒为 {lx:0,ly:0}，
  //   宿主 applyLocalEnemies 里 `if (lx>0 && ly>0)` 两段全部失效：
  //     ① mapBounds 永远 null → 野怪 AI/游荡/归位不夹进本图范围；
  //     ② 宿主在世界野区（240~480m）自刷的怪从不被清理 → 小图里满屏无关野怪。
  //   这里应上报的是「边界半宽/半高」本身（森林 60×40 → ±29/±19）。
  const __size = (mapCfg.value?.size as number[] | undefined) ?? [3000, 3000];
  return {
    epoch: localMobsEpoch,
    bounds: {
      lx: Math.max(1, (__size[0] ?? 3000) / 2 - 1),
      ly: Math.max(1, (__size[1] ?? 3000) / 2 - 1),
    },
    list: list.map((e) => ({ ...e })),
  };
}

/**
 * ★ 把压缩后的可行走网格随 tick 上报给宿主（**敌人碰撞用**）。
 *
 * 为什么需要：敌人位姿由宿主推进（entry.ts / entry.js / mockHost.ts），
 * 而 tileset 属性表 + 地图 JSON 只在 iframe 侧解析过。
 * 与其让宿主三处各自再实现一遍解析（三份代码、三处漂移），
 * 不如把位图传过去，宿主直接调同一套 collision.resolveMove。
 *
 * 体积：60×40 图 = 2400 字节/层 → base64 3.2KB，两层 6.4KB；
 * 按"关卡名"做世代号，只在切图那一次发送，稳态零开销。
 */
let walkGridSentEpoch = "";
function walkGridPayload(): { epoch: string; grid: any } | null {
  if (!walkGrid) return null;
  // ★ 世代号用"自增序号"，不能用关卡名 —— 否则 A→B→A 回到 A 时
  //   epoch 与首次相同会被判定为"已发送"，宿主手里留的还是 B 的网格。
  const epoch = `${walkGridEpochSeq}|${currentLevelName.value}`;
  if (epoch === walkGridSentEpoch) return null;
  walkGridSentEpoch = epoch;
  return { epoch, grid: encodeWalkGridPacket(walkGrid) };
}

/** 把刷新点推出 safe zone（安全区只保护玩家，不再冻结世界刷新） */function safeReadJson(entry: { bytes: Uint8Array } | undefined, label: string): any {
  if (!entry) return null;
  try { return JSON.parse(new TextDecoder().decode(entry.bytes)); }
  catch (e) { console.warn("[field-survival] 读 " + label + " 失败：", e); return null; }
}

function pushOutsideSafeZones(x: number, y: number): { x: number; y: number } {
  let px = x, py = y;
  for (const z of activeSafeZones()) {
    if (z.rx !== undefined && z.ry !== undefined) {
      const inside = Math.abs(z.x - px) <= z.rx && Math.abs(z.y - py) <= z.ry;
      if (!inside) continue;
      const dx = px - z.x, dy = py - z.y;
      const outX = z.rx + 2 - Math.abs(dx);
      const outY = z.ry + 2 - Math.abs(dy);
      if (outX < outY) px = z.x + Math.sign(dx || 1) * (z.rx + 2);
      else py = z.y + Math.sign(dy || 1) * (z.ry + 2);
    } else {
      const r = (z.r ?? 30) + 2;
      const dd = Math.hypot(px - z.x, py - z.y);
      if (dd <= r) {
        const k = (r + 0.01) / (dd || 0.01);
        px = z.x + (px - z.x) * k;
        py = z.y + (py - z.y) * k;
      }
    }
  }
  return { x: px, y: py };
}

/** 把刷新点夹进当前地图边界（避免刷在地图外，玩家永远走不到） */
function clampToMapBounds(x: number, y: number): { x: number; y: number } {
  const size = (mapCfg.value?.size as number[] | undefined) ?? [3000, 3000];
  const lx = Math.max(1, (size[0] ?? 3000) / 2 - 1);
  const ly = Math.max(1, (size[1] ?? 3000) / 2 - 1);
  return { x: Math.max(-lx, Math.min(lx, x)), y: Math.max(-ly, Math.min(ly, y)) };
}

/**
 * 刷怪点安全化：在 clampToMapBounds 的基础上再做一次"必须站得下"的吸附。
 *
 * 为什么需要：Tiled 对象坐标 + 环状随机偏移都可能落在墙上（mulberryForest 有
 * 56% 的格是阻挡），刷在墙里的怪会被碰撞判定锁住 —— 玩家看得见却打不到，
 * 或干脆在小地图上显示一个永远不动的红点。
 * 有网格时才吸附；无网格（fallback 图）返回原坐标，行为与旧版一致。
 */
function freeEnemySpot(x: number, y: number): { x: number; y: number } {
  const c = clampToMapBounds(x, y);
  if (!walkGrid) return c;
  const sp = snapEnemySpawn(walkGrid, c.x, c.y, ENEMY_COLLIDE_R);
  return sp ? { x: sp.x, y: sp.z } : c;
}

/**
 * ★ 关卡切换（Rotten-Soup changeLevels 等价）：
 *   加载目标地图 → 重建 chunk 索引 → 玩家挪到新图中心
 */
async function switchLevel(levelName: string): Promise<void> {
  if (levelSwitching.value) return;
  levelSwitching.value = true;
  switchingLevel.value = true;
  try {
    const next = await loadLevelByName(levelName);
    if (!next) {
      console.warn("[field-survival] 关卡不存在：", levelName);
      return;
    }
    mapCfg.value = next;
    currentLevelName.value = levelName;
    // ★ 重建碰撞网格（必须在 mapCfg.value 落地之后：尺寸守卫要用当前关卡尺寸）
    await rebuildWalkGrid(levelName);
    // 重建装饰 chunk 索引
    decorationsByChunk.clear();
    for (const d of next.decorations as Decoration[]) {
      const cx = Math.floor(d.x / 16);
      const cz = Math.floor(d.y / 16);
      const key = `${cx},${cz}`;
      if (!decorationsByChunk.has(key)) decorationsByChunk.set(key, []);
      decorationsByChunk.get(key)!.push(d);
    }
    mapDecorations.value = [];
    // 重建 chunk 系统（新地图尺寸）
    chunkSystem = new ChunkTerrainSystem(makeScaleFromMap(next));
    chunkSystem.init();
    chunkSystem.updateAroundPlayer(0, 0, performance.now());
    for (let i = 0; i < 30; i++) chunkSystem.tick();
    groundTileCache.clear();
    // 玩家挪到新地图中心
    // ★ 落点安全化：mulberryForest / oldForest / oldGraveyard 的**中心格就是墙**，
    //   不修正的话玩家一进图就被封死（网格碰撞会拒绝所有方向）。
    //   settleSpawn 在位置合法（主连通域 + 离 portal ≥3 米）时原样返回 (0,0)；
    //   否则挪到主连通域内最近的合规格。挪完立刻武装切图闸门，防止落点仍在圈内时反复切图。
    const s = state.value;
    const me = s?.entities.find((e) => e.side === "player");
    if (me) {
      const spawn = settleSpawn(0, 0);
      me.x = spawn.x;
      me.y = spawn.z;
      lastLocalPose = { x: me.x, y: me.y, facing: me.facing };
    }
    portalLatchPending = true;
    // 清掉本图野怪（旧图的怪不跟过来）
    if (s) s.entities = s.entities.filter((e) => e.side !== "enemy");
    // ★ game.md 68-69（刷新机制）：离开地图时记住"该图此刻的死怪"和离开时刻；
    //   30 秒内回来 → 死怪仍死（不刷新）；满 30 秒回来 → 死怪在出生点满血重生。
    //   同一张图内死亡怪永远不重生（"不离开地图不会刷新"）。
    {
      const now = Date.now();
      const prevLevel = currentLevelName.value;
      // 1) 旧图：本帧 entity 中所有已死的 mapmob_* 怪 → 记到 levelLeaveState
      //    Tiled id 在 entity id 第 3 段（mapmob_<TiledId>_<ts>），与 switchLevel 写入时一致
      const prevEnts = (s?.entities || []) as Array<any>;
      const deadIds = new Set<string>();
      for (const e of prevEnts) {
        if (e?.side === "enemy" && e.alive === false && typeof e.id === "string" && e.id.startsWith("mapmob_")) {
          const parts = e.id.split("_");
          if (parts.length >= 2) deadIds.add(parts[1]);
        }
      }
      levelLeaveState.set(prevLevel, { leftAt: now, deadIds });
      // 2) 新图：取上次的"死怪名单"，看是否满 30s
      const lastVisit = levelLeaveState.get(levelName);
      if (lastVisit) {
        const awayMs = now - lastVisit.leftAt;
        if (awayMs >= 30000) {
          // 满 30 秒 → 全活（清空）
          lastVisit.deadIds.clear();
        }
        pendingDeadMobIds = new Set(lastVisit.deadIds);
      } else {
        pendingDeadMobIds = new Set();
      }
    }
    // ★ 发布本关卡的 safe zone（standalone mockHost 据此判定"安全区"，
    //   避免继续使用 overworld.json 的整图 safe 区把森林也当成城镇）
    publishSafeZones(next);
    publishMapBounds(next);
    // ★ 从 Tiled 地图 Actors 层加载野怪（mulberryForest 的 GOBLIN / ORC 等）
    console.info("[field-survival] 加载关卡：", levelName, "mobs:", next.mobs?.length, next.mobs);
    if (s && next.mobs?.length) {
      for (const mob of next.mobs) {
        // ★ 档案表统一取自 mapConfig.MOB_ARCHETYPES（与地图白名单同一份数据）：
        //   未登记类型不再静默退化成 30/6 的"哥布林斥候"，而是告警 + 兜底
        let arch = MOB_ARCHETYPES[mob.entity_type];
        if (!arch) {
          console.warn(
            "[field-survival] mobTypeMap 缺少类型：", mob.entity_type, "→ 使用兜底档案（请补进 MOB_ARCHETYPES）",
          );
          arch = { name: mob.name || "野怪", hp: 30, atk: 6, level: 1 };
        }
        // ★ 等级：Tiled 对象 level 属性 > MOB_ARCHETYPES 默认值；HP/ATK 随等级按比例缩放
        const lv = mob.level ?? arch.level ?? 1;
        const lvScale = 1 + (lv - 1) * 0.3; // 每级 +30%
        const hpScaled = Math.floor(arch.hp * lvScale);
        // ★ 阵营（game.md）：地图对象 camp 属性 > entity_type 推断（mapConfig 已归一）。
        //   hostile → 敌对野怪（side enemy）；friendly → 友方（side ally，不组队不跟随）；
        //   neutral 在 mapConfig 已转为 NPC 装饰物，不会进 mobs。
        const camp = mob.camp || "hostile";
        const mobSide = camp === "friendly" ? "ally" : "enemy";
        // ★ 头顶显示（game.md）：类型中文名 + 可选姓名——「哥布林」/「哥布林(低阶湮物)」
        const zhName = ENTITY_TYPE_ZH[mob.entity_type] || arch.name;
        const mobLabel = mob.full_name ? `${zhName}(${mob.full_name})` : zhName;
        // ★ 修复③（坐标系统一）：Tiled 对象坐标按"瓦片数"直接当作米使用，
        //   必须夹进当前地图范围（如森林 60×40 → ±29 m），否则实体落在图外/宿主世界外，
        //   既进不了小地图视野，也进不了任何攻击射程。
        const mobPos = freeEnemySpot(mob.x, mob.y);
        // ★ game.md 68：<30s 离图回来 → 该 Tiled 怪保持死亡（pendingDeadMobIds 由
        //   switchLevel 上面的"记忆死亡怪"段写入）。这是按图记忆，不依赖 host。
        const revived = pendingDeadMobIds.has(String(mob.id));
        if (revived) pendingDeadMobIds.delete(String(mob.id));
        const enemyId = `mapmob_${mob.id}_${Date.now()}`;
        s.entities.push({
          id: enemyId,
          name: mobLabel,
          side: mobSide,
          x: mobPos.x,
          y: mobPos.y,
          vx: 0, vy: 0,
          hp: hpScaled, maxHp: hpScaled,
          mp: 0, maxMp: 0,
          exp: Math.floor(hpScaled * 0.5), expToNext: 0,
          level: lv,
          atk: Math.floor(arch.atk * lvScale),
          def: Math.floor((arch.atk * 0.3) * lvScale),
          facing: 180, cooldown: 0, alive: !revived,
          homeX: mobPos.x,
          homeY: mobPos.y,
          // ★ game.md 阵营/类型/姓名透传（头顶标签、角色面板敌对判定用）
          camp,
          entity_type: mob.entity_type,
          full_name: mob.full_name,
        } as any);
        if (revived) deadLocalEnemyIds.add(enemyId);
      }
      state.value.events.push(`[${next.name}] 发现 ${next.mobs.length} 只敌怪！`);
    }
    // ★ 从 Tiled 地图 Actors 层加载中立 NPC（mulberryTown 的 Mayor Leonard / Bar / NPC 等）。
    //   之前仅作为 kind=npc 装饰物 → 不在 entities 里 → updateNearChat() 找不到 → 不能对话。
    //   现在生成 side=neutral 实体：玩家走近 1.6m 内触发"💬 聊天"，sys_chat 走旁白 (entry.js:2522-2530)。
    if (s && next.npcs?.length) {
      // ★ 调试：把第一个 NPC 临时放到玩家旁边 1.5m 内，验证聊天按钮触发
      const me = s.entities.find((e) => e.side === "player");
      for (const npc of next.npcs) {
        const npcEntityId = `mapnpc_${npc.id}`;
        if (s.entities.some((e) => e.id === npcEntityId)) continue;
        // 安全落点（避开图纸边界 + 主角当前位置）
        const pos = freeEnemySpot(npc.x, npc.y);
        s.entities.push({
          id: npcEntityId,
          name: npc.displayName,
          side: "neutral",
          x: pos.x,
          y: pos.y,
          vx: 0, vy: 0,
          hp: 200, maxHp: 200,
          mp: 0, maxMp: 0,
          exp: 0, expToNext: 0,
          level: 1,
          atk: 0, def: 0,
          facing: 180, cooldown: 0, alive: true,
          homeX: pos.x,
          homeY: pos.y,
          // ★ 中立 NPC 标识：让前端走"无 sprite 装饰"的渲染分支
          camp: "neutral",
          entity_type: "NPC",
          // ★ 让 sprite 渲染走"装饰物 + name 显示"路径（头顶用 entity.name）
          npc_wanders: npc.wanders,
          // ★ 调试：第 0 个 NPC 强行挪到玩家 1.0m 内（CHAT_RADIUS_M=1.6m 内）
          _debug_near: me ? { origX: pos.x, origY: pos.y, meX: me.x, meY: me.y } : null,
        } as any);
      }
      // ★ 调试：第一个 NPC 移近玩家（临时验证）
      const firstNpc = s.entities.find((e) => typeof e.id === "string" && e.id.startsWith("mapnpc_"));
      if (firstNpc && me) {
        firstNpc.x = me.x + 0.8;
        firstNpc.y = me.y + 0.6;
      }
      state.value.events.push(`[${next.name}] 发现 ${next.npcs.length} 位 NPC！`);
      console.info("[field-survival] 已加载 NPC：", next.npcs.length, next.npcs);
    }
    state.value = s ? { ...s } : s;
    // ★ 把本图加载的地图怪物发布给 mockHost（standalone 下由 mock 接管 AI/结算）；
    //   同时 +1 世代号 → 下一次 tick 会把整份清单上报宿主（真实宿主下由宿主接管 AI/结算）
    publishLocalMapMobs();
    bumpLocalMobsEpoch();
    currentZoneName = null;
    zoneLeftTick = 0;
    zoneRespawnReady = true;
    console.info("[field-survival] 已切换到关卡：", levelName);
  } finally {
    levelSwitching.value = false;
    switchingLevel.value = false;
  }
}

/** Chunk 系统（按玩家位置动态加载/卸载装饰物） */
let chunkSystem: ChunkTerrainSystem | null = null;

// 初始化地图装饰物（从 mapCfg.decorations 读，fallback 用 §文件 hard-coded）
function initDecorations() {
  if (mapCfg.value?.decorations?.length) {
    // ★ 按 chunk 索引所有装饰（不一次性 push 到 mapDecorations.value）
    decorationsByChunk.clear();
    for (const d of mapCfg.value.decorations) {
      const dec = d as Decoration;
      const cx = Math.floor(dec.x / 16);  // CHUNK_SIZE_M = 16
      const cz = Math.floor(dec.y / 16);
      const key = `${cx},${cz}`;
      if (!decorationsByChunk.has(key)) decorationsByChunk.set(key, []);
      decorationsByChunk.get(key)!.push(dec);
    }
    mapDecorations.value = [];
    return;
  }
  const decs: Decoration[] = [];
  const rng = (a: number, b: number) => Math.random() * (b - a) + a;
  // 兜底用米范围（±1500）
  const W = 3000;
  const H = 3000;
  // 树木（9 棵，绿树/枯树交替）
  for (let i = 0; i < 9; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.45, H*0.45), kind: "tree", id: `tree_${i}`, variant: i % 2 });
  }
  // 水体（4 处）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(-W*0.4, W*0.4), y: rng(-H*0.4, H*0.4), kind: "water", id: `water_${i}` });
  }
  // 灌木（5 丛）
  for (let i = 0; i < 5; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.4, H*0.4), kind: "bush", id: `bush_${i}` });
  }
  // 蘑菇（4 朵）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.4, H*0.4), kind: "mushroom", id: `mush_${i}` });
  }
  // 花（7 处）
  for (let i = 0; i < 7; i++) {
    decs.push({ x: rng(W * 0.06, W * 0.94), y: rng(H * 0.13, H * 0.90), kind: "flower", id: `flower_${i}` });
  }
  // 血瓶（3 个）
  for (let i = 0; i < 3; i++) {
    decs.push({ x: rng(W * 0.08, W * 0.92), y: rng(H * 0.13, H * 0.87), kind: "pot", id: `pot_${i}` });
  }
  mapDecorations.value = decs;
}

/**
 * ★ v3 兜底：外部 mockHost 未启动时（被 Toonflow 编辑器 wrapper iframe 包装），
 *   state.entities 里只有玩家/盟友，看不到怪物。在玩家位置周围 30-100 米
 *   环形补 spawn 4-6 只野兽，让玩家开局立刻能看到。重复调用安全：检查
 *   state.entities 里是否已有 enemy，若有则跳过。
 */
/**
 * 区域刷新野怪
 * @param zoneData 区域数据（包含 refresh_rate, mob_types）
 * @param cx 玩家 x 坐标
 * @param cy 玩家 y 坐标
 */
function spawnZoneMobs(zoneData: any, cx: number, cy: number): void {
  const mobTypeMap: Record<string, { name: string; hp: number; atk: number }> = {
    wolf:     { name: "巨狼",       hp: 60, atk: 10 },
    boar:     { name: "野猪",       hp: 50, atk: 8 },
    skeleton: { name: "骷髅兵",     hp: 50, atk: 12 },
    goblin:   { name: "哥布林斥候", hp: 30, atk: 6 },
    snake:    { name: "毒蛇",       hp: 25, atk: 8 },
    bat:      { name: "蝙蝠",       hp: 20, atk: 5 },
  };
  const defaultTypes = ["wolf", "boar", "goblin"];
  const types = (zoneData.mob_types?.length ? zoneData.mob_types : defaultTypes);
  let seq = 0;
  for (let i = 0; i < 4; i++) {
    const typeKey = types[i % types.length];
    const arch = mobTypeMap[typeKey] ?? mobTypeMap["wolf"];
    const angle = Math.random() * Math.PI * 2;
    // ★ 修复③：环半径从 20-60 米收紧到 8-24 米（Tiled 小地图只有几十米见方，
    //   20 米外的刷新点会被夹到地图角落，玩家永远遇不到）
    const dist = 8 + Math.random() * 16;
    const id = `zone_${zoneData.name}_${Date.now()}_${seq++}`;
    const spot = freeEnemySpot(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
    state.value.entities.push({
      id, name: arch.name, side: "enemy",
      x: spot.x,
      y: spot.y,
      vx: 0, vy: 0,
      hp: arch.hp, maxHp: arch.hp,
      atk: arch.atk, level: 1,
      facing: 180, cooldown: 0, alive: true,
    });
  }
}

/**
 * 区域野怪刷新主逻辑
 */
function spawnLocalMobsIfNeeded(): void {
  if (!state.value || state.value.phase !== "playing") return;
  const me = state.value.entities.find((e) => e.side === "player");
  if (!me) return;

  // ★ 修复②（兜底补怪受地图校验约束）：兜底补怪只允许在"当前地图本身有野怪数据源"
  //   的图上启用。城镇 / 安全图（mulberryTown、overworld 等 mobs 数量为 0）绝不允许
  //   凭空补怪 —— 这是"所有地图都有野怪"的第二条来源。
  if (!mapCfg.value || !(mapCfg.value.mobs?.length)) return;

  const zones = ((state.value?.map?.zones?.length ? state.value.map.zones : mapCfg.value?.zones) || []) as Array<any>;
  const currentZone = zones.find((z) => {
    if (z.rx !== undefined && z.ry !== undefined) {
      return Math.abs(z.x - me.x) <= z.rx && Math.abs(z.y - me.y) <= z.ry;
    }
    return Math.hypot(z.x - me.x, z.y - me.y) <= z.r;
  });

  // ★ 修复（根因③）：原先"玩家所在区域 kind === 'safe' 就直接 return"。
  //   但 normalizeTiledMap 会为每张 Tiled 图生成中央城镇 safe 区，玩家进图即落在其中，
  //   于是兜底刷怪永不产出（森林里也一只不刷）。
  //   现改为按"视野半径内是否已有活着的敌怪"判定：安全区只保护玩家，不冻结世界刷新。
  const SPAWN_CLEAR_RADIUS_M = 45;
  const enemyInSight = state.value.entities.some(
    (e) => e.side === "enemy" && e.alive && Math.hypot(e.x - me.x, e.y - me.y) <= SPAWN_CLEAR_RADIUS_M,
  );
  if (enemyInSight) return;
  // 区域显式声明"不刷新"（refresh_rate=0）或是安全区：不在区内落怪，改到区外野地刷新
  const zoneBlocksSpawn = !!currentZone && (currentZone.kind === "safe" || currentZone.refresh_rate === 0);

  // 检查该区域野怪是否已全死
  const zoneEnemies = state.value.entities.filter((e) => {
    if (e.side !== "enemy") return false;
    const zoneName = (e as any).zoneName;
    return zoneName === currentZone?.name;
  });
  const allDead = zoneEnemies.length > 0 && zoneEnemies.every((e) => !e.alive);

  // 有活着的怪，不刷新
  if (zoneEnemies.some((e) => e.alive)) return;

  // 根据区域配置决定是否刷新
  if (currentZone && !zoneBlocksSpawn) {
    // 有区域配置：检查刷新计时
    if (!zoneRespawnReady && !allDead) return;
    spawnZoneMobs(currentZone, me.x, me.y);
    zoneRespawnReady = false;
    bumpLocalMobsEpoch();
    state.value.events.push(`[${currentZone.name}] 野怪刷新！`);
  } else {
    // 野外（无区域配置 / 安全区不落区内怪）：每 60 秒自动刷新
    //   ★ 不再用"场上任意位置有敌人"整体停刷（远处有怪也会把兜底刷怪压死）；
    //     是否刷新已由上方 45 米视野判定统一负责。
    const archetypes = [
      { name: "哥布林斥候", hp: 30, atk: 6 },
      { name: "巨狼",       hp: 60, atk: 10 },
      { name: "毒蛇",       hp: 25, atk: 8 },
      { name: "蝙蝠",       hp: 20, atk: 5 },
      { name: "骷髅兵",     hp: 50, atk: 12 },
    ];
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      const arch = archetypes[i % archetypes.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 70;
      const id = `localmob_${Date.now()}_${seq++}`;
      // ★ 刷新点：推出 safe zone 并夹进当前地图边界（否则可能刷在区内/图外永远遇不到）
      const rawSpot = pushOutsideSafeZones(me.x + Math.cos(angle) * dist, me.y + Math.sin(angle) * dist);
      const spot = freeEnemySpot(rawSpot.x, rawSpot.y);
      state.value.entities.push({
        id, name: arch.name, side: "enemy",
        x: spot.x,
        y: spot.y,
        vx: 0, vy: 0,
        hp: arch.hp, maxHp: arch.hp,
        atk: arch.atk, level: 1,
        facing: 180, cooldown: 0, alive: true,
      });
    }
    state.value.events.push(`[local-mob] 已 spawn 5 只野兽`);
  }
}

/* ============================================================
   ★ 墙体碰撞网格（对齐 Rotten-Soup 的 Tile.blocked()）
   ------------------------------------------------------------
   数据源：compiled_dawnlike.json 里每个 tile 的 properties.blocked。
   构建：把当前地图全部 tilelayer 叠加成 cols×rows 的 Uint8Array。
   判定：resolveGridMove() 分轴求解，撞墙可沿墙滑行。
   详见 collision.ts 顶部注释。
   ============================================================ */
let walkGrid: WalkGrid | null = null;
/** 网格世代号：每次重建自增，用于"只在新网格时上报给宿主"（敌人碰撞用） */
let walkGridEpochSeq = 0;
/** 连通域索引（出生点必须落在主连通域，否则会被困在封闭小口袋里） */
let walkIndex: WalkIndex | null = null;
let tileFlags: TileFlagTable | null = null;
/** 玩家碰撞半径（米）。沿用旧实现的 PLAYER_R = 0.4；1 格 = 1 米，故 0.4 不会卡门缝 */
const PLAYER_COLLIDE_R = 0.4;
/** 落点与 portal 的最小净空（米）。portal 触发半径是 2.5（见 localTick），
 *  留 3 米避免"一进图就被判进传送门，反复切图死循环"。 */
const PORTAL_CLEARANCE_M = 3;
/** portal 触发半径（米）——与 Rotten-Soup 的"踩到出口即切图"等价 */
const PORTAL_TRIGGER_M = 2.5;
/** 切图后闸门：必须"先走出所有触发圈"才允许再次触发。
 *  防任何原因（落点约束无解、玩家站着不动、宿主强行摆位）导致落点在圈内时无限切图。 */
let portalLatchPending = false;
/** 点击寻路连续被墙挡住的 tick 数（≥3 放弃本次 moveTo）。
 *  ★ 只在 A* 无解（目标不可达）时的直线兜底分支里生效 —— 有路径时不再需要。 */
let moveToBlockedTicks = 0;

/* ============================================================
   ★ 点击寻路（A*）
   ------------------------------------------------------------
   旧实现：朝目标点直线走，撞墙就左右滑，两轴都被挡 3 tick 就放弃。
   问题：点到墙后/隔着墙的目标永远走不到（Rotten-Soup 用 ROT.Path.AStar）。
   现实现：点下时在 WalkGrid 上跑 A* 得到路点队列，沿队列走；
           目标格站不下（点到了墙上）则自动改走主连通域内最近的可站格。
           无网格（fallback 图）或目标不可达 → 退回旧直线逻辑。
   ============================================================ */
let moveToPath: Array<{ x: number; y: number }> = [];
/** 路径缓存键（目标 + 关卡）：变化才重算，避免每 tick 跑 A* */
let moveToPathKey = "";
/** 本次 moveTo 是否 A* 无解（true → 用直线兜底 + 3 tick 放弃） */
let moveToUnreachable = false;

/** 点击地面特效（世界米坐标；t0 是 _animTick 起始帧，用于算进度） */
interface ClickFx {
  x: number;
  y: number;
  /** 可达（绿） / 不可达（红） */
  ok: boolean;
  t0: number;
}
let clickFxList: ClickFx[] = [];
/** 点击特效持续帧数（_animTick 是 60fps 帧计数 → 36 帧 ≈ 0.6 秒） */
const CLICK_FX_FRAMES = 36;

function clearMoveTo(): void {
  input.value.moveTo = null;
  moveToPath = [];
  moveToPathKey = "";
  moveToUnreachable = false;
  moveToBlockedTicks = 0;
}

/** 目标 + 关卡名 → 路径缓存键（换图 / 换目标才重算） */
function moveToKey(tx: number, ty: number): string {
  return `${currentLevelName.value}|${tx.toFixed(2)},${ty.toFixed(2)}`;
}

/**
 * 重算 A* 路径并写入 moveToPath。返回是否可达。
 * 无网格时返回 true（视为"直线可达"，由旧逻辑处理）。
 */
function recomputeMoveToPath(tx: number, ty: number): boolean {
  moveToPathKey = moveToKey(tx, ty);
  if (!walkGrid || !walkIndex) {
    moveToPath = [];
    moveToUnreachable = false;
    return true;
  }
  const me = state.value?.entities.find((e) => e.side === "player");
  if (!me) return false;
  const p = findPath(walkGrid, walkIndex, me.x, me.y, tx, ty);
  if (!p) {
    moveToPath = [];
    moveToUnreachable = true;
    return false;
  }
  moveToPath = p.map((pt) => ({ x: pt.x, y: pt.z }));
  moveToUnreachable = false;
  return true;
}

/** 沿 A* 路点走一步；路点走完 / 到达终点 → 结束本次 moveTo */
function followMoveToPath(me: Entity): boolean {
  while (moveToPath.length) {
    const wp = moveToPath[0];
    const ddx = wp.x - me.x;
    const ddy = wp.y - me.y;
    const d = Math.hypot(ddx, ddy);
    if (d < 0.22) { moveToPath.shift(); continue; }   // 已到该路点 → 取下一个
    const step = Math.min(d, LOCAL_MOVE_SPEED_M * TICK_DT);
    me.x += (ddx / d) * step;
    me.y += (ddy / d) * step;
    me.facing = (Math.abs(ddx) > Math.abs(ddy))
      ? (ddx > 0 ? 0 : 180)
      : (ddy > 0 ? 90 : 270);
    return true;
  }
  clearMoveTo();
  return false;
}

/* ============================================================
   ★ 战争迷雾（对齐 Rotten-Soup 的 Tile.visible() + ROT.FOV）
   ------------------------------------------------------------
   三层状态：未探索（全黑）/ 已探索但当前不可见（暗纱）/ 可见（清晰）。
   遮挡来自 walkGrid.vision（tileset 的 blocks_vision）——与远程武器的
   "光能过箭就能过"判定同源。
   实现：FOV 只在"玩家跨格"时重算；迷雾用 1 像素 = 1 格的离屏画布，
        渲染时整体放大成 1 次 drawImage（与 mapBake 的思路一致）。
   ============================================================ */
/** 玩家视野半径（米）。Rotten-Soup 火把约 7 格；这里取 13 米 ≈ 视野窗口的一半 */
const FOV_RADIUS_M = 13;
/** 已探索格（1 = 曾经看见过）——切图清空 */
let fogExplored: Uint8Array | null = null;
/** 当前可见格（玩家跨格时由 computeFov 重算） */
let fogVisible: Uint8Array | null = null;
/** 迷雾离屏画布（1 像素 = 1 格） */
let fogCanvas: HTMLCanvasElement | null = null;
let fogCtx: CanvasRenderingContext2D | null = null;
let fogImageData: ImageData | null = null;
/** 上次计算 FOV 的格坐标（相同则不重算，省 CPU） */
let lastFovCell = { gx: -999, gz: -999 };
let lastFovLevel = "";
/** 已探索比例（HUD 显示用） */
const fogExploredPct = ref(0);

/** 换图 / 首次建网格时重置迷雾缓冲 */
function resetFog(g: WalkGrid): void {
  if (fogCanvas && fogCanvas.width === g.cols && fogCanvas.height === g.rows) {
    fogExplored!.fill(0);
    fogVisible!.fill(0);
    fogCtx!.clearRect(0, 0, g.cols, g.rows);
    lastFovCell = { gx: -999, gz: -999 };
    return;
  }
  fogCanvas = document.createElement("canvas");
  fogCanvas.width = g.cols;
  fogCanvas.height = g.rows;
  fogCtx = fogCanvas.getContext("2d", { willReadFrequently: true });
  fogExplored = new Uint8Array(g.cols * g.rows);
  fogVisible = new Uint8Array(g.cols * g.rows);
  fogImageData = fogCtx ? fogCtx.createImageData(g.cols, g.rows) : null;
  lastFovCell = { gx: -999, gz: -999 };
}

/** 重算 FOV + 更新已探索标记 + 重绘迷雾位图（仅在玩家跨格时真正执行） */
function refreshFov(mx: number, mz: number): void {
  if (!fogEnabled.value || !walkGrid || !fogExplored || !fogVisible) return;
  const g = walkGrid;
  if (lastFovLevel !== currentLevelName.value) {
    lastFovLevel = currentLevelName.value;
    lastFovCell = { gx: -999, gz: -999 };
  }
  const c = metersToCell(g, mx, mz);
  if (c.gx === lastFovCell.gx && c.gz === lastFovCell.gz) return;
  lastFovCell = { gx: c.gx, gz: c.gz };

  fogVisible = computeFov(g, mx, mz, FOV_RADIUS_M);
  let seen = 0;
  for (let i = 0; i < fogExplored.length; i++) {
    if (fogVisible[i]) fogExplored[i] = 1;
    if (fogExplored[i]) seen++;
  }
  fogExploredPct.value = Math.round((seen / fogExplored.length) * 100);

  // 重绘位图：未探索 = 全黑；已探索但不可见 = 半透明暗纱；可见 = 透明
  const img = fogImageData && fogCtx && fogCanvas ? fogImageData : null;
  if (img && fogCtx) {
    const d = img.data;
    for (let i = 0; i < fogExplored.length; i++) {
      const o = i * 4;
      const a = fogVisible[i] ? 0 : (fogExplored[i] ? 168 : 255);
      d[o] = 6; d[o + 1] = 6; d[o + 2] = 10; d[o + 3] = a;
    }
    fogCtx.putImageData(img, 0, 0);
  }
}

/** 某世界米坐标当前是否可见（不可见 = 不画这个实体） */
function isVisibleAt(mx: number, mz: number): boolean {
  if (!fogEnabled.value || !walkGrid || !fogVisible) return true;
  const c = metersToCell(walkGrid, mx, mz);
  if (c.gx < 0 || c.gx >= walkGrid.cols || c.gz < 0 || c.gz >= walkGrid.rows) return false;
  return fogVisible[c.gz * walkGrid.cols + c.gx] === 1;
}

/* ============================================================
   ★ 敌人碰撞（前端统一收口）
   ------------------------------------------------------------
   背景：敌人位姿由宿主推进（真实宿主 entry.ts / standalone mockHost.ts），
   但墙的位置只有 iframe 侧知道（tileset 属性表 + 地图 JSON 都在前端解）。
   宿主把敌人直线推向玩家 → 穿墙、隔墙贴脸。

   做法：不把"宿主的绝对坐标"当结果，而是当成**每 tick 的意图位移**：
     D = 宿主本 tick 位置 − 宿主上一 tick 位置     ← 意图（方向 + 步长）
     F = stepWithAvoidance(grid, F_prev, D)       ← 在自己的位置积分，带碰撞 + 局部避障
   于是：
     ① 敌人永远不会落在墙里（F 一定合法）；
     ② 撞墙不是原地抖，而是沿墙绕行（stepWithAvoidance 会按"与期望方向最接近"
        的顺序试其余 7 个方向）；
     ③ 前端只消费意图，不与宿主的绝对坐标打架（不会出现回拉 / 瞬移）。
   兜底：宿主的位移过大（>1.2 米/tick = 传送，如安全区推出）或 F 与宿主偏离
        超过 3 米 → 直接以宿主位置为准并吸附到最近合法格。
   ============================================================ */
const ENEMY_COLLIDE_R = 0.38;
/** 单 tick 位移超过该值视为"传送"（正常追击 0.2~0.3 米/tick） */
const ENEMY_TELEPORT_M = 1.2;
/** F 与宿主位置的允许偏离上限（超出就对齐，防止长期漂移） */
const ENEMY_DRIFT_MAX_M = 3;
/** 每只怪的转向状态：宿主上一 tick 位置 + 前端积分出来的位置 */
const enemySteerState = new Map<string, { hostX: number; hostY: number; fx: number; fy: number }>();

/** 把一只怪对齐到宿主的合法位置（越界/墙里 → 吸附到最近的合法格） */
function alignEnemyToHost(e: Entity): void {
  // ★ 修复「野怪瞬移」：此前这里调 snapEnemySpawn(e.x, e.y) —— 宿主推来的坐标一旦落进
  //   障碍物（森林树冠），会在最多 8 环外重新搜一个「空闲格」并把怪瞬移过去，画面上
  //   就是野怪凭空跳几格。宿主侧已有 unstickEnemies + 碰撞收口保证位置合法，
  //   客户端只需忠实对齐宿主坐标，不再做第二次吸附。
  enemySteerState.set(e.id, { hostX: e.x, hostY: e.y, fx: e.x, fy: e.y });
}

/** 对宿主推来的敌怪数组做碰撞收口（就地改写 x/y；在 state.value 赋值前调用） */
function applyEnemyCollision(entities: Entity[]): void {
  if (!walkGrid) { enemySteerState.clear(); return; }
  const seen = new Set<string>();
  for (const e of entities) {
    if (!e || e.side !== "enemy" || e.alive === false) continue;
    seen.add(e.id);
    const hx = e.x;
    const hy = e.y;
    const prev = enemySteerState.get(e.id);
    if (!prev) { alignEnemyToHost(e); continue; }          // 新怪（首见）
    const dx = hx - prev.hostX;
    const dy = hy - prev.hostY;
    const dist = Math.hypot(dx, dy);
    const drift = Math.hypot(hx - prev.fx, hy - prev.fy);
    if (dist > ENEMY_TELEPORT_M || drift > ENEMY_DRIFT_MAX_M) { alignEnemyToHost(e); continue; }
    if (dist < 1e-6) {                                     // 宿主本 tick 没动（攻击/被挡）
      e.x = prev.fx;
      e.y = prev.fy;
      enemySteerState.set(e.id, { hostX: hx, hostY: hy, fx: prev.fx, fy: prev.fy });
      continue;
    }
    // ★ 修复（野怪进图后"消失"）：AvoidResult 的深度轴字段名是 z（collision.ts
    //   统一用 x/z），而实体模型用 y —— 这里曾写 `r.y`，恒为 undefined，
    //   于是每只怪被写成 y=undefined → 渲染/小地图的可见性判定全 false → 整图野怪
    //   看上去"没了"（实体其实还在，HUD 也还在数）。
    const r = stepWithAvoidance(walkGrid, prev.fx, prev.fy, dx, dy, dist, ENEMY_COLLIDE_R);
    e.x = r.x;
    e.y = r.z;
    enemySteerState.set(e.id, { hostX: hx, hostY: hy, fx: r.x, fy: r.z });
  }
  for (const id of Array.from(enemySteerState.keys())) if (!seen.has(id)) enemySteerState.delete(id);
}

/**
 * 依据当前地图重建碰撞网格。读 getTiledRaw()（normalizeTiledMap 落的原始 Tiled JSON），
 * 所以必须在 loadMapConfig / loadLevelByName 之后调用。
 * 取不到 tileset 属性 → walkGrid 置空 → 自动降级为"无阻挡"（与旧行为一致，不会崩）。
 */
async function rebuildWalkGrid(levelLabel = ""): Promise<void> {
  walkGrid = null;
  walkIndex = null;
  // ★ 网格重建 → 世代号自增，下一次 tick 一定会把新网格重发给宿主
  walkGridEpochSeq++;
  const tiled = getTiledRaw();
  if (!tiled) return;
  // ★ 一致性守卫：getTiledRaw() 是模块级缓存，地图走 fallback 分支时它会残留上一张图。
  //   尺寸对不上就认为不是当前地图 → 不建网格（宁可无碰撞，也不要错位的墙）。
  const cfgSize = mapCfg.value?.size;
  const tW = Number((tiled as any).width) || 0;
  const tH = Number((tiled as any).height) || 0;
  if (cfgSize && (tW !== cfgSize[0] || tH !== cfgSize[1])) {
    console.warn(
      `[field-survival] Tiled 原始数据尺寸 ${tW}×${tH} 与当前关卡 ${cfgSize[0]}×${cfgSize[1]} 不一致` +
        "（可能是 fallback 关卡）→ 本次不启用碰撞",
    );
    return;
  }
  try {
    if (!tileFlags) tileFlags = await loadTileFlags();
    if (!tileFlags || Object.keys(tileFlags).length === 0) return;
    walkGrid = await buildWalkGridAsync(tiled as any, tileFlags, 1);
    if (!walkGrid) return;
    walkIndex = buildWalkIndex(walkGrid, PLAYER_COLLIDE_R);
    // ★ 换图重置战争迷雾（已探索标记不跨图继承）
    resetFog(walkGrid);
    const comp = walkIndex.sizes[walkIndex.largest] ?? 0;
    console.info(
      `[field-survival] 碰撞网格（${levelLabel || currentLevelName.value}）：${gridStats(walkGrid)}；` +
        `主连通域 ${comp} 格 / 共 ${walkIndex.sizes.length - 1} 个连通域`,
    );
  } catch (err) {
    walkGrid = null;
    walkIndex = null;
    console.warn("[field-survival] 碰撞网格构建失败 → 降级为无阻挡：", err);
  }
}

/**
 * 决定关卡落点 —— 薄封装：真正的策略在 collision.pickSpawn（唯一真相源，
 * 可被离线仿真直接调用，避免测试与线上两套代码漂移）。这里只负责：
 *   1. 把 portal 列表 + 净空常量喂进去；
 *   2. 打日志 + 打警告。
 *
 * 落点规则（详见 collision.ts 的 pickSpawn）：
 *   ① 原坐标（通常是 (0,0) 地图中心）在主连通域且离 portal ≥3 米 → 原样用；
 *   ② 否则挪到主连通域内最近的合规格；
 *   ③ 净空无解的极小图 → 只保连通域（并 warn）；
 *   ④ 网格全墙 → 保持原位，靠 resolveMove 的自解困放行。
 *
 * 两条硬约束都是仿真发现的，不靠读代码：
 *   ★ 连通域：mulberryForest 中心旁有个仅 4 格的封闭口袋，只按"最近可走格"落点
 *     会让玩家 6000 tick 只走过 4 格（= 被困死）。
 *   ★ 净空：地图标注的 PLAYER 在 mulberryForest / mulberryGraveyard / lichLair 里
 *     离切图触发点只有 1.00 米，而触发半径 2.5 米 → 用它当落点会一进图就反复切图。
 */
function settleSpawn(mx: number, mz: number): { x: number; z: number } {
  if (!walkGrid || !walkIndex) return { x: mx, z: mz };
  const portals = (mapCfg.value?.decorations || [])
    .filter((d: any) => (d as any).kind === "portal")
    .map((d: any) => ({ x: d.x as number, z: d.y as number }));
  const pick = pickSpawn(walkGrid, walkIndex, mx, mz, {
    avoid: portals,
    clearance: PORTAL_CLEARANCE_M,
  });
  if (pick.relocated) {
    console.info(
      `[field-survival] 落点 (${mx.toFixed(1)}, ${mz.toFixed(1)}) 不满足落点约束 → 挪到 ` +
        `(${pick.x.toFixed(1)}, ${pick.z.toFixed(1)})（主连通域 ${walkIndex.sizes[walkIndex.largest]} 格，` +
        `最近 portal ${pick.avoidDist.toFixed(2)} 米）`,
    );
  }
  if (!pick.clearanceOk && portals.length > 0) {
    console.warn(
      `[field-survival] 本图找不到离 portal ≥${PORTAL_CLEARANCE_M} 米的落点` +
        `（实际 ${pick.avoidDist.toFixed(2)} 米）→ 已退化为只保连通域；` +
        "切图闸门 portalLatchPending 会兜住「一进图就反复切图」",
    );
  }
  return { x: pick.x, z: pick.z };
}

/**
 * 客户端权威 tick（★ 单一数据源）
 *
 * 设计：玩家位姿（x/y/facing）只在 game.html 内推进一次（每 100ms 一 tick），
 *   再把结果通过 sendTick 的 player 字段上报宿主；宿主只做镜像、不再重复积分，
 *   消除"前端 0.3 米/帧 + 宿主 3 米/帧"双写导致的位移回退 / 松手瞬移。
 * 速度：与 entry.ts 的 MOVE_SPEED_M 同为 3 米/秒（一 tick 位移 0.3 米）。
 * 边界：与 entry.ts clampX/clampY 对齐，取 ±1490 米。
 */
const LOCAL_MOVE_SPEED_M = 3;     // 米/秒（与 entry.ts MOVE_SPEED_M 一致）
const TICK_DT = 0.1;              // 与 loop() 的 TICK_MS=100 对应
// ★ 按地图实际大小自适应 WORLD_LIMIT（不再硬编码 ±1500）
let worldLimitCache = { w: 0, h: 0, limit: 0 };
function worldLimitM(): number {
  const cfg = mapCfg.value;
  if (!cfg) return 1490;
  const w = cfg.size?.[0] ?? 3000;
  const h = cfg.size?.[1] ?? 3000;
  if (worldLimitCache.w === w && worldLimitCache.h === h) return worldLimitCache.limit;
  const limit = Math.max(w, h) / 2 - 1;
  worldLimitCache = { w, h, limit };
  return limit;
}
/** 区域刷新机制 */
const DETECTION_RADIUS_M = 10;      // 脱战检测半径（米）
const ZONE_RESPAWN_SEC = 45;       // 离开区域后刷新野怪时间（秒）
const TICK_RATE_MS = 100;          // tick 间隔（毫秒）
/** 本地权威位姿缓存：宿主 state 推回时用它覆盖宿主侧玩家坐标（防回退） */
let lastLocalPose: { x: number; y: number; facing: number } | null = null;
/** 区域刷新追踪 */
let currentZoneName: string | null = null;       // 玩家当前所在区域
let zoneLeftTick: number = 0;                    // 离开区域的 tick 时间
let zoneRespawnReady = false;                    // 是否可以刷新该区域野怪

function localTick(): void {
  if (!state.value || state.value.phase !== "playing") return;
  const s = state.value;
  // 1. 推进玩家位置（全流程唯一积分点）
  const me = s.entities.find((e) => e.side === "player");
  if (me) {
    // ★ 记录本 tick 起始位置：位移算完后再交给网格碰撞求解（分轴拒绝 / 沿墙滑行）
    const beforeX = me.x;
    const beforeZ = me.y;
    const dx = input.value.dx;
    const dy = input.value.dy;
    if (dx !== 0 || dy !== 0) {
      // 斜向归一化：任意方向速度一致
      const len = Math.hypot(dx, dy) || 1;
      me.x += (dx / len) * LOCAL_MOVE_SPEED_M * TICK_DT;
      me.y += (dy / len) * LOCAL_MOVE_SPEED_M * TICK_DT;
      // facing 统一角度制：0=右 90=下 180=左 270=上（与渲染层 dirIndex / facingLeft 一致）
      me.facing = (dx > 0 ? 0 : dx < 0 ? 180 : dy > 0 ? 90 : 270);
      // 摇杆接管 → 放弃点击寻路（含路径队列）
      if (input.value.moveTo || moveToPath.length) clearMoveTo();
    } else if (input.value.moveTo) {
      // ★ 点击寻路：优先沿 A* 路点走；无网格或 A* 无解 → 退回直线 + 3 tick 放弃
      const tx = input.value.moveTo.x;
      const ty = input.value.moveTo.y;
      const key = moveToKey(tx, ty);
      if (key !== moveToPathKey) recomputeMoveToPath(tx, ty);   // 目标变了 / 换图了 → 重算
      if (!moveToUnreachable && walkGrid && walkIndex) {
        followMoveToPath(me);        // 内部：路点走完会 clearMoveTo
      } else {
        // 直线兜底（无网格的 fallback 图 / A* 无解）：撞墙由下面的 3-tick 兜底放弃
        const ddx = tx - me.x;
        const ddy = ty - me.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist < 0.3) clearMoveTo();
        else {
          const step = Math.min(dist, LOCAL_MOVE_SPEED_M * TICK_DT);
          me.x += (ddx / dist) * step;
          me.y += (ddy / dist) * step;
          me.facing = (Math.abs(ddx) > Math.abs(ddy))
            ? (ddx > 0 ? 0 : 180)
            : (ddy > 0 ? 90 : 270);
        }
      }
    }
    // 松手立即停止：清空速度，宿主侧不会再产生余速滑行
    me.vx = 0;
    me.vy = 0;
    // 限制玩家在世界范围内（±1490，与 entry.ts 一致）
    me.x = Math.max(-worldLimitM(), Math.min(worldLimitM(), me.x));
    me.y = Math.max(-worldLimitM(), Math.min(worldLimitM(), me.y));

    // —— 旧版装饰物推挤（★ 仅在无 Tiled 网格时生效）——
    //   Tiled 真实关卡里 decorations 只含 NPC / portal（无 tree/fence），这段本来就不触发；
    //   有 walkGrid 时改由 tileset 的 blocked 属性统一裁决，
    //   否则"圆形推挤"可能把玩家推进墙里，与网格判定打架。
    if (!walkGrid) {
      const PLAYER_R = 0.4;
      const OBSTACLE_R = 0.5;
      const decos = mapCfg.value?.decorations || [];
      for (const dec of decos) {
        // mulberry 风格：9298 木桩作为边界围墙（与树同效）
        if (dec.kind !== "tree" && dec.kind !== "dead_tree" && dec.kind !== "fence") continue;
        const dx = me.x - dec.x;
        const dy = me.y - dec.y;
        const d = Math.hypot(dx, dy);
        const minDist = PLAYER_R + OBSTACLE_R;
        if (d < minDist && d > 0.001) {
          // 推回到刚好不撞的位置
          const push = (minDist - d);
          me.x += (dx / d) * push;
          me.y += (dy / d) * push;
        } else if (d <= 0.001) {
          // 玩家与障碍完全重合，极端情况，往上推 0.1 米
          me.y += 0.1;
        }
      }
    }

    // ============================================================
    // ★ 地形碰撞（对齐 Rotten-Soup 的 Tile.blocked()）：墙 / 水 / 树 / 栅栏等
    //   一律来自 tileset 的 blocked 属性，见 collision.ts。
    //   分轴求解 → 撞墙后仍可沿墙滑行；起点已在墙里则放行（自解困）。
    // ============================================================
    if (walkGrid) {
      const res = resolveGridMove(walkGrid, beforeX, beforeZ, me.x, me.y, PLAYER_COLLIDE_R);
      me.x = res.x;
      me.y = res.z;
      // ★ 只有"直线兜底"分支才需要 3-tick 放弃：
      //   有 A* 路径时（moveToUnreachable=false）撞墙只是暂时的，绕行逻辑会处理；
      //   无解时两轴都被挡说明真的过不去，贴着墙空推没意义 → 放弃。
      if (input.value.moveTo && moveToUnreachable && res.hitX && res.hitZ) {
        if (++moveToBlockedTicks >= 3) clearMoveTo();
      } else {
        moveToBlockedTicks = 0;
      }
    }

    // ★ 战争迷雾：位置定稿后刷新 FOV（内部按"跨格"节流，同格直接 return）
    refreshFov(me.x, me.y);

    // 记录本地权威位姿，供 onHostState 覆盖宿主回推值
    lastLocalPose = { x: me.x, y: me.y, facing: me.facing };
  }

  // ★ 关卡切换：走到出口箭头（portal）2.5 米内 → 加载目标地图（Rotten-Soup changeLevels 等价）
  //   闸门 portalLatchPending：切图后必须先走出所有触发圈，才重新武装。
  //   否则若落点恰好≤2.5 米（净空约束无解的极小图 / 宿主强行摆位），会每 tick 切一次图。
  if (!levelSwitching.value) {
    const meNow = s.entities.find((e) => e.side === "player");
    const portals = (mapCfg.value?.decorations || []).filter((d: any) => (d as any).kind === "portal");
    const distTo = (p: any) => Math.hypot(p.x - (meNow?.x ?? 0), p.y - (meNow?.y ?? 0));
    if (portalLatchPending) {
      // 重新武装条件：已离开所有触发圈
      if (!portals.some((p: any) => distTo(p) < PORTAL_TRIGGER_M)) portalLatchPending = false;
    } else {
      for (const p of portals) {
        if (distTo(p) < PORTAL_TRIGGER_M) {
          void switchLevel((p as any).name);
          break;
        }
      }
    }
  }

  // 区域刷新追踪（支持圆形和矩形区域）
  const meForZone = s.entities.find((e) => e.side === "player");
  const zones = (state.value?.map?.zones?.length ? state.value.map.zones : mapCfg.value?.zones) || [];
  const zone = zones.find((z: any) => {
    if (!meForZone) return false;
    // 优先用矩形范围（rx/ry），否则用圆形（r）
    if (z.rx !== undefined && z.ry !== undefined) {
      return meForZone.x >= z.x - z.rx && meForZone.x <= z.x + z.rx &&
             meForZone.y >= z.y - z.ry && meForZone.y <= z.y + z.ry;
    }
    return Math.hypot(z.x - meForZone.x, z.y - meForZone.y) <= z.r;
  });
  const zoneName = zone?.name ?? null;
  if (zoneName !== currentZoneName) {
    if (currentZoneName !== null && zoneRespawnReady === false) {
      // 离开了区域，启动 45 秒计时器
      zoneLeftTick = s.tick;
      zoneRespawnReady = false;
    }
    currentZoneName = zoneName;
  }
  // 检查是否 45 秒已过（每 tick = 100ms）
  if (zoneLeftTick > 0 && !zoneRespawnReady) {
    const elapsedSec = ((s.tick - zoneLeftTick) * TICK_DT);
    if (elapsedSec >= ZONE_RESPAWN_SEC) {
      zoneRespawnReady = true;
      zoneLeftTick = 0;
    }
  }

  // ★ chunk 系统：每 tick 推进一次（玩家移动后更新 loaded_chunks）
  if (chunkSystem && lastLocalPose) {
    chunkSystem.updateAroundPlayer(lastLocalPose.x, lastLocalPose.y, performance.now());
    chunkSystem.tick();
  }
  // 2. 推进 tick 计数
  s.tick = (s.tick || 0) + 1;
  // 2.1 动作小跳衰减（ms 减 TICK_DT_MS；mockHost 模式下 100ms/tick，dev-host 走 vite.config.ts）
  for (const e of s.entities) {
    if ((e as any).actionBobMs && (e as any).actionBobMs > 0) {
      (e as any).actionBobMs = Math.max(0, (e as any).actionBobMs - 100);
    }
  }
  // 3. 定期补 spawn 野兽（每 600 tick = 60 秒一波）— mockHost 跑的时候这步无效（会跳过已有 enemy）
  if (s.tick % 600 === 0) spawnLocalMobsIfNeeded();
}

// 方向索引（pixi_game 约定）：0=下 1=左 2=右 3=上
// ★ facing 统一角度制：0=右 90=下 180=左 270=上（与 localTick / 渲染层一致，原映射左右互换）
function dirIndex(facing: number): number {
  const d = ((facing % 360) + 360) % 360;
  if (d >= 315 || d < 45)  return 2;  // 右
  if (d >= 45  && d < 135) return 0;  // 下
  if (d >= 135 && d < 225) return 1;  // 左
  return 3;                            // 上
}

// 动画帧索引（用时间戳循环）
let _animTick = 0;
function animFrame(phase: "walk" | "idle"): number {
  if (phase === "idle") return 0;
  // 4帧循环
  return Math.floor(_animTick / 8) % 4;
}

/* ---------------- 动画（与 Rotten-Soup 一致：永远 2 帧 walk 循环） ---------------- */
// 不需要 isMoving——所有 sprite 都用 walk 帧循环播放（约 16 FPS）。
// _animTick 在 loop() 里每帧 ++，每 8 tick 切换一次帧。

/* ---------------- 尺寸基准（★ v4：以「地格」为唯一尺度基准，对齐 Rotten-Soup） ----------------
 * Rotten-Soup 的 sprite 与地面图块同为 32×32：角色、树、灌木在画面里都占「1 格」，
 * 所以人与树差不多高、剪影都清晰可辨 —— 比例天然协调。
 * toonflow v1~v3 曾用"米 × ppm"给角色定 1.6~1.8 米、树定 2.6×3.0 米，
 * 两者都远离"1 格"这一基准，于是"比例完全失衡、各种东西都很诡异"。
 * v4 起一律用格数描述尺寸：屏幕像素 = 格数 × sx（每格像素），随 zoom 等比缩放。
 * ----------------------------------------------------------------------------------- */
/**
 * 角色显示尺寸（单位：地表格，1 格 = 1 米）
 *
 * 对照 Rotten-Soup（32×32 图块）：角色、树、灌木在画面里都占「1 格」——
 * 所以人与树差不多高、各自剪影清晰可辨。toonflow 旧实现把角色放大到 1.6~1.8 格、
 * 树放大到 2.6×3.0 格，两者都远离 1 格基准，于是"比例完全失衡、各种东西都很诡异"。
 * v4 改为以「格」为唯一尺度基准：屏幕像素 = 格数 × sx（每格像素），随 zoom 等比缩放。
 */
const ENTITY_DIM_TILES: Record<string, number> = {
  player:      1.00,  // 金甲战士（与地格同尺寸，与树同级）
  ally:        1.00,  // 蓝袍法师
  enemy_char:  1.05,  // 持枪骑士
  // 野怪：族内保留体型差，但不偏离"1 格级"，避免大小怪一样大
  goblin:   0.95,
  orc:      1.15,
  rat:      0.70,
  goat:     1.00,
  snake:    0.85,
  bat:      0.75,
  skeleton: 1.05,
  minotaur: 1.45,     // boss
};

/**
 * 场景道具显示尺寸（单位：地表格）——树 / 灌木 / 水面都是 1 格级，与角色同一尺度基准。
 * 树略高（1.15 格）以保证剪影可读，但与角色同量级，不再出现"树比人高一倍"的失衡。
 */
const SCENE_PROP_DIM_TILES: Record<string, { w: number; h: number }> = {
  tree:  { w: 1.15, h: 1.15 },
  bush:  { w: 1.00, h: 1.00 },
  water: { w: 1.00, h: 1.00 },
};

/** 实体显示尺寸（格 → 屏幕像素，1:1 宽高；取整保证"每格整数像素"，避免非整数缩放接缝） */
function fitDim(key: string, sx: number): { w: number; h: number } {
  const t = ENTITY_DIM_TILES[key] ?? 1.0;
  const px = Math.max(4, Math.round(t * sx));
  return { w: px, h: px };
}

/** 道具尺寸（格 → 屏幕像素；minPx 仅防极端情况归零） */
function propDimPx(kind: "tree" | "bush" | "water", sx: number, minPx = 8): { w: number; h: number } {
  const t = SCENE_PROP_DIM_TILES[kind] || { w: 1.0, h: 1.0 };
  return { w: Math.max(minPx, Math.round(t.w * sx)), h: Math.max(minPx, Math.round(t.h * sx)) };
}

/**
 * ★ fix③：实体"显示位置"插值
 *
 * 宿主推送（postMessage / HTTP 桥）的到达节奏与渲染帧率（60fps）不一致，且可能成批补发；
 * 直接把推送坐标画出来，就是"长时间不动 → 一帧跳一段"的瞬移观感（用户反馈的
 * "松手后野怪瞬间跳到旁边"正是这种阶跃）。
 * 这里给每个实体维护一个显示位置，按帧向权威位置收敛：
 *   - 常规移动：指数收敛（时间常数 DISPLAY_TAU_S），把阶跃磨成平滑滑动；
 *   - 位移较大（推送成批补发）：按 DISPLAY_MAX_STEP_MPS 限速滑动，绝不出现"一帧跳一段"；
 *   - 位移超过 DISPLAY_SNAP_M（真传送 / 新实体）：直接吸附，避免长距离拖尾。
 *   - 玩家本身不插值（相机用的就是它的权威坐标，插值会导致画面与相机错位）。
 */
/**
 * ★ fix①：移动端性能档位
 *  判定：UA 含 Android/iPhone/iPad/… 或「触摸设备 + 短边 ≤ 820px」（手机/平板 WebView）。
 *  该档位下：渲染帧率封顶 30fps、tick 上报降到 5Hz、插值时间常数放宽。
 */
const IS_MOBILE = (() => {
  try {
    const ua = navigator.userAgent || "";
    const mobileUA = /Android|iPhone|iPad|iPod|HarmonyOS|Windows Phone|Mobile/i.test(ua);
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const sw = (window.screen && window.screen.width) || 9999;
    const sh = (window.screen && window.screen.height) || 9999;
    return mobileUA || (touch && Math.min(sw, sh) <= 820);
  } catch { return false; }
})();

/** ★ fix①：移动端渲染帧间隔（约 30fps）；桌面端 0 = 不限制（跟随 rAF） */
const MIN_FRAME_MS = IS_MOBILE ? 33 : 0;
/** ★ fix①：移动端向宿主上报 tick 的间隔（宿主只镜像位姿，5Hz 足够；本地 tick 仍 10Hz） */
const SEND_MS = IS_MOBILE ? 200 : 100;

const DISPLAY_TAU_S = IS_MOBILE ? 0.16 : 0.08;  // 收敛时间常数（秒）：移动端上报更稀，放宽以免一顿一顿
const DISPLAY_MAX_STEP_MPS = 15;    // 显示位置追赶速度上限（米/秒）：位移大时限速，磨掉阶跃
const DISPLAY_SNAP_M = 25;          // 单帧位移阈值（米）：超过视为真传送，直接吸附
const displayPos = new Map<string, { x: number; y: number }>();
let lastRenderAt = 0;
const avatarScaleFactor = 2.5; // 头像相对角色格子尺寸系数

function entityDisplayPos(e: Entity, dtSec: number): { x: number; y: number } {
  let cur = displayPos.get(e.id);
  if (!cur) {
    // 新出现的实体：首次直接落在权威位置（不做从原点滑入）
    cur = { x: e.x, y: e.y };
    displayPos.set(e.id, cur);
    return cur;
  }
  const dx = e.x - cur.x;
  const dy = e.y - cur.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.0001) return cur;
  if (d > DISPLAY_SNAP_M) {
    // 真传送：一步到位
    cur.x = e.x;
    cur.y = e.y;
    return cur;
  }
  const dt = Math.max(dtSec, 0.001);
  let k = 1 - Math.exp(-dt / DISPLAY_TAU_S);
  const maxK = (DISPLAY_MAX_STEP_MPS * dt) / d;   // 单帧追赶上限
  if (k > maxK) k = maxK;
  cur.x += dx * k;
  cur.y += dy * k;
  return cur;
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, avatarImg?: HTMLImageElement, sx?: number, sy?: number, ppm?: number) {
  // ★ v3：sx/sy 是外部算好的屏幕像素位置（不参与 ctx.scale）
  // 缺省时回退到 e.x / e.y（米），保证非世界变换下的旧调用仍能工作
  const px = (sx ?? (e.x + W_DEFAULT / 2));
  const py = (sy ?? (e.y * DEPTH + H_DEFAULT / 2));
  // ★ v3：sprite 尺寸 = 米数 × ppm（与 zoom 关联，随 zoom 缩放）
  const pixelsPerMeter = (ppm ?? 20);
  // ★ 根据 side 选择 sprite key（角色从 tileset 切片，支持 2 帧 walk 动画）
  const key = e.side === "player" ? "player"
            : e.side === "ally"   ? "ally"
            : e.side === "neutral" ? "ally"     // ★ v4：城镇中立角色用友方 sprite，避免显示成敌人
            : "enemy_char";
  // ★ 永远 walk 帧循环（与 Rotten-Soup 一致：sprite.animationSpeed=0.065）
  const tileId = spriteTileId(key, _animTick);
  // ★ v5 修正：fitDim 返回的已是「屏幕像素」（格数 × sx），此处严禁再乘一次
  //   pixelsPerMeter（历史 bug：tile 数 × sx² 会把角色放大到 400~1024px）。
  //   与 drawMonster 的 dw = 格数 × ppm 保持完全一致的口径。
  const dim = fitDim(key, pixelsPerMeter);
  const dw = dim.w;
  const dh = dim.h;
  // ★ VFX：动作小跳（释放技能/攻击/物品时，sprite y 偏移 0 → -4 → 0 弧线）
  let bobOffset = 0;
  if (e.actionBobMs && e.actionBobMs > 0) {
    const t = e.actionBobMs / 300;          // 1 → 0（剩余时间比例）
    bobOffset = -Math.sin(t * Math.PI) * 4; // 0 → -4 → 0
  }
  const dx = px - dw / 2;
  const dy = py - dh + 4 + bobOffset;      // 略微下沉，让脚站在地面上

  // ★ 朝向：facing 在 135-315（朝左）时水平翻转 sprite
  const facingLeft = (e.facing >= 135 && e.facing < 315);

  applyPixelPerfect(ctx);

  // 阴影（脚底）
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px, py + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 精灵本体（从 tileset 切片，按移动状态切换 walk 帧；facing 决定翻转）
  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh, !facingLeft);
  } else {
    // 兜底彩色胶囊
    const color = e.side === "player" ? "#4ea1ff"
      : e.side === "ally" ? "#5fd28a"
      : e.side === "enemy" ? "#ff6b6b"
      : e.side === "neutral" ? "#e0c86a"
      : "#9aa4b2";
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(px, py - 24, facingLeft ? -16 : 16, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ★ 受击红闪：sprite 区域用半透明红覆盖（source-atop：只覆盖已有像素）
  if (e.hitFlashMs && e.hitFlashMs > 0) {
    const alpha = Math.min(0.85, (e.hitFlashMs / 250) * 0.85);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "#ff3a3a";
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }

  // ★ 角色头像（req.md：2.5D 小人模型上方显示头像 + 角色名）
  // 布局自上而下：头像(30) → 名字 → sprite
  const avatarSize = Math.max(14, Math.min(100, Math.round(dw * avatarScaleFactor)));  // ★ v4：随角色尺寸（≈0.8 格）
  const avatarX = px - avatarSize / 2;
  const avatarY = dy - avatarSize - 16;
  // ★ fix⑥：动图头像优先取「当前动画帧」，静态图仍走 HTMLImageElement
  const avatarPath = entityAvatarPath(e);
  const animFrame = avatarAnimFrame(avatarPath);
  const hasAvatar = !!animFrame || (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0);
  if (hasAvatar) {
    applyPixelPerfect(ctx);
    ctx.save();
    // 头像底色（遮住背后内容）
    ctx.fillStyle = "#1e1f1f";
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    // 圆形裁剪绘制头像
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(animFrame ?? avatarImg!, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
    // 头像边框（不同阵营不同颜色）
    ctx.save();
    ctx.strokeStyle = e.side === "player" ? "#4ea1ff" : e.side === "ally" ? "#5fd28a" : "#ff4c4c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 头顶名字 + 等级（敌人额外显示 Lv.X；头像上方居中）
  // ★ game.md：带姓名的野怪显示「哥布林(低阶湮物)」全称（放宽截断），其余维持 4 字短标签
  // ★ NPC（mapnpc_* / entity_type=NPC）全名显示（如 "Mayor Leonard" / "Bar"），不截到 4 字
  const isMapNpc = typeof e.id === "string" && e.id.startsWith("mapnpc_");
  const headLabel = e.full_name
    ? e.name.slice(0, 14)
    : isMapNpc
      ? e.name.slice(0, 10)   // NPC：保留 10 字（Mayor Leonard / 镇长老白）
      : e.name.slice(0, 4);
  const headY = hasAvatar ? avatarY - 4 : dy - 18;
  ctx.save();
  ctx.textAlign = "center";
  // 名字
  ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillText(headLabel, px + 1, headY + 1);
  ctx.fillStyle = e.side === "enemy" ? "#ffd4d4" : "#fff";
  ctx.fillText(headLabel, px, headY);
  // ★ 等级（仅敌人显示，红色字体放在名字右侧）
  if (e.side === "enemy" && e.level) {
    const lvlText = "Lv" + e.level;
    ctx.font = "bold 10px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.85)";
    ctx.fillText(lvlText, px + 1, headY + 13);
    ctx.fillStyle = "#ff5252";
    ctx.fillText(lvlText, px, headY + 12);
  }
  ctx.restore();

  // 血条 - 紧贴 sprite 下边缘（屏幕像素）
  const barW = Math.max(24, Math.round(dw) + 2), barH = 4;
  const barX = px - barW / 2;
  const barY = py + 8; // 在脚底
  ctx.save();
  // 边框
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  // 背景
  ctx.fillStyle = "#3a0d0d";
  ctx.fillRect(barX, barY, barW, barH);
  // 前景
  const hpRatio = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = e.side === "enemy" ? "#d63b3b" : "#4ec74e";
  ctx.fillRect(barX, barY, barW * hpRatio, barH);
  ctx.restore();
}

// ----------------------------------------------------------
// 绘制野怪（Rotten-Soup 32×32 像素艺术）
// ★ 严格保持原图比例（不变形）：
//   bear content 24×30 → 0.8 → dh=40 → dw=32
//   beast content 32×30 → 1.067 → dh=40 → dw=42
// ----------------------------------------------------------
function drawMonster(ctx: CanvasRenderingContext2D, e: Entity, sx?: number, sy?: number, ppm?: number) {
  // ★ v3：sx/sy 是屏幕像素位置
  const px = (sx ?? (e.x + W_DEFAULT / 2));
  const py = (sy ?? (e.y * DEPTH + H_DEFAULT / 2));
  // ★ v3：sprite 尺寸 = 米数 × pixelsPerMeter（随 zoom 缩放）
  const pixelsPerMeter = (ppm ?? 20);
  // ★ 根据野怪名字映射到 tileset monster tile
  //   game.md：优先按 entity_type 精确映射（头顶已显示中文名+姓名，中文名不再承担 sprite 映射职责）
  const key = ENTITY_SPRITE_KEY[e.entity_type || ""] || mobKeyFor(e.name);
  // ★ 永远 walk 帧循环（Rotten-Soup 风格）
  const tileId = spriteTileId(key, _animTick);
  // 等比缩放（米数 × pixelsPerMeter → 屏幕像素）
  const targetTiles = ENTITY_DIM_TILES[key] ?? 1.0;   // ★ v4：格数基准（与角色/树同尺度）
  const dw = Math.max(4, Math.round(targetTiles * pixelsPerMeter));
  const dh = Math.max(4, Math.round(targetTiles * pixelsPerMeter));
  // ★ VFX：动作小跳（野怪发动攻击时也跳一下）
  let bobOffset = 0;
  if (e.actionBobMs && e.actionBobMs > 0) {
    const t = e.actionBobMs / 300;
    bobOffset = -Math.sin(t * Math.PI) * 4;
  }
  const dx = px - dw / 2;
  const dy = py - dh + 4 + bobOffset;

  applyPixelPerfect(ctx);

  // 阴影
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px, py + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh);
  } else {
    // 兜底：棕色圆
    ctx.save();
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.ellipse(px, py - 16, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ★ 受击红闪（与角色一致）
  if (e.hitFlashMs && e.hitFlashMs > 0) {
    const alpha = Math.min(0.85, (e.hitFlashMs / 250) * 0.85);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "#ff3a3a";
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }

  // ★ 头顶名字 + 等级（game.md：「哥布林(低阶湮物)」+ Lv.X，画在血条上方）
  //   带姓名的野怪放宽截断（14 字），其余维持 6 字短标签
  const mobLabel = e.name.slice(0, e.full_name ? 14 : 6);
  ctx.save();
  ctx.textAlign = "center";
  // 名字（血条上方）
  ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillText(mobLabel, px + 1, dy - 25);
  ctx.fillStyle = "#ffd4d4";
  ctx.fillText(mobLabel, px, dy - 26);
  // 等级（名字下方、血条上方）
  if (e.level) {
    const lvlText = "Lv" + e.level;
    ctx.font = "bold 10px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.85)";
    ctx.fillText(lvlText, px + 1, dy - 11);
    ctx.fillStyle = "#ff5252";
    ctx.fillText(lvlText, px, dy - 12);
  }
  ctx.restore();

  // 血条
  const barW = Math.max(24, Math.round(dw) + 2), barH = 4;
  const barX = px - barW / 2;
  const barY = dy - 6;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = "#3a0d0d";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = "#d63b3b";
  ctx.fillRect(barX, barY, barW * Math.max(0, e.hp / e.maxHp), barH);
  ctx.restore();
}

/* ============================================================
   VFX 粒子层（战斗特效）
   ============================================================ */

/** 渲染所有 VFX 粒子（屏幕像素空间） */
function drawVfxLayer(
  ctx: CanvasRenderingContext2D,
  vfx: any[] | undefined,
  wx2px: (x: number) => number,
  wz2py: (y: number) => number,
): void {
  if (!vfx || vfx.length === 0) return;
  for (const p of vfx) {
    // ★ 跟随移动：vfx 存了 entityId（通常是玩家）→ 每帧用玩家当前 x/y 渲染，
    //   否则特效永远留在创建时的位置，玩家走了就脱离身体。
    let baseX = p.x, baseY = p.y;
    if (p.entityId) {
      const ent = (state as any)?.entities?.find?.((e: any) => e.id === p.entityId);
      if (ent) { baseX = ent.x; baseY = ent.y; }
    }
    const px = wx2px(baseX);
    const py = wz2py(baseY);
    const progress = 1 - (p.life / p.total); // 0 → 1
    switch (p.kind) {
      case "slash_arc":  drawSlashArc(ctx, px, py, progress); break;
      case "fireball": {
        // 弹体：把 target 世界米转成屏幕像素再插值
        let baseTx = p.targetX, baseTy = p.targetY;
        if (p.targetEntityId) {
          const ent2 = (state as any)?.entities?.find?.((e: any) => e.id === p.targetEntityId);
          if (ent2) { baseTx = ent2.x; baseTy = ent2.y; }
        }
        const tx = baseTx != null ? wx2px(baseTx) : px;
        const ty = baseTy != null ? wz2py(baseTy) : py;
        drawFireballPx(ctx, px, py, tx, ty, progress, p.color || "#ff8c3a");
        break;
      }
      case "heal_ring":  drawHealRing(ctx, px, py, progress, p.color || "#5fe57a"); break;
      case "buff_ring":  drawBuffRing(ctx, px, py, progress, p.color || "#f5c542"); break;
      case "explosion":  drawExplosion(ctx, px, py, progress, p.color || "#ff8c3a"); break;
      case "spark":      drawSpark(ctx, px, py, progress, p.color || "#fff"); break;
    }
  }
}

/* ============================================================
   ★ 点击地面反馈层
   ------------------------------------------------------------
   三样东西（都是屏幕像素绘制，与实体同层之上）：
     1) 点击涟漪：从点击点扩散的双环 + 中心点，绿=可达 / 红=不可达
     2) A* 路径：从玩家到目标点的虚线（帮助确认寻路真的绕开了墙）
     3) 目标标记：脉冲圆环 + 中心十字，移动中一直显示
   ============================================================ */
function drawClickFxLayer(
  ctx: CanvasRenderingContext2D,
  wx2px: (mx: number) => number,
  wz2py: (mz: number) => number,
  sx: number,
): void {
  // —— 1) 点击涟漪 ——
  clickFxList = clickFxList.filter((f) => _animTick - f.t0 < CLICK_FX_FRAMES);
  for (const f of clickFxList) {
    const p = (_animTick - f.t0) / CLICK_FX_FRAMES;   // 0 → 1
    const px = wx2px(f.x);
    const py = wz2py(f.y);
    const color = f.ok ? "140, 224, 122" : "255, 107, 107";
    ctx.save();
    // 外环：扩散 + 淡出
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.9;
    ctx.strokeStyle = `rgb(${color})`;
    ctx.lineWidth = Math.max(2, (1 - p) * 4);
    ctx.beginPath();
    ctx.arc(px, py, (0.25 + p * 1.5) * sx, 0, Math.PI * 2);
    ctx.stroke();
    // 内环：稍慢一圈（双层更有"咚"的落地感）
    const p2 = Math.max(0, p - 0.22) / 0.78;
    if (p2 > 0) {
      ctx.globalAlpha = Math.max(0, 1 - p2) * 0.65;
      ctx.lineWidth = Math.max(1.5, (1 - p2) * 3);
      ctx.beginPath();
      ctx.arc(px, py, (0.15 + p2 * 0.95) * sx, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 中心实心点：前 35% 才显示（"落点"的锚）
    if (p < 0.35) {
      ctx.globalAlpha = (1 - p / 0.35) * 0.95;
      ctx.fillStyle = `rgb(${color})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, sx * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
    // 不可达：加一个叉，明确"过不去"
    if (!f.ok && p < 0.8) {
      ctx.globalAlpha = Math.max(0, 1 - p / 0.8) * 0.9;
      ctx.strokeStyle = `rgb(${color})`;
      ctx.lineWidth = Math.max(2, sx * 0.09);
      const r = sx * 0.22;
      ctx.beginPath();
      ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
      ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
      ctx.stroke();
    }
    ctx.restore();
  }

  // —— 2) A* 路径虚线（只在本次 moveTo 有效时画；有路径才画）——
  const me = state.value?.entities.find((e) => e.side === "player");
  if (me && input.value.moveTo && moveToPath.length) {
    ctx.save();
    ctx.setLineDash([Math.max(3, sx * 0.18), Math.max(3, sx * 0.18)]);
    ctx.lineWidth = Math.max(2, sx * 0.07);
    ctx.strokeStyle = "rgba(255, 236, 150, 0.55)";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(wx2px(me.x), wz2py(me.y) - sx * 0.25);
    for (const wp of moveToPath) ctx.lineTo(wx2px(wp.x), wz2py(wp.y) - sx * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  // —— 3) 目标标记（脉冲圆环 + 十字）——
  if (input.value.moveTo) {
    const px = wx2px(input.value.moveTo.x);
    const py = wz2py(input.value.moveTo.y);
    const pulse = 0.75 + 0.25 * Math.sin(_animTick / 6);
    const ring = Math.max(4, sx * 0.38 * pulse);
    ctx.save();
    ctx.strokeStyle = moveToUnreachable ? "rgba(255,107,107,.85)" : "rgba(140,224,122,.9)";
    ctx.lineWidth = Math.max(1.5, sx * 0.06);
    ctx.beginPath();
    ctx.arc(px, py, ring, 0, Math.PI * 2);
    ctx.stroke();
    const cr = Math.max(2, sx * 0.16);
    ctx.beginPath();
    ctx.moveTo(px - cr, py); ctx.lineTo(px + cr, py);
    ctx.moveTo(px, py - cr); ctx.lineTo(px, py + cr);
    ctx.stroke();
    ctx.restore();
  }
}

/** 弧形斩波：1/4 圆弧白刃，旋转消失 */
function drawSlashArc(ctx: CanvasRenderingContext2D, px: number, py: number, p: number): void {
  ctx.save();
  const r = 26 + p * 12;     // 弧半径
  const alpha = Math.max(0, 1 - p * 1.1);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255,255,255,0.6)";
  ctx.shadowBlur = 8;
  // 弧从 -90° 扫到 0°，绕身体右侧
  ctx.beginPath();
  ctx.arc(px, py - 12, r, -Math.PI / 2, 0, false);
  ctx.stroke();
  // 次弧淡出（淡黄色拖尾）
  ctx.strokeStyle = "rgba(255,220,120,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py - 12, r - 4, -Math.PI / 2 + 0.3, -0.3, false);
  ctx.stroke();
  ctx.restore();
}

/** 火球：橙→红弹体 + 3 个拖尾粒子（屏幕像素空间） */
function drawFireballPx(ctx: CanvasRenderingContext2D, px: number, py: number, tx: number, ty: number, p: number, color: string): void {
  ctx.save();
  const dx = tx - px, dy = ty - py;
  const e = p;
  const ax = px + dx * e, ay = py + dy * e;
  const alpha = Math.max(0, 1 - p * 0.9);
  // 拖尾（3 个粒子）
  for (let i = 1; i <= 3; i++) {
    const t = Math.max(0, e - i * 0.06);
    const tx2 = px + dx * t, ty2 = py + dy * t;
    ctx.globalAlpha = alpha * (1 - i / 4) * 0.5;
    ctx.fillStyle = "#ffaa55";
    ctx.beginPath();
    ctx.arc(tx2, ty2 - 8, 8 - i * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 弹体
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  const grad = ctx.createRadialGradient(ax, ay - 8, 2, ax, ay - 8, 12);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, "rgba(120,30,0,0.2)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ax, ay - 8, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 治疗/补蓝环：向外扩张 + 淡出 */
function drawHealRing(ctx: CanvasRenderingContext2D, px: number, py: number, p: number, color: string): void {
  ctx.save();
  const r = 8 + p * 32;
  const alpha = Math.max(0, 1 - p * 1.1);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(px, py - 12, r, 0, Math.PI * 2);
  ctx.stroke();
  // 第二圈
  ctx.globalAlpha = alpha * 0.5;
  ctx.beginPath();
  ctx.arc(px, py - 12, r * 0.65, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Buff 环：六边形描边 */
function drawBuffRing(ctx: CanvasRenderingContext2D, px: number, py: number, p: number, color: string): void {
  ctx.save();
  const r = 14 + p * 8;
  const alpha = Math.max(0, 1 - p);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + p * 0.5; // 慢速旋转
    const x = px + Math.cos(a) * r;
    const y = (py - 12) + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** 爆炸：3 圈扩散 */
function drawExplosion(ctx: CanvasRenderingContext2D, px: number, py: number, p: number, color: string): void {
  ctx.save();
  const alpha = Math.max(0, 1 - p * 0.95);
  for (let i = 0; i < 3; i++) {
    const r = 10 + p * (40 + i * 14);
    ctx.globalAlpha = alpha * (1 - i / 4);
    ctx.strokeStyle = i === 0 ? "#ffffff" : color;
    ctx.lineWidth = 4 - i;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 - i * 3;
    ctx.beginPath();
    ctx.arc(px, py - 12, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 中央填充
  ctx.globalAlpha = alpha * 0.6;
  const grad = ctx.createRadialGradient(px, py - 12, 2, px, py - 12, 22 + p * 16);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, "rgba(120,30,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py - 12, 24 + p * 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 火花/小亮点 */
function drawSpark(ctx: CanvasRenderingContext2D, px: number, py: number, p: number, color: string): void {
  ctx.save();
  const alpha = Math.max(0, 1 - p * 1.5);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(px, py - 12, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
/* ---------------- 地表噪声（多样化地表，模块级纯函数） ---------------- */

/** 二维格点 hash → [0,1) */
function hash2(ix: number, iz: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 二维 value-noise（双线性 + smoothstep 插值）→ [0,1)，cell 为米 */
function valueNoise2D(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/**
 * 世界坐标（米）→ 地表 tile id（草地 / 泥土 / 沙地）
 *
 * ★ v6：对照 Rotten-Soup 的实测地表构成（其 maps 里主草图块 id=7864 占各地图地表
 *   76.9%，其余图块都只占几个百分点）——即"一个无缝主块铺满 + 大尺度稀疏变体"。
 *   - biome（约 26 米）决定该处是 草 / 泥 / 沙；
 *   - tone （约 12 米）只在该地貌内部二选一，且必须是同色系、无缝平铺的相邻块。
 * v5 仍出现棋盘格的根因：旧表把「纯色平滑块 7149」与「强纹理块 9378」按 3 米噪声
 * 对半混铺，每 3 格就跳一次"纯色 ↔ 纹理"，等于把图块的方形边界画在地上；v6 换用
 * Rotten-Soup 自己的主草块并把变体降到约 1/4、尺度拉到 12 米，消除该跳变。
 */
function pickGroundTile(tiles: number[], t: number): number {
  const idx = t < GROUND_TONE_SPLIT ? 0 : 1;
  return tiles[Math.min(tiles.length - 1, idx)];
}

function groundTileAt(wx: number, wz: number): number {
  const biome = valueNoise2D(wx, wz, GROUND_BIOME_SCALE_M, 11);
  const tone = valueNoise2D(wx, wz, GROUND_TONE_SCALE_M, 23);
  if (biome < GROUND_SAND_MAX) return pickGroundTile(GROUND_SAND_TILES, tone);
  if (biome < GROUND_DIRT_MAX) return pickGroundTile(GROUND_DIRT_TILES, tone);
  return pickGroundTile(GROUND_GRASS_TILES, tone);
}

/* ---------------- ★ fix① 地面图块记忆化缓存 ---------------- */
/** 缓存键 = (gx+32768)*65536 + (gz+32768)；世界格号 ±1500 ≪ 32768，无碰撞 */
const groundTileCache = new Map<number, number>();
const GROUND_TILE_CACHE_MAX = 20000;
function groundTileAtFast(gx: number, gz: number): number {
  const key = (gx + 32768) * 65536 + (gz + 32768);
  const hit = groundTileCache.get(key);
  if (hit !== undefined) return hit;
  const v = groundTileAt(gx * GROUND_CELL_M, gz * GROUND_CELL_M);
  if (groundTileCache.size >= GROUND_TILE_CACHE_MAX) groundTileCache.clear();
  groundTileCache.set(key, v);
  return v;
}

function render() {
  const c = canvasEl.value;
  const s = state.value;
  if (!c || !s) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  // ★ fix⑤：位图缓冲 = 逻辑尺寸 × k（k = 显示尺寸 × DPR / 逻辑尺寸）。
  //   逻辑坐标系保持原设计值，下面所有像素常量（头像 40px、字号、线宽）视觉大小
  //   完全不变，只是位图密度提到物理像素级 → 不再被浏览器放大搞糊。
  const k = renderScale.value > 0 ? renderScale.value : 1;
  const W = Math.round(c.width / k);
  const H = Math.round(c.height / k);
  ctx.setTransform(k, 0, 0, k, 0, 0);

  /* ============================================================
     相机数学（来自 map_config.json + zoom 系统）
       view_radius_m = def_view_max * (default_zoom / zoom)
       在 zoom=20 时，看到 ±15 米（30×30）窗口
       玩家坐标 → 屏幕坐标：pixel = (entity.x - player.x) * ppm + W/2
       使用 ctx.transform 把世界米坐标自动投影为屏幕像素
     ============================================================ */
  const ts = terrainScale.value;
  const pp = playerPos.value;
  const [vw, vh] = ts.viewSizeMeters(zoom.value);
  // pixel-per-meter：纵向按 DEPTH 做视角压缩（DEPTH=1 即等距俯视）
  const ppm_x = W / vw;
  const ppm_y = H / (vh * DEPTH);
  // ★ v4：取整为"每米整数像素"——地块 / 精灵都落在整数像素边界上，
  //   避免非整数缩放带来的接缝、摩尔纹与逐像素游动（世界格与地表格严格对齐）。
  // ★ v5：改为「覆盖式」取较大比值（对应 Rotten-Soup 的 stage 缩放基准 px/米），
  //   保证 1 格 = 1 米 = 整数像素时精灵与图块 1:1 贴图（默认 zoom=20 → 32px，
  //   与 Rotten-Soup tileSize=32 一致）；若取 min 会得到 20px，
  //   画布两侧多出 9m 无实体区域且图块被 0.625 非整数缩小，产生新接缝。
  const sx = Math.max(4, Math.round(Math.max(ppm_x, ppm_y)));
  const sy = sx;

  // ★ 动态同步 ready 状态（data URL 图片解码完成时）
  for (const sheet of [SHEET_TILESET, SHEET_PLAYER, SHEET_ALLY, SHEET_ENEMY_CHAR]) {
    if (!sheet.ready && sheet.img.complete && sheet.img.naturalWidth > 0) {
      sheet.ready = true;
    }
  }

  ctx.clearRect(0, 0, W, H);

  // ★ 地图边界（米）：Tiled 城镇图按实际尺寸；老 fallback 图保持 ±1500
  const cfgMap = mapCfg.value;
  const mapMinX = cfgMap ? -cfgMap.size[0] / 2 : -1500;
  const mapMaxX = cfgMap ? cfgMap.size[0] / 2 : 1500;
  const mapMinY = cfgMap ? -cfgMap.size[1] / 2 : -1500;
  const mapMaxY = cfgMap ? cfgMap.size[1] / 2 : 1500;

  // ★ 地图 zones（map-gener agent 产出 + mulberryTown.json 静态数据）：
  // 不同 kind 不同色调椭圆区域。画在相机变换内。
  // ★ v4：新增区域 kind 配色（城镇安全区 + 6 个野区；旧 kind 保留兼容）
  const kindColors: Record<string, string> = {
    safe: "rgba(94, 210, 138, .18)",
    danger: "rgba(255, 80, 80, .18)",
    loot: "rgba(224, 178, 74, .2)",
    quest: "rgba(110, 168, 254, .18)",
    forest: "rgba(94, 178, 106, .14)",
    shore: "rgba(96, 176, 196, .14)",
    mine: "rgba(178, 150, 96, .14)",
    ruin: "rgba(168, 132, 168, .14)",
    marsh: "rgba(110, 156, 128, .14)",
    wild: "rgba(196, 156, 96, .14)",
  };
  const allZones = (s.map?.zones?.length ? s.map.zones : mapCfg.value?.zones) || [];

  /* ============================================================
     关键修复：放弃 ctx.scale 世界变换，全部改用屏幕像素空间画
     每个 item 自己算 worldToScreen(mx, mz) → 屏幕 (px, py)
     sprite 尺寸常量保持「像素」单位（不会再被 sx 缩放成几十米）
     ============================================================ */
  const wx2px = (mx: number) => (mx - pp.x) * sx + W / 2;       // 世界米 X → 屏幕像素 X
  const wz2py = (mz: number) => (mz - pp.y) * sx * DEPTH + H / 2; // 世界米 Z → 屏幕像素 Y（带 2.5D 压缩）
  const m2px = (m: number) => m * sx;                           // 任意米数 → 屏幕像素

  /* ============ 地面渲染（两条路径）============
     A) Tiled 城镇图（mulberryTown）：整图已烘焙（mapBake），每帧 1 次 drawImage —— 流畅的关键
     B) 无 Tiled 原始数据（fallback 图）：噪声地表平铺（地图边界外纯黑） */
  const tiledRaw = getTiledRaw();
  const baked = (tiledRaw && SHEET_TILESET.ready)
    ? bakeTiledMap(tiledRaw as any, currentLevelName.value, SHEET_TILESET.img)
    : null;

  if (baked) {
    // A) 烘焙图贴屏：世界米 → 烘焙像素（地图中心 = 烘焙图中心）
    const bakeScale = sx / baked.meterToBakePx;            // 屏幕px / 烘焙px
    const bakeW = baked.canvas.width * bakeScale;
    const bakeH = baked.canvas.height * bakeScale;
    const mapOriginPx = wx2px(-baked.cols / 2);            // 地图左上角世界坐标 → 屏幕
    const mapOriginPy = wz2py(-baked.rows / 2);
    ctx.imageSmoothingEnabled = false;                      // 像素风禁插值
    ctx.drawImage(baked.canvas, mapOriginPx, mapOriginPy, bakeW, bakeH);
  } else if (SHEET_TILESET.ready) {
    // B) 噪声地表平铺（fallback）
    const cellPx = Math.max(4, Math.round(GROUND_CELL_M * sx));
    const minWX = (pp?.x ?? 0) - W / (2 * sx);
    const minWZ = (pp?.y ?? 0) - H / (2 * sx);
    const gx0 = Math.floor(minWX / GROUND_CELL_M);
    const gz0 = Math.floor(minWZ / GROUND_CELL_M);
    const originX = Math.round((gx0 * GROUND_CELL_M - minWX) * sx);
    const originZ = Math.round((gz0 * GROUND_CELL_M - minWZ) * sx);
    const nx = Math.ceil(W / cellPx) + 2;
    const nz = Math.ceil(H / cellPx) + 2;
    for (let j = 0; j < nz; j++) {
      const gzj = gz0 + j;
      const ty = originZ + j * cellPx;
      for (let i = 0; i < nx; i++) {
        const gx = gx0 + i;
        const wx = gx * GROUND_CELL_M;
        const wz = gzj * GROUND_CELL_M;
        if (wx < mapMinX - 1 || wx > mapMaxX || wz < mapMinY - 1 || wz > mapMaxY) continue;
        drawTile(ctx, groundTileAtFast(gx, gzj), originX + i * cellPx, ty, cellPx, cellPx);
      }
    }
  } else {
    // 兜底渐变（暗泥土色，Rotten-Soup 风格）
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a2418");
    g.addColorStop(1, "#1a1208");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // —— zones（米 → 像素）——
  allZones.forEach((z) => {
    const zx_px = wx2px(z.x);
    const zy_px = wz2py(z.y);
    const r_px  = m2px(z.r);
    const ry_px  = r_px;   // ★ v4：DEPTH=1 → 正圆，不再纵向压扁
    ctx.save();
    ctx.fillStyle = kindColors[(z as any).kind] || "rgba(255,255,255,.06)";
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(zx_px, zy_px, r_px, ry_px, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.font = "bold 12px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.name, zx_px, zy_px - 4);
    ctx.restore();
  });

  // ★ v4：城镇（安全区）建筑 —— 由宿主 state.town.buildings 驱动
  //   w/h 现在是瓦片数（与 Rotten-Soup mulberryTown.json 同构），
  //   按 Dawnlike tileset 真实像素平铺绘制：屋顶 + 墙体 + 门 / 窗 + 地面。
  const townExtra = (s as unknown as {
    town?: { name?: string; x?: number; y?: number; r?: number; buildings?: Array<{ id: string; kind?: string; name?: string; x: number; y: number; w: number; h: number }> };
  }).town;
  if (townExtra && Array.isArray(townExtra.buildings) && townExtra.buildings.length) {
    // 远景：缩放过小（< 8 px / tile）时只画一个色块 + 名字，避免 4x4 像素的屋顶拼出来全是噪点
    const lowDetail = sx < 8;
    if (lowDetail) {
      const blockColor: Record<string, string> = {
        inn:   "#7c4b3a",
        shop:  "#5c5340",
        house: "#6b4a3a",
        well:  "#3f4a52",
      };
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.fillRect(bxx - bw / 2 + 2, byy - bh / 2 + 3, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = blockColor[b.kind || "house"] || blockColor.house;
        ctx.fillRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.strokeStyle = "rgba(20,14,8,.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.restore();
      });
    } else if (SHEET_TILESET.ready) {
      // tileset 已就绪 → 用真实像素艺术（与 Rotten-Soup mulberryTown.json 同构）
      townExtra.buildings.forEach((b) => drawTownBuildingTiles(ctx, b, sx, wx2px, wz2py));
    } else {
      // 兜底：tileset 未就绪时的纯色块（与旧版一致）
      const blockColor: Record<string, string> = {
        inn:   "#7c4b3a",
        shop:  "#5c5340",
        house: "#6b4a3a",
        well:  "#3f4a52",
      };
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        const fill = blockColor[b.kind || "house"] || blockColor.house;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.fillRect(bxx - bw / 2 + 2, byy - bh / 2 + 3, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fill;
        ctx.fillRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.strokeStyle = "rgba(20,14,8,.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.restore();
      });
    }
    // 建筑名（任意缩放都画，缩放过小时省略字体）
    if (sx >= 8) {
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        ctx.save();
        ctx.fillStyle = "rgba(255,246,214,.92)";
        ctx.font = `bold ${Math.max(9, Math.min(13, Math.round(sx * 0.55)))}px 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(b.name || "", bxx, byy - bh / 2 - 4);
        ctx.restore();
      });
    }
  }

  // —— 土路（道路网络）——
  //   ★ 整段禁用：用户反馈十字土块（tile 7765）影响视觉；
  //     实际城镇/野外地图有完整的 Tiled tilelayer + decorations.fence，
  //     不需要再额外画"水平 y=0 / 垂直 x=0"的道路网络。
  if (false && SHEET_TILESET.ready) {
    const isOutdoorMap = (currentLevelName.value || "").match(/Town|Forest|Graveyard|Overworld/i);
    if (isOutdoorMap) {
      const roadW = Math.max(1, Math.round(1.5 * sx));
      // 水平路
      ctx.save();
      for (let x = -30; x <= 30; x++) {
        const pxr = wx2px(x);
        drawTile(ctx, 7765, pxr, wz2py(0) - roadW / 2, sx, roadW);
      }
      // 垂直路
      for (let z = -30; z <= 30; z++) {
        const pyr = wz2py(z);
        drawTile(ctx, 7765, wx2px(0) - roadW / 2, pyr, roadW, sx);
      }
      ctx.restore();
    }
  }

  // —— 装饰物（树/枯树/灌木/蘑菇/花/水/石/药水，按像素尺寸）——
  // ★ 视野过滤：只渲染屏幕可见范围附近的装饰（mulberry 后总量 4369+，否则每帧遍历爆卡）
  const viewRadiusX_m = vw / 2 + 4;  // 米
  const viewRadiusY_m = vh / 2 + 4;
  const pxCenter = pp?.x ?? 0;
  const pyCenter = pp?.y ?? 0;
  // ★ 按区域加载 + 视野渲染：只遍历当前 loaded_chunks 内的装饰（mulberry 4369 → 当前 ~几十）
  //   双层循环：chunk × 装饰，每层都做距离粗筛
  if (chunkSystem) {
    for (const chunkKey of chunkSystem.loaded_chunks) {
      const chunkDecs = decorationsByChunk.get(chunkKey);
      if (!chunkDecs) continue;
      for (const dec of chunkDecs) {
        if (Math.abs(dec.x - pxCenter) > viewRadiusX_m) continue;
        if (Math.abs(dec.y - pyCenter) > viewRadiusY_m) continue;
        renderOneDecoration(ctx, dec, wx2px(dec.x), wz2py(dec.y), sx);
      }
    }
  } else {
    // 兜底：chunkSystem 未初始化时退化为遍历全量
    for (const dec of mapDecorations.value) {
      if (Math.abs(dec.x - pxCenter) > viewRadiusX_m) continue;
      if (Math.abs(dec.y - pyCenter) > viewRadiusY_m) continue;
      renderOneDecoration(ctx, dec, wx2px(dec.x), wz2py(dec.y), sx);
    }
  }

  // —— 宝箱（像素尺寸 32×34）——
  s.chests.forEach((ch) => {
    const dh = Math.round(1.10 * sx), dw = Math.round(1.15 * sx);
    const cx = wx2px(ch.x);
    const cy = wz2py(ch.y);
    ctx.save();
    if (ch.opened) ctx.globalAlpha = 0.55;
    if (SHEET_TILESET.ready) {
      drawTile(ctx, ch.opened ? TILE_CHEST_OPEN_ID : TILE_CHEST_ID, cx - dw / 2, cy - dh + 4, dw, dh);
    } else {
      ctx.fillStyle = ch.opened ? "rgba(160,150,120,.5)" : "#e0b24a";
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.lineWidth = 2;
      ctx.fillRect(cx - 14, cy - 14, 28, 22);
      ctx.strokeRect(cx - 14, cy - 14, 28, 22);
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ch.opened ? "空" : "宝箱", cx, cy - 20);
    ctx.restore();
  });

  // —— 血瓶（像素尺寸 16×24）——
  s.potions.forEach((p) => {
    const dh = Math.round(0.90 * sx), dw = Math.round(0.60 * sx);
    const cx = wx2px(p.x);
    const cy = wz2py(p.y);
    if (SHEET_TILESET.ready) {
      drawTile(ctx, TILE_POTION_ID, cx - dw / 2, cy - dh + 4, dw, dh);
    } else {
      ctx.save();
      ctx.fillStyle = "#ff5d7a";
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+", cx, cy + 4);
    ctx.restore();
  });

  // ============================================================
  // ★ 战争迷雾（对齐 Rotten-Soup 的 Tile.visible() + ROT.FOV）
  //   画在地形/区域/装饰之上、实体之下：
  //     · 未探索 → 全黑；已探索但当前不可见 → 半透明暗纱；可见 → 透明
  //     · 实体层在其上，且"不可见格的实体"在下面被跳过 → 看不到墙后的怪
  //   性能：迷雾位图（1 像素 = 1 格）在 FOV 变化时才重绘，
  //         本帧只有 1 次 drawImage（与 mapBake 同思路）。
  // ============================================================
  if (fogEnabled.value && fogCanvas && walkGrid && fogVisible) {
    const fogOriginPx = wx2px(-walkGrid.cols / 2);
    const fogOriginPy = wz2py(-walkGrid.rows / 2);
    const fogW = walkGrid.cols * sx;
    const fogH = walkGrid.rows * sx * DEPTH;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fogCanvas, fogOriginPx, fogOriginPy, fogW, fogH);
    ctx.restore();
  }

  // —— 实体（按 y 排序做前后遮挡，sprite 像素尺寸直接 draw）——
  const roleIds = new Set(s.roles.map((r) => r.id));
  const _nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const dtSec = Math.max(0.001, Math.min(0.1, lastRenderAt ? (_nowMs - lastRenderAt) / 1000 : 0.016));
  lastRenderAt = _nowMs;
  const aliveIds = new Set<string>();
  s.entities.forEach((e) => { if (e.alive !== false) aliveIds.add(e.id); });
  Array.from(displayPos.keys()).forEach((id) => { if (!aliveIds.has(id)) displayPos.delete(id); });
  [...s.entities]
    .filter((e) => e.alive !== false)
    // ★ 迷雾过滤：玩家永远可见；其余单位只在"当前可见格"上才画
    //   （躲进墙后 / 视野外的怪不应该被看到，否则迷雾只是装饰）
    .filter((e) => e.side === "player" || isVisibleAt(e.x, e.y))
    .map((e) => {
      const d = e.side === "player" ? { x: e.x, y: e.y } : entityDisplayPos(e, dtSec);
      return { e, drawX: d.x, drawY: d.y };
    })
    .sort((a, b) => a.drawY - b.drawY)
    .forEach(({ e, drawX, drawY }) => {
      const ex = wx2px(drawX);
      const ey = wz2py(drawY);
      if (e.side === "enemy" && !roleIds.has(e.id)) {
        drawMonster(ctx, e, ex, ey, sx);
      } else {
        drawEntity(ctx, e, getEntityAvatar(e), ex, ey, sx);
      }
    });

  // —— VFX 粒子层（在飘字之前、实体之后）——
  drawVfxLayer(ctx, s.vfx, wx2px, wz2py);

  // —— ★ 点击寻路可视化：A* 路径虚线 + 目标标记 + 点击涟漪 ——
  drawClickFxLayer(ctx, wx2px, wz2py, sx);

  // —— 飘字（屏幕像素）——
  s.floaters.forEach((f) => {
    const fx = wx2px(f.x);
    const fy = wz2py(f.y);
    ctx.save();
    // ★ 按 kind/color 决定颜色（飘字颜色不再是统一白字）
    const fill = f.color || "#fff";
    ctx.globalAlpha = Math.min(1, f.life / 12);
    ctx.fillStyle = fill;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 3;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(f.text, fx, fy - 40);
    ctx.fillText(f.text, fx, fy - 40);
    ctx.restore();
  });

  // —— Debug 高亮（屏幕像素）——
  if (selectedEntityId.value) {
    const sel = s.entities.find((e) => e.id === selectedEntityId.value);
    if (sel) {
      const sxsel = wx2px(sel.x);
      const sysel = wz2py(sel.y);
      ctx.save();
      ctx.strokeStyle = "#ffe79e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sxsel - 28, sysel - 56, 56, 64);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 231, 158, 0.9)";
      ctx.fillRect(sxsel - 28, sysel - 76, 56, 16);
      ctx.fillStyle = "#1e1f1f";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(sel.id, sxsel, sysel - 64);
      ctx.restore();
    }
  }
}

/** 单个装饰物的渲染（按区域加载后调用） */
function renderOneDecoration(
  ctx: CanvasRenderingContext2D,
  dec: Decoration,
  px: number,
  py: number,
  sx: number,
): void {
  {
    if (dec.kind === "tree" && SHEET_TILESET.ready) {
      // ★ fix①：树改走"米 × ppm"，与角色同一尺度基准（zoom=20 时 ≈60px，高于 1.6 米的小人）
      const d = propDimPx("tree", sx);
      drawTile(ctx, dec.variant === 0 ? TILE_TREE_ID : TILE_DEADTREE_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "ground" && SHEET_TILESET.ready) {
      // ★ mulberry 地表 tile（手工铺贴的特殊地块，比如路、广场、房屋地基）
      const tid = (dec as any).tileId ?? TILE_GRASS_MAIN_ID;
      const d = propDimPx("road", sx);
      drawTile(ctx, tid, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "water" && SHEET_TILESET.ready) {
      // ★ fix①：水面同样按米（2 米 ≈ 40px）
      const d = propDimPx("water", sx);
      ctx.save(); ctx.globalAlpha = 0.9;
      drawTile(ctx, TILE_WATER_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
      ctx.restore();
    } else if (dec.kind === "bush" && SHEET_TILESET.ready) {
      // ★ fix①：灌木按米（1.1 米 ≈ 22px，与原像素尺寸接近，仅补上 zoom 联动）
      const d = propDimPx("bush", sx);
      drawTile(ctx, TILE_SHRUB_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "mushroom" && SHEET_TILESET.ready) {
      const dh = Math.round(0.90 * sx), dw = dh;
      drawTile(ctx, TILE_MUSHROOM_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "flower" && SHEET_TILESET.ready) {
      const dh = Math.round(0.80 * sx), dw = dh;
      drawTile(ctx, TILE_FLOWER_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "pot" && SHEET_TILESET.ready) {
      const dh = Math.round(0.90 * sx), dw = Math.round(0.60 * sx);
      drawTile(ctx, TILE_POTION_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "road" && SHEET_TILESET.ready) {
      // 土路 tile（用泥土 tile）
      drawTile(ctx, TILE_DIRT_MAIN_ID, px - sx / 2, py - sx / 2, sx, sx);
    } else if (dec.kind === "building" && SHEET_TILESET.ready) {
      // ★ mulberry 风格：用每个 tile 的真实 tileId（不是固定 3x3 模板）
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
        // Fallback: 用模板（兼容旧的装饰物）
        const v = dec.variant || 0;
        const bw = sx * 3;
        const bh = sx * 3;
        const x0 = px - bw / 2;
        const y0 = py - bh + 4;
        drawTile(ctx, TILE_HOUSE_ROOF_LEFT_ID, x0, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + sx, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_RIGHT_ID, x0 + sx * 2, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_LEFT_ID, x0, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + sx, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_RIGHT_ID, x0 + sx * 2, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, x0, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_MID_ID, x0 + sx, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, x0 + sx * 2, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, x0, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_DOOR_ID, x0 + sx, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, x0 + sx * 2, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, x0, y0 + sx * 3, sx, sx);
        drawTile(ctx, TILE_HOUSE_DOOR_ID, x0 + sx, y0 + sx * 3, sx, sx);
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, x0 + sx * 2, y0 + sx * 3, sx, sx);
      }
    } else if (dec.kind === "building") {
      // Fallback: 纯色方块
      const bw = sx * 3, bh = sx * 3;
      const x0 = px - bw / 2, y0 = py - bh + 4;
      ctx.save();
      ctx.fillStyle = "#8a7a6a";
      ctx.fillRect(x0, y0, bw, bh);
      ctx.restore();
    } else if ((dec as any).kind === "portal") {
      // ★ 出口箭头（Rotten-Soup LEVEL_TRANSITION 的视觉提示）：黄色箭头 + 目的地名
      ctx.save();
      // 箭头本体（脉冲动画吸引注意）
      const pulse = 0.75 + 0.25 * Math.sin(_animTick / 8);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#ffd23e";
      ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.lineWidth = 2;
      const aw = sx * 0.9, ah = sx * 0.55;
      ctx.beginPath();
      ctx.moveTo(px + aw / 2, py - sx * 0.5);          // 右尖
      ctx.lineTo(px - aw / 2, py - sx * 0.5 - ah / 2); // 上角
      ctx.lineTo(px - aw / 4, py - sx * 0.5);          // 上凹
      ctx.lineTo(px - aw / 2, py - sx * 0.5 + ah / 2); // 下角
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      // 目的地文字
      const dest = (dec as any).name || "出口";
      ctx.fillStyle = "rgba(0,0,0,.85)";
      ctx.font = "bold " + Math.max(8, Math.round(sx * 0.28)) + "px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(dest, px + 1, py - sx * 1.1 + 1);
      ctx.fillStyle = "#ffe79e";
      ctx.fillText(dest, px, py - sx * 1.1);
      ctx.restore();
    } else if (dec.kind === "npc" && SHEET_TILESET.ready) {
      // ★ NPC：真实精灵 tile + 2 帧走路动画 + 游走（Rotten-Soup 的 AnimatedSprite 等价）
      //   Dawnlike 人物动画规律：第 2 帧 = 基础 tile + 8（与 player [4334, 4342] 一致）
      // ★ 名字由 entity 层（drawEntity headLabel）负责统一渲染，装饰物层只画 sprite，
      //   避免双重绘制 + 字号不一致。原逻辑保留作为 fallback（SHEET_TILESET 未就绪时启用）。
      const npcName = (dec as any).name || "NPC";
      const baseTile = dec.variant && dec.variant > 0 ? dec.variant : 4695; // 兜底 = 默认村民第一帧
      const walkFrame = Math.floor((_animTick + (dec as any).seed || 0) / 14) % 2; // ~220ms 切帧，每个 NPC 相位不同
      const npcTile = baseTile + walkFrame * 8;
      // 游走：wanders 的 NPC 绕出生点做平滑李萨如曲线漂移（±1.2 米），不走的原地踏步
      const wanders = (dec as any).wanders === true;
      const seed = (dec as any).seed || 0;
      const t = _animTick * 0.012 + seed;
      const dxW = wanders ? Math.sin(t) * 1.2 : 0;
      const dyW = wanders ? Math.sin(t * 0.7 + 1.3) * 0.8 : 0;
      // 面向：按水平漂移方向翻转（|sin|>0.15 才算在走）
      const walking = wanders && Math.abs(Math.cos(t)) > 0.15;
      const drawX = px + dxW * sx;
      const drawY = py + dyW * sx;
      // 走路时轻微上下起伏（1px 级别）
      const bob = walking ? Math.abs(Math.sin(t * 6)) * sx * 0.06 : 0;
      drawTile(ctx, npcTile, drawX - sx / 2, drawY - sx * 1.5 + 4 - bob, sx, sx * 1.5);
      // ★ 不再在装饰物层绘制名字 — 实体层（mapnpc_* entity）的 drawEntity 统一负责
      //   字体更大、与玩家/敌怪头顶一致、不会被墙体遮挡时遗漏。
      //   Fallback 路径（SHEET_TILESET 未就绪）保留名称绘制，保证开发期可读性。
      const _suppressName = false;
      if (_suppressName) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.font = "bold " + Math.max(6, Math.round(sx * 0.25)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(npcName, drawX, drawY + sx * 0.2);
        ctx.restore();
      }
    } else if (dec.kind === "npc") {
      // Fallback: 简化圆形 + 名字（entity 层未就绪时的兜底，正常路径下 entity 层统一绘制）
      const sz = Math.round(0.8 * sx);
      ctx.save();
      ctx.fillStyle = "#d4a574";
      ctx.beginPath();
      ctx.arc(px, py - sz * 0.3, sz * 0.4, 0, Math.PI * 2);
      ctx.fill();
      const npcName = (dec as any).name || "NPC";
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.font = "bold " + Math.max(6, Math.round(sx * 0.25)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(npcName, px, py + sz * 0.4);
      ctx.restore();
    } else if (dec.kind === "fence" && SHEET_TILESET.ready) {
      // 用 tileset 木桩绘制栅栏（连续多个桩）
      const v = dec.variant || 0;
      // ★ mulberry 风格：有 tileId 用真实 tileId，否则用 3 桩模板
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
        const gap = sx * 1.5;
        const numPosts = 3;
        for (let i = 0; i < numPosts; i++) {
          drawTile(ctx, TILE_FENCE_POST_ID, px - sx / 2 + i * gap, py - sx, sx, sx);
        }
        drawTile(ctx, TILE_FENCE_RAIL_ID, px - sx / 2, py - sx * 0.7, sx * 3, sx * 0.3);
      }
    } else if (dec.kind === "fence") {
      // Fallback: 棕色竖线
      const dh = Math.round(0.8 * sx), dw = Math.round(0.22 * sx);
      ctx.save();
      ctx.fillStyle = "#7a5a3a";
      ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
      ctx.restore();
    } else if (dec.kind === "furniture") {
      // 家具：根据 variant 显示不同物品
      const dh = Math.round(0.5 * sx), dw = Math.round(0.8 * sx);
      ctx.save();
      const variant = dec.variant || 0;
      if (variant === 0) {
        // 锻造台（铁匠）
        ctx.fillStyle = "#3a3a3a";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#ff6b1a";
        ctx.fillRect(px - dw / 4, py - dh + 4, dw / 2, dh / 2);
      } else if (variant === 1) {
        // 柜台（杂货）
        ctx.fillStyle = "#8b6914";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#d4a13e";
        ctx.fillRect(px - dw / 2 + 1, py - dh + 4, dw - 2, 1);
      } else if (variant === 2) {
        // 地毯（长者）
        ctx.fillStyle = "#a02828";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#ffd700";
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(px - dw / 2 + 1, py - dh + 5 + i * 2, dw - 2, 0.5);
        }
      } else {
        // 床（旅馆）
        ctx.fillStyle = "#a0826d";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#e0c8a8";
        ctx.fillRect(px - dw / 2 + 2, py - dh + 6, dw - 4, dh - 4);
      }
      ctx.restore();
    } else if (dec.kind === "farm" && SHEET_TILESET.ready) {
      // 农田用 tileset 绘制（与 Rotten-Soup 风格一致）
      // ★ mulberry 风格：每个 tile 用真实 tileId
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
      const fw = sx * 3, fh = sx * 2;
      const x0 = px - fw / 2, y0 = py - fh + 4;
      // 3×2 农田格子
      drawTile(ctx, TILE_FARM_DIRT_ID, x0, y0, sx, sx);
      drawTile(ctx, TILE_FARM_GREEN_ID, x0 + sx, y0, sx, sx);
      drawTile(ctx, TILE_FARM_TOP_ID, x0 + sx * 2, y0, sx, sx);
      drawTile(ctx, TILE_FARM_DIRT_ID, x0, y0 + sx, sx, sx);
      drawTile(ctx, TILE_FARM_GREEN_ID, x0 + sx, y0 + sx, sx, sx);
      drawTile(ctx, TILE_FARM_TOP_ID, x0 + sx * 2, y0 + sx, sx, sx);
      }
    } else if (dec.kind === "farm") {
      // Fallback: 棕色田地
      const dh = Math.round(2 * sx), dw = dh;
      ctx.save();
      ctx.fillStyle = "#5c3a1e";
      ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
      ctx.restore();
    } else if (dec.kind === "rock" && SHEET_TILESET.ready) {
      const dh = Math.round(0.9 * sx), dw = dh;
      drawTile(ctx, TILE_ROCK_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else {
      // 兜底形状（屏幕像素）
      ctx.save(); ctx.globalAlpha = 0.5;
      if (dec.kind === "tree") {
        ctx.fillStyle = "#2d5a27";
        ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.fill();
      } else if (dec.kind === "water") {
        ctx.fillStyle = "#4a90d9";
        ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#8b7355";
        ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}
/* ---------------- ★ fix⑤/⑥ 迷你小地图 + 玩家坐标 ---------------- */
/** 小地图画布像素尺寸（CSS 同尺寸） */
const MINIMAP_PX = 110;
/** 小地图半径（米）：超出范围的目标钳制在边缘并描白边提示方位 */
const MINIMAP_RANGE_M = 150;  // ★加大到 150 米，完整显示城镇矩形 + 外部区域
const minimapEl = ref<HTMLCanvasElement | null>(null);

/**
 * 绘制迷你小地图：以玩家为中心，显示野怪/盟友/宝箱/血瓶的相对位置。
 * 独立于主画布的 ctx，由 loop()/`watch(phase)` 以 10Hz 调用。
 */
function drawMinimap() {
  const c = minimapEl.value;
  const s = state.value;
  if (!c || !s) return;
  const g = c.getContext("2d");
  if (!g) return;
  const N = MINIMAP_PX;
  const half = N / 2;
  const ppm = half / MINIMAP_RANGE_M;        // 像素/米
  const meE = s.entities.find((e) => e.side === "player");
  const px = meE ? meE.x : 0;
  const py = meE ? meE.y : 0;

  g.save();
  g.clearRect(0, 0, N, N);
  // 底色 + 刻度网格（四等分）
  g.fillStyle = "rgba(12,16,12,0.78)";
  g.fillRect(0, 0, N, N);
  g.strokeStyle = "rgba(190,205,170,0.16)";
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const t = Math.round((N / 4) * k) + 0.5;
    g.beginPath(); g.moveTo(t, 0); g.lineTo(t, N); g.stroke();
    g.beginPath(); g.moveTo(0, t); g.lineTo(N, t); g.stroke();
  }
  // 视野圈
  g.strokeStyle = "rgba(200,220,180,0.22)";
  g.beginPath();
  g.arc(half, half, half - 2, 0, Math.PI * 2);
  g.stroke();

  const dot = (x: number, y: number, color: string, r: number) => {
    let dx = (x - px) * ppm;
    let dy = (y - py) * ppm;
    const d = Math.hypot(dx, dy);
    const lim = half - 4;
    let clamped = false;
    if (d > lim) { const k = lim / d; dx *= k; dy *= k; clamped = true; }
    g.beginPath();
    g.fillStyle = color;
    g.arc(half + dx, half + dy, r, 0, Math.PI * 2);
    g.fill();
    if (clamped) { g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1; g.stroke(); }
  };

  // 宝箱 / 血瓶（宿主 state 有则画，没有则跳过）
  const extra = s as unknown as { chests?: Array<{ x: number; y: number }>; potions?: Array<{ x: number; y: number }> };
  if (Array.isArray(extra.chests)) extra.chests.forEach((o) => dot(o.x, o.y, "rgba(224,178,74,0.9)", 1.6));
  if (Array.isArray(extra.potions)) extra.potions.forEach((o) => dot(o.x, o.y, "rgba(228,132,196,0.9)", 1.6));

  // 野怪 / 盟友
  // ★ 迷雾一致：小地图也不应暴露视野外的野怪（否则迷雾形同虚设）
  s.entities.forEach((e) => {
    if (e.alive === false) return;
    if (e.side === "player") return;
    if (!isVisibleAt(e.x, e.y)) return;
    if (e.side === "enemy") dot(e.x, e.y, "#ff5b5b", 3);
    else if (e.side === "ally") dot(e.x, e.y, "#5b9bff", 2.4);
    else if (e.side === "neutral") dot(e.x, e.y, "#e0c86a", 2.2);   // ★ v4：城镇中立角色
  });

  // 玩家：恒在正中，有 facing 则画朝向箭头
  g.fillStyle = "#8ce07a";
  const face = (meE as unknown as { facing?: { x?: number; y?: number } } | undefined)?.facing;
  g.beginPath();
  if (face && typeof face === "object") {
    const ang = Math.atan2(face.y ?? 0, face.x ?? 1);
    g.moveTo(half + Math.cos(ang) * 5.4, half + Math.sin(ang) * 5.4);
    g.lineTo(half + Math.cos(ang + 2.4) * 4, half + Math.sin(ang + 2.4) * 4);
    g.lineTo(half + Math.cos(ang - 2.4) * 4, half + Math.sin(ang - 2.4) * 4);
    g.closePath();
  } else {
    g.arc(half, half, 3.2, 0, Math.PI * 2);
  }
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.65)";
  g.lineWidth = 1;
  g.stroke();

  // ★ v4：区域名称 —— 当前区域徽标（顶部）+ 邻近区域名称（按方位贴边指示）
  const zoneList = ((s.map?.zones?.length ? s.map.zones : mapCfg.value?.zones) || []) as Array<
    { name: string; x: number; y: number; r: number; kind?: string }
  >;
  if (zoneList.length) {
    const curZone = zoneList.find((z) => {
      if (z.rx !== undefined && z.ry !== undefined) {
        return Math.abs(z.x - px) <= z.rx && Math.abs(z.y - py) <= z.ry;
      }
      return Math.hypot(z.x - px, z.y - py) <= z.r;
    });
    g.save();
    // 绘制区域范围圆圈（边界）
    zoneList.forEach((z) => {
      const dxw = (z.x - px) * ppm;
      const dyw = (z.y - py) * ppm;
      const lx = half + dxw;
      const ly = half + dyw;
      // 安全区=绿色半透明，危险区=红色半透明，普通=棕色半透明
      g.beginPath();
      if (z.kind === "safe") {
        g.strokeStyle = "rgba(140,224,122,0.5)";
        g.fillStyle = "rgba(140,224,122,0.12)";
      } else if (z.kind === "danger") {
        g.strokeStyle = "rgba(255,90,90,0.5)";
        g.fillStyle = "rgba(255,90,90,0.12)";
      } else {
        g.strokeStyle = "rgba(226,216,186,0.5)";
        g.fillStyle = "rgba(226,216,186,0.10)";
      }
      g.lineWidth = 1;
      // 矩形区域用矩形绘制
      if (z.rx !== undefined && z.ry !== undefined) {
        const rxw = z.rx * ppm;
        const ryw = z.ry * ppm;
        g.fillRect(lx - rxw, ly - ryw, rxw * 2, ryw * 2);
        g.lineWidth = 2;
        g.strokeRect(lx - rxw, ly - ryw, rxw * 2, ryw * 2);
      } else {
        const rr = z.r * ppm;
        g.lineWidth = 1;
        g.arc(lx, ly, rr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    });
    g.font = "bold 9px 'Microsoft YaHei', sans-serif";
    g.textAlign = "center";
    // 邻近区域：沿玩家 → 区域中心方向贴边，显示区域名
    zoneList.forEach((z) => {
      if (curZone && z.name === curZone.name) return;
      const dxw = z.x - px;
      const dyw = z.y - py;
      const dd = Math.hypot(dxw, dyw) || 1;
      const lim = half - 12;
      const lx = half + (dxw / dd) * lim;
      const ly = half + (dyw / dd) * lim;
      const txt = z.name.length > 4 ? z.name.slice(0, 4) : z.name;
      const tw = g.measureText(txt).width;
      g.fillStyle = "rgba(8,10,8,0.62)";
      g.fillRect(lx - tw / 2 - 2, ly - 6, tw + 4, 11);
      g.fillStyle = z.kind === "safe" ? "#8ce07a" : "rgba(226,216,186,0.82)";
      g.fillText(txt, lx, ly + 3);
    });
    // 当前区域徽标（左上角）
    const curName = curZone ? curZone.name : "荒野";
    const isSafe = !!curZone && curZone.kind === "safe";
    const badge = isSafe ? `${curName}（安全区）` : curName;
    g.font = "bold 10px 'Microsoft YaHei', sans-serif";
    g.textAlign = "left";
    const bw2 = g.measureText(badge).width;
    g.fillStyle = isSafe ? "rgba(24,60,34,0.82)" : "rgba(20,18,14,0.72)";
    g.fillRect(2, 2, bw2 + 8, 14);
    g.fillStyle = isSafe ? "#9df08a" : "#f0e2b4";
    g.fillText(badge, 6, 12.5);
    g.restore();
  }
  g.restore();
}

/* ---------------- 主循环 ---------------- */
let raf = 0;
let lastTickAt = 0;
let lastSendAt = 0;
let lastMinimapAt = 0;
let lastFrameAt = 0;
const TICK_MS = 100;

/* ---------------- ★ game.md 床碰撞 → 睡眠按钮 ---------------- */
/** 玩家是否紧邻床铺（tileset description=bed 的 blocked 格），随 tick 10Hz 刷新 */
const nearBed = ref(false);

function updateNearBed(): void {
  const g = walkGrid;
  const s = state.value;
  if (!g || !g.bed || !g.bedCount || !s) {
    if (nearBed.value) nearBed.value = false;
    return;
  }
  const me = s.entities.find((e) => e.side === "player");
  const v = me ? isNearBed(g, me.x, me.y, 1.8) : false;
  if (v !== nearBed.value) nearBed.value = v;
}

/* ---------------- ★ game.md 对话功能：靠近角色触发出聊按钮 ---------------- */
/** 可对话的最近角色（非敌人），随 tick 10Hz 刷新 */
const nearChat = ref<{ id: string; name: string; avatarPath?: string } | null>(null);
const CHAT_RADIUS_M = 1.6; // 玩家与角色对话触发半径（米）

/** 更新 nearChat：找最近的可对话角色（非 enemy 阵营、alive） */
function updateNearChat(): void {
  const s = state.value;
  if (!s) {
    if (nearChat.value) nearChat.value = null;
    return;
  }
  const me = s.entities.find((e) => e.side === "player");
  if (!me) { if (nearChat.value) nearChat.value = null; return; }

  let best: typeof nearChat.value = null;
  let bestDist = CHAT_RADIUS_M;
  for (const e of s.entities) {
    if (e.side === "enemy" || !e.alive || e.side === "player") continue;
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    if (d < bestDist) { bestDist = d; best = { id: e.id, name: e.name, avatarPath: e.avatarPath }; }
  }
  if (best?.id !== nearChat.value?.id) nearChat.value = best;
}

/* ---------------- ★ game.md 对话功能：聊天状态 ---------------- */
interface ChatMessage { speaker: string; avatar?: string; text: string; mine?: boolean; }
const chatActive = ref(false);          // 面板是否打开
const chatMessages = ref<ChatMessage[]>([]); // 聊天记录
const chatInputText = ref("");          // 用户输入
const chatPending = ref(false);         // 等待 agent 响应
const chatNpcId = ref("");             // 当前对话角色 id
const chatNpcName = ref("");            // 当前对话角色名
const chatAgentResp = ref("");          // agent 上一句台词（用于"继续"）

/** 打开聊天：nearChat 角色触发 */
function onChatStart() {
  const npc = nearChat.value;
  if (!npc) return;
  chatNpcId.value = npc.id;
  chatNpcName.value = npc.name;
  chatMessages.value = [];
  chatInputText.value = "";
  chatPending.value = false;
  chatAgentResp.value = "";
  chatActive.value = true;
  // 首次发言：调用 agent
  triggerChatSpeak();
}

/** 调用角色发言器 agent（task-speaker-agent） */
function triggerChatSpeak(userText?: string) {
  if (!chatNpcId.value) return;
  chatPending.value = true;
  runSysCmd("sys_chat", {
    npcId: chatNpcId.value,
    npcName: chatNpcName.value,
    userText: userText ?? null,
    lastResp: chatAgentResp.value || null,
  });
}

/** 用户输入文字后点击发送 */
function onChatSend() {
  const txt = chatInputText.value.trim();
  if (!txt) return;
  // 显示用户发言
  chatMessages.value.push({ speaker: "我", text: txt, mine: true });
  chatInputText.value = "";
  const last = chatMessages.value.filter((m) => !m.mine).pop();
  chatAgentResp.value = last?.text ?? "";
  triggerChatSpeak(txt);
}

/** 继续：agent 继续发言（用户不说话，直接让 agent 继续） */
function onChatContinue() {
  triggerChatSpeak();
}

/** 离开：关闭聊天 */
function onChatLeave() {
  chatActive.value = false;
  chatMessages.value = [];
  chatInputText.value = "";
  chatPending.value = false;
  chatAgentResp.value = "";
  chatNpcId.value = "";
  chatNpcName.value = "";
}

/** 点击睡眠：走 sys_rest（entry 侧按 game.md 满血满蓝公式恢复 + 描述写 other + 参数卡同步） */
function onSleep() {
  if (!nearBed.value) return;
  const full = `🎉 恭喜您已恢复到最佳状态！HP ${hudMaxHp.value}/${hudMaxHp.value}，MP ${hudMaxMp.value}/${hudMaxMp.value}`;
  sysNotice.value = "你躺到床上，睡了个好觉……";
  // ★ 乐观提示：立刻给反馈，宿主 response 回来后再刷新为权威数值
  showToast(full);
  runSysCmd("sys_rest", { reason: "在床上睡了一觉" });
}

function loop(ts: number) {
  raf = requestAnimationFrame(loop);
  _animTick++;
  const s = state.value;
  if (!s || s.phase !== "playing") return;
  // ★ fix①（性能）：页面切到后台（锁屏 / 切走）时既不应渲染也不应上报 tick
  if (typeof document !== "undefined" && document.hidden) return;
  // ★ fix①（性能）：手机端把渲染帧率封顶 30fps（渲染内已按 dt 归一，速度不受影响）
  // 注意：lastFrameAt 与 render() 内部的 lastRenderAt（显示位置插值时钟）是两个独立变量
  if (!MIN_FRAME_MS || ts - lastFrameAt >= MIN_FRAME_MS) { lastFrameAt = ts; render(); }
  // ★ fix⑤：迷你小地图独立低频刷新（10Hz 足够，避免与主画面抢 CPU）
  if (ts - lastMinimapAt >= 100) {
    lastMinimapAt = ts;
    drawMinimap();
  }
  if (ts - lastTickAt >= TICK_MS) {
    lastTickAt = ts;
    // ★ v3：本地兜底推进（外部 mockHost 未启动时玩家也能移动）——本地仍保持 10Hz
    localTick();
    // ★ game.md 床碰撞：靠近床时出睡眠按钮（10Hz 足够，9~49 格查表很便宜）
    updateNearBed();
    // ★ game.md 对话功能：10Hz 刷新附近可对话角色
    updateNearChat();
    // ★ fix①（性能）：上报单独限频（移动端 5Hz），宿主只镜像玩家位姿，不影响判定
    if (ts - lastSendAt >= SEND_MS) {
      lastSendAt = ts;
      // ★ 修复③：本地敌怪集合发生结构性变化时（切图 / 补怪 / 兜底补怪），
      //   把整份清单随本帧 tick 上报宿主，由宿主重建敌怪表并统一跑 AI/结算。
      const localEnemies = localEnemiesPayload();
      if (localEnemies) localMobsSentEpoch = localEnemies.epoch;
      sendTick("tick", {
        input: {
          dx: input.value.dx,
          dy: input.value.dy,
          moveTo: input.value.moveTo,
        },
        // ★ 上报本地权威位姿：宿主侧只镜像、不再积分玩家输入（消除坐标双写）
        player: lastLocalPose ? { ...lastLocalPose } : undefined,
        // ★ 上报本地敌怪清单（仅在世代号变化的一次发送，避免每帧大数组）
        localEnemies: localEnemies || undefined,
        // ★ 上报可行走网格（仅切图那一次）→ 宿主用它做**敌人碰撞**，
        //   与前端同一套 collision.resolveMove，避免三处各写一份解析漂移。
        walkGrid: walkGridPayload() || undefined,
        // ★ 上报当前关卡名：宿主（dev-host）据此决定 dungeon theme / 城镇是否刷怪。
        //   此前 dev-host 读不到 iframe 里的 window.__currentLevelName（跨 frame），
        //   永远 fallback 到 RUINS → 城镇安全区也刷怪围杀玩家。
        levelName: currentLevelName.value,
      });
    }
  }
}

/* ---------------- 技能 / 物品 ---------------- */
const skillPage = computed(() => state.value?.skills.slice((state.value.skillPage || 0) * 4, (state.value.skillPage || 0) * 4 + 4) || []);
const itemPage = computed(() => state.value?.items.slice((state.value.itemPage || 0) * 4, (state.value.itemPage || 0) * 4 + 4) || []);
const skillPages = computed(() => Math.max(1, Math.ceil((state.value?.skills.length || 0) / 4)));
const itemPages = computed(() => Math.max(1, Math.ceil((state.value?.items.length || 0) / 4)));

/** ★ 技能目标（本地权威）：由前端按自己那份坐标系选出「30 米内最近的至多 3 只」，
 *   随 skill 请求一并下发；宿主优先按这份 id 清单结算，避免宿主侧野怪/玩家坐标
 *   不同源时"明明贴脸却打空、反而打中远处野怪"。 */
function pickSkillTargets(): string[] {
  const s = state.value;
  const me = (s?.entities || []).find((e: any) => e.side === "player") as any;
  if (!s || !me) return [];
  return ((s.entities || []) as any[])
    .filter((e) => e?.side === "enemy" && e.alive !== false && (e.hp ?? 0) > 0)
    .map((e) => ({ id: String(e.id), d: Math.hypot((e.x ?? 0) - me.x, (e.y ?? 0) - me.y) }))
    .filter((r) => r.d < 30)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((r) => r.id);
}
function castSkill(i: number) {
  sendTick("skill", {
    index: i,
    targets: pickSkillTargets(),
    player: lastLocalPose ? { ...lastLocalPose } : undefined,
  });
}
function useItem(i: number) { sendTick("item", { index: i }); }
function pageSkill(d: number) { sendTick("page", { kind: "skill", delta: d }); }
function pageItem(d: number) { sendTick("page", { kind: "item", delta: d }); }
function exitGame() {
  console.log("btn--exit->exitGame");
  try {
    toonflowJsApi.minigame.setFullscreen(false)
  } catch (e) {
    console.log("btn--exit->exitGame ：e",e);
  }
  window.setTimeout(function (){
      sendTick("exit", {});
  }, 1000);
}

/**
 * 结算页「退出」：回到选人阶段（主菜单）
 */
function exitOver() {
   toonflowJsApi.minigame.setFullscreen(false)
  window.setTimeout(function (){
    if (state.value) state.value.phase = 'select';
  }, 1000);
}

/* ---------------- 上传地图（写 t_plugin_session_data.map_data） ---------------- */
function triggerUploadMap() {
  if (mapUploading.value) return;
  mapFileInput.value?.click();
}

/**
 * 读取 .tbg / .json 地图 → 写到 pluginData("map_data")，并立刻切到新地图。
 * 支持三种格式：
 *   1) 纯 JSON 地图（顶层有 theme/zones/mobs/...）—— 直接归一化
 *   2) .tbg（zip 包）—— 解 zip，从 maps/*.json 读出第一张地图归一化
 *   3) 单 .json（mulberryTown.json / mulberryForest.json 等 Tiled 导出）—— 走 Tiled 解析路径
 */
async function onUploadMap(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // 允许选同一个文件再次触发
  input.value = "";
  mapUploading.value = true;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    // 嗅探 zip 魔数（PK\003\004）
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    let mapData: MapData | null = null;

    if (isZip) {
      // ★ .tbg：解 zip → 找 maps/*.json 第一张作为主地图
      const entries = await readZipEntries(buf);
      // ★ 排除非 Tiled 格式的 json（first.map.json / story.json / entity_types.json / test_state.json 等 metadata）
      //   优先 Tiled 格式（有 layers + width + tilewidth）
      const isTiledJson = (raw: Uint8Array): boolean => {
        try {
          const o = JSON.parse(new TextDecoder().decode(raw));
          return Array.isArray(o?.layers) && (o?.tilewidth || o?.tileheight) && o?.width;
        } catch { return false; }
      };
      // 优先 mulberryForest.json / mulberryTown.json 等（真有野怪/城镇的关卡），
      // 其次任意 maps/ 下的 Tiled json
      const mapEntry =
        entries.find((e) => /^maps\/mulberry[A-Za-z_]+\.json$/i.test(e.name) && !/maps\/bak\//i.test(e.name) && isTiledJson(e.bytes)) ||
        entries.find((e) => /^maps\/.*\.json$/i.test(e.name) && !/maps\/bak\//i.test(e.name) && isTiledJson(e.bytes)) ||
        entries.find((e) => e.name.endsWith(".json") && !/story\.json|entity_types\.json|test_state\.json|test_data\.json|map_config\.json|first\.map\.json/i.test(e.name) && isTiledJson(e.bytes));
      if (!mapEntry) {
        alert("tbg 包里没找到 Tiled 格式的 maps/*.json 地图文件");
        return;
      }
      // 把 maps/*.json 喂给 Tiled 解析路径（normalizeTiledMap）
      const tiled = JSON.parse(new TextDecoder().decode(mapEntry.bytes));
      const tiledCfg = normalizeTiledMap(tiled, file.name.replace(/\.tbg$/i, ""));
      // tbg 里也要看 story.json / compiled_dawnlike.json 之类的主题/装饰
      const storyEntry = entries.find((e) => /story\.json$/i.test(e.name));
      const compiledEntry = entries.find((e) => /compiled_dawnlike\.json$/i.test(e.name));
      mapData = {
        theme: tiledCfg?.theme || (storyEntry ? safeReadJson(storyEntry, "story.json")?.title : null) || "野外",
        zones: tiledCfg?.zones || [],
        mobs: [],
        chests: [],
        potions: [],
      };
    } else {
      // 纯文本：先试 JSON 解析
      const text = new TextDecoder().decode(buf);
      let json: any;
      try { json = JSON.parse(text); } catch (e) {
        alert("地图文件解析失败：既不是 JSON 也不是 zip。");
        return;
      }
      // ★ Tiled 导出格式（layers/width/height）→ 走 normalizeTiledMap
      if (Array.isArray(json?.layers) && (json?.tilewidth || json?.tileheight)) {
        const tiledCfg = normalizeTiledMap(json, file.name.replace(/\.json$/i, ""));
        mapData = {
          theme: tiledCfg?.theme || "野外",
          zones: tiledCfg?.zones || [],
          mobs: [],
          chests: [],
          potions: [],
        };
      } else {
        // 顶层 MapData 描述
        mapData = {
          theme: String(json.theme ?? "野外"),
          zones: Array.isArray(json.zones) ? json.zones : [],
          mobs: Array.isArray(json.mobs) ? json.mobs : [],
          chests: Array.isArray(json.chests) ? json.chests : [],
          potions: Array.isArray(json.potions) ? json.potions : [],
        };
      }
    }
    if (!mapData) return;
    // 写宿主插件数据表（t_plugin_session_data，dataKey=map_data）
    await toonflowJsApi.pluginData.set("map_data", mapData);
    // 立刻应用：写入 state.map，并刷新 HUD
    if (state.value) {
      state.value = { ...state.value, map: mapData, mapSource: "stored" } as GameState;
    }
    mapTheme.value = mapData.theme;
    console.info("[field-survival] 地图已上传并绑定：", file.name, "size=", file.size);
    if (state.value?.phase === "playing") {
      void switchLevel(currentLevelName.value);
    }
  } catch (err) {
    console.error("[field-survival] 上传地图失败：", err);
    alert("上传失败：" + (err as Error).message);
  } finally {
    mapUploading.value = false;
    mapUploadDone.value = true;
    if (mapUploadDoneTimer) window.clearTimeout(mapUploadDoneTimer);
    mapUploadDoneTimer = window.setTimeout(() => {
      mapUploadDone.value = false;
      mapUploadDoneTimer = 0;
    }, 3000);
  }
}

/* ---------------- 玩家/物品/技能 → pluginData 持久化 ---------------- */
/**
 * 把当前玩家实体（hp/mp/level/exp/...）+ items + skills 写到
 * t_plugin_session_data.dataKey=player_card，AI 聊天窗口后续可读到。
 */
function savePlayerCardToSession() {
  const s = state.value;
  if (!s) return;
  const me = s.entities.find((e) => e.side === "player");
  if (!me) return;
  const card = {
    name: me.name,
    level: me.level,
    exp: me.exp,
    expToNext: me.expToNext,
    hp: me.hp,
    maxHp: me.maxHp,
    mp: me.mp,
    maxMp: me.maxMp,
    atk: me.atk,
    def: me.def,
    money: s.money ?? 0,
    kills: s.kills ?? 0,
    drops: Array.isArray(s.drops) ? [...s.drops] : [],
    items: Array.isArray(s.items) ? s.items.map((it) => ({ ...it })) : [],
    skills: Array.isArray(s.skills) ? s.skills.map((sk) => ({ ...sk })) : [],
    savedAt: Date.now(),
  };
  toonflowJsApi.pluginData
    .set("player_card", card)
    .then(() => console.info("[field-survival] 玩家数据已存 pluginData:player_card"))
    .catch((e) => console.warn("[field-survival] 存 player_card 失败（宿主未接入？）:", e));
}

/** 防抖：500ms 内连续变更只发一次 */
function schedulePlayerCardSave() {
  if (saveDebounce) window.clearTimeout(saveDebounce);
  saveDebounce = window.setTimeout(() => {
    saveDebounce = 0;
    savePlayerCardToSession();
  }, 500);
}

/** 玩家阵亡或结算时立刻同步一次（不等防抖） */
function savePlayerCardNow() {
  if (saveDebounce) { window.clearTimeout(saveDebounce); saveDebounce = 0; }
  savePlayerCardToSession();
}

/**
 * 结算页「复活」：原地复活 —— 位置不变，血量与状态恢复为可正常游玩。
 *   主路径：sendTick("revive") → 宿主（entry.ts / entry.js）或本地模拟宿主（mockHost.ts）
 *           把玩家 alive=true、hp=maxHp，phase 由 over 回到 playing，玩家坐标保持死亡处不变。
 *   兜底：宿主未接入 revive 动作时（旧宿主 / 纯静态打开 game.html），前端本地自愈，
 *         保证「复活」按钮在任何环境下都能继续游玩。
 */
function reviveGame() {
  sendTick("revive", {});
  window.setTimeout(localReviveIfStillOver, 300);
}

function localReviveIfStillOver() {
  const s = state.value;
  if (!s || s.phase !== "over") return;      // 宿主已完成复活，无需兜底
  const me0 = s.entities.find((e) => e.side === "player");
  if (!me0) return;
  me0.alive = true;
  me0.hp = me0.maxHp;                        // 满血
  me0.vx = 0;
  me0.vy = 0;
  s.result = null;
  s.phase = "playing";                       // 回到可正常游玩
  lastLocalPose = { x: me0.x, y: me0.y, facing: me0.facing };   // 位置不变，并接管本地权威位姿
}

/* ---------------- 生命周期 ---------------- */
let stopHost: (() => void) | null = null;

/** 应用启动：加载地图 → 初始化 chunk / 装饰 → 开启渲染循环 */
onMounted(async () => {
  // ★ 调试句柄：standalone/dev-host 下可从控制台切图（window.__switchLevel("Mulberry Forest")）
  (window as any).__switchLevel = switchLevel;
  // ★ standalone（mockHost）：先吃下初始 state（window.__initialState 由 mockHost 写入）
  const initial = (window as any).__initialState;
  if (initial && !state.value) {
    state.value = initial;
  }
  // ★ 起始地图（回归修复）：起始关卡名来自 maps/first.map.json 的 start_map.value，
  //   用它初始化 currentLevelName，并加载"开局首张地图"。
  //   文件缺失 / 解析失败 / 字段为空 → 回退 DEFAULT_START_LEVEL（"Mulberry Town"），绝不抛错。
  const startLevel = await loadStartLevelName();
  currentLevelName.value = startLevel;
  console.info("[field-survival] 起始关卡（maps/first.map.json start_map.value）：", startLevel);
  // ★ v3：先加载地图配置（开局地图 = startLevel），得到 scale / zoom / 装饰物 / chunk 数据
  try {
    const cfg = await loadMapConfig(startLevel);
    mapCfg.value = cfg;
    // ★ 建碰撞网格（对齐 Rotten-Soup 的 Tile.blocked()：墙/水/树来自 tileset 属性）
    await rebuildWalkGrid(startLevel);
    // 初始落点安全化：复用 settleSpawn（与切图同一套规则），避免两处规则漂移。
    // 宿主导出的出生坐标只做格中心吸附；不满足"主连通域 + portal 净空"才挪。
    if (walkGrid && walkIndex) {
      const me0 = state.value?.entities.find((e) => e.side === "player");
      if (me0) {
        const sp = settleSpawn(me0.x, me0.y);
        if (sp.x !== me0.x || sp.z !== me0.y) {
          console.info(
            `[field-survival] 初始出生点 (${me0.x.toFixed(1)}, ${me0.y.toFixed(1)}) → ` +
              `(${sp.x.toFixed(1)}, ${sp.z.toFixed(1)})`,
          );
          me0.x = sp.x;
          me0.y = sp.z;
          lastLocalPose = { x: me0.x, y: me0.y, facing: me0.facing };
        }
      }
    }
    // 开局也武装切图闸门（首帧即离开触发圈会自动解除，只在落点异常时起作用）
    portalLatchPending = true;
    // ★ 初始关卡的 safe zone 立即发布给 mockHost（切图时会随关卡更新），
    //   并注册"本地敌怪拉取钩子"，避免 mock 整份覆盖把 App 侧生成的怪物抹掉
    publishSafeZones(cfg);
    publishMapBounds(cfg);
    publishLocalMapMobs();
    zoom.value = cfg.default_zoom;
    // 初始化 chunk 系统（基于新 scale）
    chunkSystem = new ChunkTerrainSystem(makeScaleFromMap(cfg));
    chunkSystem.init();
    if (cfg.chunks) chunkSystem.ingestMapData(cfg.chunks);
    // ★ 立即加载玩家初始 chunk（否则 updateAroundPlayer 因同 chunk 提前 return，loaded_chunks 一直为空）
    chunkSystem.updateAroundPlayer(0, 0, performance.now());
    for (let i = 0; i < 30; i++) chunkSystem.tick();  // 一次消费完 pending 队列
    // 装饰物：按 chunk 索引
    initDecorations();
  } catch (err) {
    console.warn("[field-survival] loadMapConfig 失败，使用兜底数据：", err);
    initDecorations();
  }

  // ★ 画布等比缩放：窗口变化 / 旋转 / 全屏切换后重新适配
  // window.addEventListener("resize", fitCanvas);
  // fitCanvas();

  window.addEventListener("orientationchange", ()=>{
    rotated_fun();
    requestAnimationFrame(fitCanvas);
  })
  window.visualViewport?.addEventListener("resize", ()=>{
    rotated_fun();
    requestAnimationFrame(fitCanvas);
  })

  stopHost = onHostState((d) => {
    const prevPhase = state.value?.phase;
    // ★ 宿主/ mock 推送前的本地实体快照：用于把 App 侧生成的地图怪物（mapmob_*）归并保留
    const prevEntities = (state.value?.entities || []) as Entity[];
    const incoming = d.state as GameState;
    const newPhase = incoming?.phase;
    // ★ 关键修复：玩家位姿以本地 tick 为唯一数据源。
    //   宿主推送的 state 中玩家 x/y/facing 是宿主侧镜像值（宿主已不再积分玩家输入），
    //   若整份替换会把本地刚推进的位移回退 → 表现为"走一小步被拖回 / 松手瞬移"。
    if (newPhase === "playing" && prevPhase === "playing" && lastLocalPose) {
      const meHost = incoming?.entities?.find((e) => e.side === "player");
      if (meHost) {
        meHost.x = lastLocalPose.x;
        meHost.y = lastLocalPose.y;
        meHost.facing = lastLocalPose.facing;
      }
    } else if (newPhase !== "playing") {
      // 回到选人 / 结算：清空本地位姿缓存，下一局以宿主 spawn 为准
      lastLocalPose = null;
    }
    // ★ 刷怪权威统一：客户端权威怪（mapmob_/localmob_/zone_）始终在 prevEntities 里。
    //   宿主推送的 incoming.entities 不含客户端怪（宿主没看到 mapmob_*），所以整份
    //   替换会把刚 push 的新图怪全抹掉。规则：
    //     - 玩家/盟友/宿主敌怪（他用 side=ai 或 zone_/localmob_ 之外）→ 用 incoming
    //     - 客户端权威怪（mapmob_/localmob_/zone_）→ 用 prevEntities 的（带 alive 状态）
    //     - 切图后，prevEntities 里的旧图怪 id 不在新图 prevEntities 里 → 自动丢弃
    if (incoming && Array.isArray(incoming.entities)) {
      const incomingIds = new Set(
        incoming.entities.map((e: any) => e?.id).filter((v: any) => typeof v === "string"),
      );
      const localEnemies = prevEntities.filter(
        (e: any) =>
          e?.side === "enemy" &&
          typeof e?.id === "string" &&
          (e.id.startsWith("mapmob_") || e.id.startsWith("localmob_") || e.id.startsWith("zone_")),
      );
      // ★ 客户端权威中立实体（mapnpc_*，地图 Actors 层的城镇 NPC）— 同样不在 incoming 里，
      //   必须按合并而非丢弃。规则与 mapmob_* 对齐。
      const localNpcs = prevEntities.filter(
        (e: any) =>
          e?.side === "neutral" &&
          typeof e?.id === "string" &&
          e.id.startsWith("mapnpc_"),
      );
      for (const e of localEnemies as any[]) {
        if (e.alive === false && !deadLocalEnemyIds.has(e.id)) deadLocalEnemyIds.add(e.id);
      }
      // ★ 切图过渡期：丢弃所有旧图怪（zone_/localmob_），只保留新图的 mapmob_ 怪。
      //   否则从森林/墓地切进 mulberryTown 时，上张图的 zone_ 怪会跟进来追玩家。
      if (switchingLevel.value) {
        // 只允许 mapmob_（新图刚加载的 Tiled 怪）通过；zone_/localmob_ 一律过滤掉
        const validMapMobs = localEnemies.filter(
          (e: any) => e.id.startsWith("mapmob_") && e.alive !== false && !deadLocalEnemyIds.has(e.id),
        );
        if (validMapMobs.length) incoming.entities = [...incoming.entities, ...validMapMobs];
      } else {
        const hostAdopted = localEnemies.some((e: any) => incomingIds.has(e.id));
        if (hostAdopted) {
          // ★ 宿主已接管过本清单 → incoming 的 local 敌怪表就是权威。此时客户端有、
          //   宿主没有只剩两种可能：
          //     a) 宿主还没追上本世代（刚 bumpLocalMobsEpoch 后的 ~1 tick 窗口）→ 回补；
          //     b) 宿主已把它当死怪删掉（entry.ts:1300 当帧删尸，客户端永远看不到
          //        alive=false）→ 必须记入 deadLocalEnemyIds，否则死怪以冻结血量
          //        原地复活（表现：HUD 显示 11 只、场上站着打不死的 2HP 僵尸怪）。
          //   用宿主回推的 localMobsEpoch 区分：追上了 = 权威，没追上 = 回补。
          const hostEpoch = Number((incoming as any).localMobsEpoch || 0);
          const hostCaughtUp = hostEpoch >= localMobsEpoch;
          deadLocalEnemyIds.clear();
          // 回补宿主还没同步的新怪
          const missing = localEnemies.filter(
            (e: any) => !incomingIds.has(e.id) && e.alive !== false && !deadLocalEnemyIds.has(e.id),
          );
          if (!hostCaughtUp) {
            if (missing.length) incoming.entities = [...incoming.entities, ...missing];
          } else {
            for (const e of missing as any[]) deadLocalEnemyIds.add(e.id);
          }
        } else {
          // ★ 切图场景：宿主没回新怪（incoming.enemies.length===0），但 prevEntities
          //   里的客户端权威怪（mapmob_/localmob_/zone_）就是新图刚 push 的怪——
          //   必须回填，否则新图野怪一帧就消失。
          //   旧图怪自动丢弃：switchLevel() 把新怪 push 后旧怪的 id 就不在 prevEntities 里了。
          const keptMapMobs = localEnemies.filter(
            (e: any) => !deadLocalEnemyIds.has(e.id),
          );
          if (keptMapMobs.length) incoming.entities = [...incoming.entities, ...keptMapMobs];
        }
      }
      // ★ 客户端权威中立 NPC（mapnpc_*）— 每帧追加保留（宿主永远不知道它们存在）。
      //   切换关卡时旧图的 NPC id 不在 prevEntities 里 → 自动丢弃。
      const keptNpcs = localNpcs.filter((e: any) => e.alive !== false);
      if (keptNpcs.length) incoming.entities = [...incoming.entities, ...keptNpcs];
    }
  // ★ 敌人碰撞收口（在 state.value 赋值之前就地改写 incoming 的敌怪坐标）
  if (incoming && Array.isArray(incoming.entities)) applyEnemyCollision(incoming.entities as Entity[]);
  // ★  vfx/floaters 衰减由 dev-host tick 负责（vite.config.ts 每 tick life--）。
  //    客户端不要保留 prevEntities 的 vfx，否则 prevEntities 里的 vfx 不衰减、永远显示。
  state.value = incoming;
    ready.value = true;

    // ★ 收到 init/init_start 时，强制重置所有选择状态
    // 这样第二次进入游戏时能正确显示选人面板
    // ★ 关键修复：仅在"阶段真正切换到 select"时重置（prevPhase !== "select"）。
    //   此前每次收到 select 状态都重置，宿主/mock 的任意一次重推（如 loaded、全屏信令、
    //   兜底定时 push）都会把用户刚点选的角色清空，导致"点角色卡片没反应、选不中人"。
    if (newPhase === "select" && prevPhase !== "select") {
      participants.splice(0, participants.length);
      spectators.splice(0, spectators.length);
      enemies.splice(0, enemies.length);
      // ★ 修复②（未选择却出现同名友方角色）：
      //   此前这里无条件把"用户角色"塞进 participants，于是 entry.js 的
      //   `participants.forEach(...)` 为它建了一个 ally —— 玩家出生点旁凭空多出一个
      //   与用户同名的"友方角色"。用户角色由宿主固定为玩家实体，必须留在候选之外。
      //   （选人面板已用 selectableRoles 过滤掉它，这里同步去掉默认勾选）
      // 选人阶段：确保不是全屏（用户切回来好操作）
      toonflowJsApi.minigame.setFullscreen(false);
      // 重新初始化地图装饰物（每次进入都重新生成）
      initDecorations();
      // 重置开始按钮 loading 状态（★ fix③：同时清掉超时计时与提示）
      starting.value = false;
      clearStartTimers();
      startHint.value = "";
      // 重置区域追踪变量
      currentZoneName = null;
      zoneLeftTick = 0;
      zoneRespawnReady = false;
    }
    if (newPhase === "playing" && prevPhase !== "playing") {
      // 进入战斗：自动切全屏（runtime 时机）
      toonflowJsApi.minigame.setFullscreen(true);
      // 确保地图装饰物已初始化
      if (mapDecorations.value.length === 0) initDecorations();
      // 重置区域追踪（开局立即可刷新）
      currentZoneName = null;
      zoneLeftTick = 0;
      zoneRespawnReady = true;
      // ★ v3 兜底：如果外部 mockHost 没启动（被 Toonflow wrapper 包了 iframe），
      //   state.entities 里只有玩家/盟友，没有 enemy。在玩家 (0,0) 周围 30-100 米
      //   环形补 spawn 4-6 只野兽，保证开局立刻能看到怪物。
      setTimeout(() => spawnLocalMobsIfNeeded(), 300);
      // 成功进入战斗，清除 loading（★ fix③：同时清掉超时计时与提示）
      starting.value = false;
      clearStartTimers();
      startHint.value = "";
    }
    // ★ 开局后：优先 state.map；缺失时用 toonflowJsApi 从插件数据表拉 map_data 兜底
    const m = (state.value as any)?.map as MapData | null | undefined;
    // ★ 回归修复：删除"宿主 theme → 关卡名"的自动切图整段逻辑（原 themeToLevel 映射 + switchLevel）。
    //   宿主每约 100 ms 推送一次 state，map.theme 只是"氛围展示"字段（如"野外·清晨"）；
    //   此前被硬编码 themeToLevel 映射成关卡名并强制 switchLevel，造成三类回归：
    //     ① 开局被切到 Mulberry Forest（起始地图 "Mulberry Town" 丢失）；
    //     ② 走回 Mulberry Town 又被反复切回森林（卡在森林、回不了城镇）；
    //     ③ 城镇被套用森林的野怪数据 → "所有地图都有野怪"。
    //   现在 theme 仅写入 mapTheme 供 HUD 氛围显示，绝不触发 switchLevel；
    //   关卡切换的唯一入口是场景内 portal（LEVEL_TRANSITION，见 tick 内 portal 判定）。
    if (m?.theme) {
      mapTheme.value = m.theme;
    } else if (state.value?.phase === "playing") {
      void toonflowJsApi.pluginData.get("map_data")
        .then((v) => {
          const md = v as MapData | null;
          if (md?.theme && !mapTheme.value) {
            mapTheme.value = md.theme;
            if (!state.value?.map && md) state.value = { ...state.value!, map: md, mapSource: "stored" } as GameState;
          }
        })
        .catch(() => { /* 宿主未接入 /plugin/data 时静默 */ });
    }
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // ★ fix④：按持久化的像素风开关初始化画布采样方式
  applyCanvasSmoothing();
  raf = requestAnimationFrame(loop);
  notifyLoaded();
  // 兜底：宿主未推送状态时也要显示，避免白屏
  setTimeout(() => { if (!state.value) ready.value = true; }, 1200);
});

onBeforeUnmount(() => {
  stopHost?.();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", fitCanvas);
  cancelAnimationFrame(raf);
});

watch(() => state.value?.phase, (p) => {
  if (p === "playing") requestAnimationFrame(() => { fitCanvas(); applyCanvasSmoothing(); render(); drawMinimap(); });
  // ★ 进入 over 立刻同步一次（玩家最终态要落库）
  if (p === "over") savePlayerCardNow();
});

/* ★ ★ 玩家实体/物品/技能变化 → 防抖写 pluginData.player_card（关掉小游戏后 AI 聊天能看到）。
 *   watch 不能一次写多个值且会跑多次（每帧 hp 都变），统一用 me 计算属性触发一次。 */
const playerSnapshot = computed(() => {
  const s = state.value;
  if (!s) return "";
  const me = s.entities.find((e) => e.side === "player");
  if (!me) return "";
  return [
    me.name, me.level, me.exp, me.hp, me.maxHp, me.mp, me.maxMp,
    me.atk, me.def,
    s.money, s.kills,
    s.items?.length ?? 0,
    s.items?.reduce((a, it) => a + (it.count || 0), 0) ?? 0,
    s.skills?.map((sk) => sk.cdLeft).join(","),
  ].join("|");
});
watch(playerSnapshot, () => {
  if (state.value?.phase === "playing") schedulePlayerCardSave();
});
</script>

<template>
  <div class="fs">
    <!-- ===== 选人阶段 ===== -->
    <section v-if="!state || state.phase === 'select'" class="select">
      <header class="select__head">
        <h2>🌲 野外生存</h2>
        <p>选择友方 / 观战 / 敌对角色，然后点击开始游戏</p>
      </header>

      <div class="select__group">
        <h3>友方角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in selectableRoles" :key="r.id"
            class="chip" :class="{ 'chip--on': participants.includes(r.id) }"
            @click="toggle(participants, r.id)"
          >
            <img v-if="roleAvatar(r)" :src="roleAvatar(r)" alt="" />
            <span>{{ r.name }}</span>
          </button>
        </div>
      </div>

      <div class="select__group">
        <h3>观战角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in selectableRoles" :key="r.id"
            class="chip" :class="{ 'chip--on': spectators.includes(r.id) }"
            @click="toggle(spectators, r.id)"
          >
            <span>{{ r.name }}</span>
          </button>
        </div>
      </div>

      <div class="select__group">
        <h3>敌对角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in selectableRoles" :key="r.id"
            class="chip chip--danger" :class="{ 'chip--on': enemies.includes(r.id) }"
            @click="toggle(enemies, r.id)"
          >
            <span>{{ r.name }}</span>
          </button>
        </div>
        <p class="hint">不选敌对角色时，系统会按波次自动生成野兽。</p>
      </div>

      <button class="start" @click="startGame" :disabled="starting">
        <span v-if="starting" class="start__loading">
          <span class="start__spinner"></span>加载中…
        </span>
        <span v-else>开始游戏</span>
      </button>
      <input ref="mapFileInput" type="file" accept=".tbg,.json" hidden @change="onUploadMap" />
      <button
        class="map_upload"
        :class="{ 'map_upload--ok': mapUploadDone && !mapUploading }"
        @click="triggerUploadMap"
        :disabled="mapUploading"
        :title="mapUploading ? '正在上传并绑定到 t_plugin_session_data…' : '点击选择 .tbg 地图文件，自动打包写入插件数据表'"
      >
        <span class="map_upload__icon" aria-hidden="true">🗺</span>
        <span class="map_upload__text">
          <span v-if="mapUploading" class="map_upload__loading">
            <span class="map_upload__spinner"></span>上传并绑定插件&amp;故事&amp;用户 中…
          </span>
          <span v-else-if="mapUploadDone" class="map_upload__success">
            <strong>地图已绑定</strong>
            <small>再次点击可替换</small>
          </span>
          <span v-else class="map_upload__idle">
            <strong>上传地图（tbg 格式）</strong>
            <small>写入 t_plugin_session_data · 跨会话共享</small>
          </span>
        </span>
      </button>
      <!-- ★ fix③：开始游戏的等待/超时提示（宿主 /plugin/tick 未回包时不再静默） -->
      <p v-if="startHint" class="start-hint">{{ startHint }}</p>
    </section>

    <!-- ===== 战斗阶段 ===== -->
    <section v-else-if="state.phase === 'playing'" class="play { 'stage-rotate--on': isStageRotateOn }">
      <!-- 🔄 横屏按钮（左上角；手机上锁定横屏+全屏，PC 上全屏；req.md:57-58） -->
      <button class="btn btn--rotate" @click="toggleOrientation" title="横竖屏切换">
        🔄
      </button>
      <div class="hud">
        <div class="hud__left">
          <!-- 等级 + HP 条 ★ 满血HP = 100 + 等级*10 + 道具/技能加成（宿主侧计算） -->
          <div class="lv-hud">Lv.{{ me?.level ?? 1 }}</div>
          <div class="hp"><div class="hp__bar" :style="{ width: (me?.hp ?? 0) / hudMaxHp * 100 + '%' }"></div></div>
          <div class="hud__txt">HP {{ Math.round(me?.hp ?? 0) }}/{{ hudMaxHp }}</div>
          <!-- MP 条（蓝）★ 满蓝MP = 100 + 等级*10 + 道具/技能加成 -->
          <div class="mp"><div class="mp__bar" :style="{ width: (me?.mp ?? 0) / hudMaxMp * 100 + '%' }"></div></div>
          <div class="hud__txt">MP {{ Math.round(me?.mp ?? 0) }}/{{ hudMaxMp }}</div>
          <!-- EXP 条 ★ next_level_exp = 当前等级 * 100 -->
          <div class="exp"><div class="exp__bar" :style="{ width: (me?.exp ?? 0) / hudExpToNext * 100 + '%' }"></div></div>
          <div class="hud__txt">EXP {{ Math.round(me?.exp ?? 0) }}/{{ hudExpToNext }}</div>
        </div>
        <div class="hud__mid">
          <span v-if="mapTheme" class="hud__map" :title="mapSourceLabel">🗺 {{ mapTheme }}</span>
          <!-- ★ 该地图野怪信息：是否有怪 + 等级范围 -->
          <span class="hud__diff" :title="mapMobCount > 0 ? `本图 ${mapMobCount} 只野怪，等级 ${mapMobLevelRange?.[0]}-${mapMobLevelRange?.[1]}` : '本图安全，无野怪'">
            🐾 {{ mapMobCount > 0
              ? `${mapMobCount}只 Lv.${mapMobLevelRange?.[0]}-${mapMobLevelRange?.[1]}`
              : "无野怪" }}
          </span>
          <span>击杀 {{ state.kills }}</span>
          <span>金钱 +{{ state.money }}</span>
        </div>
        <button class="btn btn--exit" @click="exitGame">退出</button>
        <!-- ★ fix④：像素风开关（默认开；取消勾选 → 关闭像素化渲染，界面变清晰） -->
        <label class="pixel-toggle" title="像素风渲染开关：取消勾选可关闭像素化，画面更平滑清晰">
          <input type="checkbox" v-model="pixelMode" @change="onPixelModeChange" />
          <span>像素风</span>
        </label>
        <!-- ★ 战争迷雾开关（遮挡来自 tileset 的 blocks_vision，与 Rotten-Soup 的 Tile.visible() 同源） -->
        <label class="pixel-toggle" :title="`战争迷雾开关（视野 ${FOV_RADIUS_M} 米，已探索 ${fogExploredPct}%）`">
          <input type="checkbox" v-model="fogEnabled" @change="onFogToggle" />
          <span>迷雾 {{ fogExploredPct }}%</span>
        </label>
        <!-- ★ game.md 床碰撞：靠近床铺（tileset description=bed）显示睡眠按钮，满血满蓝恢复 -->
        <button v-if="nearBed" class="btn btn--sleep" title="在床上睡一觉：恢复满血满蓝" @click="onSleep">🛏 睡眠</button>
        <!-- ★ game.md 对话功能：靠近角色触发出聊按钮 -->
        <button v-if="nearChat" class="btn btn--chat" title="与角色对话" @click="onChatStart">💬 聊天</button>
      </div>

      <!-- ★ 睡眠恢复等 HUD 级提示（系统面板未打开时也能看到） -->
      <div v-if="hudToast" class="hud-toast" @click="hudToast = ''">{{ hudToast }}</div>

      <!-- ★ game.md 对话功能：聊天面板 -->
      <div v-if="chatActive" class="chat-panel">
        <div class="chat-panel__header">
          <span class="chat-panel__title">💬 与 {{ chatNpcName }} 对话</span>
          <button class="chat-panel__close" @click="onChatLeave">✕</button>
        </div>
        <div class="chat-panel__msgs">
          <div v-for="(m, i) in chatMessages" :key="i" :class="['chat-msg', m.mine ? 'chat-msg--mine' : 'chat-msg--npc']">
            <span class="chat-msg__speaker">{{ m.mine ? '我' : m.speaker }}</span>
            <p class="chat-msg__text">{{ m.text }}</p>
          </div>
          <div v-if="chatPending" class="chat-msg chat-msg--loading">
            <span class="chat-msg__speaker">{{ chatNpcName }}</span>
            <p class="chat-msg__text chat-msg__loading-dot">…思考中…</p>
          </div>
        </div>
        <div class="chat-panel__input-row">
          <input
            v-model="chatInputText"
            class="chat-panel__input"
            placeholder="输入文字或语音识别…"
            :disabled="chatPending"
            @keyup.enter="onChatSend"
          />
          <button class="chat-panel__send" :disabled="chatPending || !chatInputText.trim()" @click="onChatSend">发送</button>
        </div>
        <div class="chat-panel__actions">
          <button class="chat-action-btn" :disabled="chatPending" @click="onChatSend">发言</button>
          <button class="chat-action-btn" :disabled="chatPending" @click="onChatContinue">继续</button>
          <button class="chat-action-btn chat-action-btn--leave" @click="onChatLeave">离开</button>
        </div>
      </div>

      <!-- ★ v3 缩放控制（右上角，对应 25d_ai_game 的相机 zoom），上下限由 mulberryTown.json 决定 -->
      <div class="zoom-ctrl" :title="`zoom=${zoom}（${viewSizeMeters[0]}m × ${viewSizeMeters[1]}m）`">
        <button class="zoom-btn" @click="zoomIn" :disabled="zoom >= terrainScale.max_zoom">+</button>
        <div class="zoom-val">{{ zoom }}</div>
        <button class="zoom-btn" @click="zoomOut" :disabled="zoom <= terrainScale.min_zoom">−</button>
      </div>

      <!-- ★ fix⑤/⑥：右侧信息列（zoom-ctrl 下方）：迷你小地图 + 玩家当前坐标 -->
      <div class="right-col">
        <div class="minimap" :title="`迷你小地图：绿=你 / 蓝=盟友 / 红=野怪 / 黄=宝箱 / 粉=血瓶｜半径 ${MINIMAP_RANGE_M}m`">
          <canvas ref="minimapEl" class="minimap__cv" :width="MINIMAP_PX" :height="MINIMAP_PX"></canvas>
          <div class="minimap__legend">
            <span class="lg lg--me">你</span>
            <span class="lg lg--ally">盟友</span>
            <span class="lg lg--enemy">野怪</span>
          </div>
        </div>
        <div class="coord-box" :title="`当前世界坐标（米）：X ${(me?.x ?? 0).toFixed(1)} / Z ${(me?.y ?? 0).toFixed(1)}`">
          <div class="coord-box__row">X <b>{{ (me?.x ?? 0).toFixed(1) }}</b> m</div>
          <div class="coord-box__row">Z <b>{{ (me?.y ?? 0).toFixed(1) }}</b> m</div>
          <div class="coord-box__sub">区块 {{ Math.floor((me?.x ?? 0) / terrainScale.chunk_size_m) }}, {{ Math.floor((me?.y ?? 0) / terrainScale.chunk_size_m) }}</div>
        </div>
      </div>

      <!-- ★ v3 比例尺与方块刻度（右下角 scale ruler，对应 25d_ai_game 的 grid system） -->
      <div class="scale-ruler" :title="`block=${terrainScale.block_size}m, chunk=${terrainScale.chunk_size_m}m`">
        <div class="scale-ruler__pct">{{ viewSizeMeters[0].toFixed(1) }}m</div>
        <div class="scale-ruler__bar"></div>
        <div class="scale-ruler__lbl">
          1m × {{ zoom }} | 比例 1:{{ (1 / terrainScale.scale_meter).toFixed(2) }} | world {{ terrainScale.size[0] }}m
        </div>
      </div>

      <div class="stage-rotate" >
        <canvas
          ref="canvasEl"
          class="stage"
          :class="{ 'stage--smooth': !pixelMode }"
            :width="canvas_w_ref"
            :height="canvas_h_ref"
          @click="onCanvasClick"
        ></canvas>
      </div>

      <div class="events">
        <div v-for="(e, i) in (state?.events || []).slice(-8)" :key="i">{{ e }}</div>
      </div>

      <!-- 半透明控制层 -->
      <div class="pad" @pointerdown="stickStart" @pointermove="stickMove"
           @pointerup="stickEnd" @pointercancel="stickEnd" @pointerleave="stickEnd">
        <div class="pad__knob" :style="{ transform: `translate(${stick.x}px, ${stick.y}px)` }"></div>
      </div>

      <div class="slots slots--skill">
        <button v-for="(s, i) in skillPage" :key="i" class="slot"
                :class="{ 'slot--cd': s.cdLeft > 0 }" @click="castSkill(i)">
          <span class="slot__name">{{ s.name }}</span>
          <span v-if="s.cdLeft > 0" class="slot__cd">{{ Math.ceil(s.cdLeft / 10) }}</span>
        </button>
        <button class="slot slot--page" @click="pageSkill(1)">切换</button>
      </div>

      <div class="slots slots--item">
        <button v-for="(it, i) in itemPage" :key="i" class="slot"
                :class="{ 'slot--empty': it.count <= 0 }" @click="useItem(i)">
          <span class="slot__name">{{ it.name }}</span>
          <span class="slot__count">×{{ it.count }}</span>
        </button>
        <button class="slot slot--page" @click="pageItem(1)">切换</button>
      </div>

      <div class="tips">方向键 / WASD 移动，点击空地指定目标，摇杆可拖动</div>
    </section>

    <!-- ===== 结算 ===== -->
    <section v-else class="over">
      <h2>{{ state.result?.reason === 'death' ? '你倒下了……' : '野外生存结束' }}</h2>
      <ul>
        <li>存活帧数：{{ state.result?.survivedTicks }}</li>
        <li>击杀：{{ state.result?.kills }}</li>
        <li>获得经验：{{ state.result?.exp }}</li>
        <li>获得金钱：{{ state.result?.money }}</li>
        <li>掉落物品：{{ (state.result?.drops || []).join('、') || '无' }}</li>
      </ul>
      <div class="over__actions">
        <button class="start over__revive" @click="reviveGame">复活</button>
        <button class="start over__exit" @click="exitOver">退出</button>
      </div>
    </section>

    <!-- 调试面板（仅 debug 模式可见） -->
    <DebugPanel
      v-if="debugMode"
      :state="state"
      @select-entity="onSelectEntity"
    />

    <!-- 系统按钮（参考 DebugPanel 拖拽模式） -->
    <div
      class="sys-btn"
      :style="{ left: sysBtnPos.x + 'px', top: sysBtnPos.y + 'px' }"
      @click="onSysBtnClick"
      @pointerdown="onSysBtnDragStart"
      title="系统菜单"
    >
      ⚙
    </div>

    <!-- 系统面板 -->
    <div
      v-if="showSystemPanel"
      class="sys-panel"
      :style="{ left: sysPanelPos.x + 'px', top: sysPanelPos.y + 'px' }"
      @pointerdown.stop
    >
      <SystemPanel
        :player="sysPlayerRole"
        :npcs="sysNpcCards"
        :bag-items="sysBagItems"
        :ring-items="sysRing.items"
        :ring-skills="sysRing.skills"
        :skills="sysSkills"
        :goods="sysGoods"
        :goods-source="sysGoodsSource"
        :gold="sysGold"
        :current-mp="sysCurrentMp"
        :current-max-mp="sysCurrentMaxMp"
        :current-map="currentLevelName || 'Mulberry Town'"
        :player-x="sysPlayerX"
        :player-y="sysPlayerY"
        :map-nodes="sysMapNodes"
        :nav-path="[]"
        :notice="sysNotice"
        @drag-start="onSysPanelDragStart"
        @sell="onSysSellItem"
        @use-item="onSysUseItem"
        @sort="onSysSort"
        @sort-auto="onSysSortAuto"
        @edit-item="onSysEditItem"
        @ring-move="onSysRingMove"
        @ring-skill-move="onSysRingSkillMove"
        @shop-refresh="onSysShopRefresh"
        @shop-agent="onSysShopAgent"
        @buy="onSysBuyItem"
        @use-skill="onSysUseSkill"
        @edit-skill="onSysEditSkill"
        @teleport="onSysTeleport"
        @travel="onSysTravel"
        @follow="onSysFollow"
        @close="showSystemPanel = false"
      />
    </div>
  </div>
</template>

<style>
/* ============================================================
   Rotten-Soup 风格暗色 roguelike 主题
   ============================================================ */
* {
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
  background: #1e1f1f;
  color: #e8eef7;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

.fs {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: hidden;
  background: #1e1f1f;
}

/* 系统按钮 + 面板 */
.sys-btn {
  position: fixed;
  z-index: 9998;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(30, 31, 31, 0.92);
  border: 2px solid #d4a13e;
  color: #ffe79e;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  touch-action: none;
  user-select: none;
  transition: transform 0.1s;
}
.sys-btn:hover {
  background: rgba(60, 61, 61, 0.95);
  transform: scale(1.05);
}
.sys-btn:active {
  transform: scale(0.95);
}

.sys-panel {
  position: fixed;
  z-index: 9997;
  width: 420px;
  height: 560px;
  background: #1e1f1f;
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  user-select: none;
  font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
}

/* 通用：暗色像素边框风格 */
.ui-panel {
  background: #1e1f1f;
  border: 3px solid #4f4f4f;
  border-radius: 4px;
  color: #ececec;
}

/* ============== 选人阶段 ============== */
.select {
  height: 100%;
  overflow: auto;
  padding: 18px 20px;
  background: #1e1f1f;
}

.select__head h2 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #ffe79e;
  letter-spacing: 1px;
  text-shadow: 0 2px 0 #6a4f1f;
}

.select__head p {
  margin: 0 0 16px;
  font-size: 13px;
  color: #9aa0a6;
}

.select__group {
  margin-bottom: 14px;
  background: #2a2b2b;
  border: 2px solid #3d3d3d;
  border-radius: 4px;
  padding: 10px 12px;
}

.select__group h3 {
  font-size: 14px;
  margin: 0 0 8px;
  color: #ffe79e;
  letter-spacing: 1px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 0;
  cursor: pointer;
  border: 2px solid #4f4f4f;
  background: #2a2b2b;
  color: #d0d0d0;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}

.chip:hover {
  background: #3a3b3b;
  border-color: #6a6a6a;
}

.chip img {
  width: 24px;
  height: 24px;
  border-radius: 0;
  object-fit: cover;
  image-rendering: pixelated;
}

.chip--on {
  background: #d4a13e;
  border-color: #ffe79e;
  color: #1e1f1f;
  font-weight: 700;
}

.chip--danger.chip--on {
  background: #c0392b;
  border-color: #ff6b6b;
  color: #fff;
}

.hint {
  font-size: 12px;
  color: #8a8e93;
  margin: 6px 0 0;
}

.start {
  display: block;
  width: 100%;
  padding: 14px;
  margin-top: 12px;
  border: 2px solid #6a4f1f;
  border-radius: 0;
  background: #d4a13e;
  color: #1e1f1f;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
  box-shadow: 0 3px 0 #6a4f1f;
}

.start:hover:not(:disabled) {
  background: #ffe79e;
}

.start:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #6a4f1f;
}

.start:disabled {
  background: #3a3b3b;
  border-color: #4f4f4f;
  box-shadow: 0 3px 0 #2a2b2b;
  color: #8a8e93;
  cursor: not-allowed;
}

.start__loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.start__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(30, 31, 31, 0.3);
  border-top-color: #1e1f1f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ============== 上传地图按钮 ============== */
.map_upload {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 10px;
  padding: 12px 14px;
  border: 2px solid #4a3a1f;
  border-radius: 6px;
  background: linear-gradient(180deg, #2d2a24 0%, #1f1d18 100%);
  color: #f0e6c8;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: 0 2px 0 #4a3a1f, inset 0 1px 0 rgba(255, 230, 180, 0.08);
}
.map_upload:hover:not(:disabled) {
  background: linear-gradient(180deg, #3a362c 0%, #26221c 100%);
  border-color: #6a5530;
  transform: translateY(-1px);
  box-shadow: 0 3px 0 #4a3a1f, inset 0 1px 0 rgba(255, 230, 180, 0.12);
}
.map_upload:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: 0 1px 0 #4a3a1f;
}
.map_upload:disabled {
  cursor: progress;
  opacity: 0.85;
}
.map_upload--ok {
  border-color: #4f8a3e;
  background: linear-gradient(180deg, #2c3a25 0%, #1e2a18 100%);
  box-shadow: 0 2px 0 #2d5220, inset 0 1px 0 rgba(180, 230, 160, 0.12);
}
.map_upload--ok:hover:not(:disabled) {
  border-color: #6aaa52;
  background: linear-gradient(180deg, #354a2c 0%, #243520 100%);
  box-shadow: 0 3px 0 #2d5220, inset 0 1px 0 rgba(180, 230, 160, 0.18);
}
.map_upload__icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.5));
}
.map_upload__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.map_upload__text strong {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #f5e9c4;
}
.map_upload__text small {
  font-size: 11px;
  color: #b8a87a;
  letter-spacing: 0.2px;
}
.map_upload__idle strong { color: #f5e9c4; }
.map_upload__success strong { color: #aee089; }
.map_upload__loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #f5e9c4;
}
.map_upload__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(245, 233, 196, 0.3);
  border-top-color: #f5e9c4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ============== 战斗阶段 ============== */
.play {
  position: absolute;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 🔄 旋转 wrapper：居中 + 可选 90° 旋转 */
.stage-rotate {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;            /* 旋转后超出部分裁掉，绝不显示黑边 */
  cursor: pointer;             /* ★ 手指光标（画布外一圈也保持"可点击走路"的暗示） */
}


.stage-rotate--on {
  transform: rotate(90deg);
  /* 旋转 90° 后，原本"宽度"变成"高度"——再 transform-origin: center */
}
.stage {
  display: block;
  background: #0a0a0a;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  /* ★ 手指光标：画布本身就是"点击地面走路"的操作面（HUD 按钮各自是 pointer） */
  cursor: pointer;
  touch-action: manipulation;
}

/* ★ fix④：取消勾选「像素风」后，画布交给浏览器做平滑插值（界面立刻变清晰） */
.stage--smooth {
  image-rendering: auto;
  image-rendering: smooth;
  image-rendering: -webkit-optimize-contrast;
}

/* ★ fix④：像素风复选框（HUD 的「退出」按钮旁） */
.pixel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: 1px;
  padding: 3px 3px;
  font-size: 12px;
  line-height: 1.2;
  color: #e8e2d0;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.pixel-toggle input {
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: #8ce07a;
  cursor: pointer;
}
.pixel-toggle:active { transform: scale(0.97); }

/* ★ fix③：开始游戏的等待/超时提示 */
.start-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #f0c674;
  text-align: center;
}

/* ★ fix⑤/⑥：右侧信息列（迷你小地图 + 坐标），位于 zoom-ctrl 下方 */
.right-col {
  position: absolute;
  right: 8px;
  top: 121px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  pointer-events: none;
}
/* 短屏（手机横屏）缩放，保证小地图 + 坐标不会被裁掉 */
@media (max-height: 460px) {
  .right-col { transform: scale(0.78); transform-origin: top right; }
}
@media (max-height: 380px) {
  .right-col { transform: scale(0.68); transform-origin: top right; }
}
.minimap {
  width: 110px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.minimap__cv {
  display: block;
  width: 110px;
  height: 110px;
}
.minimap__legend {
  display: flex;
  justify-content: space-around;
  padding: 2px 0 3px;
  font-size: 6px;
  color: #cfd6c4;
}
.lg::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 3px;
  border-radius: 50%;
  vertical-align: middle;
}
.lg--me::before { background: #8ce07a; }
.lg--ally::before { background: #5b9bff; }
.lg--enemy::before { background: #ff5b5b; }
.coord-box {
  min-width: 69px;
  padding: 4px 8px;
  font-size: 6px;
  line-height: 1.2;
  color: #e8e2d0;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
}
.coord-box__row b {
  color: #ffe9a8;
  font-variant-numeric: tabular-nums;
}
.coord-box__sub {
  font-size: 6px;
  color: #a9b39c;
}

/* HUD */
.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0px 2px;
  background: #1e1f1f0d;
  border-bottom: 1px solid #1e1f1f0d;
  color: #ececec;
  font-size: 12px;
  line-height: 11px;
}

.hud__left {
  min-width: 200px;
}

.hp {
  width: 180px;
  height: 9px;
  border: 2px solid #4f4f4f;
  background: #1e0e0e;
  position: relative;
  overflow: hidden;
}

.hp__bar {
  height: 100%;
  background: linear-gradient(180deg, #6ee06e 0%, #2fa85a 100%);
  transition: width 0.2s;
}

.lv-hud {
  font-size: 12px;
  font-weight: 700;
  color: #f5c542;
  margin-bottom: 1px;
  text-shadow: 1px 1px 2px #000;
}

.mp {
  width: 180px;
  height: 8px;
  border: 2px solid #4f4f4f;
  background: #0e0e1e;
  position: relative;
  overflow: hidden;
  margin-top: 1px;
}

.mp__bar {
  height: 100%;
  background: linear-gradient(180deg, #5eb5ff 0%, #1a5fa8 100%);
  transition: width 0.2s;
}

.exp {
  width: 180px;
  height: 6px;
  border: 1px solid #4f4f4f;
  background: #1e1e0e;
  position: relative;
  overflow: hidden;
  margin-top: 1px;
}

.exp__bar {
  height: 100%;
  background: linear-gradient(180deg, #f5c542 0%, #a87820 100%);
  transition: width 0.2s;
}

.hud__txt {
  font-size: 11px;
  color: #ececec;
  margin-top: 1px;
  font-weight: 600;
}

.hud__mid {
  display: flex;
  gap: 1px;
  font-size: 12px;
  color: #d0d0d0;
  flex: 1;
  align-items: center;
  flex-wrap: wrap;
  position: absolute;
  top:113px;
  left: 0px;
}

.hud__mid > span {
  padding: 2px 8px;
  background: #2a2b2b;
  border: 1px solid #4f4f4f;
  border-radius: 2px;
}

.hud__map {
  color: #ffe79e !important;
  font-weight: 600;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-color: #d4a13e !important;
}

.hud__diff {
  color: #ff9e9e !important;
  font-weight: 600;
  border-color: #c0392b !important;
}

.btn--exit {
  border: 2px solid #c0392b;
  border-radius: 0;
  padding: 2px 6px;
  cursor: pointer;
  background: #c0392b;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  box-shadow: 0 2px 0 #6a1f1f;
}

.btn--exit:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #6a1f1f;
}

/* ★ HUD 级提示条（睡眠恢复 / 关键结果）：居中偏上，暖金高亮，点击关闭 */
.hud-toast {
  position: absolute;
  top: 14%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  max-width: 78%;
  padding: 8px 16px;
  border: 2px solid #ffd479;
  background: linear-gradient(180deg, rgba(60, 42, 16, 0.96), rgba(38, 26, 8, 0.96));
  color: #ffe9b0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-align: center;
  text-shadow: 0 1px 0 #4a330f;
  box-shadow: 0 0 0 2px #6a4a12, 0 6px 18px rgba(0, 0, 0, 0.55);
  cursor: pointer;
  animation: toastIn 0.28s ease-out;
  pointer-events: auto;
}

@keyframes toastIn {
  from { opacity: 0; transform: translate(-50%, -10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* ★ game.md 床碰撞：睡眠按钮（靠近床铺出现，像素风与退出按钮同族、暖色区分） */
.btn--sleep {
  border: 2px solid #8a5a2a;
  border-radius: 0;
  padding: 2px 6px;
  cursor: pointer;
  background: #b07a3e;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  box-shadow: 0 2px 0 #5a3a18;
  animation: sleepPulse 1.2s ease-in-out infinite;
}

.btn--sleep:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #5a3a18;
}

@keyframes sleepPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* ★ game.md 对话功能：聊天按钮（靠近角色时出现，蓝色调与睡眠按钮区分） */
.btn--chat {
  border: 2px solid #2a5a8a;
  border-radius: 0;
  padding: 2px 6px;
  cursor: pointer;
  background: #3a7abf;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  box-shadow: 0 2px 0 #1a3a5a;
  animation: chatPulse 1.5s ease-in-out infinite;
}
.btn--chat:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #1a3a5a;
}
@keyframes chatPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.2); }
}

/* ★ game.md 对话功能：聊天面板 */
.chat-panel {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9996;
  width: min(480px, 94vw);
  max-height: 42vh;
  background: rgba(18, 20, 26, 0.96);
  border: 2px solid #3a5a8a;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7);
  font-size: 12px;
}
.chat-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(30, 50, 80, 0.7);
  border-bottom: 1px solid #2a4a7a;
  flex-shrink: 0;
}
.chat-panel__title { font-size: 11px; color: #9ac8ff; font-weight: 700; }
.chat-panel__close {
  background: none; border: none; color: #7a9abf; font-size: 14px; cursor: pointer; padding: 0 4px;
}
.chat-panel__msgs {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 80px;
  max-height: 22vh;
}
.chat-msg { display: flex; flex-direction: column; gap: 1px; }
.chat-msg--npc { align-items: flex-start; }
.chat-msg--mine { align-items: flex-end; }
.chat-msg--loading { opacity: 0.6; }
.chat-msg__speaker { font-size: 10px; font-weight: 700; color: #7ab8ff; }
.chat-msg--mine .chat-msg__speaker { color: #8adb8a; }
.chat-msg__text {
  margin: 0;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(40, 60, 100, 0.5);
  color: #dceeff;
  max-width: 80%;
  line-height: 1.4;
}
.chat-msg--mine .chat-msg__text {
  background: rgba(30, 70, 40, 0.6);
  color: #c8f0c8;
}
.chat-msg__loading-dot { color: #7a9abf; font-style: italic; }

.chat-panel__input-row {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid #2a4a7a;
  flex-shrink: 0;
}
.chat-panel__input {
  flex: 1;
  background: rgba(30, 40, 60, 0.8);
  border: 1px solid #3a5a8a;
  border-radius: 3px;
  color: #dceeff;
  font-size: 12px;
  padding: 3px 6px;
  outline: none;
}
.chat-panel__input:focus { border-color: #5a8abf; }
.chat-panel__input::placeholder { color: #5a7a9f; }
.chat-panel__send {
  background: #2a5a9a; border: 1px solid #4a7abf; border-radius: 3px;
  color: #c8e4ff; font-size: 11px; cursor: pointer; padding: 3px 8px;
}
.chat-panel__send:disabled { opacity: 0.4; cursor: not-allowed; }

.chat-panel__actions {
  display: flex;
  gap: 6px;
  padding: 4px 8px 6px;
  justify-content: center;
  flex-shrink: 0;
}
.chat-action-btn {
  padding: 3px 14px;
  border-radius: 3px;
  border: 1px solid #3a5a8a;
  background: #1e3a6a;
  color: #9ac8ff;
  font-size: 11px;
  cursor: pointer;
}
.chat-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.chat-action-btn--leave {
  border-color: #5a2a2a;
  background: #4a1e1e;
  color: #ffaaaa;
}


/* ===== 缩放控制（右上角：zoom+ / zoom- 按钮，对应 25d_ai_game 的 camera zoom） ===== */
.zoom-ctrl {
  position: absolute;
  right: 8px;
  top: 44px;          /* 避开 HUD 顶部 */
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: rgba(30, 31, 31, 0.85);
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  box-shadow: 0 2px 0 #1e1f1f;
  user-select: none;
}
.zoom-ctrl .zoom-btn {
  width: 2rem;
  height: 1rem;
  border: 2px solid #6a4f1f;
  background: #d4a13e;
  color: #1e1f1f;
  font-size: 10px;
  font-weight: 700;
  border-radius: 2px;
  cursor: pointer;
  line-height: 1;
}
.zoom-ctrl .zoom-btn:hover:not(:disabled) {
  background: #ffe79e;
}
.zoom-ctrl .zoom-btn:active:not(:disabled) {
  transform: translateY(1px);
}
.zoom-ctrl .zoom-btn:disabled {
  background: #3a3b3b;
  color: #6a6a6a;
  border-color: #4f4f4f;
  cursor: not-allowed;
}
.zoom-ctrl .zoom-val {
  font-size: 14px;
  font-weight: 700;
  color: #ffe79e;
  background: #1e1f1f;
  padding: 2px 6px;
  border: 1px solid #4f4f4f;
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ===== 比例尺标尺（右下角，对应 25d_ai_game 的 grid system） ===== */
.scale-ruler {
  position: absolute;
  right: 53px;
  top: 44px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 4px 6px;
  background: rgba(30, 31, 31, 0.85);
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  color: #ececec;
  font-size: 6px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.scale-ruler__bar {
  width: 80px;
  height: 6px;
  background: linear-gradient(90deg, #ffe79e 50%, #d4a13e 50%);
  border: 1px solid #1e1f1f;
  margin-top: 1px;
}
.scale-ruler__pct {
  font-weight: 700;
  color: #ffe79e;
}
.scale-ruler__lbl {
  font-size: 6px;
  color: #9aa0a6;
  margin-top: 1px;
  text-align: right;
  white-space: nowrap;
}

/* 🔄 横竖屏切换按钮（左上角，要求 req.md:57-58） */
.btn--rotate {
  position: absolute;
  left: 8px;
  top: 133px; /* 避开 HUD */
  z-index: 6;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 2px solid #d4a13e;
  border-radius: 0;
  background: rgba(30, 31, 31, 0.85);
  color: #ffe79e;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 2px 0 #6a4f1f;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease;
}
.btn--rotate:active {
  transform: translateY(2px) rotate(180deg);
  box-shadow: 0 0 0 #6a4f1f;
}
.btn--rotate:hover {
  background: #3a3b3b;
}

.events {
  position: absolute;
  left: 12px;
  top: 177px;
  z-index: 5;
  font-size: 8px;
  color: #ececec;
  text-shadow: 0 1px 2px #000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
  background: rgba(30, 31, 31, 0.7);
  padding: 6px 10px;
  border: 2px solid #4f4f4f;
  border-radius: 2px;
  max-width: 260px;
}

.events > div {
  color: #d0d0d0;
}

.events > div:first-child {
  color: #ffe79e;
  font-weight: 600;
}

/* 摇杆 */
.pad {
  position: absolute;
  left: 18px;
  bottom: 100px;
  z-index: 6;
  width: 73px;
  height: 73px;
  border-radius: 50%;
  background: rgba(30, 31, 31, 0.7);
  border: 3px solid #4f4f4f;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.5);
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pad__knob {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: #d4a13e;
  border: 2px solid #ffe79e;
  box-shadow: 0 0 0 2px #6a4f1f;
}

/* 技能 / 物品 */
.slots {
  position: absolute;
  bottom: 18px;
  z-index: 6;
  display: flex;
  gap: 2px;
}

.slots--skill {
  right: 2px;
}

.slots--item {
  right: 2px;
  bottom: 70px;
}

.slot {
  width: 2.5rem;
  height: 2rem;
  border-radius: 0;
  cursor: pointer;
  border: 2px solid #4f4f4f;
  background: #2a2b2b;
  color: #ececec;
  font-size: 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  position: relative;
  padding: 2px;
  transition: all 0.1s;
}

.slot:hover {
  background: #3a3b3b;
  border-color: #6a6a6a;
}

.slot__name {
  max-width: 46px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.slot__count {
  font-size: 10px;
  color: #ffe79e;
  font-weight: 700;
}

.slot__cd {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  font-size: 18px;
  font-weight: 700;
  color: #ff6b6b;
}

.slot--empty {
  opacity: 0.35;
}

.slot--page {
  width: 34px;
  background: #3a3b3b;
  border-color: #6a6a6a;
  color: #d4a13e;
  font-weight: 700;
}

.slot--page:hover {
  background: #4a4b4b;
}

.tips {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(236, 236, 236, 0.5);
  z-index: 4;
  letter-spacing: 1px;
}

/* ============== 结算 ============== */
.over {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #1e1f1f;
}

.over h2 {
  margin: 0;
  font-size: 28px;
  color: #ffe79e;
  letter-spacing: 2px;
  text-shadow: 0 3px 0 #6a4f1f;
}

.over ul {
  list-style: none;
  padding: 12px 24px;
  margin: 0;
  font-size: 14px;
  line-height: 2;
  color: #ececec;
  background: #2a2b2b;
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  min-width: 280px;
}

.over ul li {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}

.over ul li::before {
  content: "▸ ";
  color: #d4a13e;
  margin-right: 8px;
}

.over__actions {
  display: flex;
  gap: 14px;
}

.over .start {
  width: 150px;
  margin-top: 0;
}

/* 「退出」：沿用结算页原有的中性暗色样式，与「复活」主按钮区分 */
.over__exit {
  background: #3a3b3b;
  border-color: #4f4f4f;
  color: #cfd6df;
  box-shadow: 0 3px 0 #2a2b2b;
}

.over__exit:hover:not(:disabled) {
  background: #4a4b4b;
}
</style>
