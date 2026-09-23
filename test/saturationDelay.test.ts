import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  degreeOfSaturation,
  findSaturatedPhase,
  isPhaseSaturated,
} from '../src/domain/saturation';
import { overflowDelay, uniformDelay } from '../src/domain/delay';

describe('相位饱和度', () => {
  it('x = y/λ = q/(λs)', () => {
    assert.ok(Math.abs(degreeOfSaturation(0.2, 0.24) - 0.8333333333) < 1e-9);
  });

  it('x≥1 判饱和（含浮点边界）', () => {
    assert.equal(isPhaseSaturated(0.999), false);
    assert.equal(isPhaseSaturated(1), true);
    assert.equal(isPhaseSaturated(1.0001), true);
    assert.equal(isPhaseSaturated(1 - 5e-10), true); // 容差内也算
  });

  it('λ=0：零到达 x=0；有到达 x=Infinity', () => {
    assert.equal(degreeOfSaturation(0, 0), 0);
    assert.equal(degreeOfSaturation(0.1, 0), Number.POSITIVE_INFINITY);
  });

  it('findSaturatedPhase 找第一个饱和相位', () => {
    const sp = findSaturatedPhase([0.8, 0.95, 1.02], ['a', 'b', 'c']);
    assert.deepEqual(sp, { index: 2, name: 'c', x: 1.02 });
    assert.equal(findSaturatedPhase([0.5, 0.9], ['a', 'b']), null);
  });
});

describe('Webster 均匀延误第一项', () => {
  it('d = 0.5·C·(1−λ)²/(1−λ·x) —— 手算值（C=60, λ=0.228571, x=0.875）', () => {
    const d = uniformDelay(60, 0.228571428571, 0.875, 360);
    // 0.5*60*0.7714286^2/(1-0.2) = 30*0.595102/0.8 ≈ 22.3163
    assert.ok(Math.abs(d - 22.31632653) < 1e-6);
  });

  it('q=0 的相位延误为 0', () => {
    assert.equal(uniformDelay(60, 0.2, 0, 0), 0);
  });

  it('x 增大、其余不变时延误上升', () => {
    const dLow = uniformDelay(60, 0.3, 0.5, 500);
    const dHigh = uniformDelay(60, 0.3, 0.9, 500);
    assert.ok(dHigh > dLow);
  });

  it('第二项溢出延误：x→1 发散，x≥1 为 Infinity，q=0 为 0', () => {
    assert.equal(overflowDelay(0, 0.9), 0);
    assert.equal(overflowDelay(500, 1), Number.POSITIVE_INFINITY);
    assert.ok(overflowDelay(500, 0.95) > overflowDelay(500, 0.5));
  });
});
