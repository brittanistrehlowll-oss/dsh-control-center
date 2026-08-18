# DSH Control Center 项目规则

## 范围

这是独立的 dsh-control-center 项目。不得修改 D:/CodexD/DSH、三个旧插件仓库或其运行态。

V1.1 只使用 LegacyWatchdogAdapter 作为外部 DSH owner。禁止实现或调用直接杀进程、ForceRestart、Stop-Process、taskkill 或任意端口接管。

## 真实环境门禁

第一轮只允许 read-only discovery、DSH protocol fingerprint、ownership 判断和 Legacy Adapter dry-run。当前 Codex 会话内不得停止或重启真实 DSH。

## 代码约束

- operations.jsonl 是操作事实源；派生 JSON 不得反向覆盖 Journal。
- 所有 mutation 带 operationId、idempotencyKey 和 lease。
- renderer 不接触文件系统、凭据、进程 API 或原始上游响应。
- 不把 prompt、assistant 正文、tool arguments、shell command、文件内容、cookie 或 credential 写入快照和日志。
- 3080、3081、marker、PowerShell 参数只能出现在 Legacy Adapter 内部。
- 修改先写测试，再实现；每个切片必须有可复现的验证命令。

## 交付

公开发布前执行 secret scan、path scan、license scan、完整测试、Windows E2E、安装包 smoke test 和 SHA-256 计算。未签名产物必须标为 Unsigned Pilot Build。
