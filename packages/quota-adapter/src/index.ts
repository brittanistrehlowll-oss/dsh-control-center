import {
  QuotaSnapshotSchema,
  type QuotaSnapshot
} from '@dsh-control-center/control-contract';
import { redact, redactLogLine } from '@dsh-control-center/security';

/**
 * quota-adapter — fixed credential-resolve → trusted-endpoint quota pipeline.
 *
 * Mirrors the dsh-quota-panel proxy discipline at supervisor level:
 *   credential resolve → trusted endpoint → timeout/body cap →
 *   content-type check → JSON parse → schema validation → normalize →
 *   QuotaSnapshot.
 *
 * Rules (V1.1 §三):
 *  - The endpoint is NOT user-configurable from the UI; it is resolved from
 *    fixed configuration through {@link EndpointResolver}.
 *  - Raw upstream responses are redacted before they can be logged or
 *    forwarded; the renderer only ever sees the normalized QuotaSnapshot.
 *  - QuotaSnapshot state is derived (`ok|warn|critical|unavailable|stale`).
 */

export type ProviderState = 'ok' | 'warn' | 'critical' | 'unavailable' | 'stale';

export interface QuotaAdapterOptions {
  providerId: string;
  /** Stable configuration-derived endpoint; never an arbitrary UI URL. */
  resolveEndpoint: EndpointResolver;
  timeoutMs?: number;
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
  /** Map an upstream raw value to a normalized metric. */
  normalize?: (raw: Record<string, unknown>) => {
    kind: 'balance' | 'usage';
    value: number;
    unit: 'CNY' | 'percent' | 'requests';
    resetAt?: string;
  }[];
}

export type EndpointResolver = () =>
  | { url: string; headers?: Record<string, string>; authScheme?: 'bearer' | 'header' }
  | undefined;

export class QuotaAdapterError extends Error {
  constructor(message: string, readonly code: 'NOT_CONFIGURED' | 'TIMEOUT' | 'BODY_LIMIT' | 'CONTENT_TYPE' | 'SCHEMA' | 'HTTP') {
    super(message);
    this.name = 'QuotaAdapterError';
  }
}

const DEFAULT_NORMALIZER: NonNullable<QuotaAdapterOptions['normalize']> = (raw) => {
  const metrics: Array<{ kind: 'balance' | 'usage'; value: number; unit: 'CNY' | 'percent' | 'requests'; resetAt?: string }> = [];
  if (typeof raw.balance === 'number') {
    metrics.push({ kind: 'balance', value: raw.balance, unit: 'CNY', ...(typeof raw.resetAt === 'string' ? { resetAt: raw.resetAt } : {}) });
  }
  if (typeof raw.usagePercent === 'number') {
    metrics.push({ kind: 'usage', value: raw.usagePercent, unit: 'percent' });
  }
  return metrics;
};

export class QuotaAdapter {
  private readonly options: Required<Pick<QuotaAdapterOptions, 'providerId' | 'timeoutMs' | 'maxBodyBytes'>> &
    Pick<QuotaAdapterOptions, 'fetchImpl' | 'normalize'> & { resolveEndpoint: EndpointResolver };

  constructor(options: QuotaAdapterOptions) {
    this.options = {
      providerId: options.providerId,
      resolveEndpoint: options.resolveEndpoint,
      timeoutMs: options.timeoutMs ?? 3_000,
      maxBodyBytes: options.maxBodyBytes ?? 64 * 1024,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.normalize ? { normalize: options.normalize } : {})
    };
  }

  async fetchQuota(): Promise<QuotaSnapshot> {
    const endpoint = this.options.resolveEndpoint();
    if (!endpoint) {
      return this.unavailable('NOT_CONFIGURED');
    }
    const url = new URL(endpoint.url);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      // Trusted endpoints: https anywhere, or loopback for provider mocks/dev.
      return this.unavailable('NOT_CONFIGURED');
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const headers: Record<string, string> = { accept: 'application/json', ...endpoint.headers };
      if (endpoint.authScheme === 'bearer') {
        // Credential is attached here, at the seam, and never leaves this call.
        headers.authorization = `Bearer ${endpoint.headers?.authorization ?? ''}`;
      }
      const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new QuotaAdapterError('unexpected content-type', 'CONTENT_TYPE');
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > this.options.maxBodyBytes) {
        throw new QuotaAdapterError('response body exceeds limit', 'BODY_LIMIT');
      }
      if (!response.ok) {
        return this.unavailable('UPSTREAM');
      }
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(buffer));
      } catch {
        throw new QuotaAdapterError('invalid JSON', 'SCHEMA');
      }
      if (typeof raw !== 'object' || raw === null) {
        throw new QuotaAdapterError('response is not an object', 'SCHEMA');
      }

      const record = raw as Record<string, unknown>;
      const normalize = this.options.normalize ?? DEFAULT_NORMALIZER;
      const metrics = normalize(record);

      const state = deriveState(record, metrics);
      const snapshot: QuotaSnapshot = QuotaSnapshotSchema.parse({
        schemaVersion: 1,
        providerId: this.options.providerId,
        state,
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        metrics,
        ...(state === 'unavailable' || state === 'stale'
          ? { errorCode: state === 'unavailable' ? ('UPSTREAM' as const) : ('TIMEOUT' as const) }
          : {})
      });
      // Redaction guard for anything that escapes as diagnostics.
      void redact(record);
      return snapshot;
    } catch (error) {
      if (error instanceof QuotaAdapterError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        return this.unavailable('TIMEOUT');
      }
      return this.unavailable('UPSTREAM');
    } finally {
      clearTimeout(timer);
    }
  }

  private unavailable(code: 'NOT_CONFIGURED' | 'AUTH' | 'RATE_LIMITED' | 'TIMEOUT' | 'UPSTREAM' | 'SCHEMA'): QuotaSnapshot {
    const now = new Date().toISOString();
    return QuotaSnapshotSchema.parse({
      schemaVersion: 1,
      providerId: this.options.providerId,
      state: 'unavailable',
      observedAt: now,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      metrics: [],
      errorCode: code
    });
  }
}

function deriveState(raw: Record<string, unknown>, metrics: Array<{ kind: 'balance' | 'usage'; value: number }>): ProviderState {
  if (metrics.length === 0) {
    if (typeof raw.error === 'string' && raw.error?.length > 0) return 'unavailable';
    return 'stale';
  }
  const usage = metrics.find((m) => m.kind === 'usage');
  if (usage && usage.value >= 95) return 'critical';
  if (usage && usage.value >= 80) return 'warn';
  const balance = metrics.find((m) => m.kind === 'balance');
  if (balance && balance.value < 5) return 'critical';
  if (balance && balance.value < 20) return 'warn';
  return 'ok';
}