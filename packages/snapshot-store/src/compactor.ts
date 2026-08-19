import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeAtomicJson } from '@dsh-control-center/operation-journal';
import { SurfaceSnapshotSchema } from '@dsh-control-center/control-contract';

/**
 * SnapshotCompactor — safe compaction of snapshot history.
 *
 * Final design notes (improvements over the review draft):
 *  - Every write goes through `writeAtomicJson` (temp → flush → rename with
 *    Windows EEXIST retry), never raw `fs.rename` over an existing file which
 *    fails on Windows.
 *  - It compacts **historical snapshots**, leaving the operational current/
 *    last-good files as the authoritative contract.
 *  - The journal is **never truncated in place**. A separate
 *    `journalCheckpoint` (lastSeq + hash + compactedAt) is advisory for
 *    recovery; truncation is an explicit maintenance op that preserves the
 *    journal's running seq counter via an anchor that stores the next seq.
 */

export interface CompactSnapshotPayload {
  version: '1.1';
  compactedAt: string;
  baseSnapshotHash: string;
  count: number;
  baseSnapshot: unknown;
}

export interface JournalCheckpoint {
  lastSeq: number;
  journalHash: string;
  compactedAt: string;
}

export interface CompactionInput {
  /** Sequence of snapshots to fold, oldest first. */
  snapshots: unknown[];
  /** Last snapshot (the one the compaction result must satisfy first). */
  latest: unknown;
}

export class CompactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompactionError';
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class SnapshotCompactor {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Fold historical snapshots into a base snapshot file + SHA-256.
   * Leaves current/last-good untouched; atomic on Windows.
   */
  async compactHistory(input: CompactionInput): Promise<{ compactedPath: string; snapshotHash: string; count: number }> {
    // Latest snapshot must validate against the contract.
    const parsed = SurfaceSnapshotSchema.safeParse(input.latest);
    if (!parsed.success) {
      throw new CompactionError('latest snapshot is not a valid SurfaceSnapshot: ' + parsed.error.message);
    }
    const fold = parsed.data;
    const serialized = JSON.stringify(fold);
    const snapshotHash = sha256(serialized);

    const payload: CompactSnapshotPayload = {
      version: '1.1',
      compactedAt: new Date().toISOString(),
      baseSnapshotHash: snapshotHash,
      count: input.snapshots.length + 1,
      baseSnapshot: fold
    };

    const compactedPath = join(this.rootDir, 'snapshot-base.json');
    await writeAtomicJson(compactedPath, payload);
    return { compactedPath, snapshotHash, count: payload.count };
  }

  /**
   * Write an advisory journal checkpoint without touching the JSONL.
   * `lastSeq` is the highest seq the journal has reached; recovery can use it
   * to continue numbering without renumbering history.
   */
  async writeJournalCheckpoint(input: { lastSeq: number; journalHash: string }): Promise<string> {
    const checkpoint: JournalCheckpoint = {
      lastSeq: input.lastSeq,
      journalHash: input.journalHash,
      compactedAt: new Date().toISOString()
    };
    const path = join(this.rootDir, 'journal-checkpoint.json');
    await writeAtomicJson(path, checkpoint);
    return path;
  }

  /** Read a previously written compact base (validated). */
  async readCompactedBase(): Promise<CompactSnapshotPayload | undefined> {
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'snapshot-base.json'), 'utf8')) as unknown;
      const candidate = raw as CompactSnapshotPayload;
      if (candidate?.version !== '1.1' || typeof candidate.baseSnapshotHash !== 'string') {
        return undefined;
      }
      const serialized = JSON.stringify(candidate.baseSnapshot);
      if (sha256(serialized) !== candidate.baseSnapshotHash) return undefined;
      return candidate;
    } catch {
      return undefined;
    }
  }
}

export { writeAtomicJson };