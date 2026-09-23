/**
 * 本地模拟宿主（standalone 模式）
 *
 * 触发条件：
 *   1. game.html 直接以 file:// 打开（无 location.href 中的 getAsset）
 *   2. 或者父窗口 600ms 内未推送 tf_plugin_state
 *
 * 行为：
 *   - 读取 /test_data/test_state.json（如果存在）覆盖默认角色
 *   - 推送完整的 select 状态（含 15 个 mock 角色）
 *   - 监听 iframe 的 tf_plugin_tick / tf_plugin_action / tf_plugin_fullscreen
 *   - 模拟一个极简的 playing 引擎：玩家移动 + 自动生成野怪 + 攻击结算
 *   - 演示 setFullscreen：响应全屏请求修改自身 URL hash 让 App.vue 看到变化
 */
import type { GameState, Entity, RoleOption } from "./types";

// 默认角色（当 test_data/test_state.json 不存在时使用）
const DEFAULT_ROLES: RoleOption[] = [
  { id: "r01", name: "陈彦", roleType: "player", avatarPath: "./images/player_sprites/4334.png", description: "赦夜人主角" },
  { id: "r02", name: "裴勇", roleType: "npc", avatarPath: "./images/player_sprites/3858.png" },
  { id: "r03", name: "夜见", roleType: "npc", avatarPath: "./images/player_sprites/4213.png" },
  { id: "r04", name: "聂小可", roleType: "npc" },
  { id: "r05", name: "武飞", roleType: "npc" },
  { id: "r06", name: "黑狼", roleType: "npc" },
  { id: "r07", name: "朱果", roleType: "npc" },
  { id: "r08", name: "骑士", roleType: "npc" },
  { id: "r09", name: "郭奉凯", roleType: "npc" },
  { id: "r10", name: "霍魁", roleType: "npc" },
  { id: "r11", name: "魏靖", roleType: "npc" },
  { id: "r12", name: "林佩雅", roleType: "npc" },
  { id: "r13", name: "暮光者", roleType: "npc" },
  { id: "r14", name: "某男子", roleType: "npc" },
  { id: "r15", name: "某女子", roleType: "npc" },
];

async function loadRoles(): Promise<RoleOption[]> {
  // 尝试加载 test_data/test_state.json（位置由 vite/build 决定）
  const candidates = [
    "./test_data/test_state.json",
    "../test_data/test_state.json",
    "/test_data/test_state.json",
  ];
  for (const p of candidates) {
    try {
      const r = await fetch(p);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d?.roles) && d.roles.length > 0) return d.roles as RoleOption[];
      }
    } catch { /* ignore */ }
  }
  return DEFAULT_ROLES;
}

/* ============================================================
   模拟状态机（select → playing → over）
   ============================================================ */
let state: GameState;
let waveTimer = 0;
let mobIdSeq = 1000;
const WAVE_INTERVAL = 240; // 24 秒一波

function makeEntity(role: RoleOption, side: "player" | "ally" | "enemy", x: number, y: number): Entity {
  return {
    id: role.id,
    name: role.name,
    side,
    x, y,
    vx: 0, vy: 0,
    hp: 100, maxHp: 100,
    atk: 12,
    level: 1,
    avatarPath: role.avatarPath,
    facing: 180,
    cooldown: 0,
    alive: true,
  };
}

function spawnWave(): void {
  const archetypes = [
    { name: "哥布林斥候", hp: 30, atk: 6 },
    { name: "巨狼", hp: 60, atk: 10 },
    { name: "毒蛇", hp: 25, atk: 8 },
    { name: "蝙蝠", hp: 20, atk: 5 },
    { name: "骷髅兵", hp: 50, atk: 12 },
  ];
  const wave = archetypes[Math.floor(Math.random() * archetypes.length)];
  const count = 3 + Math.floor(state.tick / 600);
  const events: string[] = [];
  for (let i = 0; i < count; i++) {
    const e: Entity = {
      id: `m${mobIdSeq++}`,
      name: wave.name,
      side: "enemy",
      x: 50 + Math.random() * 860,
      y: 100 + Math.random() * 460,
      vx: 0, vy: 0,
      hp: wave.hp, maxHp: wave.hp,
      atk: wave.atk,
      level: 1 + Math.floor(state.tick / 600),
      facing: 180,
      cooldown: 0,
      alive: true,
    };
    state.entities.push(e);
  }
  events.push(`[mock] 第 ${Math.floor(state.tick / WAVE_INTERVAL) + 1} 波：${wave.name} ×${count}`);
  state.events.push(...events);
}

