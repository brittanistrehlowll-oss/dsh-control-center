# open.ps1 — 打开鲸息（jingxi Skill 动作之一）
#
# 优先打开 DSH 内的鲸息页（/jingxi）；DSH 不可达时打开 Jingxi Host 离线页 (:3081)。
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$url = 'http://127.0.0.1:3080/jingxi'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/system/health' -TimeoutSec 2 -UseBasicParsing
  if ($r.StatusCode -ne 200) { $url = 'http://127.0.0.1:3081/' }
} catch {
  $url = 'http://127.0.0.1:3081/'
}

Write-Host "[jingxi open] 打开 $url"
Start-Process $url