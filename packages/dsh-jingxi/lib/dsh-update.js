import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2fdsh/latest'
export const DSH_HEALTH_URL = 'http://127.0.0.1:3080/api/system/health'
export const LIFECYCLE_ACTIONS = Object.freeze(['restart', 'update'])
// Only release pairs that have passed the Native Integration Gate may mutate
// a user's DSH installation.  The matrix is intentionally exact: DSH is still
// in developer preview and a semver-compatible-looking release can change the
// client slot, primitives or API seams without warning.
export const DSH_COMPATIBILITY_MATRIX = Object.freeze([
  Object.freeze({ current: '0.1.0-rc.8', target: '0.1.0-rc.8', state: 'verified' }),
])

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const BACKUP_FILES = Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
const UPDATE_VERIFICATION_FILE = 'post-restart-verification.json'
const RESTART_COMPLETED_FILE = 'restart.completed.jsonl'

export function parseVersion(value) {
  const match = String(value ?? '').trim().match(VERSION_RE)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/** Semver precedence for the package versions used by the DSH installer. */
export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) return undefined
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a > b ? 1 : -1
  }
  return 0
}

export function updateDecision({ current, latest } = {}) {
  const relation = compareVersions(current, latest)
  if (relation === undefined) {
    return { available: false, state: 'unknown', reason: 'version-unreadable' }
  }
  if (relation < 0) return { available: true, state: 'available' }
  return { available: false, state: relation === 0 ? 'up-to-date' : 'current-newer' }
}

export function compatibilityDecision({ current, target, matrix = DSH_COMPATIBILITY_MATRIX } = {}) {
  if (!parseVersion(current) || !parseVersion(target)) {
    return { allowed: false, state: 'unknown', reason: 'version-unreadable' }
  }
  const relation = compareVersions(current, target)
  if (relation >= 0) {
    return { allowed: true, state: relation === 0 ? 'verified' : 'not-required', reason: 'no-downgrade' }
  }
  const match = Array.isArray(matrix)
    ? matrix.find((entry) => entry?.current === current && entry?.target === target)
    : undefined
  if (!match || match.state !== 'verified') {
    return {
      allowed: false,
      state: 'unknown',
      reason: 'compatibility-unverified',
      currentVersion: current,
      targetVersion: target,
    }
  }
  return { allowed: true, state: 'verified', reason: 'matrix-match', currentVersion: current, targetVersion: target }
}

export function isLifecycleAction(action) {
  return LIFECYCLE_ACTIONS.includes(action)
}

function headerValue(headers, name) {
  const value = headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function isLoopbackAddress(address) {
  return address === undefined
    || address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
}

function isLoopbackHost(host) {
  if (typeof host !== 'string') return false
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u.test(host)
}

/** Same-origin, loopback-only request guard for lifecycle mutation routes. */
export function isTrustedWebRequest(request) {
  const headers = request?.headers ?? {}
  if (!isLoopbackAddress(request?.socket?.remoteAddress)) return false
  if (headerValue(headers, 'forwarded') !== undefined
    || headerValue(headers, 'x-forwarded-for') !== undefined
    || headerValue(headers, 'x-real-ip') !== undefined) return false

  const host = headerValue(headers, 'host')
  if (!isLoopbackHost(host)) return false
  const origin = headerValue(headers, 'origin')
  if (origin === undefined || origin === 'null') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

export function buildDshUpdateCommand(targetVersion) {
  if (!parseVersion(targetVersion)) throw new Error('invalid target version')
  return ['add', `${DSH_PACKAGE_NAME}@${targetVersion}`, '--save-exact']
}

function quoteWindowsCommandArg(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_./:@+\\-]+$/u.test(text)) return text
  return `"${text.replace(/["^&|<>]/gu, '^$&')}"`
}

/**
 * Build a Windows-safe package-manager invocation.
 *
 * Node cannot pass a .cmd shim to execFile with shell:false on Windows; the
 * host raises spawn EINVAL before pnpm can run. Prefer the Node + Corepack
 * entrypoint when available, and use an explicit cmd.exe wrapper only for a
 * configured .cmd/.bat shim. The command and target version are still fixed
 * by buildDshUpdateCommand, so no shell interpolation is used for user input.
 */
