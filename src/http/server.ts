/**
 * Fastify 服务装配（与启动方式解耦，方便测试注入内存仓储）。
 */

import Fastify, { type FastifyInstance } from 'fastify';

import { errorHandler } from './errorHandler';
import { scenarioRoutes } from './scenarioRoutes';
import { timingRoutes } from './timingRoutes';
import type { ScenarioRepository } from '../persistence/repository';

export interface BuildServerOptions {
  repository: ScenarioRepository;
  logger?: boolean | object;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
  });

  app.decorate('scenarioRepo', options.repository);

  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({
    status: 'ok',
    service: 'webster-timing',
    time: new Date().toISOString(),
  }));

  app.register(timingRoutes, { prefix: '/api' });
  app.register(scenarioRoutes, { prefix: '/api' });

  return app;
}
