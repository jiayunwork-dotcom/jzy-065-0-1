/**
 * PostgreSQL 16 集成测试 —— 默认跳过。
 *
 * 仅当 RUN_PG_TESTS=1 时执行（docker compose 的 test 服务），
 * 直连由 PG* 环境变量指定的数据库。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it, skip } from 'node:test';

import { PgScenarioRepository } from '../src/persistence/pgRepository';
import { PRESETS } from '../src/domain/presets';
import { analyze } from '../src/domain/analyze';

const enabled = process.env.RUN_PG_TESTS === '1';
(enabled ? describe : skip)('PostgreSQL 仓储集成', () => {
  let repo: PgScenarioRepository;

  before(async () => {
    repo = PgScenarioRepository.fromEnv();
    await repo.waitForReady(20, 1000);
    await repo.migrate();
  });

  after(async () => {
    await repo.delete('it-case');
    await repo.close();
  });

  it('migrate 幂等，预置算例可读取', async () => {
    await repo.migrate();
    const preset = await repo.get('demo-four-phase');
    assert.ok(preset);
    assert.equal(preset!.phases.length, 4);
    const r = analyze({ phases: preset!.phases, lostTime: preset!.lostTime });
    assert.ok(Math.abs(r.Y - 0.7) < 1e-9);
  });

  it('建档/取回/重算数据往返无损', async () => {
    const now = new Date().toISOString();
    const saved = await repo.put({
      name: 'it-case',
      lostTime: 14,
      phases: [
        { q: 300, s: 1800 },
        { q: 500, s: 1800 },
      ],
      createdAt: now,
      updatedAt: now,
    });
    assert.ok(saved);
    const got = await repo.get('it-case');
    assert.equal(got!.lostTime, 14);
    assert.deepEqual(got!.phases, [
      { q: 300, s: 1800 },
      { q: 500, s: 1800 },
    ]);

    const updated = await repo.update({ ...got!, lostTime: 16 });
    assert.equal(updated!.lostTime, 16);
    assert.equal((await repo.get('it-case'))!.lostTime, 16);

    assert.equal(await repo.put({ ...got! }), null);
  });

  it('预置数量与内存侧一致', async () => {
    const list = await repo.list();
    for (const name of Object.keys(PRESETS)) {
      assert.ok(list.some((r) => r.name === name));
    }
  });
});