export function buildDshUpdateInvocation(targetVersion, {
  platform = process.platform,
  pnpmBin,
  comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
  nodePath = process.execPath,
  corepackPath = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
} = {}) {
  const command = buildDshUpdateCommand(targetVersion)
  if (platform !== 'win32') {
    return { executable: pnpmBin || 'pnpm', args: command, options: { shell: false } }
  }

  const configured = String(pnpmBin ?? '').trim()
  if (!configured && nodePath && corepackPath && existsSync(corepackPath)) {
    return {
      executable: nodePath,
      args: [corepackPath, 'pnpm', ...command],
      options: { shell: false },
    }
  }

  const executable = configured || 'pnpm.cmd'
  const extension = path.extname(executable).toLowerCase()
  if (extension === '.exe') return { executable, args: command, options: { shell: false } }
  if (extension === '.js' || extension === '.cjs') {
    return { executable: nodePath, args: [executable, ...command], options: { shell: false } }
  }
  const commandLine = [executable, ...command].map(quoteWindowsCommandArg).join(' ')
  return {
    executable: comspec,
    args: ['/d', '/s', '/c', commandLine],
    options: { shell: false },
  }
}

function updateErrorDetails(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = error instanceof Error ? error.message : String(error ?? '')
  const text = `${code} ${message}`.toLowerCase()
  if (code === 'EINVAL' || /spawn\s+[^\s]+\s+e(?:inval|nival)\b/u.test(text)) {
    return { code: 'package-manager-invocation-invalid', message: 'Windows 包管理器调用失败，更新未执行。请稍后重试。' }
  }
  if (code === 'ENOENT' || /spawn\s+[^\s]+\s+enoent\b/u.test(text) || /pnpm[^\s]*.*(?:not found|找不到)/u.test(text)) {
    return { code: 'package-manager-unavailable', message: '找不到 pnpm，更新未执行。请先确认 DSH 的包管理器可用。' }
  }
  if (error?.name === 'AbortError' || code === 'ETIMEDOUT' || /\b(?:aborted|timeout|timed out)\b/u.test(text)) {
    return { code: 'registry-timeout', message: '连接更新源超时，请稍后重试。' }
  }
  if (/registry\s+http\s+(?:401|403)\b/u.test(text)) {
    return { code: 'registry-denied', message: '更新源拒绝了请求，请检查网络或更新源配置。' }
  }
  if (/registry\s+http\s+5\d\d\b/u.test(text) || /\b(?:fetch failed|econn|enotfound|network)\b/u.test(text)) {
    return { code: 'registry-unavailable', message: '暂时无法连接更新源，请稍后重试。' }
  }
  if (/invalid version|version-unreadable|registry returned an invalid version/u.test(text)) {
    return { code: 'version-unreadable', message: '无法识别 DSH 版本，更新已阻止。' }
  }
  if (/compatibility-unverified|compatibility blocked|兼容性/u.test(text)) {
    return { code: 'compatibility-unverified', message: '该 DSH 版本尚未完成鲸息兼容性验证，更新已阻止。' }
  }
  if (/install root|not verified/u.test(text)) {
    return { code: 'install-root-unverified', message: '未找到可验证的 DSH 安装位置，更新已阻止。' }
  }
  if (/permission|access denied|eacces|eperm/u.test(text)) {
    return { code: 'permission-denied', message: '没有权限写入 DSH 安装目录，更新已阻止。' }
  }
  return { code: 'update-failed', message: 'DSH 更新失败，请稍后重试。' }
}

function isTransientRegistryError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = error instanceof Error ? error.message : String(error ?? '')
  const text = `${code} ${message}`.toLowerCase()
  return /\bregistry http 5\d\d\b/u.test(text)
    || /\b(?:fetch failed|econn|eai_again|enotfound|network)\b/u.test(text)
}

export function formatDshUpdateError(error) {
  return updateErrorDetails(error).message
}

