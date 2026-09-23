/**
 * 统一的领域错误。
 *
 * 所有「带原因的错误结构」都走这里：HTTP 层据此映射状态码，
 * 测试据此断言 code/reason。
 */

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'OVERSATURATED'
  | 'PHASE_SATURATED'
  | 'MIN_GREEN_INFEASIBLE'
  | 'GREEN_BALANCE_RESIDUAL'
  | 'INVALID_CYCLE'
  | 'INVALID_SCAN_RANGE'
  | 'SCAN_CANCELLED'
  | 'ARRIVAL_RATE_MISMATCH'
  | 'SCENARIO_NOT_FOUND'
  | 'SCENARIO_EXISTS';

export interface FieldError {
  field: string;
  reason: string;
}

export class TimingError extends Error {
  readonly code: ErrorCode;
  readonly reason: string;
  /** 额外结构化信息，比如过饱和时的 Y、饱和相位下标 */
  readonly details?: Record<string, unknown>;
  readonly fields?: FieldError[];

  constructor(
    code: ErrorCode,
    reason: string,
    options?: {
      details?: Record<string, unknown>;
      fields?: FieldError[];
    },
  ) {
    super(reason);
    this.name = 'TimingError';
    this.code = code;
    this.reason = reason;
    this.details = options?.details;
    this.fields = options?.fields;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      reason: this.reason,
      ...(this.details ? { details: this.details } : {}),
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}

export function isTimingError(err: unknown): err is TimingError {
  return err instanceof TimingError;
}
