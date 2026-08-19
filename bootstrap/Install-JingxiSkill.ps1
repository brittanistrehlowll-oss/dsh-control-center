# Install-JingxiSkill.ps1 — 鲸息 V3.0 bootstrap（首次安装链入口）
#
# 作用（HANDOFF §2.1）：
#   定位 DSH_HOME → 校验目标目录 → 备份冲突项 → 把 skill/jingxi 复制到
#   $DSH_HOME/skills/jingxi → 让 DSH skill catalog 可发现 jingxi。
#
# 边界：
#   - 只安装 Skill bundle，不安装整个 runtime，不修改 DSH 核心，不启动更新；
#   - Skill 被发现后，真正的 install/repair/doctor/uninstall 由 jingxi Skill 的
#     scripts 承担（Skill 是维护入口，不是 runtime）。
#   - 幂等：重复运行不会产生重复文件；冲突项先备份到 .bak-<ts>。
#   - 绝不删除 DSH 官方文件，绝不覆盖用户未提交修改。
#
# 用法：
#   pwsh -File bootstrap/Install-JingxiSkill.ps1 [-DshHome <path>] [-Force]
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "[jingxi bootstrap] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

# ———— 1. 定位 DSH_HOME ————
if (-not $DshHome) {
  $candidates = @("$env:USERPROFILE\.dsh", "$env:LOCALAPPDATA\dsh", "D:\CodexD\DSH\home")
  foreach ($c in $candidates) { if (Test-Path $c) { $DshHome = $c; break } }
}
if (-not $DshHome -or -not (Test-Path $DshHome)) {
  throw "无法定位 DSH_HOME。请用 -DshHome 显式指定（例如 D:\CodexD\DSH\home）。"
}
Write-Step "DSH_HOME = $DshHome"

# 确认这是 DSH home（有 profiles 目录或 settings.yaml）
$looksLikeDshHome = (Test-Path (Join-Path $DshHome 'profiles')) -or (Test-Path (Join-Path $DshHome 'settings.yaml'))
if (-not $looksLikeDshHome) {
  throw "目标目录看起来不是 DSH home（缺少 profiles/ 或 settings.yaml）。拒绝写入。"
}
Write-Ok "目标目录确认为 DSH home"

# ———— 2. 定位 skill 源 ————
$repoRoot = Split-Path -Parent $PSScriptRoot
$skillSrc = Join-Path $repoRoot 'skill\jingxi'
if (-not (Test-Path (Join-Path $skillSrc 'SKILL.md'))) {
  throw "skill/jingxi/SKILL.md 不存在于 $skillSrc。bootstrap 必须在鲸息 repo 根目录下运行。"
}
Write-Ok "skill 源 = $skillSrc"

# ———— 3. 目标目录与冲突备份 ————
$skillsRoot = Join-Path $DshHome 'skills'
$targetDir  = Join-Path $skillsRoot 'jingxi'
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

if (Test-Path $targetDir) {
  if (-not $Force) {
    Write-Warn "目标已存在: $targetDir（这是重复安装，将保持幂等，不做破坏）"
  }
  $bak = "$targetDir.bak-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  Write-Step "备份现有 jingxi skill → $bak"
  Copy-Item -Path $targetDir -Destination $bak -Recurse -Force
  Remove-Item -Path $targetDir -Recurse -Force
}

# ———— 4. 复制 skill bundle ————
Write-Step "复制 skill/jingxi → $targetDir"
Copy-Item -Path $skillSrc -Destination $targetDir -Recurse -Force
$sk = Join-Path $targetDir 'SKILL.md'
if (-not (Test-Path $sk)) { throw "复制后 SKILL.md 缺失" }
Write-Ok "SKILL.md 已就位: $sk"

# ———— 5. 校验 frontmatter ————
$head = (Get-Content $sk -TotalCount 8) -join "`n"
if ($head -match 'name: jingxi' -and $head -match 'user-invocable') {
  Write-Ok "frontmatter 校验通过（name: jingxi / user-invocable）"
} else {
  Write-Warn "frontmatter 校验未完全通过，请检查 SKILL.md"
}

Write-Step "bootstrap 完成。DSH skill catalog 现在应能发现 jingxi。"
Write-Host ""
Write-Host "下一步：在 DSH 中显式调用 jingxi Skill 的 install 动作（或运行其 scripts/install.ps1）部署运行时。" -ForegroundColor Yellow