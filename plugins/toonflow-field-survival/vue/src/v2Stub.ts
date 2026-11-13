/**
 * ★ V2（2026-11-13）桩侧共享逻辑：头顶徽章 + 攻击范围指示区 + 攻击形状判定
 * ------------------------------------------------------------------
 * 为什么要单独一个模块：
 *   真机走 entry.ts（权威），dev-host 走 vite.config.ts 的内联桩，
 *   standalone 走 mockHost.ts —— **三份代码**。
 *   V1 的教训已经吃过一次：「桩与 entry 不同步 → 实现完成但 dev-host 感觉不到」
 *   （见 md/curr_design/toonflow-field-survival/技能特效设计/V1/游戏特效.md P1 踩坑记录 2）。
 *   本模块把「V2 的公共部分」抽出来给两个桩共用，规则与 entry.ts **逐条对齐**。
 *
 * ★ 对齐清单（与 entry.ts 保持一致）：
 *   - 颜色：玩家受击 #ff8fc8（粉红）/ 敌怪受击 #ff4d4d（红）/ buff #5fe57a（绿）
 *   - 兜底文字：受击「伤」/ buff「buff」
 *   - 攻击形状：circle=圆形（默认）/ cone=朝向扇形（±30°）
 *   - 射程：4 米；指示区存活 1.2 秒（12 tick）
 */

/** ★ V2 颜色常量（与 entry.ts 一致） */
export const V2_HURT_PLAYER_COLOR = "#ff8fc8";
export const V2_HURT_ENEMY_COLOR = "#ff4d4d";
export const V2_BUFF_COLOR = "#5fe57a";
export const V2_HURT_LABEL = "伤";
export const V2_BUFF_LABEL = "buff";
/** 攻击射程（米）—— ★ V2_2 射程分离（2026-11-14，与 entry.ts 同口径）：
 *  近战 2m / 远程 4m（远程维持原值，避免超出野怪 4m 脱战圈放风筝破坏平衡） */
export const V2_MELEE_RANGE_M = 2;
export const V2_RANGED_RANGE_M = 4;
/** 兼容旧引用（= 远程射程） */
export const V2_SKILL_RANGE_M = V2_RANGED_RANGE_M;
/** 扇形半角（度）—— 与 entry.ts 的 CONE_HALF_ANGLE_DEG 一致 */
export const V2_CONE_HALF_ANGLE_DEG = 30;
/** 指示区存活时长（tick）—— 与 entry.ts 的 RANGE_INDICATOR_TICKS 一致 */
export const V2_RANGE_INDICATOR_TICKS = 12;
/** hurt 徽章存活时长（tick）—— 与 entry.ts 的 HURT_BADGE_TICKS 一致 */
export const V2_HURT_BADGE_TICKS = 15;

/** ★ V2_2 射程分离：按技能/物品 range 字段取射程（与 entry.ts attackRangeOf 同逻辑） */
export function v2AttackRangeOf(src: any): number {
  return String(src?.range || "") === "ranged" ? V2_RANGED_RANGE_M : V2_MELEE_RANGE_M;
}

/** 桩侧的实体（宽松类型，兼容 mockHost / vite.config 的实体结构） */
export interface V2Entity {
  id: string;
  name?: string;
  side?: string;
  x: number;
  y: number;
  facing?: number;
  alive?: boolean;
  headBadges?: any[];
  buffs?: string[];
  buffUntilTick?: number;
  buffName?: string;
  aiState?: string;
}

/** 桩侧的状态（宽松类型） */
export interface V2State {
  tick: number;
  entities: V2Entity[];
  floaters: any[];
  vfx?: any[];
  rangeIndicators?: any[];
}

/** 角度差（度），归一到 [-180, 180] —— 与 entry.ts angleDiffDeg 一致 */
export function v2AngleDiffDeg(a: number, b: number): number {
  return (((a - b) % 360) + 540) % 360 - 180;
}

/**
 * 攻击形状命中判定 —— 与 entry.ts inAttackRange **完全同源同逻辑**。
 * circle → 半径内全命中；cone → 半径内且在朝向 ±halfAngleDeg 内命中。
 */
export function v2InAttackRange(
  shape: string, fx: number, fy: number, facing: number,
  halfAngleDeg: number, tx: number, ty: number, radius: number,
): boolean {
  const dx = tx - fx, dy = ty - fy;
  const d = Math.hypot(dx, dy);
  if (d > radius) return false;
  if (shape !== "cone") return true;
  if (d < 0.0001) return true;
  const targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.abs(v2AngleDiffDeg(targetAngle, facing)) <= halfAngleDeg;
}

/** 读攻击形状（缺省 circle = V1 行为） */
export function v2AttackShape(src: any): "circle" | "cone" {
  return String(src?.attack_shape || "") === "cone" ? "cone" : "circle";
}

