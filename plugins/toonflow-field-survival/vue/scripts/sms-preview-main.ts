/**
 * scripts/sms-preview-main.ts — 通信面板可视化预览页
 * ============================================================
 * 目的：在浏览器里渲染**真实的** SmsPanel.vue / SmsConversationList.vue，
 *   验证落地形态（内嵌 tab、左右布局、配色、角标）是否与设计一致。
 *
 * 用法：npm run dev 后访问 /scripts/sms-preview.html
 *   （vite 会把 scripts/ 下的 html 当作多页入口之一）
 */
import { createApp, h, reactive } from "vue";
import SmsPanel from "../src/sms/SmsPanel.vue";
import type { Conversation } from "../src/sms/types";

/* ---------------- 构造样例数据 ---------------- */
const now = Date.now();
const MIN = 60 * 1000;

function mkConv(partial: Partial<Conversation> & { id: string; name: string }): Conversation {
  return {
    id: partial.id,
    type: partial.type || "private",
    name: partial.name,
    members: partial.members || [],
    messages: partial.messages || [],
    lastReadMsgId: partial.lastReadMsgId ?? null,
    createdAt: partial.createdAt || now - 3600_000,
    updatedAt: partial.updatedAt || now,
    awaitingReply: partial.awaitingReply,
  };
}

const convs = reactive<Conversation[]>([
  mkConv({
    id: "c_xiaozhong",
    name: "萧肿",
    members: ["npc_xiaozhong"],
    updatedAt: now - 2 * MIN,
    lastReadMsgId: "m1",
    messages: [
      { id: "m1", conversationId: "c_xiaozhong", from: "npc_xiaozhong", fromName: "萧肿", text: "好的，我去东边药圃采药了，有事喊我。", timestamp: now - 30 * MIN, type: "text" },
      { id: "m2", conversationId: "c_xiaozhong", from: "player", fromName: "我", text: "小心点，别碰到哥布林", timestamp: now - 25 * MIN, type: "text" },
      { id: "m3", conversationId: "c_xiaozhong", from: "npc_xiaozhong", fromName: "萧肿", text: "放心，我绕着走。对了，前面林子里好像有动静。", timestamp: now - 20 * MIN, type: "text" },
      { id: "m4", conversationId: "c_xiaozhong", from: "player", fromName: "我", text: "药圃在哪？", timestamp: now - 5 * MIN, type: "text" },
      { id: "m5", conversationId: "c_xiaozhong", from: "npc_xiaozhong", fromName: "萧肿", text: "往东走第三个田埂，靠近那棵老槐树。", timestamp: now - 2 * MIN, type: "text" },
    ],
  }),
  mkConv({
    id: "c_group",
    name: "林家护卫团",
    type: "group",
    members: ["npc_xiaozhong", "npc_chen", "npc_lu"],
    updatedAt: now - 8 * MIN,
    lastReadMsgId: "g1",
    messages: [
      { id: "g1", conversationId: "c_group", from: "system", fromName: "系统", text: "萧肿 加入了群聊", timestamp: now - 60 * MIN, type: "system" },
      { id: "g2", conversationId: "c_group", from: "player", fromName: "我", text: "大家小心", timestamp: now - 12 * MIN, type: "text" },
      { id: "g3", conversationId: "c_group", from: "npc_chen", fromName: "陈南璇", text: "前面有哥布林，小心", timestamp: now - 10 * MIN, type: "text" },
      { id: "g4", conversationId: "c_group", from: "npc_lu", fromName: "陆文昭", text: "我断后", timestamp: now - 8 * MIN, type: "text" },
    ],
  }),
  mkConv({
    id: "c_lu",
    name: "陆文昭",
    members: ["npc_lu"],
    updatedAt: now - 26 * 3600_000,
    messages: [
      { id: "l1", conversationId: "c_lu", from: "npc_lu", fromName: "陆文昭", text: "师弟，药圃那边我采完了", timestamp: now - 26 * 3600_000, type: "text" },
    ],
  }),
  mkConv({
    id: "c_smith",
    name: "铁匠王师傅",
    members: ["npc_smith"],
    updatedAt: now - 3 * 86400_000,
    messages: [
      { id: "s1", conversationId: "c_smith", from: "npc_smith", fromName: "铁匠王师傅", text: "你要的剑打好了，来取吧", timestamp: now - 3 * 86400_000, type: "text" },
    ],
  }),
]);

const contacts = [
  { id: "npc_xiaozhong", name: "萧肿", managed: true },
  { id: "npc_chen", name: "陈南璇", managed: true },
  { id: "npc_lu", name: "陆文昭", managed: true },
  { id: "npc_smith", name: "铁匠王师傅", managed: false },
  { id: "npc_zhang", name: "张屠户", managed: false },
  { id: "npc_qin", name: "秦管事", managed: false },
];

