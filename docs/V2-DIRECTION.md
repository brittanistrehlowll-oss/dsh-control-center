# V2 Direction — 薄安装层 / meta-package（当前权威基线）

> 来源：Google Drive `00_FINAL_READ_FIRST｜DSH小品级控制插件最终实施方案｜20260819-V2`
> 状态：**FINAL / AUTHORITATIVE**（2026-08-19）
> 本文件取代 V1 的 "Supervisor-first Control Plane / Monitoring Center" 方向。

## 一、V2 产品定位

**一句话**：DSH Control Center 不再是一个独立监控后台，而是：

> 一个嵌入 DSH 左下角的轻量生命周期 + 额度小插件，以及 DSH 关闭后的极简启动页 ——
> 由 **dsh-lifecycle + dsh-quota-panel** 承担运行时职责；
> **本仓库（dsh-control-center）只做薄整合/安装层**。

用户只感知三件事：
1. **我还有多少额度**；
2. **我可以快速重启 / 关闭 DSH**；
3. **DSH 关闭后，我始终有一个漂亮、稳定的页面可以把它重新打开**。

任何新功能若不能直接改善这三件事之一，**V2 不加**。

## 二、运行时架构（由两个插件仓库承担）

```
DSH Web :3080
  ├─ dsh-quota-panel
  │    ├─ /api/quota/deepseek · /api/quota/opencode-go
  │    └─ quota UI（capsule 折叠 / 卡片展开）
  └─ dsh-lifecycle
       ├─ 左下角控制条  [ ¥8.98 97% ▾ │ ⟳ 重启 │ ⏻ 关闭 ]
       ├─ restart / stop 确认 + takeover overlay
       └─ bootId 真重启检测 + last URL 恢复

独立 Controller :3081
  ├─ GET /        → 极简静态启动页（DSH 已关闭 + 启动按钮）
  ├─ GET /api/status
  └─ POST /api/start

Watchdog
  ├─ restart.requested / stop.requested / start.requested
  └─ 低频轮询，真正执行进程生命周期
```

V2 主要开发工作集中在 **dsh-lifecycle**；dsh-quota-panel 保留并只加一个稳定 seam
（`window.__DSH_QUOTA_PANEL__ = { mountInto, toggle, refresh, getSummary }`）。

## 三、本仓库（dsh-control-center）的 V2 职责

**薄整合层 / 安装层（meta-package）**，形态 A（最优）：

```
检测 DSH 安装
  → 安装 dsh-quota-panel
  → 安装 dsh-lifecycle
  → 写统一配置（profile patch / 额度刷新间隔 / 显示开关）
  → 安装并启动 Watchdog
  → 升级 / 卸载 / 健康检查
```

交付物（Node CLI + PowerShell，不建设 GUI installer）：

- `install`     — 检测 + 安装两个插件 + 配置 + watchdog
- `upgrade`     — 升级两个插件 + watchdog
- `uninstall`   — 卸载两个插件 + 移除配置 + 停 watchdog
- `healthcheck` — 检测 Controller :3081 / DSH :3080 / marker / watchdog 状态

## 四、明确冻结（不再扩张）

以下内容在 V2 **不作为 UI 依赖、不继续扩张**（代码保留为 research/实验）：

- Monitoring Center 页面 / 多页导航 / Runtime Overview 大卡
- Telemetry Timeline / Diagnostics Dashboard / SurfaceSnapshot UI
- Electron Control Surface / 独立 React/Vite Dashboard
- Operation Journal 可视化 / Ownership 可视化 / 多 provider 运营面板
- 为最近会话引入数据库（最近会话 = P2 Optional，仅当零新基础设施）
- Supervisor 大型状态机作为 UI 依赖

## 五、V2 实施顺序（本仓库只参与 Phase 4）

| Phase | 内容 | 承担仓库 |
|---|---|---|
| 1 | 左下角控制条做精（quota capsule + Restart + Stop 统一） | dsh-lifecycle / dsh-quota-panel |
| 2 | 关闭后的极简静态页（FishLogo + token，Start 后恢复 last URL） | dsh-lifecycle |
| 3 | 收敛确认交互（Restart/Stop confirm + takeover overlay） | dsh-lifecycle |
| **4** | **薄安装层（一键安装/升级/卸载 + 检测）** | **dsh-control-center（本仓库）** |
| 5 | 可选最近会话（仅零基础设施） | dsh-lifecycle |

## 六、验收标准（V2）

- 正常运行时用户只看到左下角一小块控件；light/dark 与 DSH 融合；125%/150% 缩放可用
- Restart：点击 → 确认 → overlay → 新 bootId → ready → 自动恢复；旧实例 200 不误判
- Stop：点击 → 确认 → **先进入 :3081** → DSH 停止；无 ERR_CONNECTION_REFUSED 白屏
- Start：静态页一键启动；防重复点击；ready 后自动回 `localStorage.dsh_lastUrl`
- Quota：API key 不落浏览器；hidden 时暂停刷新；单 provider 失败不拖垮其他
- 安全：Controller 只监听 127.0.0.1；页面不直接执行 shell；生命周期仍走 marker/watchdog；不记录 credential / prompt / assistant 正文 / tool arguments
- 性能：不引入 React/Electron/数据库；Controller 静态页零外部 CDN；额度刷新 30–60s

## 七、本地执行纪律

- 不从旧 Monitoring Center 方案继续开发
- 不先重构仓库；先最小 patch
- 每完成一个 Phase 截图 light/dark 两套
- 每个生命周期操作做真实本机 smoke test（**但不得在 Codex 会话内真实 stop/restart DSH** —— 只允许 dry-run/检测）
- 保留现有 marker/watchdog 安全边界