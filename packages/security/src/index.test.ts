import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  UnsafeContentError,
  assertNoSensitiveKeys,
  isSensitiveKey,
  looksLikeSecret,
  redact,
  redactLogLine
} from './index.js';

describe('security redaction', () => {
  it('recognizes sensitive key names', () => {
    expect(isSensitiveKey('prompt')).toBe(true);
    expect(isSensitiveKey('assistantContent')).toBe(true);
    expect(isSensitiveKey('tool_arguments')).toBe(true);
    expect(isSensitiveKey('auth_token')).toBe(true);
    expect(isSensitiveKey('cookie')).toBe(true);
    expect(isSensitiveKey('sessionId')).toBe(false);
    expect(isSensitiveKey('runtimeId')).toBe(false);
  });

  it('redacts sensitive keys deep and keeps safe data', () => {
    const input = {
      runtimeId: 'runtime-1',
      state: 'running',
      recentSessions: [{ sessionId: 's-1', title: 'hello' }],
      prompt: 'do not persist',
      nested: { assistant: { content: 'secret' }, ok: 1 }
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.runtimeId).toBe('runtime-1');
    expect(out.prompt).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).assistant).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect((out.recentSessions as unknown[])[0]).toEqual({ sessionId: 's-1', title: 'hello' });
  });

  it('redacts secret-looking values', () => {
    expect(looksLikeSecret('ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(looksLikeSecret('sk-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksLikeSecret('AKIA1234567890ABCDEF')).toBe(true);
    expect(looksLikeSecret('just a normal phrase')).toBe(false);
    expect(redact('sk-abcdefghijklmnopqrstuvwxyz')).toBe(REDACTED);
  });

  it('redacts tokens in log lines without touching structure', () => {
    const line = 'POST /api/quota ok token=ghp_abcdefghijklmnopqrstuvwxyz123456 time=12ms';
    const out = redactLogLine(line);
    expect(out).not.toContain('ghp_');
    expect(out).toContain('POST /api/quota ok');
    expect(out).toContain('time=12ms');
  });

  it('assertNoSensitiveKeys throws on the first sensitive key', () => {
    const safe = { runtimeId: 'r', ready: true };
    expect(() => assertNoSensitiveKeys(safe)).not.toThrow();
    const unsafe = { sessions: [{ sessionId: 's', prompt: 'x' }] };
    expect(() => assertNoSensitiveKeys(unsafe)).toThrow(UnsafeContentError);
  });
});