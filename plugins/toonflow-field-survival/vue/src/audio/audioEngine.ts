/**
 * audioEngine.ts —— 音效播放引擎（WebAudio 实时合成）
 * ==================================================
 * 设计要点：
 *   1. **默认关闭**：关闭时连 AudioContext 都不创建（零 CPU / 零内存）。
 *      开关与音量存 localStorage，**不进 sys_state 存档**（避免跨设备串味）。
 *   2. **手势解锁**：浏览器自动播放策略要求用户手势后 resume()。
 *      插件 UI 跑在宿主 iframe 里 → 宿主外层手势不传递，
 *      必须挂在 iframe 文档自身的 pointerdown/keydown 上。
 *   3. **绝不影响游戏**：所有异常 try/catch 吞掉，音效失败即静默降级。
 *   4. **不刺耳**：同 key 80ms 去重 + 并发上限 6 + 分组音量 + 脚步按位移触发。
 */
import { SOUND_RECIPES, type SoundGroup, type SoundRecipe } from "./recipes";

/* ============================================================
   持久化键（与既有 fs_pixel_mode / fs_fog 同一套做法）
   ============================================================ */
const KEY_ON = "fs_sound_on";
const KEY_MASTER = "fs_sound_master";
const KEY_GROUP = "fs_sound_g:";

function readNum(key: string, def: number): number {
  try {
    const raw = localStorage.getItem(key);
    // ★ 关键：localStorage.getItem 在「没存过」时返回 null，
    //   而 Number(null) === 0 → 会把所有音量默默变成 0（音效全哑）。
    //   所以这里必须先判空再转数字。
    if (raw === null || raw === undefined || String(raw).trim() === "") return def;
    const v = Number(raw);
    return Number.isFinite(v) ? v : def;
  } catch {
    return def;
  }
}
function write(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

/* ============================================================
   状态
   ============================================================ */
let enabled = false;
let masterVolume = 0.7;
const groupVolume: Record<SoundGroup, number> = {
  ui: 0.6,
  move: 0.4,
  combat: 0.9,
  item: 0.8,
  skill: 0.85,
  system: 0.5,
};

/** 地图集/外部注册的自定义配方（业务音效不进 SOUND_RECIPES） */
const customRecipes: Record<string, SoundRecipe> = {};

/**
 * 正在发声的「声音实例」到期时刻表（并发上限用）。
 * ★ 不用「onended 回调计数」—— 那依赖浏览器保证回调一定触发（某些环境会丢），
 *   一旦漏掉计数就永久卡在上限、之后所有音效都哑掉。
 *   改成「记录到期时间戳 + 每次播放前剪枝过期项」，自愈、无回调依赖。
 */
const voiceEnds: number[] = [];
const MAX_VOICES = 6;

/** 剪掉已到期的声音实例，返回当前并发数 */
function activeVoices(now: number): number {
  while (voiceEnds.length && voiceEnds[0] <= now) voiceEnds.shift();
  return voiceEnds.length;
}

/** 同 key 去重窗口 */
const DEDUPE_MS = 80;
const lastPlayed = new Map<string, number>();

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
/** 已挂上手势监听 */
let unlockBound = false;

/* ============================================================
   ★ 音量图（GainNode 架构）
   ------------------------------------------------------------
   为什么要这样改：
     旧实现把音量在 schedule() 时乘进包络 → 改音量只影响**下次播放**，
     正在响的声音纹丝不动 → 用户拖滑块听不出变化，只能靠再点一次试听来验证，
     反馈延迟 = 一次完整往返，操作感非常「卡」。
     而且每次播放都要重算一次增益链 → 调度开销随音效数量线性增长。
   新实现：
     masterGain ─┬─ groupGain(ui) ─┬─ [每次播放的临时包络] ─┐
                 ├─ groupGain(move) ┤                        ├→ destination
                 └─ ...             ┘                        ┘
     滑块直接改 GainNode.gain → 正在响的声音**立刻**变轻/变响，
     且不需要重新调度任何东西。
   ============================================================ */
/** 主音量节点 */
let masterGain: GainNode | null = null;
/** 各分组的增益节点（group id → node） */
const groupGains = new Map<SoundGroup, GainNode>();

/** AudioContext 构造失败（老旧 WebView / 无音频设备）→ 永久降级 */
let unsupported = false;

/* ============================================================
   初始化
   ============================================================ */
function loadSettings() {
  enabled = localStorage.getItem(KEY_ON) === "1";
  masterVolume = clamp01(readNum(KEY_MASTER, 0.7));
  for (const g of Object.keys(groupVolume) as SoundGroup[]) {
    groupVolume[g] = clamp01(readNum(KEY_GROUP + g, groupVolume[g]));
  }
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// 首次 import 时读一次（localStorage 不可用时静默用默认值）
loadSettings();

/* ============================================================
   AudioContext 管理
   ============================================================ */
function ensureCtx(): AudioContext | null {
  if (unsupported) return null;
  if (ctx) return ctx;
  try {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) {
      unsupported = true;
      return null;
    }
    ctx = new AC();
    buildGainGraph(ctx);
  } catch {
    unsupported = true;
    ctx = null;
  }
  return ctx;
}

/**
 * 构建增益图：master → (group → per-voice) → destination
 * 只在 AudioContext 创建时调用一次。
 */
function buildGainGraph(ac: AudioContext): void {
  try {
    masterGain = ac.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ac.destination);
    for (const g of Object.keys(groupVolume) as SoundGroup[]) {
      const node = ac.createGain();
      node.gain.value = groupVolume[g] ?? 1;
      node.connect(masterGain);
      groupGains.set(g, node);
    }
  } catch {
    masterGain = null;
    groupGains.clear();
  }
}

