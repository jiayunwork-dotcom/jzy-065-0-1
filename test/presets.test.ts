import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { InMemoryScenarioRepository } from '../src/persistence/memoryRepository';
import { PRESETS, PRESET_NAMES, presetTimingInput } from '../src/domain/presets';
import { analyze } from '../src/domain/analyze';
import type { ScenarioRecord } from '../src/domain/types';

describe('预置算例', () => {
  it('demo-four-phase：四相位、L 十几秒、Y≈0.7、C0 在 50–80s', () => {
    const input = presetTimingInput('demo-four-phase')!;
    assert.equal(input.phases.length, 4);
    assert.ok(input.lostTime >= 10 && input.lostTime <= 20);
    const r = analyze(input);
    assert.ok(Math.abs(r.Y - 0.7) < 1e-9);
    assert.ok(r.optimalCycle >= 50 && r.optimalCycle <= 80);
    assert.deepEqual(PRESET_NAMES, ['demo-four-phase']);
    assert.ok(PRESETS['demo-four-phase'].builtin);
  });

  it('未知预置名返回 undefined', () => {
    assert.equal(presetTimingInput('nope'), undefined);
  });
});

describe('InMemoryScenarioRepository', () => {
  const repos: InMemoryScenarioRepository[] = [];
  afterEach(async () => {
    await Promise.all(repos.map((r) => r.close()));
    repos.length = 0;
  });

  const make = () => {
    const r = new InMemoryScenarioRepository();
    repos.push(r);
    return r;
  };

  const record = (name: string): ScenarioRecord => ({
    name,
    lostTime: 12,
    phases: [
      { q: 100, s: 1000 },
      { q: 200, s: 1000 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('建档/取回/列出/更新/删除', async () => {
    const repo = make();
    assert.equal(await repo.get('a'), null);
    const saved = await repo.put(record('a'));
    assert.equal(saved!.name, 'a');
    assert.deepEqual((await repo.get('a'))!.phases, record('a').phases);
    assert.equal((await repo.list()).length, 1);

    const updated = await repo.update({ ...record('a'), lostTime: 18 });
    assert.equal(updated!.lostTime, 18);

    assert.equal(await repo.put(record('a')), null); // 重名拒绝
    assert.equal(await repo.update(record('missing')), null);
    assert.equal(await repo.delete('a'), true);
    assert.equal(await repo.delete('a'), false);
  });

  it('upsert 幂等', async () => {
    const repo = make();
    await repo.upsert(record('b'));
    const r2 = await repo.upsert({ ...record('b'), lostTime: 20 });
    assert.equal(r2.lostTime, 20);
    assert.equal((await repo.list()).length, 1);
  });

  it('取回的记录是副本，外部修改不污染仓储', async () => {
    const repo = make();
    await repo.put(record('c'));
    const got = await repo.get('c');
    got!.lostTime = 999;
    assert.equal((await repo.get('c'))!.lostTime, 12);
  });
});
