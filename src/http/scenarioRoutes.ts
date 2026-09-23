/**
 * 工况档路由（PostgreSQL 持久化，按名字建档/取回/重算）：
 *   GET    /api/scenarios                列出全部
 *   POST   /api/scenarios                建档（重名 409）
 *   GET    /api/scenarios/:name          取回
 *   PUT    /api/scenarios/:name          更新
 *   DELETE /api/scenarios/:name          删除
 *   POST   /api/scenarios/:name/recompute 凭存档核算（可指定周期）
 *   POST   /api/scenarios/:name/scan      凭存档扫描
 */

import type { FastifyPluginAsync } from 'fastify';

import { analyze } from '../domain/analyze';
import { TimingError } from '../domain/errors';
import { PRESETS } from '../domain/presets';
import { scanCycles } from '../domain/scan';
import type { ScenarioRepository } from '../persistence/repository';
import { validateTimingInput } from '../domain/validation';
import {
  recomputeBodySchema,
  scenarioCreateSchema,
  scenarioScanSchema,
  scenarioUpdateSchema,
} from './schemas';

declare module 'fastify' {
  interface FastifyInstance {
    scenarioRepo: ScenarioRepository;
  }
}

async function requireScenario(app: import('fastify').FastifyInstance, name: string) {
  const record = await app.scenarioRepo.get(name);
  if (!record) {
    throw new TimingError('SCENARIO_NOT_FOUND', `工况档「${name}」不存在`, {
      details: { name },
    });
  }
  return record;
}

export const scenarioRoutes: FastifyPluginAsync = async (app) => {
  app.get('/scenarios', async () => {
    const records = await app.scenarioRepo.list();
    return { scenarios: records };
  });

  app.post('/scenarios', async (request, reply) => {
    const body = scenarioCreateSchema.parse(request.body);
    // 建档也走同一套语义校验
    validateTimingInput({ phases: body.phases, lostTime: body.lostTime });

    const now = new Date().toISOString();
    const saved = await app.scenarioRepo.put({
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      phases: body.phases,
      lostTime: body.lostTime,
      createdAt: now,
      updatedAt: now,
    });
    if (!saved) {
      throw new TimingError('SCENARIO_EXISTS', `工况档「${body.name}」已存在`, {
        details: { name: body.name },
      });
    }
    return reply.status(201).send(saved);
  });

  app.get<{ Params: { name: string } }>('/scenarios/:name', async (request) => {
    const record = await requireScenario(app, request.params.name);
    return record;
  });

  app.put<{ Params: { name: string } }>('/scenarios/:name', async (request) => {
    const body = scenarioUpdateSchema.parse(request.body);
    validateTimingInput({ phases: body.phases, lostTime: body.lostTime });
    const existing = await requireScenario(app, request.params.name);

    const saved = await app.scenarioRepo.update({
      name: existing.name,
      ...(body.description !== undefined
        ? { description: body.description }
        : existing.description !== undefined
          ? { description: existing.description }
          : {}),
      phases: body.phases,
      lostTime: body.lostTime,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    return saved;
  });

  app.delete<{ Params: { name: string } }>('/scenarios/:name', async (request, reply) => {
    const { name } = request.params;
    if (PRESETS[name]) {
      throw new TimingError('INVALID_INPUT', `预置工况档「${name}」不允许删除`, {
        details: { name },
      });
    }
    const deleted = await app.scenarioRepo.delete(name);
    if (!deleted) {
      throw new TimingError('SCENARIO_NOT_FOUND', `工况档「${name}」不存在`, {
        details: { name },
      });
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { name: string } }>(
    '/scenarios/:name/recompute',
    async (request, reply) => {
      const body = recomputeBodySchema.parse(request.body ?? {});
      const record = await requireScenario(app, request.params.name);
      const result = analyze(
        { phases: record.phases, lostTime: record.lostTime },
        { cycle: body.cycle, model: body.model ?? 'webster-full' },
      );
      return reply.send({ scenario: record.name, ...stripView(result) });
    },
  );

  app.post<{ Params: { name: string } }>(
    '/scenarios/:name/scan',
    async (request, reply) => {
      const body = scenarioScanSchema.parse(request.body ?? {});
      const record = await requireScenario(app, request.params.name);

      const ac = new AbortController();
      const onClose = () => {
        if (!reply.sent) ac.abort();
      };
      reply.raw.on('close', onClose);

      const result = await scanCycles(
        { phases: record.phases, lostTime: record.lostTime },
        {
          fromCycle: body.fromCycle,
          toCycle: body.toCycle,
          step: body.step,
          model: body.model ?? 'webster-full',
          signal: ac.signal,
        },
      );
      return reply.send({ scenario: record.name, ...result });
    },
  );
};

// 与 delayView 同构的展开（避免循环依赖延迟视图工具，就地给出）
function stripView(r: import('../domain/types').TimingResult) {
  return {
    Y: r.Y,
    lostTime: r.lostTime,
    optimalCycle: r.optimalCycle,
    cycle: r.cycle,
    cycleSource: r.cycleSource,
    totalGreen: r.totalGreen,
    balanceResidual: r.balanceResidual,
    totalUniformDelay: r.totalUniformDelay,
    totalDelay: r.totalDelay,
    phases: r.phases,
  };
}