/**
 * 音量写入：同时更新数值与 GainNode。
 * ★ 用 setTargetAtTime 而不是直接赋值 —— 直接赋值会在当前音频块边界产生
 *   突变（爆音/咔哒）；setTargetAtTime 做平滑过渡，滑块拖动时听感自然。
 * @param timeSec 平滑时间常数（秒），越小越跟手
 */
function applyGain(node: GainNode | null, v: number, timeSec: number, now: number): void {
  if (!node) return;
  try {
    node.gain.setTargetAtTime(v, now, timeSec);
  } catch {
    try {
      node.gain.value = v;
    } catch {
      /* ignore */
    }
  }
}

/** 懒初始化噪声缓冲（1s 白噪声，循环取用） */
function getNoiseBuffer(ac: AudioContext): AudioBuffer | null {
  if (noiseBuffer) return noiseBuffer;
  try {
    const len = Math.floor(ac.sampleRate * 1);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  } catch {
    return null;
  }
}

/**
 * 解锁音频上下文（需用户手势）。
 * 幂等：重复调用无副作用。
 */
export function unlockAudio(): void {
  if (!enabled) return;
  const ac = ensureCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    try {
      void ac.resume();
    } catch {
      /* ignore */
    }
  }
}

/** 绑定手势解锁监听（App.vue 挂载时调用一次） */
export function bindUnlockGesture(): () => void {
  if (unlockBound) return () => {};
  unlockBound = true;
  const handler = () => {
    unlockAudio();
    // 解锁后摘掉监听（之后不再需要）
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("keydown", handler, true);
    window.removeEventListener("touchstart", handler, true);
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("keydown", handler, true);
  window.addEventListener("touchstart", handler, true);
  return () => {
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("keydown", handler, true);
    window.removeEventListener("touchstart", handler, true);
  };
}

/* ============================================================
   配方查找
   ============================================================ */
export function getRecipe(name: string): SoundRecipe | null {
  return customRecipes[name] ?? SOUND_RECIPES[name] ?? null;
}

/**
 * 注册自定义音效配方。
 * 供地图集/事件脚本注入**业务专属**音效（插件本身不写业务）。
 */
export function registerRecipe(name: string, recipe: SoundRecipe): void {
  customRecipes[name] = recipe;
}

/** 已注册（含内置）的配方总数（调试面板用） */
export function recipeCount(): number {
  return Object.keys(SOUND_RECIPES).length + Object.keys(customRecipes).length;
}

/* ============================================================
   播放
   ============================================================ */
export interface PlayOptions {
  /** 额外增益倍率（叠加在配方 gain 之上） */
  gain?: number;
  /** 音高倍率 */
  rate?: number;
}

/**
 * 播放一条音效。
 * 未注册的名字 → debug 日志（不刷屏），不抛错。
 */
export function play(name: string, opts?: PlayOptions): void {
  if (!enabled) return;
  const recipe = getRecipe(name);
  if (!recipe) {
    if (import.meta.env?.DEV) {
      console.debug("[audio] 未注册的音效配方：", name);
    }
    return;
  }
  // 同 key 去重
  const now = Date.now();
  const last = lastPlayed.get(name) || 0;
  if (now - last < DEDUPE_MS) return;
  lastPlayed.set(name, now);
  if (lastPlayed.size > 200) lastPlayed.clear();

  const ac = ensureCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    // 未解锁 → 尝试恢复（浏览器允许时），失败则本次不播
    try {
      void ac.resume();
    } catch {
      /* ignore */
    }
    if (ac.state === "suspended") return;
  }
  // 并发上限：按「当前时刻 + 该音效总时长」占用一个声位
  const nowSec = ac.currentTime;
  const recipeDur = ((Math.max(20, recipe.dur ?? 150) / 1000) * Math.max(1, recipe.repeat ?? 1));
  if (activeVoices(nowSec) >= MAX_VOICES) return;

  try {
    schedule(ac, recipe, opts);
  } catch (e) {
    // 音效异常绝不影响游戏
    console.warn("[audio] 播放失败：", name, e);
  }
}

