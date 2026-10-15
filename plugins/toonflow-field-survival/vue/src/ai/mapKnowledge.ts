/**
 * mapKnowledge.ts — 地图集知识（AI 侧消费）
 * ============================================
 * 职责：把「地图集」的能力暴露给 AI 大脑，让插件不需要硬编码任何地图数据。
 *
 * 数据来源（全部派生，不新建数据源）：
 *   1. `getEventZones()`      — eventEngine 已加载的本图 eventZones（坐标/半径）
 *   2. `getLoadedEvents()`    — 本图 events.json 的事件定义（area_enter / interact）
 *
 * 「这个 zone 能采什么」判定优先级：
 *   ① events.json 显式声明：trigger.ai.gather = "herb" | "fish" | "wood" | ...
 *      （地图集作者的权威声明，推荐用法）
 *   ② 事件 id 推断（E11_herb_at → herb / E10_fishing_at → fish / E12_wood_at → wood）
 *   ③ zone 名关键词推断（农田/药 → herb，水池/泉 → fish，木材/树 → wood）
 *
 * 与 entry.js 的分工：
 *   - entry.js（插件）：只负责「AI 走到 zone 并打到达标记 _aiGatherArrived」
 *   - 本模块 + 事件引擎（地图集）：到达后 onAreaEnter(zone) 复用玩家同款脚本产出
 *   产出逻辑（掉什么/给多少）永远在地图集的 events/scripts/*.ts 里，插件不重复实现。
 */
import { getEventZones, getLoadedEvents, fireEventManually } from "../eventEngine";

/** 采集类型（与 sensor.ts 的 AIResourcePerception["type"] 对齐） */
export type GatherKind = "herb" | "fish" | "wood" | "ore" | "other";

/** 单个可采集 zone 的知识 */
export interface ZoneKnowledge {
  /** zone 名（events.json trigger.zone 用的就是这个） */
  name: string;
  /** zone 中心坐标（米，与实体同单位） */
  x: number;
  y: number;
  /** 采集类型 */
  kind: GatherKind;
  /** 承载采集逻辑的事件 id（到达后前端用它触发，见 triggerZoneGather） */
  eventId: string;
  /** 该事件是否 repeat（可反复采） */
  repeat: boolean;
}

/** 一张地图对 AI 暴露的全部知识 */
export interface MapKnowledge {
  mapName: string;
  /** 可采集 zone 列表 */
  gatherZones: ZoneKnowledge[];
  /** 有 interact 事件的 Tiled object id（AI 知道该找谁交互） */
  interactUids: string[];
  /** 注入大脑 prompt 的摘要文本 */
  summary: string;
}

/** 事件 id → 采集类型推断（兜底用，地图集应优先用 trigger.ai.gather 显式声明） */
function kindFromEventId(eventId: string): GatherKind | null {
  const id = String(eventId || "").toLowerCase();
  if (/herb|药|草|农田/.test(id)) return "herb";
  if (/fish|fishing|钓|渔/.test(id)) return "fish";
  if (/wood|木|林|树/.test(id)) return "wood";
  if (/ore|mine|矿/.test(id)) return "ore";
  return null;
}

/** zone 名 → 采集类型推断（最后兜底） */
function kindFromZoneName(zoneName: string): GatherKind {
  const nm = String(zoneName || "");
  if (/农田|药|草|田/.test(nm)) return "herb";
  if (/水池|喷泉|泉|溪|河|湖|钓/.test(nm)) return "fish";
  if (/木材|木|树|林/.test(nm)) return "wood";
  if (/矿|石/.test(nm)) return "ore";
  return "other";
}

/** 从事件定义里取该 zone 的采集类型（① 显式声明 → ② id 推断 → ③ 名推断） */
function resolveGatherKind(ev: { id: string; trigger: { zone?: string; ai?: { gather?: string } } }): GatherKind {
  const declared = String(ev.trigger?.ai?.gather || "").toLowerCase();
  if (declared === "herb" || declared === "fish" || declared === "wood" || declared === "ore") return declared;
  if (declared) return "other";
  return kindFromEventId(ev.id) ?? kindFromZoneName(ev.trigger?.zone || "");
}

