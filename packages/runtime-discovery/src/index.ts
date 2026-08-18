import { createHash } from 'node:crypto';
import {
  CapabilitySetSchema,
  InstanceIdentitySchema,
  RuntimeDescriptorSchema,
  type CapabilitySet,
  type InstanceIdentity,
  type Ownership,
  type RuntimeDescriptor
} from '@dsh-control-center/control-contract';
import { z } from 'zod';

/**
 * Real DSH surface (verified live on 0.1.0-rc.7, 2026-08-18):
 *
 *   GET  http://127.0.0.1:3080/api/system/health
 *        -> { "ok": true, "ready": true, "bootId": "dsh-...", "pid": 35116, "uptime": 1298.8 }
 *              bootId changes on every DSH start.
 *
 *   GET  http://127.0.0.1:3081/api/status        (legacy dsh-controller)
 *        -> { state, running, bootId, pid, uptime, instanceId }
 *
 *   POST http://127.0.0.1:3080/api/session.list  (RPC envelope)
 *        req  { type:'client-request', rpcId, method:'session.list', payload:{} }
 *        resp { type:'server-response', rpcId, result:{ ok, value:{ items:[...] } } }
 *
 * There is NO /__dsh/control/fingerprint endpoint.
 */

export const DshHealthSchema = z.object({
  ok: z.literal(true),
  ready: z.boolean(),
  bootId: z.string().min(1).optional(),
  pid: z.number().int().positive().optional(),
  uptime: z.number().nonnegative().optional(),
  version: z.string().min(1).optional(),
  profileId: z.string().min(1).optional()
}).strict();

export type DshHealth = z.infer<typeof DshHealthSchema>;

/** Legacy controller status (127.0.0.1:3081). */
export const ControllerStatusSchema = z.object({
  state: z.enum(['running', 'stopped', 'starting', 'stopping', 'restarting', 'error']),
  running: z.boolean().optional(),
  bootId: z.string().min(1).nullable().optional(),
  pid: z.number().int().positive().nullable().optional(),
  uptime: z.number().nonnegative().nullable().optional(),
  instanceId: z.string().min(1).optional()
}).strict();

export type ControllerStatus = z.infer<typeof ControllerStatusSchema>;

/** RPC envelope (POST /api/<method>, e.g. session.list). */
export const RpcRequestEnvelopeSchema = z.object({
  type: z.literal('client-request'),
  rpcId: z.string().min(1),
  method: z.string().min(1),
  payload: z.unknown()
}).strict();

export const RpcResponseEnvelopeSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string().min(1),
  result: z.object({
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.unknown().optional()
  }).strict()
}).strict();

export type RpcResponseEnvelope = z.infer<typeof RpcResponseEnvelopeSchema>;

export interface RuntimeCandidate {
  runtimeId: string;
  source: RuntimeDescriptor['source'];
  baseUrl: string;                 // usually http://127.0.0.1:3080
  controllerUrl?: string;          // usually http://127.0.0.1:3081
  profileId?: string;
  processId?: number;
  processStartedAt?: string;
  commandFingerprint?: string;
  dshVersion?: string;
  dshCommit?: string;
  rootPath?: string;
  installOrigin: RuntimeDescriptor['installOrigin'];
  installAuthority: RuntimeDescriptor['installAuthority'];
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export type DiscoveryErrorCode =
  | 'NOT_LOOPBACK'
  | 'TIMEOUT'
  | 'HTTP'
  | 'SCHEMA'
  | 'PROFILE_MISMATCH'
  | 'NOT_DSH';

export interface DshProbeResult {
  reachable: boolean;
  protocolValid: boolean;
  status?: number;
  identity: InstanceIdentity;
  descriptor?: RuntimeDescriptor;
  health?: DshHealth;
  controller?: ControllerStatus | undefined;
  errorCode?: DiscoveryErrorCode;
  observedAt: string;
}

export interface IdentityEvidenceInput {
  pid?: number | undefined;
  processStartedAt?: string | undefined;
  commandFingerprint?: string | undefined;
  protocolFingerprint?: string | undefined;
  bootId?: string | undefined;
  profileId?: string | undefined;
  observedAt?: string | undefined;
}

const defaultCapabilities: CapabilitySet = {
  readOnlyProbe: true,
  lifecycle: false,
  quota: false,
  sessions: false,
  projection: false,
  deepLink: false,
  updates: false
};

export function buildInstanceIdentity(input: IdentityEvidenceInput): InstanceIdentity {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const hasBootEvidence = input.bootId !== undefined && input.bootId.length > 0;
  const strong = input.pid !== undefined &&
    input.processStartedAt !== undefined &&
    input.commandFingerprint !== undefined &&
    input.profileId !== undefined &&
    hasBootEvidence;
  const weak = input.protocolFingerprint !== undefined || hasBootEvidence || input.pid !== undefined;
  const strength = strong ? 'strong' : weak ? 'weak' : 'none';
  const evidence: InstanceIdentity['evidence'] = {
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.processStartedAt !== undefined ? { processStartedAt: input.processStartedAt } : {}),
    ...(input.commandFingerprint !== undefined ? { commandFingerprint: input.commandFingerprint } : {}),
    ...(input.protocolFingerprint !== undefined ? { protocolFingerprint: input.protocolFingerprint } : {}),
    ...(input.bootId !== undefined ? { bootId: input.bootId } : {}),
    ...(input.profileId !== undefined ? { profileId: input.profileId } : {})
  };

