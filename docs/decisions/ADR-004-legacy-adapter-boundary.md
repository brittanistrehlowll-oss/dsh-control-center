# ADR-004: The legacy adapter is the only place that knows the legacy mechanics

## Status

Accepted (2026-08-18).

## Context

The legacy DSH lifecycle is marker-file driven: `dsh-controller` on
`127.0.0.1:3081` writes `logs/restart.requested` etc., and an external
watchdog consumes them. Ports 3080/3081, marker file names, and PowerShell
parameters are implementation details of that legacy path. If they leak into
the UI, the control contract, or any other adapter, a change to the legacy
mechanism forces changes across the whole codebase.

## Decision

All knowledge of `3080`/`3081`, marker files (`restart.requested`,
`stop.requested`, `start.requested`), watchdog log paths, and any PowerShell
invocation lives **only** inside `adapters/lifecycle/legacy-watchdog`.
The rest of the system sees a clean interface:

```
requestLifecycle(action): { accepted, operationId, idempotencyKey }
watchExternalRestart():   { detected, oldBootId, newBootId, at }
reconcile():              { rebuilt, operations }
```

The Supervisor, IPC, and Control Surface consume only `LifecycleOperation`
and `SurfaceSnapshot` contract types. V1.1 never calls `Stop-Process`,
`taskkill`, or any direct kill from Control Center code.

## Consequences

- If the legacy watchdog is replaced by an OwnedRuntimeAdapter later, only the
  adapter changes; the contract and UI stay stable (ADR-001).
- Static analysis can prove the containment rule: grep for `3080|3081|.requested`
  must only match within `adapters/` and tests.