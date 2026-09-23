import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyze } from '../src/domain/analyze';
import { TimingError } from '../src/domain/errors';
import { PRESETS } from '../src/domain/presets';
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

describe('四相位预置算例数量级', () => {
  it('Y≈0.70，C0≈76.7s（落在文献常见 50–80s 区间量级）', () => {
    const r = analyze(demo());
    assert.equal(r.Y, 0.7);
    assert.ok(Math.abs(r.optimalCycle - 23 / 0.3) < 1e-9);
    assert.ok(r.optimalCycle > 50 && r.optimalCycle < 90);
    assert.equal(r.cycleSource, 'auto');
  });

  it('绿信比与流量比成比例，Σλ = 1 − L/C', () => {
    const r = analyze(demo());
    const sumLambda = r.phases.reduce((a, p) => a + p.lambda, 0);
    assert.ok(Math.abs(sumLambda - (1 - 12 / r.cycle)) < 1e-9);
    for (const p of r.phases) {
      assert.ok(Math.abs(p.lambda / p.y - (r.cycle - 12) / (r.cycle * 0.7)) < 1e-9);
    }
  });

  it('合计延误为各相位 q·d 之和，单位 秒/小时', () => {
    const r = analyze(demo());
    const recomputed = r.phases.reduce((a, p) => a + p.q * p.uniformDelay, 0);
    assert.ok(Math.abs(recomputed - r.totalUniformDelay) < 1e-6);
    assert.ok(r.totalUniformDelay > 30000 && r.totalUniformDelay < 40000);
  });

  it('预置档内容与代码算例一致', () => {
    const p = PRESETS['demo-four-phase'];
    assert.equal(p.phases.length, 4);
    assert.equal(p.lostTime, 12);
    const r = analyze({ phases: p.phases, lostTime: p.lostTime });
    assert.equal(r.Y, 0.7);
  });
});

describe('Σg + L = C 在各周期下严格成立', () => {
  for (const C of [50, 60, 76.66666667, 120, 300, 1000]) {
    it(`指定周期 C=${C} 配平`, () => {
      const r = analyze(demo(), { cycle: C });
      const sumG = r.phases.reduce((a, p) => a + p.g, 0);
      assert.ok(Math.abs(sumG + r.lostTime - C) < 1e-6);
      assert.ok(r.balanceResidual < 1e-6);
      for (const p of r.phases) {
        assert.ok(Math.abs(p.g / C - p.lambda) < 1e-12);
      }
    });
  }
});

describe('损失时间增大（其余不动）', () => {
  it('最佳周期上升', () => {
    const a = analyze(demo());
    const b = analyze({ ...demo(), lostTime: 24 });
    assert.ok(b.optimalCycle > a.optimalCycle);
    assert.ok(b.cycle > a.cycle);
  });

  it('各相位均匀延误不下降', () => {
    const a = analyze(demo());
    const b = analyze({ ...demo(), lostTime: 24 });
    a.phases.forEach((pa, i) => {
      assert.ok(
        b.phases[i].uniformDelay >= pa.uniformDelay - 1e-9,
        `相位 ${pa.name} 延误 ${pa.uniformDelay} -> ${b.phases[i].uniformDelay} 不应下降`,
      );
    });
  });

  it('损失增大时绿信比整体被压缩、饱和度不降（x = Y/(1−L/C0)）', () => {
    const a = analyze(demo());
    const b = analyze({ ...demo(), lostTime: 24 });
    const xA = 0.7 / (1 - 12 / (230 / 3)); // = 161/194 ≈ 0.8299
    a.phases.forEach((pa, i) => {
      assert.ok(Math.abs(pa.x - xA) < 1e-12);
      assert.ok(b.phases[i].x >= pa.x - 1e-9);
      assert.ok(b.phases[i].lambda < pa.lambda);
    });
  });
});

describe('单相位到达流率加倍（仍 Y<1）', () => {
  it('该相位流量比与绿信比上升、其余相位被挤占', () => {
    const before = analyze(demo());
    const doubled = demo();
    doubled.phases[3] = { ...doubled.phases[3], q: 340 }; // 170 -> 340，y 0.1->0.2，Y=0.8
    const after = analyze(doubled);

    assert.ok(after.Y < 0.99);
    assert.ok(after.phases[3].y > before.phases[3].y);
    assert.ok(after.phases[3].lambda > before.phases[3].lambda);
    for (let i = 0; i < 3; i++) {
      assert.ok(after.phases[i].y === before.phases[i].y);
      assert.ok(
        after.phases[i].lambda < before.phases[i].lambda,
        `相位 ${i} 绿灯应被挤占`,
      );
    }
  });
});

