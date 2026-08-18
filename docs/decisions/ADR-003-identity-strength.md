# ADR-003: Identity strength requires real boot evidence

## Status

Accepted (2026-08-18).

## Context

Restart verification must never mistake "the same old process still answering"
for "a new instance is ready". A stale HTTP 200 from the pre-restart process is
the classic false-positive. dsh-lifecycle already solved this with a
per-boot `bootId` that changes on every DSH start.

## Decision

`InstanceIdentity.strength`:

- **strong** — only when ALL of these are present and mutually consistent:
  `pid`, `processStartedAt`, `commandFingerprint`, `bootId`, `profileId`.
  The identity value is a SHA-256 over those five.
- **weak** — protocol-observable evidence only (e.g. `bootId` or `pid` alone).
- **none** — nothing usable.

A restart is reported verified **only** when both old and new identities are
`strong` AND their values differ (`identityChanged`), AND `ready === true`,
AND the profile matches, AND the operation lease is still valid.

When the new identity cannot be raised to `strong`, the UI shows only
*"DSH responded, but the new instance could not be confirmed"* — never a green
success state.

## Consequences

- `bootId` MUST come from the live health endpoint (ADR-002), not from the
  served page's `window.__DSH_BOOT__` (that `rev` is a build revision, stable
  across restarts, and useless for restart detection).
- Tests cover the negative case: same pid/boot on both sides is not a restart;
  changed bootId with same everything else IS.