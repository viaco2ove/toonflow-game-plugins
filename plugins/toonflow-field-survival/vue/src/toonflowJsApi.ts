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

function request(op: string, dataKey?: string, value?: unknown, timeoutMs = 10000): Promise<any> {
  const reqId = `jsapi_${Date.now()}_${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("pluginData 超时（宿主未响应）"));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    try {
      window.parent.postMessage({ type: "tf_plugin_data", reqId, op, dataKey, value }, "*");
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
    get(dataKey: string): Promise<any> {
      return request("get", dataKey).then((r) => r.value);
    },
    set(dataKey: string, value: unknown): Promise<void> {
      return request("set", dataKey, value).then(() => undefined);
    },
    list(): Promise<string[]> {
      return request("list").then((r) => r.keys || []);
    },
    remove(dataKey: string): Promise<void> {
      return request("remove", dataKey).then(() => undefined);
    },
  },
};

export default toonflowJsApi;