  if (strength === 'strong') {
    const value = createHash('sha256').update([
      String(input.pid),
      input.processStartedAt,
      input.commandFingerprint,
      input.bootId ?? '',
      input.profileId
    ].join('|')).digest('hex');
    return InstanceIdentitySchema.parse({ strength, value, evidence, observedAt });
  }
  return InstanceIdentitySchema.parse({ strength, evidence, observedAt });
}

/** Strong-vs-strong identity change across two observations. */
export function identityChanged(oldIdentity: InstanceIdentity, newIdentity: InstanceIdentity): boolean {
  return oldIdentity.strength === 'strong' && newIdentity.strength === 'strong' &&
    oldIdentity.value !== undefined && newIdentity.value !== undefined &&
    oldIdentity.value !== newIdentity.value;
}

export function bootChanged(oldHealth: DshHealth | undefined, newHealth: DshHealth | undefined): boolean {
  return oldHealth?.bootId !== undefined && newHealth?.bootId !== undefined &&
    oldHealth.bootId !== newHealth.bootId;
}

export function inferOwnership(candidate: Pick<RuntimeCandidate, 'source' | 'installAuthority'>): Ownership {
  if (candidate.source === 'legacy-watchdog') return 'legacy';
  if (candidate.source === 'community-desktop') return 'delegated';
  if (candidate.installAuthority === 'read-only') return 'observe-only';
  if (candidate.installAuthority === 'mutable') return 'managed';
  return 'observe-only';
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error('response body exceeds limit');
  return new TextDecoder().decode(buffer);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function fetchJson(url: URL, init: RequestInit, options: ProbeOptions): Promise<{ status: number; raw: unknown } | { status: number; raw: null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await readBoundedBody(response, options.maxBodyBytes ?? 64 * 1024);
    let raw: unknown = null;
    try { raw = JSON.parse(body) as unknown; } catch { /* not json */ }
    return { status: response.status, raw };
  } catch (error) {
    if (isAbortError(error)) throw new Error('TIMEOUT');
    throw new Error('HTTP');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the live DSH surface. `candidate.baseUrl` points at the DSH web server
 * (default 127.0.0.1:3080); if `candidate.controllerUrl` is set, the legacy
 * controller (127.0.0.1:3081) status is also read for corroboration.
 */
export async function probeDsh(candidate: RuntimeCandidate, options: ProbeOptions = {}): Promise<DshProbeResult> {
  const observedAt = new Date().toISOString();
  const emptyIdentity = buildInstanceIdentity({ observedAt });

  const baseUrl = new URL(candidate.baseUrl);
  if (!isLoopbackHost(baseUrl.hostname)) {
    return { reachable: false, protocolValid: false, identity: emptyIdentity, errorCode: 'NOT_LOOPBACK', observedAt };
  }

  // 1) DSH health endpoint — schema is the DSH discriminator.
  const healthUrl = new URL('/api/system/health', baseUrl);
  let health: DshHealth | undefined;
  let healthStatus: number | undefined;
  let controller: ControllerStatus | undefined;
  try {
    const result = await fetchJson(healthUrl, { method: 'GET', headers: { accept: 'application/json' } }, options);
    healthStatus = result.status;
    const parsed = DshHealthSchema.safeParse(result.raw);
    if (!parsed.success || result.status !== 200) {
      return {
        reachable: result.status !== 0,
        protocolValid: false,
        status: result.status,
        identity: emptyIdentity,
        errorCode: 'NOT_DSH',
        observedAt
      };
    }
    health = parsed.data;
  } catch (error) {
    return {
      reachable: false,
      protocolValid: false,
      identity: emptyIdentity,
      errorCode: error instanceof Error && error.message === 'TIMEOUT' ? 'TIMEOUT' : 'HTTP',
      observedAt
    };
  }

  // 2) Optional legacy controller corroboration.
  if (candidate.controllerUrl) {
    const controllerUrl = new URL(candidate.controllerUrl);
    if (isLoopbackHost(controllerUrl.hostname)) {
      const statusUrl = new URL('/api/status', controllerUrl);
      try {
        const result = await fetchJson(statusUrl, { method: 'GET', headers: { accept: 'application/json' } }, options);
        const parsed = ControllerStatusSchema.safeParse(result.raw);
        if (parsed.success && result.status === 200) controller = parsed.data;
      } catch { /* controller offline is not a protocol failure for the DSH probe */ }
    }
  }

  // 3) profile consistency.
  if (candidate.profileId && health.profileId && candidate.profileId !== health.profileId) {
    return {
      reachable: true,
      protocolValid: false,
      status: healthStatus,
      identity: buildInstanceIdentity({
        protocolFingerprint: fingerprintOf(health),
        bootId: health.bootId,
        profileId: health.profileId,
        observedAt
      }),
      errorCode: 'PROFILE_MISMATCH',
      observedAt
    };
  }

  const protocolFingerprint = fingerprintOf(health);
  const identity = buildInstanceIdentity({
    pid: candidate.processId ?? health.pid,
    processStartedAt: candidate.processStartedAt,
    commandFingerprint: candidate.commandFingerprint,
    protocolFingerprint,
    bootId: health.bootId,
    profileId: health.profileId ?? candidate.profileId,
    observedAt
  });

  const capabilities = CapabilitySetSchema.parse({
    ...defaultCapabilities,
    readOnlyProbe: true,
    sessions: true
  });

  const descriptor = RuntimeDescriptorSchema.parse({
    schemaVersion: 1,
    runtimeId: candidate.runtimeId,
    source: candidate.source,
    ownership: inferOwnership(candidate),
    installOrigin: candidate.installOrigin,
    installAuthority: candidate.installAuthority,
    profileId: health.profileId ?? candidate.profileId,
    dshVersion: health.version ?? candidate.dshVersion,
    dshCommit: candidate.dshCommit,
    webOrigin: candidate.baseUrl,
    apiOrigin: candidate.baseUrl,
    rootPath: candidate.rootPath,
    processId: candidate.processId ?? health.pid,
    processStartedAt: candidate.processStartedAt,
    commandFingerprint: candidate.commandFingerprint,
    protocolFingerprint,
    capabilities,
    detectedAt: observedAt
  });

  return {
    reachable: true,
    protocolValid: true,
    status: healthStatus,
    identity,
    descriptor,
    health,
    controller,
    observedAt
  };
}

function fingerprintOf(health: DshHealth): string {
  return createHash('sha256').update(JSON.stringify({
    ok: true,
    ready: health.ready,
    bootId: health.bootId ?? null,
    pid: health.pid ?? null,
    uptime: health.uptime ?? null,
    version: health.version ?? null
  })).digest('hex');
}

export class RuntimeDiscovery {
  constructor(readonly candidates: RuntimeCandidate[]) {}

  async discover(options: ProbeOptions = {}): Promise<DshProbeResult | undefined> {
    const ordered = [...this.candidates].sort((a, b) => candidatePriority(a) - candidatePriority(b));
    for (const candidate of ordered) {
      const result = await probeDsh(candidate, options);
      if (result.protocolValid) return result;
    }
    return undefined;
  }
}

function candidatePriority(candidate: RuntimeCandidate): number {
  if (candidate.source === 'legacy-watchdog') return 10;
  if (candidate.source === 'community-desktop') return 20;
  if (candidate.source === 'standalone') return 30;
  return 40;
}