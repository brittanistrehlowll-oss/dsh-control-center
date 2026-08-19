# update.ps1 — 升级鲸息自身（jingxi Skill 动作之一）
#
# 重要：本脚本只更新「鲸息」自身（jingxi 包/仓库），与 DSH 官方更新是两件事。
# DSH 官方更新只在鲸息页面「检查 DSH 更新」中处理（deepseek-ai/deepseek-harness）。
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME,
  [string]$RepoPath = "D:\CodexD\dsh-control-center"   # 本地鲸息源仓库
)

$ErrorActionPreference = 'Stop'
if (-not $DshHome) { $DshHome = "D:\CodexD\DSH\home" }

Write-Host "[jingxi update] 开始升级鲸息自身…" -ForegroundColor Cyan

if (-not (Test-Path $RepoPath)) {
  throw "鲸息源仓库不存在: $RepoPath（暂不支持自动拉取，先手动更新源仓库）"
}

# 1. 拉取源仓库最新（仅当它是 git 仓库且远程可访问时）
$isGit = Test-Path (Join-Path $RepoPath '.git')
if ($isGit) {
  Write-Host "  源仓库: git 仓库，尝试 pull…"
  Push-Location $RepoPath
  try { git pull --ff-only 2>&1 | ForEach-Object { Write-Host "    $_" } }
  catch { Write-Warning "  pull 失败（可能无远程或离线），继续用当前源码" }
  Pop-Location
} else {
  Write-Warning "  源仓库不是 git 仓库，直接用当前源码"
}

# 2. 用最新源重新执行 install（幂等 = 升级）
Write-Host "  重新运行 install.ps1（幂等升级）…"
& (Join-Path $PSScriptRoot 'install.ps1') -DshHome $DshHome

Write-Host ""
Write-Host "[jingxi update] 完成。若插件代码变化，需重启 DSH web 生效（外部 Guardian 处理）。"
Write-Host "注意：这不是 DSH 官方更新。DSH 官方更新请使用鲸息页面「检查 DSH 更新」。", "Yellow"