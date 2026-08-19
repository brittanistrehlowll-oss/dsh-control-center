import type { ServerResponse } from 'node:http';
import type { EventBus } from '@dsh-control-center/supervisor-core';

/**
 * SSE endpoint handler for the supervisor's lightweight HTTP surface.
 *
 * Wire protocol (contract-first):
 *   GET /events -> text/event-stream
 *     :connected <ts>            (comment)
 *     data: <TelemetryEvent>     (history replay, then live)
 *     :heartbeat <ts>            (every 15 s)
 *
 * Typed: no `any`. Cleanup on `close`; per-connection AbortController.
 */

export const SSE_HEARTBEAT_MS = 15_000;

export interface SseConnection {
  res: ServerResponse;
  eventBus: EventBus;
  /** Optional filter: only events for this runtimeId (default '*' = all). */
  runtimeId?: string;
  heartbeatMs?: number;
}

export function handleSseConnection(options: SseConnection): () => void {
  const { res, eventBus, runtimeId, heartbeatMs = SSE_HEARTBEAT_MS } = options;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(`:connected ${new Date().toISOString()}\n\n`);

  // Replay bounded history for the requested runtime so late subscribers
  // see recent state immediately.
  const replay = runtimeId ? eventBus.history(runtimeId) : eventBus.allHistory();
  for (const event of replay) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const send = (event: Parameters<Parameters<EventBus['subscribe']>[1]>[0]) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = eventBus.subscribe(runtimeId ?? '*', send);

  const heartbeat = setInterval(() => {
    res.write(`:heartbeat ${new Date().toISOString()}\n\n`);
  }, heartbeatMs);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}