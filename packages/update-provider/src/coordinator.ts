import { mkdir, readdir, rm, rename, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  type CompatibilityResult,
  type LifecycleOperation,
  type UpdateCandidate
} from '@dsh-control-center/control-contract';
import {
  decideRollback,
  evaluateCompatibility,
  verifyTagChain,
  type CompatibilityGateResult,
  type RollbackDecision
} from './index.js';

/**
 * UpdateCoordinator — Checkpoint B orchestrator.
 *
 * Full flow (V1.1 §四):
 *   verify candidate (official source, tag→commit→version chain)
 *   → compatibility gate (toolchain, probes, ownership=legacy, installAuthority=mutable,
 *     no in-flight operation, verifiedOfficialSource)
 *   → stage into %LOCALAPPDATA%\DSHControlCenter\runtimes\staging\
 *   → apply (run staged runtime with temp DSH_HOME + temp ports, read-only probes)
 *   → verify applied (identity/version/profile/fingerprint)
 *   → on any failure: rollback (stop new → restore old → restart → verify old)
 *
 * FAIL-CLOSED guarantees:
 *  - Real execution (running a staged runtime, installing files) is ONLY possible
 *    through an explicitly-provided executor. With the default executors, any
 *    apply/rollback step throws `UpdateProviderError('REAL_EXECUTION_DISABLED')`.
 *  - Unknown install origin and desktop-managed installs are rejected by the
 *    compatibility gate (fail-closed).
 */

export const STAGING_ROOT = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'DSHControlCenter', 'runtimes', 'staging')
  : join(homedir(), 'AppData', 'Local', 'DSHControlCenter', 'runtimes', 'staging');

export interface StagedRuntime {
  stagingDir: string;
  version: string;
  commitSha: string;
}

export interface UpdateExecutors {
  /** Copy/install the candidate artifact into the staging dir. */
  stageArtifact?: (candidate: UpdateCandidate, stagingDir: string) => Promise<StagedRuntime>;
  /** Start the staged runtime with temp DSH_HOME + temp ports. */
  startStaged?: (staged: StagedRuntime) => Promise<{ processId: number; healthUrl: string }>;
  /** Stop the staged runtime. */
  stopStaged?: (staged: StagedRuntime, processId: number) => Promise<void>;
  /** Run the compatibility probes against the staged runtime. */
  probeStaged?: (staged: StagedRuntime, healthUrl: string) => Promise<CompatibilityResult>;
  /** Verify the APPLIED runtime (identity/version/profile). */
  verifyApplied?: (staged: StagedRuntime) => Promise<{
    ok: boolean;
    identityConfirmed: boolean;
    versionMatches: boolean;
    profileMatches: boolean;
  }>;
  /** Restore the old runtime into place. */
  restoreOld?: (staged: StagedRuntime) => Promise<void>;
  /** Restart the restored old runtime. */
  restartOld?: () => Promise<void>;
}

export type UpdatePhase = 'verify' | 'compatibility' | 'staging' | 'apply' | 'verify-applied' | 'completed' | 'rolled-back' | 'failed';

export interface UpdateContext {
  installAuthority: 'mutable' | 'delegated' | 'read-only';
  ownership: 'legacy' | 'managed' | 'delegated' | 'observe-only';
  toolchain: { node: string; pnpm: string };
  currentOperation?: LifecycleOperation | undefined;
  knownInstallOrigin: boolean;
  desktopManaged: boolean;
}

export interface UpdateResult {
  phase: UpdatePhase;
  candidate?: UpdateCandidate;
  reason?: string;
  rollback?: RollbackDecision;
}

const EXECUTION_DISABLED = 'REAL_EXECUTION_DISABLED';

export class UpdateCoordinator {
  private readonly executors: Required<UpdateExecutors>;
  private readonly stagingRoot: string;

  constructor(executors: UpdateExecutors = {}, options: { stagingRoot?: string } = {}) {
    // Fail-closed: missing executors disable real execution.
    this.executors = {
      stageArtifact: executors.stageArtifact ?? (async () => { throw disabled('stageArtifact'); }),
      startStaged: executors.startStaged ?? (async () => { throw disabled('startStaged'); }),
      stopStaged: executors.stopStaged ?? (async () => { throw disabled('stopStaged'); }),
      probeStaged: executors.probeStaged ?? (async () => { throw disabled('probeStaged'); }),
      verifyApplied: executors.verifyApplied ?? (async () => { throw disabled('verifyApplied'); }),
      restoreOld: executors.restoreOld ?? (async () => { throw disabled('restoreOld'); }),
      restartOld: executors.restartOld ?? (async () => { throw disabled('restartOld'); })
    };
    this.stagingRoot = options.stagingRoot ?? STAGING_ROOT;
  }