async function readResponsePayload(response) {
  if (typeof response?.text === 'function') {
    const text = await response.text()
    if (!text.trim()) return undefined
    try { return JSON.parse(text) } catch { return undefined }
  }
  if (typeof response?.json === 'function') {
    try { return await response.json() } catch { return undefined }
  }
  return undefined
}

async function readJson(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

function isVerificationRecord(value) {
  return value && value.version === 1
    && typeof value.restartId === 'string' && value.restartId.length > 0
    && typeof value.expectedVersion === 'string' && parseVersion(value.expectedVersion)
    && typeof value.previousBootId === 'string' && value.previousBootId.length > 0
    && (value.state === 'pending' || value.state === 'failed')
}

function verificationFile(installRoot) {
  return path.join(installRoot, 'logs', 'jingxi-update', UPDATE_VERIFICATION_FILE)
}

async function writeJsonAtomically(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temp, `${JSON.stringify(value)}\n`, 'utf8')
    await rename(temp, file)
  } finally {
    try { await unlink(temp) } catch {}
  }
}

async function readPendingUpdateVerificationAt(installRoot) {
  const value = await readJson(verificationFile(installRoot))
  return isVerificationRecord(value) ? value : undefined
}

async function writePendingUpdateVerificationAt(installRoot, value) {
  const file = verificationFile(installRoot)
  await mkdir(path.dirname(file), { recursive: true })
  await writeJsonAtomically(file, value)
  return file
}

async function clearPendingUpdateVerificationAt(installRoot) {
  try { await unlink(verificationFile(installRoot)) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function readRestartCompletionAt(installRoot, restartId) {
  if (!restartId) return undefined
  try {
    const lines = (await readFile(path.join(installRoot, 'logs', RESTART_COMPLETED_FILE), 'utf8'))
      .split(/\r?\n/u).reverse()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const value = JSON.parse(line)
        if (value?.restartId === restartId) return value
      } catch {}
    }
  } catch {}
  return undefined
}

async function isDirectory(candidate) {
  try { return (await stat(candidate)).isDirectory() } catch { return false }
}

async function isDshInstallRoot(candidate) {
  if (!candidate || !(await isDirectory(candidate))) return false
  const manifest = await readJson(path.join(candidate, 'package.json'))
  return typeof manifest?.dependencies?.[DSH_PACKAGE_NAME] === 'string'
    && await isDirectory(path.join(candidate, 'node_modules'))
}

