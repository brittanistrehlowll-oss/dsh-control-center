import { describe, expect, it } from 'vitest';
import {
  CapabilitySetSchema,
  ControlHelloRequestSchema,
  ControlHelloResponseSchema,
  DiagnosticSummarySchema,
  InstanceIdentitySchema,
  LifecycleOperationSchema,
  OperationJournalEventSchema,
  QuotaSnapshotSchema,
  RuntimeDescriptorSchema,
  RuntimeSnapshotSchema,
  SurfaceSnapshotSchema,
  UpdateCandidateSchema,
  parseLifecycleOperation,
  parseSurfaceSnapshot
} from './index.js';

describe('control contract — schema round-trip (Checkpoint A: contract)', () => {
  it('parses a valid RuntimeDescriptor and rejects a non-strict extra key', () => {
    const descriptor = {
      schemaVersion: 1,
      runtimeId: 'runtime-1',
      source: 'legacy-watchdog',
      ownership: 'legacy',
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: 'web',
      dshVersion: '0.1.0-rc.7',
      webOrigin: 'http://127.0.0.1:3080',
      apiOrigin: 'http://127.0.0.1:3080',
      capabilities: {
        readOnlyProbe: true,
        lifecycle: false,
        quota: false,
        sessions: true,
        projection: false,
        deepLink: false,
        updates: false
      },
      detectedAt: new Date().toISOString()
    };
    expect(RuntimeDescriptorSchema.parse(descriptor).ownership).toBe('legacy');
    expect(RuntimeDescriptorSchema.safeParse({ ...descriptor, notAField: 1 }).success).toBe(false);
  });

  it('round-trips a full LifecycleOperation with lease and identities', () => {
    const now = new Date().toISOString();
    const op = {
      schemaVersion: 1,
      operationId: 'op-1',
      idempotencyKey: 'idem-1',
      action: 'restart',
      status: 'running',
      stage: 'verifying',
      recoveryMode: 'normal',
      runtimeId: 'runtime-1',
      requestedAt: now,
      updatedAt: now,
      expectedProfileId: 'web',
      ownership: 'legacy',
      lease: { holder: 'supervisor-1', acquiredAt: now },
      retryable: true,
      oldIdentity: { strength: 'strong', value: 'abc', evidence: { pid: 1, bootId: 'b1', profileId: 'web' }, observedAt: now },
      newIdentity: { strength: 'strong', value: 'def', evidence: { pid: 2, bootId: 'b2', profileId: 'web' }, observedAt: now }
    };
    const parsed = parseLifecycleOperation(op);
    expect(parsed.operationId).toBe('op-1');
    expect(parsed.idempotencyKey).toBe('idem-1');
    expect(parsed.newIdentity?.value).toBe('def');
    expect(LifecycleOperationSchema.safeParse({ ...op, status: 'nonsense' }).success).toBe(false);
  });

  it('accepts only server-response-shaped events in the journal', () => {
    const event = {
      schemaVersion: 1,
      seq: 1,
      ts: new Date().toISOString(),
      operationId: 'op-1',
      event: 'created',
      payload: { operation: { ok: true } }
    };
    expect(OperationJournalEventSchema.parse(event).seq).toBe(1);
    expect(OperationJournalEventSchema.safeParse({ ...event, seq: 0 }).success).toBe(false);
    expect(OperationJournalEventSchema.safeParse({ ...event, event: 'bogus' }).success).toBe(false);
  });

  it('parses a SurfaceSnapshot and enforces the recent-sessions cap', () => {
    const now = new Date().toISOString();
    const snapshot = {
      schemaVersion: 1,
      generatedAt: now,
      expiresAt: now,
      runtime: {
        runtimeId: 'r',
        state: 'running',
        ready: true,
        identityStrength: 'strong',
        observedAt: now,
        freshness: { state: 'live', observedAt: now, ageSeconds: 0 }
      },
      recentSessions: Array.from({ length: 6 }, (_, i) => ({ sessionId: 's' + i, state: 'idle', canOpen: true })),
      quota: [],
      diagnostics: { generatedAt: now, items: [], counts: { pass: 0, warn: 0, fail: 0, unknown: 0 } },
      source: { supervisorVersion: '0.1.0', contractVersion: 1 }
    };
    expect(SurfaceSnapshotSchema.safeParse(snapshot).success).toBe(false); // 6 sessions > cap 5
    const capped = { ...snapshot, recentSessions: snapshot.recentSessions.slice(0, 5) };
    expect(parseSurfaceSnapshot(capped).recentSessions).toHaveLength(5);
  });

  it('core schemas parse representative valid documents', () => {
    const now = new Date().toISOString();
    expect(InstanceIdentitySchema.parse({ strength: 'weak', evidence: {}, observedAt: now }).strength).toBe('weak');
    expect(CapabilitySetSchema.parse({
      readOnlyProbe: true, lifecycle: false, quota: false, sessions: true,
      projection: false, deepLink: false, updates: false
    }).sessions).toBe(true);
    expect(QuotaSnapshotSchema.parse({
      schemaVersion: 1, providerId: 'deepseek', state: 'ok',
      observedAt: now, expiresAt: now, metrics: []
    }).state).toBe('ok');
    expect(DiagnosticSummarySchema.parse({
      generatedAt: now, items: [], counts: { pass: 0, warn: 0, fail: 0, unknown: 0 }
    }).counts).toEqual({ pass: 0, warn: 0, fail: 0, unknown: 0 });
    expect(UpdateCandidateSchema.parse({
      repository: 'deepseek-ai/deepseek-harness',
      version: '0.1.0',
      commitSha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      channel: 'stable',
      discoveredAt: now,
      source: 'git-tag',
      verifiedOfficialSource: true
    }).verifiedOfficialSource).toBe(true);
    expect(RuntimeSnapshotSchema.parse({
      schemaVersion: 1,
      runtimeId: 'r',
      state: 'running',
      ready: true,
      identity: InstanceIdentitySchema.parse({ strength: 'strong', value: 'v', evidence: {}, observedAt: now }),
      observedAt: now
    }).ready).toBe(true);
    const helloReq = ControlHelloRequestSchema.parse({
      protocolVersion: 1, clientId: 'c', bootNonce: 'n', proof: 'p'
    });
    expect(helloReq.protocolVersion).toBe(1);
    expect(ControlHelloResponseSchema.parse({
      protocolVersion: 1, sessionId: 's', supervisorInstanceId: 'i', expiresAt: now
    }).sessionId).toBe('s');
  });
});