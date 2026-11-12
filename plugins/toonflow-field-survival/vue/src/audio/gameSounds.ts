/**
 * gameSounds.ts —— 游戏事件 → 音效的映射（通用层）
 * ==================================================
 * 职责：把「游戏里发生了什么」翻译成「该播哪条音效」。
 *   - 命中 / 暴击 / 受伤 / 死亡：通过**前后两帧的 hp 差分**检测（不依赖宿主事件字段）
 *   - 脚步：通过玩家位移阈值触发（不是每帧触发）
 *   - 拾取 / 面板 / 任务：由 App.vue 在明确的交互点直接调用 sfx.xxx()
 *
 * ★ 边界：本模块只放**跨地图通用**的功能音；
 *   任何带剧情语义的专属音效由地图集通过 ctx.audio.register() 注入。
 */
import { play } from "./audioEngine";
import type { Entity } from "../types";

/* ============================================================
   脚步（位移阈值触发）
   ============================================================ */
const STEP_DIST_M = 1.6;   // 每移动 1.6 米触发一次
/** 判定「在移动」的最小单帧位移（米）—— 小于这个值视为静止 */
const MOVING_EPS_M = 0.01;
let stepAccum = 0;
let lastStepX = 0;
let lastStepY = 0;
let stepPrimed = false;

/**
 * 喂入玩家位置，位移够阈值就播一步脚步。
 *
 * ★★ 关键修复（2026-11-12）：
 *   旧实现靠 `moving` 入参（由 App.vue 从 `me.vx/me.vy` 推出）判断是否在移动。
 *   但**实体的 vx/vy 从来不被赋值为实际速度** —— localTick 里只有
 *   `me.vx = 0; me.vy = 0;`（位置是直接改 x/y 的，速度字段全程是 0）。
 *   → moving 永远 false → 脚步声一次都不会响。
 *   现在改成**纯位置差分**：只要这次采样相对上次动了就算在移动。
 *
 * 返回是否真的播了（便于调试）。
 */
export function updateFootstep(x: number, y: number, _moving?: boolean): boolean {
  if (!stepPrimed) {
    // 首次喂位置：只建立基准
    stepPrimed = true;
    lastStepX = x;
    lastStepY = y;
    stepAccum = 0;
    return false;
  }
  const dx = x - lastStepX;
  const dy = y - lastStepY;
  const dist = Math.hypot(dx, dy);

  // 本帧几乎没动 → 视为静止（但保留基准，方便下一帧继续累加）
  if (dist < MOVING_EPS_M) return false;

  stepAccum += dist;
  lastStepX = x;
  lastStepY = y;
  if (stepAccum < STEP_DIST_M) return false;

  // ★ 保留超出的余数（不直接清零）：
  //   若清零，每步都会丢掉超出部分 → 实际步距变成 1.8m 而非 1.6m，节奏不均。
  stepAccum -= STEP_DIST_M;
  play("footstep");
  return true;
}

/** 重置脚步状态（切图 / 重生） */
export function resetFootstep(): void {
  stepAccum = 0;
  stepPrimed = false;
}

/* ============================================================
   伤害差分检测
   ============================================================ */
/** 上一次快照：实体 id → hp */
let hpSnapshot = new Map<string, number>();

/** 上一帧是否已判定玩家死亡（避免重复播死亡音） */
let playerDeathPlayed = false;

/**
 * 比对上一帧与当前帧的 hp，播放命中/受伤/死亡音。
 * @param entities 当前帧实体表
 * @param onDeath  实体死亡回调（用于播 enemy_die / player_die）
 */
export function detectDamage(entities: Entity[]): void {
  const next = new Map<string, number>();
  let playerDead = false;

  for (const e of entities) {
    const id = String(e.id);
    const hp = Number(e.hp);
    next.set(id, hp);

    const prev = hpSnapshot.get(id);
    if (prev === undefined) continue;
    const delta = prev - hp;
    if (delta <= 0) continue;

    // 玩家挨打 → 受伤音
    if (e.side === "player") {
      play("player_hurt");
      if (hp <= 0) playerDead = true;
    } else {
      // 敌人/假人挨打 → 命中音
      play("hit");
      if (hp <= 0) play("enemy_die");
    }
  }

  // 玩家死亡：整表里都没有活着的玩家 → 播一次
  const hasAlivePlayer = entities.some((e) => e.side === "player" && e.alive !== false && Number(e.hp) > 0);
  if (!hasAlivePlayer && !playerDeathPlayed && entities.some((e) => e.side === "player")) {
    play("player_die");
    playerDeathPlayed = true;
  }
  if (hasAlivePlayer) playerDeathPlayed = false;

  hpSnapshot = next;
}

/** 重置伤害快照（切图 / 重新开局） */
export function resetDamageDetect(): void {
  hpSnapshot = new Map();
  playerDeathPlayed = false;
}

/* ============================================================
   便捷别名（App.vue 里直接用）
   ============================================================ */
export const sfx = {
  click: () => play("ui_click"),
  open: () => play("ui_open"),
  close: () => play("ui_close"),
  tab: () => play("ui_tab"),
  error: () => play("ui_error"),
  notify: () => play("ui_notify"),
  pickup: () => play("pickup"),
  itemUse: () => play("item_use"),
  skill: () => play("skill_cast"),
  skillCooldown: () => play("skill_cooldown"),
  questAccept: () => play("quest_accept"),
  questDone: () => play("quest_done"),
  levelUp: () => play("level_up"),
  message: () => play("message"),
  teleport: () => play("teleport"),
};
