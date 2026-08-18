import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SurfaceSnapshotSchema,
  type SurfaceSnapshot
} from '@dsh-control-center/control-contract';
import { writeAtomicJson } from '@dsh-control-center/operation-journal';

export type SnapshotLoadSource = 'current' | 'last-good';

export interface LoadedSnapshot {
  snapshot: SurfaceSnapshot;
  source: SnapshotLoadSource;
}

export class SensitiveSurfaceDataError extends Error {
  constructor(path: string) {
    super('Sensitive field is not allowed in SurfaceSnapshot: ' + path);
    this.name = 'SensitiveSurfaceDataError';
  }
}

const forbiddenKey = /prompt|assistant|tool|cookie|authorization|api[-_ ]?key|secret|credential|shell|command|transcript|raw.?response|session.?log/i;

export function assertSafeSurfaceSnapshot(value: unknown): asserts value is SurfaceSnapshot {
  // Scan for forbidden keys FIRST, on the raw value, so a prompt-like field is
  // rejected with SensitiveSurfaceDataError regardless of schema strictness.
  walkForForbiddenKeys(value, '$');
  SurfaceSnapshotSchema.parse(value);
}

export class SnapshotStore {
  readonly currentPath: string;
  readonly lastGoodPath: string;

  constructor(readonly rootDir: string) {
    this.currentPath = join(rootDir, 'surface-snapshot.json');
    this.lastGoodPath = join(rootDir, 'surface-snapshot.last-good.json');
  }

  async save(snapshot: SurfaceSnapshot): Promise<void> {
    assertSafeSurfaceSnapshot(snapshot);
    const current = await this.readValid(this.currentPath);
    if (current) {
      await writeAtomicJson(this.lastGoodPath, current);
    }
    await writeAtomicJson(this.currentPath, snapshot);
  }

  async load(): Promise<LoadedSnapshot | undefined> {
    const current = await this.readValid(this.currentPath);
    if (current) return { snapshot: current, source: 'current' };
    const lastGood = await this.readValid(this.lastGoodPath);
    if (lastGood) return { snapshot: lastGood, source: 'last-good' };
    return undefined;
  }

  private async readValid(path: string): Promise<SurfaceSnapshot | undefined> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
      assertSafeSurfaceSnapshot(value);
      return value;
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError || error instanceof SensitiveSurfaceDataError) {
        return undefined;
      }
      return undefined;
    }
  }
}

function walkForForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForForbiddenKeys(item, path + '[' + index + ']'));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path + '.' + key;
    if (forbiddenKey.test(key)) throw new SensitiveSurfaceDataError(nextPath);
    walkForForbiddenKeys(child, nextPath);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === 'ENOENT';
}
