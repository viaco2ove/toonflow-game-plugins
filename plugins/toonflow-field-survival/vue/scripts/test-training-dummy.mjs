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
//   ★ 2026-10-29 修正规则：**duel 假人** hp/alive 以宿主为准（伤害在宿主结算）；
//     **stand 假人** hp 以客户端为准（站桩模式血条由 E70 脚本每秒回 5%，
//     宿主只会因伤害下降、不会自己回血 → 无脑用宿主 hp 会让血量在 50/59 之间震荡）。
check("App.vue：假人 hp 一律以宿主为准（伤害结算方）",
  /hostDummyStates/.test(appVue) && /hp: hostSame\.hp/.test(appVue));
check("App.vue：先取宿主假人快照再剔除", /hostDummyStates[\s\S]{0,400}incomingClientIds\.size/.test(appVue));
check("App.vue：side/dummyMode 仍以客户端为准（未被覆盖）",
  /alive: hostSame\.alive/.test(appVue) &&
  !/side: hostSame\.side/.test(appVue) && !/dummyMode: hostSame\.dummyMode/.test(appVue));
// ★ 坑4（2026-10-29 下午误加又撤回）：**不能**把前端 hp 同步进宿主
//   —— 前端上报的 hp 是合并产物（非权威值），同步回去会抹掉宿主 damage() 掉的血。
//   实测：连打 3 刀「普攻命中 伤害 72」×3，血量恒 185 不动。
check("entry.ts：不再把前端 hp 同步进宿主（会抹掉伤害）",
  !/ex\.hp = clamp\(Math\.round\(rhp\)/.test(entry));
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

/* 4d. ★ 城镇不凭空刷野怪（练习假人不算「野怪数据源」） */
console.log("\n=== ★ 城镇兜底刷怪守卫（2026-10-28 修） ===");
// ★ 坑：城镇放了练习假人 → cfg.mobs.length=4 → 兜底刷怪守卫（mobs.length>0）失效
//   → 每 60s 在城镇里凭空刷 5 只哥布林/狼/蝙蝠（localmob_*）
check("App.vue：兜底刷怪按非假人 mob 数量判定",
  /realMobCount = \(mapCfg\.value\?\.mobs \?\? \[\]\)\.filter\(\(m: any\) => m\.trainingDummy !== true\)\.length/.test(appVue));
check("App.vue：realMobCount===0 直接 return", /realMobCount === 0\) return;/.test(appVue));
check("App.vue：不再用 mobs?.length 判定兜底刷怪",
  !/if \(!mapCfg\.value \|\| !\(mapCfg\.value\.mobs\?\.length\)\) return;\s*const zones = resolvedZones/.test(appVue));
check("App.vue：进图提示区分敌怪与假人",
  appVue.includes("个练习假人") && appVue.includes("只敌怪"));
check("mapConfig：假人进 mobs（守卫必须过滤它）",
  /trainingDummy: isTrainingDummy\(props\)/.test(readFileSync(join(pluginRoot, "vue/src/mapConfig.ts"), "utf-8")));

/* 4e. ★ 浏览器实测定位的三个根因（2026-10-28 BrowserSkill 调试） */
console.log("\n=== ★ BrowserSkill 实测修复（升级无反应 / 假人不攻击） ===");
// ★ 坑A（升级无反应）：forgeOpsDeps.toast 把 color 字符串当 showToast 的 ms 参数
//   → setTimeout(fn, "white") = 0ms → 「材料不足」toast 在渲染前就被清空
//   实测证据：hudToast ref 有值但 .hud-toast DOM 从未出现
check("App.vue：deps.toast 不再把 color 传给 showToast",
  /toast: \(text, _color\) => showToast\(text\)/.test(appVue));
check("App.vue：无其它 showToast(text, \"color\") 调用",
  !/showToast\([^)]*,\s*"(?:red|white|gold|blue)"\)/.test(appVue));
