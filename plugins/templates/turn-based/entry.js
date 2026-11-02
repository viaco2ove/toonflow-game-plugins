/**
 * P2 回合/指令型插件模板 —— 后端权威逻辑（entry.js）
 *
 * 协议（网络通信机制 v2 §4）：
 *   - **零 tick 轮询**：状态只在玩家出招时变化，通信量 = 玩家操作次数。
 *   - manifest 声明 `interaction: "turn-based"` → 宿主把它拼进 iframe URL（?interaction=turn-based）
 *     → 插件前端读到后不启动 tick 循环（bridge.isTurnBased()）。
 *   - 通信形态：iframe ─postMessage─► 宿主 ─POST /plugin/tick─► 后端 handle_action 结算一次
 *     ──► 返回完整 state（this 回 iframe 渲染）。后端无需感知"回合制"——/plugin/tick
 *     本就支持任意 action。
 *
 * 三个 action 演示完整闭环：
 *   start   → 初始化一局（双方 100 HP）
 *   attack  → 玩家攻击：60% 命中，伤害 12-22；敌方自动反击
 *   reset   → 重开
 */
function str(v, d) { const s = String(v == null ? "" : v).trim(); return s || d; }function clamp(n, lo, hi) { n = Number(n); if (!Number.isFinite(n)) return lo; return Math.min(hi, Math.max(lo, n)); }
function emptyState(ctx) {
  return {
    version: 1,
    phase: "select",            // select | playing | over
    worldName: str(ctx && ctx.worldName, ""),
    worldId: ctx && ctx.worldId != null ? ctx.worldId : "",
    roles: Array.isArray(ctx && ctx.roles) ? ctx.roles : [],
    player: null,               // { name, hp, maxHp }
    enemy: null,
    log: [],                    // 战斗日志（前端展示最近 8 条）
    turn: 0,
    result: "",
  };
}

// ★ P2 模板：ESM 导出（PluginExecutor.loadEntryModule 走 import()，必须 export）
export async function handle_action(action, params, state, ctx) {
  const s = state && state.version === 1 ? state : emptyState(ctx);
  if (!Array.isArray(s.log)) s.log = [];
  /** 统一出口：始终回当前 state（★ 注意用参数化，避免 start 分支的新 state 被旧 s 顶掉） */
  const reply = (msg, st) => ({ code: 0, message: "ok", state: st || s, response: msg });
  const log = (m, st) => { const t = st || s; t.log.push(m); if (t.log.length > 8) t.log = t.log.slice(-8); };

  switch (action) {
    case "start":
    case "init": {
      const fresh = emptyState(ctx);
      const roles = Array.isArray(ctx && ctx.roles) ? ctx.roles : [];
      const playerRole = roles.find((r) => String(r && r.roleType) === "player") || roles[0] || { name: "你" };
      const enemyRole = roles.find((r) => r && r !== playerRole && String(r && r.roleType) !== "player") || { name: "对手" };
      fresh.phase = "playing";
      fresh.player = { name: str(playerRole && playerRole.name, "你"), hp: 100, maxHp: 100 };
      fresh.enemy = { name: str(enemyRole && enemyRole.name, "对手"), hp: 100, maxHp: 100 };
      fresh.turn = 1;
      log(`对决开始：${fresh.player.name} vs ${fresh.enemy.name}`, fresh);
      return reply("选择「攻击」出招。", fresh);
    }

    case "attack": {
      if (s.phase !== "playing") return { code: 409, message: "没有进行中的对局", state: s };
      const hit = Math.random() < 0.6;
      if (hit) {
        const dmg = Math.round(12 + Math.random() * 10);
        s.enemy.hp = clamp(s.enemy.hp - dmg, 0, s.enemy.maxHp);
        log(`第 ${s.turn} 回合：你命中 ${s.enemy.name}，造成 ${dmg} 伤害。`);
      } else {
        log(`第 ${s.turn} 回合：你的攻击被 ${s.enemy.name} 闪开了。`);
      }
      if (s.enemy.hp <= 0) {
        s.phase = "over"; s.result = "win";
        log(`${s.enemy.name} 倒下了——你赢了！`);
        return reply("胜利！点「再来一局」重开。");
      }
      // 敌方反击
      const counter = Math.random() < 0.5;
      if (counter) {
        const cdmg = Math.round(8 + Math.random() * 8);
        s.player.hp = clamp(s.player.hp - cdmg, 0, s.player.maxHp);
        log(`${s.enemy.name} 反击，你受到 ${cdmg} 伤害。`);
      } else {
        log(`${s.enemy.name} 的反击落空。`);
      }
      if (s.player.hp <= 0) {
        s.phase = "over"; s.result = "lose";
        log(`你倒下了……再接再厉。`);
        return reply("失败。点「再来一局」重开。");
      }
      s.turn += 1;
      return reply("");
    }

    case "reset": {
      const fresh = emptyState(ctx);
      return reply("已重置，点「开始」开局。");
    }

    default:
      return { code: 400, message: `未知 action: ${action}`, state: s };
  }
}

// 兼容：Node 直接 `node entry.js` 自测时无 ESM loader，可临时用 npx tsx entry.js
