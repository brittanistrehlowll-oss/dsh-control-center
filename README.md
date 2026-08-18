# DSH Control Center

Windows-first control plane for a locally installed **DeepSeek Harness (DSH)**.

V1.1 keeps the existing **Legacy Watchdog** (`dsh-controller` on
`127.0.0.1:3081` + external watchdog script) as the DSH process owner. Control
Center is a **Supervisor + Control Plane**: discovery, read-only health,
operation journal, crash recovery, redacted snapshots, diagnostics, update
preflight, and (behind gates) a thin Electron shell. It never modifies the DSH
runtime or the existing plugin repositories.

> Status: V1.1 implementation in progress. **Checkpoint A** is the current gate.
> Pilot builds are unsigned until a Windows code-signing certificate exists.

## What makes this different from a naive wrapper

Every protocol assumption in this repo was **verified against a live
`0.1.0-rc.7` DSH** (2026-08-18), not copied from docs:

| Real DSH surface | Shape | Used for |
|---|---|---|
| `GET :3080/api/system/health` | `{ok, ready, bootId, pid, uptime, …}` | DSH discriminator + per-boot restart evidence |
| `GET :3081/api/status` | `{state, bootId, pid, uptime, instanceId}` | Legacy controller corroboration |
| `POST :3080/api/session.list` | RPC envelope → `server-response` | Read-only recent sessions |
| `GET :3080/` | HTML with `window.__DSH_BOOT__.rev` | Boot-leak check (rev is NOT per-boot) |

There is **no** `/__dsh/control/fingerprint` — earlier drafts assumed one; the
code now probes what DSH actually answers.

## Non-goals (V1.1)

- No `OwnedRuntimeAdapter` — no direct process ownership.
- No process killing / arbitrary port takeover.
- No modification of the DSH runtime or the three legacy plugin repos
  (`dsh-lifecycle`, `dsh-quota-panel`, `dsh-pet-shura`).
- No database; snapshots are flat JSON files.
- No prompt/assistant/tool/shell/credential content ever persisted or rendered.

## Workspace

```
apps/supervisor            runnable supervisor entry (read-only first round)
packages/control-contract  all V1.1 Zod schemas (the contract)
packages/operation-journal append-only operations.jsonl + atomic JSON
packages/runtime-discovery real-surface probing + identity + ownership
packages/snapshot-store    atomic snapshots, last-good, sensitive scan
packages/security          redaction + secret detection
packages/diagnostics       PASS/WARN/FAIL/UNKNOWN across subsystems
packages/dsh-client        read-only RPC client (bounded, redacted)
packages/update-provider   official-source verify + compatibility + rollback
packages/supervisor-core   single-instance lock, journal recovery, reconcile
adapters/lifecycle/legacy-watchdog  ONLY place knowing 3080/3081/markers
tests/fake-runtime         fake DSH mirroring the real surface
```

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm test          # build + vitest
pnpm verify:contract
pnpm scan:secret   # no credentials/cookies/prompts in tracked state
pnpm scan:path     # no absolute local paths in committed files
```

## Read-only first round (Checkpoint A)

The supervisor entry performs only the allowed first-round actions: identify
DSH, read version, read fingerprint, confirm `ownership === legacy`, and a
Legacy Adapter **dry-run**. It never stops or restarts DSH.

```bash
pnpm --filter @dsh-control-center/supervisor start -- --state-dir "%LOCALAPPDATA%\DSHControlCenter\state" --dsh-logs-dir "<DSH_LOGS_DIR>"
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — frozen V1.1 plan + optimizations
- [docs/WORK-INVENTORY.md](docs/WORK-INVENTORY.md) — what exists / what's next
- [docs/CHECKPOINTS.md](docs/CHECKPOINTS.md) — Checkpoints A/B/C acceptance
- [docs/decisions/](docs/decisions/) — ADR-001..004

## Repository topics

`dsh-plugin`, `deepseek-harness`, `deepseek`, `control-center`

## License

MIT.