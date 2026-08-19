# 鲸息运行时架构（jingxi）

```
用户（DSH 页面 / 浏览器 / 未来 EXE）
      │
      ▼
Jingxi Plugin（packages/jingxi-plugin，注入 DSH web）
  ├─ SidebarDock：额度摘要 + [重启 | 鲸息 | 关闭]（full/mid/rail）
  ├─ 鲸息单页控制台（/jingxi）
  └─ WhaleBreathIcon（currentColor，官方 FishLogo 几何 + 喷水线）
      │  只请求动作，不执行任何进程操作
      ▼
Jingxi Host（runtime/jingxi-host，127.0.0.1:3081，loopback only）
  ├─ GET /api/status /api/version /api/update/status /api/logs
  ├─ POST /api/start /api/stop /api/restart   （写 marker，不 kill）
  ├─ POST /api/update/check /api/update/apply （受控 Update Core 执行）
  └─ DSH 已关闭时的离线页（一键启动）
      │  写 marker
      ▼
Guardian（runtime/guardian，Start-Jingxi-Guardian.ps1，唯一生命周期 owner）
  ├─ Fast Path 500ms：消费 restart/stop/start.requested
  ├─ Slow Path 10–15s：DSH 被动宕机 / Host 存活 / crash loop
  └─ 单实例（mutex/lock）
      │
      ▼
DSH 进程（Guardian 唯一负责启动/停止/重启）
```

## 模块

| 模块 | 路径 | 来源 donor |
|---|---|---|
| Jingxi Plugin | `packages/jingxi-plugin/` | dsh-lifecycle UI + dsh-quota-panel |
| Update Core | `packages/update-core/` | dsh-control-center `update-provider` |
| contracts | `packages/contracts/` | 新（契约优先） |
| Jingxi Host | `runtime/jingxi-host/` | dsh-lifecycle `dsh-controller.mjs` |
| Guardian | `runtime/guardian/` | dsh-lifecycle `Start-DSH-Watchdog.ps1` |

## 所有权与安全边界

- JINGXI_HOME = `$DSH_HOME/jingxi/`（bin/state/logs/backups/manifest.json/config.json）
- marker 在 `state/`；日志拆分 guardian.log / host.log / install.log / jingxi-update.log / dsh-update.log
- 浏览器/插件只能请求动作；Host 验证并写 marker；Guardian 唯一消费 marker
- Host loopback only + Host header 校验 + CSRF nonce + 无 CORS `*`
- API key 只在 host 侧；session/model UI 不显示 secrets
- 更新只认 `deepseek-ai/deepseek-harness` 官方 `dsh-v<semver>` tag 链；未知来源 fail-closed
