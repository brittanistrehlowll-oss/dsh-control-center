# Contributing

Thanks for considering a contribution to DSH Control Center.

## Ground rules

1. **Never mutate a live DSH install.** Tests use the fake runtime
   (`tests/fake-runtime`); real stop/restart is exercised only in sanctioned
   environments, never from a development session.
2. **Never kill processes.** Lifecycle is marker-intent based (see
   `adapters/lifecycle/legacy-watchdog`).
3. **No sensitive data.** Prompts, assistant content, tool arguments, shell
   commands, file contents, credentials, and cookies must never be persisted or
   forwarded. If your change touches a persistence path, it must go through
   `@dsh-control-center/security`.
4. **The journal is authoritative.** `operations.jsonl` is the source of truth;
   `current-operation.json` is a derived cache.
5. **Legacy details stay in the adapter.** `3080`, `3081`, marker file names,
   and PowerShell invocation exist only inside
   `adapters/lifecycle/legacy-watchdog`.
6. **Write tests first.** Every behavior change ships with a vitest
   reproduction (`pnpm test`).

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm verify:contract
pnpm scan:secret
pnpm scan:path
```

## Package layout

- `packages/*` — libraries (contract, journal, discovery, snapshot, security,
  diagnostics, dsh-client, update-provider, supervisor-core).
- `adapters/lifecycle/*` — lifecycle adapters (legacy-watchdog).
- `apps/supervisor` — runnable supervisor entry (read-only first round).
- `apps/control-surface` — Electron shell (behind Checkpoint A/B/C).
- `tests/fake-runtime` + `tests/integration` + `tests/security` — fixtures and
  cross-package tests.

## Pull requests

- Target the `master` branch.
- Keep changes small and reversible; one slice per PR.
- Include evidence: run the relevant `pnpm test:*` script and paste the tail.
- Reference the affected ADR (`docs/decisions/`) when behaviour changes.

## Code of conduct

Be respectful, constructive, and evidence-driven. This project is Windows-first
for a single-operator workflow; proposals that break the V1.1 scope freeze
(`docs/PLAN.md` §1) need explicit maintainer sign-off.