async function ancestors(start) {
  const result = []
  let current = path.resolve(start)
  while (true) {
    result.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

/** Resolve only an install root with the expected DSH package shape. */
export async function resolveDshRoot({ root, cwd = process.cwd(), argv = process.argv } = {}) {
  const candidates = []
  if (typeof root === 'string' && root.trim()) candidates.push(root)
  if (typeof process.env.JINGXI_DSH_ROOT === 'string' && process.env.JINGXI_DSH_ROOT.trim()) {
    candidates.push(process.env.JINGXI_DSH_ROOT)
  }
  if (typeof process.env.DSH_ROOT === 'string' && process.env.DSH_ROOT.trim()) candidates.push(process.env.DSH_ROOT)
  candidates.push(cwd)
  if (typeof argv?.[1] === 'string' && argv[1].trim()) candidates.push(path.dirname(argv[1]))

  const seen = new Set()
  for (const candidate of candidates) {
    for (const ancestor of await ancestors(candidate)) {
      const normalized = path.normalize(ancestor).toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      if (await isDshInstallRoot(ancestor)) return ancestor
    }
  }
  return undefined
}

export async function readInstalledDshVersion(root) {
  if (!root) return undefined
  const manifest = await readJson(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  if (typeof manifest?.version === 'string' && parseVersion(manifest.version)) return manifest.version
  const rootManifest = await readJson(path.join(root, 'package.json'))
  const declared = rootManifest?.dependencies?.[DSH_PACKAGE_NAME]
  return parseVersion(declared) ? declared : undefined
}

/** Read the host health contract without treating an HTTP response as proof. */
export async function readDshRuntimeHealth({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = DSH_HEALTH_URL,
  timeoutMs = 2500,
} = {}) {
  if (typeof url !== 'string' || url.trim() === '') {
    return { ok: false, state: 'runtime-unverified', error: 'DSH health endpoint unavailable' }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal })
    const status = Number(response?.status)
    if (response?.ok === false || (Number.isFinite(status) && status > 0 && (status < 200 || status >= 300))) {
      return { ok: false, state: 'runtime-unverified', error: 'DSH health endpoint unavailable' }
    }
    const payload = await readResponsePayload(response)
    if (payload?.ready !== true || typeof payload.bootId !== 'string' || payload.bootId.trim() === '') {
      return { ok: false, state: 'runtime-unverified', error: 'DSH health response incomplete' }
    }
    return {
      ok: true,
      state: 'runtime-healthy',
      ready: true,
      bootId: payload.bootId,
      ...(payload.pid !== undefined ? { pid: payload.pid } : {}),
      ...(payload.uptime !== undefined ? { uptime: payload.uptime } : {}),
    }
  } catch (error) {
    return {
      ok: false,
      state: 'runtime-unverified',
      error: error?.name === 'AbortError' ? 'DSH health check timed out' : 'DSH health endpoint unavailable',
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Build a health URL from the active DSH webServer, never from a fixed port. */
export function buildDshHealthUrl(port) {
  const numericPort = Number(port)
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) return undefined
  return `http://127.0.0.1:${numericPort}/api/system/health`
}

/**
 * Reconcile the durable post-restart evidence after the old DSH process has
 * gone away. Success requires the watchdog completion record, a ready health
 * response with a different bootId, the expected DSH version, and the fact
 * that this plugin is serving the status route that called this function.
 */
export async function getDshUpdateVerification({
  root,
  restartId,
  fetchImpl,
  healthUrl,
  timeoutMs = 2500,
} = {}) {
  const installRoot = await resolveDshRoot({ root })
  if (!installRoot) return { ok: false, state: 'blocked', complete: false, verified: false, errorCode: 'install-root-unverified', error: '未找到可验证的 DSH 安装位置，更新已阻止。' }
  const pending = await readPendingUpdateVerificationAt(installRoot)
  if (!pending) return { ok: true, state: 'idle', complete: false, verified: false }
  if (restartId && pending.restartId !== restartId) {
    return { ok: false, state: 'not-found', complete: false, verified: false, errorCode: 'verification-not-found', error: '找不到对应的 DSH 更新验证记录。' }
  }
  if (pending.state === 'failed') {
    return {
      ok: false,
      state: 'verification-failed',
      complete: false,
      verified: false,
      errorCode: 'verification-failed',
      error: 'DSH 重启后未通过运行态验证，请稍后检查。',
      restartId: pending.restartId,
      expectedVersion: pending.expectedVersion,
    }
  }

  const completion = await readRestartCompletionAt(installRoot, pending.restartId)
  if (completion?.ok === false) {
    return {
      ok: false,
      state: 'restart-failed',
      complete: false,
      verified: false,
      errorCode: 'restart-failed',
      error: 'DSH 重启失败，请稍后重试。',
      restartId: pending.restartId,
      expectedVersion: pending.expectedVersion,
    }
  }

  const health = await readDshRuntimeHealth({ fetchImpl, url: healthUrl, timeoutMs })
  const currentVersion = await readInstalledDshVersion(installRoot)
  const common = {
    restartId: pending.restartId,
    expectedVersion: pending.expectedVersion,
    ...(currentVersion ? { installedVersion: currentVersion } : {}),
  }
  if (!health.ok || completion?.ok !== true || health.bootId === pending.previousBootId) {
    return {
      ok: true,
      state: 'verification-pending',
      complete: false,
      verified: false,
      ...common,
      verification: { ok: false, state: 'pending', error: 'waiting for the restarted DSH runtime' },
    }
  }
  if (currentVersion !== pending.expectedVersion) {
    return {
      ok: false,
      state: 'verification-failed',
      complete: false,
      verified: false,
      errorCode: 'verification-failed',
      error: 'DSH 重启后未通过运行态验证，请稍后检查。',
      ...common,
      verification: { ok: false, state: 'version-mismatch' },
    }
  }
  if (completion.newPid !== undefined && health.pid !== undefined && String(completion.newPid) !== String(health.pid)) {
    return {
      ok: false,
      state: 'verification-failed',
      complete: false,
      verified: false,
      errorCode: 'verification-failed',
      error: 'DSH 重启后未通过运行态验证，请稍后检查。',
      ...common,
      verification: { ok: false, state: 'pid-mismatch' },
    }
  }

  await clearPendingUpdateVerificationAt(installRoot)
  return {
    ok: true,
    state: 'updated',
    complete: true,
    verified: true,
    ...common,
    verification: { ok: true, state: 'runtime-healthy', bootId: health.bootId },
  }
}

export async function checkDshUpdate({
  fetchImpl = (...args) => globalThis.fetch(...args),
  registryUrl = DSH_REGISTRY_URL,
  root,
  compatibilityMatrix = DSH_COMPATIBILITY_MATRIX,
  timeoutMs = 10_000,
  retryDelayMs = 250,
} = {}) {
  const installRoot = await resolveDshRoot({ root })
  const currentVersion = await readInstalledDshVersion(installRoot)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(registryUrl, { cache: 'no-store', signal: controller.signal })
        const status = Number(response?.status)
        if (response?.ok === false || (Number.isFinite(status) && status > 0 && (status < 200 || status >= 300))) {
          throw new Error(`registry http ${status || 0}`)
        }
        const payload = await readResponsePayload(response)
        const latestVersion = typeof payload?.version === 'string' ? payload.version : undefined
        if (!parseVersion(latestVersion)) throw new Error('registry returned an invalid version')
        const decision = updateDecision({ current: currentVersion, latest: latestVersion })
        const compatibility = compatibilityDecision({ current: currentVersion, target: latestVersion, matrix: compatibilityMatrix })
        return {
          ok: true,
          package: DSH_PACKAGE_NAME,
          currentVersion: currentVersion ?? null,
          latestVersion,
          updateAvailable: decision.available,
          state: decision.state,
          compatibility,
          mutationAllowed: decision.available && compatibility.allowed,
          checkedAt: new Date().toISOString(),
          source: 'npm',
          ...(decision.reason ? { reason: decision.reason } : {}),
        }
      } catch (error) {
        if (attempt === 0 && isTransientRegistryError(error)) {
          if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          continue
        }
        throw error
      }
    }
  } catch (error) {
    const details = updateErrorDetails(error)
    return {
      ok: false,
      package: DSH_PACKAGE_NAME,
      currentVersion: currentVersion ?? null,
      updateAvailable: false,
      state: 'error',
      errorCode: details.code,
      error: details.message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 17)
}

export async function createUpdateBackup(root, { now = new Date() } = {}) {
  if (!await isDshInstallRoot(root)) throw new Error('DSH install root is not verified')
  const dir = path.join(root, 'logs', 'jingxi-update', `pre-${backupStamp(now)}-${process.pid}`)
  await mkdir(dir, { recursive: true })
  const files = []
  for (const name of BACKUP_FILES) {
    const source = path.join(root, name)
    try {
      await stat(source)
      await copyFile(source, path.join(dir, name))
      files.push(name)
    } catch {
      // Optional workspace metadata may not exist in every installation.
    }
  }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: now.toISOString(), files }), 'utf8')
  return { dir, files }
}

