/**
 * 有效绿分配：
 *
 *   g_i = (C − L) · y_i / Y
 *
 * 若调用方给了各相位最小绿：
 *   1. 先保住最小绿（受保护相位拿到 minGreen）；
 *   2. 剩余有效绿再在其余相位间按流量比分配；
 *   3. 若 Σ minGreen > C − L，保不住，报 MIN_GREEN_INFEASIBLE，
 *      不许把某相位绿灯悄悄削成零还照旧输出延误。
 *
 * 硬约束（不允许绿灯时间凑不平还往下算）：
 *   Σ g_i + L === C
 * 浮点残差压进 BALANCE_TOLERANCE（秒）；分配后的微小残差
 * （远小于容差）并入 y 最大的相位，再复核一次等式。
 */

import { TimingError } from './errors';
import type { NormalizedPhase } from './types';

/** 有效绿之和 + L 与周期的容差，秒 */
export const BALANCE_TOLERANCE = 1e-6;

export interface GreenSplit {
  greens: number[];
  totalGreen: number;
  residual: number;
}

export function allocateGreens(
  phases: NormalizedPhase[],
  ys: number[],
  cycle: number,
  lostTime: number,
): GreenSplit {
  const n = phases.length;
  const effectiveGreen = cycle - lostTime;

  if (effectiveGreen <= 0) {
    throw new TimingError(
      'INVALID_CYCLE',
      `周期 C=${cycle}s 不大于总损失时间 L=${lostTime}s，没有可分配的有效绿`,
      { details: { cycle, lostTime } },
    );
  }

  const hasMinGreen = phases.some((p) => p.minGreen > 0);

  let greens: number[];

  if (!hasMinGreen) {
    // 按流量比分配；Y=0（全场无到达）时等分。
    const Y = ys.reduce((a, b) => a + b, 0);
    if (Y === 0) {
      greens = ys.map(() => effectiveGreen / n);
    } else {
      greens = ys.map((y) => (effectiveGreen * y) / Y);
    }
  } else {
    // 1) 先保住最小绿
    const mins = phases.map((p) => p.minGreen);
    const sumMin = mins.reduce((a, b) => a + b, 0);
    if (sumMin > effectiveGreen + BALANCE_TOLERANCE) {
      throw new TimingError(
        'MIN_GREEN_INFEASIBLE',
        `周期 C=${cycle}s 下可分配有效绿仅 ${effectiveGreen.toFixed(3)}s，小于各相位最小绿之和 ${sumMin.toFixed(3)}s，最小绿保不住`,
        { details: { cycle, lostTime, effectiveGreen, sumMinGreen: sumMin, minGreen: mins } },
      );
    }

    const protectedSet = new Set<number>();
    mins.forEach((m, i) => {
      if (m > 0) protectedSet.add(i);
    });

    // 未受保护的相位优先承接剩余有效绿；若所有相位都设了最小绿，
    // 则由全部相位按流量比在「最低限度」之上继续分摊（最小绿是下限不是上限）。
    const candidate: number[] = [];
    for (let i = 0; i < n; i++) {
      if (protectedSet.size < n) {
        if (!protectedSet.has(i)) candidate.push(i);
      } else {
        candidate.push(i);
      }
    }

    const remainder = effectiveGreen - sumMin;
    const weightSum = candidate.reduce((acc, i) => acc + ys[i], 0);

    greens = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (protectedSet.has(i)) greens[i] = mins[i];
    }
    for (const i of candidate) {
      const base = protectedSet.has(i) ? mins[i] : 0;
      if (weightSum === 0) {
        greens[i] = base + remainder / candidate.length;
      } else {
        greens[i] = base + (remainder * ys[i]) / weightSum;
      }
    }

    // 数值上可能出现的极小负值，归零
    greens = greens.map((g) => (g < 0 && g > -1e-12 ? 0 : g));
  }

  // 2) 压残差：Σg 与 C−L 的微小差并到 y 最大的相位
  let totalGreen = greens.reduce((a, b) => a + b, 0);
  let residual = effectiveGreen - totalGreen;
  if (Math.abs(residual) > 1e-12) {
    let anchor = 0;
    for (let i = 1; i < n; i++) {
      if (ys[i] > ys[anchor]) anchor = i;
    }
    greens[anchor] += residual;
    totalGreen = greens.reduce((a, b) => a + b, 0);
    residual = effectiveGreen - totalGreen;
  }

  // 3) 严格复核：Σg + L = C
  const balanceResidual = Math.abs(totalGreen + lostTime - cycle);
  if (balanceResidual > BALANCE_TOLERANCE) {
    throw new TimingError(
      'GREEN_BALANCE_RESIDUAL',
      `有效绿分配无法凑平周期：|Σg + L − C| = ${balanceResidual.toExponential(3)}s 超过容差 ${BALANCE_TOLERANCE}s`,
      {
        details: {
          cycle,
          lostTime,
          totalGreen,
          balanceResidual,
          tolerance: BALANCE_TOLERANCE,
          greens,
        },
      },
    );
  }

  return { greens, totalGreen, residual: balanceResidual };
}
