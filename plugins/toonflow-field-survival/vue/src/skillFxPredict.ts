/**
 * skillFxPredict.ts —— 技能乐观释放的本地预测（2026-11-15，技能特效设计V2_2.md）
 * ============================================================
 * 「点击前就备好释放数据，点击立刻释放，释放完再判断和数据处理」：
 *  - 施法表现所需数据（技能表 / 玩家位姿 lastLocalPose / 附近敌人）在点击前已全部就绪；
 *  - 本模块在点击瞬间纯本地生成与服务端 entry skill case（6819-6879）**逐字段一致**的
 *    施法表现条目（vfx / 飘字 / 范围指示 / CD），由 App.vue 渲染旁路立即显示；
 *  - 服务端结算结果照常 push 回来接管（伤害数字 / 震屏 / 击退 / 命中不预测——数值必须真实）。
 *
 * 所有表与判定逻辑从 entry.ts 复刻（源：EFFECT_COLOR 3017 / EFFECT_ICON 3038 /
 * skillFxKind 1500），entry 改表时须同步这里。
 */

export interface PredictSkillLike {
  name: string;
  cd: number;
  type?: string;          // "atk" | "heal" | "buff"
  range?: string;         // "melee" | "ranged"
  effects_type?: string;
  attack_shape?: string;
}

export interface PredictTarget {
  id: string;
  x: number;
  y: number;
}

export interface PredictPlayer {
  id: string;
  x: number;
  y: number;
  facing: number;
}

/** 与服务端条目同构（drawVfxLayer 直接消费），_pred 标记本地来源 */
export interface PredVfx {
  id: string;
  kind: string;
  entityId: string;
  x: number;
  y: number;
  life: number;
  total: number;
  color: string;
  icon: string;
  size: number;
  facing?: number;
  targetEntityId?: string;
  targetX?: number;
  targetY?: number;
  _pred?: true;
}

export interface PredFloater {
  id: string;
  text: string;
  x: number;
  y: number;
  life: number;
  _pred?: true;
}

export interface PredRangeIndicator {
  id: string;
  shape: string;
  x: number;
  y: number;
  radius: number;
  facing: number;
  halfAngleDeg: number;
  life: number;
  total: number;
  _pred?: true;
}

export interface PredictedCast {
  vfx: PredVfx;
  floater: PredFloater;
  rangeIndicator: PredRangeIndicator;
  cdTicks: number;
  /** 施法朝向（八方向 snap 后的值，与服务端 resolveCastFacing 的输入一致） */
  facing: number;
}

/* —— entry.ts 复刻表（勿改值；entry 改表时同步） —— */
const EFFECT_COLOR: Record<string, string> = {
  normal: "#eeeeee", fire: "#ff4422", water: "#33bbff", thunder: "#f8ff33",
  wind: "#a8ffdd", earth: "#b88646", metal: "#ffdd66", wood: "#46cc55",
  light: "#fffcd0", dark: "#662288", poison: "#88dd22", bleed: "#bb1122",
};
const EFFECT_ICON: Record<string, string> = {
  normal: "images/spells/enchantment/sure_blade.png",
  fire: "images/spells/fire/fireball.png",
  water: "images/spells/ice/freeze.png",
  thunder: "images/spells/air/lightning_bolt.png",
  wind: "images/spells/air/tornado.png",
  earth: "images/spells/earth/iron_shot.png",
  metal: "images/spells/earth/iron_shot.png",
  wood: "images/spells/poison/poison_arrow.png",
  light: "images/spells/restoration/minor_heal.png",
  dark: "images/spells/necromancy/agony.png",
  poison: "images/spells/poison/alistairs_intoxication.png",
  bleed: "images/spells/necromancy/bolt_of_draining.png",
};

