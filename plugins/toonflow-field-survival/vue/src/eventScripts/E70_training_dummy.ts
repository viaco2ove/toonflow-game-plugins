/**
 * E70_training_dummy — 练习假人交互
 * =====================================
 * 玩家走近练习假人（uid=251~254）→ 弹出「对打」菜单 → 选模式：
 *
 *   站桩模式（stand）：
 *     - 假人不移动不攻击；血条变红；阵营变敌对（side=enemy）
 *     - 显示伤害、血条变化；玩家自己慢慢恢复；假人扣血到零也会慢慢回复
 *     - 不奖励经验
 *
 *   模拟实战模式（duel）：
 *     - 假人会攻击玩家；血条不会恢复；扣血到零假人被摧毁
 *     - 第二次进图才重置；摧毁假人获得经验
 *
 *   假人4（uid=254）：等级永远比玩家高 5 级（实体生成时 App.vue 已按 playerCard.level+5 算）
 *
 * ★ 触发方式：proximity 事件（走近弹出「⚔对打」按钮）。假人是 side=neutral，
 *   所以 updateNearChat 会把它算进候选 → 点击触发本脚本。
 *
 * ★ 目标假人怎么确定（2026-10-28 改用 ctx.event.uid）：
 *   以前靠「写死 uids=[251,252,253,254] 再找最近的一个」猜 —— 四个假人挨得近时
 *   会选错对象。现在引擎把触发实体的 uid 透传给脚本（ctx.event.uid），
 *   直接用它定位，**新增第 5 个假人只改事件不改脚本**。
 *   ctx.event.uid 为空时（脚本被别处调用 / 非 proximity 触发）→ 退回旧的「找最近」兜底。
 *
 * ★ 模式切换机制：
 *   - 实体字段 dummyMode（stand/duel）由本脚本直接改（运行时状态，宿主 AI 会读它）
 *   - 站桩回血：setInterval 每秒回 5% hp（本会话内），脚本退出时清理
 *   - 模拟实战摧毁：entry.ts damage() 检测 trainingDummy + mode!==stand → 写 flag
 *     `dummy_destroyed_<实体id>`。实体 id 带世代时间戳（mapmob_<uid>_<ts>），
 *     下次进图 ts 换新 → 旧 flag 不再命中，假人自然满血复活
 */
import type { Ctx } from "./_ctx";

/** 站桩回血计时器（会话级，防止重复挂） */
const standTimers = new Map<string, ReturnType<typeof setInterval>>();

export default async function main(ctx: Ctx): Promise<void> {
  // ── 定位目标假人 ──
  // ★ 优先用引擎透传的 ctx.event.uid（proximity 触发时 = 被靠近的那个假人的 Tiled 对象 id）
  //   → 不用再「写死 uid 列表 + 找最近的一个」猜，多个假人挨得近也不会选错。
  const dummy = findTriggeredDummy(ctx) || findNearbyDummy(ctx);
  if (!dummy) {
    ctx.ui.toast("附近没有练习假人。", "white");
    return;
  }

  const mode = await ctx.ui.select({
    title: `${dummy.name}（Lv${dummy.level}）`,
    detail: "选择对打模式：",
    options: [
      { label: "站桩模式", value: "stand", desc: "假人不还手，血条自动回复，无经验" },
      { label: "模拟实战", value: "duel", desc: "假人会反击，血条不回复，击碎有经验" },
      { label: "算了", value: "", desc: "转身离去" },
    ],
  });
  if (!mode) {
    ctx.ui.toast("你活动了下手腕，转身离开。", "white");
    return;
  }

  if (mode === "stand") {
    await startStandMode(ctx, dummy);
  } else {
    await startDuelMode(ctx, dummy);
  }
}

/** 目标假人的统一结构 */
type DummyRef = { id: string; tiledId: string; name: string; level: number; ent: any };

/** ★ 引擎透传的目标假人（ctx.event.uid）—— 首选路径。
 *  proximity 事件触发时 uid = 被靠近的那个假人的 Tiled 对象 id，
 *  引擎直接把「玩家点的到底是哪个」告诉脚本，不必再猜。 */