function buildInitialState(roles: RoleOption[]): GameState {
  const playerRole = roles.find((r) => r.roleType === "player") || roles[0];
  const entities: Entity[] = [];
  entities.push(makeEntity(playerRole, "player", 480, 300));
  // 默认把第二个角色作为盟友上场
  if (roles.length > 1) entities.push(makeEntity(roles[1], "ally", 420, 320));

  return {
    phase: "select",
    version: 1,
    tick: 0,
    world: { w: 960, h: 600 },
    roles,
    selections: { participants: playerRole ? [playerRole.id] : [], spectators: [], enemies: [] },
    entities,
    chests: [
      { id: "ch1", x: 200, y: 400, opened: false },
      { id: "ch2", x: 750, y: 250, opened: false },
    ],
    potions: [
      { id: "p1", x: 150, y: 150, heal: 30 },
      { id: "p2", x: 800, y: 450, heal: 30 },
      { id: "p3", x: 500, y: 500, heal: 30 },
    ],
    floaters: [],
    skills: [
      { name: "冲斩", power: 18, cost: 10, cd: 30, cdLeft: 0 },
      { name: "火球", power: 25, cost: 20, cd: 60, cdLeft: 0 },
      { name: "治疗", power: -40, cost: 25, cd: 90, cdLeft: 0 },
      { name: "护盾", power: 0, cost: 15, cd: 120, cdLeft: 0 },
    ],
    items: [
      { name: "血瓶", count: 3, heal: 30 },
      { name: "蓝瓶", count: 2, heal: 0 },
      { name: "炸药", count: 1, heal: 0 },
      { name: "钥匙", count: 1, heal: 0 },
    ],
    skillPage: 0,
    itemPage: 0,
    map: null,
    mapSource: "fallback",
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: ["[mock] 本地模拟模式已启动（未检测到宿主）"],
    result: null,
  };
}

function push(): void {
  window.postMessage({ type: "tf_plugin_state", state: JSON.parse(JSON.stringify(state)) }, "*");
}

/* ============================================================
   监听 iframe 的请求
   ============================================================ */
