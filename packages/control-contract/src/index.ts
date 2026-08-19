import { z } from 'zod';

export const ContractVersion = 1 as const;

const IsoDateTime = z.string().datetime({ offset: true });
const NonEmptyString = z.string().min(1);

export const OwnershipSchema = z.enum([
  'managed',
  'legacy',
  'delegated',
  'observe-only'
]);
export type Ownership = z.infer<typeof OwnershipSchema>;

export const InstallOriginSchema = z.enum([
  'managed-cache',
  'local-node-modules',
  'source-checkout',
  'desktop-managed',
  'unknown'
]);
export type InstallOrigin = z.infer<typeof InstallOriginSchema>;

export const InstallAuthoritySchema = z.enum([
  'mutable',
  'delegated',
  'read-only'
]);
export type InstallAuthority = z.infer<typeof InstallAuthoritySchema>;

export const CapabilitySetSchema = z.object({
  readOnlyProbe: z.boolean(),
  lifecycle: z.boolean(),
  quota: z.boolean(),
  sessions: z.boolean(),
  projection: z.boolean(),
  deepLink: z.boolean(),
  updates: z.boolean()
}).strict();
export type CapabilitySet = z.infer<typeof CapabilitySetSchema>;

export const RuntimeDescriptorSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  runtimeId: NonEmptyString,
  source: z.enum([
    'standalone',
    'legacy-watchdog',
    'community-desktop',
    'unknown'
  ]),
  ownership: OwnershipSchema,
  installOrigin: InstallOriginSchema,
  installAuthority: InstallAuthoritySchema,
  profileId: NonEmptyString.optional(),
  dshVersion: NonEmptyString.optional(),
  dshCommit: NonEmptyString.optional(),
  webOrigin: z.string().url().optional(),
  apiOrigin: z.string().url().optional(),
  rootPath: NonEmptyString.optional(),
  processId: z.number().int().positive().optional(),
  processStartedAt: IsoDateTime.optional(),
  commandFingerprint: NonEmptyString.optional(),
  protocolFingerprint: NonEmptyString.optional(),
  capabilities: CapabilitySetSchema,
  detectedAt: IsoDateTime
}).strict();
export type RuntimeDescriptor = z.infer<typeof RuntimeDescriptorSchema>;

export const IdentityStrengthSchema = z.enum(['strong', 'weak', 'none']);
export type IdentityStrength = z.infer<typeof IdentityStrengthSchema>;

export const InstanceIdentitySchema = z.object({
  strength: IdentityStrengthSchema,
  value: NonEmptyString.optional(),
  evidence: z.object({
    pid: z.number().int().positive().optional(),
    processStartedAt: IsoDateTime.optional(),
    commandFingerprint: NonEmptyString.optional(),
    protocolFingerprint: NonEmptyString.optional(),
    bootId: NonEmptyString.optional(),
    profileId: NonEmptyString.optional()
  }).strict(),
  observedAt: IsoDateTime
}).strict();
export type InstanceIdentity = z.infer<typeof InstanceIdentitySchema>;

export const RuntimeStateSchema = z.enum([
  'unknown',
  'absent',
  'stopped',
  'starting',
  'running',
  'stopping',
  'degraded',
  'crash-loop',
  'error'
]);
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

export const RuntimeSnapshotSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  runtimeId: NonEmptyString,
  state: RuntimeStateSchema,
  ready: z.boolean(),
  identity: InstanceIdentitySchema,
  version: NonEmptyString.optional(),
  profileId: NonEmptyString.optional(),
  observedAt: IsoDateTime,
  lastReadyAt: IsoDateTime.optional(),
  degradedReason: NonEmptyString.optional()
}).strict();
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export const OperationStatusSchema = z.enum([
  'requested',
  'accepted',
  'running',
  'completed',
  'failed',
  'timeout',
  'cancelled'
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationStageSchema = z.enum([
  'validating',
  'waiting-safe-point',
  'stopping',
  'stopped',
  'starting',
  'health-wait',
  'verifying',
  'checking-update',
  'downloading',
  'staging',
  'compatibility-probe',
  'applying-update',
  'switching',
  'rolling-back'
]);
export type OperationStage = z.infer<typeof OperationStageSchema>;

export const RecoveryModeSchema = z.enum(['normal', 'reconciling']);
export type RecoveryMode = z.infer<typeof RecoveryModeSchema>;

export const ControlActionSchema = z.enum(['start', 'stop', 'restart', 'update']);
export type ControlAction = z.infer<typeof ControlActionSchema>;

export const LifecycleOperationSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  operationId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  action: ControlActionSchema,
  status: OperationStatusSchema,
  stage: OperationStageSchema.optional(),
  recoveryMode: RecoveryModeSchema,
  runtimeId: NonEmptyString,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  expectedProfileId: NonEmptyString.optional(),
  oldIdentity: InstanceIdentitySchema.optional(),
  newIdentity: InstanceIdentitySchema.optional(),
  ownership: OwnershipSchema,
  lease: z.object({
    holder: NonEmptyString,
    acquiredAt: IsoDateTime
  }).strict(),
  retryable: z.boolean(),
  errorCode: NonEmptyString.optional()
}).strict();
export type LifecycleOperation = z.infer<typeof LifecycleOperationSchema>;

