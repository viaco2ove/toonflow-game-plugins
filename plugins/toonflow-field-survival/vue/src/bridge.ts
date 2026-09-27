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

export function sendToHost(action: string, params: Record<string, unknown> = {}): void {
  const msg = { type: "tf_plugin_action", action, params };
  try {
    window.parent.postMessage(msg, "*");
    if (window.parent === window) {
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
 * 兜底：standalone 模式（window.parent === window）下 postMessage 不会触发自己的
 * message 事件；同时 dispatchEvent 把消息投递给同窗口的 mockHost，避免 start action 永远到不了。
 */
export function sendTick(action: string, params: Record<string, unknown> = {}): void {
  const msg = { type: "tf_plugin_tick", action, params };
  try {
    window.parent.postMessage(msg, "*");
    if (window.parent === window) {
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
    if (window.parent === window) {
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