export async function restoreUpdateBackup(backup) {
  if (!backup?.dir || !Array.isArray(backup.files)) return false
  const root = path.dirname(path.dirname(path.dirname(backup.dir)))
  for (const name of backup.files) await copyFile(path.join(backup.dir, name), path.join(root, name))
  return true
}

function outputTail(result) {
  const text = [result?.stdout, result?.stderr].filter((value) => typeof value === 'string' && value.trim()).join('\n').trim()
  return text.slice(-600)
}

export async function applyDshUpdate({
  targetVersion,
  fetchImpl,
  execFileImpl,
  createBackupImpl = createUpdateBackup,
  restoreBackupImpl = restoreUpdateBackup,
  compatibilityMatrix,
  root,
  env = process.env,
  timeoutMs = 180_000,
} = {}) {
  const check = await checkDshUpdate({ fetchImpl, root, compatibilityMatrix })
  if (!check.ok) return check
  if (!check.updateAvailable) return { ...check, mutated: false }
  if (check.mutationAllowed !== true) {
    return {
      ...check,
      ok: false,
      state: 'compatibility-blocked',
      mutated: false,
      errorCode: 'compatibility-unverified',
      error: '该 DSH 版本尚未完成鲸息兼容性验证，更新已阻止。',
    }
  }
  if (targetVersion !== undefined && targetVersion !== check.latestVersion) {
    return { ...check, ok: false, state: 'rejected', error: 'target version no longer matches the verified latest release' }
  }

  const installRoot = await resolveDshRoot({ root })
  if (!installRoot) return { ...check, ok: false, state: 'blocked', error: 'DSH install root could not be verified' }
  const target = check.latestVersion
  const runner = execFileImpl || promisify(execFile)
  const executable = env.JINGXI_PNPM_BIN || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  let backup
  let installStarted = false
  try {
    backup = await createBackupImpl(installRoot)
    const invocation = buildDshUpdateInvocation(target, {
      platform: process.platform,
      pnpmBin: env.JINGXI_PNPM_BIN,
      comspec: env.ComSpec || env.COMSPEC,
      nodePath: process.execPath,
    })
    installStarted = true
    const result = await runner(invocation.executable, invocation.args, {
      cwd: installRoot,
      env,
      ...invocation.options,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    })
    const installedVersion = await readInstalledDshVersion(installRoot)
    if (installedVersion !== target) throw new Error(`installed version ${installedVersion ?? 'unknown'} does not match ${target}`)
    return {
      ...check,
      ok: true,
      state: 'updated',
      mutated: true,
      complete: false,
      verified: false,
      verificationPending: true,
      installedVersion,
      restartRequired: true,
      backupDir: backup.dir,
      outputTail: outputTail(result),
    }
  } catch (error) {
    let rollback = false
    let rollbackError
    const rollbackAttempted = Boolean(backup)
    if (rollbackAttempted) {
      try {
        rollback = await restoreBackupImpl(backup)
        if (!rollback) rollbackError = new Error('backup restore did not complete')
      } catch (restoreError) {
        rollbackError = restoreError
      }
    }
    const details = updateErrorDetails(error)
    const rollbackFailed = rollbackAttempted && !rollback
    return {
      ...check,
      ok: false,
      state: rollbackFailed ? 'rollback-failed' : rollback ? 'rolled-back' : 'failed',
      mutated: rollbackFailed && installStarted,
      rollback,
      rollbackAttempted,
      complete: false,
      verified: false,
      ...(backup?.dir ? { backupDir: backup.dir } : {}),
      errorCode: rollbackFailed ? 'rollback-failed' : details.code,
      error: rollbackFailed
        ? '更新失败，旧版本恢复也未完成，请立即检查 DSH 安装。'
        : details.message,
      ...(rollbackError?.code ? { rollbackErrorCode: String(rollbackError.code).toUpperCase() } : {}),
    }
  }
}