export const OperationJournalEventSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  seq: z.number().int().positive(),
  ts: IsoDateTime,
  operationId: NonEmptyString,
  event: z.enum([
    'created',
    'accepted',
    'stage-changed',
    'evidence',
    'completed',
    'failed',
    'cancelled'
  ]),
  payload: z.unknown()
}).strict();
export type OperationJournalEvent = z.infer<typeof OperationJournalEventSchema>;

export const FreshnessSchema = z.object({
  state: z.enum(['live', 'fresh', 'stale', 'unknown']),
  observedAt: IsoDateTime.optional(),
  ageSeconds: z.number().nonnegative().optional()
}).strict();
export type Freshness = z.infer<typeof FreshnessSchema>;

export const RuntimeSurfaceSchema = z.object({
  runtimeId: NonEmptyString,
  state: RuntimeStateSchema,
  ready: z.boolean(),
  version: NonEmptyString.optional(),
  profileId: NonEmptyString.optional(),
  identityStrength: IdentityStrengthSchema,
  observedAt: IsoDateTime,
  freshness: FreshnessSchema
}).strict();
export type RuntimeSurface = z.infer<typeof RuntimeSurfaceSchema>;

export const RecentSessionSurfaceSchema = z.object({
  sessionId: NonEmptyString,
  title: NonEmptyString.optional(),
  state: z.enum(['unknown', 'idle', 'running', 'waiting', 'needs-user', 'error']),
  lastActivityAt: IsoDateTime.optional(),
  canOpen: z.boolean()
}).strict();
export type RecentSessionSurface = z.infer<typeof RecentSessionSurfaceSchema>;

export const QuotaMetricSchema = z.object({
  kind: z.enum(['balance', 'usage']),
  value: z.number().finite(),
  unit: z.enum(['CNY', 'percent', 'requests']),
  resetAt: IsoDateTime.optional()
}).strict();

export const QuotaSnapshotSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  providerId: NonEmptyString,
  state: z.enum(['ok', 'warn', 'critical', 'unavailable', 'stale']),
  observedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  metrics: z.array(QuotaMetricSchema),
  errorCode: z.enum([
    'NOT_CONFIGURED',
    'AUTH',
    'RATE_LIMITED',
    'TIMEOUT',
    'UPSTREAM',
    'SCHEMA'
  ]).optional()
}).strict();
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;

export const DiagnosticStatusSchema = z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']);
export type DiagnosticStatus = z.infer<typeof DiagnosticStatusSchema>;

export const DiagnosticItemSchema = z.object({
  id: NonEmptyString,
  status: DiagnosticStatusSchema,
  title: NonEmptyString,
  summary: NonEmptyString,
  observedAt: IsoDateTime,
  suggestedAction: NonEmptyString.optional()
}).strict();
export type DiagnosticItem = z.infer<typeof DiagnosticItemSchema>;

export const DiagnosticSummarySchema = z.object({
  generatedAt: IsoDateTime,
  items: z.array(DiagnosticItemSchema),
  counts: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  }).strict()
}).strict();
export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>;

export const SurfaceSnapshotSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  generatedAt: IsoDateTime,
  expiresAt: IsoDateTime.optional(),
  runtime: RuntimeSurfaceSchema,
  recentSessions: z.array(RecentSessionSurfaceSchema).max(5),
  quota: z.array(QuotaSnapshotSchema),
  diagnostics: DiagnosticSummarySchema,
  source: z.object({
    supervisorVersion: NonEmptyString,
    contractVersion: z.literal(ContractVersion),
    dshVersion: NonEmptyString.optional()
  }).strict()
}).strict();
export type SurfaceSnapshot = z.infer<typeof SurfaceSnapshotSchema>;

export const ControlHelloRequestSchema = z.object({
  protocolVersion: z.literal(ContractVersion),
  clientId: NonEmptyString,
  bootNonce: NonEmptyString,
  proof: NonEmptyString
}).strict();
export type ControlHelloRequest = z.infer<typeof ControlHelloRequestSchema>;

