/**
 * ★ V2（2026-11-13）头顶状态徽章层
 * ------------------------------------------------------------------
 * 需求（md/curr_design/toonflow-field-survival/技能特效设计/V2/技能特效设计V2.md）：
 *   R1 野怪产生仇恨 → 头上红色感叹号
 *   R2 玩家被攻击   → 粉色血滴 + 粉色圆圈（圈内=被攻击技能图样，兜底「伤」）+ 粉色扣血值
 *   R3 野怪被攻击   → 红色血滴 + 红色圆圈（圈内=被攻击技能图样，兜底「伤」）+ 红色扣血值
 *   R4 buff 生效中  → 绿色血滴 + 绿色圆圈（圈内=buff 技能图样，兜底「buff」）
 *
 * ★ 铁律：徽章的**内容**（有没有、什么颜色、什么图标、兜底什么字）全部由**宿主**决定
 *   （entry.ts 生成 entity.headBadges），前端只做「把宿主给的东西画出来」。
 *   前端**不做任何业务判断**（不推断距离、不推断仇恨、不自己算伤害）。
 *
 * ★ 绘制范式照抄「血条覆盖层」：实体绘制阶段只 recordHeadBadge() 记锚点，
 *   真正绘制在 VFX 层 + 血条层之后统一补画 → 徽章不会被打击特效盖住。
 */
import { spellIcon } from "./spellIcon";

/** ★ V2 头顶状态徽章（与 entry.ts 的 HeadBadge 同构） */
export interface HeadBadge {
  /** hurt=被打 / buff=增益生效中 */
  kind: "hurt" | "buff";
  /** 徽章主色：玩家受击=粉红 / 敌怪受击=红 / buff=绿 */
  color: string;
  /** 法术图标相对路径（相对 ui/，如 images/spells/fire/fireball.png） */
  icon?: string;
  /** 图标兜底文字：hurt→"伤"、buff→"buff" */
  label?: string;
  bornTick: number;
  expireTick?: number;
}

/** 一次实体绘制留下的徽章锚点 */
interface HeadAnchor {
  /** 屏幕像素 x */
  x: number;
  /** 屏幕像素 y（头顶锚点） */
  y: number;
  badges: HeadBadge[];
  /** 是否有仇恨（宿主权威字段 aiState === "chase"） */
  aggro: boolean;
  /** 当前 tick（用于计算徽章剩余寿命） */
  tick: number;
  /** 每米像素数（徽章随 zoom 缩放） */
  ppm: number;
}

/** 本帧待绘制的徽章锚点（每次 render 开始时清空） */
let headAnchors: HeadAnchor[] = [];

/** 仇恨感叹号颜色（与 entry.ts 的 AGGRO_COLOR 一致） */
const AGGRO_COLOR = "#ff3b3b";

/** 圆圈半径（逻辑像素基准，实际随 ppm 缩放） */
const BADGE_R = 11;
/** 血滴符号高度（逻辑像素基准） */
const DROP_H = 12;
/** 徽章行总高（血滴 + 圆圈） */
const BADGE_ROW_H = 30;

/**
 * 实体绘制阶段调用：记录该实体的徽章锚点（不立即绘制）。
 * @param e 实体（宿主下发的权威实体）
 * @param x 屏幕像素 x
 * @param y 屏幕像素 y（头顶锚点）
 * @param tick 当前 tick（宿主 state.tick）
 * @param ppm 每米像素数（随 zoom）
 */
export function recordHeadBadge(e: any, x: number, y: number, tick: number, ppm: number): void {
  if (!e) return;
  const badges: HeadBadge[] = Array.isArray(e.headBadges) ? e.headBadges : [];
  const aggro = String(e.aiState || "") === "chase";
  if (!badges.length && !aggro) return;
  headAnchors.push({ x, y, badges, aggro, tick: Number(tick) || 0, ppm: Math.max(4, ppm) });
}

