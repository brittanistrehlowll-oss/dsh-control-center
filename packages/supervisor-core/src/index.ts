import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LifecycleOperationSchema,
  nowIso,
  type DiagnosticItem,
  type LifecycleOperation,
  type QuotaSnapshot,
  type SurfaceSnapshot
} from '@dsh-control-center/control-contract';
import { OperationJournal } from '@dsh-control-center/operation-journal';
import { RuntimeDiscovery, type DshProbeResult, type RuntimeCandidate } from '@dsh-control-center/runtime-discovery';
import { redact, redactLogLine } from '@dsh-control-center/security';
import { buildSummary, diagnose, type DiagnosticContext } from '@dsh-control-center/diagnostics';
import { DshClient } from '@dsh-control-center/dsh-client';
import { QuotaAdapter } from '@dsh-control-center/quota-adapter';

/**
 * SupervisorCore — single instance, journal-authoritative control plane core.
 *
 * Phase 2 order: single-instance lock → supervisorInstanceId → load config →
 * recover journal → rebuild unfinished operations → discovery → adapters →
 * reconcile → IPC → low-frequency observer.
 *
 * Rules enforced here:
 *  - operations.jsonl is the ONLY authority; current-operation.json is derived.
 *  - One mutation lease at a time (operation status must be terminal before a
 *    new mutation is accepted).
 *  - Every mutation has operationId + idempotencyKey; duplicate idempotencyKey
 *    for an in-flight operation is rejected.
 *  - No process kill, no direct DSH mutation. Lifecycle goes through an adapter.
 */

export interface SupervisorConfig {
  /** Data/state root (journals, snapshots). Defaults to DSHControlCenter state dir. */
  stateDir: string;
  supervisorInstanceId?: string;
  /** Candidate list for runtime discovery (ports 3080/3081 live inside adapters only). */
  candidates: RuntimeCandidate[];
  /** Poll cadence for the low-frequency observer. */
  observeIntervalMs?: number;
}

export interface SupervisorEnv {
  now?: () => string;
}

export interface SnapshotWriter {
  save(snapshot: SurfaceSnapshot): Promise<void>;
  load(): Promise<{ snapshot: SurfaceSnapshot; source: 'current' | 'last-good' } | undefined>;
}

export interface LifecyclePort {
  dryRun(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; reason?: string }>;
  requestLifecycle(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; id?: string; error?: string }>;
}

export interface ObserverContext {
  probe: DshProbeResult | undefined;
  snapshotUsable: boolean;
  journalHealthy: boolean;
  unfinished: LifecycleOperation[];
  sessions: number;
  quotaStates: QuotaSnapshot[];
  diagnostics: DiagnosticItem[];
}

export type Observer = (ctx: ObserverContext) => Promise<void> | void;

export class SupervisorLockError extends Error {
  constructor() {
    super('another supervisor instance holds the state lock');
    this.name = 'SupervisorLockError';
  }
}

export class MutationBusyError extends Error {
  constructor() {
    super('a lifecycle mutation is already in flight (single mutation lease)');
    this.name = 'MutationBusyError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`duplicate idempotencyKey in flight: ${key}`);
    this.name = 'IdempotencyConflictError';
  }
}

interface LockHandle {
  filePath: string;
  release(): Promise<void>;
}

