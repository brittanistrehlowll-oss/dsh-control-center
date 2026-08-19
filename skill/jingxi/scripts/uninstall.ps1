# uninstall.ps1 — 卸载鲸息（jingxi Skill 动作之一）
#
# 只删除 manifest.json 登记的文件；DSH 数据、设置、会话、官方文件一律不动。
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $DshHome) { $DshHome = "D:\CodexD\DSH\home" }

Write-Host "[jingxi uninstall] 开始卸载…" -ForegroundColor Cyan

$jxHome = Join-Path $DshHome 'jingxi'
$manifestPath = Join-Path $jxHome 'manifest.json'

if (-not (Test-Path $manifestPath)) {
  Write-Warning "manifest 不存在: $manifestPath（可能未安装或已卸载）"
  # 仍尝试清理已知位置
  $jxHome = Join-Path $DshHome 'jingxi'
  if (Test-Path $jxHome) {
    if ($Force) {
      Remove-Item $jxHome -Recurse -Force
      Write-Host "  已删除 $jxHome（Force）"
    } else {
      Write-Warning "发现 $jxHome 但无 manifest，未删除。加 -Force 才删。"
    }
  }
  Write-Host "uninstall 结束（无 manifest 路径）"
  exit 0
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "  manifest: name=$($manifest.name) version=$($manifest.version) files=$($manifest.files.Count)"

# 1. 删除 manifest 登记的文件
foreach ($rel in $manifest.files) {
  $target = Join-Path $jxHome ($rel -replace '/', '\')
  if (Test-Path $target) {
    Remove-Item $target -Force
    Write-Host "  已删除: $rel"
  }
}

# 2. 移除 web profile 插件条目（若存在）
$patchPath = Join-Path $DshHome 'profiles\web\cordis.patch.yml'
if (Test-Path $patchPath) {
  $patch = Get-Content $patchPath -Raw
  if ($patch -match 'jingxi') {
    $lines = $patch -split "`n" | Where-Object { $_ -notmatch 'jingxi' }
    Set-Content -Path $patchPath -Value ($lines -join "`n") -Encoding UTF8
    Write-Host "  已从 cordis.patch.yml 移除 jingxi 条目"
  }
}

# 3. 删除 jingxi-home（manifest 已删，剩余目录为空壳）
Remove-Item $jxHome -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  已删除 JINGXI_HOME: $jxHome"

# 4. 移除 Skill 本身（可选，默认保留以便重新安装）
Write-Host "  Skill bundle 保留在 $DshHome\skills\jingxi（如需彻底移除请手动删除）"

Write-Host ""
Write-Host "uninstall 完成。DSH 数据/设置/会话未受影响。若插件代码已加载，重启 DSH web 后完全移除。", "Green"