import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { QuotaAdapter } from './index.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: Server): Promise<number> {
  return new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no bind');
    resolve(address.port);
  }));
}

function jsonServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Server {
  return createServer(handler);
}

function adapterFor(port: number): QuotaAdapter {
  return new QuotaAdapter({
    providerId: 'deepseek',
    resolveEndpoint: () => ({ url: `http://127.0.0.1:${port}/api/quota/deepseek` })
  });
}

describe('quota-adapter fixed pipeline', () => {
  it('returns ok with normalized balance/usage metrics', async () => {
    const server = jsonServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ balance: 58.36, usagePercent: 45, resetAt: '2026-09-01T00:00:00Z' }));
    });
    servers.push(server);
    const port = await listen(server);

    const snapshot = await adapterFor(port).fetchQuota();
    expect(snapshot.state).toBe('ok');
    expect(snapshot.providerId).toBe('deepseek');
    expect(snapshot.metrics).toHaveLength(2);
    expect(snapshot.metrics[0]).toMatchObject({ kind: 'balance', value: 58.36, unit: 'CNY' });
  });

  it('derives warn/critical from usage thresholds', async () => {
    const warnServer = jsonServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ balance: 100, usagePercent: 85 }));
    });
    const critServer = jsonServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ balance: 2, usagePercent: 12 }));
    });
    servers.push(warnServer, critServer);

    expect((await adapterFor(await listen(warnServer)).fetchQuota()).state).toBe('warn');
    expect((await adapterFor(await listen(critServer)).fetchQuota()).state).toBe('critical');
  });

  it('rejects arbitrary non-https, non-loopback endpoints as not configured', async () => {
    const adapter = new QuotaAdapter({
      providerId: 'x',
      resolveEndpoint: () => ({ url: 'http://example.com/quota' })
    });
    const snapshot = await adapter.fetchQuota();
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.errorCode).toBe('NOT_CONFIGURED');
  });

  it('returns unavailable when endpoint not configured', async () => {
    const adapter = new QuotaAdapter({ providerId: 'x', resolveEndpoint: () => undefined });
    const snapshot = await adapter.fetchQuota();
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.errorCode).toBe('NOT_CONFIGURED');
  });

  it('fails on non-JSON content-type (content-type check)', async () => {
    const server = jsonServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not json');
    });
    servers.push(server);
    const port = await listen(server);
    await expect(adapterFor(port).fetchQuota()).rejects.toMatchObject({ code: 'CONTENT_TYPE' });
  });

  it('honors the body-size cap', async () => {
    const server = jsonServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ big: 'x'.repeat(10_000) }));
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new QuotaAdapter({
      providerId: 'x',
      resolveEndpoint: () => ({ url: `http://127.0.0.1:${port}/q` }),
      maxBodyBytes: 256
    });
    await expect(adapter.fetchQuota()).rejects.toMatchObject({ code: 'BODY_LIMIT' });
  });

  it('times out and reports unavailable with TIMEOUT', async () => {
    const server = jsonServer((_req, _res) => {
      // never respond
    });
    servers.push(server);
    const port = await listen(server);
    const adapter = new QuotaAdapter({
      providerId: 'x',
      resolveEndpoint: () => ({ url: `http://127.0.0.1:${port}/q` }),
      timeoutMs: 300
    });
    const snapshot = await adapter.fetchQuota();
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.errorCode).toBe('TIMEOUT');
  });
});