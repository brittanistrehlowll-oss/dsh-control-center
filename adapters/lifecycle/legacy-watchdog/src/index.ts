import {
  LifecycleOperationSchema,
  nowIso,
  type InstanceIdentity,
  type LifecycleOperation,
  type OperationStatus,
  type OperationStage
} from '@dsh-control-center/control-contract';

export { FileGateway, MARKER_NAMES, LEGACY_DSH_PORT, LEGACY_CONTROLLER_PORT } from './file-gateway.js';
export type { FileGatewayOptions } from './file-gateway.js';

/**
 * LegacyWatchdogAdapter — the ONLY place that knows the legacy DSH lifecycle
 * mechanics (ADR-004).
 *
 * Legacy facts (verified 2026-08-18):
 *   - `dsh-controller` runs on 127.0.0.1:3081 and owns the launch page.
 *   - Lifecycle is requested by writing marker files under the DSH `logs/` dir:
 *     `restart.requested`, `stop.requested`, `start.requested`.
 *   - An external watchdog (Start-DSH-Watchdog.ps1) consumes the markers and
 *     actually starts/stops the process. The controller NEVER kills anything.
 *   - `GET :3081/api/status` reports `state/bootId/pid/uptime/instanceId`.
 *
 * Boundary rules:
 *   - `3080`, `3081`, marker file names, and any PowerShell invocation live
 *     ONLY here. The Supervisor/UI/contract never see them.
 *   - This adapter NEVER calls Stop-Process / taskkill / kill.
 *   - In dry-run mode nothing on disk or the network is mutated.
 *
 * The adapter is transport-agnostic: lifecycle requests are expressed as
 * marker intents; the concrete marker write is delegated to a gateway function
 * so tests can use a fake gateway.
 */

export interface LifecycleGateway {
  /** Write a marker file (restart/stop/start.requested). */
  writeMarker(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; id: string }>;
  /** Read whether a marker currently exists. */
  markerExists(action: 'start' | 'stop' | 'restart'): Promise<boolean>;
  /** Read controller status at 127.0.0.1:3081. */
  readControllerStatus(): Promise<{ state: string; bootId?: string; pid?: number; instanceId?: string } | undefined>;
}

export type RestartOutcome =
  | { status: 'verified'; operation: LifecycleOperation }
  | { status: 'unconfirmed'; operation: LifecycleOperation; reason: 'no-strong-identity' | 'profile-mismatch' | 'lease-expired' | 'timeout' }
  | { status: 'failed'; operation: LifecycleOperation; error: string };

export interface RestartFsmConfig {
  operationId: string;
  idempotencyKey: string;
  expectedProfileId: string;
  lease: { holder: string; acquiredAt: string };
  verifyAfterMs?: number;
  timeoutMs?: number;
}

export interface RestartFsmState {
  status: OperationStatus;
  stage: OperationStage;
}

export class LegacyWatchdogAdapter {
  private readonly gateway: LifecycleGateway;

  constructor(gateway: LifecycleGateway) {
    this.gateway = gateway;
  }

  /** Read-only: current controller-reported state (no mutation). */
  async readState(): Promise<{ state: string; bootId?: string; pid?: number; instanceId?: string } | undefined> {
    return this.gateway.readControllerStatus();
  }

  /** Dry-run: verify the gateway is reachable and would accept the action. */
  async dryRun(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; reason?: string }> {
    const status = await this.gateway.readControllerStatus();
    if (!status) {
      return { ok: false, reason: 'legacy controller (3081) is not responding' };
    }
    return { ok: true };
  }

