/**
 * 候选周期扫描 —— 生成「合计延误随周期变化」的曲线点列。
 *
 * 关键约束：
 *  - 曲线上每个点都用该周期对应的那套绿信比「现算」延误，
 *    不存在预先存好的曲线可回放；
 *  - 是可中断的长作业：每算一个点都检查 AbortSignal 并向事件循环
 *    让出一帧；中途取消时绝不交出半条曲线（抛 SCAN_CANCELLED）；
 *  - 不可行的点（如小周期下某相位饱和）保留在点列里并标 feasible=false，
 *    让工程师看见走势边界，但整体过饱和（Y≥0.99）在扫描前就拒绝。
 */

import { analyze } from './analyze';
import { isOversaturated, SATURATION_MARGIN, Y_LIMIT } from './cycle';
import { TimingError } from './errors';
import { flowRatios, totalFlowRatio } from './flowRatios';
import type { DelayModel, ScanPoint, ScanResult } from './types';
import { validateTimingInput } from './validation';

export interface ScanOptions {
  /** 周期下界，秒（默认 0.5·C0 但至少 L+1） */
  fromCycle?: number;
  /** 周期上界，秒（默认 3·C0） */
  toCycle?: number;
  /** 步长，秒（默认 10） */
  step?: number;
  model?: DelayModel;
  /** 取消信号 */
  signal?: AbortSignal;
}

export const MAX_POINTS = 10000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function scanCycles(
  input: unknown,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { phases, lostTime } = validateTimingInput(input);

  const ys = flowRatios(phases);
  const Y = totalFlowRatio(ys);

  // 整体过饱和：扫描前拒绝，不产出任何点
  if (isOversaturated(Y)) {
    throw new TimingError(
      'OVERSATURATED',
      `总流量比 Y=${Y.toFixed(4)} 已达到或接近 1，任何周期都无法清空来车，扫描无意义`,
      { details: { Y, margin: SATURATION_MARGIN, threshold: Y_LIMIT } },
    );
  }

  // C0（此处 Y < 0.99，一定有限）
  const C0 = (1.5 * lostTime + 5) / (1 - Y);

  const from = options.fromCycle ?? Math.max(lostTime + 1, Math.round(C0 * 0.5));
  const to = options.toCycle ?? Math.round(C0 * 3);
  const step = options.step ?? 10;
  const model: DelayModel = options.model ?? 'webster-full';

  if (![from, to, step].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new TimingError('INVALID_SCAN_RANGE', '扫描范围与步长必须是有限数字');
  }
  if (from <= lostTime) {
    throw new TimingError(
      'INVALID_SCAN_RANGE',
      `起始周期 ${from}s 必须大于损失时间 ${lostTime}s`,
      { details: { from, lostTime } },
    );
  }
  if (to <= from) {
    throw new TimingError(
      'INVALID_SCAN_RANGE',
      `终止周期 ${to}s 必须大于起始周期 ${from}s`,
      { details: { from, to } },
    );
  }
  if (step <= 0) {
    throw new TimingError('INVALID_SCAN_RANGE', `步长必须为正，实际为 ${step}`, {
      details: { step },
    });
  }

  const count = Math.floor((to - from) / step) + 1;
  if (count > MAX_POINTS) {
    throw new TimingError(
      'INVALID_SCAN_RANGE',
      `扫描点数 ${count} 超过上限 ${MAX_POINTS}，请放大步长或收窄范围`,
      { details: { count, max: MAX_POINTS } },
    );
  }

  const signal = options.signal;
  if (signal?.aborted) {
    throw new TimingError('SCAN_CANCELLED', '扫描在开始前已被取消');
  }

  const points: ScanPoint[] = [];

  for (let i = 0; i < count; i++) {
    // 可中断：每点先检查、算完再让出事件循环
    if (signal?.aborted) {
      throw new TimingError('SCAN_CANCELLED', '周期扫描中途被取消，已算点列作废', {
        details: { completedPoints: points.length, plannedPoints: count },
      });
    }

    const cycle = from + i * step;

    let point: ScanPoint;
    try {
      // 现算：每个候选周期独立走一遍完整核算（独立分配绿信比）
      const r = analyze(input, { cycle, model });
      point = {
        cycle,
        feasible: true,
        Y: r.Y,
        totalUniformDelay: r.totalUniformDelay,
        totalDelay: r.totalDelay,
        phases: r.phases.map((p) => ({
          index: p.index,
          name: p.name,
          g: p.g,
          lambda: p.lambda,
          x: p.x,
          uniformDelay: p.uniformDelay,
          totalDelayPerVehicle: p.totalDelayPerVehicle,
        })),
      };
    } catch (err) {
      if (err instanceof TimingError) {
        point = {
          cycle,
          feasible: false,
          reason: err.reason,
          code: err.code,
          Y,
        };
      } else {
        throw err;
      }
    }

    points.push(point);

    // 让出事件循环，使 abort 能在长扫描中被观察到
    await sleep(0);
  }

  if (signal?.aborted) {
    throw new TimingError('SCAN_CANCELLED', '周期扫描在收尾时被取消', {
      details: { completedPoints: points.length },
    });
  }

  return { Y, model, points, aborted: false };
}
