/**
 * 插件 iframe ↔ 宿主通信桥
 *
 * 协议（window.postMessage）：
 *   iframe → 宿主: { type: "tf_plugin_action", action, params }
 *   宿主 → iframe: { type: "tf_plugin_state", state, actions, response }
 *
 * 兜底：宿主未监听时（本地直接打开 game.html 调试），
 *       走本地模拟模式，游戏仍可玩（演示用随机数推进）。
 */
import type { GameState, HandleResult } from "./types";

export type SendAction = (action: string, params?: Record<string, unknown>) => void;

interface HostState {
  state: GameState;
  actions?: string[];
  response?: string;
}

let hostReady = false;

/** 当前是否处于 --conn 拟真模式（true = 真实宿主模式，不走 dispatchEvent 兜底） */
function isConnMode(): boolean {
  // ★ 独立预览（地图编辑器 window.open ?__standalone=1）：强制 standalone，
  //   即便 dev-host 启动注入了 __CONN__="1" / VITE_CONN=1 也忽略——
  //   否则 sendTick 会走 window.parent.postMessage 抛 DataCloneError（每帧刷屏）。
  try {
    if (typeof location !== "undefined" && /[?&]__standalone(=1)?(&|$)/.test(location.search)) return false;
  } catch { /* ignore */ }
  try {
    const v = (import.meta as any).env?.VITE_CONN;
    if (v && v !== "0" && v !== "false" && v !== "") return true;
  } catch { /* ignore */ }
  try {
    if (typeof __CONN__ !== "undefined" && __CONN__ && __CONN__ !== "0" && __CONN__ !== "false") return true;
  } catch { /* ignore */ }
  return false;
}

export function sendToHost(action: string, params: Record<string, unknown> = {}): void {
  postSafely({ type: "tf_plugin_action", action, params });
}

/**
 * ★ 深拷贝成"可结构化克隆"的纯对象。
 *
 * 为什么需要：Vue 的响应式对象是 Proxy，而 **Proxy 不能被 postMessage 结构化克隆**
 * （DataCloneError: #<Object> could not be cloned）。一旦 payload 里混进 Proxy
 * （例如 ref 里的对象、`state.entities` 的嵌套字段被 `{...e}` 带出），postMessage 会抛错，
 * 旧代码在 catch 里只打了条 warn —— 整条 tick 被静默丢弃，表现为：
 *   宿主收不到 tick → 宿主侧 AI / 特效 life 衰减全停 →「野怪不动、技能特效留在原地不消失」。
 * 只在 postMessage 失败时降级调用一次，正常路径零开销。
 */
export function toCloneable(value: any, depth = 0): any {
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.map((v) => toCloneable(v, depth + 1));
  if (value instanceof Uint8Array || value instanceof Date) return value; // 结构化克隆原生支持
  const out: Record<string, any> = {};
  for (const k of Object.keys(value)) out[k] = toCloneable((value as any)[k], depth + 1);
  return out;
}

/**
 * 统一的 iframe → 宿主投递：standalone 走同窗口 dispatchEvent（不克隆），
 * --conn/真实宿主走 postMessage；后者失败时用 toCloneable 深拷贝重试一次。
 */
function postSafely(msg: Record<string, unknown>): void {
  try {
    // ★ standalone（无父窗口且非 --conn）：postMessage 只会投递给当前窗口，
    //   与 dispatchEvent 兜底重复投递同一条消息（mockHost/宿主收到两份，
    //   有状态命令如卖出/排序可能被重复执行）——此处二者取其一，只走 dispatchEvent。
    if (!isConnMode() && window.parent === window) {
      window.dispatchEvent(new MessageEvent("message", { data: msg }));
      return;
    }
    window.parent.postMessage(msg, "*");
  } catch (err) {
    try {
      const plain = { ...msg, params: toCloneable((msg as any).params ?? {}) };
      window.parent.postMessage(plain, "*");
      console.warn(
        "[bridge] 载荷含不可克隆值（多为 Vue 响应式 Proxy），已深拷贝后重发：",
        (msg as any).action,
      );
    } catch (err2) {
      console.warn("[bridge] postMessage 失败（深拷贝后仍不可克隆）：", (msg as any).action, err, err2);
    }
  }
}

