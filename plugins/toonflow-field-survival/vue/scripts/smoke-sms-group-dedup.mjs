/**
 * smoke-sms-group-dedup.mjs — 群聊去重/复用逻辑单测（2026-11-02）
 * ==============================================
 * 背景：用户建「宗门」群后列表冒出一堆同名群 ——
 *   ① createGroupConversation 无同成员合并（双击提交/重放 → N 个同 members 群）
 *   ② load 归并只处理单聊同名，群聊脏数据永远留着
 *   ③ mergeLegacyDuplicatePrivates 里 sort((a,b)=>a.ts-b.ts) 字段名错
 *      （应为 timestamp），排序静默失效
 *
 * 覆盖：
 *   1. 同成员集合再建群 → 复用同一个会话（不新增）
 *   2. 成员顺序不同但集合相同 → 仍复用
 *   3. 不同成员 → 正常新建
 *   4. load 阶段：5 个同成员重复群 → 归并为 1 个，消息并集、按 timestamp 升序
 *   5. 单聊同名归并回归（原功能不破）
 *   6. 名字顺带采纳：同成员群用新名再"建"一次 → 改名不新建
 *
 * 用法：node scripts/smoke-sms-group-dedup.mjs
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`✅ ${name}${detail ? " — " + detail : ""}`); pass++; }
  else { console.log(`❌ ${name}${detail ? " — " + detail : ""}`); fail++; }
}

/* ---------- mock 浏览器环境（store.ts 依赖 window/toonflowJsApi） ---------- */
// ★ 落库介质：模拟 t_plugin_session_data（key = `${scope}:${dataKey}`）
const savedWrites = new Map();

// ★ bundle 把 toonflowJsApi.ts 一起打了进去 —— mock 必须补齐它的真实依赖链：
//   request() → window.parent.postMessage({type:"tf_plugin_data",reqId,...})
//   响应走 window message 事件 {type:"tf_plugin_data_result",reqId,ok,value...}
//   postMessage 直接同步完成"宿主代发 /plugin/data"的往返。
globalThis.MessageEvent = class MessageEvent {
  constructor(type, init) { this.type = type; this.data = init?.data; }
};
globalThis.window = {
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms ?? 0, 5)), // 防抖压到 5ms
  clearTimeout: (id) => clearTimeout(id),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent(ev) {
    // 派发给 jsapi 注册的 message listener（bundle 内 addEventListener 是 no-op，
    // 这里手动桥不到内部闭包 → 换直连方案：见下方 window.parent.postMessage）
    return true;
  },
  parent: {
    postMessage(msg) {
      if (msg?.type !== "tf_plugin_data") return;
      const key = `${msg.sessionId || "cur"}:${msg.dataKey}`;
      let value = null;
      if (msg.op === "get") value = savedWrites.get(key) ?? null;
      else if (msg.op === "set") savedWrites.set(key, msg.value ? JSON.parse(JSON.stringify(msg.value)) : null);
      // 异步回包（模拟 postMessage 往返）
      setTimeout(() => {
        try { onPluginDataResult({ type: "tf_plugin_data_result", reqId: msg.reqId, ok: true, value }); }
        catch { /* listener 未注册时忽略 */ }
      }, 0);
    },
  },
};
// jsapi 的 message listener 注册在模块加载时执行 —— bundle 无法桥接闭包，
// 改用后门：store.ts 的 request() 挂在 window.addEventListener 上，我们捕获它
const messageListeners = [];
const origWindowDef = globalThis.window;
globalThis.window = new Proxy(origWindowDef, {
  get(t, k) {
    if (k === "addEventListener") {
      return (type, fn) => { if (type === "message") messageListeners.push(fn); };
    }
    return t[k];
  },
});
function onPluginDataResult(data) {
  for (const fn of messageListeners) fn({ data });
}
globalThis.document = {
  hidden: false,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};

