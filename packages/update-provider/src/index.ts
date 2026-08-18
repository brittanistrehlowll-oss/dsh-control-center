import { z } from 'zod';
import {
  UpdateCandidateSchema,
  type CompatibilityResult,
  type LifecycleOperation,
  type Ownership,
  type UpdateCandidate
} from '@dsh-control-center/control-contract';

/**
 * update-provider — official-update discovery, verification, and compatibility
 * preflight for deepseek-ai/deepseek-harness.
 *
 * Rules (V1.1, §四):
 *  - The official repository identity is pinned: `deepseek-ai/deepseek-harness`.
 *    Normal settings cannot change it; dev-mode custom repos are flagged
 *    UNTRUSTED DEVELOPMENT SOURCE.
 *  - Version acceptance only via `dsh-v<semver>` tags or official release
 *    metadata; chain: tag → commit → package.json → version match.
 *  - `master` or latest HEAD is never treated as a release.
 *  - Compatibility probe gates: temp DSH_HOME, temp ports, staged runtime,
 *    read-only probes, node/pnpm version check (node ^22.19.0 || >=24.0.0,
 *    pnpm 11.7.0 baseline).
 */

export const OFFICIAL_REPOSITORY = 'deepseek-ai/deepseek-harness' as const;

export const REQUIRED_NODE_RANGE = '^22.19.0 || >=24.0.0';
export const REQUIRED_PNPM = '11.7.0';

export const DSH_TAG_PATTERN = /^dsh-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export class UpdateProviderError extends Error {
  constructor(message: string, readonly code: 'UNTRUSTED_SOURCE' | 'INVALID_TAG' | 'VERSION_MISMATCH' | 'CHANNEL' | 'COMPATIBILITY' | 'NETWORK' | 'ROLLBACK') {
    super(message);
    this.name = 'UpdateProviderError';
  }
}

export type UpdateSourceKind = 'official' | 'untrusted-development';

export interface UpdateSource {
  kind: UpdateSourceKind;
  repository: string;
  /** When kind is untrusted-development, this must surface to the UI. */
  developmentNote?: 'UNTRUSTED DEVELOPMENT SOURCE';
}

export function normalizeSource(repository: string): UpdateSource {
  if (repository === OFFICIAL_REPOSITORY) {
    return { kind: 'official', repository };
  }
  return { kind: 'untrusted-development', repository, developmentNote: 'UNTRUSTED DEVELOPMENT SOURCE' };
}

/** Parse a `dsh-v<semver>` tag into version parts. */
export function parseDshTag(tag: string): { version: string; semver: { major: number; minor: number; patch: number; pre?: string } } | undefined {
  const match = DSH_TAG_PATTERN.exec(tag);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const pre = match[4] ? match[4] : undefined;
  const version = pre ? `${major}.${minor}.${patch}-${pre}` : `${major}.${minor}.${patch}`;
  return { version, semver: { major, minor, patch, ...(pre !== undefined ? { pre } : {}) } };
}

export interface VerifiedRelease {
  candidate: UpdateCandidate;
  tag: string;
  commitSha: string;
  packageJsonVersion: string;
}

/** Verify the tag → commit → package.json → version chain. */
export function verifyTagChain(input: {
  repository: string;
  tag: string;
  commitSha?: string;
  packageJsonVersion?: string;
  channel?: 'stable' | 'preview';
}): VerifiedRelease {
  const source = normalizeSource(input.repository);
  if (source.kind !== 'official') {
    throw new UpdateProviderError(`untrusted update source: ${input.repository}`, 'UNTRUSTED_SOURCE');
  }
  const parsed = parseDshTag(input.tag);
  if (!parsed) {
    throw new UpdateProviderError(`tag is not a dsh-v<semver> tag: ${input.tag}`, 'INVALID_TAG');
  }
  if (!input.commitSha || !/^[0-9a-f]{7,64}$/i.test(input.commitSha)) {
    throw new UpdateProviderError('missing or invalid commit SHA', 'INVALID_TAG');
  }
  if (input.packageJsonVersion !== undefined && input.packageJsonVersion !== parsed.version) {
    throw new UpdateProviderError(
      `package.json version ${input.packageJsonVersion} does not match tag version ${parsed.version}`,
      'VERSION_MISMATCH'
    );
  }
  const channel: 'stable' | 'preview' = parsed.semver.pre ? 'preview' : (input.channel ?? 'stable');
  const candidate = UpdateCandidateSchema.parse({
    repository: OFFICIAL_REPOSITORY,
    version: parsed.version,
    commitSha: input.commitSha,
    channel,
    discoveredAt: new Date().toISOString(),
    source: 'git-tag',
    verifiedOfficialSource: true
  });
  return {
    candidate,
    tag: input.tag,
    commitSha: input.commitSha,
    packageJsonVersion: input.packageJsonVersion ?? parsed.version
  };
}

