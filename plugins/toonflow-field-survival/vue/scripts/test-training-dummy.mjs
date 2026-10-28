/**
 * 练习假人功能验证
 * 运行：node scripts/test-training-dummy.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
const vueScripts = join(pluginRoot, "vue/src/eventScripts");
const wsRoot = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

/* 1. 地图 JSON：假人属性 */
console.log("\n=== 地图 JSON 假人属性 ===");
const map = JSON.parse(readFileSync(join(wsRoot, "maps/mulberryTown.json"), "utf-8"));
const dummies = {};
for (const layer of map.layers || []) {
  for (const obj of layer.objects || []) {
    if ([251, 252, 253, 254].includes(obj.id)) {
      dummies[obj.id] = Object.fromEntries((obj.properties || []).map(p => [p.name, p.value]));
    }
  }
}
check("4 个假人都在地图里", Object.keys(dummies).length === 4, String(Object.keys(dummies)));
for (const id of [251, 252, 253, 254]) {
  const p = dummies[id] || {};
  check(`假人${id}：entity_type=SKELETON`, p.entity_type === "SKELETON");
  check(`假人${id}：camp=neutral`, p.camp === "neutral");
  check(`假人${id}：training_dummy=true`, p.training_dummy === true || p.training_dummy === "true");
  check(`假人${id}：dummy_mode 已配置`, p.dummy_mode === "stand" || p.dummy_mode === "duel", String(p.dummy_mode));
}
check("假人1 是站桩演示（stand）", dummies[251]?.dummy_mode === "stand");
check("假人2~4 是模拟实战（duel）", dummies[252]?.dummy_mode === "duel" && dummies[253]?.dummy_mode === "duel" && dummies[254]?.dummy_mode === "duel");
check("假人1 等级 10", dummies[251]?.level === 10);
check("假人2 等级 20", dummies[252]?.level === 20);
check("假人3 等级 30", dummies[253]?.level === 30);
check("假人4 等级 0（auto=玩家+5）", dummies[254]?.level === 0);

/* 2. 事件配置 */
console.log("\n=== 事件配置 ===");
const evf = JSON.parse(readFileSync(join(wsRoot, "events/maps/mulberryTown.events.json"), "utf-8"));
const dummyEvents = evf.events.filter(e => e.id.startsWith("E70_dummy"));
check("4 条假人事件（E70_dummy_1~4）", dummyEvents.length === 4, String(dummyEvents.length));
check("事件 uid 是 251~254", ["251","252","253","254"].every(u => dummyEvents.some(e => e.trigger.uid === u)));
check("4 条事件都指向 E70_training_dummy", dummyEvents.every(e => e.actions?.[0]?.script === "E70_training_dummy"));
check("都是 repeat 事件", dummyEvents.every(e => e.repeat === true));

/* 3. 脚本逻辑 */
console.log("\n=== 假人事件脚本 ===");
const script = readFileSync(join(vueScripts, "E70_training_dummy.ts"), "utf-8");
check("用 select 弹模式菜单", script.includes("ctx.ui.select"));
check("含「站桩模式」选项", script.includes("站桩模式"));
check("含「模拟实战」选项", script.includes("模拟实战"));
check("站桩：阵营变敌对（setField）", script.includes(`side: "enemy"`));
check("站桩：挂回血计时器", script.includes("setInterval") && script.includes("standTimers"));
check("站桩：结束恢复中立（setField）", script.includes(`side: "neutral"`));
check("站桩：不奖励经验（未调 sys_dummy_reward）", !script.split("startStandMode")[1]?.split("startDuelMode")[0].includes("sys_dummy_reward"));
check("实战：写 destroyed flag 轮询", script.includes("dummy_destroyed_"));
check("实战：击碎发经验（sys_dummy_reward）", script.includes("sys_dummy_reward"));
check("实战：经验 = 10 + lv×6", script.includes("10 + dummy.level * 6"));
check("实战：玩家逃跑复位", script.includes("fleeCheck"));
check("找假人：探测 4 个 uid", script.includes('["251", "252", "253", "254"]'));
check("找假人：2.5m 内最近", script.includes("bestDist = 3.0") || script.includes("bestDist"));

