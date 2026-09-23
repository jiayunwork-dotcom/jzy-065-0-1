import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TimingError } from '../src/domain/errors';
import { analyze } from '../src/domain/analyze';
import { scanCycles } from '../src/domain/scan';
import type { TimingInput } from '../src/domain/types';

const demo = (): TimingInput => ({
  lostTime: 12,
  phases: [
    { name: '东西直行', q: 360, s: 1800 },
    { name: '东西左转', q: 450, s: 1800 },
    { name: '南北直行', q: 255, s: 1700 },
    { name: '南北左转', q: 170, s: 1700 },
  ],
});

describe('候选周期扫描', () => {
  it('每个点都用该周期现算：点值与 analyze(cycle) 逐一相等', async () => {
    const r = await scanCycles(demo(), {
      fromCycle: 50,
      toCycle: 120,
      step: 10,
      model: 'webster-full',
    });
    assert.equal(r.points.length, 8);
    assert.equal(r.aborted, false);
    for (const point of r.points) {
      assert.equal(point.feasible, true);
      const fresh = analyze(demo(), { cycle: point.cycle, model: 'webster-full' });
      assert.ok(Math.abs((point.totalDelay ?? NaN) - fresh.totalDelay) < 1e-6);
      assert.ok(Math.abs((point.totalUniformDelay ?? NaN) - fresh.totalUniformDelay) < 1e-6);
      point.phases?.forEach((pp, i) => {
        assert.ok(Math.abs(pp.g - fresh.phases[i].g) < 1e-9);
        assert.ok(Math.abs(pp.lambda - fresh.phases[i].lambda) < 1e-12);
        assert.ok(Math.abs(pp.x - fresh.phases[i].x) < 1e-12);
      });
    }
  });

  it('点上的绿信比随周期变化（不是回放同一条曲线）', async () => {
    const r = await scanCycles(demo(), { fromCycle: 50, toCycle: 90, step: 20 });
    const l0 = r.points.map((p) => p.phases?.[0].lambda ?? -1);
    assert.ok(l0.every((v) => v > 0));
    // 周期越长 λ_i = y_i/Y·(1−L/C) 越大
    assert.ok(l0[1] > l0[0]);
    assert.ok(l0[2] > l0[1]);
  });

  it('全 Webster 模型：合计延误先降后升，存在谷底（空放回升）', async () => {
    const r = await scanCycles(demo(), { fromCycle: 45, toCycle: 300, step: 15 });
    const totals = r.points.filter((p) => p.feasible).map((p) => p.totalDelay as number);
    assert.ok(totals.length >= 10);
    const minIdx = totals.indexOf(Math.min(...totals));
    assert.ok(minIdx > 0, '谷底不应在扫描左边界');
    assert.ok(minIdx < totals.length - 1, '谷底不应在右边界');
    // 谷底两侧均存在更高点
    assert.ok(totals[0] > totals[minIdx]);
    assert.ok(totals[totals.length - 1] > totals[minIdx]);
  });

  it('仅均匀项：合计延误在可行周期内非降（证明扫描按指定模型现算）', async () => {
    const r = await scanCycles(demo(), {
      fromCycle: 45,
      toCycle: 300,
      step: 15,
      model: 'uniform-only',
    });
    const totals = r.points.filter((p) => p.feasible).map((p) => p.totalDelay as number);
    for (let i = 1; i < totals.length; i++) {
      assert.ok(totals[i] >= totals[i - 1] - 1e-6, `C 点 ${i} 不应下降`);
    }
  });

  it('小周期不可行点保留在曲线上并带原因，不中断扫描', async () => {
    const r = await scanCycles(demo(), { fromCycle: 20, toCycle: 80, step: 10 });
    const bad = r.points.filter((p) => !p.feasible);
    assert.ok(bad.length > 0);
    assert.ok(bad.every((p) => typeof p.reason === 'string' && p.code));
    const good = r.points.filter((p) => p.feasible);
    assert.ok(good.length > 0);
    // 曲线按周期递增
    const cycles = r.points.map((p) => p.cycle);
    assert.deepEqual(cycles, [...cycles].sort((a, b) => a - b));
  });

  it('整体过饱和在扫描前拒绝，不产出半条点列', async () => {
    const input: TimingInput = {
      lostTime: 12,
      phases: [
        { q: 1782, s: 1800 },
        { q: 100, s: 1800 },
      ],
    };
    try {
      await scanCycles(input, { fromCycle: 30, toCycle: 300, step: 10 });
      assert.fail('应拒绝');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'OVERSATURATED');
    }
  });

  it('范围非法时报错', async () => {
    await assert.rejects(
      () => scanCycles(demo(), { fromCycle: 100, toCycle: 50, step: 10 }),
      (e: unknown) => e instanceof TimingError && e.code === 'INVALID_SCAN_RANGE',
    );
    await assert.rejects(
      () => scanCycles(demo(), { fromCycle: 20, toCycle: 50, step: 0 }),
      (e: unknown) => e instanceof TimingError && e.code === 'INVALID_SCAN_RANGE',
    );
    await assert.rejects(
      () => scanCycles(demo(), { fromCycle: 5, toCycle: 50, step: 1 }), // from ≤ L
      (e: unknown) => e instanceof TimingError && e.code === 'INVALID_SCAN_RANGE',
    );
  });

  it('开始前已取消：抛 SCAN_CANCELLED，没有结果', async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => scanCycles(demo(), { fromCycle: 30, toCycle: 300, step: 10, signal: ac.signal }),
      (e: unknown) => e instanceof TimingError && e.code === 'SCAN_CANCELLED',
    );
  });

  it('扫描中途取消：绝不返回只算一半的点列', async () => {
    const ac = new AbortController();
    let cancelled = false;
    const promise = scanCycles(
      demo(),
      // 密点长扫描，保证在中途才被取消
      { fromCycle: 13, toCycle: 2013, step: 1, signal: ac.signal },
    );
    const t = setTimeout(() => {
      cancelled = true;
      ac.abort();
    }, 20);
    try {
      await promise;
      assert.fail('取消后不应返回完整结果');
    } catch (err) {
      assert.ok(cancelled, '取消应确实在扫描过程中发生');
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'SCAN_CANCELLED');
      const done = (err.details as { completedPoints: number }).completedPoints;
      assert.ok(done > 0, '应当已算过部分点（验证确实是中途取消）');
      assert.ok(done < 2001, '不应算完全部点');
    } finally {
      clearTimeout(t);
    }
  });

  it('默认范围围绕 C0 自动生成', async () => {
    const r = await scanCycles(demo());
    assert.equal(r.model, 'webster-full');
    assert.ok(r.points.length >= 5);
    assert.ok(r.points[0].cycle <= 76.67);
  });
});
