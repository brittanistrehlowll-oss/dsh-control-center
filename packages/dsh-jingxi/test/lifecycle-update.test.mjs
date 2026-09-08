import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import {
  LIFECYCLE_ACTIONS,
  applyDshUpdate,
  buildDshUpdateInvocation,
  buildDshUpdateCommand,
  checkDshUpdate,
  compatibilityDecision,
  compareVersions,
  executeLifecycleAction,
  formatDshUpdateError,
  getDshUpdateVerification,
  isLifecycleAction,
  readDshRuntimeHealth,
  requestDshRestart,
  isTrustedWebRequest,
  updateDecision,
} from '../lib/dsh-update.js'
import { createAssetRouteHandler } from '../lib/asset-route.js'

const execFileAsync = promisify(execFile)

test('lifecycle exposes only restart and update actions', () => {
  assert.deepEqual([...LIFECYCLE_ACTIONS], ['restart', 'update'])
  assert.equal(isLifecycleAction('restart'), true)
  assert.equal(isLifecycleAction('update'), true)
  assert.equal(isLifecycleAction('close'), false)
  assert.equal(isLifecycleAction('stop'), false)
})

test('DSH prerelease comparison does not downgrade rc.8 to registry latest rc.7', () => {
  assert.equal(compareVersions('0.1.0-rc.8', '0.1.0-rc.7'), 1)
  assert.equal(updateDecision({ current: '0.1.0-rc.8', latest: '0.1.0-rc.7' }).available, false)
  assert.equal(updateDecision({ current: '0.1.0-rc.8', latest: '0.1.0-rc.9' }).available, true)
})

test('DSH version comparison follows prerelease precedence for beta, rc, and stable releases', () => {
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1)
  assert.equal(compareVersions('1.0.0-beta.11', '1.0.0-rc.1'), -1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
})

test('unknown DSH release pairs are held by the compatibility gate', () => {
  const result = compatibilityDecision({ current: '0.1.0-rc.8', target: '0.1.1-rc.2' })

  assert.equal(result.state, 'unknown')
  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'compatibility-unverified')
})

