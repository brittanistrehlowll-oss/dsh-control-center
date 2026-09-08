# jingxi-plugin — DEPRECATED（已废弃）

本目录是鲸息早期原型（sidebar dock + 单页控制台 + 离线 Host 时代）的遗留源码，
**自 V1.0.1（Pure Breath）起不再是发布产物**。

现行实现位于 [`../dsh-jingxi`](../dsh-jingxi)：

- DSH 插件形态（`sidebar.footer.action` + `shell.overlay` + `settings.section`）；
- 侧栏鲸鱼入口点击直达呼吸轨迹浮层（基础调用事实 + 呼吸曲线）；
- 计费/额度、中间面板、快捷操作行、版本行均已移除；
- DSH 更新检查在设置区「诊断与修复」中只读呈现。

本目录保留仅为历史回溯（`src/` 下 4 个原型文件不再构建、不再部署、不再维护）。
请勿在此目录新增代码；一切鲸息演进请在 `packages/dsh-jingxi` 进行。