/**
 * Execute the small, explicit DSH lifecycle contract exposed to the client.
 * An update may request a restart only after the package was verified on disk;
 * an unavailable/no-op update must never touch the watchdog marker.
 */
export async function executeLifecycleAction(action, {
  update = () => applyDshUpdate(),
  restart = () => requestDshRestart(),
  verify,
} = {}) {
  if (!isLifecycleAction(action)) {
    return { ok: false, state: 'invalid-action', error: 'unsupported lifecycle action' }
  }
  if (action === 'restart') {
    try {
      return await restart()
    } catch (error) {
      const details = updateErrorDetails(error)
      return { ok: false, state: 'failed', errorCode: details.code, error: 'DSH 重启失败，请稍后重试。' }
    }
  }

  let updateResult
  try {
    updateResult = await update()
  } catch (error) {
    const details = updateErrorDetails(error)
    return { ok: false, state: 'failed', errorCode: details.code, error: details.message }
  }
  if (!updateResult?.ok || !updateResult.mutated) return updateResult

  let restartResult
  try {
    restartResult = await restart({ update: updateResult })
  } catch (error) {
    const details = updateErrorDetails(error)
    return {
      ...updateResult,
      ok: false,
      state: 'updated-restart-failed',
      complete: false,
      verified: false,
      errorCode: 'restart-failed',
      error: 'DSH 重启失败，请稍后重试。',
      restart: { ok: false, state: 'failed', errorCode: details.code, error: 'DSH 重启失败，请稍后重试。' },
    }
  }
  if (!restartResult?.ok) {
    return {
      ...updateResult,
      ok: false,
      state: 'updated-restart-failed',
      complete: false,
      verified: false,
      errorCode: 'restart-failed',
      error: 'DSH 重启失败，请稍后重试。',
      restart: restartResult,
    }
  }
  if (typeof verify !== 'function') {
    return {
      ...updateResult,
      ok: true,
      state: 'verification-pending',
      complete: false,
      verified: false,
      restart: restartResult,
      verification: { ok: false, state: 'pending', error: 'waiting for the restarted DSH runtime' },
    }
  }
  let verification
  try {
    verification = await verify({ update: updateResult, restart: restartResult })
  } catch (error) {
    verification = { ok: false, state: 'runtime-unverified', error: error instanceof Error ? error.message : String(error) }
  }
  if (!verification?.ok) {
    return {
      ...updateResult,
      ok: false,
      state: 'verification-failed',
      complete: false,
      verified: false,
      errorCode: 'verification-failed',
      error: 'DSH 重启后未通过运行态验证，请稍后检查。',
      restart: restartResult,
      verification,
    }
  }
  return { ...updateResult, ok: true, state: 'updated', complete: true, verified: true, restart: restartResult, verification }
}

