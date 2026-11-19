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
 * 两级匹配（均为通用规则，不绑定具体故事）：
 *   ① 物品名匹配：任务目标与事件 ai.items 逐项精确相等或双向包含；
 *   ② 类型兜底：目标是上位词（如「药材 / 木材 / 鱼」）未命中具体物品名时，
 *      按通用关键字归到 herb/wood/fish/ore，再匹配同类型已声明的采集区。
 *   未在 ai.items 里声明产出物、也未声明 gather 类型的区域，这里不臆测。
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

/** 目标物品与产出物名匹配：精确相等，或双向包含（上位词 ≈ 下位词） */
function matches(target: string, item: string): boolean {
  if (!target || !item) return false;
  return target === item || target.includes(item) || item.includes(target);
}

/**
 * 通用关键字 → 采集类型兜底（不含任何故事物名 / 区名）。
 * 目标是上位词（药材 / 木材 / 鱼 / 矿石…）时，按字面关键字归类；归类不出返回 null。
 */
function classifyTargetKind(target: string): GatherKind | null {
  const t = target;
  if (/鱼|钓|渔/.test(t)) return "fish";
  if (/木|柴|树|林/.test(t)) return "wood";
  if (/矿|铁|石|铜|银|金/.test(t)) return "ore";
  if (/药|草|参|芝/.test(t)) return "herb";
  return null;
}

/**
 * 从故事包事件定义推导：目标物品能在哪些采集区采到。
 *
 * @param target 任务目标物品名
 * @param events 当前图已加载的事件定义（eventEngine.getLoadedEvents()）
 * @param mapKey  这些事件所在地图的 level key；缺省表示当前图
 * @returns 命中的采集区列表（同区去重）；未命中时返回空数组
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
  const fallbackKind = classifyTargetKind(t);

  for (const ev of events || []) {
    const tr = ev?.trigger;
    if (!tr || tr.type !== "area_enter" || !norm(tr.zone)) continue;
    const ai = tr.ai;
    const items = Array.isArray(ai?.items) ? ai.items.map(norm).filter(Boolean) : [];
    const zoneKind = (ai?.gather as GatherKind) || "other";

    // ① 物品名命中；② 未声明 items 时，按通用类型兜底匹配同类型采集区
    const nameHit = items.some((it) => matches(t, it));
    const kindHit = !nameHit && fallbackKind !== null && zoneKind === fallbackKind;
    if (!nameHit && !kindHit) continue;

    const zone = norm(tr.zone);
    const key = `${mapKey || ""}::${zone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      zone,
      kind: zoneKind,
      mapKey,
    });
  }
  return out;
}
