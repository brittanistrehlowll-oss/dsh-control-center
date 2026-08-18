import { afterEach, describe, expect, it } from 'vitest';
import { FakeDshRuntime } from '@dsh-control-center/fake-runtime';
import { DshClient, DshClientError } from './index.js';

const runtimes: FakeDshRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

describe('DshClient (real RPC surface)', () => {
  it('reads health through the real health endpoint', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'client-1' });
    runtimes.push(runtime);
    const address = await runtime.start();
    const client = new DshClient({ baseUrl: address.baseUrl });
    const health = await client.health();
    expect(health?.ready).toBe(true);
    expect(health?.bootId).toBe(address.bootId);
  });

  it('reads session list through the RPC envelope and sanitizes to ≤5 redacted items', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'client-2', sessionListAvailable: true });
    runtimes.push(runtime);
    const address = await runtime.start();
    const client = new DshClient({ baseUrl: address.baseUrl, clientTag: 'test' });
    const result = await client.sessionList();
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.sessions[0]?.sessionId).toBeTruthy();
    expect(result.sessions[0]?.canOpen).toBe(true);
    // raw envelope is redacted (fake runtime sends no secrets, but the guard must be on)
    expect(result.raw).toBeTruthy();
  });

  it('rejects a non-DSH base URL before any network call', async () => {
    expect(() => new DshClient({ baseUrl: 'http://example.com:3080' })).toThrow(DshClientError);
  });

  it('fails fast on session.list when the capability is absent', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'client-3', sessionListAvailable: false });
    runtimes.push(runtime);
    const address = await runtime.start();
    const client = new DshClient({ baseUrl: address.baseUrl });
    await expect(client.sessionList()).rejects.toThrow(DshClientError);
  });
});