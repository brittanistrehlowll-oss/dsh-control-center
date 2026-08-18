import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateCandidate } from '@dsh-control-center/control-contract';
import { STAGING_ROOT, UpdateCoordinator, type UpdateContext, type UpdateExecutors } from './coordinator.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function candidate(overrides: Partial<UpdateCandidate> = {}): UpdateCandidate {
  return {
    repository: 'deepseek-ai/deepseek-harness',
    version: '0.1.0-rc.8',
    commitSha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
    channel: 'preview',
    discoveredAt: new Date().toISOString(),
    source: 'git-tag',
    verifiedOfficialSource: true,
    ...overrides
  };
}

function context(overrides: Partial<UpdateContext> = {}): UpdateContext {
  return {
    installAuthority: 'mutable',
    ownership: 'legacy',
    toolchain: { node: '24.19.0', pnpm: '11.19.0' },
    knownInstallOrigin: true,
    desktopManaged: false,
    ...overrides
  };
}

function okExecutors(): UpdateExecutors {
  return {
    stageArtifact: async (c, dir) => ({ stagingDir: dir, version: c.version, commitSha: c.commitSha }),
    startStaged: async (s) => ({ processId: 4242, healthUrl: 'http://127.0.0.1:3999/api/system/health' }),
    stopStaged: async () => {},
    probeStaged: async () => ({
      compatible: true,
      required: { runtimeFingerprint: true, sessionList: true },
      optional: { projection: false, deepLink: false },
      reasons: []
    }),
    verifyApplied: async () => ({ ok: true, identityConfirmed: true, versionMatches: true, profileMatches: true }),
    restoreOld: async () => {},
    restartOld: async () => {}
  };
}

describe('UpdateCoordinator — Checkpoint B', () => {
  it('is fail-closed: default executors refuse real execution', async () => {
    const coordinator = new UpdateCoordinator();
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('failed');
    expect(result.reason).toContain('EXECUTION_DISABLED');
  });

  it('plan() is pure: verify + gate without execution', async () => {
    const coordinator = new UpdateCoordinator();
    const ok = await coordinator.plan(candidate(), context());
    expect(ok.phase).toBe('staging');

    const badTag = await coordinator.plan(candidate({ version: 'master' }), context());
    expect(badTag.phase).toBe('verify');

    const notOfficial = await coordinator.plan(
      candidate({ repository: 'someone/dsh' } as unknown as UpdateCandidate),
      context()
    );
    expect(notOfficial.phase).toBe('verify');
  });

  it('rejects unknown install origin and desktop-managed installs (fail-closed)', async () => {
    const coordinator = new UpdateCoordinator();
    const unknown = await coordinator.plan(candidate(), context({ knownInstallOrigin: false }));
    expect(unknown.phase).toBe('compatibility');
    expect(unknown.reason).toContain('fail-closed');

    const desktop = await coordinator.plan(candidate(), context({ desktopManaged: true }));
    expect(desktop.phase).toBe('compatibility');
    expect(desktop.reason).toContain('fail-closed');
  });

  it('rejects when ownership is not legacy or authority not mutable', async () => {
    const coordinator = new UpdateCoordinator();
    const observeOnly = await coordinator.plan(candidate(), context({ ownership: 'observe-only' }));
    expect(observeOnly.phase).toBe('compatibility');

    const readOnly = await coordinator.plan(candidate(), context({ installAuthority: 'read-only' }));
    expect(readOnly.phase).toBe('compatibility');
  });

  it('completes a full update when all executors succeed', async () => {
    const coordinator = new UpdateCoordinator(okExecutors());
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('completed');
  });

  it('rolls back when the compatibility probe fails', async () => {
    const stopped: string[] = [];
    const restored: string[] = [];
    const restarted: string[] = [];
    const coordinator = new UpdateCoordinator({
      ...okExecutors(),
      probeStaged: async () => ({
        compatible: false,
        required: { runtimeFingerprint: false, sessionList: true },
        optional: { projection: false, deepLink: false },
        reasons: ['runtime fingerprint probe failed']
      }),
      stopStaged: async () => { stopped.push('stop'); },
      restoreOld: async () => { restored.push('restore'); },
      restartOld: async () => { restarted.push('restart'); }
    });
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('rolled-back');
    expect(result.rollback?.shouldRollback).toBe(true);
    expect(stopped).toEqual(['stop']);
    expect(restored).toEqual(['restore']);
    expect(restarted).toEqual(['restart']);
  });

  it('rolls back on identity-unconfirmed after apply', async () => {
    const coordinator = new UpdateCoordinator({
      ...okExecutors(),
      verifyApplied: async () => ({ ok: false, identityConfirmed: false, versionMatches: true, profileMatches: true })
    });
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('rolled-back');
    expect(result.rollback?.reason).toContain('identity');
  });

  it('rolls back on version mismatch after apply', async () => {
    const coordinator = new UpdateCoordinator({
      ...okExecutors(),
      verifyApplied: async () => ({ ok: false, identityConfirmed: true, versionMatches: false, profileMatches: true })
    });
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('rolled-back');
    expect(result.rollback?.reason).toContain('version');
  });

  it('rolls back when the staged runtime fails to start (executor throws)', async () => {
    const coordinator = new UpdateCoordinator({
      ...okExecutors(),
      startStaged: async () => { throw new Error('staged runtime crashed on boot'); }
    });
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('rolled-back');
    expect(result.rollback?.reason).toContain('start');
  });

  it('stages into the canonical staging layout with a stamped manifest', async () => {
    expect(STAGING_ROOT).toContain('DSHControlCenter');
    expect(STAGING_ROOT).toContain('runtimes');
    expect(STAGING_ROOT.endsWith('staging')).toBe(true);

    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-staging-'));
    tempRoots.push(root);
    const coordinator = new UpdateCoordinator(okExecutors(), { stagingRoot: root });
    const result = await coordinator.run(candidate(), context());
    expect(result.phase).toBe('completed');

    const manifest = join(root, 'dsh-0.1.0-rc.8', 'staged-manifest.json');
    const content = JSON.parse(await readFile(manifest, 'utf8')) as { version: string; verifiedOfficialSource: boolean };
    expect(content.version).toBe('0.1.0-rc.8');
    expect(content.verifiedOfficialSource).toBe(true);
  });
});