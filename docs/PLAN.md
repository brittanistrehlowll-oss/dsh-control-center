# DSH Control Center — V1.1 Implementation Plan (Optimized)

> Status: **Frozen scope** (V1.1). This document supersedes earlier drafts and is
> grounded in the *real* DSH surface verified against a live `0.1.0-rc.7`
> installation on 2026-08-18. Every endpoint named here was probed read-only on
> a running DSH; nothing is assumed from documentation.

## 1. Scope freeze

**Only** two roles exist in V1.1:

| Role | Component |
|---|---|
| DSH process owner | **Legacy Watchdog** (`dsh-controller` on `127.0.0.1:3081` + `Start-DSH-Watchdog.ps1`) — unchanged, external |
| Control plane | **Control Center** = Supervisor + Control Surface (Electron shell) |

Explicitly **out of scope** for V1.1:

- `OwnedRuntimeAdapter` (direct process ownership by Control Center)
- Direct process termination / arbitrary port takeover
- Modifying the DSH runtime (`<DSH_ROOT>`) or its plugins
- Modifying the three legacy plugin repositories (`dsh-lifecycle`, `dsh-pet-shura`, `dsh-quota-panel`)
- Any database; snapshots are flat JSON files
- Plugin marketplace
- Full DSH Desktop replacement

## 2. Verified DSH surface (0.1.0-rc.7, live probes 2026-08-18)

These are the facts the whole design hangs on:

1. **DSH health**: `GET http://127.0.0.1:3080/api/system/health`
   ```json
   {"ok":true,"ready":true,"bootId":"dsh-20260818-124332-ab0f","pid":35116,"uptime":1298.89}
   ```
   `bootId` **changes on every DSH start** → the primary restart-evidence source.
2. **Legacy controller** (`dsh-lifecycle`): `GET http://127.0.0.1:3081/api/status`
   ```json
   {"state":"running","running":true,"bootId":"dsh-...","pid":35116,"uptime":...,"instanceId":"dsh-...-6a18"}
   ```
   Lifecycle actions are requested by **writing marker files under `logs/`**:
   `restart.requested`, `stop.requested`, `start.requested`. The external watchdog
   consumes them. Controller never kills processes itself.
3. **DSH RPC gateway**: `POST http://127.0.0.1:3080/api/session.list`
   request `{"type":"client-request","rpcId":"...","method":"session.list","payload":{}}`
   response `{"type":"server-response","rpcId":"...","result":{"ok":true,"value":{"items":[...]}}}`
   Other methods: `session.history`, `session.export`, `session.cancel`, `session.fork`, `workspace.list`.
4. **Served web page** leaks `window.__DSH_BOOT__` with `rev` (a build revision, **not** per-boot).

### 2.1 What this corrects

Earlier drafts assumed an invented `/__dsh/control/fingerprint` endpoint. That
path **does not exist**. The protocol probe shall use the real services above.
A "generic HTTP 200 is not DSH" guard stays: the health schema
(`ok`+`ready`+`bootId`+`pid`) and the RPC envelope are the discriminators.

## 3. Architecture

```
Electron Shell / Control Surface (renderer: no fs/process/child_process)
        │  authenticated IPC (allow-list) + hello handshake
        ▼
   Supervisor  (single instance, journal-authoritative)
   ├─ RuntimeDiscovery        → probes 3080 health + 3081 controller status
   ├─ InstanceIdentity        → strong/weak/none from pid+startTime+cmd+bootId+profile
   ├─ Ownership               → legacy | managed | delegated | observe-only
   ├─ LegacyWatchdogAdapter   → dry-run / marker request / restart FSM / external-restart watch
   ├─ SnapshotStore           → atomic JSON, last-good, sensitive-field scan
   ├─ QuotaAdapter            → trusted provider endpoint only (see dsh-quota-panel pattern)
   ├─ UpdateProvider          → pinned deepseek-ai/deepseek-harness, tag/commit/version verify
   └─ Diagnostics             → PASS|WARN|FAIL|UNKNOWN across all subsystems
```

## 4. Execution order (strict) and gates

### Phase 1 — Repository & base contracts (no real lifecycle code)

1. Bootstrap monorepo (done: `@dsh-control-center/*`, pnpm workspace, TypeScript strict,
   Zod, Vitest).
2. `control-contract` — all schemas (done): `RuntimeDescriptor`, `InstanceIdentity`,
   `RuntimeSnapshot`, `LifecycleOperation`, `SurfaceSnapshot`, `ControlHello`,
   `Ownership`, `InstallOrigin`, `InstallAuthority`, `CapabilitySet`,
   `DiagnosticSummary`, `QuotaSnapshot`, `UpdateCandidate`, `CompatibilityResult`,
   `RuntimeManifest`.
3. Fake DSH Runtime (done, must now mirror real surface: health + RPC + controller).
4. `operations.jsonl` Journal (done) + atomic JSON Snapshot Store (done).

**Gate: Checkpoint A** (all must pass before Electron destructive buttons / real lifecycle):
- Contract schema tests
- Fake Runtime tests
- Journal recovery tests
- Idempotency (operationId + idempotencyKey + single mutation lease)
- Identity negative tests (HTTP 200 non-DSH rejected; bootId reused is not a restart)
- Ownership negative tests
- Crash reconciliation (supervisor restores unfinished operations)
- External restart detection (bootId change observed without our request)
- Sensitive-field scan (snapshot redaction)

### Phase 2 — Supervisor core