test('blocked DSH updates do not invoke the package manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-gate-'))
  let installCalls = 0
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8',
    }))

    const result = await applyDshUpdate({
      root,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.1-rc.2' }) }),
      execFileImpl: async () => { installCalls += 1; return { stdout: '', stderr: '' } },
    })

    assert.equal(result.ok, false)
    assert.equal(result.state, 'compatibility-blocked')
    assert.equal(result.mutated, false)
    assert.equal(result.errorCode, 'compatibility-unverified')
    assert.equal(installCalls, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('applyDshUpdate returns a stable failure when the pre-update backup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-backup-failure-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8',
    }))

    const result = await applyDshUpdate({
      root,
      compatibilityMatrix: [{ current: '0.1.0-rc.8', target: '0.1.0-rc.9', state: 'verified' }],
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.0-rc.9' }) }),
      createBackupImpl: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) },
      execFileImpl: async () => ({ stdout: '', stderr: '' }),
    })

    assert.equal(result.ok, false)
    assert.equal(result.state, 'failed')
    assert.equal(result.mutated, false)
    assert.equal(result.errorCode, 'permission-denied')
    assert.equal(result.error, '没有权限写入 DSH 安装目录，更新已阻止。')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package-manager ENOENT never becomes an update success and reports rollback state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-enoent-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8',
    }))

    const result = await applyDshUpdate({
      root,
      compatibilityMatrix: [{ current: '0.1.0-rc.8', target: '0.1.0-rc.9', state: 'verified' }],
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.0-rc.9' }) }),
      execFileImpl: async () => { throw Object.assign(new Error('spawn pnpm.cmd ENOENT'), { code: 'ENOENT' }) },
    })

    assert.equal(result.ok, false)
    assert.equal(result.state, 'rolled-back')
    assert.equal(result.rollback, true)
    assert.equal(result.complete, false)
    assert.equal(result.verified, false)
    assert.equal(result.errorCode, 'package-manager-unavailable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package-manager EINVAL never becomes an update success and reports a readable error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-einval-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8',
    }))

    const result = await applyDshUpdate({
      root,
      compatibilityMatrix: [{ current: '0.1.0-rc.8', target: '0.1.0-rc.9', state: 'verified' }],
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.0-rc.9' }) }),
      execFileImpl: async () => { throw Object.assign(new Error('spawn pnpm.cmd EINVAL'), { code: 'EINVAL' }) },
    })

    assert.equal(result.ok, false)
    assert.equal(result.state, 'rolled-back')
    assert.equal(result.rollback, true)
    assert.equal(result.complete, false)
    assert.equal(result.verified, false)
    assert.equal(result.errorCode, 'package-manager-invocation-invalid')
    assert.equal(result.error, 'Windows 包管理器调用失败，更新未执行。请稍后重试。')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed rollback is explicit and never reports the installation as safely restored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-rollback-failure-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8',
    }))

    const result = await applyDshUpdate({
      root,
      compatibilityMatrix: [{ current: '0.1.0-rc.8', target: '0.1.0-rc.9', state: 'verified' }],
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.0-rc.9' }) }),
      execFileImpl: async () => {
        await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.9' }))
        throw Object.assign(new Error('registry http 503'), { code: 'EPIPE' })
      },
      restoreBackupImpl: async () => { throw Object.assign(new Error('restore denied'), { code: 'EACCES' }) },
    })

    assert.equal(result.ok, false)
    assert.equal(result.state, 'rollback-failed')
    assert.equal(result.rollback, false)
    assert.equal(result.rollbackAttempted, true)
    assert.equal(result.complete, false)
    assert.equal(result.verified, false)
    assert.equal(result.errorCode, 'rollback-failed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('update command is fixed to the verified DSH package and target version', () => {
  assert.deepEqual(
    buildDshUpdateCommand('0.1.0-rc.9'),
    ['add', '@deepseek-ai/dsh@0.1.0-rc.9', '--save-exact'],
  )
  assert.throws(() => buildDshUpdateCommand('latest && whoami'), /invalid target version/)
})

test('Windows update invocation never passes a .cmd shim directly to shell:false', () => {
  const invocation = buildDshUpdateInvocation('0.1.0-rc.9', {
    platform: 'win32',
    pnpmBin: 'pnpm.cmd',
    comspec: 'C:\\Windows\\System32\\cmd.exe',
  })

  assert.equal(invocation.executable, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(invocation.options.shell, false)
  assert.match(invocation.args[3], /pnpm\.cmd/u)
  assert.match(invocation.args[3], /@deepseek-ai\/dsh@0\.1\.0-rc\.9/u)
})

test('Windows Corepack update invocation runs the real pnpm entrypoint', { skip: process.platform !== 'win32' }, async () => {
  const corepackPath = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  assert.equal(existsSync(corepackPath), true, 'Node Corepack must be present for the Windows update path')

  const invocation = buildDshUpdateInvocation('0.1.0-rc.9', {
    platform: 'win32',
    nodePath: process.execPath,
    corepackPath,
  })
  assert.equal(invocation.executable, process.execPath)
  assert.deepEqual(invocation.args.slice(0, 2), [corepackPath, 'pnpm'])
  assert.equal(invocation.options.shell, false)

  const result = await execFileAsync(invocation.executable, [corepackPath, 'pnpm', '--version'], {
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 256 * 1024,
  })
  assert.match(`${result.stdout}\n${result.stderr}`, /\d+\.\d+\.\d+/u)
})

test('update failures are classified into actionable, non-technical messages', () => {
  assert.equal(
    formatDshUpdateError(Object.assign(new Error('spawn pnpm.cmd ENOENT'), { code: 'ENOENT' })),
    '找不到 pnpm，更新未执行。请先确认 DSH 的包管理器可用。',
  )
  assert.equal(
    formatDshUpdateError(new Error('spawn pnpm.cmd ENIVAL')),
    'Windows 包管理器调用失败，更新未执行。请稍后重试。',
  )
  assert.equal(
    formatDshUpdateError(new Error('spawn pnpm.cmd EINVAL')),
    'Windows 包管理器调用失败，更新未执行。请稍后重试。',
  )
  assert.equal(
    formatDshUpdateError(new Error('registry http 503')),
    '暂时无法连接更新源，请稍后重试。',
  )
})

test('update check returns a stable error contract for non-2xx non-JSON registry responses', async () => {
  const result = await checkDshUpdate({
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'upstream unavailable' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'error')
  assert.equal(result.errorCode, 'registry-unavailable')
  assert.equal(result.error, '暂时无法连接更新源，请稍后重试。')
})

test('update check retries one transient registry outage before returning a stable result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-retry-'))
  let attempts = 0
  try {
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' },
    }))

    const result = await checkDshUpdate({
      root,
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts += 1
        if (attempts === 1) return { ok: false, status: 503, text: async () => 'upstream unavailable' }
        return { ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.1-rc.2' }) }
      },
    })

    assert.equal(attempts, 2)
    assert.equal(result.ok, true)
    assert.equal(result.state, 'available')
    assert.equal(result.latestVersion, '0.1.1-rc.2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('lifecycle requests require a loopback peer and same-origin headers', () => {
  const trusted = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
  }
  assert.equal(isTrustedWebRequest(trusted), true)
  assert.equal(isTrustedWebRequest({ ...trusted, headers: { host: trusted.headers.host } }), false)
  assert.equal(isTrustedWebRequest({ ...trusted, headers: { ...trusted.headers, origin: 'null' } }), false)
  assert.equal(isTrustedWebRequest({ ...trusted, headers: { ...trusted.headers, origin: 'https://evil.test' } }), false)
  assert.equal(isTrustedWebRequest({ ...trusted, socket: { remoteAddress: '10.0.0.4' } }), false)
  assert.equal(isTrustedWebRequest({ ...trusted, headers: { ...trusted.headers, forwarded: 'for=127.0.0.1' } }), false)
})

