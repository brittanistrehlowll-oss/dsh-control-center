import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, writePersistedBreathSnapshot } from '../lib/index.js'

const TEST_STATE_FILE = join(tmpdir(), `dsh-jingxi-contract-missing-${process.pid}.json`)
const PACKAGE_METADATA = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

function responseRecorder() {
  const result = { status: undefined, headers: undefined, body: undefined }
  return {
    result,
    response: {
      writeHead(status, headers) { result.status = status; result.headers = headers },
      end(body) { result.body = body },
    },
  }
}

function makePluginHarness(credentials, options = {}, services = {}) {
  const handlers = new Map()
  const ctx = {
    webServer: {
      register(meta) {
        handlers.set(meta.path, meta.handler)
        return () => {}
      },
    },
    effect(effect) { return effect() },
    inject() {},
    on() {},
    credentials,
    logger: {},
    ...services,
  }
  apply(ctx, { stateFile: TEST_STATE_FILE, ...options })
  return handlers
}

function makeEventListener(stateFile) {
  let listener
  const ctx = {
    webServer: { register() { return () => {} } },
    effect(effect) { return effect() },
    inject() {},
    on(name, handler) { if (name === 'session/event') listener = handler },
    logger: {},
  }
  apply(ctx, { stateFile })
  return listener
}

test('status uses package version and breath endpoint distinguishes no session from demo', async () => {
  const handlers = makePluginHarness()
  const statusResponse = responseRecorder()
  await handlers.get('/api/jingxi/status')({ method: 'GET' }, statusResponse.response)
  const status = JSON.parse(statusResponse.result.body)
  assert.equal(status.packageVersion, PACKAGE_METADATA.version)
  assert.equal(status.designVersion, 'V1.0.1')
  assert.equal(status.jingxiVersion, status.packageVersion)

  const breathResponse = responseRecorder()
  await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, breathResponse.response)
  const breath = JSON.parse(breathResponse.result.body)
  assert.equal(breath.source, 'none')
  assert.equal(breath.demo, false)
  assert.equal(breath.view.last, undefined)
})

