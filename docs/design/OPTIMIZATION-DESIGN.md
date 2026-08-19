# Optimization Design — beyond the review drafts (2026-08)

This document records the **improved designs** for the five optimization
proposals. Each section states what the review draft got right, what needed to
change and why, and the final design that lands in this repository.

## 0. Guiding principles

1. **Contract-first**: every cross-module shape is a Zod schema in
   `control-contract`, not an ad-hoc interface.
2. **Deterministic tests**: time and randomness are injected; no `Date.now()`
   or `Math.random()` inside logic that tests must pin down.
3. **Fail-closed**: anything security- or update-related refuses to act unless
   all evidence is present.
4. **Boundaries respected**: telemetry belongs to the supervisor, not the
   read-only client; Electron belongs behind Checkpoint C, not before it.
5. **The journal stays authoritative**: compaction must never lose or renumber
   `operations.jsonl` events.

---

## 1. Crash-Loop backoff + circuit breaker (`supervisor-core`)

**Draft did well:** exponential backoff with jitter, sliding window, circuit
states, half-open probing.

**Draft problems:**

- `getCircuitState()` transitioned OPEN→HALF_OPEN as a *side effect of a getter*
  and depended on `Date.now()` — untestable and surprising.
- The backoff cap read `maxBackoffMs` as both the cooldown and the cap, so a
  small cap made the circuit reopen almost immediately.
- No observability (counters) for the supervisor dashboard.

**Final design (`crash-loop-policy.ts`):**

- `now` is injectable; all time reads go through it.
- OPEN→HALF_OPEN happens in `getCircuitState()` but is idempotent and clock
  driven; the cooldown is a dedicated `cooldownMs` (= maxBackoffMs by default).
- `stats()` exposes `consecutiveFailures`, `failuresInWindow`, `state` for
  diagnostics/metrics.
- Advice from `recordFailure()` is a single object (`canRetry`, `nextDelayMs`,
  `state`) so callers can log it verbatim.
- 5 tests with a fake clock: growth bounds, circuit open, cooldown→half-open→
  closed, window expiry, reset.

**Integration:** `Supervisor` wires a `CrashLoopController` per runtimeId and
consults it before scheduling a restart in the reconcile path. The observer
surface reports circuit state via diagnostics (PASS when CLOSED, WARN when
HALF_OPEN, FAIL when OPEN).

---

## 2. Snapshot compaction + journal anchoring (`snapshot-store`)

**Draft did well:** atomic rewrite intent, base snapshot + checksum, anchor
entry.

**Draft problems:**

- `fs.rename` over an existing file fails on Windows (`EEXIST`/`EPERM`) — the
  project already solved this in `operation-journal.writeAtomicJson`; the draft
  re-introduced the bug.