test('lifecycle executor only runs restart and update, and restarts after a successful update', async () => {
  const calls = []
  const result = await executeLifecycleAction('update', {
    update: async () => {
      calls.push('update')
      return { ok: true, state: 'updated', mutated: true, installedVersion: '0.1.0-rc.9' }
    },
    restart: async () => {
      calls.push('restart')
      return { ok: true, state: 'restarting', restartId: 'test-restart' }
    },
  })

  assert.deepEqual(calls, ['update', 'restart'])
  assert.equal(result.ok, true)
  assert.equal(result.state, 'verification-pending')
  assert.equal(result.complete, false)
  assert.equal(result.verification?.state, 'pending')
  assert.equal(result.restart?.state, 'restarting')
})

test('lifecycle executor only claims update success after post-restart verification passes', async () => {
  const result = await executeLifecycleAction('update', {
    update: async () => ({ ok: true, state: 'updated', mutated: true, installedVersion: '0.1.1-rc.2' }),
    restart: async () => ({ ok: true, state: 'restarting', restartId: 'test-restart' }),
    verify: async () => ({ ok: true, state: 'runtime-healthy', status: { ok: true } }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.state, 'updated')
  assert.equal(result.complete, true)
  assert.equal(result.verified, true)
  assert.equal(result.verification?.state, 'runtime-healthy')
})

test('lifecycle executor exposes a stable restart failure after a successful install', async () => {
  const result = await executeLifecycleAction('update', {
    update: async () => ({ ok: true, state: 'updated', mutated: true, installedVersion: '0.1.1-rc.2', complete: false, verified: false }),
    restart: async () => ({ ok: false, state: 'failed', error: 'could not write the DSH restart request' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'updated-restart-failed')
  assert.equal(result.complete, false)
  assert.equal(result.verified, false)
  assert.equal(result.errorCode, 'restart-failed')
  assert.equal(result.error, 'DSH 重启失败，请稍后重试。')
})

test('lifecycle executor cannot claim update success before post-restart verification', async () => {
  const result = await executeLifecycleAction('update', {
    update: async () => ({ ok: true, state: 'updated', mutated: true, installedVersion: '0.1.1-rc.2' }),
    restart: async () => ({ ok: true, state: 'restarting', restartId: 'test-restart' }),
    verify: async () => ({ ok: false, state: 'runtime-unverified', error: 'Jingxi status did not recover' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'verification-failed')
  assert.equal(result.verification?.state, 'runtime-unverified')
})

test('lifecycle executor exposes a stable verification failure when verify throws', async () => {
  const result = await executeLifecycleAction('update', {
    update: async () => ({ ok: true, state: 'updated', mutated: true, installedVersion: '0.1.1-rc.2', complete: false, verified: false }),
    restart: async () => ({ ok: true, state: 'restarting', restartId: 'test-restart' }),
    verify: async () => { throw new Error('health endpoint unavailable') },
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'verification-failed')
  assert.equal(result.complete, false)
  assert.equal(result.verified, false)
  assert.equal(result.errorCode, 'verification-failed')
  assert.equal(result.error, 'DSH 重启后未通过运行态验证，请稍后检查。')
})

test('runtime health evidence requires a ready response with a boot id', async () => {
  const healthy = await readDshRuntimeHealth({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ready: true, bootId: 'boot-new', pid: 4321 }) }),
  })
  assert.equal(healthy.ok, true)
  assert.equal(healthy.state, 'runtime-healthy')
  assert.equal(healthy.bootId, 'boot-new')

  const unverified = await readDshRuntimeHealth({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ready: true }) }),
  })
  assert.equal(unverified.ok, false)
  assert.equal(unverified.state, 'runtime-unverified')
})

test('update restart persists a verification record before the watchdog marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-verification-record-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await mkdir(join(root, 'logs'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' } }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.8' }))

    const result = await requestDshRestart(root, {
      now: new Date('2026-08-24T03:00:00.000Z'),
      pendingVerification: { expectedVersion: '0.1.0-rc.9', previousBootId: 'boot-old' },
    })

    assert.equal(result.ok, true)
    assert.equal(result.verification?.state, 'pending')
    assert.match(await readFile(join(root, 'logs', 'restart.requested'), 'utf8'), /graceSeconds=5/u)
    const pending = JSON.parse(await readFile(join(root, 'logs', 'jingxi-update', 'post-restart-verification.json'), 'utf8'))
    assert.equal(pending.restartId, result.restartId)
    assert.equal(pending.expectedVersion, '0.1.0-rc.9')
    assert.equal(pending.previousBootId, 'boot-old')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('post-restart verification remains pending until watchdog completion and a new boot are both proven', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-verification-pending-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' } }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.9' }))
    const restart = await requestDshRestart(root, {
      pendingVerification: { expectedVersion: '0.1.0-rc.9', previousBootId: 'boot-old' },
    })

    const result = await getDshUpdateVerification({
      root,
      restartId: restart.restartId,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ready: true, bootId: 'boot-new', pid: 4321 }) }),
    })

    assert.equal(result.ok, true)
    assert.equal(result.state, 'verification-pending')
    assert.equal(result.complete, false)
    assert.equal(result.verified, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('post-restart verification succeeds only with matching version, new boot and watchdog completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-update-verification-success-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await mkdir(join(root, 'logs'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.9' } }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.9' }))
    const restart = await requestDshRestart(root, {
      pendingVerification: { expectedVersion: '0.1.0-rc.9', previousBootId: 'boot-old' },
    })
    await writeFile(join(root, 'logs', 'restart.completed.jsonl'), `${JSON.stringify({ restartId: restart.restartId, newPid: 4321, ok: true })}\n`)

    const result = await getDshUpdateVerification({
      root,
      restartId: restart.restartId,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ready: true, bootId: 'boot-new', pid: 4321 }) }),
    })

    assert.equal(result.ok, true)
    assert.equal(result.state, 'updated')
    assert.equal(result.complete, true)
    assert.equal(result.verified, true)
    await assert.rejects(readFile(join(root, 'logs', 'jingxi-update', 'post-restart-verification.json'), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('lifecycle executor returns a stable failure when the update function throws', async () => {
  let restartCalled = false
  const result = await executeLifecycleAction('update', {
    update: async () => { throw new Error('simulated update failure') },
    restart: async () => {
      restartCalled = true
      return { ok: true, state: 'restarting' }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'failed')
  assert.equal(result.errorCode, 'update-failed')
  assert.equal(result.error, 'DSH 更新失败，请稍后重试。')
  assert.equal(restartCalled, false)
})

test('lifecycle executor rejects removed close and stop actions without invoking dependencies', async () => {
  let called = false
  const result = await executeLifecycleAction('close', {
    update: async () => { called = true; return { ok: true } },
    restart: async () => { called = true; return { ok: true } },
  })

  assert.equal(result.ok, false)
  assert.equal(result.state, 'invalid-action')
  assert.equal(called, false)
})

test('published package allowlist includes the DSH update core', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.files.includes('lib/dsh-update.js'))
  assert.ok(manifest.files.includes('lib/asset-route.js'))
  assert.equal(manifest.files.includes('lib/quota-adapter.js'), false, 'V1.0.1: the quota adapter is no longer published')
})

test('published package allowlist includes the transparent Jingxi icon library', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.files.includes('assets/icons/**/*'))
  const icons = JSON.parse(await readFile(new URL('../assets/icons/manifest.json', import.meta.url), 'utf8'))
  assert.equal(icons.canvas.background, 'transparent')
  assert.ok(icons.groups.brand.some((entry) => entry.id === 'idle'))
  assert.ok(icons.groups.runtime.some((entry) => entry.id === 'update-check'))
  assert.ok(icons.groups['spout-v15'].some((entry) => entry.id === 'stable'))
  assert.equal(icons.groups.quota, undefined, 'V1.0.1: the quota icon group is removed')
})

