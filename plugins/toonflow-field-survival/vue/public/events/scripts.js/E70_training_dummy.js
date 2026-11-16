const standTimers = /* @__PURE__ */ new Map();
async function main(ctx) {
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
      { label: "算了", value: "", desc: "转身离去" }
    ]
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
function findTriggeredDummy(ctx) {
  const uid = ctx.event?.uid;
  if (!uid) return null;
  const ent = ctx.npc.byUid(String(uid));
  if (!ent || ent.alive === false) return null;
  return {
    id: String(ent.id),
    tiledId: String(uid),
    name: String(ent.name || "练习假人"),
    level: Math.round(ent.level || 1),
    ent
  };
}
function findNearbyDummy(ctx) {
  const uids = ["251", "252", "253", "254"];
  const me = ctx.player;
  let best = null;
  let bestDist = 3;
  for (const uid of uids) {
    const ent = ctx.npc.byUid(uid);
    if (!ent || ent.alive === false) continue;
    const d = Math.hypot((ent.x ?? 0) - (me?.x ?? 0), (ent.y ?? 0) - (me?.y ?? 0));
    if (d < bestDist) {
      bestDist = d;
      best = { id: String(ent.id), tiledId: uid, name: String(ent.name || "练习假人"), level: Math.round(ent.level || 1), ent };
    }
  }
  return best;
}
function patchDummy(ctx, tiledId, patch) {
  try {
    return ctx.npc.setField(tiledId, patch);
  } catch {
    return false;
  }
}
async function startStandMode(ctx, dummy) {
  if (!patchDummy(ctx, dummy.tiledId, { side: "enemy", dummyMode: "stand" })) {
    ctx.ui.toast("（引擎不支持改实体状态——站桩模式需要 entityRef）", "red");
    return;
  }
  ctx.ui.toast(`${dummy.name} 摆好了架势——站桩开始！随便打。`, "blue");
  ctx.ui.event(`站桩训练开始：${dummy.name}`);
  const key = dummy.id;
  if (standTimers.has(key)) clearInterval(standTimers.get(key));
  const timer = setInterval(() => {
    const ent = ctx.npc.byUid(dummy.tiledId);
    if (!ent) {
      clearInterval(timer);
      standTimers.delete(key);
      return;
    }
    if (ent.alive === false || (ent.hp ?? 0) <= 0) {
      patchDummy(ctx, dummy.tiledId, { hp: ent.maxHp ?? 100, alive: true });
      ctx.ui.toast(`${dummy.name} 重新立了起来。`, "blue");
      return;
    }
    const hp = Number(ent.hp) || 0;
    const maxHp = Number(ent.maxHp) || hp || 100;
    if (hp < maxHp) {
      patchDummy(ctx, dummy.tiledId, { hp: Math.min(maxHp, hp + Math.max(1, Math.round(maxHp * 0.05))) });
    }
  }, 1e3);
  standTimers.set(key, timer);
  const stopCheck = setInterval(() => {
    const ent = ctx.npc.byUid(dummy.tiledId);
    const me = ctx.player;
    if (!ent || !me) {
      cleanup();
      return;
    }
    const d = Math.hypot((ent.x ?? 0) - me.x, (ent.y ?? 0) - me.y);
    if (d > 4) {
      cleanup();
      patchDummy(ctx, dummy.tiledId, { side: "neutral", hp: ent.maxHp ?? 100 });
      ctx.ui.toast("站桩结束，假人恢复了平静。", "white");
      ctx.ui.event(`站桩训练结束：${dummy.name}`);
    }
  }, 1500);
  function cleanup() {
    clearInterval(stopCheck);
    const t = standTimers.get(key);
    if (t) {
      clearInterval(t);
      standTimers.delete(key);
    }
  }
}
async function startDuelMode(ctx, dummy) {
  const destroyed = await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`);
  if (destroyed) {
    ctx.ui.toast(`${dummy.name} 已经散架了——换个假人练，或下次进图再来。`, "white");
    return;
  }
  if (!patchDummy(ctx, dummy.tiledId, { side: "enemy", dummyMode: "duel" })) {
    ctx.ui.toast("（引擎不支持改实体状态——实战模式需要 entityRef）", "red");
    return;
  }
  ctx.ui.toast(`${dummy.name} 眼中红光一闪——模拟实战开始！它会反击。`, "red");
  ctx.ui.event(`模拟实战开始：${dummy.name}（Lv${dummy.level}）`);
  const rewardTimer = setInterval(async () => {
    const destroyed2 = await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`);
    if (destroyed2) {
      clearInterval(rewardTimer);
      const flee = fleeTimers.get(dummy.id);
      if (flee) {
        clearInterval(flee);
        fleeTimers.delete(dummy.id);
      }
      const expGain = 10 + dummy.level * 6;
      await ctx.cmd("sys_dummy_reward", { exp: expGain, name: dummy.name });
      ctx.ui.subtitle(`${dummy.name} 击碎！+${expGain} 经验`, 2e3);
      ctx.ui.event(`模拟实战胜利：${dummy.name}（+${expGain} 经验）`);
    }
  }, 1200);
  const fleeCheck = setInterval(() => {
    const ent = ctx.npc.byUid(dummy.tiledId);
    const me = ctx.player;
    if (!ent || !me) {
      cleanupFlee();
      return;
    }
    const d = Math.hypot((ent.x ?? 0) - me.x, (ent.y ?? 0) - me.y);
    if (d > 6) {
      cleanupFlee();
      void (async () => {
        const stillAlive = await ctx.save.getFlag(`dummy_destroyed_${dummy.id}`) == null;
        if (stillAlive && ent.alive !== false) {
          patchDummy(ctx, dummy.tiledId, { side: "neutral", hp: ent.maxHp ?? 100 });
          ctx.ui.toast("你退出了实战，假人恢复了平静。", "white");
        }
      })();
    }
  }, 1500);
  const fleeTimers = globalThis.__dummyFleeTimers || (globalThis.__dummyFleeTimers = /* @__PURE__ */ new Map());
  function cleanupFlee() {
    clearInterval(fleeCheck);
    fleeTimers.delete(dummy.id);
  }
  fleeTimers.set(dummy.id, fleeCheck);
}
export {
  main as default
};