test('breath endpoint restores persisted real telemetry after a plugin reload', async () => {
  const stateFile = join(tmpdir(), `dsh-jingxi-persisted-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true,
    real: true,
    source: 'real',
    demo: false,
    sessionId: 'session-persisted',
    writtenAt: '2026-08-21T04:40:06.718Z',
    view: {
      kind: 'idle',
      last: {
        turn: 7,
        status: 'completed',
        avgTps: 364,
        totalTokens: 1400,
        cachePct: 0.9,
        durationMs: 2000,
        curveQuality: 'authoritative-calibrated',
        sparkline: [
          { tMs: 1000, rateTokS: 120, cumulativeOutputTokens: 120 },
          { tMs: 2000, rateTokS: 364, cumulativeOutputTokens: 728 },
        ],
      },
      recent: [],
    },
  }
  await writeFile(stateFile, JSON.stringify(persisted), 'utf8')
  try {
    const handlers = makePluginHarness(undefined, { stateFile })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    assert.equal(result.status, 200)
    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'persisted')
    assert.equal(breath.stale, true)
    assert.equal(breath.view.last.turn, 7)
    assert.equal(breath.view.last.avgTps, 364)
    // V5.8 P0.1：sessionId 稳定暴露为脱敏指纹（sha256 前 16 hex），双位置
    // （view 顶层 + response 顶层）一致；原始会话 ID 永不进入响应。
    assert.match(breath.sessionId, /^[0-9a-f]{16}$/u, 'response top-level carries a stable 16-hex fingerprint')
    assert.equal(breath.view.sessionId, breath.sessionId, 'view top-level sessionId matches the response top-level')
    assert.notEqual(breath.sessionId, 'session-persisted', 'the raw session identifier must never be exposed')
    assert.doesNotMatch(result.body, /session-persisted/u, 'no raw session id in the response body')
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('breath endpoint restores the complete session trajectory summary from a snapshot', async () => {
  const stateFile = join(tmpdir(), `dsh-jingxi-session-summary-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true,
    real: true,
    source: 'real',
    demo: false,
    view: {
      kind: 'idle',
      sessionSummary: {
        rounds: 8,
        steps: 73,
        llmDurationMs: 1246000,
        toolDurationMs: 1323000,
        avgTtftMs: 5500,
        avgTps: 74,
        cachePct: 0.98,
        inputTokens: 7400000,
        outputTokens: 64100,
        curveQuality: 'authoritative-calibrated',
        updatedAt: 2000,
      },
      trajectory: {
        startMs: 1000,
        endMs: 2000,
        segments: [{ kind: 'model', startMs: 1000, endMs: 1100 }],
        sparkline: [{ tMs: 1100, rateTokS: 74, cumulativeOutputTokens: 64100 }],
        eventTicks: [{ tMs: 1050, kind: 'tool' }],
        inputTicks: [{ tMs: 1000, kind: 'input' }],
      },
      recent: [],
    },
  }
  await writeFile(stateFile, JSON.stringify(persisted), 'utf8')
  try {
    const handlers = makePluginHarness(undefined, { stateFile })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    const breath = JSON.parse(result.body)
    assert.deepEqual(breath.view.sessionSummary, persisted.view.sessionSummary)
    assert.deepEqual(breath.view.trajectory, persisted.view.trajectory)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('breath endpoint replays the newest persisted session through sessionQuery after reload', async () => {
  const stateFile = join(tmpdir(), `dsh-jingxi-session-query-${process.pid}-${Date.now()}.json`)
  const events = [
    { seq: 0, type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { seq: 1, type: 'turn/start', time: 100, data: { turn: 8 } },
    { seq: 2, type: 'step/start', time: 100, data: { turn: 8, step: 1 } },
    { seq: 3, type: 'assistant/chunk', time: 200, data: { turn: 8, step: 1, chunk: { type: 'text-delta' } } },
    { seq: 4, type: 'tool/call', time: 220, data: { callId: 'private-call', name: 'private-tool-name' } },
    { seq: 5, type: 'tool/result', time: 240, data: { message: { source: { callId: 'private-call' }, content: 'private tool result' } } },
    { seq: 6, type: 'assistant/message', time: 300, data: { turn: 8, step: 1, usage: { inputTokens: 148000, outputTokens: 64100, cacheReadTokens: 7252000, cacheWriteTokens: 0 } } },
    { seq: 7, type: 'step/end', time: 300, data: { turn: 8, step: 1 } },
    { seq: 8, type: 'turn/end', time: 400, data: { turn: 8, reason: { kind: 'completed' } } },
  ]
  const readIds = []
  const sessionQuery = {
    async listSessions() {
      return [
        { header: { id: 'persisted-latest', createdAt: 200 }, live: false, persisted: true },
        { header: { id: 'persisted-older', createdAt: 100 }, live: false, persisted: true },
      ]
    },
    async readSession(sessionId) {
      readIds.push(sessionId)
      return { session: { id: sessionId, createdAt: 200 }, events }
    },
  }

  try {
    const handlers = makePluginHarness(undefined, { stateFile }, { sessionQuery })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    assert.equal(result.status, 200)
    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'real')
    assert.equal(breath.real, true)
    assert.equal(breath.demo, false)
    assert.equal(readIds[0], 'persisted-latest')
    assert.equal(breath.view.sessionSummary.rounds, 1)
    assert.equal(breath.view.sessionSummary.steps, 1)
    assert.equal(breath.view.sessionSummary.inputTokens, 7400000)
    assert.equal(breath.view.sessionSummary.outputTokens, 64100)
    assert.equal(breath.view.trajectory.sparkline.length > 0, true)
    assert.equal(breath.view.trajectory.segments.some((segment) => segment.kind === 'model'), true)
    assert.doesNotMatch(JSON.stringify(await readFile(stateFile, 'utf8')), /private-tool-name|private tool result/u)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('cold replay keeps the most recently active timeline when creation order is stale', async () => {
  const stateFile = join(tmpdir(), `dsh-jingxi-session-recency-${process.pid}-${Date.now()}.json`)
  const baseEvents = [
    { seq: 0, type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { seq: 1, type: 'turn/start', time: 100, data: { turn: 1 } },
    { seq: 2, type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { seq: 3, type: 'assistant/chunk', time: 200, data: { turn: 1, step: 1, chunk: { type: 'text-delta' } } },
    { seq: 4, type: 'assistant/message', time: 300, data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 4 } } },
    { seq: 5, type: 'step/end', time: 300, data: { turn: 1, step: 1 } },
    { seq: 6, type: 'turn/end', time: 400, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const activeEvents = baseEvents.map((event) => ({ ...event, time: event.time + 1000 }))
  const sessionQuery = {
    async listSessions() {
      return [
        { header: { id: 'newer-created', createdAt: 300 }, live: false, persisted: true },
        { header: { id: 'newer-activity', createdAt: 200 }, live: false, persisted: true },
      ]
    },
    async readSession(sessionId) {
      return { session: { id: sessionId }, events: sessionId === 'newer-activity' ? activeEvents : baseEvents }
    },
  }
  const sessions = { list: () => [{ id: 'live-stale', events: baseEvents }] }

  try {
    const handlers = makePluginHarness(undefined, { stateFile }, { sessionQuery, sessions })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'real')
    assert.equal(breath.view.sessionSummary.updatedAt, 1400)
    assert.equal(breath.view.trajectory.endMs, 1400)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('session/event folds the official second event argument when the session has no event list', async () => {
  const directory = await mkdtemp(join(tmpdir(), `dsh-jingxi-event-argument-${process.pid}-`))
  const stateFile = join(directory, 'breath-latest.json')
  const listener = makeEventListener(stateFile)
  const session = { id: 'session-event-argument', events: [] }
  const event = { seq: 0, type: 'turn/start', time: 100, data: { turn: 4 } }

  try {
    assert.equal(typeof listener, 'function')
    await listener(session, event)
    const payload = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(payload.view.kind, 'live')
    assert.equal(payload.view.live.turn, 4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('breath endpoint ignores trailing bytes from an interrupted persisted write', async () => {
  const stateFile = join(tmpdir(), `dsh-jingxi-persisted-corrupt-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true,
    real: true,
    source: 'real',
    demo: false,
    sessionId: 'session-interrupted-write',
    writtenAt: '2026-08-21T04:40:06.718Z',
    view: {
      kind: 'idle',
      last: {
        turn: 8,
        status: 'completed',
        avgTps: 288,
        totalTokens: 900,
        cachePct: 0.8,
        durationMs: 1800,
        curveQuality: 'authoritative-calibrated',
        sparkline: [
          { tMs: 1000, rateTokS: 100, cumulativeOutputTokens: 100 },
          { tMs: 2000, rateTokS: 288, cumulativeOutputTokens: 576 },
        ],
      },
      recent: [],
    },
  }
  // This mirrors the observed failure mode: a valid snapshot followed by the
  // beginning of a second concurrent write. The safe projection must survive
  // the trailing bytes because no raw conversation content is read here.
  await writeFile(stateFile, `${JSON.stringify(persisted)}76904176475},{"tMs":1787287149543`, 'utf8')
  try {
    const handlers = makePluginHarness(undefined, { stateFile })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    assert.equal(result.status, 200)
    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'persisted')
    assert.equal(breath.stale, true)
    assert.equal(breath.view.last.turn, 8)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('session events persist into the configured state file instead of the process default', async () => {
  const directory = await mkdtemp(join(tmpdir(), `dsh-jingxi-state-override-${process.pid}-`))
  const stateFile = join(directory, 'breath-latest.json')
  const listener = makeEventListener(stateFile)
  const session = {
    id: 'session-state-override',
    events: [
      { type: 'request/context', time: 1, data: { provider: 'test', model: 'model' } },
      { type: 'turn/start', time: 100, data: { turn: 4 } },
      { type: 'step/start', time: 100, data: { turn: 4, step: 1 } },
      { type: 'assistant/chunk', time: 200, data: { turn: 4, step: 1, chunk: { type: 'text-delta' } } },
      { type: 'tool/call', time: 250, data: { name: 'do-not-persist-this-value' } },
      { type: 'tool/result', time: 275, data: { content: 'do-not-persist-this-value' } },
      { type: 'assistant/message', time: 300, data: { turn: 4, step: 1, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 } } },
      { type: 'step/end', time: 300, data: { turn: 4, step: 1 } },
      { type: 'turn/end', time: 400, data: { turn: 4, reason: { kind: 'completed' } } },
    ],
  }

  try {
    assert.equal(typeof listener, 'function')
    await listener(session)
    const payload = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(payload.view.last.turn, 4)
    assert.equal(payload.view.last.status, 'completed')
    assert.deepEqual(payload.view.last.eventTicks, [{ tMs: 250, kind: 'tool' }])
    assert.deepEqual(payload.view.sessionSummary, {
      rounds: 1,
      steps: 1,
      llmDurationMs: 200,
      toolDurationMs: 25,
      avgTtftMs: 100,
      avgTps: 20,
      cachePct: 0.75,
      inputTokens: 4,
      outputTokens: 2,
      curveQuality: 'authoritative-calibrated',
      updatedAt: 400,
    })
    assert.equal(payload.view.trajectory.segments.some((segment) => segment.kind === 'model'), true)
    assert.equal(payload.view.trajectory.segments.some((segment) => segment.kind === 'tool'), true)
    assert.doesNotMatch(JSON.stringify(payload), /do-not-persist-this-value/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('breath endpoint exposes a stable desensitized session fingerprint for the live real session', async () => {
  const directory = await mkdtemp(join(tmpdir(), `dsh-jingxi-fingerprint-${process.pid}-`))
  const stateFile = join(directory, 'breath-latest.json')
  // 同一 apply 内既有 session/event listener 又有 web 路由：listener 折叠后
  // realFold.current 就位，端点返回 source=real（真实会话分支）。
  const handlers = new Map()
  let listener
  const ctx = {
    webServer: {
      register(meta) { handlers.set(meta.path, meta.handler); return () => {} },
    },
    effect(effect) { return effect() },
    inject() {},
    on(name, handler) { if (name === 'session/event') listener = handler },
    credentials: undefined,
    logger: {},
  }
  apply(ctx, { stateFile })
  assert.equal(typeof listener, 'function')
  await listener({
    id: 'raw-session-path-\\private\\segments\\session-9f3a',
    events: [
      { type: 'turn/start', time: 100, data: { turn: 3 } },
      { type: 'step/start', time: 100, data: { turn: 3, step: 1 } },
      { type: 'assistant/chunk', time: 200, data: { turn: 3, step: 1, chunk: { type: 'text-delta' } } },
      { type: 'assistant/message', time: 300, data: { turn: 3, step: 1, usage: { outputTokens: 8 } } },
      { type: 'step/end', time: 300, data: { turn: 3, step: 1 } },
      { type: 'turn/end', time: 400, data: { turn: 3, reason: { kind: 'completed' } } },
    ],
  })

  try {
    const first = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, first.response)
    const firstPayload = JSON.parse(first.result.body)

    assert.equal(firstPayload.source, 'real')
    assert.match(firstPayload.sessionId, /^[0-9a-f]{16}$/u, 'real branch exposes a stable 16-hex fingerprint at response top level')
    assert.equal(firstPayload.view.sessionId, firstPayload.sessionId, 'view top-level sessionId matches the response top level')
    // 原始会话标识（含路径片段）绝不进入响应体。
    assert.doesNotMatch(first.result.body, /raw-session-path|session-9f3a|private\\segments/u)

    // 指纹在重放/持久化恢复后保持稳定（同一会话二次请求 → 同一指纹）。
    const second = responseRecorder()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, second.response)
    const secondPayload = JSON.parse(second.result.body)
    assert.equal(secondPayload.sessionId, firstPayload.sessionId, 'fingerprint is stable across requests for the same session')
    assert.equal(secondPayload.view.sessionId, firstPayload.sessionId)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('persisted Breath snapshots remain parseable when writes overlap', async () => {
  const directory = await mkdtemp(join(tmpdir(), `dsh-jingxi-atomic-${process.pid}-`))
  const stateFile = join(directory, 'breath-latest.json')
  try {
    await Promise.all(Array.from({ length: 12 }, (_, turn) => writePersistedBreathSnapshot(stateFile, {
      ok: true,
      real: true,
      source: 'real',
      demo: false,
      view: {
        kind: 'idle',
        last: {
          turn,
          status: 'completed',
          avgTps: 200 + turn,
          durationMs: 1000 + turn,
          curveQuality: 'authoritative-calibrated',
          sparkline: Array.from({ length: 200 }, (_, index) => ({
            tMs: index,
            rateTokS: turn + index,
            cumulativeOutputTokens: index,
          })),
        },
        recent: [],
      },
    })))

    const payload = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(payload.ok, true)
    assert.equal(payload.view.last.status, 'completed')
    assert.ok(payload.view.last.turn >= 0 && payload.view.last.turn < 12)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('update check exposes a read-only compatibility alias and a stable failure status', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'registry unavailable' })
    const handlers = makePluginHarness()
    for (const path of ['/api/jingxi/update', '/api/jingxi/update-check']) {
      assert.equal(typeof handlers.get(path), 'function', `${path} should be registered`)
      const { result, response } = responseRecorder()
      await handlers.get(path)({ method: 'GET' }, response)
      assert.equal(result.status, 503)
      const payload = JSON.parse(result.body)
      assert.equal(payload.ok, false)
      assert.equal(payload.errorCode, 'registry-unavailable')
      assert.equal(payload.error, '暂时无法连接更新源，请稍后重试。')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('update verification status is durable across plugin reloads and stays pending without watchdog proof', async () => {
  const root = await mkdtemp(join(tmpdir(), `dsh-jingxi-update-status-${process.pid}-`))
  const originalFetch = globalThis.fetch
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    await mkdir(join(root, 'logs', 'jingxi-update'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.9' } }))
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.9' }))
    await writeFile(join(root, 'logs', 'jingxi-update', 'post-restart-verification.json'), JSON.stringify({
      version: 1,
      state: 'pending',
      restartId: 'test-restart',
      expectedVersion: '0.1.0-rc.9',
      previousBootId: 'boot-old',
      requestedAt: '2026-08-24T03:00:00.000Z',
    }))
    globalThis.fetch = async (url) => String(url).includes('/api/system/health')
      ? { ok: true, status: 200, text: async () => JSON.stringify({ ready: true, bootId: 'boot-new', pid: 4321 }) }
      : { ok: true, status: 200, text: async () => JSON.stringify({ version: '0.1.0-rc.9' }) }

    const handlers = makePluginHarness(undefined, { dshRoot: root })
    const { result, response } = responseRecorder()
    await handlers.get('/api/jingxi/update/status')({ method: 'GET', url: '/api/jingxi/update/status?restartId=test-restart' }, response)

    assert.equal(result.status, 200)
    const payload = JSON.parse(result.body)
    assert.equal(payload.state, 'verification-pending')
    assert.equal(payload.complete, false)
    assert.equal(payload.verified, false)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