test('icon asset route serves allowlisted PNGs and rejects traversal', async () => {
  const handler = createAssetRouteHandler()
  const request = (url, method = 'GET') => ({ method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } })
  const run = async (req) => {
    const result = { status: null, headers: null, body: null }
    const response = {
      writeHead(status, headers) { result.status = status; result.headers = headers },
      end(body) { result.body = body },
    }
    await handler(req, response)
    return result
  }

  const asset = await run(request('/plugins/dsh-jingxi/assets/icons/brand/idle.png'))
  assert.equal(asset.status, 200)
  assert.equal(asset.headers['content-type'], 'image/png')
  assert.ok(Buffer.isBuffer(asset.body))
  assert.ok(asset.body.length > 100)

  const manifest = await run(request('/plugins/dsh-jingxi/assets/icons/manifest.json'))
  assert.equal(manifest.status, 200)
  assert.equal(manifest.headers['content-type'], 'application/json; charset=utf-8')

  const traversal = await run(request('/plugins/dsh-jingxi/assets/icons/%2e%2e/package.json'))
  assert.equal(traversal.status, 404)

  const encodedSlashTraversal = await run(request('/plugins/dsh-jingxi/assets/icons/brand%2F..%2F..%2F..%2Fpackage.json'))
  assert.equal(encodedSlashTraversal.status, 404, 'Encoded slashes must not escape the icon root')

  const unsupported = await run(request('/plugins/dsh-jingxi/assets/icons/brand/idle.svg'))
  assert.equal(unsupported.status, 404)
})

test('icon asset route keeps encoded separators inside the icon root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jingxi-assets-'))
  try {
    await mkdir(join(root, 'icons', 'brand'), { recursive: true })
    await writeFile(join(root, 'icons', 'brand', 'idle.png'), Buffer.from('png'))
    await writeFile(join(root, 'outside.json'), '{}')
    const handler = createAssetRouteHandler({ assetRoot: root })
    const request = {
      method: 'GET',
      url: '/plugins/dsh-jingxi/assets/icons/brand%2F..%2F..%2Foutside.json',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    }
    const result = { status: null, body: null }
    await handler(request, {
      writeHead(status) { result.status = status },
      end(body) { result.body = body },
    })
    assert.equal(result.status, 404, 'Encoded separators must not expose files beside icons')
    assert.equal(result.body, 'not found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
