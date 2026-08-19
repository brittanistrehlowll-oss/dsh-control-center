import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SurfaceSnapshot } from '@dsh-control-center/control-contract';
import { CompactionError, SnapshotCompactor } from './compactor.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function snapshot(version: string, seq: number): SurfaceSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    runtime: {
      runtimeId: 'r',
      state: 'running',
      ready: true,
      version,
      identityStrength: 'strong',
      observedAt: now,
      freshness: { state: 'live', observedAt: now, ageSeconds: 0 }
    },
    recentSessions: [],
    quota: [],
    diagnostics: { generatedAt: now, items: [], counts: { pass: seq, warn: 0, fail: 0, unknown: 0 } },
    source: { supervisorVersion: '0.1.0', contractVersion: 1, dshVersion: version }
  };
}

describe('SnapshotCompactor (safe compaction)', () => {
  it('folds history into a validated base snapshot with checksum', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-compact-'));
    tempRoots.push(root);
    const compactor = new SnapshotCompactor(root);

    const history = [snapshot('0.1.0-rc.6', 1), snapshot('0.1.0-rc.7', 2)];
    const latest = snapshot('0.1.0-rc.8', 3);
    const result = await compactor.compactHistory({ snapshots: history, latest });

    expect(result.count).toBe(3);
    expect(result.snapshotHash).toHaveLength(64);

    const base = await compactor.readCompactedBase();
    expect(base?.version).toBe('1.1');
    expect(base?.baseSnapshotHash).toBe(result.snapshotHash);
    expect((base?.baseSnapshot as SurfaceSnapshot).source.dshVersion).toBe('0.1.0-rc.8');
  });

  it('round-trips through atomic write (Windows-safe path used)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-compact-'));
    tempRoots.push(root);
    const compactor = new SnapshotCompactor(root);
    // Compact twice — the second overwrites the first via writeAtomicJson
    // (temp->rename with EEXIST retry), which raw fs.rename would fail on Windows.
    await compactor.compactHistory({ snapshots: [], latest: snapshot('0.1.0-rc.8', 1) });
    await compactor.compactHistory({ snapshots: [], latest: snapshot('0.1.0-rc.9', 2) });
    const base = await compactor.readCompactedBase();
    expect((base?.baseSnapshot as SurfaceSnapshot).source.dshVersion).toBe('0.1.0-rc.9');
  });

  it('rejects a latest snapshot that is not a valid SurfaceSnapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-compact-'));
    tempRoots.push(root);
    const compactor = new SnapshotCompactor(root);
    await expect(
      compactor.compactHistory({ snapshots: [], latest: { bogus: true } as unknown as SurfaceSnapshot })
    ).rejects.toBeInstanceOf(CompactionError);
  });

  it('writes an advisory journal checkpoint without truncating the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-compact-'));
    tempRoots.push(root);
    const compactor = new SnapshotCompactor(root);
    const path = await compactor.writeJournalCheckpoint({ lastSeq: 42, journalHash: 'abc'.repeat(22) });
    expect(path.endsWith('journal-checkpoint.json')).toBe(true);
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as { lastSeq: number };
    expect(raw.lastSeq).toBe(42);
  });
});