/* 4. 引擎/后端支撑 */
console.log("\n=== 引擎与后端支撑 ===");
const mapCfg = readFileSync(join(pluginRoot, "vue/src/mapConfig.ts"), "utf-8");
check("mapConfig 有 isTrainingDummy()", mapCfg.includes("function isTrainingDummy"));
check("mobs 分支特批假人", mapCfg.includes("isTrainingDummy(props)"));
check("MapMob 有 trainingDummy 字段", mapCfg.includes("trainingDummy?: boolean"));
check("MapMob 有 dummyMode 字段", mapCfg.includes("dummyMode?: string"));

const appVue = readFileSync(join(pluginRoot, "vue/src/App.vue"), "utf-8");
check("App.vue：neutral camp → side=neutral", appVue.includes('camp === "neutral" ? "neutral"'));
check("App.vue：假人4 auto 等级=玩家+5", appVue.includes("playerLv + 5"));
check("App.vue：实体透传 trainingDummy", appVue.includes("trainingDummy: mob.trainingDummy"));
check("App.vue：点击攻击认假人", appVue.includes('(e as any).trainingDummy === true'));

const entry = readFileSync(join(pluginRoot, "entry.ts"), "utf-8");
check("entry.ts：attack 认假人目标", entry.includes("(e as any).trainingDummy === true"));
check("entry.ts：damage() 假人特判", entry.includes("trainingDummy === true"));
check("entry.ts：假人不给经验（独立分支）", entry.includes("散架了"));
check("entry.ts：实战击碎写 flag", entry.includes("dummy_destroyed_"));
check("entry.ts：sys_dummy_reward 已实现", entry.includes('case "sys_dummy_reward"'));