function findTriggeredDummy(ctx: Ctx): DummyRef | null {
  const uid = ctx.event?.uid;
  if (!uid) return null;
  const ent: any = ctx.npc.byUid(String(uid));
  if (!ent || ent.alive === false) return null;
  return {
    id: String(ent.id),
    tiledId: String(uid),
    name: String(ent.name || "练习假人"),
    level: Math.round(ent.level || 1),
    ent,
  };
}

/** 兜底：找玩家 3m 内最近的练习假人。
 *  ★ 只在 ctx.event.uid 为空时用（脚本被非 proximity 路径调用 / 手动调用）。
 *    这里仍写死了四个 uid —— 但它只是兜底，主路径已不依赖它。 */
function findNearbyDummy(ctx: Ctx): DummyRef | null {
  // 实体 id 形如 mapmob_<tiledId>_<ts> / mapnpc_<tiledId>
  // 用 ctx.npc.byUid 逐个探测（引擎的 entityByTiledId 认这两种前缀）。
  const uids = ["251", "252", "253", "254"];
  const me = ctx.player as any;
  let best: DummyRef | null = null;
  let bestDist = 3.0;
  for (const uid of uids) {
    const ent: any = ctx.npc.byUid(uid);
    if (!ent || ent.alive === false) continue;
    const d = Math.hypot((ent.x ?? 0) - (me?.x ?? 0), (ent.y ?? 0) - (me?.y ?? 0));
    if (d < bestDist) {
      bestDist = d;
      best = { id: String(ent.id), tiledId: uid, name: String(ent.name || "练习假人"), level: Math.round(ent.level || 1), ent };
    }
  }
  return best;
}

