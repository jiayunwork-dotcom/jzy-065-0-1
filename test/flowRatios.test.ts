import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flowRatios, totalFlowRatio } from '../src/domain/flowRatios';
import { isOversaturated, optimalCycle } from '../src/domain/cycle';
import { TimingError } from '../src/domain/errors';
import type { NormalizedPhase } from '../src/domain/types';

const ph = (q: number, s: number, minGreen = 0): NormalizedPhase => ({ q, s, minGreen });

describe('流量比', () => {
  it('y = q/s，Y = Σy', () => {
    const ys = flowRatios([ph(360, 1800), ph(450, 1800), ph(255, 1700), ph(170, 1700)]);
    assert.deepEqual(ys, [0.2, 0.25, 0.15, 0.1]);
    assert.equal(totalFlowRatio(ys), 0.7);
  });

  it('零到达相位 y=0', () => {
    assert.deepEqual(flowRatios([ph(0, 1000), ph(500, 1000)]), [0, 0.5]);
  });
});

describe('Webster 最佳周期', () => {
  it('C0 = (1.5L+5)/(1−Y) —— 预置算例落 76.7s', () => {
    assert.ok(Math.abs(optimalCycle(0.7, 12) - 76.6666666667) < 1e-6);
  });

  it('Y 趋近 1 时周期急剧变大', () => {
    const c70 = optimalCycle(0.7, 12);
    const c95 = optimalCycle(0.95, 12);
    const c98 = optimalCycle(0.98, 12);
    assert.ok(Math.abs(c95 - 460) < 1e-9);
    assert.ok(Math.abs(c98 - 1150) < 1e-9);
    assert.ok(c98 > c95 * 2);
    assert.ok(c95 > c70 * 5);
  });

  it('Y 达到 0.99 裕度线即过饱和，不吐出假周期', () => {
    assert.equal(isOversaturated(0.9899999), false);
    assert.equal(isOversaturated(0.99), true);
    assert.equal(isOversaturated(1), true);
    assert.equal(isOversaturated(1.2), true);
    for (const Y of [0.99, 0.995, 1, 1.1]) {
      try {
        optimalCycle(Y, 12);
        assert.fail(`Y=${Y} 必须拒绝`);
      } catch (err) {
        assert.ok(err instanceof TimingError);
        assert.equal(err.code, 'OVERSATURATED');
        assert.equal((err.details as { Y: number }).Y, Y);
      }
    }
  });
});
