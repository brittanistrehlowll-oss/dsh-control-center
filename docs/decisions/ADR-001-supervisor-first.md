# ADR-001: Supervisor-first control plane

## Status

Accepted

## Date

2026-08-18

## Context

The current DSH installation is already owned by a legacy watchdog/controller path. Making a new desktop process the owner in the first release would create an unsafe second lifecycle authority and would make PID, port and crash recovery ambiguous.

## Decision

V1.1 uses the Legacy Watchdog as the external DSH owner. Control Center is a Supervisor plus Control Plane. Lifecycle requests are sent through a narrow adapter, and the Supervisor observes the resulting identity and protocol state. Direct process termination and arbitrary port takeover are out of scope.

## Consequences

- Existing DSH and plugin repositories remain unchanged.
- The UI can remain useful while DSH is stopped because snapshots are independent of the live process.
- Strong identity evidence is required before a restart is reported as verified.
- An OwnedRuntimeAdapter can be added later without changing the control contract.
