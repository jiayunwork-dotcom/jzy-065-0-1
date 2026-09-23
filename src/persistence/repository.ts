/**
 * 工况档仓储抽象。
 *
 * - HTTP 层只依赖该接口，测试可注入内存实现，生产用 PostgreSQL 实现。
 * - 核算本身是纯函数、无共享可变状态；工况档按名字隔离。
 */

import type { ScenarioRecord } from '../domain/types';

export interface ScenarioRepository {
  /** 按名字取档；不存在返回 null */
  get(name: string): Promise<ScenarioRecord | null>;
  list(): Promise<ScenarioRecord[]>;
  /** 建档；重名返回 null（路由层映射 SCENARIO_EXISTS） */
  put(record: ScenarioRecord): Promise<ScenarioRecord | null>;
  /** 更新已存在的档；不存在返回 null */
  update(record: ScenarioRecord): Promise<ScenarioRecord | null>;
  delete(name: string): Promise<boolean>;
  /** 幂等预置 */
  upsert(record: ScenarioRecord): Promise<ScenarioRecord>;
  close(): Promise<void>;
}