function install(): void {
  // 监听 tick 动作
  window.addEventListener("message", (e: MessageEvent) => {
    const d: any = e?.data;
    if (!d || typeof d !== "object") return;

    if (d.type === "tf_plugin_loaded") {
      // 插件说"我加载好了"，立即推一次初始状态
      push();
      return;
    }

    if (d.type === "tf_plugin_tick" && state.phase === "playing") {
      const { action, params } = d;
      if (action === "start") {
        // 已经在 playing，忽略
        return;
      }
      if (action === "tick") {
        state.tick++;
        const inp = params?.input || {};
        const me = state.entities.find((x) => x.side === "player");
        // 移动
        if (me && me.alive) {
          if (inp.dx || inp.dy) {
            me.x = Math.max(20, Math.min(940, me.x + (inp.dx || 0) * 4));
            me.y = Math.max(40, Math.min(560, me.y + (inp.dy || 0) * 4));
            me.facing = inp.dx > 0 ? 90 : inp.dx < 0 ? 270 : me.facing;
          }
          if (inp.moveTo) {
            me.x = Math.max(20, Math.min(940, inp.moveTo.x));
            me.y = Math.max(40, Math.min(560, inp.moveTo.y));
          }
        }
        // 敌人 AI：朝玩家移动 + 攻击
        const target = me;
        state.entities.forEach((e) => {
          if (e.side !== "enemy" || !e.alive) return;
          if (!target || !target.alive) return;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          const d2 = Math.hypot(dx, dy);
          if (d2 < 250) {
            const sp = 1.2;
            e.x += (dx / (d2 || 1)) * sp;
            e.y += (dy / (d2 || 1)) * sp;
            e.facing = dx > 0 ? 90 : 270;
          }
          e.cooldown--;
          if (d2 < 28 && e.cooldown <= 0) {
            target.hp = Math.max(0, target.hp - e.atk);
            state.floaters.push({ id: "f" + state.tick, text: `-${e.atk}`, x: target.x, y: target.y - 10, life: 12 });
            e.cooldown = 40;
            if (target.hp <= 0) {
              target.alive = false;
              state.events.push(`[mock] 玩家被 ${e.name} 击倒`);
              state.phase = "over";
              state.result = { reason: "death", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
            }
          }
        });
        // 玩家自动攻击最近的敌人（每 30 tick）
        if (me && me.alive && state.tick % 30 === 0) {
          let closest: Entity | null = null;
          let minD = Infinity;
          state.entities.forEach((e) => {
            if (e.side !== "enemy" || !e.alive) return;
            const dd = Math.hypot(e.x - me.x, e.y - me.y);
            if (dd < minD && dd < 200) { minD = dd; closest = e; }
          });
          if (closest) {
            (closest as Entity).hp -= me.atk;
            state.floaters.push({ id: "f" + state.tick, text: `-${me.atk}`, x: (closest as Entity).x, y: (closest as Entity).y - 10, life: 12 });
            if ((closest as Entity).hp <= 0) {
              (closest as Entity).alive = false;
              state.kills++;
              state.exp += 5;
              state.money += 3;
              state.events.push(`[mock] 击杀 ${(closest as Entity).name} (+5exp +3money)`);
            }
          }
        }
        // 浮动文字生命衰减
        state.floaters = state.floaters.filter((f) => { f.life--; return f.life > 0; });
        // 波次生成
        waveTimer++;
        if (waveTimer >= WAVE_INTERVAL) {
          waveTimer = 0;
          spawnWave();
        }
        // 推回前端
        push();
        return;
      }
      if (action === "skill") {
        state.events.push(`[mock] 释放技能 #${params?.index}`);
        push();
        return;
      }
      if (action === "item") {
        state.events.push(`[mock] 使用物品 #${params?.index}`);
        push();
        return;
      }
      if (action === "page") {
        const k = params?.kind;
        const d2 = params?.delta || 0;
        if (k === "skill") {
          const total = Math.ceil(state.skills.length / 4);
          state.skillPage = ((state.skillPage + d2) % total + total) % total;
        } else if (k === "item") {
          const total = Math.ceil(state.items.length / 4);
          state.itemPage = ((state.itemPage + d2) % total + total) % total;
        }
        push();
        return;
      }
      if (action === "exit") {
        state.phase = "over";
        state.result = { reason: "exit", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
        state.events.push("[mock] 玩家主动退出");
        push();
        return;
      }
    }

    if (d.type === "tf_plugin_action") {
      const k = d.kind;
      if (k === "done" || k === "abort") {
        state.phase = "over";
        state.result = { reason: "exit", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
        state.events.push(`[mock] ${k === "abort" ? "放弃游戏" : "游戏完成"}`);
        push();
      }
      return;
    }

    if (d.type === "tf_plugin_fullscreen") {
      state.events.push(`[mock] setFullscreen(${!!d.fullscreen})`);
      // 在测试页面上用一个可见标志：写 hash 让开发者看到
      location.hash = d.fullscreen ? "fullscreen" : "";
      push();
      return;
    }

    // ★ start 处理（从 select → playing）
    if (d.type === "tf_plugin_tick" && d.action === "start" && state.phase === "select") {
      // 应用选择
      const sel = (d.params?.selections) || {};
      state.selections = {
        participants: Array.isArray(sel.participants) ? sel.participants : [],
        spectators: Array.isArray(sel.spectators) ? sel.spectators : [],
        enemies: Array.isArray(sel.enemies) ? sel.enemies : [],
      };
      // 重置实体：只保留参展角色作为玩家/盟友
      state.entities = state.entities.filter((e) => e.side !== "player" && e.side !== "ally");
      const partR = state.selections.participants
        .map((id) => state.roles.find((r) => r.id === id))
        .filter(Boolean) as RoleOption[];
      partR.forEach((r, i) => {
        state.entities.push(makeEntity(r, i === 0 ? "player" : "ally", 460 + i * 30, 300 + i * 20));
      });
      // 敌对角色：作为敌人 NPC 上场（而不是野兽）
      const enR = state.selections.enemies
        .map((id) => state.roles.find((r) => r.id === id))
        .filter(Boolean) as RoleOption[];
      enR.forEach((r, i) => {
        const e = makeEntity(r, "enemy", 200 + i * 50, 200);
        e.hp = 80; e.maxHp = 80; e.atk = 10;
        state.entities.push(e);
      });
      // 如果没有敌对角色，会在 wave 中生成野兽
      state.phase = "playing";
      state.tick = 0;
      waveTimer = 0;
      state.events.push(`[mock] 战斗开始：参展 ${partR.length}，敌对 ${enR.length || "自动生成"}`);
      push();
      return;
    }
  });
}

export async function startMockHostIfStandalone(): Promise<boolean> {
  // 仅在 game.html 直接以 file:// 打开时启用 mock
  const isStandalone = !location.href.includes("getAsset") && window.parent === window;
  if (!isStandalone) return false;
  const roles = await loadRoles();
  state = buildInitialState(roles);
  install();
  // 兜底：插件可能没发 loaded，直接推一次
  setTimeout(() => push(), 100);
  console.info("[mockHost] standalone mode active，roles=", roles.length);
  return true;
}