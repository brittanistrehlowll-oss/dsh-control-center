# Work Inventory — existing state as of 2026-08-18

This inventory records what already exists when V1.1 implementation starts, so
the plan can build on it instead of duplicating it. It covers (a) the current
`dsh-control-center` checkout, (b) the three legacy plugin repositories that
already shipped to `brittanistrehlowll-oss`, and (c) the verified DSH surface.

## 1. `dsh-control-center` checkout (current)

Monorepo: pnpm workspace, TypeScript strict (`exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`), Zod 3.25.76, Vitest 3.1.1, `node >=22.19.0`,
pnpm 11.19.0. Root scripts: `build`, `typecheck`, `lint`, `test`,
`test:contracts`, `test:integration`, `test:security`, `scan:secret`,
`scan:path`, `verify:contract`, `hash:artifacts`.

### Implemented packages

| Package | Content | Status |
|---|---|---|
| `@dsh-control-center/control-contract` | All V1.1 schemas: `RuntimeDescriptor`, `InstanceIdentity`, `RuntimeSnapshot`, `LifecycleOperation` (operationId/idempotencyKey/lease/stage/status), `OperationJournalEvent`, `SurfaceSnapshot` (≤5 sessions), `ControlHello` (protocolVersion/clientId/bootNonce/proof), `MutationRequest`, `UpdateCandidate` (pinned `deepseek-ai/deepseek-harness`, channel, verifiedOfficialSource), `CompatibilityResult`, `RuntimeManifest`, `DiagnosticSummary`, `QuotaSnapshot`, `Freshness`, `Ownership/InstallOrigin/InstallAuthority/CapabilitySet` | ✅ |
| `@dsh-control-center/operation-journal` | Append-only `operations.jsonl` (fsync on critical events), atomic JSON write (temp→flush→rename, EEXIST/EPERM retry), `current-operation.json` as derived cache, unfinished-operation reconstruction, JournalCorruptError | ✅ |
| `@dsh-control-center/runtime-discovery` | Probe + `InstanceIdentity` (strong/weak/none) + `Ownership` inference. **Reworked 2026-08-18 to the verified real DSH surface** (health, controller, RPC) | ✅ |
| `@dsh-control-center/snapshot-store` | Atomic save with **last-good fallback**, `assertSafeSurfaceSnapshot` defends against prompt/assistant/tool/cookie/auth/key/secret/credential/shell/command/transcript/raw-response/session-log keys | ✅ |
| `@dsh-control-center/security` | (scaffold only — package.json/tsconfig; implementation pending) | ⚠️ |
| `@dsh-control-center/diagnostics` | (scaffold only — pending) | ⚠️ |
| `@dsh-control-center/dsh-client` | (scaffold only — pending) | ⚠️ |
| `@dsh-control-center/supervisor-core` | (scaffold only — pending) | ⚠️ |
| `@dsh-control-center/update-provider` | (scaffold only — pending) | ⚠️ |
| `adapters/lifecycle/legacy-watchdog` | (scaffold only — pending) | ⚠️ |
| `tests/fake-runtime` | Fake DSH runtime. **Reworked 2026-08-18** to mirror real surface: `/api/system/health` with per-boot `bootId`, POST `/api/session.list` RPC, optional legacy controller surface at a second port | ✅ |

### Test coverage today

- `operation-journal`: durable append + reconstruction; terminal-status exclusion.
- `runtime-discovery`: non-DSH 200 rejected; health schema accepted; strong identity
  requires non-reusable evidence; boot change detection; ownership mapping.
- `snapshot-store`: atomic write + last-good fallback; prompt-like field rejection.
- `integration/fake-runtime`: identity across restarts; controller corroboration.

### Missing (this session's work)

