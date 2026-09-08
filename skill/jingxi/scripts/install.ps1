# install.ps1 — 鲸息 V3.0 安装（jingxi Skill 动作之一）
#
# 部署：Jingxi Plugin（web profile 注册）+ Jingxi Host + Guardian + JINGXI_HOME
#       + jingxi-open 入口。
# 幂等：重复运行不产生重复条目/重复服务/重复配置。
# 安全：不修改 DSH 官方源码；不 kill 进程；不覆盖未知用户文件；不启动更新。
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME,
  [switch]$SkipDoctor
)

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "[jingxi install] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }

# ———— 0. 定位 ————
if (-not $DshHome) { $DshHome = "C:\Users\wx\.dsh" }
if (-not (Test-Path $DshHome)) { throw "DSH_HOME 不存在: $DshHome" }
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))   # scripts -> jingxi -> skill -> repo root
Step "DSH_HOME = $DshHome"
Step "REPO ROOT = $repoRoot"

# ———— 1. JINGXI_HOME + manifest ————
$jxHome = Join-Path $DshHome 'jingxi'
foreach ($d in 'bin','state','logs','backups') {
  New-Item -ItemType Directory -Force -Path (Join-Path $jxHome $d) | Out-Null
}
$manifestPath = Join-Path $jxHome 'manifest.json'
$manifest = @{
  name = 'jingxi'
  version = '1.0.1'
  installedAt = (Get-Date -Format o)
  source = 'skill/jingxi'
  files = @()
} 
if (Test-Path $manifestPath) {
  $old = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($old.version -eq $manifest.version) { Warn "manifest 已存在且版本一致（幂等安装，继续）" }
  else { Warn "manifest 版本不同 ($($old.version) -> $($manifest.version))，继续升级式安装" }
}
Step "JINGXI_HOME = $jxHome"

# ———— 2. Guardian 部署（donor: Start-DSH-Watchdog.ps1 → Start-Jingxi-Guardian.ps1） ————
$guardianSrc = Join-Path $repoRoot 'runtime\guardian\Start-Jingxi-Guardian.ps1'
if (Test-Path $guardianSrc) {
  Copy-Item $guardianSrc (Join-Path $jxHome 'bin\Start-Jingxi-Guardian.ps1') -Force
  $manifest.files += 'bin/Start-Jingxi-Guardian.ps1'
  Ok "Guardian 脚本已部署"
} else {
  Warn "runtime/guardian/Start-Jingxi-Guardian.ps1 不存在（跳过，后续 Gate 补齐）"
}

# ———— 3. Jingxi Host 部署 ————
$hostSrc = Join-Path $repoRoot 'runtime\jingxi-host\jingxi-host.mjs'
if (Test-Path $hostSrc) {
  Copy-Item $hostSrc (Join-Path $jxHome 'bin\jingxi-host.mjs') -Force
  $manifest.files += 'bin/jingxi-host.mjs'
  Ok "Jingxi Host 已部署"
} else {
  Warn "runtime/jingxi-host/jingxi-host.mjs 不存在（跳过，后续 Gate 补齐）"
}

# ———— 4. dsh-jingxi V1.0.1 包部署（profiles/node_modules）+ 注册 ————
$pkgSrc = Join-Path $repoRoot 'packages\dsh-jingxi'
$pkgDst = Join-Path $DshHome 'profiles\node_modules\dsh-jingxi'
if (Test-Path $pkgSrc) {
  New-Item -ItemType Directory -Force -Path $pkgDst | Out-Null
  robocopy $pkgSrc $pkgDst /MIR /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy 部署 dsh-jingxi 失败（exit $LASTEXITCODE）" }
  $manifest.files += 'profiles/node_modules/dsh-jingxi（包式部署，卸载时整目录移除）'
  Ok "dsh-jingxi V1.0.1 包已部署（profiles/node_modules/dsh-jingxi）"
} else {
  Warn "packages/dsh-jingxi 不存在（跳过包部署）"
}
$profileDir = Join-Path $DshHome 'profiles\web'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
if (Test-Path $patchPath) {
  $patch = Get-Content $patchPath -Raw
  if ($patch -match 'name:\s*dsh-jingxi') {
    Ok "web profile 已注册 dsh-jingxi（幂等）"
  } else {
    $patch += "`n# dsh-jingxi V1.0.1 Pure Breath (installed by jingxi skill)`n- insert:`n    - id: jingxi`n      name: dsh-jingxi`n      inject: [webServer]`n"
    Set-Content -Path $patchPath -Value $patch -Encoding UTF8
    Ok "cordis.patch.yml 已写入 dsh-jingxi 包式行（inject: [webServer]）"
  }
} else {
  Warn "web profile cordis.patch.yml 不存在（跳过插件注册）"
}

# ———— 5. jingxi-open 入口 ————
$openScript = Join-Path $jxHome 'bin\jingxi-open.ps1'
@"
# jingxi-open — 打开鲸息（DSH 内优先，否则 Jingxi Host 离线页）
`$url = 'http://127.0.0.1:3080/jingxi'
try { `$r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/system/health' -TimeoutSec 2 -UseBasicParsing; if (`$r.StatusCode -ne 200) { `$url = 'http://127.0.0.1:3081/' } } catch { `$url = 'http://127.0.0.1:3081/' }
Start-Process `$url
"@ | Set-Content -Path $openScript -Encoding UTF8
$manifest.files += 'bin/jingxi-open.ps1'
Ok "jingxi-open 入口已创建"

# ———— 6. 保存 manifest ————
$manifest.files = @($manifest.files | Sort-Object -Unique)
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8
Ok "manifest 已保存 ($($manifest.files.Count) 个文件)"

# ———— 7. doctor ————
if (-not $SkipDoctor) {
  Step "运行 doctor…"
  & (Join-Path $PSScriptRoot 'doctor.ps1') -DshHome $DshHome
}

Write-Host ""
Write-Host "install 完成。插件生效需重启 DSH web（外部 Guardian/watchdog 处理，绝不在会话内直接重启）。"
Write-Host "Jingxi Host URL: http://127.0.0.1:3081/   jingxi-open: $openScript"