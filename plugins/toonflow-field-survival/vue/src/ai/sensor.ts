/**
 * ai/sensor.ts — AI 感知系统
 * =============================
 * 收集 AI 角色周围的游戏数据：
 * - 自身状态（HP、MP、位置、物品、技能）
 * - 周围实体（敌人/友方/NPC）
 * - 资源点（来自 eventEngine 的 eventZones）
 * - 世界信息（地图、时间）
 */

import type {
  AIPerception,
  AIResourcePerception,
  Entity,
  GameState,
  ItemSlot,
  SkillSlot,
} from "../types";
import { readMapKnowledge } from "./mapKnowledge";

/** 感知半径（米），与玩家视野一致 */
const PERCEPTION_RADIUS = 13;
/** 资源感知半径（米） */
const RESOURCE_RADIUS = 26;
/** AI 私藏格数上限（与 entry.ts AI_BAG_MAX_SLOTS、checkEmergency inventoryFull 判据同源） */
const AI_BAG_MAX_SLOTS = 8;

/** 从 entity 抽取自身感知 */
function senseSelf(entity: Entity, state: GameState): AIPerception["self"] {
  // ★ AI 背包 = 队伍背包（state.items，采集产出经 giveItem 进这里）+ AI 私藏（entity._aiBag）
  //   合并展示：大脑要知道「采到的东西进了队伍包」，否则采完仍以为空手。
  const merged = new Map<string, number>();
  for (const it of state.items || []) {
    const nm = String(it?.name || "");
    if (nm) merged.set(nm, (merged.get(nm) || 0) + (Number(it?.count) || 0));
  }
  const aiBag = entity._aiBag;
  if (Array.isArray(aiBag)) {
    for (const b of aiBag) {
      const nm = String(b?.name || "");
      if (nm && (Number(b?.count) || 0) > 0) merged.set(nm, (merged.get(nm) || 0) + (Number(b.count) || 0));
    }
  }
  const items: { name: string; count: number }[] = [...merged.entries()].map(([name, count]) => ({ name, count }));
  const skills: { name: string; cost: number; cdLeft: number }[] = (state.skills || []).map(
    (s: SkillSlot) => ({ name: s.name, cost: s.cost, cdLeft: s.cdLeft }),
  );
  const maxHp = entity.maxHp || 1;
  const maxMp = entity.maxMp || 1;
  return {
    id: entity.id,
    name: entity.name,
    hp: entity.hp,
    maxHp: entity.maxHp,
    hpPercent: Math.max(0, Math.min(100, Math.round((entity.hp / maxHp) * 100))),
    mp: entity.mp,
    maxMp: entity.maxMp,
    mpPercent: Math.max(0, Math.min(100, Math.round((entity.mp / maxMp) * 100))),
    level: entity.level || 1,
    atk: entity.atk || 0,
    def: entity.def || 0,
    position: { x: entity.x, y: entity.y, name: entity.name },
    mapName: (state as any).levelName || (entity as any).mapName || "",
    inventory: items,
    skills,
    buffs: (entity as any).buffs || [],
  };
}

/** 感知周围实体 */
function senseNearby(entity: Entity, state: GameState): AIPerception["nearby"] {
  const enemies: AIPerception["nearby"]["enemies"] = [];
  const allies: AIPerception["nearby"]["allies"] = [];
  const npcs: AIPerception["nearby"]["npcs"] = [];
  const loot: AIPerception["nearby"]["loot"] = [];

  for (const e of state.entities || []) {
    if (e.id === entity.id) continue;
    const dist = Math.hypot(e.x - entity.x, e.y - entity.y);
    if (dist > PERCEPTION_RADIUS) continue;

    if (e.side === "enemy" && e.alive !== false) {
      enemies.push({
        id: e.id,
        name: e.name,
        hp: e.hp,
        maxHp: e.maxHp,
        distance: Math.round(dist * 10) / 10,
        position: { x: e.x, y: e.y, name: e.name },
      });
    } else if (e.side === "ally" && e.alive !== false) {
      allies.push({
        id: e.id,
        name: e.name,
        hp: e.hp,
        distance: Math.round(dist * 10) / 10,
        position: { x: e.x, y: e.y, name: e.name },
      });
    } else if (e.side === "spectator" || e.side === "neutral") {
      npcs.push({
        id: e.id,
        name: e.name,
        distance: Math.round(dist * 10) / 10,
        position: { x: e.x, y: e.y, name: e.name },
      });
    }
  }

  // 按距离排序
  enemies.sort((a, b) => a.distance - b.distance);
  allies.sort((a, b) => a.distance - b.distance);
  npcs.sort((a, b) => a.distance - b.distance);

  return { enemies, allies, npcs, loot };
}

