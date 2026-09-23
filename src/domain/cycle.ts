/**
 * Webster 最佳周期：
 *
 *   C0 = (1.5·L + 5) / (1 − Y)
 *
 * 整体饱和判定（求解前防住）：
 *   当 Y 达到或极其接近 1（裕度 SATURATION_MARGIN = 0.01）时，
 *   最佳周期趋于无穷，必须在求解前返回过饱和错误并附上算出的 Y，
 *   绝不吐出负周期或几千秒的假周期。
 */

import { TimingError } from './errors';

/** 离 1 不足该裕度即视为整体过饱和 */
export const SATURATION_MARGIN = 0.01;
export const Y_LIMIT = 1 - SATURATION_MARGIN; // 0.99

export function isOversaturated(Y: number): boolean {
  return Y >= Y_LIMIT;
}

/**
 * 求 Webster 最佳周期。
 * @throws TimingError(OVERSATURATED) 当 Y ≥ 0.99
 */
export function optimalCycle(Y: number, lostTime: number): number {
  if (isOversaturated(Y)) {
    throw new TimingError(
      'OVERSATURATED',
      `总流量比 Y=${Y.toFixed(4)} 已达到或接近 1（裕度 ${SATURATION_MARGIN}），Webster 最佳周期趋于无穷，不存在有限的定时信号周期`,
      { details: { Y, margin: SATURATION_MARGIN, threshold: Y_LIMIT } },
    );
  }
  return (1.5 * lostTime + 5) / (1 - Y);
}
