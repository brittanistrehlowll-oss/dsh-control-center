import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDshRuntime } from '@dsh-control-center/fake-runtime';
import { DshClient } from '@dsh-control-center/dsh-client';
import { redact, REDACTED } from '@dsh-control-center/security';
import { SnapshotStore, SensitiveSurfaceDataError } from '@dsh-control-center/snapshot-store';
import type { SurfaceSnapshot } from '@dsh-control-center/control-contract';

const tempRoots: string[] = [];
const runtimes: FakeDshRuntime[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

describe('security pipeline (RPC -> redact -> snapshot)', () => {
  it('never lets prompt-like RPC payloads reach the snapshot', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'sec' });
    runtimes.push(runtime);
    const address = await runtime.start();
    const client = new DshClient({ baseUrl: address.baseUrl, clientTag: 'sec-test' });

    // A hostile upstream response shape (as if leakage happened in the proxy):
    const hostileEnvelope = {
      type: 'server-response',
      rpcId: 'x',
      result: {
        ok: true,
        value: {
          items: [
            {
              sessionId: 's-1',
              title: 'hello',
              prompt: 'do-not-persist',
              assistant: { content: 'secret-body' },
              tool_arguments: { command: 'rm -rf' },
              cookie: 'session=abc',
              authorization: 'Bearer abc123'
            }
          ]
        }
      }
    };

    const redacted = redact(hostileEnvelope) as { result: { value: { items: Array<Record<string, unknown>> } } };
    const items = redacted.result.value.items;
    expect(items[0]?.prompt).toBe(REDACTED);
    expect(items[0]?.assistant).toBe(REDACTED);
    expect(items[0]?.tool_arguments).toBe(REDACTED);
    expect(items[0]?.cookie).toBe(REDACTED);
    expect(items[0]?.authorization).toBe(REDACTED);

    // Sanitized session surfaces carry only safe fields.
    const now = new Date().toISOString();
    const snapshot: SurfaceSnapshot = {
      schemaVersion: 1,
      generatedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtime: {
        runtimeId: 'sec',
        state: 'running',
        ready: true,
        identityStrength: 'strong',
        observedAt: now,
        freshness: { state: 'live', observedAt: now, ageSeconds: 0 }
      },
      recentSessions: [{
        sessionId: 's-1',
        title: 'hello',
        state: 'idle',
        canOpen: true
      }],
      quota: [],
      diagnostics: {
        generatedAt: now,
        items: [],
        counts: { pass: 0, warn: 0, fail: 0, unknown: 0 }
      },
      source: { supervisorVersion: '0.1.0', contractVersion: 1 }
    };

    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-sec-'));
    tempRoots.push(root);
    const store = new SnapshotStore(root);
    await store.save(snapshot); // must not throw

    // A snapshot that still contains a prompt-like field must be refused.
    const leaking = {
      ...snapshot,
      recentSessions: [{ sessionId: 's-1', title: 'hi', state: 'idle', canOpen: true, prompt: 'leak' }]
    };
    await expect(store.save(leaking as unknown as SurfaceSnapshot)).rejects.toBeInstanceOf(SensitiveSurfaceDataError);
  });

  it('dsh-client sessionList output is redacted and bounded', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'sec2' });
    runtimes.push(runtime);
    const address = await runtime.start();
    const client = new DshClient({ baseUrl: address.baseUrl, clientTag: 'sec2' });
    const result = await client.sessionList();
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.sessions.length).toBeLessThanOrEqual(5);
    expect(result.sessions[0]?.canOpen).toBe(true);
    // raw envelope must be redactable and not contain secrets
    const rawJson = JSON.stringify(result.raw);
    expect(rawJson).not.toMatch(/ghp_|sk-|AKIA|Bearer\s+[A-Za-z0-9]/);
  });
});