/** 画血滴符号（尖顶 + 圆底的经典水滴路径） */
function drawDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, color: string): void {
  const w = h * 0.72;
  const r = w / 2;
  const top = cy - h / 2;
  const bot = cy + h / 2;
  ctx.save();
  ctx.beginPath();
  // 尖顶 → 两侧弧线 → 圆底
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(cx + w * 0.5, top + h * 0.42, cx + r, bot - r * 0.9, cx + r, bot - r);
  ctx.arc(cx, bot - r, r, 0, Math.PI * 2);
  ctx.bezierCurveTo(cx - r, bot - r * 0.9, cx - w * 0.5, top + h * 0.42, cx, top);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** 画圆圈 + 圈内图标/文字 */
function drawBadgeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  badge: HeadBadge,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  // 圆底（半透明填充，让图标更易读）
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fill();
  // 描边 + 发光
  ctx.strokeStyle = badge.color;
  ctx.lineWidth = 2;
  ctx.shadowColor = badge.color;
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 圈内：优先图标，缺省/加载失败 → 文字兜底
  const img = badge.icon ? spellIcon(badge.icon) : null;
  if (img) {
    const size = Math.max(10, Math.round(r * 1.45));
    ctx.imageSmoothingEnabled = false;   // 像素图标保持锐利
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  } else {
    // 文字兜底：hurt→「伤」、buff→「buff」
    const text = badge.label || (badge.kind === "buff" ? "buff" : "伤");
    ctx.fillStyle = badge.color;
    ctx.font = `bold ${Math.max(9, Math.round(r * 0.95))}px 'Microsoft YaHei', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5);
  }
  ctx.restore();
}

/** 画仇恨感叹号（竖条 + 圆点，浮动 + 呼吸） */
function drawAggroMark(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  scale: number,
  timeMs: number,
): void {
  // 呼吸 alpha 0.85~1.0（周期 600ms）
  const breath = 0.925 + 0.075 * Math.sin((timeMs / 600) * Math.PI * 2);
  // 上下浮动 ±2px（周期 600ms）
  const float = Math.sin((timeMs / 600) * Math.PI * 2) * 2 * scale;
  const w = 3 * scale;
  const barH = 10 * scale;
  const dotR = 1.6 * scale;
  const y = cy + float;
  ctx.save();
  ctx.globalAlpha = breath;
  ctx.fillStyle = AGGRO_COLOR;
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.lineWidth = 1;
  // 竖条（圆角）
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y - barH / 2, w, barH, w / 2);
  ctx.fill();
  ctx.stroke();
  // 圆点
  ctx.beginPath();
  ctx.arc(cx, y + barH / 2 + dotR + 1, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * 在 VFX 层与血条层之后统一补画头顶徽章。
 * @param ctx canvas 上下文
 * @param timeMs 当前时间（用于呼吸/浮动动画）
 */
export function drawHeadStatusLayer(ctx: CanvasRenderingContext2D, timeMs: number): void {
  if (!headAnchors.length) return;
  ctx.save();
  for (const a of headAnchors) {
    // 徽章尺寸随 zoom 缩放（用 ppm 换算，基准 20px/m ≈ 默认 zoom）
    const k = a.ppm / 20;
    const r = Math.max(7, Math.round(BADGE_R * k));
    const dropH = Math.max(8, Math.round(DROP_H * k));
    const rowH = Math.max(20, Math.round(BADGE_ROW_H * k));
    const gap = Math.max(2, Math.round(3 * k));

    // 徽章行整体居中于锚点 x
    const count = Math.max(1, a.badges.length);
    const unitW = r * 2 + dropH * 0.72 + gap;
    const totalW = count * unitW;
    let cursorX = a.x - totalW / 2 + unitW / 2;

    for (const b of a.badges) {
      // 剩余寿命比例（无 expireTick = 常驻）
      let alpha = 1;
      if (b.expireTick != null) {
        const remain = Math.max(0, b.expireTick - a.tick);
        alpha = Math.min(1, remain / 6);          // 最后 6 tick（0.6s）线性淡出
        if (alpha <= 0) { cursorX += unitW; continue; }
      }
      // 圆圈中心
      const circleCx = cursorX + dropH * 0.36 + gap + r;
      const circleCy = a.y - rowH + r;
      // 血滴在圆圈左侧
      const dropCx = cursorX + dropH * 0.36;
      const dropCy = circleCy;
      drawDrop(ctx, dropCx, dropCy, dropH, b.color);
      drawBadgeCircle(ctx, circleCx, circleCy, r, b, alpha);
      cursorX += unitW;
    }

    // 仇恨感叹号：徽章行再往上 22px（或无徽章时在锚点上方）
    if (a.aggro) {
      const markY = a.y - (a.badges.length ? rowH + 16 * k : 14 * k);
      drawAggroMark(ctx, a.x, markY, Math.max(0.8, k), timeMs);
    }
  }
  ctx.restore();
  headAnchors = [];
}

/** 清空本帧缓冲（render 开始时调用） */
export function resetHeadStatusLayer(): void {
  headAnchors = [];
}
