/**
 * 内存工况档仓储 —— 测试与本地无数据库环境使用。
 */

import type { ScenarioRecord } from '../domain/types';
import type { ScenarioRepository } from './repository';

export class InMemoryScenarioRepository implements ScenarioRepository {
  private readonly store = new Map<string, ScenarioRecord>();

  private static clone(record: ScenarioRecord): ScenarioRecord {
    return { ...record, phases: record.phases.map((p) => ({ ...p })) };
  }

  async get(name: string): Promise<ScenarioRecord | null> {
    const found = this.store.get(name);
    return found ? InMemoryScenarioRepository.clone(found) : null;
  }

  async list(): Promise<ScenarioRecord[]> {
    return [...this.store.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => InMemoryScenarioRepository.clone(r));
  }

  async put(record: ScenarioRecord): Promise<ScenarioRecord | null> {
    if (this.store.has(record.name)) return null;
    const stored = InMemoryScenarioRepository.clone(record);
    this.store.set(record.name, stored);
    return InMemoryScenarioRepository.clone(stored);
  }

  async update(record: ScenarioRecord): Promise<ScenarioRecord | null> {
    if (!this.store.has(record.name)) return null;
    const stored = InMemoryScenarioRepository.clone(record);
    this.store.set(record.name, stored);
    return InMemoryScenarioRepository.clone(stored);
  }

  async delete(name: string): Promise<boolean> {
    return this.store.delete(name);
  }

  async upsert(record: ScenarioRecord): Promise<ScenarioRecord> {
    const stored = InMemoryScenarioRepository.clone(record);
    this.store.set(record.name, stored);
    return InMemoryScenarioRepository.clone(stored);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