export const ControlHelloResponseSchema = z.object({
  protocolVersion: z.literal(ContractVersion),
  sessionId: NonEmptyString,
  supervisorInstanceId: NonEmptyString,
  expiresAt: IsoDateTime
}).strict();
export type ControlHelloResponse = z.infer<typeof ControlHelloResponseSchema>;

export const MutationRequestSchema = z.object({
  protocolVersion: z.literal(ContractVersion),
  sessionId: NonEmptyString,
  requestId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  action: ControlActionSchema,
  runtimeId: NonEmptyString,
  expectedProfileId: NonEmptyString.optional()
}).strict();
export type MutationRequest = z.infer<typeof MutationRequestSchema>;

export const UpdateCandidateSchema = z.object({
  repository: z.literal('deepseek-ai/deepseek-harness'),
  version: NonEmptyString,
  commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
  channel: z.enum(['stable', 'preview']),
  discoveredAt: IsoDateTime,
  source: z.enum(['github-release', 'git-tag']),
  verifiedOfficialSource: z.boolean()
}).strict();
export type UpdateCandidate = z.infer<typeof UpdateCandidateSchema>;

export const CompatibilityResultSchema = z.object({
  compatible: z.boolean(),
  required: z.object({
    runtimeFingerprint: z.boolean(),
    sessionList: z.boolean()
  }).strict(),
  optional: z.object({
    projection: z.boolean(),
    deepLink: z.boolean()
  }).strict(),
  reasons: z.array(NonEmptyString)
}).strict();
export type CompatibilityResult = z.infer<typeof CompatibilityResultSchema>;

export const RuntimeManifestSchema = z.object({
  dshVersion: NonEmptyString,
  sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/i),
  installedAt: IsoDateTime,
  entrypoint: NonEmptyString,
  artifactHash: z.string().regex(/^[0-9a-f]{64}$/i),
  source: z.literal('deepseek-ai/deepseek-harness')
}).strict();
export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

/**
 * Telemetry events — the realtime surface broadcast (SSE / EventBus).
 * The payload is redacted-safe by construction: no prompt/assistant/tool/
 * credential content may ever be placed here (security package enforces).
 */
export const TelemetryEventSchema = z.object({
  schemaVersion: z.literal(ContractVersion),
  type: z.enum([
    'state-changed',
    'diagnostic-alert',
    'quota-updated',
    'operation-event'
  ]),
  timestamp: IsoDateTime,
  runtimeId: NonEmptyString,
  seq: z.number().int().positive(),
  payload: z.record(z.unknown())
}).strict();
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

/** Update manifest with Ed25519 signature for supply-chain verification. */
export const UpdateManifestSchema = z.object({
  version: NonEmptyString,
  artifactUrl: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  signatureBase64: NonEmptyString
}).strict();
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

/**
 * Secure IPC protocol (protocol-first; Electron wiring lands in Checkpoint C).
 * Channels are an allow-list; every request/response is schema-validated.
 */
export const IpcChannelSchema = z.enum([
  'dsh:get-runtime-state',
  'dsh:get-snapshot',
  'dsh:lifecycle-action',
  'dsh:telemetry-subscribe'
]);
export type IpcChannel = z.infer<typeof IpcChannelSchema>;

export const LifecycleActionSchema = z.enum(['start', 'stop', 'restart']);
export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

export const IpcRequestSchema = z.object({
  channel: IpcChannelSchema,
  requestId: NonEmptyString,
  payload: z.unknown().optional()
}).strict();
export type IpcRequest = z.infer<typeof IpcRequestSchema>;

export const IpcResponseSchema = z.object({
  channel: IpcChannelSchema,
  requestId: NonEmptyString,
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: NonEmptyString.optional()
}).strict();
export type IpcResponse = z.infer<typeof IpcResponseSchema>;

export const LifecycleActionPayloadSchema = z.object({
  action: LifecycleActionSchema,
  runtimeId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  expectedProfileId: NonEmptyString.optional()
}).strict();
export type LifecycleActionPayload = z.infer<typeof LifecycleActionPayloadSchema>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseSurfaceSnapshot(value: unknown): SurfaceSnapshot {
  return SurfaceSnapshotSchema.parse(value);
}

export function parseLifecycleOperation(value: unknown): LifecycleOperation {
  return LifecycleOperationSchema.parse(value);
}

export function isMutationAction(action: ControlAction): boolean {
  return action === 'start' || action === 'stop' || action === 'restart' || action === 'update';
}
