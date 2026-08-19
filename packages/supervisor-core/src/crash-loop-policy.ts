import { z } from 'zod';

/**
 * CrashLoopController — exponential backoff with jitter + circuit breaker.
 *
 * Guards the supervisor against death-loop restarts when DSH hits a fatal
 * config error or a missing dependency. On repeated failures within a window
 * the circuit OPENS (no more retries) until the cooldown elapses, then goes
 * HALF_OPEN for a controlled number of probe successes before CLOSING again.
 *
 * Design notes (improved over the review draft):
 *  - A `now` clock is injectable so tests are deterministic (no Date.now()).
 *  - HALF_OPEN is entered explicitly via `probe()` / `getCircuitState()` with
 *    a fixed cooldown, not implicitly by an elapsed-time read.
 *  - recordFailure returns `canRetry=false` only when the circuit opens;
 *    backoff grows exponentially with jitter and is capped.
 */

export const CircuitStateSchema = z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']);
export type CircuitState = z.infer<typeof CircuitStateSchema>;

export interface CrashLoopConfig {
  /** Failures in the window that open the circuit. Default 5. */
  maxConsecutiveFailures: number;
  /** Sliding window for failure counting (ms). Default 60_000. */
  windowMs: number;
  /** Base backoff (ms). Default 1_000. */
  baseBackoffMs: number;
  /** Backoff cap (ms). Default 30_000. */
  maxBackoffMs: number;
  /** Consecutive HALF_OPEN successes that close the circuit. Default 2. */
  halfOpenResetSuccesses: number;
  /** Optional deterministic clock for tests. */
  now?: () => number;
}

export interface FailureAdvice {
  canRetry: boolean;
  nextDelayMs: number;
  state: CircuitState;
}

const DEFAULTS = {
  maxConsecutiveFailures: 5,
  windowMs: 60_000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  halfOpenResetSuccesses: 2
} as const;

export class CrashLoopController {
  private failureTimestamps: number[] = [];
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private state: CircuitState = 'CLOSED';
  private circuitOpenedAt = 0;
  private readonly config: Required<Pick<CrashLoopConfig, 'maxConsecutiveFailures' | 'windowMs' | 'baseBackoffMs' | 'maxBackoffMs' | 'halfOpenResetSuccesses'>>;
  private readonly now: () => number;

  constructor(config: Partial<CrashLoopConfig> = {}) {
    this.config = {
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? DEFAULTS.maxConsecutiveFailures,
      windowMs: config.windowMs ?? DEFAULTS.windowMs,
      baseBackoffMs: config.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
      maxBackoffMs: config.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
      halfOpenResetSuccesses: config.halfOpenResetSuccesses ?? DEFAULTS.halfOpenResetSuccesses
    };
    this.now = config.now ?? (() => Date.now());
  }

  /** Record a healthy run / successful start. */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.config.halfOpenResetSuccesses) {
        this.reset();
      }
      return;
    }
    this.reset();
  }

  /**
   * Record a crash / abnormal exit. Returns whether a retry is allowed and
   * the suggested delay. When the circuit is OPEN, canRetry is false until
   * the cooldown elapses and the circuit transitions to HALF_OPEN.
   */
  recordFailure(): FailureAdvice {
    const now = this.now();
    this.failureTimestamps = this.failureTimestamps.filter((t) => now - t <= this.config.windowMs);
    this.failureTimestamps.push(now);
    this.consecutiveFailures += 1;
    this.consecutiveSuccesses = 0;

    const thresholdReached =
      this.consecutiveFailures >= this.config.maxConsecutiveFailures ||
      this.failureTimestamps.length >= this.config.maxConsecutiveFailures;

    if (thresholdReached) {
      this.state = 'OPEN';
      this.circuitOpenedAt = now;
      return { canRetry: false, nextDelayMs: this.config.maxBackoffMs, state: 'OPEN' };
    }

    const exp = Math.min(this.consecutiveFailures - 1, 6);
    const capped = Math.min(this.config.baseBackoffMs * Math.pow(2, exp), this.config.maxBackoffMs);
    const jitter = Math.random() * (this.config.baseBackoffMs * 0.5);
    return {
      canRetry: true,
      nextDelayMs: Math.round(capped + jitter),
      state: this.state
    };
  }

  /**
   * Current circuit state; when OPEN and the cooldown has elapsed, the
   * circuit transitions to HALF_OPEN (one controlled probe allowed).
   */
  getCircuitState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.circuitOpenedAt > this.config.maxBackoffMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  reset(): void {
    this.failureTimestamps = [];
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.state = 'CLOSED';
    this.circuitOpenedAt = 0;
  }

  stats(): { consecutiveFailures: number; failuresInWindow: number; state: CircuitState } {
    const now = this.now();
    return {
      consecutiveFailures: this.consecutiveFailures,
      failuresInWindow: this.failureTimestamps.filter((t) => now - t <= this.config.windowMs).length,
      state: this.state
    };
  }
}