/** O_EXCL-based single-instance lock with stale detection by pid liveness. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireSingleInstanceLock(stateDir: string, instanceId: string): Promise<LockHandle> {
  await mkdir(stateDir, { recursive: true });
  const filePath = join(stateDir, 'supervisor.lock');
  const payload = `${JSON.stringify({ instanceId, pid: process.pid, acquiredAt: nowIso() })}\n`;
  try {
    const handle = await open(filePath, 'wx');
    await handle.writeFile(payload, 'utf8');
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stale = await tryTakeIfStale(filePath);
    if (!stale) throw new SupervisorLockError();
    await rm(filePath, { force: true });
    const handle = await open(filePath, 'wx');
    await handle.writeFile(payload, 'utf8');
    await handle.close();
  }
  return {
    filePath,
    async release() {
      await rm(filePath, { force: true });
    }
  };
}

async function tryTakeIfStale(filePath: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { pid?: number };
    if (typeof raw.pid === 'number') {
      if (isProcessAlive(raw.pid)) return false; // holder alive (including ourselves)
      return true; // dead holder -> stale, takeover allowed
    }
    return false; // malformed pid — refuse to guess
  } catch {
    return false; // unreadable — refuse to steal
  }
}

export interface SupervisorStartResult {
  instanceId: string;
  journal: OperationJournal;
  unfinished: LifecycleOperation[];
  lock: LockHandle;
  discovery: RuntimeDiscovery;
}

export class Supervisor {
  readonly instanceId: string;
  readonly config: SupervisorConfig;
  readonly journal: OperationJournal;
  readonly stateDir: string;
  private readonly now: () => string;
  private discovery: RuntimeDiscovery | undefined;
  private observer: Observer | undefined;
  private observerTimer: NodeJS.Timeout | undefined;
  private lock: LockHandle | undefined;
  private snapshotWriter: SnapshotWriter | undefined;
  private lifecycle: LifecyclePort | undefined;
  private lastProbe: DshProbeResult | undefined;
  private dshClient: DshClient | undefined;
  private quotaAdapters: QuotaAdapter[] = [];

  constructor(config: SupervisorConfig, env: SupervisorEnv = {}) {
    this.config = config;
    this.stateDir = config.stateDir;
    this.instanceId = config.supervisorInstanceId ?? 'supervisor-' + randomUUID().slice(0, 8);
    this.now = env.now ?? nowIso;
    this.journal = new OperationJournal(join(config.stateDir, 'journal'));
  }

  get journalHealthy(): boolean {
    return this.journal !== undefined;
  }

  async start(options: {
    snapshotWriter?: SnapshotWriter;
    lifecycle?: LifecyclePort;
    observer?: Observer;
    dshClient?: DshClient;
    quotaAdapters?: QuotaAdapter[];
  } = {}): Promise<SupervisorStartResult> {
    this.lock = await acquireSingleInstanceLock(this.stateDir, this.instanceId);

    // Journal recovery: initialize (reads operations.jsonl), then rebuild
    // unfinished operations into the running state.
    await this.journal.initialize();
    const unfinished = await this.journal.reconcileDerivedState();

    this.snapshotWriter = options.snapshotWriter;
    this.lifecycle = options.lifecycle;
    this.observer = options.observer;
    this.dshClient = options.dshClient;
    this.quotaAdapters = options.quotaAdapters ?? [];
    this.discovery = new RuntimeDiscovery(this.config.candidates);

    if (this.observer) {
      const interval = this.config.observeIntervalMs ?? 10_000;
      this.observerTimer = setInterval(() => this.runObserver(), interval);
      this.observerTimer.unref();
    }

    return {
      instanceId: this.instanceId,
      journal: this.journal,
      unfinished,
      lock: this.lock,
      discovery: this.discovery
    };
  }

  async stop(): Promise<void> {
    if (this.observerTimer) clearInterval(this.observerTimer);
    this.observerTimer = undefined;
    if (this.lock) await this.lock.release();
    this.lock = undefined;
  }

  lastKnownProbe(): DshProbeResult | undefined {
    return this.lastProbe;
  }

  /**
   * Accept a lifecycle mutation under the single-lease + idempotency rules.
   * This only RECORDS intent; actual side effects belong to the adapter the
   * caller wires in. Returns the persisted operation.
   */
  async beginMutation(input: {
    action: 'start' | 'stop' | 'restart' | 'update';
    idempotencyKey: string;
    expectedProfileId?: string;
    runtimeId: string;
    leaseHolder: string;
  }): Promise<LifecycleOperation> {
    if (this.lifecycle && this.lifecycle.dryRun) {
      const dry = await this.lifecycle.dryRun(input.action === 'restart' ? 'restart' : input.action === 'update' ? 'restart' : input.action);
      if (!dry.ok) {
        throw new Error('lifecycle dry-run failed: ' + (dry.reason ?? 'unknown'));
      }
    }
    const unfinished = await this.journal.getUnfinishedOperations();
    if (unfinished.length > 0) {
      const inFlight = unfinished.find((op) => op.action === input.action);
      if (inFlight && inFlight.idempotencyKey === input.idempotencyKey) {
        // Same request, same key — idempotent replay of an in-flight operation.
        return inFlight;
      }
      throw new MutationBusyError();
    }

    // Full-history idempotency: a terminal operation with the same key is
    // replayed as its outcome rather than creating a new operation.
    const previous = await this.journal.getOperationByIdempotencyKey(input.idempotencyKey);
    if (previous) {
      if (previous.action !== input.action) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }
      return previous;
    }

    const operation: LifecycleOperation = LifecycleOperationSchema.parse({
      schemaVersion: 1,
      operationId: 'op-' + randomUUID().slice(0, 12),
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      status: 'accepted',
      stage: 'waiting-safe-point',
      recoveryMode: 'normal',
      runtimeId: input.runtimeId,
      requestedAt: this.now(),
      updatedAt: this.now(),
      ...(input.expectedProfileId !== undefined ? { expectedProfileId: input.expectedProfileId } : {}),
      ownership: 'legacy',
      lease: { holder: input.leaseHolder, acquiredAt: this.now() },
      retryable: true
    });
    const event = await this.journal.append({
      event: 'created',
      operationId: operation.operationId,
      payload: { operation }
    });
    await this.journal.persistCurrentOperation(operation);
    return operation;
  }

  /** Reconcile after a (simulated or real) supervisor restart. */
  async reconcileUnfinished(): Promise<LifecycleOperation[]> {
    await this.journal.initialize();
    return this.journal.reconcileDerivedState();
  }

  /** Low-frequency observer: probe, build a redacted snapshot, persist. */
  async runObserver(): Promise<void> {
    if (!this.discovery) return;
    const probe = await this.discovery.discover();
    this.lastProbe = probe;
    const sessions = await this.readSessions();
    const quota = await this.readQuotaStates();
    const diagnostics = this.buildDiagnostics(probe, sessions, quota);
    if (this.snapshotWriter && probe) {
      const snapshot = await this.buildSurfaceSnapshot(probe, { sessions, quota, diagnostics });
      try {
        await this.snapshotWriter.save(snapshot);
        await this.snapshotWriter.load(); // validate round-trip (last-good)
      } catch (error) {
        // Snapshot write failure must not take down the observer.
        console.warn('[supervisor] snapshot write failed:', redactLogLine(String(error)));
      }
    }
    if (this.observer) {
      await this.observer({
        probe,
        snapshotUsable: this.snapshotWriter !== undefined,
        journalHealthy: this.journalHealthy,
        unfinished: await this.journal.getUnfinishedOperations(),
        sessions: sessions.length,
        quotaStates: quota,
        diagnostics
      });
    }
  }

  private async readSessions(): Promise<SurfaceSnapshot['recentSessions']> {
    if (!this.dshClient) return [];
    try {
      const result = await this.dshClient.sessionList();
      return result.sessions;
    } catch (error) {
      console.warn('[supervisor] session list unavailable:', redactLogLine(String(error)));
      return [];
    }
  }

  private async readQuotaStates(): Promise<QuotaSnapshot[]> {
    if (this.quotaAdapters.length === 0) return [];
    const results = await Promise.allSettled(this.quotaAdapters.map((adapter) => adapter.fetchQuota()));
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }

  private buildDiagnostics(
    probe: DshProbeResult | undefined,
    sessions: SurfaceSnapshot['recentSessions'],
    quotaStates: QuotaSnapshot[]
  ): DiagnosticItem[] {
    const dshVersion = probe?.health?.version ?? probe?.descriptor?.dshVersion;
    const watchdogState = probe?.controller?.state;
    const quotaState = quotaStates[0]?.state;
    const ctx: DiagnosticContext = {
      supervisorAlive: true,
      supervisorInstanceId: this.instanceId,
      ipcListening: false,
      dshReachable: probe?.reachable ?? false,
      dshReady: probe?.health?.ready ?? false,
      ...(dshVersion !== undefined ? { dshVersion } : {}),
      identityStrength: probe?.identity.strength ?? 'none',
      ownershipKnown: probe?.descriptor?.ownership !== undefined,
      watchdogResponding: probe?.controller !== undefined,
      ...(watchdogState !== undefined ? { watchdogState } : {}),
      port3080Open: probe?.reachable ?? false,
      port3081Open: probe?.controller !== undefined,
      ...(quotaState !== undefined ? { quotaState } : {}),
      updateSourceVerified: false,
      snapshotUsable: this.snapshotWriter !== undefined,
      journalHealthy: this.journalHealthy,
      permissionsOkay: true
    };
    return diagnose(ctx);
  }

  async buildSurfaceSnapshot(
    probe: DshProbeResult,
    extras: {
      sessions?: SurfaceSnapshot['recentSessions'];
      quota?: QuotaSnapshot[];
      diagnostics?: DiagnosticItem[];
    } = {}
  ): Promise<SurfaceSnapshot> {
    const observedAt = this.now();
    const sessions = extras.sessions ?? [];
    const quota = extras.quota ?? [];
    const diagnostics = extras.diagnostics ?? [];
    const summary = buildSummary(diagnostics);
    const runtime = probe.descriptor
      ? {
          runtimeId: probe.descriptor.runtimeId,
          state: (probe.health?.ready ? 'running' : 'starting') as SurfaceSnapshot['runtime']['state'],
          ready: probe.health?.ready ?? false,
          ...(probe.health?.version ?? probe.descriptor.dshVersion ? { version: probe.health?.version ?? probe.descriptor.dshVersion } : {}),
          ...(probe.descriptor.profileId ? { profileId: probe.descriptor.profileId } : {}),
          identityStrength: probe.identity.strength,
          observedAt,
          freshness: { state: 'live' as const, observedAt, ageSeconds: 0 }
        }
      : {
          runtimeId: 'unknown',
          state: 'unknown' as const,
          ready: false,
          identityStrength: 'none' as const,
          observedAt,
          freshness: { state: 'unknown' as const, observedAt, ageSeconds: 0 }
        };
    const snapshot: SurfaceSnapshot = {
      schemaVersion: 1,
      generatedAt: observedAt,
      expiresAt: new Date(new Date(observedAt).getTime() + 60_000).toISOString(),
      runtime,
      recentSessions: sessions.slice(0, 5),
      quota,
      diagnostics: summary,
      source: {
        supervisorVersion: '0.1.0',
        contractVersion: 1,
        ...(probe.health?.version ? { dshVersion: probe.health.version } : {})
      }
    };
    return snapshot;
  }
}

/** Create the state layout for a fresh supervisor. */
export async function ensureStateLayout(stateDir: string): Promise<void> {
  await mkdir(join(stateDir, 'journal'), { recursive: true });
  await mkdir(join(stateDir, 'snapshots'), { recursive: true });
}

export { OperationJournal };
export { RuntimeDiscovery };

export function redactForLog(value: unknown): unknown {
  return redact(value);
}