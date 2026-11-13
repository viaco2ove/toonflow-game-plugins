/**
 * ★ V2（2026-11-13）攻击范围指示区渲染层
 * ------------------------------------------------------------------
 * 需求：
 *   · V1 的范围攻击全是圆形 → V2 增加「朝向攻击类型」（cone，只攻击面前的敌人）
 *   · 施放时出现与攻击范围**同样大小**的**粉红色半透明扇形区域**
 *   · 圆形范围攻击也要每次出现**粉红色圆形区域**（透明度高一点、隐约可见就行）
 *
 * ★ 铁律：指示区数据由**宿主**生成（entry.ts 的 state.rangeIndicators），
 *   半径/朝向/半角与命中判定用**同一组常量** → 指示区 = 判定区。
 *
 * ★ 2.5D 压缩要点：世界 Y 方向带 DEPTH 压缩（App.vue wz2py），
 *   而半径是各向同性的。正确做法是 **先平移到施放点、再纵向压 DEPTH、再画圆**：
 *     ctx.translate(px, py); ctx.scale(1, DEPTH); ctx.arc(0, 0, r, ...)
 *   Canvas 会自动把圆压成贴合地面的椭圆，扇形角度也随之与地面坐标一致。
 *   ⚠️ 不要「手动把角度换算成屏幕角」——那样会画歪。
 */

/** ★ V2 攻击范围指示区（与 entry.ts 的 RangeIndicator 同构） */
export interface RangeIndicator {
  id: string;
  shape: "circle" | "cone";
  /** 施放者位置（世界米） */
  x: number;
  y: number;
  /** 作用半径（米） */
  radius: number;
  /** 朝向（角度制 0=右 90=下 180=左 270=上） */
  facing: number;
  /** 扇形半角（度） */
  halfAngleDeg: number;
  /** 剩余生命（tick） */
  life: number;
  total: number;
}

/** 粉红半透明填充（透明度高一点、隐约可见） */
const RANGE_FILL = "rgba(255, 143, 200, 0.28)";
/** 粉红描边（比填充略亮，边缘更清晰） */
const RANGE_STROKE = "rgba(255, 143, 200, 0.55)";
/** 2.5D 纵向压缩系数（与 App.vue 的 DEPTH 一致） */
const DEPTH = 1.0;

/**
 * 画攻击范围指示区层。
 * @param ctx canvas 上下文
 * @param list 宿主下发的指示区列表
 * @param wx2px 世界米 X → 屏幕像素 X
 * @param wz2py 世界米 Z → 屏幕像素 Y（带 DEPTH 压缩）
 * @param ppm 每米像素数（随 zoom）
 * @param timeMs 当前时间（呼吸动画）
 */
export function drawRangeIndicatorLayer(
  ctx: CanvasRenderingContext2D,
  list: RangeIndicator[] | undefined,
  wx2px: (x: number) => number,
  wz2py: (y: number) => number,
  ppm: number,
  timeMs: number,
): void {
  if (!list || !list.length) return;
  ctx.save();
  for (const r of list) {
    const total = Math.max(1, r.total || 1);
    const lifeRatio = Math.max(0, Math.min(1, (r.life || 0) / total));
    // 淡出：最后 1/3 逐渐变淡，但**不完全消失**（「隐约可见」是需求本意）
    const alpha = 0.35 + 0.65 * lifeRatio;
    // 轻微呼吸（幅度极小，避免误导判定边界）
    const breath = 1 + 0.02 * Math.sin((timeMs / 700) * Math.PI * 2);

    const px = wx2px(r.x);
    const py = wz2py(r.y);
    const rad = Math.max(2, r.radius * ppm * breath);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = RANGE_FILL;
    ctx.strokeStyle = RANGE_STROKE;
    ctx.lineWidth = 1.5;
    // ★ 平移到施放点 + 纵向压 DEPTH → 画出来是贴合地面的椭圆 / 正确朝向的扇形
    ctx.translate(px, py);
    ctx.scale(1, DEPTH);
    ctx.beginPath();
    if (r.shape === "cone") {
      const facing = ((r.facing || 0) * Math.PI) / 180;
      const half = ((r.halfAngleDeg || 30) * Math.PI) / 180;
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rad, facing - half, facing + half);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
