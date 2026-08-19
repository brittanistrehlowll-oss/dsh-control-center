import { describe, expect, it } from 'vitest';
import { EventBus } from './event-bus.js';

function makeClock(start = '2026-08-18T00:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t).toISOString(),
    advanceMs: (ms: number) => { t += ms; }
  };
}

describe('EventBus', () => {
  it('publishes schema-validated events with monotonic seq', () => {
    const bus = new EventBus();
    const e1 = bus.publish({ type: 'state-changed', runtimeId: 'r1', payload: { state: 'running' } });
    const e2 = bus.publish({ type: 'quota-updated', runtimeId: 'r1', payload: { state: 'ok' } });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.timestamp).toBeTruthy();
  });

  it('rejects non-contract events at publish time', () => {
    const bus = new EventBus();
    expect(() => bus.publish({ type: 'bogus' as never, runtimeId: 'r1', payload: {} })).toThrow();
  });

  it('delivers to specific and wildcard subscribers and unsubscribes', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const unsubR1 = bus.subscribe('r1', (e) => seen.push(`r1:${e.seq}`));
    bus.subscribe('*', (e) => seen.push(`*:${e.seq}`));
    bus.publish({ type: 'state-changed', runtimeId: 'r1', payload: {} });
    bus.publish({ type: 'state-changed', runtimeId: 'r2', payload: {} });
    // both r1-specific and wildcard receive seq 1; only wildcard receives seq 2
    expect(seen).toContain('r1:1');
    expect(seen).toContain('*:1');
    expect(seen).toContain('*:2');
    expect(seen).not.toContain('r1:2');
    unsubR1();
    bus.publish({ type: 'state-changed', runtimeId: 'r1', payload: {} });
    expect(seen).toContain('*:3');
    expect(seen).not.toContain('r1:3');
  });

  it('keeps bounded history per runtime and replays it', () => {
    const bus = new EventBus({ historyLimit: 3 });
    for (let i = 0; i < 5; i++) {
      bus.publish({ type: 'operation-event', runtimeId: 'r1', payload: { i } });
    }
    const history = bus.history('r1');
    expect(history).toHaveLength(3);
    expect(history[0]?.payload.i).toBe(2);
    expect(bus.history('nope')).toEqual([]);
    expect(bus.stats().history).toBe(3);
  });
});