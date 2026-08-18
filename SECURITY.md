# Security Policy

## Supported versions

| Version | Support |
|---|---|
| `0.1.x` (pilot) | ✅ active development |

There are no signed releases yet. Every artifact is an **Unsigned Pilot Build**.

## Data-safety invariants (V1.1)

This repository's core promise: Control Center never persists or forwards

- prompts, assistant bodies, or tool arguments;
- shell commands or file contents;
- credentials, tokens, cookies, or authorization headers;
- raw upstream (provider/quota/session) responses;
- full session logs.

Enforcement:

- `packages/snapshot-store` refuses any value containing sensitive keys
  (`SensitiveSurfaceDataError`).
- `packages/security` provides `redact`, `redactLogLine`,
  `assertNoSensitiveKeys` used by every persistence/forwarding path.
- `packages/dsh-client` bounds timeouts and bodies, validates content-type and
  RPC schema, and redacts before returning.
- `pnpm scan:secret` and `pnpm scan:path` run in CI and block tracked
  credentials / absolute local paths.

## Security gates

Lifecycle (stop/restart) and update actions are gated behind Checkpoint A / B
(see `docs/CHECKPOINTS.md`). Control Center never kills processes; it writes
marker intents that an external watchdog consumes.

## Reporting a vulnerability

Do **not** open a public issue for security findings.

- Email: `BrittaniStrehlowlL@gmail.com`
- Please include: affected version, reproduction steps, impact, and (if known)
  a patch. Expect an acknowledgement within 3 business days.

## Scope

- In scope: this repository's packages, adapters, and the supervisor flow.
- Out of scope: the DSH runtime itself, the legacy plugin repositories
  (`dsh-lifecycle`, `dsh-quota-panel`, `dsh-pet-shura`), and third-party deps
  (report those upstream).