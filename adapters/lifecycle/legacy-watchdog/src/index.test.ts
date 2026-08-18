import { afterEach, describe, expect, it } from 'vitest';
import { FakeDshRuntime } from '@dsh-control-center/fake-runtime';
import { probeDsh, type DshProbeResult } from '@dsh-control-center/runtime-discovery';
import { LegacyWatchdogAdapter, RestartFsm, type LifecycleGateway } from './index.js';

const runtimes: FakeDshRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

function fakeGateway(overrides: Partial<LifecycleGateway> = {}): LifecycleGateway {
  return {
    writeMarker: async () => ({ ok: true, id: 'marker-1' }),
    markerExists: async () => false,
    readControllerStatus: async () => ({ state: 'running', bootId: 'dsh-boot-a' }),
    ...overrides
  };
}

describe('LegacyWatchdogAdapter', () => {
  it('dry-run fails when the controller is offline', async () => {
    const adapter = new LegacyWatchdogAdapter(fakeGateway({ readControllerStatus: async () => undefined }));
    const result = await adapter.dryRun('restart');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('3081');
  });

  it('dry-run passes when the controller responds', async () => {
    const adapter = new LegacyWatchdogAdapter(fakeGateway());
    expect((await adapter.dryRun('restart')).ok).toBe(true);
  });

  it('requestLifecycle writes a marker without killing anything', async () => {
    const written: string[] = [];
    const adapter = new LegacyWatchdogAdapter(fakeGateway({
      writeMarker: async (action) => { written.push(action); return { ok: true, id: 'm-1' }; }
    }));
    const result = await adapter.requestLifecycle('restart');
    expect(result.ok).toBe(true);
    expect(written).toEqual(['restart']);
  });

  it('detects an external restart via bootId change and ignores same-boot staleness', () => {
    const adapter = new LegacyWatchdogAdapter(fakeGateway());
    const changed = adapter.detectExternalRestart({ bootId: 'dsh-A' }, { bootId: 'dsh-B' });
    expect(changed.detected).toBe(true);
    const same = adapter.detectExternalRestart({ bootId: 'dsh-A' }, { bootId: 'dsh-A' });
    expect(same.detected).toBe(false);
    const missing = adapter.detectExternalRestart({}, { bootId: 'dsh-B' });
    expect(missing.detected).toBe(false);
  });

  it('reconciles a suspended operation back into running at a recovery stage', () => {
    const adapter = new LegacyWatchdogAdapter(fakeGateway());
    const op = adapter.reconcileUnfinished({
      schemaVersion: 1,
      operationId: 'op-42',
      idempotencyKey: 'idem-42',
      action: 'restart',
      status: 'running',
      stage: 'starting',
      recoveryMode: 'normal',
      runtimeId: 'runtime-1',
      requestedAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      ownership: 'legacy',
      lease: { holder: 'supervisor-1', acquiredAt: '2026-08-18T00:00:00.000Z' },
      retryable: true
    }, {});
    expect(op.status).toBe('running');
    expect(op.recoveryMode).toBe('normal');
    expect(['health-wait', 'starting', 'verifying']).toContain(op.stage);
  });
});

describe('RestartFsm — success rule (identity gate)', () => {
  it('verifies only when ready + strong + changed identity + profile + lease', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'fsm' });
    runtimes.push(runtime);
    const first = await runtime.start();
    const firstProbe = await probeDsh({
      runtimeId: first.runtimeId,
      source: 'legacy-watchdog',
      baseUrl: first.baseUrl,
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: first.profile,
      processId: first.processId,
      processStartedAt: first.processStartedAt,
      commandFingerprint: first.commandFingerprint
    });

    await runtime.stop();
    const second = await runtime.start();
    const secondProbe = await probeDsh({
      runtimeId: second.runtimeId,
      source: 'legacy-watchdog',
      baseUrl: second.baseUrl,
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: second.profile,
      processId: second.processId,
      processStartedAt: second.processStartedAt,
      commandFingerprint: second.commandFingerprint
    });

    const fsm = new RestartFsm({
      operationId: 'op-fsm',
      idempotencyKey: 'idem-fsm',
      expectedProfileId: first.profile,
      lease: { holder: 'supervisor-1', acquiredAt: new Date().toISOString() }
    });
    const outcome = fsm.evaluateSuccess({
      ready: true,
      identityStrength: secondProbe.identity.strength,
      oldIdentity: firstProbe.identity,
      newIdentity: secondProbe.identity,
      profileMatches: first.profile === second.profile,
      leaseValid: true
    });

    expect(firstProbe.identity.strength).toBe('strong');
    expect(secondProbe.identity.strength).toBe('strong');
    expect(secondProbe.identity.value).not.toBe(firstProbe.identity.value);
    expect(outcome.status).toBe('verified');
  });

  it('never reports verified when identity is weak or unchanged', async () => {
    const fsm = new RestartFsm({
      operationId: 'op-w',
      idempotencyKey: 'idem-w',
      expectedProfileId: 'web',
      lease: { holder: 's', acquiredAt: new Date().toISOString() }
    });
    const outcome = fsm.evaluateSuccess({
      ready: true,
      identityStrength: 'weak',
      profileMatches: true,
      leaseValid: true
    });
    expect(outcome.status).toBe('unconfirmed');

    // Stale same-boot: strong identity both sides with the SAME value must
    // never be reported verified — this is the "stale HTTP 200" false positive.
    const now = new Date().toISOString();
    const sameIdentity = {
      strength: 'strong' as const,
      value: 'same-boot-value',
      evidence: { pid: 100, bootId: 'boot-A', profileId: 'web' },
      observedAt: now
    };
    const stale = new RestartFsm({
      operationId: 'op-stale',
      idempotencyKey: 'idem-stale',
      expectedProfileId: 'web',
      lease: { holder: 's', acquiredAt: new Date().toISOString() }
    });
    const staleOutcome = stale.evaluateSuccess({
      ready: true,
      identityStrength: 'strong',
      oldIdentity: sameIdentity,
      newIdentity: sameIdentity,
      profileMatches: true,
      leaseValid: true
    });
    expect(staleOutcome.status).toBe('unconfirmed');

    // Profile mismatch after restart = failed, not verified.
    const mismatch = new RestartFsm({
      operationId: 'op-prof',
      idempotencyKey: 'idem-prof',
      expectedProfileId: 'web',
      lease: { holder: 's', acquiredAt: new Date().toISOString() }
    });
    const mismatchOutcome = mismatch.evaluateSuccess({
      ready: true,
      identityStrength: 'strong',
      oldIdentity: { ...sameIdentity, value: 'old' },
      newIdentity: { ...sameIdentity, value: 'new' },
      profileMatches: false,
      leaseValid: true
    });
    expect(mismatchOutcome.status).toBe('failed');
    if (outcome.status === 'unconfirmed') {
      expect(outcome.reason).toBe('no-strong-identity');
    }
  });

  it('advances through the FSM stages', () => {
    const fsm = new RestartFsm({
      operationId: 'op-f',
      idempotencyKey: 'idem-f',
      expectedProfileId: 'web',
      lease: { holder: 's', acquiredAt: new Date().toISOString() }
    });
    expect(fsm.current().stage).toBe('waiting-safe-point');
    fsm.advance('marker-written');
    expect(fsm.current().stage).toBe('stopping');
    fsm.advance('stopped');
    expect(fsm.current().stage).toBe('starting');
    fsm.advance('health-ready');
    expect(fsm.current().stage).toBe('verifying');
    fsm.advance('verify-passed');
    expect(fsm.current().status).toBe('completed');
  });
});