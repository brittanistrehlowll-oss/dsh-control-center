# doctor.ps1 — 鲸息 V3.0 诊断（jingxi Skill 动作之一）
#
# 检查项：DSH / Jingxi Host / Guardian / 插件注册 / 更新能力。
# 只读诊断：不做任何修改。
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME
)

$ErrorActionPreference = 'Continue'

function Section($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [PASS] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Info($m) { Write-Host "  [info] $m" -ForegroundColor Gray }

# ———— DSH 定位 ————
if (-not $DshHome) { $DshHome = "D:\CodexD\DSH\home" }
Section "DSH"
if (Test-Path $DshHome) {
  Ok "DSH_HOME = $DshHome"
  $profiles = Join-Path $DshHome 'profiles'
  if (Test-Path $profiles) {
    $names = (Get-ChildItem $profiles -Directory | Select-Object -ExpandProperty Name) -join ', '
    Info "profiles: $names"
  }
} else {
  Fail "DSH_HOME 不存在: $DshHome"
}

# ———— DSH 运行状态 ————
Section "DSH Runtime"
try {
  $h = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/system/health' -TimeoutSec 4
  if ($h.ready) {
    Ok "DSH ready (bootId=$($h.bootId), pid=$($h.pid))"
  } else {
    Warn "DSH 可达但未 ready"
  }
} catch {
  Warn "DSH :3080 不可达（可能已关闭，正常）"
}

# ———— Jingxi Host ————
Section "Jingxi Host (:3081)"
try {
  $s = Invoke-RestMethod -Uri 'http://127.0.0.1:3081/api/status' -TimeoutSec 4
  Ok "Host 响应: state=$($s.state)"
} catch {
  Fail "Jingxi Host :3081 不可达（需要 install 部署）"
}

# ———— Guardian ————
Section "Guardian"
$guardianLog = "$DshHome\jingxi\logs\guardian.log"
if (Test-Path $guardianLog) {
  Ok "guardian.log 存在 ($((Get-Item $guardianLog).Length) bytes)"
} else {
  Warn "guardian.log 不存在（Guardian 未运行或未部署）"
}
# legacy watchdog fallback
$wdLog = "D:\CodexD\DSH\logs\watchdog.log"
if (Test-Path $wdLog) { Info "legacy watchdog.log 存在（兼容期）" }

# ———— 插件注册 ————
Section "Plugin 注册"
$patch = Join-Path $DshHome 'profiles\web\cordis.patch.yml'
if (Test-Path $patch) {
  $content = Get-Content $patch -Raw
  if ($content -match 'jingxi') { Ok "web profile cordis.patch.yml 含 jingxi 条目" }
  else { Warn "web profile 未注册 jingxi 插件" }
} else {
  Warn "web profile cordis.patch.yml 不存在"
}

# ———— Skill ————
Section "Skill"
$skill = Join-Path $DshHome 'skills\jingxi\SKILL.md'
if (Test-Path $skill) { Ok "skill 已安装: $skill" }
else { Fail "skill 未安装（先运行 bootstrap/Install-JingxiSkill.ps1）" }

# ———— 更新能力 ————
Section "更新能力"
$dshPkg = 'D:\CodexD\DSH\node_modules\@deepseek-ai\dsh\package.json'
if (Test-Path $dshPkg) {
  $v = (Get-Content $dshPkg -Raw | ConvertFrom-Json).version
  Ok "DSH 版本: $v"
  Info "安装来源: local node_modules（pnpm workspace）→ update executor 待 Gate 7 验证"
} else {
  Warn "无法定位 DSH package.json"
}

Write-Host ""
Write-Host "doctor 完成。"