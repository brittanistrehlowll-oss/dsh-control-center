import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LifecycleOperation } from '@dsh-control-center/control-contract';
import { OperationJournal } from './index.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function operation(status: LifecycleOperation['status'] = 'running'): LifecycleOperation {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    operationId: 'op-1',
    idempotencyKey: 'idem-1',
    action: 'restart',
    status,
    stage: status === 'running' ? 'starting' : undefined,
    recoveryMode: 'normal',
    runtimeId: 'runtime-1',
    requestedAt: now,
    updatedAt: now,
    ownership: 'legacy',
    lease: { holder: 'supervisor-1', acquiredAt: now },
    retryable: true
  };
}

describe('OperationJournal', () => {
  it('appends durable events and reconstructs an unfinished operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-journal-'));
    tempRoots.push(root);
    const journal = new OperationJournal(root);
    await journal.initialize();
    await journal.append({ event: 'created', operationId: 'op-1', payload: { operation: operation('accepted') } });
    await journal.append({ event: 'stage-changed', operationId: 'op-1', payload: { operation: operation('running') } });

    const reloaded = new OperationJournal(root);
    await reloaded.initialize();
    const unfinished = await reloaded.getUnfinishedOperations();

    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]?.operationId).toBe('op-1');
    expect(unfinished[0]?.stage).toBe('starting');
    expect((await readFile(join(root, 'operations.jsonl'), 'utf8')).trim().split(/\r?\n/)).toHaveLength(2);
  });

  it('does not treat a completed operation as unfinished', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-journal-'));
    tempRoots.push(root);
    const journal = new OperationJournal(root);
    await journal.initialize();
    await journal.append({ event: 'created', operationId: 'op-1', payload: { operation: operation('running') } });
    await journal.append({ event: 'completed', operationId: 'op-1', payload: { operation: operation('completed') } });

    expect(await journal.getUnfinishedOperations()).toEqual([]);
  });
});
