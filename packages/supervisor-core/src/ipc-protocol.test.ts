import { describe, expect, it } from 'vitest';
import { IpcProtocol } from './ipc-protocol.js';

describe('IpcProtocol — secure IPC layer', () => {
  it('enforces the channel allow-list', () => {
    const proto = new IpcProtocol();
    expect(proto.isChannelAllowed('dsh:get-runtime-state')).toBe(true);
    expect(proto.isChannelAllowed('dsh:exec-arbitrary')).toBe(false);
    expect(proto.isChannelAllowed(123)).toBe(false);
  });

  it('rejects malformed requests', async () => {
    const proto = new IpcProtocol();
    const invalid = proto.validateRequest({ channel: 'dsh:get-snapshot' }); // missing requestId
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.response.ok).toBe(false);
      expect(invalid.response.error).toBeTruthy();
    }

    const unknown = proto.validateRequest({ channel: 'dsh:evil', requestId: 'r1' });
    expect(unknown.ok).toBe(false);
  });

  it('dispatches get-runtime-state / get-snapshot through handlers', async () => {
    const proto = new IpcProtocol({
      getRuntimeState: (runtimeId) => ({ runtimeId, state: 'running' }),
      getSnapshot: () => ({ schemaVersion: 1 })
    });
    const state = await proto.dispatch({ channel: 'dsh:get-runtime-state', requestId: 'r1', payload: 'runtime-1' });
    expect(state.ok).toBe(true);
    expect(state.result).toEqual({ runtimeId: 'runtime-1', state: 'running' });
    const snap = await proto.dispatch({ channel: 'dsh:get-snapshot', requestId: 'r2' });
    expect(snap.ok).toBe(true);
  });

  it('guards lifecycle actions via the mutation policy', async () => {
    const proto = new IpcProtocol({
      lifecycleAction: ({ action, idempotencyKey }) =>
        action === 'restart' && idempotencyKey === 'idem-ok'
          ? { allowed: true }
          : { allowed: false, reason: 'busy or bad key' }
    });
    const denied = await proto.dispatch({
      channel: 'dsh:lifecycle-action',
      requestId: 'r3',
      payload: { action: 'stop', runtimeId: 'r', idempotencyKey: 'idem-ok' }
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('busy');

    const allowed = await proto.dispatch({
      channel: 'dsh:lifecycle-action',
      requestId: 'r4',
      payload: { action: 'restart', runtimeId: 'r', idempotencyKey: 'idem-ok' }
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.result).toEqual({ accepted: true });
  });

  it('returns typed error for an unknown handler', async () => {
    const proto = new IpcProtocol({});
    const res = await proto.dispatch({ channel: 'dsh:get-snapshot', requestId: 'r5' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('handler not registered');
  });
});