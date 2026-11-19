/**
 * questGatherMap.ts —— 采集物品 → 采集区 运行时推导
 * =============================================
 * 职责：根据任务目标物品名，在「故事包已加载的事件定义」里反查可采集的区域，
 *       让采集类任务也能生成寻路目的地。
 *
 * ★ 铁律：本文件是插件通用代码，**禁止写入任何故事名 / 区名 / 物品名**。
 *   物品 → 采集区的对应关系全部来自故事包事件定义：
 *     - trigger.type = "area_enter"
 *     - trigger.zone  = 采集区名（与地图 eventZones[].name 一致）
 *     - trigger.ai.gather = "herb" | "fish" | "wood" | "ore" | "other"
 *     - trigger.ai.items  = 该采集区实际产出的物品名清单（故事包声明）
 *
 * 未在 ai.items 里声明产出物的采集区，这里不臆测它能采到什么。
 */

export type GatherKind = "herb" | "fish" | "wood" | "ore" | "other";

/** 一个可采集区域（运行时由事件定义推导） */
export interface GatherZone {
  /** 采集区名（eventZones[].name） */
  zone: string;
  /** 采集类型 */
  kind: GatherKind;
  /** 所在地图 level key；缺省 = 当前图 */
  mapKey?: string;
}

/** 事件定义的最小结构（与 shared/_ctx.ts 的 area_enter 触发器对齐） */
export interface GatherEventLike {
  trigger?: {
    type?: string;
    zone?: string;
    ai?: { gather?: GatherKind | string; items?: string[] };
  };
}

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

/** 目标物品与产出物名匹配：精确相等，或双向包含（上位词 ≈ 下位词，如「草药」≈「止血草药」） */
function matches(target: string, item: string): boolean {
  if (!target || !item) return false;
  return target === item || target.includes(item) || item.includes(target);
}

/**
 * 从故事包事件定义推导：目标物品能在哪些采集区采到。
 *
 * @param target 任务目标物品名
 * @param events 当前图已加载的事件定义（eventEngine.getLoadedEvents()）
 * @param mapKey  这些事件所在地图的 level key；缺省表示当前图
 * @returns 命中的采集区列表（同区去重）；未声明 items 或未命中时返回空数组
 */
export function gatherZonesFromEvents(
  target: string,
  events: GatherEventLike[],
  mapKey?: string,
): GatherZone[] {
  const out: GatherZone[] = [];
  const seen = new Set<string>();
  const t = norm(target);
  if (!t) return out;

  for (const ev of events || []) {
    const tr = ev?.trigger;
    if (!tr || tr.type !== "area_enter" || !norm(tr.zone)) continue;
    const ai = tr.ai;
    const items = Array.isArray(ai?.items) ? ai.items.map(norm).filter(Boolean) : [];
    // 未显式声明产出物清单 → 不臆测，跳过
    if (!items.length) continue;
    if (!items.some((it) => matches(t, it))) continue;

    const zone = norm(tr.zone);
    const key = `${mapKey || ""}::${zone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      zone,
      kind: (ai?.gather as GatherKind) || "other",
      mapKey,
    });
  }
  return out;
}