- `packages/security` implementation (redaction helpers, secret detection, safe IPC framing).
- `packages/diagnostics` (PASS/WARN/FAIL/UNKNOWN builder across subsystems).
- `packages/dsh-client` (read-only RPC client with timeout/body/content-type caps).
- `packages/supervisor-core` (single-instance lock, config, journal recovery, reconcile, observer).
- `packages/update-provider` (pinned repo, tag→commit→version verification, compatibility preflight, rollback plan).
- `adapters/lifecycle/legacy-watchdog` (dry-run, marker request, restart FSM, external-restart watch,
  crash reconciliation; `3080/3081/marker/PowerShell` confined here).
- `apps/control-surface` (Electron shell scaffold; gated behind Checkpoint A).
- `scripts/` (`scan-sensitive.mjs`, `scan-paths.mjs`, `verify-contract.mjs`, `hash-artifacts.mjs`) —
  referenced by root scripts but not yet present.
- `.github/workflows/ci.yml`.

## 2. The three legacy plugin repositories (`brittanistrehlowll-oss`)

All three are live on GitHub under `brittanistrehlowll-oss`, MIT, English README
+ `README.zh.md`, zero-dependency host plugins for DSH.

| Repo | Contribution to Control Center |
|---|---|
| **dsh-lifecycle** | The **Legacy Watchdog** itself: `dsh-controller.mjs` on `127.0.0.1:3081` (status/start/stop/restart/logs API), marker files in DSH `logs/`, `Start-DSH-Watchdog.ps1`; per-boot `bootId` restart detection; independent launch page that works while DSH is down. **Control Center V1.1 treats this as the external owner and adapts to it — never replaces it.** |
| **dsh-quota-panel** | The **quota proxy pattern**: one server-side proxy route per provider; API key resolved through the credentials seam and never sent to the browser; auto-refresh, collapsed/expanded widget, battery colors. Control Center's QuotaAdapter follows the same trusted-endpoint discipline at the supervisor level. |
| **dsh-pet-shura** | Desktop-pet plugin; demonstrates the DSH plugin/injection model but is otherwise out of scope for V1.1 control plane. |

Known legacy conventions to keep: repo identity `<name>@users.noreply.github.com`,
branch `master` or `main`, `cordis.patch.yml`, `lib/`, `docs/`, `scripts/`,
bilingual READMEs.

## 3. Verified DSH surface (0.1.0-rc.7)

| Endpoint | Shape | Role |
|---|---|---|
| `GET :3080/api/system/health` | `{ok,ready,bootId,pid,uptime[,version,profileId]}` | DSH discriminator + restart evidence |
| `GET :3081/api/status` | `{state,running,bootId,pid,uptime,instanceId}` | Legacy controller state |
| `POST :3080/api/session.list` | RPC envelope → `{type:'server-response',rpcId,result:{ok,value:{items}}}` | Read-only sessions |
| `GET :3080/` | HTML with `window.__DSH_BOOT__.rev` (build rev, not per-boot) | Boot-leak check |

Requirements verified: Node `^22.19.0 || >=24.0.0` (local `24.19.0`), pnpm `11.7.0`
(local pnpm `11.19.0` satisfies `>=`), DSH `0.1.0-rc.7`, official release tag
`dsh-v0.1.0-rc.7`.

## 4. What "comprehensive optimization" changed (2026-08-18)

1. **Real protocol, not invented**: replaced the fabricated `/__dsh/control/fingerprint`
   probe with the verified health/controller/RPC surfaces. A non-DSH 200 response
   is rejected by schema, not by path guesswork.
2. **bootId is real restart evidence**: health endpoint reports a per-boot `bootId`;
   identity strength strong now requires it (plus pid/startTime/cmdFingerprint/profile).
3. **Fake runtime mirrors reality**: same surfaces, same envelope, so tests exercise
   the actual wire contract.
4. **Controller corroboration**: when `controllerUrl` is configured, identity evidence
   is cross-checked against the legacy controller — matching the real 3080+3081 setup.
5. **Strictness fixes**: `exactOptionalPropertyTypes` build errors in fake-runtime and
   runtime-discovery resolved; pnpm `allowBuilds` config corrected.