Order: single-instance lock → supervisorInstanceId → load config → recover journal →
rebuild unfinished operations → RuntimeDiscovery → LegacyWatchdogAdapter →
SnapshotStore → QuotaAdapter → UpdateProvider → reconcile → IPC server → low-frequency observer.

Rules:
- `operations.jsonl` is the **only authoritative** record; `current-operation.json` is a derived cache.
- Every mutation has `operationId` + `idempotencyKey`; one mutation lease at a time.
- `marker`, `3080`, `3081`, PowerShell parameters exist **only inside the Legacy Adapter**.
- UI / control contract never see those implementation details.

### Phase 3 — Runtime identity & legacy lifecycle

- `RuntimeDiscovery` over real surfaces (health + controller status).
- `IdentityStrength: strong | weak | none`:
  - **strong**: pid + process start time + command fingerprint + bootId + profile, all present and self-consistent.
  - **weak**: protocol-visible evidence only.
  - **none**: nothing usable.
- Restart success requires **all** of:
  ```
  ready === true
  identity.strength === strong
  newIdentity.value !== oldIdentity.value
  profile matches
  operation lease still valid (not superseded)
  ```
- When strong identity is unavailable, the UI shows only
  *"DSH responded but the new instance could not be confirmed"* — never a green success.

## 5. Data, quota, diagnostics

### Snapshot Store
Stores only **redacted** `SurfaceSnapshot`: runtime state, ≤5 recent sessions,
recent quota, diagnostics summary, versions/schema/timestamps/expiry.

Write: `temp → flush → fsync → atomic rename → keep last-good`.

**Never persisted:** prompts, assistant body, tool arguments, shell commands,
file contents, credentials, cookies, full session logs.

### Quota Adapter
Fixed pipeline: `credential resolve → trusted endpoint → timeout/body cap →
content-type check → JSON parse → schema validation → normalize → QuotaSnapshot`.
No arbitrary URLs; raw upstream response never reaches the renderer.

### Sessions
Use the verified official `session.list` RPC only. When sessions aren't available,
show redacted offline records; never parse `session.jsonl.zstd`; never show a
misleading "open" button.

## 6. Updates & rollback

- Repository pinned to `deepseek-ai/deepseek-harness` (not user-editable).
  Dev-mode custom repos are flagged **UNTRUSTED DEVELOPMENT SOURCE**.
- Version acceptance: `dsh-v<semver>` tag OR official release metadata; verify
  `tag → commit → package.json → version match`. Never treat `master`/HEAD as a release.
- Staging at `%LOCALAPPDATA%\DSHControlCenter\runtimes\staging\`; never modify the
  live install in place.
- Bundled toolchain (node/pnpm/helper) called by absolute path — no PATH dependency.
- Compatibility probe uses temp `DSH_HOME`, temp ports, staged runtime, read-only
  probes (`session.list`, projection, deep-link), Node/pnpm version check
  (`node ^22.19.0 || >=24.0.0`, `pnpm 11.7.0` for DSH).
- One-click update only when ALL hold:
  `verifiedOfficialSource`, required checks PASS, `installAuthority === mutable`,
  `ownership === legacy`, no other lifecycle operation in flight.
- Rollback on any failure: stop new runtime → restore old → restart → verify old identity/version/profile.

## 7. Desktop shell, testing, release

- Surface home shows five sections: DSH Runtime, Official Update, Recent Sessions,
  Quota, Diagnostics — every one with freshness (`LIVE` / `3 秒前` / `STALE · 12 分钟前` / `UNKNOWN`).
- Electron responsibilities only: window, tray, preload, notification, IPC,
  installer, protocol. Security: `sandbox=true`, `contextIsolation=true`,
  `nodeIntegration=false`, strict CSP, IPC allow-list, no arbitrary navigation,
  no fs/process/child_process in renderer.
- Closing the window / quitting Electron leaves Supervisor and DSH running by default.
- **Checkpoint B (Update Gate)** and **Checkpoint C (Desktop Pilot Gate)** listed in
  `docs/CHECKPOINTS.md`.

## 8. Release artifacts

```
DSH-Control-Center-Setup-x.y.z.exe
DSH-Control-Center-Portable-x.y.z.exe
SHA256SUMS.txt
```

Repository topics: `dsh-plugin`, `deepseek-harness`, `deepseek`, `control-center`.

Pre-release: secret scan, path scan, license scan, CI, Windows E2E, installer
smoke test, artifact hashes, README, release notes. Without a code-signing
certificate every artifact is marked **Unsigned Pilot Build**.

## 9. Issue order

First wave (Checkpoint A then review): `#1` bootstrap → `#2` control contract →
`#3` fake runtime → `#4` operation journal → `#5` supervisor bootstrap →
`#6` runtime discovery → `#7` instance identity → `#8` ownership →
`#9` legacy watchdog adapter → `#10` restart FSM → `#11` crash reconciliation →
**Checkpoint A**.
Then: `#12–#16` snapshot/quota/diagnostics/sessions, `#17–#22` updates/staging/
compatibility/rollback, `#23–#26` surface/IPC/Electron/installer,
`#27–#28` security gate / public release.

## 10. Completion criteria (V1.1)

- Control Center remains usable after DSH stops.
- A non-DSH HTTP 200 is never identified as DSH.
- Restart is idempotent and recoverable.
- An external owner is never killed by Control Center.
- Quota and snapshot never leak sensitive data.
- Official releases are verifiable; update compatibility preflight works.
- Failed updates auto-rollback.
- Electron renderer has no privileged capability.
- Windows install does not depend on user Node/npm/pnpm.
- The three legacy repos remain unmodified.