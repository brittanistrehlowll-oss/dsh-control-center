# Start-Jingxi-Guardian.ps1 — 鲸息 Guardian（生命周期唯一 owner）
#
# donor: dsh-lifecycle Start-DSH-Watchdog.ps1（V3.0 产品名 watchdog → Guardian）
#
# 职责：
#   Fast Path（500ms）：消费 restart.requested / stop.requested / start.requested
#   Slow Path（12s）：DSH 被动宕机检测 / Jingxi Host 存活 / crash loop / 旧 marker 清理
#
# 边界（继承 donor 安全模型）：
#   - Guardian 是唯一消费 marker、启动/停止/重启 DSH 的进程；
#   - Host/浏览器/插件只写 marker，绝不直接 kill DSH；
#   - Stop-DshByPort 只终止 3080 上命令行匹配 dsh.*lib[\\/]bin\.js 的监听进程，
#     绝不误杀 Guardian/Host/未知进程。
#
# 兼容期：
#   - 先读 guardian.pid/log；缺失时允许读 watchdog.pid/log（legacy fallback）；
#   - 新日志永远写 guardian.log。
#
# 用法：
#   pwsh -File runtime/guardian/Start-Jingxi-Guardian.ps1 [-DshRoot <dir>]
[CmdletBinding()]
param(
  [string]$DshRoot = $env:DSH_ROOT,
  [int]$Port = 3080,
  [int]$MarkerPollMs = 500,
  [int]$HealthIntervalSeconds = 12,
  [int]$CrashLoopMax = 3,
  [int]$CrashLoopWindowMinutes = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

if (-not $DshRoot) { $DshRoot = 'D:\CodexD\DSH' }
$home = Join-Path $DshRoot 'home'
$jxHome = Join-Path $home 'jingxi'
$statePath = Join-Path $jxHome 'state'
$logsPath  = Join-Path $jxHome 'logs'
$launcher  = Join-Path $DshRoot 'Start-DSH-Web-Detached.ps1'
$hostScript = Join-Path $jxHome 'bin\jingxi-host.mjs'

$requestFile = Join-Path $statePath 'restart.requested'
$stopFile    = Join-Path $statePath 'stop.requested'
$startFile   = Join-Path $statePath 'start.requested'

# legacy fallback：兼容期也检查旧 logs/ 位置
$legacyLogs  = Join-Path $DshRoot 'logs'
$legacyReq   = Join-Path $legacyLogs 'restart.requested'
$legacyStop  = Join-Path $legacyLogs 'stop.requested'
$legacyStart = Join-Path $legacyLogs 'start.requested'

$guardianLog = Join-Path $logsPath 'guardian.log'
$guardianPid = Join-Path $logsPath 'guardian.pid'
$hostPort = 3081
$url = "http://127.0.0.1:$Port/"

New-Item -ItemType Directory -Path $statePath,$logsPath -Force | Out-Null

# ———— 单实例锁 ————
$lockFile = Join-Path $statePath 'guardian.lock'
try {
  $fh = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $fh.SetLength(0)
  $sw = New-Object System.IO.StreamWriter($fh)
  $sw.Write("pid=$PID`nstartedAt=$(Get-Date -Format o)")
  $sw.Flush()
} catch {
  Write-Host "[guardian] 另一个 Guardian 实例已在运行（$lockFile 被占用），本实例退出。"
  exit 0
}

function Write-GuardianLog {
  param([string]$Message)
  $line = "{0} [guardian] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff K'), $Message
  Add-Content -LiteralPath $guardianLog -Value $line -Encoding utf8
  Write-Host $line
}

# ———— Jingxi Host 拉起（127.0.0.1:3081）————
function Start-JingxiHost {
  $listener = Get-NetTCPConnection -LocalPort $hostPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    # 已存在实例：连接现有实例（fail-closed 不 kill）
    return
  }
  if (-not (Test-Path -LiteralPath $hostScript)) {
    Write-GuardianLog "jingxi-host script not found: $hostScript"
    return
  }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Write-GuardianLog "node not found, cannot start jingxi-host"; return }
  try {
    Start-Process -FilePath $node -ArgumentList @($hostScript, "--dsh-root", $DshRoot) -WorkingDirectory $DshRoot -WindowStyle Hidden | Out-Null
    Write-GuardianLog "jingxi-host started on port $hostPort"
  } catch {
    Write-GuardianLog "failed to start jingxi-host: $_"
  }
}

