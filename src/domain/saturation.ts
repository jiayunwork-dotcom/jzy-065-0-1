/**
 * 相位级饱和度：x_i = q_i / (λ_i · s_i) = y_i / λ_i
 *
 * 即便整体 Y < 1，某个相位也可能因为绿灯被别人挤占（或最小绿配置）
 * 导致 x_i 达到或超过 1。此时该相位单独报饱和错误，而不是默默算出
 * 没有物理意义的延误。
 *
 * x = 1 时 Webster 第一项分母 1 − λ·x = 1 − λ = 红灯比，仍可算，
 * 但排队已无法在绿灯内清空，按饱和处理拒绝。
 */

import { TimingError } from './errors';

/** 饱和度等于或超过该值即判饱和 */
export const PHASE_SATURATION_LIMIT = 1;
export const PHASE_SATURATION_TOLERANCE = 1e-9;

export function degreeOfSaturation(y: number, lambda: number): number {
  if (lambda <= 0) {
    // q=0、g=0：没有到达也没有绿，饱和度按 0 处理（不产生延误）
    if (y === 0) return 0;
    // 有到达却没有绿：必然饱和
    return Number.POSITIVE_INFINITY;
  }
  return y / lambda;
}

export function isPhaseSaturated(x: number): boolean {
  return x >= PHASE_SATURATION_LIMIT - PHASE_SATURATION_TOLERANCE;
}

export interface SaturatedPhase {
  index: number;
  name?: string;
  x: number;
}

/** 找出第一个饱和相位；无则返回 null */
export function findSaturatedPhase(
  xs: number[],
  names: Array<string | undefined>,
): SaturatedPhase | null {
  for (let i = 0; i < xs.length; i++) {
    if (isPhaseSaturated(xs[i])) {
      return { index: i, name: names[i], x: xs[i] };
    }
  }
  return null;
}

export function phaseSaturationError(
  sp: SaturatedPhase,
  cycle: number,
): TimingError {
  return new TimingError(
    'PHASE_SATURATED',
    `相位 ${sp.name ? `「${sp.name}」` : `#${sp.index}`} 在周期 C=${cycle}s 下饱和度 x=${
      Number.isFinite(sp.x) ? sp.x.toFixed(4) : '∞'
    } ≥ 1，绿灯被挤占无法清空来车，不能给出物理有效的延误`,
    {
      details: {
        phaseIndex: sp.index,
        phaseName: sp.name ?? null,
        x: Number.isFinite(sp.x) ? sp.x : null,
        cycle,
      },
    },
  );
}
