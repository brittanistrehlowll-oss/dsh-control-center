import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { probeDsh, buildInstanceIdentity, inferOwnership, type RuntimeCandidate } from './index.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function listen(server: Server): Promise<number> {
  return new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    resolve(address.port);
  }));
}

function candidate(overrides: Partial<RuntimeCandidate> = {}): RuntimeCandidate {
  return {
    runtimeId: 'runtime-1',
    source: 'legacy-watchdog',
    baseUrl: 'http://127.0.0.1:0',
    installOrigin: 'local-node-modules',
    installAuthority: 'delegated',
    profileId: 'web',
    processId: 1234,
    processStartedAt: '2026-08-18T00:00:00.000Z',
    commandFingerprint: 'cmd-fingerprint',
    ...overrides
  };
}

function dshHealthServer(signals: Array<Record<string, unknown>>): Server {
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    if (path === '/api/system/health') {
      const signal = signals.shift() ?? signals[signals.length - 1];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(signal));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  return server;
}

describe('runtime discovery (real DSH surface)', () => {
  it('rejects a generic HTTP 200 response as non-DSH', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    const port = await listen(server);

    const result = await probeDsh(candidate({ baseUrl: 'http://127.0.0.1:' + port }));
    expect(result.reachable).toBe(true);
    expect(result.protocolValid).toBe(false);
    expect(result.errorCode).toBe('NOT_DSH');
    expect(result.identity.strength).toBe('none');
  });

  it('recognizes the real health schema and builds a strong identity from boot evidence', async () => {
    const server = dshHealthServer([{
      ok: true,
      ready: true,
      bootId: 'dsh-test-0001',
      pid: 1234,
      uptime: 42.5
    }]);
    servers.push(server);
    const port = await listen(server);

    const result = await probeDsh(candidate({ baseUrl: 'http://127.0.0.1:' + port }));
    expect(result.protocolValid).toBe(true);
    expect(result.health?.bootId).toBe('dsh-test-0001');
    expect(result.identity.strength).toBe('strong');
    expect(result.identity.value).toBeTruthy();
    expect(result.identity.evidence.bootId).toBe('dsh-test-0001');
    expect(result.identity.evidence.pid).toBe(1234);
    expect(result.descriptor?.ownership).toBe('legacy');
  });

  it('reports weak identity when boot evidence is missing', async () => {
    const server = dshHealthServer([{ ok: true, ready: true }]);
    servers.push(server);
    const port = await listen(server);

    const result = await probeDsh(candidate({ baseUrl: 'http://127.0.0.1:' + port }));
    expect(result.protocolValid).toBe(true);
    expect(result.identity.strength).toBe('weak');
  });

  it('creates strong identity only from non-reusable evidence', () => {
    const identity = buildInstanceIdentity({
      pid: 1234,
      processStartedAt: '2026-08-18T00:00:00.000Z',
      commandFingerprint: 'cmd-fingerprint',
      bootId: 'dsh-test-0001',
      profileId: 'web'
    });
    const samePidOnly = buildInstanceIdentity({ pid: 1234 });

    expect(identity.strength).toBe('strong');
    expect(identity.value).toBeTruthy();
    expect(samePidOnly.strength).toBe('weak');
    expect(samePidOnly.value).toBeUndefined();
  });

  it('detects boot change across two health observations', async () => {
    const server = dshHealthServer([
      { ok: true, ready: true, bootId: 'dsh-boot-a', pid: 100 },
      { ok: true, ready: true, bootId: 'dsh-boot-b', pid: 200 }
    ]);
    servers.push(server);
    const port = await listen(server);

    const first = await probeDsh(candidate({ baseUrl: 'http://127.0.0.1:' + port }));
    const second = await probeDsh(candidate({ baseUrl: 'http://127.0.0.1:' + port }));
    expect(first.protocolValid).toBe(true);
    expect(second.protocolValid).toBe(true);
    expect(first.health?.bootId).toBe('dsh-boot-a');
    expect(second.health?.bootId).toBe('dsh-boot-b');
    expect(first.identity.value).not.toBe(second.identity.value);
  });

  it('maps legacy ownership to the external watchdog owner', () => {
    const c = candidate();
    expect(inferOwnership(c)).toBe('legacy');
    expect(inferOwnership({ ...c, source: 'community-desktop' })).toBe('delegated');
    expect(inferOwnership({ ...c, source: 'unknown', installAuthority: 'read-only' })).toBe('observe-only');
  });
});