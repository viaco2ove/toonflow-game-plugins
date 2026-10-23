/**
 * toonflowJsApi — 前端插件 API（iframe 内）
 *
 * 按 req.md 设计：前端插件通过 toonflowJsApi 调用接口读取和设置数据变量。
 *  - pluginData：读写 t_plugin_session_data（宿主代发 /plugin/data，reqId 对账）
 *  - 其他能力可后续扩展（读故事动态数据快照等）
 *
 * 通道（与 tick 同模式）：iframe 与后端不同源且无 JWT，必须经宿主代理：
 *   iframe → postMessage {type:"tf_plugin_data", reqId, op, dataKey, value}
 *   宿主   → POST /plugin/data
 *   宿主   → postMessage {type:"tf_plugin_data_result", reqId, ok, value/keys/error}
 */

let reqSeq = 0;
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: number }>();

window.addEventListener("message", (event: MessageEvent) => {
  const d: any = event?.data;
  if (!d || typeof d !== "object" || d.type !== "tf_plugin_data_result") return;
  const p = pending.get(String(d.reqId || ""));
  if (!p) return;
  pending.delete(String(d.reqId));
  window.clearTimeout(p.timer);
  if (d.ok) p.resolve({ value: d.value ?? null, keys: d.keys ?? [], updatedAt: Number(d.updatedAt || 0) });
  else p.reject(new Error(String(d.error || "pluginData 失败")));
});

/**
 * postMessage 只能投递「可结构化克隆」的值；Vue 的响应式对象是 Proxy，
 * 直接投递会抛 DataCloneError（Failed to execute 'postMessage' ... could not be cloned），
 * 导致写回宿主的 player_card 永远为空。
 * 插件会话数据（t_plugin_session_data）本身要求是 JSON 可序列化结构，
 * 因此这里统一先做一次 JSON 深拷贝（顺带剥离 Proxy / 不可克隆字段）。
 */
function cloneForPost<T>(v: T): T {
  if (v === null || v === undefined || typeof v !== "object") return v;
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return v;
  }
}

function request(op: string, dataKey?: string, value?: unknown, timeoutMs = 10000, sessionId?: string): Promise<any> {
  const reqId = `jsapi_${Date.now()}_${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("pluginData 超时（宿主未响应）"));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    try {
      window.parent.postMessage({ type: "tf_plugin_data", reqId, op, dataKey, value: cloneForPost(value), sessionId }, "*");
    } catch (err) {
      pending.delete(reqId);
      window.clearTimeout(timer);
      reject(err);
    }
  });
}

export const toonflowJsApi = {
  /** 插件会话数据（t_plugin_session_data，维度 userId×sessionId×pluginId×dataKey） */
  pluginData: {
    /**
     * 读插件会话数据。
     * @param scope sessionId 维度；"all" = 跨会话共享（用户偏好类数据用这个）。
     *   缺省 = 由宿主按当前故事会话决定（真实宿主注入 entry.js 的 ctx.sessionId）。
     */
    get(dataKey: string, scope?: string): Promise<any> {
      return request("get", dataKey, undefined, 10000, scope).then((r) => r.value);
    },
    /**
     * ★ 读模板（sessionId="all" 跨会话共享）
     * CLI -u 写到 "map_visual:故事名" (sessionId="all")，前端用此方法拉
     */
    getTemplate(dataKey: string): Promise<any> {
      return request("get", dataKey, undefined, 10000, "all").then((r) => r.value);
    },
    /**
     * 写插件会话数据。
     * @param scope sessionId 维度；"all" = 跨会话共享（用户偏好类数据用这个）。
     */
    set(dataKey: string, value: unknown, scope?: string): Promise<void> {
      return request("set", dataKey, value, 10000, scope).then(() => undefined);
    },
    list(): Promise<string[]> {
      return request("list").then((r) => r.keys || []);
    },
    remove(dataKey: string): Promise<void> {
      return request("remove", dataKey).then(() => undefined);
    },
  },
  /**
   * 小游戏运行时 API（仅 minigame iframe 环境可用）
   *
   *  - done(result)：通知游戏结束，由宿主写入状态并触发后续
   *  - abort()    ：通知放弃当前游戏，不写结果
   *  - setFullscreen(enabled)：请求宿主把 play-plugin-minigame-panel 切换全屏
   *      底层：window.parent.postMessage({type:"tf_plugin_fullscreen", fullscreen: <bool>}, "*")
   *      宿主接收后给面板挂 .play-plugin-minigame-panel--fullscreen，
   *      CSS 把面板升级为 position:fixed; inset:0; z-index:9999 覆盖全屏。
   *      退出：再次调用 setFullscreen(false)，或用户点面板右上角 ✕。
   */
  minigame: {
    done(result?: unknown): void {
      try {
        window.parent.postMessage({type: "tf_plugin_action", kind: "done", result}, "*");
      } catch (e) {
        console.log("minigame ：e",e)
      }
    },
    abort(): void {
      try {
        window.parent.postMessage({type: "tf_plugin_action", kind: "abort"}, "*");
      } catch (e) {
         console.log("minigame ：e",e)
      }
    },
    setFullscreen(enabled: boolean): void {
      try {
        window.parent.postMessage({type: "tf_plugin_fullscreen", fullscreen: !!enabled}, "*");
      } catch (e) {
        console.log("setFullscreen ：e",e);
      }
    },
  },
};

export default toonflowJsApi;