import { describe, expect, it } from 'vitest';
import { buildSummary, diagnose, runtimeStateFromDiagnostics, type DiagnosticContext } from './index.js';

function ctx(overrides: Partial<DiagnosticContext> = {}): DiagnosticContext {
  return {
    supervisorAlive: true,
    ipcListening: true,
    dshReachable: true,
    dshReady: true,
    dshVersion: '0.1.0-rc.7',
    identityStrength: 'strong',
    identityValue: 'abc123',
    ownershipKnown: true,
    watchdogResponding: true,
    watchdogState: 'running',
    port3080Open: true,
    port3081Open: true,
    quotaState: 'ok',
    updateSourceVerified: true,
    updateChannel: 'stable',
    snapshotUsable: true,
    journalHealthy: true,
    permissionsOkay: true,
    diskBytesFree: 10 * 1024 * 1024 * 1024,
    ...overrides
  };
}

describe('diagnostics', () => {
  it('produces all-PASS summary for a healthy system', () => {
    const items = diagnose(ctx());
    const summary = buildSummary(items);
    expect(summary.counts.fail).toBe(0);
    expect(summary.counts.pass).toBeGreaterThan(10);
    expect(summary.items.every((item) => item.status === 'PASS')).toBe(true);
  });

  it('flags identity weakness and watchdog outage as FAIL/WARN', () => {
    const items = diagnose(ctx({ identityStrength: 'none', watchdogResponding: false }));
    const summary = buildSummary(items);
    const identity = items.find((item) => item.id === 'identity');
    const watchdog = items.find((item) => item.id === 'watchdog');
    expect(identity?.status).toBe('FAIL');
    expect(watchdog?.status).toBe('FAIL');
    expect(summary.counts.fail).toBeGreaterThanOrEqual(2);
    expect(runtimeStateFromDiagnostics(items)).toBe('degraded');
  });

  it('keeps all statuses within the contract enum', () => {
    const items = diagnose(ctx({ quotaState: 'stale', updateSourceVerified: false }));
    for (const item of items) {
      expect(['PASS', 'WARN', 'FAIL', 'UNKNOWN']).toContain(item.status);
    }
  });
});