/**
 * 实时推进：iframe 与后端不同源（iframe 在 :60002，宿主页面在 :5173），
 * 且拿不到宿主 JWT，所以不能直接 fetch /plugin/tick，
 * 必须让宿主代发：iframe → postMessage → 宿主 → HTTP → 回推新状态。
 *
 * 兜底：standalone 模式（window.parent === window 且非 --conn）下 postMessage 不会触发自己的
 * message 事件；同时 dispatchEvent 把消息投递给同窗口的 mockHost，避免 start action 永远到不了。
 * --conn 模式：宿主必须在另一个窗口（iframe 包装），绝对不能 dispatchEvent 自消费（否则会和宿主竞争）。
 */
export function sendTick(action: string, params: Record<string, unknown> = {}): void {
  // ★ 调试提示：tick 是每帧高频消息，console.log 会刷屏；只对非 tick 动作打日志
  if (action !== "tick") console.log("[bridge] sendTick →", action, "params keys =", params ? Object.keys(params) : []);
  // ★ 投递统一走 postSafely：payload 里混入 Vue 响应式 Proxy 时（曾导致"点击寻路后
  //   宿主收不到 tick → 野怪不动 / 特效不消失"），会深拷贝成纯对象自动重试一次。
  postSafely({ type: "tf_plugin_tick", action, params });
}

let loadedNotifyTimer: number | null = null;

export function notifyLoaded(): void {
  try {
    const msg = { type: "tf_plugin_loaded" };
    // ★ 竞态兜底：dev-host / 宿主的 message listener 可能比 iframe 更晚注册，
    //   首条 tf_plugin_loaded 会被静默丢弃（log 一直空、选人页永远不出现）。
    //   在收到首条宿主回包（hostReady）之前，每 500ms 重发一次，最多 40 次（20 秒）。
    if (loadedNotifyTimer !== null) return;
    let attempts = 0;
    const send = () => {
      if (hostReady || attempts >= 40) {
        if (loadedNotifyTimer !== null) {
          window.clearInterval(loadedNotifyTimer);
          loadedNotifyTimer = null;
        }
        return;
      }
      attempts++;
      if (!isConnMode() && window.parent === window) {
        window.dispatchEvent(new MessageEvent("message", { data: msg }));
        return;
      }
      window.parent.postMessage(msg, "*");
    };
    send();
    loadedNotifyTimer = window.setInterval(send, 500);
  } catch {
    /* ignore */
  }
}

export function onHostState(handler: (data: HostState) => void): () => void {
  const listener = (event: MessageEvent) => {
    const d = event?.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "tf_plugin_state" && d.state) {
      hostReady = true;
      // ★ 响应修复：宿主 postMessage 把 response 放在顶层 message 上（toonflow-game-web ScenePlay.vue:1647
      //   / vite.config.ts:311），state.value 收不到 → App.vue 行 501 的 watch(() => state.value?.response)
      //   永远拿不到值 → sysNotice 永远显示前端自己设的"正在刷新货源…"而看不到插件 response。
      //   把顶层 response 镜像到 state.response 上，watch 即能命中。
      const data: HostState = {
        state: typeof d.response === "string" && d.response
          ? { ...(d.state as any), response: d.response }
          : (d.state as GameState),
        actions: d.actions,
        response: d.response,
      };
      handler(data);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function isHostReady(): boolean {
  return hostReady;
}

/**
 * ★ game.md 对话功能：向宿主发送聊天台词，同步到 Toonflow-game-web 聊天框。
 * 宿主接收后写入 web 聊天记录（插件侧只负责渲染到聊天面板）。
 * 消息结构兼容 toonflow-game-app 的 chat-message 消费格式。
 */
export function sendChat(speaker: string, text: string, avatar?: string): void {
  try {
    if (!isConnMode() && window.parent === window) {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "tf_plugin_chat", speaker, text, avatar } }));
      return;
    }
    window.parent.postMessage({ type: "tf_plugin_chat", speaker, text, avatar }, "*");
  } catch {
    /* ignore */
  }
}