/* 4b. ★ 假人打不动 / 假人不攻击（宿主侧 + 合并策略） */
console.log("\n=== ★ 假人掉血与反击（2026-10-28 修） ===");
// ★ 坑1：宿主重建实体走 makeEntity（只认固定字段）→ trainingDummy/dummyMode 全丢
//   → damage() 的 `target.trainingDummy === true` 永不成立 → 击碎不写 flag（没经验）
check("entry.ts：重建实体时透传 trainingDummy", /ex\.trainingDummy = true/.test(entry));
check("entry.ts：重建实体时透传 dummyMode", /ex\.dummyMode = str\(\(raw as any\)\.dummyMode/.test(entry));
// ★ 坑2：站桩模式假人也会扑上来打玩家（宿主 AI 不认 dummyMode）
check("entry.ts：站桩模式不追击不攻击", /trainingDummy === true && String\(ex\.dummyMode \|\| ""\) === "stand"/.test(entry));
check("entry.ts：站桩分支清速度并置 idle", /ex\.aiState = "idle";\s*return;/.test(entry));
// ★ 坑3：假人是「客户端权威实体」→ 无脑覆盖把宿主的 hp 改回满血 → 看不到掉血
check("App.vue：假人 hp/alive 以宿主为准", /hostDummyStates/.test(appVue) && /hp: hostSame\.hp/.test(appVue));
check("App.vue：先取宿主假人快照再剔除", /hostDummyStates[\s\S]{0,400}incomingClientIds\.size/.test(appVue));
check("App.vue：side/dummyMode 仍以客户端为准（未被覆盖）",
  /hp: hostSame\.hp[\s\S]{0,200}alive: hostSame\.alive/.test(appVue) &&
  !/hp: hostSame\.hp[\s\S]{0,300}side: hostSame\.side/.test(appVue));
check("App.vue：伤害只在宿主结算（前端无本地伤害）",
  !/ent\.hp = Math\.max\(0, ent\.hp -/.test(appVue) && !/e\.hp = Math\.max\(0, e\.hp -/.test(appVue));
check("App.vue：假人仍可被点击攻击", appVue.includes('(e as any).trainingDummy === true'));

/* 4c. ★ 用 ctx.event.uid 定位目标假人（不再猜） */
console.log("\n=== ★ ctx.event.uid 定位目标（2026-10-28 改） ===");
const e70 = readFileSync(join(pluginRoot, "vue/src/eventScripts/E70_training_dummy.ts"), "utf-8");
check("有 findTriggeredDummy（ctx.event.uid 主路径）", e70.includes("function findTriggeredDummy("));
check("findTriggeredDummy 读 ctx.event.uid", /ctx\.event\?\.uid/.test(e70));
check("主路径用 findTriggeredDummy", /findTriggeredDummy\(ctx\) \|\| findNearbyDummy\(ctx\)/.test(e70));
check("ctx.event.uid 为空时退回兜底", e70.includes("findNearbyDummy(ctx)"));
check("兜底仍保留（uid 为空场景）", e70.includes('const uids = ["251", "252", "253", "254"]'));
check("兜底注释说明已非主路径", e70.includes("只在 ctx.event.uid 为空时用"));
check("不再注释「脚本本身拿不到 uid」", !e70.includes("脚本本身拿不到 uid"));
check("不再注释「用 ctx.npc.byUid 不可行」", !e70.includes("用 ctx.npc.byUid 不可行"));
check("统一 DummyRef 类型", e70.includes("type DummyRef = {") && e70.includes("dummy: DummyRef"));
check("DummyRef 被两处模式函数使用", (e70.match(/dummy: DummyRef/g) || []).length >= 2);
// 引擎侧：run_script 必须透传 trigger.uid
const engine = readFileSync(join(pluginRoot, "vue/src/eventEngine.ts"), "utf-8");
check("引擎 run_script 透传 trigger.uid", /uid: \(ev\.trigger as any\)\?\.uid != null \? String\(\(ev\.trigger as any\)\.uid\) : undefined/.test(engine));
check("引擎有 EventCtxInfo.uid 字段", /export interface EventCtxInfo[\s\S]{0,200}uid\?: string/.test(engine));
check("makeCtx 填充 event.uid", /event: \{ id: info\.id, uid: info\.uid, args: info\.args \|\| \{\} \}/.test(engine));
// 事件配置：4 条 proximity 事件都带 uid（uid 是 ctx.event.uid 的来源）
try {
  const evJson = JSON.parse(readFileSync(join(wsRoot, "events/maps/mulberryTown.events.json"), "utf-8"));
  const dummyEvents = (evJson.events || []).filter((e) => e.id && String(e.id).startsWith("E70_dummy"));
  check("4 条假人事件都存在", dummyEvents.length === 4, String(dummyEvents.length));
  check("假人事件都用 proximity 触发", dummyEvents.every((e) => e.trigger?.type === "proximity"));
  check("假人事件都带 trigger.uid（ctx.event.uid 的来源）",
    dummyEvents.every((e) => e.trigger?.uid != null && String(e.trigger.uid) !== ""),
    dummyEvents.map((e) => e.trigger?.uid).join("/"));
  check("假人事件都指向同一脚本", dummyEvents.every((e) =>
    (e.actions || []).some((a) => a.type === "run_script" && a.script === "E70_training_dummy")));
} catch (err) { check("假人事件配置可读", false, String(err)); }

/* 5. workshops 同步 */
console.log("\n=== workshops 同步 ===");
try {
  const wsScript = readFileSync(join(wsRoot, "events/scripts/E70_training_dummy.ts"), "utf-8");
  check("E70_training_dummy.ts 已同步", wsScript.length > 1000);
  check("workshops 版 import 指向 shared/_ctx", wsScript.includes('from "../shared/_ctx"'));
} catch { check("E70_training_dummy.ts 已同步", false); }

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);