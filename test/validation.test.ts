import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TimingError } from '../src/domain/errors';
import { validateTimingInput } from '../src/domain/validation';

describe('输入校验（卡在公式之前）', () => {
  it('相位数少于两个一律拒绝', () => {
    assert.throws(
      () => validateTimingInput({ lostTime: 10, phases: [{ q: 100, s: 1000 }] }),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
    );
  });

  it('空相位数组拒绝', () => {
    assert.throws(
      () => validateTimingInput({ lostTime: 10, phases: [] }),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
    );
  });

  it('q 为负拒绝并带字段原因', () => {
    try {
      validateTimingInput({
        lostTime: 10,
        phases: [
          { q: -1, s: 1000 },
          { q: 100, s: 1000 },
        ],
      });
      assert.fail('应当抛错');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      assert.equal(err.code, 'INVALID_INPUT');
      assert.ok(err.fields?.some((f) => f.field === 'phases[0].q'));
    }
  });

  it('s 为零或为负拒绝', () => {
    for (const s of [0, -5]) {
      assert.throws(
        () =>
          validateTimingInput({
            lostTime: 10,
            phases: [
              { q: 100, s },
              { q: 100, s: 1000 },
            ],
          }),
        (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
      );
    }
  });

  it('损失时间不为正拒绝（零与负）', () => {
    const body = {
      phases: [
        { q: 100, s: 1000 },
        { q: 100, s: 1000 },
      ],
      lostTime: 0,
    };
    assert.throws(
      () => validateTimingInput({ ...body, lostTime: 0 }),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
    );
    assert.throws(
      () => validateTimingInput({ ...body, lostTime: -3 }),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
    );
  });

  it('NaN / Infinity 拒绝', () => {
    assert.throws(() =>
      validateTimingInput({
        lostTime: 10,
        phases: [
          { q: Number.NaN, s: 1000 },
          { q: 100, s: 1000 },
        ],
      }),
    );
    assert.throws(() =>
      validateTimingInput({
        lostTime: Number.POSITIVE_INFINITY,
        phases: [
          { q: 100, s: 1000 },
          { q: 100, s: 1000 },
        ],
      }),
    );
  });

  it('多项违例一次性收集', () => {
    try {
      validateTimingInput({
        lostTime: -1,
        phases: [
          { q: -5, s: 0 },
          { q: 100, s: 1000 },
        ],
      });
      assert.fail('应当抛错');
    } catch (err) {
      assert.ok(err instanceof TimingError);
      const fields = err.fields?.map((f) => f.field) ?? [];
      assert.ok(fields.includes('lostTime'));
      assert.ok(fields.includes('phases[0].q'));
      assert.ok(fields.includes('phases[0].s'));
      assert.equal(fields.length, 3);
    }
  });

  it('最小绿为负拒绝', () => {
    assert.throws(
      () =>
        validateTimingInput({
          lostTime: 10,
          phases: [
            { q: 100, s: 1000, minGreen: -1 },
            { q: 100, s: 1000 },
          ],
        }),
      (err: unknown) => err instanceof TimingError && err.code === 'INVALID_INPUT',
    );
  });

  it('合法输入通过并归一化 minGreen 缺省为 0', () => {
    const r = validateTimingInput({
      lostTime: 10,
      phases: [
        { q: 0, s: 1000 },
        { q: 100, s: 1000, minGreen: 5 },
      ],
    });
    assert.equal(r.phases.length, 2);
    assert.equal(r.phases[0].minGreen, 0);
    assert.equal(r.phases[1].minGreen, 5);
    assert.equal(r.lostTime, 10);
  });
});
