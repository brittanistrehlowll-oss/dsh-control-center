import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDshRuntime } from '@dsh-control-center/fake-runtime';
import {
  MutationBusyError,
  Supervisor,
  SupervisorLockError,
  acquireSingleInstanceLock,
  ensureStateLayout
} from './index.js';

const tempRoots: string[] = [];
const runtimes: FakeDshRuntime[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cc-supervisor-'));
  tempRoots.push(root);
  return root;
}

describe('Supervisor core', () => {
  it('acquires a single-instance lock and rejects a second holder', async () => {
    const root = await freshRoot();
    await ensureStateLayout(root);
    const lock = await acquireSingleInstanceLock(root, 'inst-1');
    await expect(acquireSingleInstanceLock(root, 'inst-2')).rejects.toBeInstanceOf(SupervisorLockError);
    await lock.release();
    // After release, another instance can acquire.
    const lock2 = await acquireSingleInstanceLock(root, 'inst-3');
    expect(lock2.filePath).toBe(join(root, 'supervisor.lock'));
    await lock2.release();
  });

  it('boots with a stable supervisorInstanceId and recovers the journal', async () => {
    const root = await freshRoot();
    const supervisor = new Supervisor({
      stateDir: root,
      supervisorInstanceId: 'supervisor-test-1',
      candidates: []
    });
    const started = await supervisor.start();
    expect(started.instanceId).toBe('supervisor-test-1');
    expect(started.unfinished).toEqual([]);
    await supervisor.stop();
  });

  it('rejects a second concurrent mutation under the single lease', async () => {
    const root = await freshRoot();
    const supervisor = new Supervisor({
      stateDir: root,
      supervisorInstanceId: 'supervisor-lease',
      candidates: []
    });
    await supervisor.start();
    const first = await supervisor.beginMutation({
      action: 'restart',
      idempotencyKey: 'idem-1',
      runtimeId: 'runtime-1',
      leaseHolder: 'supervisor-lease'
    });
    expect(first.status).toBe('accepted');

    await expect(supervisor.beginMutation({
      action: 'stop',
      idempotencyKey: 'idem-2',
      runtimeId: 'runtime-1',
      leaseHolder: 'supervisor-lease'
    })).rejects.toBeInstanceOf(MutationBusyError);

    // Same key replay returns the same operation (idempotent).
    const replay = await supervisor.beginMutation({
      action: 'restart',
      idempotencyKey: 'idem-1',
      runtimeId: 'runtime-1',
      leaseHolder: 'supervisor-lease'
    });
    expect(replay.operationId).toBe(first.operationId);
    await supervisor.stop();
  });

  it('rebuilds unfinished operations across a supervisor restart', async () => {
    const root = await freshRoot();
    const first = new Supervisor({ stateDir: root, supervisorInstanceId: 's-a', candidates: [] });
    await first.start();
    const op = await first.beginMutation({
      action: 'restart',
      idempotencyKey: 'idem-recover',
      runtimeId: 'runtime-1',
      leaseHolder: 's-a'
    });
    await first.stop();

    // New supervisor instance on the same state dir.
    const second = new Supervisor({ stateDir: root, supervisorInstanceId: 's-b', candidates: [] });
    const started = await second.start();
    expect(started.unfinished.some((u) => u.operationId === op.operationId)).toBe(true);
    await second.stop();
  });

  it('observer probes a live runtime and writes a snapshot', async () => {
    const root = await freshRoot();
    const runtime = new FakeDshRuntime({ runtimeId: 'obs' });
    runtimes.push(runtime);
    const address = await runtime.start();

    let saved = 0;
    const supervisor = new Supervisor({
      stateDir: root,
      supervisorInstanceId: 's-obs',
      candidates: [{
        runtimeId: address.runtimeId,
        source: 'legacy-watchdog',
        baseUrl: address.baseUrl,
        installOrigin: 'local-node-modules',
        installAuthority: 'delegated',
        profileId: address.profile,
        processId: address.processId,
        processStartedAt: address.processStartedAt,
        commandFingerprint: address.commandFingerprint
      }]
    });
    await supervisor.start({
      snapshotWriter: {
        save: async () => { saved += 1; },
        load: async () => undefined
      }
    });
    await supervisor.runObserver();
    expect(saved).toBe(1);
    const probe = supervisor.lastKnownProbe();
    expect(probe?.protocolValid).toBe(true);
    expect(probe?.health?.bootId).toBe(address.bootId);
    await supervisor.stop();
  });
});