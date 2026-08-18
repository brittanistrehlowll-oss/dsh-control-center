import {
  DiagnosticStatusSchema,
  type DiagnosticItem,
  type DiagnosticStatus,
  type DiagnosticSummary,
  type RuntimeState
} from '@dsh-control-center/control-contract';

/**
 * diagnostics — a uniform PASS | WARN | FAIL | UNKNOWN reporter across every
 * subsystem. Checks are plain functions returning a status; the summary builder
 * aggregates them into the contract's DiagnosticSummary.
 */

export type DiagnosticCheck = () => DiagnosticItem | Promise<DiagnosticItem>;

export interface DiagnosticContext {
  supervisorAlive: boolean;
  supervisorInstanceId?: string;
  ipcListening: boolean;
  dshReachable: boolean;
  dshReady: boolean;
  dshVersion?: string;
  identityStrength: 'strong' | 'weak' | 'none';
  identityValue?: string;
  ownershipKnown: boolean;
  watchdogResponding: boolean;
  watchdogState?: string;
  port3080Open: boolean;
  port3081Open: boolean;
  quotaState?: 'ok' | 'warn' | 'critical' | 'unavailable' | 'stale';
  updateSourceVerified: boolean;
  updateChannel?: 'stable' | 'preview';
  snapshotUsable: boolean;
  journalHealthy: boolean;
  permissionsOkay: boolean;
  diskBytesFree?: number;
}

export function statusOf(status: DiagnosticStatus, id: string, title: string, summary: string, suggestedAction?: string): DiagnosticItem {
  return {
    id,
    status,
    title,
    summary,
    observedAt: new Date().toISOString(),
    ...(suggestedAction !== undefined ? { suggestedAction } : {})
  };
}

const pass = (id: string, title: string, summary = '') => statusOf('PASS', id, title, summary);
const warn = (id: string, title: string, summary: string, suggestedAction?: string) =>
  statusOf('WARN', id, title, summary, suggestedAction);
const fail = (id: string, title: string, summary: string, suggestedAction?: string) =>
  statusOf('FAIL', id, title, summary, suggestedAction);
const unknown = (id: string, title: string, summary = '') => statusOf('UNKNOWN', id, title, summary);

export function diagnose(ctx: DiagnosticContext): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];

  // Supervisor
  items.push(ctx.supervisorAlive
    ? pass('supervisor', 'Supervisor', `running as ${ctx.supervisorInstanceId ?? 'unknown instance'}`)
    : fail('supervisor', 'Supervisor', 'Supervisor is not alive', 'Restart the Control Center supervisor.'));

  // IPC
  items.push(ctx.ipcListening
    ? pass('ipc', 'IPC server', 'listening')
    : fail('ipc', 'IPC server', 'IPC is not listening', 'Check Supervisor IPC port bindings.'));

  // DSH runtime
  if (!ctx.dshReachable) {
    items.push(warn('dsh', 'DSH Runtime', 'DSH is not reachable', 'Start DSH or use the offline snapshot view.'));
  } else if (ctx.dshReady) {
    items.push(pass('dsh', 'DSH Runtime', `ready${ctx.dshVersion ? ' · ' + ctx.dshVersion : ''}`));
  } else {
    items.push(warn('dsh', 'DSH Runtime', 'reachable but not ready'));
  }

  // Instance identity
  if (ctx.identityStrength === 'strong') {
    items.push(pass('identity', 'Instance identity', `strong (${ctx.identityValue?.slice(0, 12) ?? ''}…)`));
  } else if (ctx.identityStrength === 'weak') {
    items.push(warn('identity', 'Instance identity', 'weak — restart verification will be limited'));
  } else {
    items.push(fail('identity', 'Instance identity', 'no usable identity evidence'));
  }

  // Ownership
  items.push(ctx.ownershipKnown
    ? pass('ownership', 'Ownership', 'determined')
    : fail('ownership', 'Ownership', 'ownership could not be determined'));

  // Legacy watchdog
  if (ctx.watchdogResponding) {
    items.push(pass('watchdog', 'Legacy watchdog', `responds (${ctx.watchdogState ?? 'unknown'})`));
  } else {
    items.push(fail('watchdog', 'Legacy watchdog', 'controller (3081) not responding', 'Check dsh-controller / Start-DSH-Watchdog.ps1.'));
  }

  // Ports
  items.push(ctx.port3080Open ? pass('port-3080', 'Port 3080', 'open') : warn('port-3080', 'Port 3080', 'closed (expected when DSH is stopped)'));
  items.push(ctx.port3081Open ? pass('port-3081', 'Port 3081', 'open') : warn('port-3081', 'Port 3081', 'closed (controller offline)'));

  // Quota
  if (ctx.quotaState === undefined) {
    items.push(unknown('quota', 'Quota', 'not configured'));
  } else if (ctx.quotaState === 'ok') {
    items.push(pass('quota', 'Quota', 'ok'));
  } else if (ctx.quotaState === 'warn' || ctx.quotaState === 'critical' || ctx.quotaState === 'stale') {
    items.push(warn('quota', 'Quota', ctx.quotaState));
  } else {
    items.push(fail('quota', 'Quota', 'unavailable'));
  }

  // Update source
  items.push(ctx.updateSourceVerified
    ? pass('update', 'Update source', `verified official · ${ctx.updateChannel ?? 'stable'}`)
    : fail('update', 'Update source', 'not verified', 'Check the pinned repository identity.'));

  // Snapshot
  items.push(ctx.snapshotUsable ? pass('snapshot', 'Snapshot', 'usable') : unknown('snapshot', 'Snapshot', 'no snapshot yet'));

  // Journal
  items.push(ctx.journalHealthy ? pass('journal', 'Journal', 'healthy') : fail('journal', 'Journal', 'corrupt or unreadable'));

  // Permissions / disk
  items.push(ctx.permissionsOkay ? pass('permissions', 'Permissions', 'ok') : fail('permissions', 'Permissions', 'insufficient'));
  if (ctx.diskBytesFree !== undefined && ctx.diskBytesFree < 512 * 1024 * 1024) {
    items.push(warn('disk', 'Disk', `low free space (${Math.round(ctx.diskBytesFree / 1024 / 1024)} MB)`));
  } else {
    items.push(pass('disk', 'Disk', 'sufficient'));
  }

  return items;
}

export function buildSummary(items: DiagnosticItem[]): DiagnosticSummary {
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const item of items) {
    const status = DiagnosticStatusSchema.parse(item.status);
    if (status === 'PASS') counts.pass += 1;
    else if (status === 'WARN') counts.warn += 1;
    else if (status === 'FAIL') counts.fail += 1;
    else counts.unknown += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    items,
    counts
  };
}

export function runtimeStateFromDiagnostics(items: DiagnosticItem[]): RuntimeState {
  const hasFail = items.some((item) => item.status === 'FAIL');
  const hasWarn = items.some((item) => item.status === 'WARN');
  if (hasFail) return 'degraded';
  if (hasWarn) return 'starting';
  return 'running';
}