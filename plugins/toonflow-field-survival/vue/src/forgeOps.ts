/**
 * ★ 锻造 / 炼丹面板的操作逻辑（前端侧）
 * ------------------------------------------------------------
 * 面板（ForgeAlchemyPanel.vue）里「打造 / 升级 / 溶解」三个动作的实现。
 * 直接调后端 cmd（sys_forge_create / sys_item_upgrade / sys_item_dissolve），
 * AI 生成走 ctx.ai.generate（事件引擎的 AI 通道）。
 *
 * 之所以放前端而不是事件脚本：面板是前端组件，需要即时刷新 UI
 *（面板开着时购买/打造后列表要立刻反映），而事件脚本是 fire-and-forget 的。
 */
import {
  aiGenerate, buildForgePrompt, buildAlchemyPrompt, buildUpgradePrompt,
  calcDissolveReturns, calcPillDissolveReturns, pickBlueprints, pickRecipes,
  randomForgeItem, randomPill, returnsToText, RARITY_ZH,
  blueprintProduct, looksLikeBlueprint,
  type BagEntry, type GeneratedItem,
} from "./eventScripts/forgeCommon";

const AGENT_FORGE = "field-survival-forge-item";
const AGENT_ALCHEMY = "field-survival-alchemy-pill";
const AGENT_UPGRADE = "field-survival-item-upgrade";
const FORGE_COST = 10;

