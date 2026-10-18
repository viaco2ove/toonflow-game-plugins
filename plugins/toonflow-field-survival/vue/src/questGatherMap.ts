/**
 * questGatherMap.ts —— 采集物品 → 采集区域映射
 * =============================================
 * 职责：建立「任务目标物品 → 采集区 zone 名」的静态映射，
 *       让采集类任务也能有寻路按钮（寻路到最近的采集点）。
 *
 * 数据来源：story-pack events.json 的 trigger.zone + eventScripts 的 bag.give
 *
 * ★ zone 名必须与 Tiled map 的 eventZones[].name 完全一致！
 *   目前可用的采集区（story-pack 实际定义的）：
 *   - mulberryTown：夜采药圃（herb）、木材堆（wood）
 *   - mulberryForest：林中药丛（herb）
 *   （"农田"/"喷水池"/"林场" 不在 story-pack 中，跳过）
 *
 * 映射结构：
 *   targetItem → [ { zone, gatherKind, mapKey?, note? }, ... ]
 *   - zone: 对应 trigger.zone（eventZones[].name）
 *   - gatherKind: "herb" | "fish" | "wood" | "ore"
 *   - mapKey: 该采集区所在地图的 level key；缺省 = 本图
 */

/** 采集区定义 */
export interface GatherZone {
  zone: string;
  kind: "herb" | "fish" | "wood" | "ore";
  /** 该采集区所在地图的 level key；缺省表示本图 */
  mapKey?: string;
  note?: string;
}

/** 物品名 → 可能产出的采集区列表（同物品多处可采时选最近的） */
export const GATHER_ZONES_BY_ITEM: Record<string, GatherZone[]> = {
  // ── 药草类（herb）────────────────────────────────────────────
  // ★ mulberryTown：夜采药圃 → SY_E02_night_herb.ts
  //   产出：夜合花 35% / 血参 23% / 当归 20% / 药瓶 12% / 空手 10%
  // ★ mulberryForest：林中药丛 → SY_E18_forest_herb.ts
  //   产出：血参 50% / 夜合花 30% / 空手 20%
  // 同一物品多处可采 → 数组列出所有候选，寻路时选最近/本图优先
  "夜合花": [
    { zone: "夜采药圃", kind: "herb", note: "桑镇·夜采药圃" },
    { zone: "林中药丛", kind: "herb", mapKey: "mulberryForest", note: "桑林" },
  ],
  "血参": [
    { zone: "夜采药圃", kind: "herb", note: "桑镇·夜采药圃" },
    { zone: "林中药丛", kind: "herb", mapKey: "mulberryForest", note: "桑林" },
  ],
  "药瓶": [{ zone: "夜采药圃", kind: "herb", note: "桑镇·夜采药圃" }],
  "当归": [{ zone: "夜采药圃", kind: "herb", note: "桑镇·夜采药圃" }],
  "草药": [
    { zone: "夜采药圃", kind: "herb", note: "桑镇·夜采药圃" },
    { zone: "林中药丛", kind: "herb", mapKey: "mulberryForest", note: "桑林" },
  ],

  // ── 木材类（wood）────────────────────────────────────────────
  // ★ mulberryTown：木材堆 → SY_E08_wood_at.ts
  //   产出：松木 2 / 沉香木 1 / 朽木 1（每次最多 3）
  "松木":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  "沉香":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  "沉香木": [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  "朽木":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  // 上位词
  "木材":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  "木料":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],
  "木柴":   [{ zone: "木材堆", kind: "wood", note: "桑镇" }],

  // ── 击杀掉落类（无固定采集区）────────────────────────────────
  // 暗核由 DEFAULT_DROP_TABLE 击杀掉宝箱产出，无固定 zone，不提供寻路目标
  "暗核":   [],
};
