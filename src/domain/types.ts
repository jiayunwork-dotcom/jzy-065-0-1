/**
 * 领域类型定义
 *
 * 单位约定：
 *  - 流率 q、饱和流率 s：辆/小时 (veh/h)
 *  - 周期 C、损失时间 L、有效绿 g：秒
 *  - 均匀延误 d：秒/辆（单车每周期平均）
 *  - 相位延误率 q·d：辆/小时 × 秒/辆 = 秒/小时（该相位每小时累计延误）
 */

export interface PhaseInput {
  /** 相位名（可选，仅用于回显与报错定位） */
  name?: string;
  /** 到达流率 q，辆/时，不允许为负 */
  q: number;
  /** 饱和流率 s，辆/时，必须为正 */
  s: number;
  /** 最小有效绿（可选），秒，不允许为负 */
  minGreen?: number;
}

/** 归一化后的相位输入（NaN/Infinity 已排除） */
export interface NormalizedPhase {
  name?: string;
  q: number;
  s: number;
  minGreen: number;
}

export interface TimingInput {
  phases: PhaseInput[];
  /** 每周期总损失时间 L，秒，必须为正 */
  lostTime: number;
}

/** 单个相位的核算结果 */
export interface PhaseResult {
  /** 入参序号（0 基） */
  index: number;
  name?: string;
  q: number;
  s: number;
  /** 流量比 y = q/s */
  y: number;
  /** 有效绿灯 g，秒 */
  g: number;
  /** 绿信比 λ = g/C */
  lambda: number;
  /** 饱和度 x = q/(λ·s) = y/λ */
  x: number;
  /** 均匀延误（Webster 第一项），秒/辆 */
  uniformDelay: number;
  /** 均匀（随机）增量延误（Webster 第二项），秒/辆 */
  overflowDelay: number;
  /** 该相位总均匀延误率 Σq·d_uniform，单位 秒/小时 */
  totalUniformDelayRate: number;
  /** 全 Webster 延误 d = d1 + d2，秒/辆 */
  totalDelayPerVehicle: number;
  /** 全 Webster 延误率 q·(d1+d2)，单位 秒/小时 */
  totalDelayRate: number;
}

export type DelayModel = 'uniform-only' | 'webster-full';

/** 一次完整核算的结果 */
export interface TimingResult {
  phases: PhaseResult[];
  /** 总流量比 Y = Σy */
  Y: number;
  /** 每周期总损失时间，秒 */
  lostTime: number;
  /** 所用周期（指定周期或自动 C0），秒 */
  cycle: number;
  /** Webster 最佳周期 C0，秒（即便指定了 cycle 也返回，便于对照） */
  optimalCycle: number;
  /** 周期是否为自动求解 */
  cycleSource: 'auto' | 'specified';
  /** 有效绿之和 */
  totalGreen: number;
  /** 等式残差 |Σg + L − C|，必须压进容差 */
  balanceResidual: number;
  /** 交叉口合计均匀延误率，秒/小时 */
  totalUniformDelay: number;
  /** 交叉口合计全 Webster 延误率，秒/小时 */
  totalDelay: number;
}

/** 扫描曲线上的单个点 */
export interface ScanPoint {
  cycle: number;
  feasible: boolean;
  /** 不可行原因（如该周期下某相位饱和 / 绿灯凑不平），feasible=false 时存在 */
  reason?: string;
  code?: string;
  Y?: number;
  totalUniformDelay?: number;
  totalDelay?: number;
  phases?: Array<{
    index: number;
    name?: string;
    g: number;
    lambda: number;
    x: number;
    uniformDelay: number;
    totalDelayPerVehicle: number;
  }>;
}

/** 扫描结果 */
export interface ScanResult {
  Y: number;
  model: DelayModel;
  points: ScanPoint[];
  aborted: boolean;
}

/** 工况档持久化结构 */
export interface ScenarioRecord {
  name: string;
  description?: string;
  phases: PhaseInput[];
  lostTime: number;
  createdAt: string;
  updatedAt: string;
}
