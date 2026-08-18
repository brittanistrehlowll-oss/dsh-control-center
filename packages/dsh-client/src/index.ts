import {
  QuotaSnapshotSchema,
  type RecentSessionSurface,
  type QuotaSnapshot
} from '@dsh-control-center/control-contract';
import { redact, redactLogLine } from '@dsh-control-center/security';

/**
 * dsh-client — read-only client for the real DSH RPC gateway
 * (POST /api/<method>, verified on 0.1.0-rc.7).
 *
 * Rules enforced here (V1.1):
 *  - The base URL must be loopback (127.0.0.1 / localhost / ::1).
 *  - Responses are bounded (timeout + max body bytes).
 *  - Only `session.list` (and schema-validated health) is called; nothing is
 *    ever written to DSH through this client.
 *  - Raw upstream responses are redacted before they leave this package.
 */

export interface DshClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** Supervisor identity string included in rpcId. */
  clientTag?: string;
}

export interface RpcCallOptions {
  timeoutMs?: number;
}

export interface SessionListResult {
  sessions: RecentSessionSurface[];
  raw: unknown; // redacted envelope for logging only
}

export class DshClientError extends Error {
  constructor(message: string, readonly code: 'NOT_LOOPBACK' | 'TIMEOUT' | 'HTTP' | 'SCHEMA' | 'BODY_LIMIT' | 'CONTENT_TYPE' | 'RPC') {
    super(message);
    this.name = 'DshClientError';
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function sanitizeSessionItems(items: unknown): RecentSessionSurface[] {
  if (!Array.isArray(items)) return [];
  const out: RecentSessionSurface[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) continue;
    const title = typeof record.title === 'string' ? record.title : undefined;
    const running = record.running === true;
    out.push({
      sessionId,
      ...(title !== undefined ? { title } : {}),
      state: running ? 'running' : 'idle',
      ...(typeof record.updatedAt === 'number' ? { lastActivityAt: new Date(record.updatedAt).toISOString() } : {}),
      canOpen: true
    });
  }
  return out.slice(0, 5);
}

export class DshClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly clientTag: string;
  private rpcCounter = 0;

  constructor(options: DshClientOptions) {
    const url = new URL(options.baseUrl);
    if (!isLoopback(url.hostname)) {
      throw new DshClientError('base URL must be loopback', 'NOT_LOOPBACK');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 128 * 1024;
    this.clientTag = options.clientTag ?? 'dsh-control-center';
  }

  async health(): Promise<{ ready: boolean; bootId?: string; pid?: number } | undefined> {
    const url = `${this.baseUrl}/api/system/health`;
    const result = await this.getJson(url);
    if (!result.ok) return undefined;
    const body = result.body as Record<string, unknown> | null;
    if (!body || body.ok !== true || typeof body.ready !== 'boolean') return undefined;
    return {
      ready: body.ready as boolean,
      ...(typeof body.bootId === 'string' ? { bootId: body.bootId } : {}),
      ...(typeof body.pid === 'number' ? { pid: body.pid } : {})
    };
  }

  /** Read-only session list via the real RPC envelope. */
  async sessionList(options: RpcCallOptions = {}): Promise<SessionListResult> {
    const response = await this.rpc('session.list', {}, options);
    // Redact the envelope before it can be logged or forwarded.
    const redacted = redact(response);
    const value = (response as { value?: { items?: unknown } }).value;
    const items = value?.items;
    return { sessions: sanitizeSessionItems(items), raw: redacted };
  }

  private async rpc(method: string, payload: unknown, options: RpcCallOptions): Promise<unknown> {
    this.rpcCounter += 1;
    const rpcId = `${this.clientTag}-${Date.now()}-${this.rpcCounter}`;
    const url = `${this.baseUrl}/api/${method}`;
    const body = JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload
    });
    const result = await this.postJson(url, body, { 'content-type': 'application/json' }, options.timeoutMs);
    if (!result.ok) {
      throw new DshClientError(`RPC ${method} HTTP ${result.status}`, 'HTTP');
    }
    const envelope = result.body as { type?: string; rpcId?: string; result?: { ok?: boolean; error?: unknown } } | null;
    if (!envelope || envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new DshClientError(`RPC ${method} envelope mismatch`, 'RPC');
    }
    if (envelope.result?.ok !== true) {
      throw new DshClientError(`RPC ${method} failed: ${redactLogLine(String(envelope.result?.error ?? 'unknown'))}`, 'RPC');
    }
    return envelope.result;
  }

  private async getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
    return this.requestJson(url, { method: 'GET', headers: { accept: 'application/json' } }, undefined);
  }

  private async postJson(url: string, body: string, headers: Record<string, string>, timeoutMs?: number): Promise<{ ok: boolean; status: number; body: unknown }> {
    return this.requestJson(url, { method: 'POST', headers, body }, timeoutMs);
  }

  private async requestJson(url: string, init: RequestInit, timeoutMs?: number): Promise<{ ok: boolean; status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new DshClientError(`unexpected content-type: ${contentType}`, 'CONTENT_TYPE');
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > this.maxBodyBytes) {
        throw new DshClientError('response body exceeds limit', 'BODY_LIMIT');
      }
      const text = new TextDecoder().decode(buffer);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new DshClientError('response is not valid JSON', 'SCHEMA');
      }
      return { ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      if (error instanceof DshClientError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DshClientError('request timed out', 'TIMEOUT');
      }
      throw new DshClientError('request failed: ' + (error instanceof Error ? error.message : String(error)), 'HTTP');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Quota path — validates the normalized QuotaSnapshot shape. */
export function parseQuotaSnapshot(value: unknown): QuotaSnapshot {
  return QuotaSnapshotSchema.parse(value);
}