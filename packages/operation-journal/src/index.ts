import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  LifecycleOperationSchema,
  OperationJournalEventSchema,
  type LifecycleOperation,
  type OperationJournalEvent
} from '@dsh-control-center/control-contract';

export type JournalEventName = OperationJournalEvent['event'];

export interface AppendJournalEventInput {
  event: JournalEventName;
  operationId: string;
  payload: unknown;
  ts?: string;
}

export interface OperationJournalOptions {
  now?: () => string;
  fsyncEvents?: boolean;
}

export class JournalCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalCorruptError';
  }
}

const terminalStatuses = new Set<LifecycleOperation['status']>([
  'completed',
  'failed',
  'timeout',
  'cancelled'
]);

export async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  const handle = await open(tempPath, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      await rm(tempPath, { force: true });
      throw error;
    }
    await rm(filePath, { force: true });
    await rename(tempPath, filePath);
  }
}

export async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ((error as { code?: string }).code === 'EEXIST' || (error as { code?: string }).code === 'EPERM');
}

function operationFromPayload(payload: unknown): LifecycleOperation | undefined {
  const candidate = typeof payload === 'object' && payload !== null && 'operation' in payload
    ? (payload as { operation: unknown }).operation
    : payload;
  const parsed = LifecycleOperationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export class OperationJournal {
  readonly filePath: string;
  readonly currentPath: string;
  private seq = 0;
  private initialized = false;
  private readonly now: () => string;
  private readonly fsyncEvents: boolean;

  constructor(readonly rootDir: string, options: OperationJournalOptions = {}) {
    this.filePath = join(rootDir, 'operations.jsonl');
    this.currentPath = join(rootDir, 'current-operation.json');
    this.now = options.now ?? (() => new Date().toISOString());
    this.fsyncEvents = options.fsyncEvents ?? true;
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const events = await this.readEvents();
    this.seq = events.at(-1)?.seq ?? 0;
    this.initialized = true;
  }

  async append(input: AppendJournalEventInput): Promise<OperationJournalEvent> {
    this.assertInitialized();
    const event: OperationJournalEvent = {
      schemaVersion: 1,
      seq: ++this.seq,
      ts: input.ts ?? this.now(),
      operationId: input.operationId,
      event: input.event,
      payload: input.payload
    };
    const parsed = OperationJournalEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new JournalCorruptError('Refusing invalid journal event: ' + parsed.error.message);
    }

    const handle = await open(this.filePath, 'a');
    try {
      await handle.writeFile(JSON.stringify(parsed.data) + '\n', 'utf8');
      if (this.fsyncEvents && this.isCriticalEvent(input.event)) {
        await handle.sync();
      }
    } finally {
      await handle.close();
    }
    return parsed.data;
  }

  async readEvents(): Promise<OperationJournalEvent[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const events: OperationJournalEvent[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(trimmed) as unknown;
      } catch {
        throw new JournalCorruptError('Invalid JSON at journal line ' + (index + 1));
      }
      const parsed = OperationJournalEventSchema.safeParse(raw);
      if (!parsed.success) {
        throw new JournalCorruptError('Invalid journal event at line ' + (index + 1) + ': ' + parsed.error.message);
      }
      events.push(parsed.data);
    }
    return events;
  }

  async getOperationStates(): Promise<Map<string, LifecycleOperation>> {
    const states = new Map<string, LifecycleOperation>();
    for (const event of await this.readEvents()) {
      const operation = operationFromPayload(event.payload);
      if (operation) states.set(event.operationId, operation);
    }
    return states;
  }

  async getUnfinishedOperations(): Promise<LifecycleOperation[]> {
    const states = await this.getOperationStates();
    return [...states.values()].filter((operation) => !terminalStatuses.has(operation.status));
  }

  async persistCurrentOperation(operation: LifecycleOperation | undefined): Promise<void> {
    this.assertInitialized();
    if (operation) {
      await writeAtomicJson(this.currentPath, LifecycleOperationSchema.parse(operation));
    } else {
      await removeIfExists(this.currentPath);
    }
  }

  async readCurrentOperation(): Promise<LifecycleOperation | undefined> {
    try {
      const raw = JSON.parse(await readFile(this.currentPath, 'utf8')) as unknown;
      const parsed = LifecycleOperationSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if (isMissingFileError(error) || isJsonSyntaxError(error)) return undefined;
      throw error;
    }
  }

  async reconcileDerivedState(): Promise<LifecycleOperation[]> {
    const unfinished = await this.getUnfinishedOperations();
    await this.persistCurrentOperation(unfinished.at(-1));
    return unfinished;
  }

  private isCriticalEvent(event: JournalEventName): boolean {
    return event === 'created' || event === 'stage-changed' || event === 'completed' || event === 'failed' || event === 'cancelled';
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('OperationJournal.initialize() must be called first');
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === 'ENOENT';
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}