function schedule(ac: AudioContext, r: SoundRecipe, opts?: PlayOptions): void {
  const dur = Math.max(20, r.dur ?? 150) / 1000;
  const repeat = Math.max(1, r.repeat ?? 1);
  // ★ 这里只剩「配方自身的峰值增益」。主音量与分组音量都在 GainNode 上，
  //   由滑块实时控制 → 拖动时正在响的声音立刻跟着变。
  const gain = clamp01((r.gain ?? 0.2) * (opts?.gain ?? 1));
  const rate = opts?.rate ?? 1;
  const detune = r.detune ?? 0;
  const start = ac.currentTime + (r.delay ?? 0) / 1000;
  if (gain <= 0.001) return;

  // 声音终点接在「分组增益节点」上（若图未建立则退回 destination）
  const dest: AudioNode = groupGains.get(r.group) ?? masterGain ?? ac.destination;

  for (let i = 0; i < repeat; i++) {
    const t0 = start + i * dur;
    // 占一个并发声位（到期时间 = 声音结束时刻 + 一点余量）
    voiceEnds.push(t0 + dur + 0.02);
    // 音高随机化（每条独立随机，避免重复触发完全同音）
    const jitter = detune ? 1 + (Math.random() * 2 - 1) * detune : 1;
    const f0 = Math.max(20, (r.freq ?? 440) * rate * jitter);
    const f1 = r.toFreq !== undefined ? Math.max(20, r.toFreq * rate * jitter) : f0;

    const env = ac.createGain();
    env.connect(dest);
    // 包络：快起 + 指数衰减（避免爆音）
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.015, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const wave = r.wave ?? "sine";
    const noiseMix = clamp01(r.noise ?? 0);

    if (wave !== "noise" && noiseMix < 1) {
      const osc = ac.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = ac.createGain();
      g.gain.value = 1 - noiseMix;
      osc.connect(g).connect(env);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    if (noiseMix > 0) {
      const buf = getNoiseBuffer(ac);
      if (buf) {
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        // 噪声用带通/高通滤波切出音高感，避免"白噪音爆炸感"
        const flt = ac.createBiquadFilter();
        flt.type = "bandpass";
        flt.frequency.setValueAtTime(f0, t0);
        flt.Q.value = 1.2;
        if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
        const g = ac.createGain();
        g.gain.value = noiseMix;
        src.connect(flt).connect(g).connect(env);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.02);
      }
    }
  }
}

/* ============================================================
   设置读写
   ============================================================ */
export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = !!on;
  write(KEY_ON, enabled ? "1" : "0");
  if (enabled) {
    // 打开时立刻尝试解锁（此时多半正处在用户手势的调用栈里）
    unlockAudio();
  } else {
    // 关闭时释放 AudioContext
    try {
      ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = null;
    noiseBuffer = null;
    masterGain = null;
    groupGains.clear();
    voiceEnds.length = 0;
    lastPlayed.clear();
  }
}

export function getMasterVolume(): number {
  return masterVolume;
}

/** ★ 音量滑动的落盘防抖：拖动时每秒可能触发 60+ 次 setItem，
 *  同步写 localStorage 会明显卡手。改成 300ms 内只写最后一次。 */
let persistTimer: any = null;
function persist(key: string, value: string): void {
  try {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      write(key, value);
    }, 300);
  } catch {
    write(key, value);
  }
}

/** 主音量平滑时间常数（秒）—— 越小越跟手，但仍避免爆音 */
const SLIDE_TAU = 0.02;

export function setMasterVolume(v: number): void {
  masterVolume = clamp01(v);
  // 正在响的声音立刻跟着变（这是「手感」的关键）
  applyGain(masterGain, masterVolume, SLIDE_TAU, ctx?.currentTime ?? 0);
  persist(KEY_MASTER, String(masterVolume));
}

export function getGroupVolume(g: SoundGroup): number {
  return groupVolume[g] ?? 1;
}
export function setGroupVolume(g: SoundGroup, v: number): void {
  groupVolume[g] = clamp01(v);
  applyGain(groupGains.get(g) ?? null, groupVolume[g], SLIDE_TAU, ctx?.currentTime ?? 0);
  persist(KEY_GROUP + g, String(groupVolume[g]));
}

/** 调试面板用：上下文状态 */
export function audioContextState(): "uninitialized" | "suspended" | "running" | "unsupported" {
  if (unsupported) return "unsupported";
  if (!ctx) return "uninitialized";
  try {
    return ctx.state as any;
  } catch {
    return "uninitialized";
  }
}
