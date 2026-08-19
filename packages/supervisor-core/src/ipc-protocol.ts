import {
  IpcChannelSchema,
  IpcRequestSchema,
  IpcResponseSchema,
  LifecycleActionPayloadSchema,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse
} from '@dsh-control-center/control-contract';

/**
 * IpcProtocol — pure validation & authorization layer for the secure IPC
 * boundary (protocol-first; Electron main/preload wiring is a thin adapter
 * over this and lands with Checkpoint C).
 *
 * Responsibilities:
 *  - Channel allow-list enforcement (channels NOT in the schema are refused).
 *  - Request/response schema validation (known channel + requestId).
 *  - Lifecycle payload validation (action enum + runtimeId + idempotencyKey).
 *  - Mutation policy hook: a caller-supplied guard decides whether a lifecycle
 *    action may be dispatched right now (single lease / idempotency / gate).
 *
 * No electron import, no process control — this is pure state reasoning.
 */

export type MutationGuard = (input: {
  action: 'start' | 'stop' | 'restart';
  runtimeId: string;
  idempotencyKey: string;
}) => Promise<{ allowed: boolean; reason?: string }> | { allowed: boolean; reason?: string };

export interface IpcHandlers {
  getRuntimeState?: (runtimeId: string) => unknown | Promise<unknown>;
  getSnapshot?: () => unknown | Promise<unknown>;
  lifecycleAction?: MutationGuard;
  telemetrySubscribe?: (runtimeId: string) => boolean;
}

export class IpcProtocol {
  constructor(private readonly handlers: IpcHandlers = {}) {}

  private static channels(): IpcChannel[] {
    return ['dsh:get-runtime-state', 'dsh:get-snapshot', 'dsh:lifecycle-action', 'dsh:telemetry-subscribe'];
  }

  /** True when the channel is on the allow-list. */
  isChannelAllowed(channel: unknown): channel is IpcChannel {
    return IpcChannelSchema.safeParse(channel).success;
  }

  /** Validate an inbound request; returns a typed reply on failure. */
  validateRequest(value: unknown): { ok: true; request: IpcRequest } | { ok: false; response: IpcResponse } {
    const parsed = IpcRequestSchema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, response: this.e('dsh:get-snapshot', 'unknown-channel', 'invalid request schema') };
    }
    return { ok: true, request: parsed.data };
  }

  /** Dispatch a validated request through the registered handler. */
  async dispatch(request: IpcRequest): Promise<IpcResponse> {
    const { channel, requestId, payload } = request;

    switch (channel) {
      case 'dsh:get-runtime-state': {
        if (!this.handlers.getRuntimeState) return this.e(channel, requestId, 'handler not registered');
        const runtimeId = typeof payload === 'string' ? payload : '';
        return ok(channel, requestId, await this.handlers.getRuntimeState(runtimeId));
      }
      case 'dsh:get-snapshot': {
        if (!this.handlers.getSnapshot) return this.e(channel, requestId, 'handler not registered');
        return ok(channel, requestId, await this.handlers.getSnapshot());
      }
      case 'dsh:lifecycle-action': {
        if (!this.handlers.lifecycleAction) return this.e(channel, requestId, 'handler not registered');
        const actionPayload = LifecycleActionPayloadSchema.safeParse(payload);
        if (!actionPayload.success) {
          return this.e(channel, requestId, 'invalid lifecycle payload');
        }
        const decision = await this.handlers.lifecycleAction(actionPayload.data);
        return decision.allowed
          ? ok(channel, requestId, { accepted: true })
          : this.e(channel, requestId, decision.reason ?? 'lifecycle action denied');
      }
      case 'dsh:telemetry-subscribe': {
        const runtimeId = typeof payload === 'string' ? payload : '*';
        const accepted = this.handlers.telemetrySubscribe
          ? this.handlers.telemetrySubscribe(runtimeId)
          : true;
        return ok(channel, requestId, { accepted, runtimeId });
      }
    }
  }

  private e(channel: IpcChannel, requestId: string, error: string): IpcResponse {
    return IpcResponseSchema.parse({ channel, requestId, ok: false, error });
  }
}

function ok(channel: IpcChannel, requestId: string, result: unknown): IpcResponse {
  return IpcResponseSchema.parse({ channel, requestId, ok: true, result });
}

export { IpcChannelSchema, IpcRequestSchema, IpcResponseSchema, LifecycleActionPayloadSchema } from '@dsh-control-center/control-contract';