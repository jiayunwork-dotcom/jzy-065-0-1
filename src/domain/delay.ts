/**
 * Webster 延误公式（均匀延误，第一项）：
 *
 *   d1 = 0.5 · C · (1 − λ)² / (1 − λ · x)
 *
 * 单位：秒/辆（一辆车在该周期的平均均匀延误）。
 *
 * - λ = g/C 绿信比
 * - x = q/(λ·s) 饱和度
 * - λ=0 且 q=0：无到达无绿灯，延误为 0
 * - x=1 时分母退化为 (1−λ)，数学上仍有限，但该相位在 saturation
 *   模块已被判饱和拒绝，延误不会对其计算
 *
 * 另提供 Webster 第二项（随机/增量延误），仅用于扫描曲线：
 *
 *   d2 = x² / (2·q·(1 − x))      （小时/辆 → ×3600 换算成 秒/辆）
 *
 * 即 d2[秒/辆] = 1800·x²/(q·(1−x))，q 单位 辆/时。
 * 全部需求为 0 时无增量延误。
 */

export function uniformDelay(C: number, lambda: number, x: number, q: number): number {
  if (q === 0) return 0;
  if (lambda <= 0) return 0.5 * C; // 有到达无有效绿（理论上会先被饱和度拦截）
  const denominator = 1 - lambda * x;
  if (denominator <= 1e-12) {
    // 仅当 x≈1 且 λ≈1 时逼近 —— 正常流程由相位饱和判定先行拦截
    return Number.POSITIVE_INFINITY;
  }
  return (0.5 * C * (1 - lambda) * (1 - lambda)) / denominator;
}

/** Webster 随机/增量延误（秒/辆）；x≥1 无定义，返回 Infinity */
export function overflowDelay(q: number, x: number): number {
  if (q === 0) return 0;
  if (x >= 1) return Number.POSITIVE_INFINITY;
  return (1800 * x * x) / (q * (1 - x));
}
