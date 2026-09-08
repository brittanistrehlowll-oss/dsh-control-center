---
name: jingxi
description: 安装、升级、诊断、打开和卸载鲸息（DeepSeek Harness 的轻量伴生插件：侧栏鲸鱼入口直达呼吸轨迹）
disable-model-invocation: true
user-invocable: true
jingxiVersion: 1.0.1
---

# jingxi — 鲸息

鲸息（jingxi）V1.0.1（Pure Breath）是 DeepSeek Harness 的轻量伴生插件：
侧边栏一个鲸鱼入口，**点击直达呼吸轨迹浮层**——只呈现基础调用事实
（轮次/步数、Token、时长、Cache 命中、速度）与呼吸曲线（事件刻度、Event
Rail、最近 5 轮、阶段故事）。计费/额度、中间面板、侧栏快捷操作行与版本行
均已移除；DSH 更新检查在设置区「诊断与修复」中只读呈现。

本 Skill 只负责**安装 / 升级 / 诊断 / 打开 / 卸载**鲸息运行时，本身不承载 UI 或
长期运行的服务（Skill 不是 runtime）。

## 动作（仅这 5 个）

| 动作 | 命令 | 说明 |
|---|---|---|
| 安装鲸息 | 运行 `scripts/install.ps1` | 部署 dsh-jingxi 插件包到 `profiles/node_modules/dsh-jingxi` 并注入 cordis 插件行；幂等 |
| 打开鲸息 | 运行 `scripts/open.ps1` | 打开鲸息页面（DSH 内或 Jingxi Host 离线页） |
| 升级鲸息 | 运行 `scripts/update.ps1` | 更新鲸息自身（**不是**更新 DSH） |
| 诊断鲸息 | 运行 `scripts/doctor.ps1` | 检查 DSH / Host / Guardian / 插件 / 更新能力 |
| 卸载鲸息 | 运行 `scripts/uninstall.ps1` | 按 manifest 删除鲸息拥有的文件；不删 DSH 数据 |

## 执行规则

- 每次只执行一个动作；用户未明确要求时不得运行 install/uninstall/update。
- 先运行 `scripts/doctor.ps1` 再执行其他动作，除非用户直接指定。
- 所有脚本须以用户身份运行（不需要管理员，除非 doctor 明确提示）。
- 不得修改 DSH 官方源码、不得直接 kill DSH 进程、不得写未知文件。
- 「升级鲸息」与「检查 DSH 更新」是两件不同的事：
  - `update.ps1` 只更新鲸息自身；
  - DSH 官方更新在鲸息设置区「诊断与修复」中只读检查（针对
    deepseek-ai/deepseek-harness 官方发布），界面不提供更新/重启按钮。

## 参考

- `references/architecture.md` — 鲸息运行时架构（Plugin / Host / Guardian / Update Core）
- `references/troubleshooting.md` — 常见问题

## 卸载承诺

`uninstall.ps1` 只删除 `manifest.json` 中登记的文件；DSH 数据、设置、会话不受影响。
