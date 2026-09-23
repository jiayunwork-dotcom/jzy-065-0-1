import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TimingError } from '../src/domain/errors';
import { allocateGreens, BALANCE_TOLERANCE } from '../src/domain/greenSplit';
import type { NormalizedPhase } from '../src/domain/types';

const ph = (q: number, s: number, minGreen = 0): NormalizedPhase => ({ q, s, minGreen });

const demoPhases = () => [ph(360, 1800), ph(450, 1800), ph(255, 1700), ph(170, 1700)];
const demoYs = () => [0.2, 0.25, 0.15, 0.1];

describe('有效绿分配', () => {
  it('g = (C−L)·y/Y 按流量比分配', () => {
    const C = 60;
    const L = 12;
    const { greens } = allocateGreens(demoPhases(), demoYs(), C, L);
    const eg = C - L;
    assert.ok(Math.abs(greens[0] - (eg * 0.2) / 0.7) < 1e-9);
    assert.ok(Math.abs(greens[1] - (eg * 0.25) / 0.7) < 1e-9);
    assert.ok(Math.abs(greens[2] - (eg * 0.15) / 0.7) < 1e-9);
    assert.ok(Math.abs(greens[3] - (eg * 0.1) / 0.7) < 1e-9);
  });

  it('Σg + L 严格等于 C（残差压进容差）', () => {
    for (const C of [30.123, 60, 76.6666666667, 137, 1000]) {
      const L = 12;
      const { greens, totalGreen, residual } = allocateGreens(demoPhases(), demoYs(), C, L);
      assert.ok(residual <= BALANCE_TOLERANCE, `C=${C} 残差 ${residual}`);
      assert.ok(Math.abs(greens.reduce((a, b) => a + b, 0) + L - C) <= BALANCE_TOLERANCE);
      assert.equal(totalGreen, greens.reduce((a, b) => a + b, 0));
    }
  });

  it('周期不大于损失时间时拒绝', () => {
    assert.throws(
      () => allocateGreens(demoPhases(), demoYs(), 12, 12),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_CYCLE',
    );
  });

  it('先保住最小绿、剩余按流量比分配', () => {
    // C=90，L=12，有效绿 78；相位 3 最小绿 20，其余相位按 y 比例分 58
    const phases = demoPhases();
    phases[3] = ph(170, 1700, 20);
    const { greens } = allocateGreens(phases, demoYs(), 90, 12);
    assert.ok(Math.abs(greens[3] - 20) < 1e-9);
    const restWeight = 0.2 + 0.25 + 0.15;
    assert.ok(Math.abs(greens[0] - (58 * 0.2) / restWeight) < 1e-9);
    assert.ok(Math.abs(greens[1] - (58 * 0.25) / restWeight) < 1e-9);
    assert.ok(Math.abs(greens[2] - (58 * 0.15) / restWeight) < 1e-9);
    assert.ok(Math.abs(greens.reduce((a, b) => a + b, 0) + 12 - 90) <= BALANCE_TOLERANCE);
  });

  it('ΣminGreen 超过可分配有效绿时报错，不削零任何相位', () => {
    const phases = [ph(100, 1000, 20), ph(100, 1000, 20)];
    try {
      allocateGreens(phases, [0.1, 0.1], 30, 10); // 有效绿仅 20，最小绿和 40
      assert.fail('应当 MIN_GREEN_INFEASIBLE');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'MIN_GREEN_INFEASIBLE');
      assert.equal((err.details as { sumMinGreen: number }).sumMinGreen, 40);
    }
  });

  it('Y=0（全场零到达）等分有效绿，残差仍为零', () => {
    const { greens, residual } = allocateGreens([ph(0, 1000), ph(0, 1000)], [0, 0], 20, 10);
    assert.deepEqual(greens, [5, 5]);
    assert.equal(residual, 0);
  });
});
