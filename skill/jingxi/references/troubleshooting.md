# 鲸息 troubleshooting

## 安装后侧边栏没有鲸息

1. 运行 doctor.ps1，确认 `web profile cordis.patch.yml 含 jingxi 条目`。
2. 确认插件文件已部署：`$DSH_HOME/profiles/web/plugins/jingxi-plugin.mjs`。
3. 重启 DSH web（写 `restart.requested` marker 由外部 Guardian/watchdog 处理，
   不要在会话内直接重启）。
4. 若 cordis.patch.yml 有语法问题，检查 YAML 缩进（`- insert:` 下子项必须缩进）。

## DSH 关闭后打不开 3081

1. 确认 Jingxi Host 已部署并运行：`$DSH_HOME/jingxi/bin/jingxi-host.mjs`。
2. doctor 会显示 `Jingxi Host (:3081)` 状态；若 FAIL，先运行 install.ps1。
3. 确认 3081 未被未知进程占用；未知进程占用时 fail-closed，不自动 kill。

## 重启很慢 / 超过 5 秒

1. 重启目标是 marker fast path 500ms + health slow path 10–15s。
2. 确认 Guardian 在运行（guardian.log 在写）。
3. 检查是否有旧 watchdog 实例与 Guardian 同时消费 marker（应只保留一个 owner）。

## 额度不显示

1. 额度数据来自 quota adapter/store；先确认 DSH 页面原有 quota 面板正常。
2. rail 模式要求两个 provider 独立状态点 + 金额/百分比，禁止隐藏。

## 「检查 DSH 更新」与「升级鲸息」的区别

- 鲸息页面「检查 DSH 更新」→ 只针对 `deepseek-ai/deepseek-harness` 官方发布。
- Skill `update.ps1` → 只更新鲸息自身。
- doctor 分别报告 Jingxi Version 与 DSH Version。

## 更新被 blocked

- 安装来源 unknown / desktop-managed / source-checkout 有未提交修改 → 一律 blocked。
- 鲸息未验证的 DSH 版本 → 显示「有新版本但鲸息尚未验证兼容」，默认禁止 apply。
- 官方来源链（tag→commit→package.json version）不通过 → blocked。
