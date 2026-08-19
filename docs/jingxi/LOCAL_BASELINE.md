# LOCAL_BASELINE.md — 鲸息 V3.0 本地实施基线

日期：2026-08-19
生成者：本地 DSH / Codex（Gate 0）

## 一、DSH 安装基线（本机实证，非文档猜测）

| 项目 | 值 | 实证方式 |
|---|---|---|
| DSH 版本 | `0.1.0-rc.7` | `D:\CodexD\DSH\node_modules\@deepseek-ai\dsh\package.json` |
| DSH 安装来源 | **local node_modules（pnpm workspace）** | root `package.json` deps: `{"@deepseek-ai/dsh":"0.1.0-rc.7"}` |
| DSH 根目录 | `D:\CodexD\DSH` | — |
| DSH_HOME | **`D:\CodexD\DSH\home`**（env `DSH_HOME` 已设） | `$env:DSH_HOME` |
| 当前 profile | `web`（另有 pet-test / plugin-test） | `home/profiles/*` |
| profile 插件机制 | `cordis.patch.yml` `- insert:` + `plugins/` 目录 + `package.json` bundles | 实测 web profile |
| dsh CLI | 存在（`node_modules/.bin/dsh`） | — |
| Node | v24.19.0 | `node --version` |
| pnpm | 11.19.0 | `pnpm --version` |
| PowerShell | 7.6.4 | `$PSVersionTable` |
| web 端口 | 3080 | health 实测 |
| legacy controller 端口 | 3081（dsh-controller.mjs，运行中） | `/api/status` 实测 |

## 二、DSH 能力矩阵（CAPABILITY_MATRIX，本机实证）

| 能力 | 是否存在 | 实证结果 |
|---|---|---|
| `GET /api/system/health` | ✅ | `{ok,ready,bootId,pid,uptime}`；bootId 每次启动变化 |
| `POST /api/session.list`（RPC） | ✅ | 29 会话；字段：sessionId/updatedAt/running/blank/cwd/agentPreset/**projections** |
| projections.values 键 | ✅ | sessionStats/title/goal/tokenUsage/contextPressure/contextBreakdown/subagentTiming/subagent/permissions/sessionListMetadata/imageLimits/todos/plan |
| `llm.providers` RPC | ⚠️ 待确认 | POST /api/llm.providers 未验证（后续 Gate 实测） |
| settings.describe | ⚠️ 待确认 | 后续 Gate 实测 |
| theme tokens `--dsw-alias-*` | ✅ | 从 live CSS `index-CSGf6Qzd.css` 提取（bg-layer-1/2、text-primary/secondary/tertiary、border-subtle、bg-mask-1、shadow-1/2） |
| FishLogo 官方几何 | ⚠️ 未定位 | 页面 HTML 无静态 SVG（JS 动态渲染）；JS bundle 位置待查（后续 Gate） |
| plugin CLI | ✅ | `dsh plugin` bin 存在；web profile 用 cordis.patch + plugins/ |
| skills 目录 | ❌ 不存在 | `D:\CodexD\DSH\home\skills` 需创建 |
| marker 生命周期 | ✅ | `logs/restart.requested` + `Start-DSH-Watchdog.ps1`（watchdog 产品名，V3 要改名 Guardian） |

## 三、三个 donor 仓库 SHA（DONOR_SHA）

| donor | SHA | 本地路径 |
|---|---|---|
| dsh-lifecycle | `8637028ae7ae5f7aafbc5ada4969d42780d33de8` | `D:\deepseek\dsh-lifecycle` |
| dsh-quota-panel | `18cfc7f5b52bd1dfa2a6571376fa106b3973bacd` | `D:\deepseek\dsh-quota-panel` |
| dsh-pet-shura | `827ada7d7592cff902bbf4517b645981cab3e0da` | `D:\deepseek\dsh-pet-shura` |
| dsh-control-center（update-provider donor） | 当前 master（见该仓库 log） | `D:\CodexD\dsh-control-center` |

## 四、JINGXI_HOME 建议

HANDOFF 要求统一 ownership 边界。基于本机结构建议：

```
D:\CodexD\DSH\home\jingxi\
  bin/          （guardian/host 脚本）
  state/        （marker: restart/stop/start.requested）
  logs/         （guardian.log / host.log / install.log / jingxi-update.log / dsh-update.log）
  backups/
  manifest.json （安装版本、文件 hash、创建时间、来源）
  config.json
```

理由：`DSH_HOME`（`home/`）已存在且适合承载；`home/skills/jingxi` 放 Skill；
`home/jingxi` 放运行时。不覆盖 DSH 官方文件；uninstall 只删 manifest 拥有文件。

## 五、后续 Gate 待实证项

- FishLogo 官方 SVG 几何（从 JS bundle / DSH source 定位）
- llm.providers / settings.describe 的真实 RPC 座位
- 当前启动链是否有 user-level autostart 机制
- web profile 的真实 serve 根（静态资产从哪来）
- 当前版本 dsh plugin CLI 的真实子命令