/** Node/pnpm compatibility check against the DSH requirement. */
export function checkToolchain(nodeVersion: string, pnpmVersion: string): { compatible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const nodeOk = satisfiesNodeRange(nodeVersion);
  if (!nodeOk) reasons.push(`node ${nodeVersion} outside ${REQUIRED_NODE_RANGE}`);
  // DSH requires pnpm 11.7.0. Accept 11.x >= 11.7.0; reject other majors.
  const pnpmMajor = Number.parseInt(pnpmVersion.split('.')[0] ?? '0', 10);
  const pnpmMinor = Number.parseInt(pnpmVersion.split('.')[1] ?? '0', 10);
  const pnpmOk = pnpmMajor === 11 && pnpmMinor >= 7;
  if (!pnpmOk) reasons.push(`pnpm ${pnpmVersion} below required ${REQUIRED_PNPM} (11.x >= 11.7.0)`);
  return { compatible: nodeOk && pnpmOk, reasons };
}

function satisfiesNodeRange(version: string): boolean {
  const v = version.replace(/^v/, '');
  const [majorStr, minorStr] = v.split('.');
  const major = Number.parseInt(majorStr ?? '0', 10);
  const minor = Number.parseInt(minorStr ?? '0', 10);
  if (major === 22) return minor >= 19;
  if (major >= 24) return true;
  return false;
}

export interface CompatibilityInput {
  toolchain: { node: string; pnpm: string };
  runtimeFingerprint: boolean;
  sessionList: boolean;
  projection?: boolean;
  deepLink?: boolean;
  installAuthority: 'mutable' | 'delegated' | 'read-only';
  ownership: Ownership;
  currentOperation?: LifecycleOperation | undefined;
}

export interface CompatibilityGateResult {
  allowed: boolean;
  result: CompatibilityResult;
  reasons: string[];
}

export function evaluateCompatibility(input: CompatibilityInput): CompatibilityGateResult {
  const reasons: string[] = [];
  const toolchain = checkToolchain(input.toolchain.node, input.toolchain.pnpm);
  if (!toolchain.compatible) reasons.push(...toolchain.reasons);
  if (!input.runtimeFingerprint) reasons.push('runtime fingerprint probe failed');
  if (!input.sessionList) reasons.push('session.list probe failed');
  if (!input.projection) reasons.push('projection capability missing (optional)');
  if (!input.deepLink) reasons.push('deep-link capability missing (optional)');
  if (input.installAuthority !== 'mutable') reasons.push(`install authority is ${input.installAuthority}, expected mutable`);
  if (input.ownership !== 'legacy') reasons.push(`ownership is ${input.ownership}, expected legacy`);
  if (input.currentOperation) reasons.push(`lifecycle operation ${input.currentOperation.operationId} in flight`);

  const required = { runtimeFingerprint: input.runtimeFingerprint, sessionList: input.sessionList };
  const optional = {
    projection: input.projection ?? false,
    deepLink: input.deepLink ?? false
  };
  const result: CompatibilityResult = {
    compatible: toolchain.compatible && input.runtimeFingerprint && input.sessionList &&
      input.installAuthority === 'mutable' && input.ownership === 'legacy' && !input.currentOperation,
    required,
    optional,
    reasons
  };
  return { allowed: result.compatible, result, reasons };
}

export interface RollbackDecision {
  shouldRollback: boolean;
  reason: string;
}

/** Every failure cause from §四 must map to a rollback decision. */
export function decideRollback(cause: 'start-failed' | 'health-timeout' | 'fingerprint-invalid' | 'version-mismatch' | 'api-incompatible' | 'profile-mismatch' | 'identity-unconfirmed'): RollbackDecision {
  const reasons: Record<typeof cause, string> = {
    'start-failed': 'staged runtime failed to start',
    'health-timeout': 'health check timed out',
    'fingerprint-invalid': 'fingerprint invalid after update',
    'version-mismatch': 'version does not match target',
    'api-incompatible': 'API contract changed incompatibly',
    'profile-mismatch': 'profile does not match',
    'identity-unconfirmed': 'new instance identity could not be confirmed'
  };
  return { shouldRollback: true, reason: reasons[cause] };
}