# ———— 只在确认是 DSH 时停止（绝不误杀）————
function Stop-DshByPort {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.CommandLine -notmatch 'dsh.*lib[\\/]bin\.js') { return $false }
  Stop-Process -Id $proc.ProcessId -Force
  Write-GuardianLog "stopped DSH (pid $($proc.ProcessId))"
  return $true
}

function Test-DshRunning {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $listener
}

function Invoke-Launcher {
  param([string]$Mode)
  if (-not (Test-Path -LiteralPath $launcher)) {
    Write-GuardianLog "launcher not found: $launcher"
    return
  }
  try {
    if ($Mode -eq 'start') {
      Start-Process -FilePath 'pwsh' -ArgumentList @('-File', $launcher) -WindowStyle Hidden | Out-Null
    }
  } catch {
    Write-GuardianLog "launcher failed: $_"
  }
}

# ———— marker 消费（Fast Path 500ms）————
function Process-Markers {
  # 先看 jingxi state/，再看 legacy logs/
  $markers = @(
    @{ Name = 'restart'; Path = $requestFile; Legacy = $legacyReq },
    @{ Name = 'stop';    Path = $stopFile;    Legacy = $legacyStop },
    @{ Name = 'start';   Path = $startFile;   Legacy = $legacyStart }
  )
  foreach ($m in $markers) {
    $path = $null
    if (Test-Path $m.Path) { $path = $m.Path }
    elseif (Test-Path $m.Legacy) { $path = $m.Legacy; Write-GuardianLog "legacy marker consumed: $($m.Legacy)" }
    if (-not $path) { continue }
    $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
    Remove-Item $path -Force -ErrorAction SilentlyContinue
    switch ($m.Name) {
      'restart' {
        Write-GuardianLog "restart marker: $content"
        $oldPid = $null
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) { $oldPid = $listener.OwningProcess }
        $stopped = Stop-DshByPort
        Start-Sleep -Milliseconds 300
        Invoke-Launcher 'start'
        Start-Sleep -Seconds 2
        $newPid = $null
        $listener2 = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener2) { $newPid = $listener2.OwningProcess }
        Write-GuardianLog "restart done: old=$oldPid new=$newPid stopped=$stopped"
      }
      'stop' {
        Write-GuardianLog "stop marker: $content"
        Stop-DshByPort | Out-Null
      }
      'start' {
        Write-GuardianLog "start marker: $content"
        if (-not (Test-DshRunning)) { Invoke-Launcher 'start' }
      }
    }
  }
}

# ———— Slow Path（12s）————
function Slow-Path {
  # 1. DSH 被动宕机（无 marker 但 3080 挂了且 crash loop 未超限）→ 拉起
  if (-not (Test-DshRunning)) {
    $crashFile = Join-Path $statePath 'crash-count.txt'
    $count = 0
    if (Test-Path $crashFile) { $count = [int](Get-Content $crashFile -Raw -ErrorAction SilentlyContinue) }
    if ($count -lt $CrashLoopMax) {
      Write-GuardianLog "DSH down without marker, auto-restart ($count/$CrashLoopMax)"
      Invoke-Launcher 'start'
      $count++
      Set-Content -Path $crashFile -Value $count -Encoding utf8
    } else {
      Write-GuardianLog "crash loop detected ($count/$CrashLoopMax), waiting for manual action"
    }
  }
  # 2. Jingxi Host 存活
  Start-JingxiHost
}

# ———— 启动循环 ————
Write-GuardianLog "Guardian starting (markerPollMs=$MarkerPollMs healthInterval=$HealthIntervalSeconds s)"
Start-JingxiHost
$markerTimer = [System.Diagnostics.Stopwatch]::StartNew()
$healthTimer = [System.Diagnostics.Stopwatch]::StartNew()

while ($true) {
  if ($markerTimer.ElapsedMilliseconds -ge $MarkerPollMs) {
    Process-Markers
    $markerTimer.Restart()
  }
  if ($healthTimer.Elapsed.TotalSeconds -ge $HealthIntervalSeconds) {
    Slow-Path
    $healthTimer.Restart()
  }
  Start-Sleep -Milliseconds 100
}