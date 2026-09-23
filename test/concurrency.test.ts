import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/http/server';
import { InMemoryScenarioRepository } from '../src/persistence/memoryRepository';
import { analyze } from '../src/domain/analyze';
import type { TimingInput } from '../src/domain/types';

/**
 * 多份工况并行核算：各自的流量比、周期与延误互不串扰。
 */
describe('并发隔离', () => {
  let app: FastifyInstance;
  before(async () => {
    app = buildServer({ repository: new InMemoryScenarioRepository() });
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('30 份不同工况并发 /api/delay，结果与各自串行核算逐一吻合', async () => {
    // 所有 k 下 Y ≤ 0.55，指定周期（≥60s、有效绿 ≥50s）均远离相位饱和
    const cases: TimingInput[] = Array.from({ length: 30 }, (_, k) => ({
      lostTime: 6 + (k % 6),
      phases: [
        { name: `a${k}`, q: 200 + 5 * k, s: 1800 },
        { name: `b${k}`, q: 300 + 4 * k, s: 1800 },
        { name: `c${k}`, q: 120 + 3 * k, s: 1800 },
      ],
    }));

    const responses = await Promise.all(
      cases.map((body, k) =>
        app.inject({
          method: 'POST',
          url: '/api/delay',
          payload: k % 3 === 0 ? { ...body, cycle: 60 + 2 * k } : body,
        }),
      ),
    );

    responses.forEach((res, k) => {
      assert.equal(res.statusCode, 200, `case ${k} 失败: ${res.body}`);
      const expected = analyze(
        cases[k],
        k % 3 === 0 ? { cycle: 60 + 2 * k } : {},
      );
      const got = res.json();
      assert.ok(Math.abs(got.Y - expected.Y) < 1e-12, `case ${k} Y 串扰`);
      assert.ok(Math.abs(got.cycle - expected.cycle) < 1e-9, `case ${k} 周期串扰`);
      assert.ok(
        Math.abs(got.totalUniformDelay - expected.totalUniformDelay) < 1e-6,
        `case ${k} 延误串扰`,
      );
      got.phases.forEach(
        (p: { q: number; s: number; y: number; lambda: number; x: number }, i: number) => {
          assert.equal(p.q, expected.phases[i].q, `case ${k} 相位 ${i} 的 q 串扰`);
          assert.equal(p.s, expected.phases[i].s, `case ${k} 相位 ${i} 的 s 串扰`);
          assert.ok(Math.abs(p.y - expected.phases[i].y) < 1e-12);
          assert.ok(Math.abs(p.lambda - expected.phases[i].lambda) < 1e-12);
          assert.ok(Math.abs(p.x - expected.phases[i].x) < 1e-12);
        },
      );
    });
  });

  it('同一工况的并行扫描之间不共享可变状态', async () => {
    const body = {
      lostTime: 12,
      phases: [
        { q: 360, s: 1800 },
        { q: 450, s: 1800 },
        { q: 255, s: 1700 },
        { q: 170, s: 1700 },
      ],
    };
    const ranges = [
      { fromCycle: 45, toCycle: 120, step: 15 },
      { fromCycle: 60, toCycle: 240, step: 30 },
      { fromCycle: 80, toCycle: 200, step: 40 },
      { fromCycle: 50, toCycle: 300, step: 25 },
    ];
    const results = await Promise.all(
      ranges.map((r) => app.inject({ method: 'POST', url: '/api/scan', payload: { ...body, ...r } })),
    );
    results.forEach((res, i) => {
      assert.equal(res.statusCode, 200, res.body);
      const expectedCount =
        Math.floor((ranges[i].toCycle - ranges[i].fromCycle) / ranges[i].step) + 1;
      assert.equal(res.json().points.length, expectedCount);
    });
  });
});