- The draft **truncated `operations.jsonl` and wrote an anchor line** — this
  violates the V1.1 rule that the journal is the only authority. A crash between
  "write anchor" and "rename base" loses history; the anchor also breaks `seq`
  continuity (the journal's next `seq` would reset).
- Compaction was a static helper with no failure story.

**Final design (`snapshot-store/src/compactor.ts`):**

- Compaction targets **historical snapshots**, not the live journal. It folds
  `surface-snapshot*.json` history into a `snapshot-base.json` + optional RFC
  6902-style `snapshot-patch.json` delta, keeping the *current* snapshot and
  `last-good` untouched (they are the operational contract).
- For the journal, compaction writes a **compact checkpoint file**
  (`journal-checkpoint.json` with `lastSeq`, `hash`, `compactedAt`) that is
  purely advisory for recovery; the JSONL itself is never truncated in place.
  Truncation is an explicit, separately-invoked maintenance operation that
  rewrites a temp file with the anchor **and** the original `seq` counter.
- All writes go through `writeAtomicJson` (temp→flush→rename with Windows
  EEXIST retry), and failures leave the previous state intact.

---

## 3. SSE telemetry stream (`supervisor-core` + `apps/supervisor`)

**Draft did well:** typed event envelope, broadcast on state change, SSE HTTP
handler, per-instance fan-out.

**Draft problems:**

- Placed in `dsh-client` — the *read-only client* — which must never host a
  server or emit system events. Wrong layer.
- Singleton + `EventEmitter` with dynamic event names (`instance:${id}`) is
  hard to reason about and to test; `req: any/res: any` in the handler.
- No heartbeat, no event history, no disconnect accounting.

**Final design:**

- **Contract** (`control-contract`): `TelemetryEventSchema` —
  `type: 'state-changed' | 'diagnostic-alert' | 'quota-updated' | 'operation-event'`,
  `timestamp`, `runtimeId`, `seq`, `payload` (redacted-safe). A
  `TelemetrySubscriptionSchema` documents the wire protocol.
- **`supervisor-core`**: `EventBus` — a typed, non-singleton bus keyed by
  `runtimeId` with bounded history (ring buffer, default 100 events), listener
  accounting, and `subscribe(runtimeId | '*')`. Replaces the draft's singleton.
- **`apps/supervisor`**: `sse.ts` — a typed SSE endpoint (`GET /events`):
  `Content-Type: text/event-stream`, heartbeat comment every 15 s, replays the
  ring buffer on connect, `close` cleanup, per-connection `AbortController`.
  No `any`.
- `TelemetryEventSchema.parse` guards every broadcast (contract-first).

---

## 4. Secure IPC layer (`control-contract` + `supervisor-core`)

**Draft did well:** `contextBridge` preload shape, IPC channel allow-list,
Zod validation at the main-process boundary.

**Draft problem:** it imports `electron` and registers `ipcMain` handlers
**before Checkpoint C** (Electron security gate). Landing it now would ship
privileged surface without the gate's E2E evidence.

**Final design (protocol first, shell later):**

- **`control-contract`**: `IpcChannelSchema` (allow-list:
  `dsh:get-runtime-state`, `dsh:get-snapshot`, `dsh:lifecycle-action`,
  `dsh:telemetry-subscribe`), `IpcRequestSchema`, `IpcResponseSchema` with
  per-channel payload validation. This is the *wire contract* both sides
  compile against.
- **`supervisor-core`**: `IpcProtocol` — a pure validation/authorization layer:
  `authorize(channel, payload)` returns `{ok}` or a typed rejection; channel
  allow-list enforced; lifecycle actions checked against the mutation gate
  (single lease, idempotency). **No electron import.**
- **`apps/control-surface`**: keeps its gated placeholder; the actual Electron
  main/preload wiring (a thin adapter over `IpcProtocol`) lands **with
  Checkpoint C**, where sandbox/contextIsolation/CSP are verified E2E.

---

## 5. Ed25519 update verification (`update-provider`)

**Draft did well:** SHA-256 + Ed25519 via `crypto.verify(null, …)`, manifest
with artifactUrl/sha256/signature.

**Draft problems:**

- `UpdateManifest` was an ad-hoc interface — the project's contract-first rule
  requires a Zod schema in `control-contract`.
- No fail-closed story: a missing public key or missing signature must refuse
  the update, not pass vacuously.
- No negative tests (tampered bytes, wrong key, malformed signature).

**Final design (`update-provider/src/verifier.ts`):**

- `UpdateManifestSchema` (Zod, in `control-contract`): `version`, `artifactUrl`,
  `sha256` (hex, 64), `signatureBase64`, `publicKeyPem` (optional at manifest
  level; resolution is a `KeyProvider` seam).
- `UpdateVerifier.verifyPackage(file, manifest, publicKeyPem)`:
  1. hash check (constant-time-ish compare, lowercase);
  2. Ed25519 verify with `crypto.verify(null, …)`;
  3. **fail-closed**: missing key/signature → `valid:false` with reason.
- `KeyProvider` interface (resolve public key from store/env/seam) so tests
  inject a key and CI never needs real secrets.
- Tests: valid round-trip (generate keypair in test), tampered bytes,
  wrong key, malformed signature, missing key.

---

## Priority & delivery order

| # | Item | Package | Tests |
|---|---|---|---|
| 1 | CrashLoopController | supervisor-core | 5 ✅ |
| 2 | EventBus + SSE endpoint | supervisor-core, apps/supervisor, control-contract | planned |
| 3 | SnapshotCompactor (safe) | snapshot-store | planned |
| 4 | Secure IPC protocol layer | control-contract, supervisor-core | planned |
| 5 | UpdateVerifier (Ed25519) | update-provider, control-contract | planned |

Each lands with its tests, the full suite stays green (63 + new), scans pass,
then everything is committed and pushed.