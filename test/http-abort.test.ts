import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { request as httpRequest } from 'node:http';

import { buildServer } from '../src/http/server';
import { InMemoryScenarioRepository } from '../src/persistence/memoryRepository';

const body = JSON.stringify({
  lostTime: 12,
  fromCycle: 13,
  toCycle: 5013,
  step: 1,
  phases: [
    { q: 360, s: 1800 },
    { q: 450, s: 1800 },
    { q: 255, s: 1700 },
    { q: 170, s: 1700 },
  ],
});

/**
 * 真实 TCP 层的断连测试（app.inject 不模拟 socket 关闭）。
 * 回归点：不能监听 request.raw 的 'close'（请求体读完即触发，
 * 会把正常长扫描误判取消）；只允许在「连接中断且尚未发响应」时取消。
 */
describe('扫描的 HTTP 中断语义', () => {
  let app: FastifyInstance;
  let port: number;

  before(async () => {
    app = buildServer({ repository: new InMemoryScenarioRepository(), logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    assert.ok(addr && typeof addr === 'object');
    port = addr.port;
  });

  after(async () => {
    await app.close();
  });

  it('正常扫描不会被误判取消（完整曲线返回）', async () => {
    const json = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          method: 'POST',
          host: '127.0.0.1',
          port,
          path: '/api/scan',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    const parsed = JSON.parse(json) as { aborted: boolean; points: unknown[] };
    assert.equal(parsed.aborted, false);
    assert.ok(parsed.points.length >= 5);
  });

  it('客户端中途断连：收不到完整点列，服务随后仍可用', async () => {
    const gotAnyResponse = await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        {
          method: 'POST',
          host: '127.0.0.1',
          port,
          path: '/api/scan',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          // 任何「完整 HTTP 响应」都算失败：取消时连接是被掐断的
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data.length > 0));
        },
      );
      req.on('error', () => resolve(false)); // ECONNRESET / socket destroyed
      req.end(body);
      // 算出若干点后掐断（步长 1s，~80ms 已算几十个点）
      setTimeout(() => req.destroy(), 80);
    });

    assert.equal(gotAnyResponse, false, '中途取消绝不能把半条/整条曲线交出去');

    // 服务未被取消流程搞坏
    const health = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({ method: 'GET', host: '127.0.0.1', port, path: '/health' }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal((JSON.parse(health) as { status: string }).status, 'ok');
  });
});
