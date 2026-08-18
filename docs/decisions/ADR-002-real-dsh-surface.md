# ADR-002: Probe the real DSH surface instead of an invented protocol

## Status

Accepted (2026-08-18), replacing the earlier draft assumption.

## Context

The first draft of `runtime-discovery` probed `GET /__dsh/control/fingerprint`
and `GET /api/session/list` (slash). Live read-only probing of the installed
DSH `0.1.0-rc.7` proved both paths do not exist:
`GET /api/session.list` returns 404 on GET, and the fingerprint route is
unknown to the server. Assuming endpoints from documentation instead of the
running process produces a discovery layer that silently fails against real DSH.

## Decision

Define the protocol discriminators from what a live DSH actually answers:

1. `GET :3080/api/system/health` → `{ok,ready,bootId,pid,uptime[,version,profileId]}`.
   Schema-validated. `ok===true` alone is not enough; the full shape is required.
2. `GET :3081/api/status` (legacy controller) → `{state,running,bootId,pid,uptime,instanceId}`.
   Optional corroboration when a controller URL is configured.
3. `POST :3080/api/<method>` with the RPC envelope for sessions
   (`session.list` etc.), never GET.

A generic HTTP 200 with arbitrary JSON is rejected as `NOT_DSH` by schema
mismatch — the "HTTP 200 non-DSH must not be identified" requirement.

## Consequences

- Discovery works against the real runtime today, not a hypothetical one.
- The fake runtime mirrors these same surfaces, so tests exercise the real wire contract.
- The term "protocol fingerprint" in the contract now means a hash of the
  validated health payload (including `bootId`), not a custom endpoint answer.
- Removing the invented endpoint is a breaking change for earlier drafts only;
  no released consumers exist.