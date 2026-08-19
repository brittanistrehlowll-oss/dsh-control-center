import { describe, expect, it } from 'vitest';
import { CrashLoopController } from './crash-loop-policy.js';

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; }
  };
}

describe('CrashLoopController', () => {
  it('starts CLOSED and allows retries with growing backoff', () => {
    const clock = makeClock();
    const ctl = new CrashLoopController({ maxConsecutiveFailures: 5, now: clock.now });
    expect(ctl.getCircuitState()).toBe('CLOSED');

    const first = ctl.recordFailure();
    expect(first.canRetry).toBe(true);
    expect(first.nextDelayMs).toBeGreaterThanOrEqual(1_000);
    expect(first.nextDelayMs).toBeLessThanOrEqual(1_500); // base + jitter(<=500)

    clock.advance(5_000);
    const second = ctl.recordFailure();
    expect(second.canRetry).toBe(true);
    expect(second.nextDelayMs).toBeGreaterThanOrEqual(2_000);
    expect(second.nextDelayMs).toBeLessThanOrEqual(2_500); // 2x base + jitter
  });

  it('opens the circuit after maxConsecutiveFailures and blocks retries', () => {
    const clock = makeClock();
    const ctl = new CrashLoopController({ maxConsecutiveFailures: 3, now: clock.now });
    for (let i = 0; i < 2; i++) {
      clock.advance(100);
      expect(ctl.recordFailure().canRetry).toBe(true);
    }
    clock.advance(100);
    const opened = ctl.recordFailure();
    expect(opened.canRetry).toBe(false);
    expect(opened.state).toBe('OPEN');
    expect(ctl.getCircuitState()).toBe('OPEN');
  });

  it('transitions OPEN -> HALF_OPEN after the cooldown and closes on enough successes', () => {
    const clock = makeClock();
    const ctl = new CrashLoopController({
      maxConsecutiveFailures: 2,
      maxBackoffMs: 10_000,
      halfOpenResetSuccesses: 2,
      now: clock.now
    });
    clock.advance(100);
    ctl.recordFailure();
    clock.advance(100);
    ctl.recordFailure();
    expect(ctl.getCircuitState()).toBe('OPEN');

    clock.advance(10_001); // cooldown elapsed
    expect(ctl.getCircuitState()).toBe('HALF_OPEN');

    ctl.recordSuccess();
    expect(ctl.getCircuitState()).toBe('HALF_OPEN'); // needs 2 successes
    ctl.recordSuccess();
    expect(ctl.getCircuitState()).toBe('CLOSED');
  });

  it('forgets failures outside the sliding window', () => {
    const clock = makeClock();
    const ctl = new CrashLoopController({ maxConsecutiveFailures: 3, windowMs: 60_000, now: clock.now });
    ctl.recordFailure();
    clock.advance(61_000); // window expired
    const advice = ctl.recordFailure();
    expect(advice.canRetry).toBe(true);
    expect(ctl.stats().failuresInWindow).toBe(1);
  });

  it('reset clears everything', () => {
    const clock = makeClock();
    const ctl = new CrashLoopController({ maxConsecutiveFailures: 2, now: clock.now });
    ctl.recordFailure();
    ctl.recordFailure();
    expect(ctl.getCircuitState()).toBe('OPEN');
    ctl.reset();
    expect(ctl.getCircuitState()).toBe('CLOSED');
    expect(ctl.stats()).toEqual({ consecutiveFailures: 0, failuresInWindow: 0, state: 'CLOSED' });
  });
});