/** 感知资源点（来自 mapKnowledge —— 即 eventEngine 的 eventZones + area_enter 事件派生） */
function senseResources(entity: Entity): AIResourcePerception[] {
  const resources: AIResourcePerception[] = [];
  const { gatherZones } = readMapKnowledge();

  for (const zone of gatherZones) {
    const dist = Math.hypot(zone.x - entity.x, zone.y - entity.y);
    if (dist > RESOURCE_RADIUS) continue;

    resources.push({
      type: zone.kind,
      zoneName: zone.name,
      position: { x: zone.x, y: zone.y, name: zone.name },
      distance: Math.round(dist * 10) / 10,
      available: true,
    });
  }

  resources.sort((a, b) => a.distance - b.distance);
  return resources;
}

/** 感知世界信息 */
function senseWorld(state: GameState): AIPerception["world"] {
  // ★ 玩家战斗状态（宿主 entry.ts 权威维护）：
  //   敌人在 20m 外时 AI 感知不到，但玩家确实在挨打 —— 这个字段是 AI 唯一能知道"战况"的途径。
  const pc = (state as any).playerCombat;
  const level = (pc?.level === "engaged" || pc?.level === "skirmish") ? pc.level : "none";
  // 距离上次交战多少秒（宿主 tick 是 100ms 一拍）
  const lastTick = typeof pc?.lastCombatTick === "number" ? pc.lastCombatTick : null;
  const nowTick = typeof (state as any).tick === "number" ? (state as any).tick : 0;
  const secondsSinceCombat = lastTick == null || lastTick < 0
    ? 9999
    : Math.max(0, Math.round(((nowTick - lastTick) / 10) * 10) / 10);
  return {
    currentMap: (state as any).levelName || "",
    nearbyMaps: [],
    timeOfDay: (state as any).timeOfDay || "unknown",
    playerCombatLevel: level,
    secondsSinceCombat,
  };
}

/** 更新单个实体的完整感知数据 */
export function updatePerception(entity: Entity, state: GameState): AIPerception {
  return {
    self: senseSelf(entity, state),
    nearby: senseNearby(entity, state),
    resources: senseResources(entity),
    world: senseWorld(state),
  };
}

/** 紧急状态检查 */
export function checkEmergency(entity: Entity, perception: AIPerception): {
  flags: AIPerception extends never ? never : import("./types").EmergencyFlags;
  shouldOverride: boolean;
  action: import("./types").AIAction | null;
} {
  const flags = {
    lowHp: perception.self.hpPercent < 30,
    criticalHp: perception.self.hpPercent < 15,
    lowMp: perception.self.mpPercent < 20,
    // ★ 只数 AI 私藏（_aiBag）：perception.self.inventory 是合并视图（含玩家背包），
    //   拿它判断会让大脑误以为「自己背包满了」而停止采集。
    inventoryFull: (entity._aiBag?.length || 0) >= AI_BAG_MAX_SLOTS,
    targetDied: false,
    surrounded: perception.nearby.enemies.length >= 3,
    newEnemy: false,
  };

  // 危急血量：必须立即撤退或治疗
  if (flags.criticalHp) {
    return {
      flags,
      shouldOverride: true,
      action: {
        type: "flee",
        priority: 100,
        context: "血量危急，强制撤退到安全位置",
      },
    };
  }

  // 血量较低：优先使用药水
  if (flags.lowHp) {
    const potion = perception.self.inventory.find((i) => i.name.includes("药") || i.name.includes("血"));
    if (potion) {
      return {
        flags,
        shouldOverride: true,
        action: {
          type: "useItem",
          itemName: potion.name,
          priority: 90,
          context: "血量较低，使用治疗药水",
        },
      };
    }
  }

  // 蓝量耗尽
  if (flags.lowMp) {
    return {
      flags,
      shouldOverride: true,
      action: {
        type: "wait",
        duration: 5000,
        priority: 80,
        context: "蓝量不足，等待恢复",
      },
    };
  }

  // 被包围
  if (flags.surrounded) {
    return {
      flags,
      shouldOverride: true,
      action: {
        type: "flee",
        priority: 95,
        context: "被多个敌人包围，突围撤退",
      },
    };
  }

  return { flags, shouldOverride: false, action: null };
}