/** 写/替换头顶徽章（同 kind 只留一枚 → 「最新图样」天然成立） */
export function v2SetHeadBadge(st: V2State, ent: V2Entity | undefined, badge: any): void {
  if (!ent) return;
  const list = Array.isArray(ent.headBadges) ? ent.headBadges.slice() : [];
  const idx = list.findIndex((b: any) => b.kind === badge.kind);
  if (idx >= 0) list[idx] = badge;
  else list.push(badge);
  ent.headBadges = list.slice(-2);
}

/** 清除指定 kind 的头顶徽章 */
export function v2ClearHeadBadge(ent: V2Entity | undefined, kind: "hurt" | "buff"): void {
  if (!ent || !Array.isArray(ent.headBadges)) return;
  ent.headBadges = ent.headBadges.filter((b: any) => b.kind !== kind);
}

/**
 * 受击：带色飘字 + 头顶 hurt 徽章（与 entry.ts damage() 内联逻辑一致）。
 * @param src 致伤来源（可选）：{ icon, label }；不传 → 兜底「伤」
 */
export function v2ApplyHurt(
  st: V2State, target: V2Entity | undefined, amount: number,
  src?: { icon?: string; label?: string },
): void {
  if (!target) return;
  const isEnemy = target.side === "enemy";
  const color = isEnemy ? V2_HURT_ENEMY_COLOR : V2_HURT_PLAYER_COLOR;
  st.floaters.push({
    id: "f" + st.tick + "_h" + Math.random().toString(36).slice(2, 6),
    text: "-" + Math.round(amount),
    x: target.x, y: target.y - 10,
    life: 20, kind: "damage", color,
  });
  v2SetHeadBadge(st, target, {
    kind: "hurt",
    color,
    icon: src?.icon || undefined,
    label: src?.label || V2_HURT_LABEL,
    bornTick: st.tick,
    expireTick: st.tick + V2_HURT_BADGE_TICKS,
  });
}

/**
 * 施加 buff：写 buffs 列表 + 头顶绿色徽章 + 到期 tick（与 entry.ts applyBuff 一致）。
 */
export function v2ApplyBuff(
  st: V2State, ent: V2Entity | undefined,
  opts: { name: string; icon?: string; durationTicks?: number },
): void {
  if (!ent || !opts?.name) return;
  const dur = Math.max(1, Math.round(opts.durationTicks ?? 300));
  const list = Array.isArray(ent.buffs) ? ent.buffs.slice() : [];
  if (!list.includes(opts.name)) list.push(opts.name);
  ent.buffs = list;
  ent.buffName = opts.name;
  ent.buffUntilTick = st.tick + dur;
  v2SetHeadBadge(st, ent, {
    kind: "buff",
    color: V2_BUFF_COLOR,
    icon: opts.icon || undefined,
    label: V2_BUFF_LABEL,
    bornTick: st.tick,
    expireTick: st.tick + dur,
  });
}

/** 生成攻击范围指示区（与 entry.ts pushRangeIndicator 一致） */
export function v2PushRangeIndicator(
  st: V2State,
  opts: { shape: "circle" | "cone"; x: number; y: number; radius: number;
          facing: number; halfAngleDeg: number; lifeTicks?: number },
): void {
  if (!Array.isArray(st.rangeIndicators)) st.rangeIndicators = [];
  const life = Math.max(1, Math.round(opts.lifeTicks ?? V2_RANGE_INDICATOR_TICKS));
  st.rangeIndicators.push({
    id: "ri_" + st.tick + "_" + Math.random().toString(36).slice(2, 6),
    shape: opts.shape, x: opts.x, y: opts.y, radius: opts.radius,
    facing: opts.facing, halfAngleDeg: opts.halfAngleDeg,
    life, total: life,
  });
  if (st.rangeIndicators.length > 8) st.rangeIndicators = st.rangeIndicators.slice(-8);
}

/**
 * 每 tick 清理：过期徽章 + buff 到期 + 指示区衰减（与 entry.ts step() 一致）。
 * @param dec 本 tick 应推进的 tick 数（真实时间折算）
 */
export function v2TickCleanup(st: V2State, dec: number): void {
  // 指示区衰减
  if (Array.isArray(st.rangeIndicators) && st.rangeIndicators.length) {
    st.rangeIndicators = st.rangeIndicators.filter((r: any) => { r.life -= dec; return r.life > 0; });
  }
  // 实体：buff 到期 + 徽章过期
  for (const e of st.entities) {
    if (e.buffUntilTick != null && st.tick >= e.buffUntilTick) {
      e.buffUntilTick = undefined;
      const bn = e.buffName || "";
      if (bn && Array.isArray(e.buffs)) e.buffs = e.buffs.filter((n: string) => n !== bn);
      e.buffName = undefined;
      v2ClearHeadBadge(e, "buff");
    }
    if (Array.isArray(e.headBadges) && e.headBadges.length) {
      const keep = e.headBadges.filter((b: any) => b.expireTick == null || b.expireTick > st.tick);
      if (keep.length !== e.headBadges.length) e.headBadges = keep;
    }
  }
}