function effectColor(effectsType: unknown, fallback: string): string {
  return EFFECT_COLOR[String(effectsType || "")] || fallback;
}
function effectIcon(effectsType: unknown): string {
  return EFFECT_ICON[String(effectsType || "")] || "";
}
/** 复刻 entry skillFxKind（1500-1511）：type 优先，名字正则兜底 */
export function skillFxKind(skill: PredictSkillLike): "melee" | "ranged" | "heal" | "buff" {
  const t = String(skill?.type || "");
  if (t === "heal") return "heal";
  if (t === "buff") return "buff";
  if (t === "atk") return String(skill?.range || "melee") === "ranged" ? "ranged" : "melee";
  const n = String(skill?.name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return "heal";
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return "buff";
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return "ranged";
  return "melee";
}
/** 复刻 attackShapeOf：attack_shape 显式优先，缺省 circle（entry 936-941 附近口径） */
export function attackShapeOf(skill: PredictSkillLike): "cone" | "circle" {
  return String((skill as any)?.attack_shape || "circle") === "cone" ? "cone" : "circle";
}
/** 复刻 attackRangeOf：ranged=4m 其余=2m */
export function attackRangeOf(skill: PredictSkillLike): number {
  return String(skill?.range || "melee") === "ranged" ? 4 : 2;
}
/** 八方向 snap（与前端 facing 上报口径一致） */
export function snapFacing(deg: number): number {
  const snapped = Math.round(((deg % 360) + 360) % 360 / 45) * 45 % 360;
  return snapped;
}

let predSeq = 0;
function predId(prefix: string): string {
  return `pred_${prefix}_${Date.now().toString(36)}_${(predSeq++).toString(36)}`;
}

/**
 * 生成一次施法的乐观表现条目（纯函数、<0.1ms）。
 * @param skill        state.skills 槽位对象（cd/cdLeft/type/range/effects_type/attack_shape）
 * @param player       玩家实体（id/x/y/facing，lastLocalPose 权威位姿）
 * @param nearestEnemy 本地 30m 最近敌人（pickSkillTargets()[0] 的完整对象；可 null=空放）
 */
export function predictSkillFx(
  skill: PredictSkillLike,
  player: PredictPlayer,
  nearestEnemy: PredictTarget | null,
): PredictedCast | null {
  if (!skill || !skill.name || !(skill.cd > 0)) return null;
  const facing = snapFacing(player.facing || 0);
  const fx = skillFxKind(skill);
  const color = effectColor(skill.effects_type, "#fff");
  const icon = effectIcon(skill.effects_type);
  const vfx: PredVfx = {
    id: predId("vfx"), kind: "slash_arc", entityId: player.id,
    x: player.x, y: player.y, life: 12, total: 12, color, icon, size: 1.6,
    facing, _pred: true,
  };
  if (fx === "heal") {
    vfx.kind = "heal_ring"; vfx.life = vfx.total = 18; vfx.color = effectColor(skill.effects_type, "#7CFFB2"); vfx.size = 1.0;
  } else if (fx === "buff") {
    vfx.kind = "buff_ring"; vfx.life = vfx.total = 30; vfx.color = effectColor(skill.effects_type, "#9CCFFF"); vfx.size = 1.0;
  } else if (fx === "ranged") {
    vfx.kind = "fireball"; vfx.life = vfx.total = 16; vfx.color = effectColor(skill.effects_type, "#ff6a00"); vfx.size = 1.0;
    vfx.targetEntityId = nearestEnemy?.id;
    vfx.targetX = nearestEnemy?.x ?? player.x;
    vfx.targetY = nearestEnemy?.y ?? player.y;
  } // melee 保持 slash_arc 默认
  return {
    vfx,
    floater: { id: predId("flt"), text: skill.name, x: player.x, y: player.y - 1.7, life: 24, _pred: true },
    rangeIndicator: {
      id: predId("ri"), shape: attackShapeOf(skill), x: player.x, y: player.y,
      radius: attackRangeOf(skill), facing, halfAngleDeg: 30, life: 2, total: 2, _pred: true,
    },
    cdTicks: Math.round(skill.cd),
    facing,
  };
}