export async function readJsonBody(request, maxBytes = 4096) {
  if (!request || typeof request[Symbol.asyncIterator] !== 'function') return undefined
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function requestDshRestart(root, { now = new Date(), pendingVerification } = {}) {
  const installRoot = await resolveDshRoot({ root })
  if (!installRoot) return { ok: false, state: 'blocked', error: 'DSH install root could not be verified' }
  const marker = path.join(installRoot, 'logs', 'restart.requested')
  const restartId = `jx_${Date.now().toString(36)}_${process.pid}`
  await mkdir(path.dirname(marker), { recursive: true })
  let verificationRecord
  if (pendingVerification) {
    if (!parseVersion(pendingVerification.expectedVersion) || typeof pendingVerification.previousBootId !== 'string' || pendingVerification.previousBootId.trim() === '') {
      return {
        ok: false,
        state: 'blocked',
        errorCode: 'runtime-baseline-unavailable',
        error: 'DSH 重启前运行态基线不可验证，更新未执行。',
      }
    }
    const existing = await readPendingUpdateVerificationAt(installRoot)
    if (existing?.state === 'pending') return { ok: false, state: 'busy', error: 'a DSH update verification is already pending' }
    if (existing?.state === 'failed') return { ok: false, state: 'blocked', errorCode: 'verification-failed', error: 'DSH 上一次更新尚未完成运行态验证，请先检查安装状态。' }
    verificationRecord = {
      version: 1,
      state: 'pending',
      restartId,
      expectedVersion: pendingVerification.expectedVersion,
      previousBootId: pendingVerification.previousBootId,
      requestedAt: now.toISOString(),
    }
    await writePendingUpdateVerificationAt(installRoot, verificationRecord)
  }
  try {
    const graceSeconds = verificationRecord ? 5 : 0
    await writeFile(marker, `restartId=${restartId} graceSeconds=${graceSeconds} requested by dsh-jingxi at ${now.toISOString()}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (verificationRecord) {
      try { await clearPendingUpdateVerificationAt(installRoot) } catch {}
    }
    if (error?.code === 'EEXIST') return { ok: false, state: 'busy', error: 'a DSH restart is already pending' }
    return { ok: false, state: 'failed', error: 'could not write the DSH restart request' }
  }
  return {
    ok: true,
    state: 'restarting',
    restartId,
    owner: 'external-watchdog',
    ...(verificationRecord ? { verification: { state: 'pending', restartId } } : {}),
  }
}
