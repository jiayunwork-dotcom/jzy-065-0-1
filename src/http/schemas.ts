/**
 * HTTP 入参 schema（zod）。
 *
 * 这里只做「形状级」校验（类型、有限数字、数组长度），
 * 语义级规则（q 为负、s 不为正、L 不为正、Y 过饱和等）
 * 仍由 domain/validation 等模块在公式之前执行。
 */

import { z } from 'zod';

const phaseSchema = z.object({
  name: z.string().min(1).optional(),
  q: z.number().finite(),
  s: z.number().finite(),
  minGreen: z.number().finite().optional(),
});

export const timingBodySchema = z.object({
  phases: z.array(phaseSchema).min(2),
  lostTime: z.number().finite(),
});

export const analyzeBodySchema = timingBodySchema;

export const delayBodySchema = timingBodySchema.extend({
  cycle: z.number().finite().positive().optional(),
  model: z.enum(['uniform-only', 'webster-full']).optional(),
});

export const scanBodySchema = timingBodySchema.extend({
  fromCycle: z.number().finite().positive().optional(),
  toCycle: z.number().finite().positive().optional(),
  step: z.number().finite().positive().optional(),
  model: z.enum(['uniform-only', 'webster-full']).optional(),
});

export const scenarioCreateSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(1024).optional(),
  phases: z.array(phaseSchema).min(2),
  lostTime: z.number().finite(),
});

export const scenarioUpdateSchema = z.object({
  description: z.string().max(1024).optional(),
  phases: z.array(phaseSchema).min(2),
  lostTime: z.number().finite(),
});

export const recomputeBodySchema = z.object({
  cycle: z.number().finite().positive().optional(),
  model: z.enum(['uniform-only', 'webster-full']).optional(),
});

export const scenarioScanSchema = z.object({
  fromCycle: z.number().finite().positive().optional(),
  toCycle: z.number().finite().positive().optional(),
  step: z.number().finite().positive().optional(),
  model: z.enum(['uniform-only', 'webster-full']).optional(),
});

export type TimingBody = z.infer<typeof timingBodySchema>;
