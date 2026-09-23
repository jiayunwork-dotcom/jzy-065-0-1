/**
 * PostgreSQL 工况档仓储。
 *
 * 表结构见 schema.sql；phases 以 JSONB 存储，启动时 migrate() 幂等建表
 * 并写入预置算例。
 */

import { Pool, type PoolClient } from 'pg';

import type { ScenarioRecord, PhaseInput } from '../domain/types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioRepository } from './repository';

interface ScenarioRow {
  name: string;
  description: string | null;
  lost_time: number;
  phases: PhaseInput[];
  created_at: Date;
  updated_at: Date;
}

function rowToRecord(row: ScenarioRow): ScenarioRecord {
  return {
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    lostTime: row.lost_time,
    phases: row.phases,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgScenarioRepository implements ScenarioRepository {
  constructor(private readonly pool: Pool) {}

  static fromEnv(): PgScenarioRepository {
    const pool = new Pool({
      host: process.env.PGHOST ?? 'db',
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'webster',
      password: process.env.PGPASSWORD ?? 'webster',
      database: process.env.PGDATABASE ?? 'webster',
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    return new PgScenarioRepository(pool);
  }

  async migrate(): Promise<void> {
    const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
    await this.pool.query(sql);
  }

  /** 等待数据库就绪（容器编排下 app 可能先于 db 可连接） */
  async waitForReady(retries = 15, delayMs = 2000): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error(
      `PostgreSQL 在 ${retries} 次重试后仍不可用: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async get(name: string): Promise<ScenarioRecord | null> {
    return this.withClient(async (client) => {
      const res = await client.query<ScenarioRow>(
        'SELECT name, description, lost_time, phases, created_at, updated_at FROM scenarios WHERE name = $1',
        [name],
      );
      return res.rowCount === 1 ? rowToRecord(res.rows[0]) : null;
    });
  }

  async list(): Promise<ScenarioRecord[]> {
    return this.withClient(async (client) => {
      const res = await client.query<ScenarioRow>(
        'SELECT name, description, lost_time, phases, created_at, updated_at FROM scenarios ORDER BY name',
      );
      return res.rows.map(rowToRecord);
    });
  }

  async put(record: ScenarioRecord): Promise<ScenarioRecord | null> {
    return this.withClient(async (client) => {
      const res = await client.query(
        `INSERT INTO scenarios (name, description, lost_time, phases, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING
         RETURNING name, description, lost_time, phases, created_at, updated_at`,
        [
          record.name,
          record.description ?? null,
          record.lostTime,
          JSON.stringify(record.phases),
          record.createdAt,
          record.updatedAt,
        ],
      );
      return res.rowCount === 1 ? rowToRecord(res.rows[0] as ScenarioRow) : null;
    });
  }

  async update(record: ScenarioRecord): Promise<ScenarioRecord | null> {
    return this.withClient(async (client) => {
      const res = await client.query(
        `UPDATE scenarios
         SET description = $2, lost_time = $3, phases = $4, updated_at = $5
         WHERE name = $1
         RETURNING name, description, lost_time, phases, created_at, updated_at`,
        [
          record.name,
          record.description ?? null,
          record.lostTime,
          JSON.stringify(record.phases),
          record.updatedAt,
        ],
      );
      return res.rowCount === 1 ? rowToRecord(res.rows[0] as ScenarioRow) : null;
    });
  }

  async delete(name: string): Promise<boolean> {
    return this.withClient(async (client) => {
      const res = await client.query('DELETE FROM scenarios WHERE name = $1', [name]);
      return (res.rowCount ?? 0) > 0;
    });
  }

  async upsert(record: ScenarioRecord): Promise<ScenarioRecord> {
    return this.withClient(async (client) => {
      const res = await client.query(
        `INSERT INTO scenarios (name, description, lost_time, phases, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE
           SET description = EXCLUDED.description,
               lost_time = EXCLUDED.lost_time,
               phases = EXCLUDED.phases,
               updated_at = EXCLUDED.updated_at
         RETURNING name, description, lost_time, phases, created_at, updated_at`,
        [
          record.name,
          record.description ?? null,
          record.lostTime,
          JSON.stringify(record.phases),
          record.createdAt,
          record.updatedAt,
        ],
      );
      return rowToRecord(res.rows[0] as ScenarioRow);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