/* ---------- esbuild 编译 store.ts ---------- */
const tmp = mkdtempSync(resolve(tmpdir(), "smsdedup-"));
const esbuild = resolve(__dirname, "..", "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
const outFile = resolve(tmp, "store.mjs");
try {
  // ★ --bundle：把 vue 的 ref/shallowRef 一起打进单文件，node 才能解析
  execFileSync(esbuild, [resolve(__dirname, "..", "src", "sms", "store.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${outFile}`, "--external:puppeteer", "--external:electron"], { stdio: "pipe" });
} catch (e) {
  console.error("✗ esbuild 编译 store.ts 失败:");
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}
const store = await import("file://" + outFile.replace(/\\/g, "/"));
const {
  load, createGroupConversation, startPrivateChat,
  receiveFromAI, debugSms, listConversations,
} = store;

/** 便捷：当前会话列表 */
const convs = () => listConversations();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 同成员再建群 → 复用 ---------- */
await load("测试故事A");
const g1 = createGroupConversation("宗门", ["npc_a", "npc_b", "npc_c"], { npc_a: "墨老" });
const g2 = createGroupConversation("宗门", ["npc_a", "npc_b", "npc_c"], {});
check("同成员再建群 → 复用同一会话", g1.id === g2.id, `id=${g1.id}`);
check("复用后列表仍只有 1 个群", convs().filter(c => c.type === "group").length === 1);

/* ---------- 2. 成员顺序不同 → 仍复用 ---------- */
const g3 = createGroupConversation("宗门", ["npc_c", "npc_a", "npc_b"], {});
check("成员顺序不同但集合相同 → 复用", g3.id === g1.id);

/* ---------- 3. 名字顺带采纳 ---------- */
const g4 = createGroupConversation("大罗宗", ["npc_a", "npc_b", "npc_c"], {});
check("同成员用新名再建 → 改名不新建", g4.id === g1.id && g1.name === "大罗宗", g1.name);

/* ---------- 4. 不同成员 → 新建 ---------- */
const g5 = createGroupConversation("别派", ["npc_d", "npc_e"], {});
check("不同成员 → 正常新建", g5.id !== g1.id);

/* ---------- 5. load 归并：5 个同成员重复群 → 1 个 ---------- */
// 直接往"宿主"塞一份带 5 个重复宗门群的脏存档，再 load
const dirty = {
  version: 1,
  conversations: [
    { id: "c_x1", type: "group", name: "宗门", members: ["npc_a", "npc_b"], createdAt: 1000, updatedAt: 1000,
      messages: [{ id: "m1", from: "npc_a", fromName: "墨老", text: "没啥好事，就是突然想到…", timestamp: 1000 }] },
    { id: "c_x2", type: "group", name: "宗门", members: ["npc_b", "npc_a"], createdAt: 2000, updatedAt: 2000,
      messages: [{ id: "m2", from: "npc_a", fromName: "墨老", text: "没啥好事，就是突然想到…", timestamp: 2000 }] },
    { id: "c_x3", type: "group", name: "宗门", members: ["npc_a", "npc_b"], createdAt: 3000, updatedAt: 3000,
      messages: [{ id: "m3", from: "npc_a", fromName: "墨老", text: "没啥好事，就是突然想到…", timestamp: 3000 }] },
    { id: "c_x4", type: "group", name: "宗门", members: ["npc_a", "npc_b"], createdAt: 4000, updatedAt: 4000,
      messages: [{ id: "m4", from: "npc_a", fromName: "墨老", text: "没啥好事，就是突然想到…", timestamp: 4000 }] },
    { id: "c_x5", type: "group", name: "宗门", members: ["npc_a", "npc_b"], createdAt: 5000, updatedAt: 5000,
      messages: [{ id: "m5", from: "npc_a", fromName: "墨老", text: "没啥好事，就是突然想到…", timestamp: 5000 }] },
    // 单聊对照组：不应被误归并
    { id: "c_p1", type: "private", name: "陈南璇", members: ["player", "陈南璇"], createdAt: 6000, updatedAt: 6000,
      messages: [{ id: "m6", from: "陈南璇", fromName: "陈南璇", text: "你好", timestamp: 6000 }] },
  ],
};
await savedWrites.set("all:sms_conversations:脏存档故事", dirty);
await load("脏存档故事");
const sectGroups = convs().filter(c => c.type === "group" && c.name === "宗门");
check("5 个同成员重复群 → 归并为 1 个", sectGroups.length === 1, `剩 ${sectGroups.length}`);
check("归并后消息并集 = 5 条", sectGroups[0]?.messages.length === 5, `${sectGroups[0]?.messages.length} 条`);
const tsOrder = sectGroups[0]?.messages.map(m => m.timestamp) ?? [];
check("消息按 timestamp 升序（ts 字段修复）", tsOrder.every((t, i) => i === 0 || t > tsOrder[i - 1]), tsOrder.join(","));
check("单聊对照组不被误归并", convs().filter(c => c.type === "private" && c.name === "陈南璇").length === 1);
await sleep(20); // 等防抖落库
const saved = savedWrites.get("all:sms_conversations:脏存档故事");
check("归并结果已落库（5 会话）", saved?.conversations?.length === 2, `落库 ${saved?.conversations?.length} 个`);

/* ---------- 6. 单聊同名归并回归 ---------- */
savedWrites.set("all:sms_conversations:回归故事", {
  version: 1,
  conversations: [
    { id: "c_a", type: "private", name: "墨老", members: ["player", "墨老"], createdAt: 1, updatedAt: 1,
      messages: [{ id: "mm1", from: "墨老", fromName: "墨老", text: "A", timestamp: 1 }, { id: "mm2", from: "墨老", fromName: "墨老", text: "B", timestamp: 2 }] },
    { id: "c_b", type: "private", name: "墨老", members: ["player", "墨老"], createdAt: 2, updatedAt: 2,
      messages: [{ id: "mm3", from: "墨老", fromName: "墨老", text: "C", timestamp: 3 }] },
  ],
});
await load("回归故事");
const dupPrivates = convs().filter(c => c.type === "private" && c.name === "墨老");
check("单聊同名归并（回归）→ 1 个", dupPrivates.length === 1);
check("消息并集 3 条", dupPrivates[0]?.messages.length === 3, `${dupPrivates[0]?.messages.length}`);

/* ---------- 汇总 ---------- */
console.log(`\n${pass} passed, ${fail} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);