import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/http/server';
import { InMemoryScenarioRepository } from '../src/persistence/memoryRepository';
import { PRESETS } from '../src/domain/presets';

const demoBody = () => ({
  lostTime: 12,
  phases: [
    { name: '东西直行', q: 360, s: 1800 },
    { name: '东西左转', q: 450, s: 1800 },
    { name: '南北直行', q: 255, s: 1700 },
    { name: '南北左转', q: 170, s: 1700 },
  ],
});

describe('HTTP 端到端', async () => {
  let app: FastifyInstance;
  let repo: InMemoryScenarioRepository;

  before(async () => {
    repo = new InMemoryScenarioRepository();
    for (const p of Object.values(PRESETS)) await repo.upsert(p);
    app = buildServer({ repository: repo });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await repo.close();
  });

  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'ok');
  });

  it('POST /api/timing 返回 Y、最佳周期与各相位绿信比', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/timing',
      payload: demoBody(),
    });
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.Y, 0.7);
    assert.ok(Math.abs(b.optimalCycle - 76.6666666667) < 1e-6);
    assert.equal(b.phases.length, 4);
    assert.ok(b.phases[0].lambda > 0);
    assert.equal(b.phases[0].uniformDelay, undefined); // 配时接口不回延误
  });

  it('POST /api/delay 返回饱和度、均匀延误与合计延误；自动周期', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/delay',
      payload: demoBody(),
    });
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.cycleSource, 'auto');
    const sumRate = b.phases.reduce(
      (a: number, p: { q: number; uniformDelay: number }) => a + p.q * p.uniformDelay,
      0,
    );
    assert.ok(Math.abs(sumRate - b.totalUniformDelay) < 1e-6);
    for (const p of b.phases) assert.ok(p.x < 1);
  });

  it('POST /api/delay 指定周期', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/delay',
      payload: { ...demoBody(), cycle: 60 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().cycle, 60);
    assert.equal(res.json().cycleSource, 'specified');
  });

  it('指定周期等于自动 C0 时，两接口绿信比延误一致', async () => {
    const auto = (
      await app.inject({ method: 'POST', url: '/api/delay', payload: demoBody() })
    ).json();
    const spec = (
      await app.inject({
        method: 'POST',
        url: '/api/delay',
        payload: { ...demoBody(), cycle: auto.cycle },
      })
    ).json();
    auto.phases.forEach((p: { lambda: number; uniformDelay: number }, i: number) => {
      assert.ok(Math.abs(p.lambda - spec.phases[i].lambda) < 1e-12);
      assert.ok(Math.abs(p.uniformDelay - spec.phases[i].uniformDelay) < 1e-9);
    });
  });

  it('请求形状非法 -> 400 带字段原因', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/timing',
      payload: { lostTime: 12, phases: [{ q: 10, s: 1000 }] },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'INVALID_INPUT');
  });

  it('q 为负 / L 为负 -> 400', async () => {
    const bad1 = await app.inject({
      method: 'POST',
      url: '/api/timing',
      payload: { lostTime: 12, phases: [{ q: -1, s: 1000 }, { q: 1, s: 1000 }] },
    });
    assert.equal(bad1.statusCode, 400);
    const bad2 = await app.inject({
      method: 'POST',
      url: '/api/timing',
      payload: { lostTime: -1, phases: [{ q: 1, s: 1000 }, { q: 1, s: 1000 }] },
    });
    assert.equal(bad2.statusCode, 400);
  });

  it('整体过饱和 -> 422 且附 Y；两条配时路径一致', async () => {
    const payload = {
      lostTime: 12,
      phases: [
        { q: 1782, s: 1800 },
        { q: 100, s: 1800 },
      ],
    };
    const r1 = await app.inject({ method: 'POST', url: '/api/timing', payload });
    assert.equal(r1.statusCode, 422);
    assert.equal(r1.json().error, 'OVERSATURATED');
    assert.ok(r1.json().details.Y >= 0.99);
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/delay',
      payload: { ...payload, cycle: 200 },
    });
    assert.equal(r2.statusCode, 422);
    assert.equal(r2.json().error, 'OVERSATURATED');
  });

  it('相位饱和 -> 422，带相位下标', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/delay',
      payload: { ...demoBody(), cycle: 30 },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error, 'PHASE_SATURATED');
    assert.equal(typeof res.json().details.phaseIndex, 'number');
  });

  it('最小绿保不住 -> 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/delay',
      payload: {
        lostTime: 10,
        cycle: 30,
        phases: [
          { q: 100, s: 1000, minGreen: 30 },
          { q: 100, s: 1000, minGreen: 30 },
        ],
      },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error, 'MIN_GREEN_INFEASIBLE');
  });

  it('POST /api/scan 回曲线点列', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { ...demoBody(), fromCycle: 50, toCycle: 120, step: 10 },
    });
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.aborted, false);
    assert.equal(b.points.length, 8);
    assert.ok(b.points.every((p: { feasible: boolean }) => p.feasible));
  });

  it('扫描范围非法 -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { ...demoBody(), fromCycle: 200, toCycle: 50, step: 10 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'INVALID_SCAN_RANGE');
  });

  it('工况档：列出含预置、取回、重算、扫描、404、409、删除保护', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/scenarios' });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().scenarios.some((s: { name: string }) => s.name === 'demo-four-phase'));

    const got = await app.inject({ method: 'GET', url: '/api/scenarios/demo-four-phase' });
    assert.equal(got.statusCode, 200);
    assert.equal(got.json().phases.length, 4);

    const rec = await app.inject({
      method: 'POST',
      url: '/api/scenarios',
      payload: { name: 'case-a', lostTime: 12, phases: demoBody().phases },
    });
    assert.equal(rec.statusCode, 201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/scenarios',
      payload: { name: 'case-a', lostTime: 12, phases: demoBody().phases },
    });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().error, 'SCENARIO_EXISTS');

    const recompute = await app.inject({
      method: 'POST',
      url: '/api/scenarios/case-a/recompute',
      payload: { cycle: 60 },
    });
    assert.equal(recompute.statusCode, 200);
    assert.equal(recompute.json().cycle, 60);
    assert.equal(recompute.json().scenario, 'case-a');

    const scan = await app.inject({
      method: 'POST',
      url: '/api/scenarios/case-a/scan',
      payload: { fromCycle: 50, toCycle: 90, step: 20 },
    });
    assert.equal(scan.statusCode, 200);
    assert.equal(scan.json().points.length, 3);

    const missing = await app.inject({ method: 'GET', url: '/api/scenarios/nope' });
    assert.equal(missing.statusCode, 404);

    const delPreset = await app.inject({
      method: 'DELETE',
      url: '/api/scenarios/demo-four-phase',
    });
    assert.equal(delPreset.statusCode, 400);

    const del = await app.inject({ method: 'DELETE', url: '/api/scenarios/case-a' });
    assert.equal(del.statusCode, 204);
  });

  it('建档时语义校验仍生效（s=0 -> 400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenarios',
      payload: {
        name: 'bad',
        lostTime: 12,
        phases: [
          { q: 10, s: 0 },
          { q: 10, s: 1000 },
        ],
      },
    });
    assert.equal(res.statusCode, 400);
  });
});