/** 操作面板需要的最小依赖（由 App.vue 注入） */
export interface ForgeOpsDeps {
  /** 调后端 cmd（sendTick 通道） */
  cmd(action: string, params?: Record<string, unknown>): Promise<string>;
  /** AI 生成（事件引擎通道） */
  aiGenerate(agent: string, prompt: string, timeoutMs?: number): Promise<string>;
  /** 读背包 */
  bagList(): Promise<BagEntry[]>;
  /** 移除背包物品 */
  bagRemove(name: string, count?: number): Promise<boolean>;
  /** 右下角飘字 */
  toast(text: string, color?: "gold" | "red" | "white" | "blue"): void;
  /** 顶部字幕 */
  subtitle(text: string, durationMs?: number): void;
  /** 事件日志 */
  event(text: string): void;
  /** 弹确认框 */
  confirm(opts: { title: string; detail?: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
  /** 弹多选面板 */
  select(opts: { title: string; detail?: string; options: Array<{ label: string; value: string; desc?: string }> }): Promise<string | null>;
  /** 弹文本输入框 */
  prompt(opts: { title: string; detail?: string; placeholder?: string }): Promise<string | null>;
  /**
   * ★ 结果弹窗（购买成功 / 打造成功 / 升级成功 / 溶解成功…）
   *   与 toast 的区别：toast 是右下角飘字，几秒就没了；notice 是模态框，
   *   玩家必须点「知道了」才关闭 —— 打造一件史诗装备、花掉 3000 金这种
   *   结果不能被飘字糊弄过去。
   */
  notice(opts: { title: string; detail?: string; okText?: string }): Promise<void>;
  /** 玩家等级 */
  playerLevel(): number;
  /** 当前金钱（本地预检，省掉「AI 跑完 20 秒才发现没钱」的浪费） */
  money(): number;
}

/** 解析 AI 返回的 JSON（去掉 ```json 围栏） */
function extractJson(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** ★ 调 AI 生成并归一化 */
async function gen(
  deps: ForgeOpsDeps,
  agent: string,
  prompt: string,
  fallback: Partial<GeneratedItem> = {},
): Promise<{ item: GeneratedItem | null; usedAI: boolean }> {
  const text = await deps.aiGenerate(agent, prompt, 20000);
  const raw = extractJson(text);
  if (!raw) return { item: null, usedAI: false };
  const item = normalizeItem(raw, fallback);
  return { item, usedAI: true };
}

/** 归一化 AI 生成的物品（防越界值 / 空名 / 非法品质） */
const KINDS = ["material", "equipment", "weapon", "armor", "skill_book", "consumable"];
const RARITIES = ["common", "fine", "rare", "epic", "legend"];
function normalizeItem(raw: any, fallback: Partial<GeneratedItem> = {}): GeneratedItem | null {
  const name = String(raw?.name || fallback.name || "").trim().slice(0, 20);
  if (!name) return null;
  const n = (v: any, d: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || d)));
  return {
    name,
    kind: KINDS.includes(String(raw?.kind)) ? String(raw.kind) : String(fallback.kind || "material"),
    rarity: RARITIES.includes(String(raw?.rarity)) ? String(raw.rarity) : String(fallback.rarity || "common"),
    heal: n(raw?.heal, 0, 9999),
    desc: String(raw?.desc || fallback.desc || "").slice(0, 60),
    price: Math.max(1, Math.round(Number(raw?.price) || 10)),
    atk: n(raw?.atk, 0, 9999),
    def: n(raw?.def, 0, 9999),
    durability: n(raw?.durability, 0, 99999),
    lv: raw?.lv != null ? Math.max(1, Math.round(Number(raw.lv) || 1)) : undefined,
    effect: raw?.effect && typeof raw.effect === "object"
      ? {
          type: String(raw.effect.type || "none").slice(0, 20),
          value: n(raw.effect.value, 0, 9999),
          duration: n(raw.effect.duration, 0, 9999),
        }
      : undefined,
  };
}

/* ============================================================
   ② 物品打造 / 开始炼丹
   ============================================================ */
export async function opCraft(
  deps: ForgeOpsDeps,
  mode: "forge" | "alchemy",
  way: "input" | "random" | "blueprint",
): Promise<boolean> {
  const isForge = mode === "forge";
  let input = "";
  /** ★ 本次使用的图纸/药方名（blueprint 方式才有）：打造成功后消耗 1 张 */
  let blueprint = "";

  if (way === "input") {
    const typed = await deps.prompt({
      title: isForge ? "想要什么？" : "想炼什么丹？",
      detail: isForge
        ? "写个名字或描述，比如「寒铁软剑」「能加火属性的护腕」"
        : "写个名字或描述，比如「九转还魂丹」「能加攻击的猛虎丸」",
      placeholder: isForge ? "例：寒铁软剑" : "例：九转还魂丹",
    });
    if (typed === null) return false;
    input = String(typed).trim();
    if (!input) {
      deps.toast(isForge ? "锻造大师：「连名字都想不出来，打什么打。」" : "炉底冰凉，连点火的心都没有……", "white");
      return false;
    }
  } else if (way === "blueprint") {
    const bag = await deps.bagList();
    const list = isForge ? pickBlueprints(bag) : pickRecipes(bag);
    if (list.length === 0) {
      deps.toast(isForge ? "锻造大师：「你一张图纸都没有，选个锤子。」" : "你没有药方，只能凭感觉炼了。", "white");
      return false;
    }
    // ★ 选项里直接标出「这张图纸要做什么」，玩家选之前就知道产物
    const picked = await deps.select({
      title: isForge ? "选择锻造图纸" : "选择药方",
      detail: `你身上有 ${list.length} 张${isForge ? "图纸" : "药方"}（使用后会消耗 1 张）`,
      options: list.map((b) => {
        const product = blueprintProduct(b.name);
        return {
          label: b.name,
          value: b.name,
          desc: product
            ? `→ 制作「${product}」${b.desc ? ` · ${b.desc}` : ""}`
            : `→ 成品未知，凭运气${b.desc ? ` · ${b.desc}` : ""}`,
        };
      }),
    });
    if (!picked) return false;
    blueprint = picked;
    // ★ 关键修复：input 用「图纸记载的成品」，不是图纸名本身。
    //   以前直接把「铁剑图纸」喂给 AI → AI 生成一件叫「铁剑图纸」的物品，
    //   图纸还留在包里，越打造图纸越多。现在 input=「铁剑」，图纸打完即消耗。
    input = blueprintProduct(picked);
    if (!input) {
      deps.toast(`「${picked}」没写明要做什么，全凭手气。`, "white");
    }
  }

  // ★ 本地预检金钱：放在 AI 之前，避免白跑 20 秒才发现没钱
  const money = Math.max(0, Math.round(Number(deps.money()) || 0));
  if (money < FORGE_COST) {
    await deps.notice({
      title: "💰 金钱不足",
      detail: `${isForge ? "打造" : "炼丹"}需要 ${FORGE_COST} 金，你身上只有 ${money} 金。`,
    });
    return false;
  }

  deps.toast(
    isForge
      ? (blueprint ? `锻造大师摊开「${blueprint}」，照着图样开始锻打——` : "锻造大师接过材料，火星四溅——")
      : (blueprint ? `你摊开「${blueprint}」，照着方子往炉里投料……` : "你往炉膛里添了柴火，将材料依次投入……"),
    "white");
  deps.subtitle(isForge ? "锻造中…" : "炼丹中…", 1500);

  const level = deps.playerLevel();
  const prompt = isForge
    ? buildForgePrompt(input, level, "", blueprint)
    : buildAlchemyPrompt(input, level, "", blueprint);

  const { item, usedAI } = await gen(
    deps,
    isForge ? AGENT_FORGE : AGENT_ALCHEMY,
    prompt,
    isForge ? { kind: "equipment", rarity: "common" } : { kind: "consumable", rarity: "common" },
  );

  let final = item;
  if (!final) {
    final = isForge ? randomForgeItem(input, level) : randomPill(input, level);
    deps.toast(isForge ? "炉火没稳住，只能将就着来。" : "火候没压住，成了一颗普通货色。", "white");
  }

  // ★ 双保险：AI 若仍把图纸/药方本身当产物，强制改成图纸记载的成品名
  if (looksLikeBlueprint(final.name)) {
    const fixed = blueprintProduct(final.name) || input;
    if (fixed && fixed !== final.name) {
      final = { ...final, name: fixed };
    } else if (blueprint) {
      final = { ...final, name: blueprintProduct(blueprint) || (isForge ? "无名器物" : "无名丹药") };
    }
  }

  const resp = await deps.cmd(isForge ? "sys_forge_create" : "sys_alchemy_create", {
    input,
    blueprint,
    aiJson: usedAI ? JSON.stringify(final) : "",
  });
  // 后端拒绝（金钱不足 / 原物品不在背包…）→ 弹失败框，不消耗图纸
  if (resp && /不足|失败|不在背包|缺少|无效/.test(resp) && !/完成/.test(resp)) {
    await deps.notice({
      title: isForge ? "❌ 锻造失败" : "❌ 炼丹失败",
      detail: resp,
    });
    return false;
  }

  // ★ 图纸是消耗品：打造成功后扣掉 1 张
  if (blueprint) await deps.bagRemove(blueprint, 1);

  const effectText = final.effect && final.effect.type !== "none"
    ? `${final.effect.type} +${final.effect.value}%（${final.effect.duration}s）`
    : "";
  const statText = [
    final.atk > 0 ? `攻击 +${final.atk}` : "",
    final.def > 0 ? `防御 +${final.def}` : "",
    final.durability > 0 ? `耐久 ${final.durability}` : "",
    final.heal > 0 ? `恢复 ${final.heal} 生命` : "",
    effectText,
  ].filter(Boolean).join("　");

  await deps.notice({
    title: isForge ? "🔨 锻造成功" : "🔥 炼丹成功",
    detail: [
      `获得「${final.name}」（${RARITY_ZH[final.rarity] || final.rarity}）`,
      statText ? statText : "",
      final.desc ? `　${final.desc}` : "",
      "",
      blueprint ? `已消耗图纸「${blueprint}」` : "",
      `花费 ${FORGE_COST} 金`,
    ].filter((x) => x !== "").join("\n"),
  });
  deps.event(`${isForge ? "打造物品" : "炼制丹药"}：${final.name}（${final.rarity}）${blueprint ? ` ← 图纸「${blueprint}」` : ""}`);
  return true;
}

/* ============================================================
   ③ 升级物品
   ============================================================ */
export async function opUpgrade(deps: ForgeOpsDeps, item: any): Promise<boolean> {
  if (!item?.name) return false;
  const currentLv = Math.max(1, Math.round(item.lv || 1));
  const nextLv = currentLv + 1;

  const costMoney = nextLv * 20;
  const costOre = nextLv * 2;
  const costStone = Math.max(1, Math.floor(nextLv / 3));

  // 材料校验
  const bag = await deps.bagList();
  const hasOre = bag.find((b) => b.name === "铁矿石")?.count || 0;
  const hasStone = bag.find((b) => b.name === "灵石碎屑")?.count || 0;
  if (hasOre < costOre || hasStone < costStone) {
    deps.toast(
      `材料不足：需要铁矿石×${costOre}、灵石碎屑×${costStone}` +
      `（现有 铁矿石×${hasOre}、灵石碎屑×${hasStone}）`, "red");
    return false;
  }

  const ok = await deps.confirm({
    title: "升级确认",
    detail: [
      `将「${item.name}」从 Lv${currentLv} 升级到 Lv${nextLv}`,
      "",
      `需要：铁矿石×${costOre}、灵石碎屑×${costStone}、${costMoney} 金钱`,
    ].join("\n"),
    confirmText: "确认升级",
    cancelText: "再想想",
  });
  if (!ok) {
    deps.toast("锻造大师：「材料备齐了再来。」", "white");
    return false;
  }

  deps.subtitle("重铸中…", 1500);
  const stats = [
    item.desc ? `描述=${item.desc}` : "",
    `品质=${RARITY_ZH[item.rarity] || item.rarity}`,
  ].filter(Boolean).join(" ");

  const { item: upgraded } = await gen(
    deps,
    AGENT_UPGRADE,
    buildUpgradePrompt(item.name, currentLv, nextLv, stats),
    { kind: item.kind, rarity: item.rarity },
  );

  let final = upgraded;
  if (!final) {
    final = {
      name: `${item.name}+${nextLv}`,
      kind: item.kind,
      rarity: item.rarity,
      heal: item.heal,
      desc: item.desc || "重铸后的装备",
      price: 0,
      atk: Math.round(6 * 1.3),
      def: Math.round(4 * 1.3),
      durability: 100,
      lv: nextLv,
    };
    deps.toast("重铸炉没热透，只能保守加值。", "white");
  }
  final.lv = nextLv;

  await deps.bagRemove("铁矿石", costOre);
  await deps.bagRemove("灵石碎屑", costStone);

  const upResp = await deps.cmd("sys_item_upgrade", {
    oldName: item.name,
    cost: costMoney,
    aiJson: JSON.stringify(final),
  });
  if (upResp && /不足|失败|不在背包|缺少|无效/.test(upResp) && !/完成/.test(upResp)) {
    await deps.notice({ title: "❌ 升级失败", detail: upResp });
    return false;
  }

  deps.toast(`升级完成！「${final.name}」闪耀着新的光芒。`, "gold");
  deps.event(`升级装备：${item.name} → ${final.name}`);
  await deps.notice({
    title: "⬆ 升级成功",
    detail: [
      `「${item.name}」→「${final.name}」`,
      `等级 Lv${currentLv} → Lv${nextLv}`,
      [
        final.atk > 0 ? `攻击 ${final.atk}` : "",
        final.def > 0 ? `防御 ${final.def}` : "",
        final.durability > 0 ? `耐久 ${final.durability}` : "",
      ].filter(Boolean).join("　"),
      "",
      `消耗 铁矿石×${costOre}、灵石碎屑×${costStone}、${costMoney} 金`,
    ].filter((x) => x !== "").join("\n"),
  });
  return true;
}

/* ============================================================
   ④ 溶解物品 / 溶解丹药
   ============================================================ */
export async function opDissolve(
  deps: ForgeOpsDeps,
  mode: "forge" | "alchemy",
  item: any,
): Promise<boolean> {
  if (!item?.name) return false;
  const isPill = mode === "alchemy";
  const lv = Math.max(1, Math.round(item.lv || 1));
  const returns = isPill
    ? calcPillDissolveReturns(item.heal || 10)
    : calcDissolveReturns(item.rarity || "common", lv);
  const giveMap = isPill
    ? { 草药: returns.herb, 灵芝: returns.lingzhi }
    : { 铁矿石: returns.ore, 灵石碎屑: returns.stone };

  const ok = await deps.confirm({
    title: "溶解确认",
    detail: [
      `溶解「${item.name}」将返还：`,
      returnsToText(giveMap),
      "",
      "（溶解后不可恢复）",
    ].join("\n"),
    confirmText: "确认溶解",
    cancelText: "算了",
  });
  if (!ok) return false;

  const diResp = await deps.cmd("sys_item_dissolve", {
    name: item.name,
    rarity: item.rarity || "common",
    lv,
    heal: item.heal || 0,
    isPill,
  });
  if (diResp && /不足|失败|不在背包|缺少|无效/.test(diResp) && !/完成/.test(diResp)) {
    await deps.notice({ title: "❌ 溶解失败", detail: diResp });
    return false;
  }

  deps.toast(
    isPill
      ? `「${item.name}」化为一股药香：${returnsToText(giveMap)}`
      : `「${item.name}」被熔为材料：${returnsToText(giveMap)}`,
    "white");
  deps.event(`溶解${isPill ? "丹药" : "装备"}：${item.name} → ${returnsToText(giveMap)}`);
  await deps.notice({
    title: isPill ? "🧪 溶解完成" : "⚒ 溶解完成",
    detail: [
      `「${item.name}」已${isPill ? "化为药香" : "熔为材料"}`,
      "",
      `返还：${returnsToText(giveMap) || "无"}`,
    ].join("\n"),
  });
  return true;
}