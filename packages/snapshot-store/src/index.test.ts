import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SurfaceSnapshot } from '@dsh-control-center/control-contract';
import { SensitiveSurfaceDataError, SnapshotStore } from './index.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function snapshot(version: string): SurfaceSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt: now,
    expiresAt: now,
    runtime: {
      runtimeId: 'runtime-1',
      state: 'running',
      ready: true,
      version,
      profileId: 'web',
      identityStrength: 'strong',
      observedAt: now,
      freshness: { state: 'live', observedAt: now, ageSeconds: 0 }
    },
    recentSessions: [],
    quota: [],
    diagnostics: {
      generatedAt: now,
      items: [],
      counts: { pass: 0, warn: 0, fail: 0, unknown: 0 }
    },
    source: {
      supervisorVersion: '0.1.0',
      contractVersion: 1,
      dshVersion: version
    }
  };
}

describe('SnapshotStore', () => {
  it('writes atomically and falls back to the last-good snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-snapshot-'));
    tempRoots.push(root);
    const store = new SnapshotStore(root);
    await store.save(snapshot('0.1.0-rc.7'));
    await store.save(snapshot('0.1.0-rc.8'));
    await writeFile(join(root, 'surface-snapshot.json'), '{broken', 'utf8');

    const loaded = await store.load();
    expect(loaded?.source).toBe('last-good');
    expect(loaded?.snapshot.source.dshVersion).toBe('0.1.0-rc.7');
    expect(await readFile(join(root, 'surface-snapshot.last-good.json'), 'utf8')).toContain('0.1.0-rc.7');
  });

  it('rejects prompt-like or credential-like fields before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-snapshot-'));
    tempRoots.push(root);
    const store = new SnapshotStore(root);
    const unsafe = { ...snapshot('0.1.0-rc.7'), prompt: 'do not persist' };

    await expect(store.save(unsafe as unknown as SurfaceSnapshot)).rejects.toBeInstanceOf(SensitiveSurfaceDataError);
  });
});