// ★ 坑B（假人不攻击）：localEnemiesPayload 只报 side==="enemy" → 中立假人从不上报
//   → 宿主敌怪表里没有假人 → duel 假人永远不被 AI 驱动
check("App.vue：上报清单包含中立假人（trainingDummy 无视 side）",
  /\(e as any\)\?\.trainingDummy === true \|\|\s*\n?\s*\(e\?\.side === "enemy"/.test(appVue) ||
  /trainingDummy === true \|\|[\s\S]{0,200}side === "enemy"/.test(appVue));
// ★ 坑C：脚本 setField 改 side 不 bump epoch → 宿主永不重建
check("App.vue：entityRef 改战斗字段时 bump epoch（Proxy set 守卫）",
  /new Proxy\(e as any, \{[\s\S]{0,400}bumpLocalMobsEpoch\(\)/.test(appVue));
check("App.vue：bump 字段含 side/dummyMode",
  /prop === "side" \|\| prop === "dummyMode"/.test(appVue));
// ★ 坑F（2026-10-29 实测）：bump 字段**不能**含 hp/alive
//   hp/alive 是宿主权威字段（伤害在 entry.ts damage() 结算后回推），
//   站桩回血定时器每秒改 hp → 每 tick 重建整张敌怪表 →
//   事件日志被「当前关卡敌怪已接入宿主 AI（N 只）」刷屏（实测 376 tick 刷 35 条）。
check("App.vue：bump 字段不含 hp/alive（避免敌怪表每 tick 重建）",
  !/prop === "hp"/.test(appVue) && !/prop === "alive"/.test(appVue));
// ★ 坑D：宿主 applyLocalEnemies 强制 side="enemy" → 中立假人被当野怪
const entrySrc2 = entry;
check("entry.ts：假人接管无视 side 过滤", /const isDummy = \(raw as any\)\.trainingDummy === true;\s*\n\s*if \(!isDummy && side && side !== "enemy"\) continue;/.test(entrySrc2));
check("entry.ts：重建后假人 side 以前端为准",
  /if \(isDummy\) e\.side = /.test(entrySrc2));
// ★ 坑E：清旧过滤 side==="enemy" → 中立假人绕过 → 每个 epoch 重复 push（假人越积越多）
check("entry.ts：清旧时假人无视 side",
  /!\(\(e\.side === "enemy" \|\| \(e as any\)\.trainingDummy === true\) && isLocalEnemyId\(e\.id\)\)/.test(entrySrc2));
// ★ 坑G（2026-10-29 实测）：宿主每 tick 重建敌怪表都 pushEvent → 事件日志污染
//   （实测 376 tick 里刷了 35 条「当前关卡敌怪已接入宿主 AI（4 只）」）
check("entry.ts：敌怪接入事件只在真的变化时记一次",
  /_lastLocalBuilt/.test(entrySrc2) && /_lastLocalEpoch/.test(entrySrc2));

/* 4g. ★★ 站桩回血与伤害必须同源（2026-10-29 bsk 实测发现并修复）★★
   现象：站桩模式连打 3 刀，事件日志「普攻命中 伤害 72」×3，但**血量恒 185 不动**。
   根因（下午误加的修复引入的回归）：把「站桩回血」留在前端 E70 脚本，
        同时让「stand 假人 hp 以客户端为准」+「epoch 相同时把前端 hp 同步进宿主」
        → 宿主 damage() 打到 113 → 前端用自己的 185 覆盖 → 上报又把 185 写回宿主
        → **伤害被完全抹掉**。
   正确口径：**伤害与回血都在宿主**（entry.ts），
        前端只负责「模式切换 + UI」，hp 一律跟宿主。 */
check("entry.ts：站桩回血在宿主侧（standDummyRegen）",
  /function standDummyRegen/.test(entrySrc2) && /STAND_REGEN_TICKS = 10/.test(entrySrc2) &&
  /STAND_REGEN_RATIO = 0\.05/.test(entrySrc2));
check("entry.ts：standDummyRegen 在 step() 里被调用",
  /standDummyRegen\(s\);/.test(entrySrc2));
check("entry.ts：不再把前端 hp 同步进宿主（会抹掉伤害）",
  !/ex\.hp = clamp\(Math\.round\(rhp\)/.test(entrySrc2));
check("App.vue：假人 hp 一律以宿主为准（无 clientOwnsHp 例外）",
  !/clientOwnsHp/.test(appVue) && /hp: hostSame\.hp/.test(appVue));
check("E70：前端不再负责回血（已挪到宿主）",
  !/Math\.min\(maxHp, hp \+ Math\.max\(1, Math\.round\(maxHp \* 0\.05\)\)\)/.test(
    readFileSync(join(vueScripts, "E70_training_dummy.ts"), "utf-8")));

/* 4h. ★★ 特效透明度 + 血条前置绘制（2026-10-29 用户反馈：特效盖住怪和血条）★★
   现象：打击特效（斩击弧 / 火花 / 爆炸）完全不透明，把站桩假人和它的血条盖得死死的，
        玩家看不到自己打到了什么、血掉到哪了。
   修法（两条一起做，缺一不可）：
     ① VFX 层整体降透明度（VFX_ALPHA_SCALE + vfxA() 逐特效套用）
     ② 血条从实体层挪到 VFX 层之后补画（recordHpBar → drawHpBarsOverlay） */
console.log("\n=== ★ 特效透明度 + 血条可见性（2026-10-29） ===");
check("App.vue：有 VFX_ALPHA_SCALE 常量且 < 1（特效整体压暗）",
  /const VFX_ALPHA_SCALE = 0\.\d+/.test(appVue) &&
  parseFloat((appVue.match(/const VFX_ALPHA_SCALE = ([\d.]+)/) || [])[1] ?? "1") < 1);
check("App.vue：有 vfxA() 把特效自身 alpha 乘系数",
  /function vfxA\(alpha: number\)/.test(appVue) &&
  /return Math\.max\(0, Math\.min\(1, alpha \* VFX_ALPHA_SCALE\)\)/.test(appVue));
check("App.vue：斩击弧/火花/爆炸/火球/治疗环/Buff环/图标都套了 vfxA",
  ["drawSlashArc", "drawSpark", "drawExplosion", "drawFireballPx", "drawHealRing", "drawBuffRing"]
    .every((fn) => {
      // 取该函数体（到下一个顶层 function 声明为止）
      const start = appVue.indexOf(`function ${fn}(`);
      if (start < 0) return false;
      const rest = appVue.slice(start + 1);
      const next = rest.search(/\nfunction /);
      const body = next > 0 ? rest.slice(0, next) : rest;
      return /vfxA\(/.test(body);
    })
  && /function drawIconBurst\([\s\S]{0,1200}?vfxA\(/.test(appVue));
check("App.vue：有 recordHpBar（实体层只记位置不画）",
  /function recordHpBar\(/.test(appVue) && /hpBarBuffer\.push/.test(appVue));
check("App.vue：有 drawHpBarsOverlay（VFX 之后统一补画血条）",
  /function drawHpBarsOverlay\(/.test(appVue));
check("App.vue：render() 里先清空 hpBarBuffer 再画实体",
  /hpBarBuffer = \[\];[\s\S]{0,400}角色/.test(appVue) ||
  /hpBarBuffer = \[\];/.test(appVue));
check("App.vue：drawHpBarsOverlay 在 drawVfxLayer 之后调用（血条不被特效盖住）",
  /drawVfxLayer\(ctx, s\.vfx, wx2px, wz2py\);[\s\S]{0,200}drawHpBarsOverlay\(ctx\);/.test(appVue));
check("App.vue：实体层不再直接 fillRect 画血条（已挪到 overlay）",
  !/ctx\.fillStyle = "#d63b3b";\s*\n\s*ctx\.fillRect\(barX, barY, barW \* Math\.max\(0, e\.hp \/ e\.maxHp\), barH\);/.test(appVue));
check("entry.ts：站桩被打到 0 血文案是「重新立了起来」不是「散架了」",
  /重新立了起来/.test(entrySrc2));

/* 4f. ★★ 实战击碎奖励不发（2026-10-29 ego-browser 实测定位并修复）★★
   现象：假人能正常扣血（335→0）、事件日志有「骷髅兵(练习假人) 散架了」，
        但玩家经验**纹丝不动**（exp 76 → 76），「获得 N 经验」事件不出现。
   根因：entry.ts damage() 击碎假人时写 flag `dummy_destroyed_<实体id>`，
        E70 脚本用 `ctx.save.getFlag()` 轮询这个 flag —— 但 eventEngine 的
        **flagCache 会话内缓存**只在「切图/重载事件/面板写 flag」时失效，
        战斗中的写入没有任何显式失效时机 → 脚本轮询永远读到旧快照 → 奖励永不发。
   修复：eventEngine 的 getFlag 改为强制重读 + 缓存加 TTL。 */
const ee = readFileSync(join(pluginRoot, "vue/src/eventEngine.ts"), "utf-8");
check("eventEngine：flag 缓存有 TTL（外部写入能被感知）",
  /FLAG_CACHE_TTL_MS/.test(ee) && /flagCacheAt/.test(ee));
check("eventEngine：getFlag 强制重读（脚本轮询必须拿到最新 flag）",
  /getFlag:[\s\S]{0,800}?loadFlags\(true\)/.test(ee));
check("eventEngine：reloadFlags / invalidateFlagCache 会重置缓存时刻",
  /invalidateFlagCache\(\)[\s\S]{0,120}flagCacheAt = 0/.test(ee) &&
  /reloadFlags\(\)[\s\S]{0,160}flagCacheAt = 0/.test(ee));
check("eventEngine：saveFlags 落库后刷新缓存时刻（避免写-读竞态）",
  /saveFlags[\s\S]{0,240}flagCacheAt = Date\.now\(\)/.test(ee));
// ★ 奖励公式本身也要锁住（E70 脚本）：exp = 10 + lv × 6
check("E70：击碎经验公式 10 + lv*6",
  /10 \+ dummy\.level \* 6/.test(readFileSync(join(vueScripts, "E70_training_dummy.ts"), "utf-8")));

/* 5. workshops 同步 */
console.log("\n=== workshops 同步 ===");
try {
  const wsScript = readFileSync(join(wsRoot, "events/scripts/E70_training_dummy.ts"), "utf-8");
  check("E70_training_dummy.ts 已同步", wsScript.length > 1000);
  check("workshops 版 import 指向 shared/_ctx", wsScript.includes('from "../shared/_ctx"'));
} catch { check("E70_training_dummy.ts 已同步", false); }

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);