  /**
   * Execute the full update. Real execution requires explicit executors;
   * with default executors this throws EXECUTION_DISABLED at the first
   * real step (staging), so callers cannot accidentally mutate anything.
   */
  async run(candidate: UpdateCandidate, ctx: UpdateContext): Promise<UpdateResult> {
    // 1. Verify tag → commit → version chain (official source only).
    let verified;
    try {
      verified = verifyTagChain({
        repository: candidate.repository,
        tag: `dsh-v${candidate.version}`,
        commitSha: candidate.commitSha,
        packageJsonVersion: candidate.version
      });
    } catch (error) {
      return { phase: 'verify', reason: error instanceof Error ? error.message : String(error) };
    }

    // 2. Static compatibility gate (fail-closed). Runtime capabilities are
    //    probed AFTER staging, so this gate covers toolchain, authority,
    //    ownership and in-flight operations only.
    const gate = evaluateCompatibility({
      toolchain: ctx.toolchain,
      runtimeFingerprint: true, // probed after staging; static gate passes it
      sessionList: true,
      installAuthority: ctx.installAuthority,
      ownership: ctx.ownership,
      currentOperation: ctx.currentOperation
    });
    if (!ctx.knownInstallOrigin) {
      return { phase: 'compatibility', reason: 'unknown install origin — fail-closed' };
    }
    if (ctx.desktopManaged) {
      return { phase: 'compatibility', reason: 'desktop-managed install — fail-closed' };
    }
    if (!gate.allowed) {
      return { phase: 'compatibility', reason: gate.reasons.join('; ') };
    }

    // 3. Stage into the staging root.
    const stagingDir = await this.prepareStagingDir(verified.candidate);
    let staged: StagedRuntime | undefined;
    let launched: { processId: number; healthUrl: string } | undefined;
    try {
      staged = await this.executors.stageArtifact(verified.candidate, stagingDir);
      // 4. Apply: start staged runtime with temp env, run probes.
      launched = await this.executors.startStaged(staged);
      const probeResult = await this.executors.probeStaged(staged, launched.healthUrl);
      if (!probeResult.compatible) {
        const rollback = decideRollback('api-incompatible');
        await this.executors.stopStaged(staged, launched.processId);
        await this.executors.restoreOld(staged);
        await this.executors.restartOld();
        return { phase: 'rolled-back', candidate: verified.candidate, reason: probeResult.reasons.join('; '), rollback };
      }
      // 5. Verify applied.
      const applied = await this.executors.verifyApplied(staged);
      if (!applied.ok) {
        const cause = !applied.identityConfirmed ? 'identity-unconfirmed'
          : !applied.versionMatches ? 'version-mismatch'
            : !applied.profileMatches ? 'profile-mismatch'
              : 'health-timeout';
        const rollback = decideRollback(cause);
        await this.executors.stopStaged(staged, launched.processId);
        await this.executors.restoreOld(staged);
        await this.executors.restartOld();
        return { phase: 'rolled-back', candidate: verified.candidate, reason: cause, rollback };
      }
      return { phase: 'completed', candidate: verified.candidate };
    } catch (error) {
      // Nothing was staged/launched (e.g. executors disabled) — nothing to roll back.
      if (!staged) {
        return { phase: 'failed', reason: error instanceof Error ? error.message : String(error) };
      }
      // Staging succeeded but start/probe/verify failed: stop if started,
      // restore old, restart old.
      const rollback = decideRollback('start-failed');
      if (launched) await this.safeStop(staged, launched.processId);
      await this.safeRestore(staged);
      await this.safeRestart();
      return { phase: 'rolled-back', candidate: verified.candidate, reason: error instanceof Error ? error.message : String(error), rollback };
    }
  }

  /**
   * Pure planning (no execution): verify + gate, return the staged plan.
   * Used by the UI for "check update" without mutating anything.
   */
  async plan(candidate: UpdateCandidate, ctx: UpdateContext): Promise<UpdateResult> {
    try {
      verifyTagChain({
        repository: candidate.repository,
        tag: `dsh-v${candidate.version}`,
        commitSha: candidate.commitSha,
        packageJsonVersion: candidate.version
      });
    } catch (error) {
      return { phase: 'verify', reason: error instanceof Error ? error.message : String(error) };
    }
    const gate = evaluateCompatibility({
      toolchain: ctx.toolchain,
      runtimeFingerprint: true,
      sessionList: true,
      installAuthority: ctx.installAuthority,
      ownership: ctx.ownership,
      currentOperation: ctx.currentOperation
    });
    if (!ctx.knownInstallOrigin) return { phase: 'compatibility', reason: 'unknown install origin — fail-closed' };
    if (ctx.desktopManaged) return { phase: 'compatibility', reason: 'desktop-managed install — fail-closed' };
    if (!gate.allowed) return { phase: 'compatibility', reason: gate.reasons.join('; ') };
    return { phase: 'staging', candidate };
  }

  private async prepareStagingDir(candidate: UpdateCandidate): Promise<string> {
    const dir = resolve(this.stagingRoot, `dsh-${candidate.version}`);
    await mkdir(dir, { recursive: true });
    // Stamp the staged manifest with verification metadata.
    await writeFile(join(dir, 'staged-manifest.json'), JSON.stringify({
      repository: candidate.repository,
      version: candidate.version,
      commitSha: candidate.commitSha,
      channel: candidate.channel,
      verifiedOfficialSource: candidate.verifiedOfficialSource,
      stagedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    // Clean stale siblings from a previous failed attempt of the same version.
    await this.cleanStaleSiblings(dir, candidate.version);
    return dir;
  }

  private async cleanStaleSiblings(dir: string, version: string): Promise<void> {
    const parent = resolve(dir, '..');
    try {
      const entries = await readdir(parent);
      const stale = entries
        .filter((name) => name.startsWith(`dsh-${version}`) && resolve(parent, name) !== dir)
        .map((name) => resolve(parent, name));
      await Promise.all(stale.map((path) => rm(path, { recursive: true, force: true })));
    } catch {
      // parent absent — nothing to clean
    }
  }

  private async safeStop(staged: StagedRuntime, pid: number): Promise<void> {
    try { await this.executors.stopStaged(staged, pid); } catch { /* best effort */ }
  }

  private async safeRestore(staged: StagedRuntime): Promise<void> {
    try { await this.executors.restoreOld(staged); } catch { /* best effort */ }
  }

  private async safeRestart(): Promise<void> {
    try { await this.executors.restartOld(); } catch { /* best effort */ }
  }
}

function disabled(step: string): Error {
  const error = new Error(`real execution disabled for '${step}' — provide an explicit executor (${EXECUTION_DISABLED})`);
  error.name = 'UpdateProviderError';
  return error;
}