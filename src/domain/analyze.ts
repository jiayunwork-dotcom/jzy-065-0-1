/**
 * 配时核算核心 —— 一次核算的单一事实源。
 *
 * 核算链（顺序不可调换，校验卡在公式之前）：
 *   1. 输入校验（相位 ≥ 2、q ≥ 0、s > 0、L > 0）
 *   2. y_i = q_i/s_i，Y = Σy
 *   3. C0 = (1.5L + 5)/(1−Y)；Y ≥ 0.99 直接判整体过饱和
 *   4. 绿信比分配（先保最小绿，剩余按流量比），复核 Σg + L = C
 *   5. x_i = y_i/λ_i；任一 x_i ≥ 1，该相位单独报饱和
 *   6. 延误 d1_i = 0.5C(1−λ)²/(1−λx)，相位延误率 q·d，合计延误
 *
 * 流量比与延误共用本函数内同一组归一化 q/s/y —— 调用方无法、
 * 本模块也不会拿两套到达率分别算配时和延误。
 */

import { optimalCycle } from './cycle';
import { uniformDelay, overflowDelay } from './delay';
import { TimingError } from './errors';
import { flowRatios, totalFlowRatio } from './flowRatios';
import { allocateGreens } from './greenSplit';
import {
  degreeOfSaturation,
  findSaturatedPhase,
  phaseSaturationError,
} from './saturation';
import type {
  DelayModel,
  NormalizedPhase,
  PhaseResult,
  TimingResult,
} from './types';
import { validateTimingInput } from './validation';

export interface AnalyzeOptions {
  /** 指定周期；不给则用 Webster C0 */
  cycle?: number;
  /** 延误模型：默认 webster-full（延误分析用），uniform-only 严格只取第一项 */
  model?: DelayModel;
}

export function analyze(
  input: unknown,
  options: AnalyzeOptions = {},
): TimingResult {
  // 1) 校验
  const { phases, lostTime } = validateTimingInput(input);

  // 2) 流量比（同一组 q/s，下面所有结果都从这里出）
  const ys = flowRatios(phases);
  const Y = totalFlowRatio(ys);

  // 3) 最佳周期 / 所用周期 —— 整体过饱和在求解前拒绝
  const C0 = optimalCycle(Y, lostTime);

  let cycle: number;
  let cycleSource: 'auto' | 'specified';
  if (options.cycle === undefined) {
    cycle = C0;
    cycleSource = 'auto';
  } else {
    const c = options.cycle;
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      throw new TimingError('INVALID_CYCLE', '指定周期必须是有限数字（秒）', {
        fields: [{ field: 'cycle', reason: 'not a finite number' }],
      });
    }
    if (c <= 0) {
      throw new TimingError('INVALID_CYCLE', `指定周期必须为正，实际为 ${c}`, {
        details: { cycle: c },
      });
    }
    if (c <= lostTime) {
      throw new TimingError(
        'INVALID_CYCLE',
        `指定周期 C=${c}s 不大于总损失时间 L=${lostTime}s，没有可分配的有效绿`,
        { details: { cycle: c, lostTime } },
      );
    }
    cycle = c;
    cycleSource = 'specified';
  }

  // 4) 绿信比分配（含最小绿保护与 Σg+L=C 严格复核）
  const split = allocateGreens(phases, ys, cycle, lostTime);

  const model: DelayModel = options.model ?? 'webster-full';

  // 5)+6) 逐相位：饱和度判定先于延误；所有量都出自同一组 q,s,y
  const lambdas = split.greens.map((g) => g / cycle);
  const xs = ys.map((y, i) => degreeOfSaturation(y, lambdas[i]));

  const saturated = findSaturatedPhase(
    xs,
    phases.map((p) => p.name),
  );
  if (saturated) {
    throw phaseSaturationError(saturated, cycle);
  }

  const phaseResults: PhaseResult[] = phases.map((p, i) =>
    evaluatePhase(p, i, ys[i], split.greens[i], lambdas[i], xs[i], cycle, model),
  );

  const totalUniformDelay = phaseResults.reduce(
    (acc, r) => acc + r.totalUniformDelayRate,
    0,
  );
  const totalDelay = phaseResults.reduce((acc, r) => acc + r.totalDelayRate, 0);

  return {
    phases: phaseResults,
    Y,
    lostTime,
    cycle,
    optimalCycle: C0,
    cycleSource,
    totalGreen: split.totalGreen,
    balanceResidual: split.residual,
    totalUniformDelay,
    totalDelay,
  };
}

/** 单相位评估。y 必须由调用方从同一组 q/s 算出，这里再做一道一致性防线。 */
function evaluatePhase(
  p: NormalizedPhase,
  index: number,
  y: number,
  g: number,
  lambda: number,
  x: number,
  cycle: number,
  model: DelayModel,
): PhaseResult {
  // 防串扰防线：y 必须与本相位 q/s 严格一致
  if (Math.abs(y - p.q / p.s) > 1e-12) {
    throw new TimingError(
      'ARRIVAL_RATE_MISMATCH',
      `相位 #${index} 的流量比与到达率不一致：配时与延误必须共用同一组 q`,
      { details: { phaseIndex: index, y, q: p.q, s: p.s } },
    );
  }

  const d1 = uniformDelay(cycle, lambda, x, p.q);
  const d2 = model === 'webster-full' ? overflowDelay(p.q, x) : 0;
  const dTotal = d1 + d2;

  return {
    index,
    name: p.name,
    q: p.q,
    s: p.s,
    y,
    g,
    lambda,
    x,
    uniformDelay: d1,
    overflowDelay: d2,
    totalUniformDelayRate: p.q * d1,
    totalDelayPerVehicle: dTotal,
    totalDelayRate: p.q * dTotal,
  };
}
