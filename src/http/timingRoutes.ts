/**
 * 配时三件套路由：
 *   POST /api/timing  —— 返回 Y、最佳周期与各相位绿信比
 *   POST /api/delay   —— 返回各相位均匀延误/饱和度/合计延误（可另指定周期）
 *   POST /api/scan    —— 候选周期扫描，回延误随周期变化曲线（可中断长作业）
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import { analyze } from '../domain/analyze';
import { TimingError } from '../domain/errors';
import type { ScanResult, TimingResult } from '../domain/types';
import { scanCycles } from '../domain/scan';
import {
  analyzeBodySchema,
  delayBodySchema,
  scanBodySchema,
} from './schemas';

/** 配时摘要：绿信比等，不含逐相位延误（供 /api/timing 使用） */
function timingView(r: TimingResult) {
  return {
    Y: r.Y,
    lostTime: r.lostTime,
    optimalCycle: r.optimalCycle,
    cycle: r.cycle,
    cycleSource: r.cycleSource,
    totalGreen: r.totalGreen,
    balanceResidual: r.balanceResidual,
    phases: r.phases.map((p) => ({
      index: p.index,
      name: p.name,
      q: p.q,
      s: p.s,
      y: p.y,
      g: p.g,
      lambda: p.lambda,
    })),
  };
}

function delayView(r: TimingResult) {
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
    phases: r.phases.map((p) => ({
      index: p.index,
      name: p.name,
      q: p.q,
      s: p.s,
      y: p.y,
      g: p.g,
      lambda: p.lambda,
      x: p.x,
      uniformDelay: p.uniformDelay,
      overflowDelay: p.overflowDelay,
      totalDelayPerVehicle: p.totalDelayPerVehicle,
      totalUniformDelayRate: p.totalUniformDelayRate,
      totalDelayRate: p.totalDelayRate,
    })),
  };
}

function scanView(r: ScanResult) {
  return {
    Y: r.Y,
    model: r.model,
    aborted: r.aborted,
    points: r.points,
  };
}

/**
 * 客户端断连时取消扫描。
 *
 * 注意不能监听 request.raw 的 'close'：Node 16+ 请求体读完即触发，
 * 会把正常长扫描误判成取消。响应流的 'close' 在「连接提前中断」与
 * 「正常发完」两种情况下都会触发，靠 reply.sent 区分。
 */
function wireAbort(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const ac = new AbortController();
  const onClose = () => {
    if (!reply.sent) ac.abort();
  };
  reply.raw.on('close', onClose);
  return ac.signal;
}

export const timingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1) 配时：Y、C0、绿信比
  app.post('/timing', async (request, reply) => {
    const body = analyzeBodySchema.parse(request.body);
    const result = analyze(
      { phases: body.phases, lostTime: body.lostTime },
      { model: 'uniform-only' },
    );
    return reply.send(timingView(result));
  });

  // 2) 延误：自动周期或指定周期
  app.post('/delay', async (request, reply) => {
    const body = delayBodySchema.parse(request.body);
    const result = analyze(
      { phases: body.phases, lostTime: body.lostTime },
      { cycle: body.cycle, model: body.model ?? 'webster-full' },
    );
    return reply.send(delayView(result));
  });

  // 3) 扫描：可中断长作业，逐点现算
  app.post('/scan', async (request, reply) => {
    const body = scanBodySchema.parse(request.body);
    const signal = wireAbort(request, reply);

    try {
      const result = await scanCycles(
        { phases: body.phases, lostTime: body.lostTime },
        {
          fromCycle: body.fromCycle,
          toCycle: body.toCycle,
          step: body.step,
          model: body.model ?? 'webster-full',
          signal,
        },
      );
      return reply.send(scanView(result));
    } catch (err) {
      if (err instanceof TimingError && err.code === 'SCAN_CANCELLED' && reply.sent) {
        return; // 连接已断，半条曲线绝不当完整结果发送
      }
      throw err;
    }
  });
};