describe('Y 趋近 1 的越界行为 —— 两条路径都不给正的有限周期', () => {
  const near = (): TimingInput => ({
    lostTime: 12,
    phases: [
      { q: 1510, s: 1800 }, // 1510/1800 + 200/1800 = 0.95
      { q: 200, s: 1800 },
    ],
  });
  const over = (): TimingInput => ({
    lostTime: 12,
    phases: [
      { q: 1782, s: 1800 }, // y = 0.99
      { q: 100, s: 1800 },
    ],
  });

  it('Y=0.95 时周期 460s，Y=0.98 时 1150s，急剧变大', () => {
    assert.ok(Math.abs(analyze(near()).optimalCycle - 460) < 1e-9);
    const input2 = near();
    input2.phases[0] = { q: 1564, s: 1800 }; // 1564+200=1764 → Y=0.98
    assert.ok(Math.abs(analyze(input2).optimalCycle - 1150) < 1e-9);
  });

  it('自动路径：Y≥0.99 返回 OVERSATURATED 并附 Y', () => {
    try {
      analyze(over());
      assert.fail('应拒绝');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'OVERSATURATED');
      assert.ok((err.details as { Y: number }).Y >= 0.99);
    }
  });

  it('指定周期路径：Y≥0.99 同样拒绝，即便给了周期', () => {
    try {
      analyze(over(), { cycle: 300 });
      assert.fail('应拒绝');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'OVERSATURATED');
    }
  });

  it('绝不出现负周期或异常巨大的假周期（Y≥0.99 时结果根本不产生）', () => {
    for (const q of [1782, 1800, 2000]) {
      const body = {
        lostTime: 12,
        phases: [
          { q, s: 1800 },
          { q: 100, s: 1800 },
        ],
      };
      assert.throws(() => analyze(body), (err: unknown) => {
        if (!(err instanceof TimingError)) return false;
        return err.code === 'OVERSATURATED';
      });
    }
  });
});

describe('指定周期 == 自动 C0 的一致性', () => {
  it('绿信比与延误在容差内完全一致', () => {
    const auto = analyze(demo());
    const spec = analyze(demo(), { cycle: auto.optimalCycle });
    assert.equal(spec.cycleSource, 'specified');
    assert.ok(Math.abs(spec.cycle - auto.cycle) < 1e-9);
    auto.phases.forEach((pa, i) => {
      const ps = spec.phases[i];
      assert.ok(Math.abs(pa.g - ps.g) < 1e-9);
      assert.ok(Math.abs(pa.lambda - ps.lambda) < 1e-12);
      assert.ok(Math.abs(pa.x - ps.x) < 1e-12);
      assert.ok(Math.abs(pa.uniformDelay - ps.uniformDelay) < 1e-9);
      assert.ok(Math.abs(pa.totalDelayPerVehicle - ps.totalDelayPerVehicle) < 1e-9);
    });
    assert.ok(Math.abs(auto.totalDelay - spec.totalDelay) < 1e-6);
  });
});

describe('相位级饱和 —— Y<1 但某相位被挤爆', () => {
  it('小周期下首个饱和相位单独报 PHASE_SATURATED，带相位与 x', () => {
    try {
      analyze(demo(), { cycle: 30 });
      assert.fail('应报相位饱和');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'PHASE_SATURATED');
      const d = err.details as { phaseIndex: number; x: number; cycle: number };
      assert.equal(d.cycle, 30);
      assert.ok(d.phaseIndex >= 0);
    }
  });

  it('最小绿保不住时优先报 MIN_GREEN_INFEASIBLE，绝不削零后继续算', () => {
    const input: TimingInput = {
      lostTime: 10,
      phases: [
        { q: 100, s: 1000, minGreen: 30 },
        { q: 100, s: 1000, minGreen: 30 },
      ],
    };
    assert.throws(
      () => analyze(input, { cycle: 30 }), // 有效绿仅 20
      (err: unknown) => err instanceof TimingError && err.code === 'MIN_GREEN_INFEASIBLE',
    );
  });

  it('给足周期后同样输入可正常核算（最小绿是下限，剩余 40s 按等 y 追加）', () => {
    const input: TimingInput = {
      lostTime: 10,
      phases: [
        { q: 100, s: 1000, minGreen: 30 },
        { q: 100, s: 1000, minGreen: 30 },
      ],
    };
    const r = analyze(input, { cycle: 100 });
    assert.equal(r.phases[0].g, 45);
    assert.equal(r.phases[1].g, 45);
    assert.ok(Math.abs(r.phases[0].g + r.phases[1].g + 10 - 100) < 1e-9);
  });
});

describe('流量比与延误共用同一组到达率（防最隐蔽的错）', () => {
  it('结果里每个相位的 y、x、q·d 都与回显的 q/s 自洽', () => {
    const r = analyze(demo());
    for (const p of r.phases) {
      assert.ok(Math.abs(p.y - p.q / p.s) < 1e-12);
      assert.ok(Math.abs(p.x - p.y / p.lambda) < 1e-12);
      assert.ok(Math.abs(p.totalUniformDelayRate - p.q * p.uniformDelay) < 1e-6);
    }
  });

  it('改 q 后重新核算：y、绿信比、延误全部跟着新 q 走，不存在两套 q', () => {
    const a = analyze(demo());
    const changed = demo();
    changed.phases[0] = { ...changed.phases[0], q: 720 }; // 0.2 -> 0.4，Y=0.9
    const b = analyze(changed);
    assert.ok(Math.abs(b.phases[0].y - 0.4) < 1e-12);
    assert.ok(b.phases[0].q === 720);
    assert.ok(b.phases[0].totalUniformDelayRate === b.phases[0].q * b.phases[0].uniformDelay);
    assert.notEqual(b.phases[0].uniformDelay, a.phases[0].uniformDelay);
  });
});

describe('指定周期的输入校验', () => {
  it('非正周期拒绝', () => {
    assert.throws(
      () => analyze(demo(), { cycle: 0 }),
      (e: unknown) => e instanceof TimingError && e.code === 'INVALID_CYCLE',
    );
  });

  it('周期 ≤ 损失时间拒绝', () => {
    assert.throws(
      () => analyze(demo(), { cycle: 12 }),
      (e: unknown) => e instanceof TimingError && e.code === 'INVALID_CYCLE',
    );
  });
});
