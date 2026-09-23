/**
 * 输入校验 —— 必须卡在任何公式之前。
 *
 * 规则：
 *  - 相位数少于两个：拒绝
 *  - 某个 q 为负（或非有限值）：拒绝
 *  - 某个 s 不为正（或非有限值）：拒绝
 *  - 损失时间 L 不为正（或非有限值）：拒绝
 *  - minGreen 若给了，不允许为负
 *
 * 所有违例一次性收集，回带原因的错误结构。
 */

import { TimingError } from './errors';
import type { NormalizedPhase, PhaseInput, TimingInput } from './types';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function validateTimingInput(input: unknown): {
  phases: NormalizedPhase[];
  lostTime: number;
} {
  const fields: Array<{ field: string; reason: string }> = [];

  if (typeof input !== 'object' || input === null) {
    throw new TimingError('INVALID_INPUT', '请求体必须是包含 phases 与 lostTime 的对象', {
      fields: [{ field: '$', reason: 'not an object' }],
    });
  }

  const body = input as TimingInput;
  const rawPhases = body.phases;
  const lostTime = body.lostTime;

  if (!Array.isArray(rawPhases)) {
    fields.push({ field: 'phases', reason: 'phases 必须是数组' });
  } else if (rawPhases.length < 2) {
    fields.push({
      field: 'phases',
      reason: `相位数至少为 2，实际为 ${rawPhases.length}（孤立交叉口配时不处理单相位）`,
    });
  }

  if (!isFiniteNumber(lostTime)) {
    fields.push({ field: 'lostTime', reason: '损失时间必须是有限数字' });
  } else if (lostTime <= 0) {
    fields.push({ field: 'lostTime', reason: `损失时间必须为正，实际为 ${lostTime}` });
  }

  const normalized: NormalizedPhase[] = [];

  if (Array.isArray(rawPhases)) {
    rawPhases.forEach((p: unknown, i: number) => {
      if (typeof p !== 'object' || p === null) {
        fields.push({ field: `phases[${i}]`, reason: '相位必须是对象' });
        return;
      }
      const phase = p as PhaseInput;
      const q = phase.q;
      const s = phase.s;
      const minGreen = phase.minGreen ?? 0;

      if (!isFiniteNumber(q)) {
        fields.push({ field: `phases[${i}].q`, reason: '到达流率 q 必须是有限数字' });
      } else if (q < 0) {
        fields.push({
          field: `phases[${i}].q`,
          reason: `到达流率 q 不允许为负，实际为 ${q}`,
        });
      }

      if (!isFiniteNumber(s)) {
        fields.push({ field: `phases[${i}].s`, reason: '饱和流率 s 必须是有限数字' });
      } else if (s <= 0) {
        fields.push({
          field: `phases[${i}].s`,
          reason: `饱和流率 s 必须为正，实际为 ${s}`,
        });
      }

      if (phase.minGreen !== undefined) {
        if (!isFiniteNumber(minGreen)) {
          fields.push({ field: `phases[${i}].minGreen`, reason: '最小绿必须是有限数字' });
        } else if (minGreen < 0) {
          fields.push({
            field: `phases[${i}].minGreen`,
            reason: `最小绿不允许为负，实际为 ${minGreen}`,
          });
        }
      }

      if (isFiniteNumber(q) && q >= 0 && isFiniteNumber(s) && s > 0) {
        normalized.push({
          name: typeof phase.name === 'string' ? phase.name : undefined,
          q,
          s,
          minGreen: isFiniteNumber(minGreen) && minGreen >= 0 ? minGreen : 0,
        });
      }
    });
  }

  if (fields.length > 0) {
    throw new TimingError('INVALID_INPUT', `输入校验未通过：${fields.length} 项违例`, { fields });
  }

  return { phases: normalized, lostTime: lostTime as number };
}
