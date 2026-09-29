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
  const msg = { type: "tf_plugin_action", action, params };
  try {
    window.parent.postMessage(msg, "*");
    // 非 conn 模式（本地 standalone）+ 无父窗口 → 自己消费
    if (!isConnMode() && window.parent === window) {
      window.dispatchEvent(new MessageEvent("message", { data: msg }));
    }
  } catch {
    /* ignore */
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
  const msg = { type: "tf_plugin_tick", action, params };
  try {
    window.parent.postMessage(msg, "*");
    if (!isConnMode() && window.parent === window) {
      window.dispatchEvent(new MessageEvent("message", { data: msg }));
    }
  } catch {
    /* ignore */
  }
}

export function notifyLoaded(): void {
  try {
    const msg = { type: "tf_plugin_loaded" };
    window.parent.postMessage(msg, "*");
    if (!isConnMode() && window.parent === window) {
      window.dispatchEvent(new MessageEvent("message", { data: msg }));
    }
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
      handler(d as HostState);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function isHostReady(): boolean {
  return hostReady;
}