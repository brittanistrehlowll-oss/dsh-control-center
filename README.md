# DSH Control Center

**V2 定位（2026-08-19 起）：薄整合层 / meta-package（installer）** —— 不是独立监控后台。

V2 的运行时职责由两个插件仓库承担：**dsh-lifecycle**（左下角控制条：额度摘要 +
重启/关闭 + takeover overlay + 关闭后极简启动页 :3081）和 **dsh-quota-panel**
（额度 capsule/卡片）。本仓库只负责：

```
检测 DSH → 安装 dsh-quota-panel + dsh-lifecycle → 写统一配置
→ 安装/启动 Watchdog → 升级 / 卸载 / 健康检查
```

> 权威基线：`docs/V2-DIRECTION.md`（源自 Google Drive `00_FINAL_READ_FIRST｜20260819-V2`）。
> V1 的 "Supervisor-first Control Plane / Monitoring Center" 方向已降级为历史
> （代码保留作 research，不继续扩张，不以它为 UI 依赖）。

用户感知三件事：**① 我还有多少额度 ② 我能快速重启/关闭 DSH ③ DSH 关闭后我总有
一个稳定页面能重新打开它。**

## 历史保留（V1 research 代码）

V1 构建的 Supervisor / Contract / Snapshot / Diagnostics / SSE / 更新验签等代码
保留在本仓库 `packages/*`、`apps/supervisor` 中供研究，**不再扩张**。它们验证过
真实 DSH 协议（`/api/system/health` + bootId、`:3081` controller、RPC
`session.list`），对理解 DSH 运行时仍有价值。

## Non-goals (V2)

- 不建设 Monitoring Center / 多页控制台 / Diagnostics Dashboard
- 不建设 Electron 壳 / 独立 React Dashboard（作为产品）
- 不为最近会话引入数据库
- 不直接杀进程 / 不接管 DSH 生命周期（仍走 marker/watchdog）
- 不在 Codex 会话内真实 stop/restart DSH（只允许 dry-run/检测）

## Workspace

```
apps/supervisor            runnable supervisor entry (read-only first round)
apps/control-surface       gated Electron-shell placeholder (Checkpoint B/C)
packages/control-contract  all V1.1 Zod schemas (the contract)
packages/operation-journal append-only operations.jsonl + atomic JSON
packages/runtime-discovery real-surface probing + identity + ownership
packages/snapshot-store    atomic snapshots, last-good, sensitive scan
packages/security          redaction + secret detection
packages/diagnostics       PASS/WARN/FAIL/UNKNOWN across subsystems
packages/dsh-client        read-only RPC client (bounded, redacted)
packages/quota-adapter     fixed trusted-endpoint quota pipeline
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

## CI

The workflow file lives at `.github/workflows/ci.yml` in the source checkout
but is **not committed to this repository yet**: the publishing token lacks the
GitHub `workflow` scope (GitHub refuses PAT pushes that create/update workflow
files without it). To enable CI: add the file via a pull request made by an
account/token that has `workflow` scope, or grant the scope to the publishing
token. The workflow runs `pnpm build`, `pnpm test`, `verify:contract`,
`scan:secret`, `scan:path`, `hash:artifacts` on `windows-latest` + Node 24.

## Repository topics

`dsh-plugin`, `deepseek-harness`, `deepseek`, `control-center`

## License

MIT.