/** ★ 空态预览开关（对应用户截图：还没有任何会话） */
const emptyMode = reactive({ v: false });

const activeId = reactive({ v: "c_xiaozhong" });

/** 预览模式：模拟「点角色发起单聊」 */
function startPrivateChat(roleId: string): void {
  const contact = contacts.find((c) => c.id === roleId);
  const name = contact?.name || roleId;
  let conv = convs.find((c) => c.type === "private" && c.members.includes(roleId));
  if (!conv) {
    conv = mkConv({
      id: "c_new_" + roleId,
      name,
      members: [roleId],
      updatedAt: Date.now(),
    });
    convs.unshift(conv);
  }
  activeId.v = conv.id;
}

/* ---------------- 页面骨架（模拟 SystemPanel 的 .sp-body） ---------------- */
const Root = {
  setup() {
    return () =>
      h("div", { class: "sp" }, [
        h("div", { class: "sp-head" }, [
          h("span", { class: "sp-title" }, "系统v3.1 · 青云子"),
          h("span", { class: "sp-gold" }, "💰 1280"),
          h("span", { class: "sp-map" }, "青竹坡"),
        ]),
          h("div", { class: "sp-tabs" }, [
          h("button", { class: "sp-tab sp-tab--on" }, [
            h("span", { class: "sp-tab__icon" }, "💬"),
            "通信",
            emptyMode.v ? null : h("span", { class: "sp-tab__badge" }, "5"),
          ]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "🎒"), "背包"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "💍"), "纳戒"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "🏪"), "商城"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "✨"), "技能"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "🗺"), "地图"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "👥"), "角色"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "⚡"), "事件"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "📜"), "任务"]),
          h("button", { class: "sp-tab" }, [h("span", { class: "sp-tab__icon" }, "🤖"), "AI"]),
        ]),
        h("div", { class: "sp-body sp-body--flush" }, [
          h(SmsPanel, {
            conversations: emptyMode.v ? [] : convs,
            activeId: emptyMode.v ? "" : activeId.v,
            contacts,
            onSelect: (id: string) => { activeId.v = id; },
            onStartChat: (roleId: string) => { startPrivateChat(roleId); },
            onSend: (id: string, text: string) => {
              convs.find((c) => c.id === id)?.messages.push({
                id: "new_" + Math.random().toString(36).slice(2),
                conversationId: id, from: "player", fromName: "我",
                text, timestamp: Date.now(), type: "text",
              });
            },
          }),
        ]),
        h("div", { class: "sp-foot" }, [
          "通信：5 条未读 · 存储于 t_plugin_session_data（sms_conversations:青竹坡）",
          h("button", {
            class: "toggle-empty",
            onClick: () => { emptyMode.v = !emptyMode.v; },
          }, emptyMode.v ? "切回有会话" : "切到空态"),
        ]),
      ]);
  },
};

const app = createApp(Root);
app.mount("#app");

/* ---------------- 页面样式（复制 SystemPanel.vue 的 .sp 相关规则） ---------------- */
const style = document.createElement("style");
style.textContent = `
#app { height: 100vh; }
.sp { display:flex; flex-direction:column; height:100vh; color:#e8eef5; font-size:13px;
  background:#1e1f1f; border:2px solid #4f4f4f; }
.sp-head { position:relative; display:flex; align-items:center; gap:8px; padding:8px 44px 8px 10px;
  background:rgba(255,255,255,0.06); cursor:move; user-select:none; }
.sp-title { font-weight:700; }
.sp-gold { margin-left:auto; color:#ffd76a; }
.sp-map { color:#9fd0ff; }
.sp-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.08); }
.sp-tab { position:relative; flex:1 1 30%; padding:6px 4px; border-radius:6px; border:1px solid rgba(255,255,255,0.12);
  background:rgba(255,255,255,0.04); color:#cfd8e3; cursor:pointer; font-size:12px; }
.sp-tab--on { background:#2f6fd0; border-color:#5a9bff; color:#fff; }
.sp-tab__icon { margin-right:3px; }
.sp-tab__badge { position:absolute; top:-5px; right:-3px; min-width:16px; height:16px; padding:0 4px;
  border-radius:8px; background:#e04a4a; color:#fff; font-size:10px; line-height:16px; text-align:center; }
.sp-body { flex:1 1 auto; overflow:auto; padding:8px; }
.sp-body--flush { overflow:hidden; padding:6px; }
.sp-foot { padding:6px 10px; border-top:1px solid rgba(255,255,255,0.08); color:#93a2b3; font-size:11px; min-height:24px;
  display:flex; align-items:center; gap:10px; }
.toggle-empty { margin-left:auto; background:rgba(47,111,208,.2); border:1px solid rgba(47,111,208,.55);
  color:#9fc4ff; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-family:inherit; }
`;
document.head.appendChild(style);
