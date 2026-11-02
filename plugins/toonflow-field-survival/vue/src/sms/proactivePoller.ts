/**
 * sms/proactivePoller.ts — P3 事件推送消费端（AI 主动消息）
 * =================================================
 * ★ 网络通信机制 v2 §4「P3 通知/挂机型」的插件端实现：
 *   AI 主动发消息**不再依赖 tick 心跳**（P1 反面教材），改由后端事件队列唤醒。
 *
 * 链路（S4 方案 A —— 后端只发「唤醒事件」，LLM 决策仍在插件前端跑）：
 *   后端编排器/定时器 → /plugin/events push（或 /plugin/data 写 __plugin_events__）
 *     → 本轮询器 30s 低频拉取（复用宿主代发的 /plugin/data，插件无 JWT 也能调）
 *     → 取到 wake_sms 事件 → 构造幽灵实体 → 复用 replyToPlayerSms 决策链
 *
 * 成本模型：30s 一次 get（~120B 响应）vs 旧 tick 心跳 10Hz —— 通信量 -99.7%。
 * 设计红线遵守：AI 状态（性格/记忆）不迁移后端；后端零 LLM 调用。
 */
import { toonflowJsApi } from "../toonflowJsApi";
import type { GameState } from "../types";

const POLL_INTERVAL_MS = 30_000;
const EVENTS_KEY = "__plugin_events__";

/** 轮询器状态 */
let timer: number | null = null;
let running = false;
/** 当前游戏状态引用（App.vue 每次启动时注入最新 getter） */
let stateGetter: (() => GameState | null) | null = null;
/** wake_sms 唤醒回调（ai/index.ts 注册，避免循环依赖） */
let wakeHandler: ((roleId: string, state: GameState, hint?: string) => Promise<void>) | null = null;

/**
 * 注册唤醒处理器（ai/index.ts 调用）。
 * @param fn (roleId, state) => Promise<void>：对指定角色发起一次主动决策
 */
export function registerProactiveWake(fn: NonNullable<typeof wakeHandler>): void {
  wakeHandler = fn;
}

/** 启动轮询（App.vue onMounted / 游戏开始时调用；幂等） */
export function startProactivePoller(getState: () => GameState | null): void {
  stateGetter = getState;
  if (running) return;
  running = true;
  scheduleNext(POLL_INTERVAL_MS);
  console.info("[p3] 短信事件轮询器已启动（间隔 30s，复用 /plugin/data 通道）");
}

/** 停止轮询（游戏退出时调用） */
export function stopProactivePoller(): void {
  running = false;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext(delayMs: number): void {
  if (!running) return;
  timer = window.setTimeout(async () => {
    await pollOnce();
    // ★ 页面隐藏时拉长到 5 分钟（后台不需要及时性；回来后下一轮自动恢复 30s）
    const hidden = typeof document !== "undefined" && document.hidden;
    scheduleNext(hidden ? 300_000 : POLL_INTERVAL_MS);
  }, delayMs);
}

/** 单次轮询：拉队列 → 分发 wake 事件 → 清空队列 */
async function pollOnce(): Promise<void> {
  try {
    const raw = await toonflowJsApi.pluginData.get(EVENTS_KEY);
    const list = Array.isArray(raw?.list) ? raw.list : [];
    if (!list.length) return;

    const state = stateGetter?.();
    // ★ 游戏状态未就绪（选人页/宿主还没推 playing）→ **不清队列**，等下一轮。
    //   否则事件被拉走又无法消费，wake 消息凭空丢失。
    if (!state) return;

    // 立刻清空队列（丢事件好过重复决策——S4 语义：事件只是"该动了"的提示）
    await toonflowJsApi.pluginData.set(EVENTS_KEY, { list: [] });

    for (const evt of list) {
      if (!evt || typeof evt !== "object") continue;
      if (evt.type === "wake_sms") {
        const roleId = String(evt.payload?.roleId || "").trim();
        const hint = evt.payload?.hint ? String(evt.payload.hint) : undefined;
        if (!roleId || !wakeHandler) continue;
        console.info(`[p3] 收到 wake_sms 事件 → 唤醒 ${roleId} 主动决策`);
        try {
          await wakeHandler(roleId, state, hint);
        } catch (e) {
          console.warn(`[p3] 唤醒 ${roleId} 失败:`, e);
        }
      }
      // 未来扩展：type === "achievement" / "offline_gain" ...
    }
  } catch {
    // 静默：宿主未就绪 / 会话已切走等；下一轮再试
  }
}