  /** Request a lifecycle action by marker intent (no process kill). */
  async requestLifecycle(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const result = await this.gateway.writeMarker(action);
      return result.ok ? { ok: true, id: result.id } : { ok: false, error: 'marker write failed' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Detect an external restart: bootId changed between observations. */
  detectExternalRestart(previous: { bootId?: string }, current: { bootId?: string }): { detected: boolean; previousBootId?: string | undefined; currentBootId?: string | undefined } {
    if (!previous.bootId || !current.bootId) {
      return { detected: false, previousBootId: previous.bootId, currentBootId: current.bootId };
    }
    return {
      detected: previous.bootId !== current.bootId,
      previousBootId: previous.bootId,
      currentBootId: current.bootId
    };
  }

  /** Reconcile after supervisor crash: rebuild a suspended operation. */
  reconcileUnfinished(operation: LifecycleOperation, currentIdentities: { old?: InstanceIdentity; new?: InstanceIdentity }): LifecycleOperation {
    // Rebuild the operation into 'running' at the recovery stage.
    const rebuilt: LifecycleOperation = LifecycleOperationSchema.parse({
      ...operation,
      status: 'running',
      ...(operation.stage === 'verifying' || operation.stage === 'health-wait' ? {} : { stage: 'health-wait' as OperationStage }),
      updatedAt: nowIso(),
      ...(currentIdentities.old ? { oldIdentity: currentIdentities.old } : {}),
      ...(currentIdentities.new ? { newIdentity: currentIdentities.new } : {})
    });
    return rebuilt;
  }

  /**
   * Restart FSM — a pure state machine used by the supervisor. It does NOT
   * perform side effects; the supervisor drives the gateway around it.
   */
  createRestartFsm(config: RestartFsmConfig): RestartFsm {
    return new RestartFsm(config);
  }
}

export class RestartFsm {
  private readonly config: RestartFsmConfig;
  private state: RestartFsmState = { status: 'running', stage: 'waiting-safe-point' };
  private readonly startedAt = Date.now();
  private readonly verifyAfterMs: number;
  private readonly timeoutMs: number;

  constructor(config: RestartFsmConfig) {
    this.config = config;
    this.verifyAfterMs = config.verifyAfterMs ?? 8_000;
    this.timeoutMs = config.timeoutMs ?? 90_000;
  }

  current(): RestartFsmState {
    return this.state;
  }

  advance(event: 'marker-written' | 'stopped' | 'health-ready' | 'timeout' | 'verify-passed' | 'verify-failed'): RestartFsmState {
    const now = Date.now();
    const elapsed = now - this.startedAt;
    if (elapsed > this.timeoutMs && this.state.status === 'running') {
      this.state = { status: 'timeout', stage: 'health-wait' };
      return this.state;
    }
    switch (this.state.stage) {
      case 'waiting-safe-point':
        if (event === 'marker-written') this.state = { status: 'running', stage: 'stopping' };
        break;
      case 'stopping':
        if (event === 'stopped') this.state = { status: 'running', stage: 'starting' };
        break;
      case 'starting':
        if (event === 'health-ready') this.state = { status: 'running', stage: 'verifying' };
        break;
      case 'verifying':
        if (event === 'verify-passed') this.state = { status: 'completed', stage: 'verifying' };
        if (event === 'verify-failed') this.state = { status: 'failed', stage: 'verifying' };
        break;
      default:
        break;
    }
    return this.state;
  }

  /** Evaluate the plan's restart-success rule (identity exact match). */
  evaluateSuccess(input: {
    ready: boolean;
    oldIdentity?: InstanceIdentity;
    newIdentity?: InstanceIdentity;
    identityStrength: 'strong' | 'weak' | 'none';
    profileMatches: boolean;
    leaseValid: boolean;
  }): RestartOutcome {
    const operation: LifecycleOperation = LifecycleOperationSchema.parse({
      schemaVersion: 1,
      operationId: this.config.operationId,
      idempotencyKey: this.config.idempotencyKey,
      action: 'restart',
      status: input.ready ? 'completed' : 'running',
      stage: input.ready ? 'verifying' : 'health-wait',
      recoveryMode: 'normal',
      runtimeId: 'legacy-dsh',
      requestedAt: new Date(this.startedAt).toISOString(),
      updatedAt: nowIso(),
      expectedProfileId: this.config.expectedProfileId,
      ...(input.oldIdentity ? { oldIdentity: input.oldIdentity } : {}),
      ...(input.newIdentity ? { newIdentity: input.newIdentity } : {}),
      ownership: 'legacy',
      lease: this.config.lease,
      retryable: true
    });

    if (!input.ready) {
      return { status: 'unconfirmed', operation, reason: 'timeout' };
    }
    if (input.identityStrength !== 'strong') {
      return { status: 'unconfirmed', operation, reason: 'no-strong-identity' };
    }
    if (!input.profileMatches) {
      return { status: 'failed', operation, error: 'profile mismatch after restart' };
    }
    if (!input.leaseValid) {
      return { status: 'failed', operation, error: 'operation lease expired or superseded' };
    }
    const oldValue = input.oldIdentity?.value;
    const newValue = input.newIdentity?.value;
    if (!oldValue || !newValue || oldValue === newValue) {
      return { status: 'unconfirmed', operation, reason: 'no-strong-identity' };
    }
    return { status: 'verified', operation };
  }
}