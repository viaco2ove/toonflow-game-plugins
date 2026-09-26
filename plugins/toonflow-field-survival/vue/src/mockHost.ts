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

/** ★ 从 overworld.json 读出的 safe zone（mulberryTown 全图 = 安全区，野怪不得进入） */
let mapSafeZones: Array<{ name: string; x: number; y: number; rx?: number; ry?: number; r?: number; kind: string }> | null = null;

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
  // ★ v3：怪物 spawn 在玩家 (0,0) 周围 ±100 米（开局就看得见）
  const me = state.entities.find((x) => x.side === "player");
  const cx = me?.x ?? 0;
  const cy = me?.y ?? 0;
  // ★ 城镇图（mulberryTown）全图都是安全区 → 城镇内根本不刷野怪
  if (mapSafeZones && mapSafeZones.length > 0) return;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 70;     // 离玩家 30-100 米环形分布
    const e: Entity = {
      id: `m${mobIdSeq++}`,
      name: wave.name,
      side: "enemy",
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
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

function buildInitialState(roles: RoleOption[], mapPlayerSpawn?: { x: number; y: number }): GameState {
  const playerRole = roles.find((r) => r.roleType === "player") || roles[0];
  const entities: Entity[] = [];
  // ★ v3：玩家出生在 origin (0, 0)；如果地图数据自带 playerSpawn（mulberryTown），优先用它
  const sp = mapPlayerSpawn ?? { x: 0, y: 0 };
  entities.push(makeEntity(playerRole, "player", sp.x, sp.y));
  // 默认把第二个角色作为盟友上场（偏移 12 米，与 entry.ts 的 ALLY_FOLLOW_GAP_M 一致）
  if (roles.length > 1) entities.push(makeEntity(roles[1], "ally", sp.x - 12, sp.y + 12));

  return {
    phase: "select",
    version: 3,
    tick: 0,
    // ★ v3：3000×3000 米世界（origin 0,0，坐标范围 ±1500）
    world: { w: 3000, h: 3000 },
    spawn: { x: 0, y: 0 },
    scale: {
      meter: 1,
      block_size: 0.5,
      chunk_size_blocks: 32,
      chunk_size_meters: 16,
      ground_size: 3000,
      ground_height: 100,
      x_range: [-1500, 1500],
      z_range: [-1500, 1500],
    },
    roles,
    selections: { participants: playerRole ? [playerRole.id] : [], spectators: [], enemies: [] },
    entities,
    chests: [
      // ★ v3：坐标单位：米（±1500 范围）
      { id: "ch1", x:  100, y:  150, opened: false },
      { id: "ch2", x: -200, y:  100, opened: false },
    ],
    potions: [
      { id: "p1", x:   70, y: -120, heal: 30 },
      { id: "p2", x: -150, y:   50, heal: 30 },
      { id: "p3", x:  300, y: -300, heal: 30 },
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
        const params2 = params || {};
        const me = state.entities.find((x) => x.side === "player");
        // ★ 修复：玩家位姿由 game.html 本地 tick 权威推进并随 tick 上报（params.player），
        //   mock 宿主只镜像、不再按 input.dx/dy 重复积分（原先 +3 米/帧 与前端 0.3 米/帧 双写，
        //   造成"走一小步就停 / 松手瞬移"）。
        if (me && me.alive) {
          const pose = params2.player;
          if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
            me.x = Math.max(-1490, Math.min(1490, pose.x));
            me.y = Math.max(-1490, Math.min(1490, pose.y));
            if (Number.isFinite(pose.facing)) me.facing = pose.facing;
          }
          me.vx = 0;
          me.vy = 0;
        }
        // 敌人 AI：朝玩家移动 + 攻击（米单位）
        const target = me;
        // ★ 安全区判定：玩家在 safe zone 内时，野怪不能进入/追击
        //   来源优先级：地图加载时写入的 mapSafeZones（mulberryTown 全图 safe） > state.map.zones
        const safeZones = (mapSafeZones ?? ((state as any).map?.zones ?? [])).filter((z: any) => z.kind === "safe");
        const playerInSafe = !!target && safeZones.some((z: any) => {
          if (z.rx !== undefined && z.ry !== undefined) {
            return Math.abs(z.x - target.x) <= z.rx && Math.abs(z.y - target.y) <= z.ry;
          }
          return Math.hypot(z.x - target.x, z.y - target.y) <= (z.r ?? 0);
        });
        state.entities.forEach((e) => {
          if (e.side !== "enemy" || !e.alive) return;
          if (!target || !target.alive) return;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          const d2 = Math.hypot(dx, dy);
          // ★ 玩家在安全区 → 野怪停止追击并撤退到安全区外
          if (playerInSafe) {
            // 计算该野怪自身是否在某个安全区内，若是 → 立即推出
            const meInSafe = safeZones.some((z: any) => {
              if (z.rx !== undefined && z.ry !== undefined) {
                return Math.abs(z.x - e.x) <= z.rx && Math.abs(z.y - e.y) <= z.ry;
              }
              return Math.hypot(z.x - e.x, z.y - e.y) <= (z.r ?? 0);
            });
            if (meInSafe) {
              // 推到最近的 safe zone 边缘外 1 米
              for (const z of safeZones) {
                const odx = e.x - z.x, ody = e.y - z.y;
                const od = Math.hypot(odx, ody) || 0.001;
                const margin = (z.r ?? 30) + 1;
                e.x = z.x + (odx / od) * margin;
                e.y = z.y + (ody / od) * margin;
                break;
              }
            }
            return; // 不追、不攻
          }
          // 看见玩家 80 米；追；2 米内攻击
          if (d2 < 80) {
            const sp = 2.0 * 0.1;  // 2.0 米/秒 × 0.1 秒/帧 = 0.2 米/帧（步行追赶，与 entry 对齐）
            e.x += (dx / (d2 || 1)) * sp;
            e.y += (dy / (d2 || 1)) * sp;
            e.facing = dx > 0 ? 0 : 180;   // 角度制：0=右 180=左
          }
          e.cooldown--;
          if (d2 < 2 && e.cooldown <= 0) {
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
        // 玩家自动攻击最近的敌人（每 30 tick，30 米内）
        if (me && me.alive && state.tick % 30 === 0) {
          let closest: Entity | null = null;
          let minD = Infinity;
          state.entities.forEach((e) => {
            if (e.side !== "enemy" || !e.alive) return;
            const dd = Math.hypot(e.x - me.x, e.y - me.y);
            if (dd < minD && dd < 30) { minD = dd; closest = e; }
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

    // ★ 死亡弹窗「复活」：原地复活（玩家坐标不变、满血、over → playing）
    if (d.type === "tf_plugin_tick" && d.action === "revive" && state.phase === "over") {
      const me = state.entities.find((x) => x.side === "player");
      if (me) {
        me.alive = true;
        me.hp = me.maxHp;
        me.vx = 0;
        me.vy = 0;
        // 复活保护：场上存活敌人进入 2 秒攻击冷却，避免复活即被秒
        state.entities.forEach((e) => {
          if (e.side === "enemy" && e.alive) e.cooldown = Math.max(e.cooldown || 0, 20);
        });
        state.result = null;
        state.phase = "playing";
        state.events.push("[mock] 你在原地复活");
        push();
      }
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
        // ★ v3：玩家出生 origin (0,0)，盟友环绕（半径 12 米 = ALLY_FOLLOW_GAP_M）
        const isPlayer = i === 0;
        const angle = (i / Math.max(1, partR.length)) * Math.PI * 2;
        state.entities.push(makeEntity(
          r, isPlayer ? "player" : "ally",
          isPlayer ? 0 : Math.cos(angle) * 12,
          isPlayer ? 0 : Math.sin(angle) * 12,
        ));
      });
      // 敌对角色：作为敌人 NPC 上场（而不是野兽）— 玩家附近 ±80 米环形分布
      const enR = state.selections.enemies
        .map((id) => state.roles.find((r) => r.id === id))
        .filter(Boolean) as RoleOption[];
      const eCount = enR.length;
      enR.forEach((r, i) => {
        const angle = eCount > 1 ? (i / eCount) * Math.PI * 2 : 0;
        const dist = 50 + (i % 3) * 10;   // 50-70 米
        const e = makeEntity(r, "enemy", Math.cos(angle) * dist, Math.sin(angle) * dist);
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
  // ★ v5：尝试读 overworld.json 拿 playerSpawn + safe zones（mulberryTown 等 Tiled 格式地图）
  let mapSpawn: { x: number; y: number } | undefined;
  try {
    const r = await fetch("./maps/overworld.json");
    if (r.ok) {
      const d = await r.json();
      // 找 objectgroup 里 entity_type=PLAYER 的对象
      for (const layer of d.layers ?? []) {
        if (layer.type !== "objectgroup") continue;
        for (const obj of layer.objects ?? []) {
          const props = Object.fromEntries((obj.properties ?? []).map((p: any) => [p.name, p.value]));
          if (props.entity_type === "PLAYER") {
            mapSpawn = {
              x: (obj.x / 32) - (d.width / 2),
              y: (obj.y / 32 - 1) - (d.height / 2),
            };
            break;
          }
        }
        if (mapSpawn) break;
      }
      // ★ Tiled 城镇图（mulberryTown）：全图都是 safe zone（野怪不得进入）
      mapSafeZones = [{
        name: "城镇",
        x: 0, y: 0,
        rx: d.width / 2, ry: d.height / 2,
        kind: "safe",
      }];
    }
  } catch { /* ignore */ }
  state = buildInitialState(roles, mapSpawn);
  install();
  // 兜底：插件可能没发 loaded，直接推一次
  setTimeout(() => push(), 100);
  console.info("[mockHost] standalone mode active，roles=", roles.length, "spawn=", mapSpawn);
  return true;
}