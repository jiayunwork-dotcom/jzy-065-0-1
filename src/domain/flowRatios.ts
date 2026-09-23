/**
 * 流量比核算：y_i = q_i / s_i，Y = Σ y_i
 *
 * 这是配时与延误共用的唯一一组到达率来源 ——
 * 延误模块必须消费这里算出的 y（以及同一组 q/s），
 * 杜绝「配时用一套 q、延误用另一套 q」的隐患。
 */

import type { NormalizedPhase } from './types';

export function flowRatios(phases: NormalizedPhase[]): number[] {
  return phases.map((p) => p.q / p.s);
}

export function totalFlowRatio(ys: number[]): number {
  return ys.reduce((acc, y) => acc + y, 0);
}
