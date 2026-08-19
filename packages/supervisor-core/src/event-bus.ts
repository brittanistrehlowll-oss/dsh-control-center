import {
  TelemetryEventSchema,
  type TelemetryEvent
} from '@dsh-control-center/control-contract';

/**
 * EventBus — typed, non-singleton telemetry bus.
 *
 * Replaces the review draft's singleton EventEmitter:
 *  - No global state: the supervisor owns an instance and passes it to
 *    components; tests create their own.
 *  - Bounded history per runtimeId (ring buffer) so a late SSE subscriber
 *    receives recent events on connect.
 *  - Every publish is schema-validated (contract-first).
 *  - Subscription returns an unsubscribe function; listeners are tracked for
 *    diagnostics.
 */

export interface EventBusOptions {
  /** Max events kept in history per runtimeId. Default 100. */
  historyLimit?: number;
  now?: () => string;
}

export type TelemetryListener = (event: TelemetryEvent) => void;

export class EventBus {
  private readonly historyLimit: number;
  private readonly now: () => string;
  private readonly historyByRuntime = new Map<string, TelemetryEvent[]>();
  private readonly listeners = new Map<string, Set<TelemetryListener>>();
  private seq = 0;

  constructor(options: EventBusOptions = {}) {
    this.historyLimit = options.historyLimit ?? 100;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Publish a telemetry event; schema-validated, history-bounded. */
  publish(input: {
    type: TelemetryEvent['type'];
    runtimeId: string;
    payload: Record<string, unknown>;
  }): TelemetryEvent {
    const event = TelemetryEventSchema.parse({
      schemaVersion: 1,
      type: input.type,
      timestamp: this.now(),
      runtimeId: input.runtimeId,
      seq: ++this.seq,
      payload: input.payload
    });

    const history = this.historyByRuntime.get(event.runtimeId) ?? [];
    history.push(event);
    if (history.length > this.historyLimit) history.splice(0, history.length - this.historyLimit);
    this.historyByRuntime.set(event.runtimeId, history);

    const wildcard = this.listeners.get('*');
    if (wildcard) for (const listener of wildcard) listener(event);
    const specific = this.listeners.get(event.runtimeId);
    if (specific) for (const listener of [...specific]) listener(event);

    return event;
  }

  /** Subscribe; `runtimeId: '*'` receives everything. Returns unsubscribe. */
  subscribe(runtimeId: string, listener: TelemetryListener): () => void {
    const set = this.listeners.get(runtimeId) ?? new Set<TelemetryListener>();
    set.add(listener);
    this.listeners.set(runtimeId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runtimeId);
    };
  }

  /** Recent events for a runtime (bounded by historyLimit). */
  history(runtimeId: string): TelemetryEvent[] {
    return [...(this.historyByRuntime.get(runtimeId) ?? [])];
  }

  /** All history across runtimes, newest last. */
  allHistory(): TelemetryEvent[] {
    const out: TelemetryEvent[] = [];
    for (const events of this.historyByRuntime.values()) out.push(...events);
    return out;
  }

  stats(): { seq: number; listeners: number; history: number } {
    let listeners = 0;
    for (const set of this.listeners.values()) listeners += set.size;
    let history = 0;
    for (const events of this.historyByRuntime.values()) history += events.length;
    return { seq: this.seq, listeners, history };
  }
}