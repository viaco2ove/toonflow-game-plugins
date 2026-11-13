/**
 * ★ V2（2026-11-13）攻击范围指示区渲染层
 * ------------------------------------------------------------------
 * 需求：
 *   · V1 的范围攻击全是圆形 → V2 增加「朝向攻击类型」（cone，只攻击面前的敌人）
 *   · 施放时出现与攻击范围**同样大小**的**粉红色半透明扇形区域**
 *   · 圆形范围攻击也要每次出现**粉红色圆形区域**（透明度高一点、隐约可见就行）
 *   ★ V2_2（2026-11-13）改造2：指示区范围内出现 1..N 个**半透明的属性法术图标**，
 *     模仿粒子特效（图标 = 技能/物品 effects_type 对应的 spells 图，宿主在
 *     RangeIndicator.icon 里下发；位置用 id 哈希做确定性伪随机分布，
 *     叠加缓慢漂移 + 呼吸，不逐帧抖动）。
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
import { spellIcon } from "./spellIcon";

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
  /** ★ V2_2 改造2：属性法术图标（相对 ui/ 路径）——缺省不画图标粒子 */
  icon?: string;
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
/** ★ V2_2 改造2：图标粒子数（circle=4 / cone=3，需求「1 个或多个」） */
const PARTICLE_COUNT_CIRCLE = 4;
const PARTICLE_COUNT_CONE = 3;
/** 图标粒子基础尺寸（px，随 ppm 轻微缩放） */
const PARTICLE_SIZE = 18;

/** 字符串 → [0,1) 确定性哈希（同一指示区每帧分布一致，不抖动） */
function hash01(s: string, salt: number): number {
  let h = salt * 2654435761;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619 >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * 画攻击范围指示区层。
 * @param ctx canvas 上下文
 * @param list 宿主下发的指示区列表
 * @param wx2px 世界米 X → 屏幕像素 X
 * @param wz2py 世界米 Z → 屏幕像素 Y（带 DEPTH 压缩）
 * @param ppm 每米像素数（随 zoom）
 * @param timeMs 当前时间（呼吸/漂移动画）
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

    // ★ V2_2 改造2：先在平移/压缩坐标系里画图标粒子（与形状同一坐标系 → 必落在形状内），
    //   再画粉红形状（形状压在图标上面一层，边缘清晰且图标隐约透出）。
    const iconImg = r.icon ? spellIcon(r.icon) : null;
    if (iconImg) {
      const n = r.shape === "cone" ? PARTICLE_COUNT_CONE : PARTICLE_COUNT_CIRCLE;
      const facingRad = ((r.facing || 0) * Math.PI) / 180;
      const halfRad = ((r.halfAngleDeg || 30) * Math.PI) / 180;
      const size = Math.max(12, Math.round(PARTICLE_SIZE * Math.min(1.25, ppm / 20)));
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, DEPTH);
      ctx.imageSmoothingEnabled = false;   // 像素图标保持锐利
      for (let i = 0; i < n; i++) {
        // 确定性伪随机分布（同一指示区每帧一致）
        const t1 = hash01(r.id, i * 2 + 1);
        const t2 = hash01(r.id, i * 2 + 2);
        let dx = 0, dy = 0;
        if (r.shape === "cone") {
          // 沿扇形径向分布：离施放点 0.45~0.85 半径，角度 ±0.8 半角内
          const rr = rad * (0.45 + 0.4 * t1);
          const a = facingRad + halfRad * (1.6 * t2 - 0.8);
          dx = Math.cos(a) * rr;
          dy = Math.sin(a) * rr;
        } else {
          // 圆内均匀散布：0.25~0.8 半径
          const a = t1 * Math.PI * 2;
          const rr = rad * (0.25 + 0.55 * t2);
          dx = Math.cos(a) * rr;
          dy = Math.sin(a) * rr;
        }
        // 缓慢漂移（各自相位不同）+ 轻微呼吸缩放
        const drift = Math.sin((timeMs / 600) * Math.PI * 2 + i * 1.7) * 3;
        const scale = 0.9 + 0.15 * Math.sin((timeMs / 500) * Math.PI * 2 + i * 2.3);
        const s = size * scale;
        // 半透明：底层约 0.30，随生命末期与形状一起变淡
        ctx.globalAlpha = 0.30 * alpha;
        ctx.drawImage(iconImg, dx - s / 2, dy + drift - s / 2, s, s);
      }
      ctx.restore();
    }

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