/** area_enter 事件的窄视图（避开跨 6 层目录 import shared/_ctx 的 EventDef） */
interface AreaEnterEvent {
  id: string;
  repeat?: boolean;
  trigger: { type: "area_enter"; zone: string; ai?: { gather?: GatherKind } };
}

/**
 * 读取当前地图的 AI 知识（每次调用实时派生，切图后自然更新）。
 * 事件引擎未加载（无 events.json）时返回空知识，大脑按"无地图知识"处理。
 */
export function readMapKnowledge(): MapKnowledge {
  const zones = getEventZones() || [];
  const events = getLoadedEvents() || [];

  // zone 名 → area_enter 事件（同一 zone 多个事件时优先取 repeat 的）
  const gatherEvByZone = new Map<string, AreaEnterEvent>();
  for (const ev of events) {
    const t = ev.trigger as { type?: string; zone?: string } | undefined;
    if (t?.type !== "area_enter" || !t.zone) continue;
    const prev = gatherEvByZone.get(t.zone);
    if (!prev || (ev.repeat && !prev.repeat)) gatherEvByZone.set(t.zone, ev as unknown as AreaEnterEvent);
  }

  const gatherZones: ZoneKnowledge[] = [];
  for (const z of zones) {
    const ev = gatherEvByZone.get(z.name);
    if (!ev) continue; // 没有 area_enter 事件的 zone 对 AI 不是采集点
    const declared = String((ev.trigger as { ai?: { gather?: string } })?.ai?.gather || "").toLowerCase();
    const kind = resolveGatherKind(ev);
    // 非采集类 area_enter 事件（如「拾扫帚」剧情事件）不算采集点：
    // 既没有显式声明、解析类型又是兜底 other → 跳过，避免 AI 跑过去「采集」却无产出
    if (kind === "other" && !declared) continue;
    gatherZones.push({
      name: z.name,
      x: z.x,
      y: z.y,
      kind,
      eventId: ev.id,
      repeat: !!ev.repeat,
    });
  }

  const interactUids: string[] = [];
  for (const ev of events) {
    if (ev.trigger?.type !== "interact") continue;
    const uid = String(ev.trigger.uid || "");
    if (uid && !interactUids.includes(uid)) interactUids.push(uid);
  }

  return { mapName: "", gatherZones, interactUids, summary: buildSummary(gatherZones, interactUids) };
}

/** 生成给大脑 prompt 的「本图知识」摘要段 */
function buildSummary(zones: ZoneKnowledge[], uids: string[]): string {
  const lines: string[] = [];
  if (zones.length) {
    lines.push("本图可采集地点：");
    for (const z of zones) {
      lines.push(`- ${z.name}（${z.kind}）坐标 (${Math.round(z.x)}, ${Math.round(z.y)})${z.repeat ? "，可反复采集" : ""}`);
    }
  }
  if (uids.length) {
    lines.push(`本图可交互对象（Tiled id）：${uids.join("、")}`);
  }
  return lines.join("\n");
}

/**
 * AI 采集到达后调用：复用玩家同款区域事件脚本（events/scripts/*.ts）。
 * 产出（掉什么/给多少/弹不弹确认）完全由地图集脚本决定，插件不重复实现。
 *
 * @param zoneName 采集区域名（对应地图 eventZones 里的 name）
 * @param actor 采集者（AI 角色 id + 名字）。传入后脚本内的 confirm 自动通过、
 *              bag.give 落进该角色的 _aiBag，不再弹窗打断玩家、也不污染玩家背包。
 * @returns 是否找到了对应事件并触发（false = 该 zone 没有采集事件，调用方应放弃）
 */
export async function triggerZoneGather(zoneName: string, actor?: { roleId: string; name: string }): Promise<boolean> {
  const ev = (getLoadedEvents() || []).find(
    (e) => e.trigger?.type === "area_enter" && String(e.trigger.zone || "") === String(zoneName || ""),
  );
  if (!ev) return false;
  // fireEventManually 会清掉 firedIds / 冷却强制跑一次（repeat 采集事件本就该可重复触发）
  await fireEventManually(ev.id, actor && actor.roleId ? actor : { roleId: "", name: "player" });
  return true;
}
