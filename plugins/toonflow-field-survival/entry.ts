/**
 * 野外生存插件 — 入口文件（TypeScript 版本）
 *
 * 后端通过 PluginExecutor 动态 import 本模块，
 * 调用 handle_action(action, params, state, context) 推进游戏。
 */

interface PluginGameContext {
  pluginId: string;
  pluginDir: string;
  manifest: any;
}

// ---------------------------------------------------------------------------
// 状态类型
// ---------------------------------------------------------------------------

export interface FieldSurvivalState {
  hp: number;           // 生命值（初始 100）
  hunger: number;       // 饥饿值（初始 100，越低越危险）
  thirst: number;       // 干渴值（初始 100）
  day: number;          // 天数
  wave: number;          // 当前波次
  enemies: Enemy[];      // 敌人生成
  inventory: string[];   // 物品栏
  score: number;         // 积分
  alive: boolean;        // 是否存活
  events: string[];     // 事件日志
}

interface Enemy {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  type: "beast" | "boss";
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function emptyState(): FieldSurvivalState {
  return {
    hp: 100,
    hunger: 100,
    thirst: 100,
    day: 1,
    wave: 0,
    enemies: [],
    inventory: [],
    score: 0,
    alive: true,
    events: ["你从昏迷中醒来，发现自己身处荒野..."],
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function tickSurvival(state: FieldSurvivalState): void {
  // 每回合扣饥饿和干渴
  state.hunger = clamp(state.hunger - 3, 0, 100);
  state.thirst = clamp(state.thirst - 5, 0, 100);

  // 饥饿或干渴为 0 时持续扣血
  if (state.hunger === 0 || state.thirst === 0) {
    state.hp = clamp(state.hp - 10, 0, 100);
    if (state.hunger === 0) state.events.push("饥饿难耐，身体虚弱...");
    if (state.thirst === 0) state.events.push("口渴难忍，意识模糊...");
  }

  // 全部满时小幅度恢复
  if (state.hunger > 80 && state.thirst > 80) {
    state.hp = clamp(state.hp + 2, 0, 100);
  }

  if (state.hp <= 0) {
    state.alive = false;
    state.events.push("你倒下了...");
  }
}

function buildEnemies(wave: number): Enemy[] {
  if (wave === 0) return [];
  const count = Math.min(1 + Math.floor(wave / 2), 4);
  return Array.from({ length: count }, (_, i) => ({
    id: `enemy_${wave}_${i}`,
    name: wave >= 3 && i === 0 ? "荒野巨兽" : `野兽 ${i + 1}`,
    hp: 30 + wave * 10,
    maxHp: 30 + wave * 10,
    attack: 5 + wave * 3,
    type: wave >= 3 && i === 0 ? "boss" : "beast",
  }));
}

// ---------------------------------------------------------------------------
// 动作别名映射：前端按钮/用户输入（中文）→ 内部 action id
// 插件自行解析输入，后端不做任何硬编码映射
// ---------------------------------------------------------------------------

const ACTION_ALIASES: Record<string, string> = {
  "开始游戏": "init",
  "开始": "init",
  "重新开始": "init",
  "start": "init",
  "init": "init",
  "寻找食物": "find_food",
  "找食物": "find_food",
  "觅食": "find_food",
  "寻食": "find_food",
  "找吃的": "find_food",
  "进食": "find_food",
  "寻找水源": "find_water",
  "找水": "find_water",
  "喝水": "find_water",
  "搜索周围": "search",
  "搜索": "search",
  "搜索物资": "search",
  "攻击": "attack",
  "攻击敌人": "attack",
  "战斗": "attack",
  "防御": "defend",
  "防御姿态": "defend",
  "格挡": "defend",
  "退出": "exit",
  "退出游戏": "exit",
  "exit": "exit",
};

function resolveAction(raw: string): string {
  const key = String(raw || "").trim().replace(/^#/, "");
  return ACTION_ALIASES[key] || key;
}

// ---------------------------------------------------------------------------
// handle_action — 插件小游戏核心逻辑
// ---------------------------------------------------------------------------

export async function handle_action(
  action: string,
  params: Record<string, unknown>,
  state: Record<string, unknown>,
  _context: PluginGameContext,
): Promise<{
  code: number;
  message: string;
  state: Record<string, unknown>;
  response?: string;
  actions?: string[];
}> {
  // 首次调用或无状态时初始化
  const s = (state && Object.keys(state).length > 0
    ? state as FieldSurvivalState
    : emptyState()) as FieldSurvivalState;

  action = resolveAction(action);

  switch (action) {
    // ── 初始化/开始 ──
    case "init":
    case "start": {
      const fresh = emptyState();
      fresh.wave = 1;
      fresh.enemies = buildEnemies(1);
      fresh.events.push(`第 1 波来袭！出现了 ${fresh.enemies.length} 只野兽！`);
      fresh.score += 10;
      return {
        code: 0,
        message: "ok",
        state: fresh,
        response: `野外生存开始！你有 100 点生命值、饥饿和干渴各 100。${fresh.enemies[0]?.name} 出现了！点击下方操作按钮行动。`,
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 寻找食物 ──
    case "find_food": {
      tickSurvival(s);
      if (!s.alive) return { code: 1, message: "已死亡", state: s };

      const found = Math.random();
      if (found > 0.4) {
        s.hunger = clamp(s.hunger + 20, 0, 100);
        const food = found > 0.75 ? "野果" : "草根";
        s.inventory.push(food);
        s.events.push(`找到了 ${food}，饥饿恢复。`);
        s.score += 5;
      } else {
        s.events.push("没有找到食物...");
      }
      return {
        code: 0,
        message: "ok",
        state: s,
        response: s.events[s.events.length - 1],
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 寻找水源 ──
    case "find_water": {
      tickSurvival(s);
      if (!s.alive) return { code: 1, message: "已死亡", state: s };

      const found = Math.random();
      if (found > 0.35) {
        s.thirst = clamp(s.thirst + 25, 0, 100);
        s.events.push("找到了清澈的泉水，干渴恢复！");
        s.score += 5;
      } else {
        s.events.push("附近没有水源...");
      }
      return {
        code: 0,
        message: "ok",
        state: s,
        response: s.events[s.events.length - 1],
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 搜索周围 ──
    case "search": {
      tickSurvival(s);
      if (!s.alive) return { code: 1, message: "已死亡", state: s };

      const found = Math.random();
      if (found > 0.5) {
        const items = ["树枝", "石头", "干草", "草药"];
        const item = items[Math.floor(Math.random() * items.length)];
        s.inventory.push(item);
        s.events.push(`搜索中发现了 ${item}。`);
        s.score += 3;
      } else {
        s.events.push("周围一无所获...");
      }
      return {
        code: 0,
        message: "ok",
        state: s,
        response: s.events[s.events.length - 1],
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 攻击 ──
    case "attack": {
      tickSurvival(s);
      if (!s.alive) return { code: 1, message: "已死亡", state: s };

      const target = params?.target as string | undefined;
      const aliveEnemies = s.enemies.filter(e => e.hp > 0);
      if (aliveEnemies.length === 0) {
        s.events.push("当前没有敌人...");
        return { code: 0, message: "无敌人", state: s, response: "没有可攻击的目标。", actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"] };
      }

      const enemy = target
        ? aliveEnemies.find(e => e.id === target || e.name.includes(target as string)) || aliveEnemies[0]
        : aliveEnemies[0];

      const myDmg = 15 + Math.floor(Math.random() * 10);
      enemy.hp -= myDmg;
      s.events.push(`对 ${enemy.name} 造成 ${myDmg} 点伤害！${enemy.hp <= 0 ? `${enemy.name} 倒下了！` : `敌人剩余 ${enemy.hp} HP。`}`);
      s.score += enemy.hp <= 0 ? 20 : 5;

      if (enemy.hp <= 0 && aliveEnemies.every(e => e.hp <= 0)) {
        s.wave++;
        s.enemies = buildEnemies(s.wave);
        s.events.push(`第 ${s.wave} 波来袭！出现了 ${s.enemies.length} 只野兽！`);
        s.day++;
        s.score += 50;
        return {
          code: 0,
          message: "wave_clear",
          state: s,
          response: `击退了所有敌人！休息片刻... 第 ${s.wave} 波来袭！`,
          actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
        };
      }

      // 敌人反击
      const alive = s.enemies.filter(e => e.hp > 0);
      for (const e of alive) {
        s.hp = clamp(s.hp - e.attack, 0, 100);
        s.events.push(`${e.name} 反击了你！造成 ${e.attack} 点伤害。`);
      }
      if (s.hp <= 0) {
        s.alive = false;
        s.events.push("你倒下了... 游戏结束。");
        return { code: 1, message: "死亡", state: s, response: `你倒下了... 最终得分：${s.score}，存活 ${s.day} 天。`, actions: ["重新开始"] };
      }

      return {
        code: 0,
        message: "ok",
        state: s,
        response: s.events[s.events.length - 1],
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 防御 ──
    case "defend": {
      tickSurvival(s);
      if (!s.alive) return { code: 1, message: "已死亡", state: s };

      const alive = s.enemies.filter(e => e.hp > 0);
      for (const e of alive) {
        const dmg = Math.max(1, Math.floor(e.attack * 0.4));
        s.hp = clamp(s.hp - dmg, 0, 100);
        s.events.push(`防御姿态！${e.name} 的攻击被大幅减弱，只造成 ${dmg} 点伤害。`);
      }
      if (s.hp <= 0) {
        s.alive = false;
        s.events.push("你倒下了... 游戏结束。");
        return { code: 1, message: "死亡", state: s, response: `你倒下了... 最终得分：${s.score}，存活 ${s.day} 天。`, actions: ["重新开始"] };
      }

      return {
        code: 0,
        message: "ok",
        state: s,
        response: s.events[s.events.length - 1],
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
    }

    // ── 退出 ──
    case "exit": {
      return {
        code: 0,
        message: "exit",
        state: s,
        response: `野外生存结束。你存活了 ${s.day} 天，得分：${s.score}。`,
      };
    }

    // ── 未知动作 ──
    default:
      return {
        code: 0,
        message: "ok",
        state: s,
        response: `未知动作 "${action}"，请使用游戏内的操作按钮。`,
        actions: ["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"],
      };
  }
}
