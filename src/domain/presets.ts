/**
 * 预置算例 —— 任何人拉起服务都能拿它对数。
 *
 * 四相位：东西直行 / 东西左转 / 南北直行 / 南北左转
 *   Y = 360/1800 + 450/1800 + 255/1700 + 170/1700
 *     = 0.20 + 0.25 + 0.15 + 0.10 = 0.70
 *   L = 12s
 *   C0 = (1.5×12 + 5)/(1−0.7) = 23/0.3 ≈ 76.7s（落在文献常见的 50–80s 区间上沿附近）
 */

import type { ScenarioRecord, TimingInput } from './types';

export interface PresetScenario extends ScenarioRecord {
  builtin: true;
}

const createdAt = '2026-01-01T00:00:00.000Z';

export const PRESETS: Record<string, PresetScenario> = {
  'demo-four-phase': {
    name: 'demo-four-phase',
    description:
      '四相位城市干道示例：Y≈0.70，L=12s，C0≈76.7s。流量比 0.20/0.25/0.15/0.10。',
    lostTime: 12,
    phases: [
      { name: '东西直行', q: 360, s: 1800 },
      { name: '东西左转', q: 450, s: 1800 },
      { name: '南北直行', q: 255, s: 1700 },
      { name: '南北左转', q: 170, s: 1700 },
    ],
    createdAt,
    updatedAt: createdAt,
    builtin: true,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

export function presetTimingInput(name: string): TimingInput | undefined {
  const p = PRESETS[name];
  if (!p) return undefined;
  return { phases: p.phases, lostTime: p.lostTime };
}