/** ★ 改假人实体字段（side/hp 等）——走 ctx.npc.setField 拿到 state 里的可变引用 */
function patchDummy(ctx: Ctx, tiledId: string, patch: Record<string, unknown>): boolean {
  try {
    return ctx.npc.setField(tiledId, patch);
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────
   站桩模式
   ───────────────────────────────────────────────────────── */
async function startStandMode(ctx: Ctx, dummy: DummyRef): Promise<void> {
  // 1) 阵营变敌对 + 血条变红（side=enemy 才会被伤害飘字/血条渲染为敌对色）
  //    ★ 走 setField 改 state 里的可变引用（byUid 返回的快照改了没用）
  if (!patchDummy(ctx, dummy.tiledId, { side: "enemy", dummyMode: "stand" })) {
    ctx.ui.toast("（引擎不支持改实体状态——站桩模式需要 entityRef）", "red");
    return;
  }

  ctx.ui.toast(`${dummy.name} 摆好了架势——站桩开始！随便打。`, "blue");
  ctx.ui.event(`站桩训练开始：${dummy.name}`);

  // 2) 站桩回血：假人每秒回 5%（轮询可变引用直接改 hp）
  const key = dummy.id;
  if (standTimers.has(key)) clearInterval(standTimers.get(key)!);
  const timer = setInterval(() => {
    const ent: any = ctx.npc.byUid(dummy.tiledId);
    if (!ent) { clearInterval(timer); standTimers.delete(key); return; }
    // 假人被击碎（stand 模式不该发生）→ 原地复活
    if (ent.alive === false || (ent.hp ?? 0) <= 0) {
      patchDummy(ctx, dummy.tiledId, { hp: ent.maxHp ?? 100, alive: true });
      ctx.ui.toast(`${dummy.name} 重新立了起来。`, "blue");
      return;
    }
    // 假人回血 5%/s
    const hp = Number(ent.hp) || 0;
    const maxHp = Number(ent.maxHp) || hp || 100;
    if (hp < maxHp) {
      patchDummy(ctx, dummy.tiledId, { hp: Math.min(maxHp, hp + Math.max(1, Math.round(maxHp * 0.05))) });
    }
  }, 1000);
  standTimers.set(key, timer);

  // 3) 结束站桩：玩家离开假人 4m 外自动停止（轮询检查）
  const stopCheck = setInterval(() => {
    const ent: any = ctx.npc.byUid(dummy.tiledId);
    const me = ctx.player as any;
    if (!ent || !me) { cleanup(); return; }
    const d = Math.hypot((ent.x ?? 0) - me.x, (ent.y ?? 0) - me.y);
    if (d > 4) {
      cleanup();
      // 恢复中立满血
      patchDummy(ctx, dummy.tiledId, { side: "neutral", hp: ent.maxHp ?? 100 });
      ctx.ui.toast("站桩结束，假人恢复了平静。", "white");
      ctx.ui.event(`站桩训练结束：${dummy.name}`);
    }
  }, 1500);
  function cleanup() {
    clearInterval(stopCheck);
    const t = standTimers.get(key);
    if (t) { clearInterval(t); standTimers.delete(key); }
  }
}

/* ─────────────────────────────────────────────────────────
   模拟实战模式
   ───────────────────────────────────────────────────────── */
async function startDuelMode(ctx: Ctx, dummy: DummyRef): Promise<void> {
  // 已被摧毁过（本会话内）→ 提示并返回
  const destroyed = await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`);
  if (destroyed) {
    ctx.ui.toast(`${dummy.name} 已经散架了——换个假人练，或下次进图再来。`, "white");
    return;
  }

  // 1) 阵营变敌对（side=enemy）→ 假人会反击（引擎的 enemy AI 让它攻击玩家）
  if (!patchDummy(ctx, dummy.tiledId, { side: "enemy", dummyMode: "duel" })) {
    ctx.ui.toast("（引擎不支持改实体状态——实战模式需要 entityRef）", "red");
    return;
  }

  ctx.ui.toast(`${dummy.name} 眼中红光一闪——模拟实战开始！它会反击。`, "red");
  ctx.ui.event(`模拟实战开始：${dummy.name}（Lv${dummy.level}）`);

  // 2) 击碎奖励：entry.ts damage() 检测到 trainingDummy + duel → 写 flag
  //    `dummy_destroyed_<实体id>`；这里轮询 flag，发现后发经验奖励
  const rewardTimer = setInterval(async () => {
    const destroyed2 = await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`);
    if (destroyed2) {
      clearInterval(rewardTimer);
      const flee = fleeTimers.get(dummy.id);
      if (flee) { clearInterval(flee); fleeTimers.delete(dummy.id); }
      const expGain = 10 + dummy.level * 6;
      await ctx.cmd("sys_dummy_reward", { exp: expGain, name: dummy.name });
      ctx.ui.subtitle(`${dummy.name} 击碎！+${expGain} 经验`, 2000);
      ctx.ui.event(`模拟实战胜利：${dummy.name}（+${expGain} 经验）`);
    }
  }, 1200);

  // 3) 玩家逃跑（离开 6m）→ 实战结束，假人复位
  const fleeCheck = setInterval(() => {
    const ent: any = ctx.npc.byUid(dummy.tiledId);
    const me = ctx.player as any;
    if (!ent || !me) { cleanupFlee(); return; }
    const d = Math.hypot((ent.x ?? 0) - me.x, (ent.y ?? 0) - me.y);
    if (d > 6) {
      cleanupFlee();
      void (async () => {
        const stillAlive = (await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`)) == null;
        if (stillAlive && ent.alive !== false) {
          // 没被打碎就跑了 → 复位为中立满血（下次可再来）
          patchDummy(ctx, dummy.tiledId, { side: "neutral", hp: ent.maxHp ?? 100 });
          ctx.ui.toast("你退出了实战，假人恢复了平静。", "white");
        }
      })();
    }
  }, 1500);
  const fleeTimers = (globalThis as any).__dummyFleeTimers ||= new Map<string, ReturnType<typeof setInterval>>();
  function cleanupFlee() {
    clearInterval(fleeCheck);
    fleeTimers.delete(dummy.id);
  }
  fleeTimers.set(dummy.id, fleeCheck);
}