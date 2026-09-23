/**
 * 领域错误 -> HTTP 状态码映射与全局错误响应。
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { isTimingError, type ErrorCode } from '../domain/errors';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_CYCLE: 400,
  INVALID_SCAN_RANGE: 400,
  OVERSATURATED: 422,
  PHASE_SATURATED: 422,
  MIN_GREEN_INFEASIBLE: 422,
  ARRIVAL_RATE_MISMATCH: 500,
  GREEN_BALANCE_RESIDUAL: 500,
  SCAN_CANCELLED: 499,
  SCENARIO_NOT_FOUND: 404,
  SCENARIO_EXISTS: 409,
};

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (reply.sent) return;

  if (isTimingError(error)) {
    void reply.status(STATUS_BY_CODE[error.code]).send(error.toJSON());
    return;
  }

  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: 'INVALID_INPUT',
      reason: '请求参数校验未通过',
      fields: error.issues.map((i) => ({
        field: i.path.join('.'),
        reason: i.message,
      })),
    });
    return;
  }

  _request.log.error(error, 'unhandled error');
  void reply.status(500).send({
    error: 'INTERNAL',
    reason: error.message || '内部错误',
  });
}
