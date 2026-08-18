# Checkpoints — V1.1 gates

Each checkpoint is a hard gate. Work past a gate is not started until every
item below passes with real evidence (running tests, live probes, or artifacts
— never static review).

## Checkpoint A — Lifecycle Gate

Purpose: nothing in the Electron shell can enable destructive lifecycle buttons
until the supervisor can prove a restart is safely detectable, idempotent, and
recoverable.

Required (all must pass):

- [ ] `control-contract` schema tests (`pnpm test:contracts`)
- [ ] Fake Runtime tests (real DSH surface: health + RPC + controller)
- [ ] Journal recovery: unfinished operations rebuilt after supervisor restart
- [ ] Idempotency: duplicate `idempotencyKey` for an in-flight op is replayed,
      a different mutation during a lease is rejected (`MutationBusyError`)
- [ ] Identity negative: generic HTTP 200 is rejected (`NOT_DSH`); same-boot
      observation is NOT a restart
- [ ] Ownership negative: non-legacy sources never reported as legacy
- [ ] Crash reconciliation: suspended operation rebuilt to `running` at a
      recovery stage
- [ ] External-restart detection: bootId change observed without a request
- [ ] Sensitive scan: snapshot store + `pnpm scan:secret` + `pnpm scan:path`

First real-environment round is limited to: identify DSH, read version,
read fingerprint, confirm `ownership === legacy`, Legacy Adapter **dry-run**.
No real stop/restart of DSH from a Codex session.

## Checkpoint B — Update Gate

Purpose: the "one-click update" path must be provably official and reversible
before the Update button becomes enabled (otherwise it stays "Check update").

Required (all must pass):

- [ ] Official repository identity verification (`deepseek-ai/deepseek-harness`)
- [ ] Release/tag verification chain: tag → commit → package.json → version
- [ ] Channel verification (stable vs preview by prerelease)
- [ ] Staging into `%LOCALAPPDATA%\DSHControlCenter\runtimes\staging\`
- [ ] Temp `DSH_HOME` + temp ports for the compatibility probe
- [ ] Compatibility probe: runtime fingerprint, session.list, projection,
      deep-link, node/pnpm toolchain
- [ ] Version verification post-apply
- [ ] Rollback on every listed failure cause
- [ ] Unknown install origin → fail-closed
- [ ] Desktop-managed install → fail-closed

## Checkpoint C — Desktop Pilot Gate

Purpose: ship an unsigned pilot build with a secure Electron shell.

Required (all must pass):

- [ ] Electron security: `sandbox=true`, `contextIsolation=true`,
      `nodeIntegration=false`, strict CSP, IPC allow-list, no arbitrary
      navigation, no renderer `fs`/`process`/`child_process`
- [ ] IPC authentication (hello handshake with nonce + proof)
- [ ] IPC allow-list enforcement
- [ ] Clean Windows install, upgrade, rollback, uninstall
- [ ] DSH data protection (never mutate DSH files/state)
- [ ] Journal integrity after install/upgrade
- [ ] Snapshot sensitive-field scan
- [ ] `scan:secret` / `scan:path` / license scan / CI / Windows E2E /
      installer smoke test / artifact hashes / README / release notes

Artifacts without a code-signing certificate are labeled
**Unsigned Pilot Build** and never claimed as signed releases.