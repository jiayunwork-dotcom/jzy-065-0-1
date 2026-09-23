/**
 * 服务入口。
 *
 * 存储选择：
 *  - STORAGE=memory（默认当未配置 PG 时）：内存档，预置算例运行时写入
 *  - STORAGE=postgres / 检测到 PG* 环境变量：连 PostgreSQL 16，
 *    启动时幂等建表 + 预置算例
 */

import type { ScenarioRepository } from './persistence/repository';
import { InMemoryScenarioRepository } from './persistence/memoryRepository';
import { PgScenarioRepository } from './persistence/pgRepository';
import { PRESETS } from './domain/presets';
import { buildServer } from './http/server';

async function resolveRepository(): Promise<{
  repo: ScenarioRepository;
  kind: 'memory' | 'postgres';
}> {
  const want = process.env.STORAGE?.toLowerCase();
  if (want === 'memory') {
    return { repo: await seedMemory(), kind: 'memory' };
  }

  try {
    const pg = PgScenarioRepository.fromEnv();
    // 自动探测路径：没明确要 PG 时只做短暂探测，失败快速回退内存；
    // 明确 STORAGE=postgres 时给足编排启动宽限，连不上直接失败。
    await pg.waitForReady(want === 'postgres' ? 20 : 4, want === 'postgres' ? 2000 : 500);
    await pg.migrate();
    return { repo: pg, kind: 'postgres' };
  } catch (err) {
    if (want === 'postgres') {
      throw err; // 明确要求 PG 时连不上直接失败，不静默降级
    }
    console.warn(
      `[startup] PostgreSQL 不可用，回退到内存仓储：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { repo: await seedMemory(), kind: 'memory' };
  }
}

async function seedMemory(): Promise<ScenarioRepository> {
  const repo = new InMemoryScenarioRepository();
  for (const preset of Object.values(PRESETS)) {
    await repo.upsert(preset);
  }
  return repo;
}

async function main(): Promise<void> {
  const { repo, kind } = await resolveRepository();
  const app = buildServer({
    repository: repo,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info({ storage: kind, port, host, presets: Object.keys(PRESETS) }, 'service up');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await repo.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[startup] fatal:', err);
  process.exit(1);
});
