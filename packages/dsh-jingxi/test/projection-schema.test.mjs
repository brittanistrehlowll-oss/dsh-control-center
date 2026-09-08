import assert from 'node:assert/strict'
import test from 'node:test'

import { jingxiProjectionDefinition } from '../lib/index.js'
import { applyJingxiFold, initJingxiFold, viewJingxiFold } from '../lib/telemetry-fold.js'

test('jingxi projection exposes a parser for history restoration', () => {
  assert.equal(typeof jingxiProjectionDefinition.schema?.parse, 'function')

  const view = jingxiProjectionDefinition.view(jingxiProjectionDefinition.init())
  assert.deepEqual(jingxiProjectionDefinition.schema.parse(view), view)
})

test('jingxi projection rejects an invalid persisted view', () => {
  assert.throws(
    () => jingxiProjectionDefinition.schema.parse({ kind: 'broken', recent: [] }),
    /jingxi projection view/
  )
})

test('jingxi projection parses a settled view produced by the fold', () => {
  let state = initJingxiFold()
  const events = [
    { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { type: 'turn/start', time: 100, data: { turn: 1 } },
    { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', time: 200, data: { chunk: { type: 'text-delta' } } },
    { type: 'assistant/message', time: 400, data: { usage: { inputTokens: 10, outputTokens: 20 } } },
    { type: 'step/end', time: 500, data: {} },
    { type: 'turn/end', time: 600, data: { reason: { kind: 'completed' } } },
  ]
  for (const event of events) state = applyJingxiFold(state, event)

  const view = viewJingxiFold(state, 600)
  assert.equal(view.kind, 'idle')
  assert.equal(view.recent.length, 1)
  assert.deepEqual(jingxiProjectionDefinition.schema.parse(view), view)
})

test('jingxi projection exposes safe event ticks on the same timeline as the curve', () => {
  let state = initJingxiFold()
  const events = [
    { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { type: 'turn/start', time: 100, data: { turn: 2 } },
    { type: 'step/start', time: 100, data: { turn: 2, step: 1 } },
    { type: 'assistant/chunk', time: 200, data: { chunk: { type: 'text-delta' } } },
    { type: 'tool/call', time: 300, data: { name: 'do-not-project-this-value' } },
    { type: 'tool/result', time: 400, data: { content: 'do-not-project-this-value' } },
    { type: 'llm_retry', time: 450, data: { error: 'do-not-project-this-value' } },
    { type: 'assistant/message', time: 500, data: { usage: { inputTokens: 10, outputTokens: 20 } } },
    { type: 'step/end', time: 550, data: {} },
    { type: 'turn/end', time: 600, data: { reason: { kind: 'completed' } } },
  ]
  for (const event of events) state = applyJingxiFold(state, event)

  const view = viewJingxiFold(state, 600)
  assert.deepEqual(view.last.eventTicks, [
    { tMs: 300, kind: 'tool' },
    { tMs: 450, kind: 'retry' },
  ])
  assert.doesNotMatch(JSON.stringify(view), /do-not-project-this-value/u)
  assert.deepEqual(jingxiProjectionDefinition.schema.parse(view), view)
})

test('jingxi projection rejects event ticks with unknown kinds', () => {
  assert.throws(
    () => jingxiProjectionDefinition.schema.parse({
      kind: 'idle',
      last: {
        turn: 1,
        status: 'completed',
        durationMs: 10,
        curveQuality: 'estimated-final',
        sparkline: [],
        eventTicks: [{ tMs: 1, kind: 'raw-content' }],
      },
      recent: [],
    }),
    /eventTicks.*kind/u,
  )
})

test('jingxi projection validates the session summary and trajectory contract', () => {
  const view = {
    kind: 'idle',
    recent: [],
    sessionSummary: {
      rounds: 8,
      steps: 73,
      llmDurationMs: 1000,
      toolDurationMs: 1200,
      avgTtftMs: 100,
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
  }

  assert.deepEqual(jingxiProjectionDefinition.schema.parse(view), view)
  assert.throws(
    () => jingxiProjectionDefinition.schema.parse({
      ...view,
      trajectory: { ...view.trajectory, segments: [{ kind: 'prompt', startMs: 1000, endMs: 1100 }] },
    }),
    /trajectory.*segments.*kind/u,
  )
})

// ── P1 activitySummary schema 层测试块 ────────────────────────────────────
// 来源：verification/p0-patches/dsh-activity-summary-tests.md（T3/T4）
// jingxiProjectionDefinition.schema === lib/telemetry-fold.js 的 jingxiProjectionSchema。

test('activitySummary schema accepts estimated quality and rejects unknown qualities', () => {
  const valid = {
    kind: 'idle', recent: [],
    last: {
      turn: 7, status: 'completed', durationMs: 100, curveQuality: 'estimated-final', sparkline: [],
      activitySummary: {
        version: 1, scope: 'turn', turnId: '7', turnNumber: 7, generatedAt: '2026-08-25T00:00:00.000Z',
        generic: { inputSteps: 2, toolCalls: 1, modelGenerations: 1 },
        activities: { webSearch: { count: 1, quality: 'estimated' } },
      },
    },
  }
  assert.deepEqual(jingxiProjectionDefinition.schema.parse(valid), valid)
  assert.throws(
    () => jingxiProjectionDefinition.schema.parse({
      ...valid,
      last: { ...valid.last, activitySummary: { ...valid.last.activitySummary, activities: { webSearch: { count: 1, quality: 'raw' } } } },
    }),
    /quality/u,
  )
})

test('activitySummary remains optional in the projection schema', () => {
  const legacy = {
    kind: 'idle', recent: [],
    last: { turn: 1, status: 'completed', durationMs: 10, curveQuality: 'estimated-final', sparkline: [] },
  }
  assert.deepEqual(jingxiProjectionDefinition.schema.parse(legacy), legacy)
})

// ── P1 activitySummary 持久化集成测试块（T5/T6/T7）────────────────────────
// 来源：verification/p0-patches/dsh-activity-summary-tests.md（二、index.js 集成测试）。
// 原建议追加到 index-contract.test.mjs 末尾，但本任务写权限仅允许向
// telemetry-session-summary / projection-schema 两文件末尾追加，故在此提供
// 与 index-contract.test.mjs 语义相同的最小 harness（动态 import，不改文件头部）。

test('breath endpoint restores activitySummary from a persisted snapshot', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { writeFile, rm } = await import('node:fs/promises')
  const { apply } = await import('../lib/index.js')

  const stateFile = join(tmpdir(), `dsh-jingxi-activity-summary-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true, real: true, source: 'real', demo: false,
    writtenAt: '2026-08-25T00:00:00.000Z',
    view: {
      kind: 'idle', recent: [],
      last: {
        turn: 7, status: 'completed', avgTps: 12, totalTokens: 30, cachePct: 0.5, durationMs: 100,
        curveQuality: 'estimated-final', sparkline: [],
        activitySummary: {
          version: 1, scope: 'turn', turnId: '7', turnNumber: 7,
          generatedAt: '2026-08-25T00:00:00.000Z',
          generic: { inputSteps: 2, toolCalls: 1, modelGenerations: 1 },
          activities: { readProject: { count: 1, quality: 'exact' } },
        },
      },
    },
  }
  await writeFile(stateFile, JSON.stringify(persisted), 'utf8')
  try {
    const handlers = new Map()
    const ctx = {
      webServer: { register(meta) { handlers.set(meta.path, meta.handler); return () => {} } },
      effect(effect) { return effect() },
      inject() {},
      on() {},
      logger: {},
    }
    apply(ctx, { stateFile })
    const { result, response } = (() => {
      const result = { status: undefined, headers: undefined, body: undefined }
      return {
        result,
        response: {
          writeHead(status, headers) { result.status = status; result.headers = headers },
          end(body) { result.body = body },
        },
      }
    })()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    assert.equal(result.status, 200)
    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'persisted')
    assert.deepEqual(breath.view.last.activitySummary, persisted.view.last.activitySummary)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('persisted activitySummary with an unknown quality is dropped, not fabricated', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { writeFile, rm } = await import('node:fs/promises')
  const { apply } = await import('../lib/index.js')

  const stateFile = join(tmpdir(), `dsh-jingxi-activity-summary-bad-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true, real: true, source: 'real', demo: false,
    view: {
      kind: 'idle', recent: [],
      last: {
        turn: 8, status: 'completed', durationMs: 100, curveQuality: 'estimated-final', sparkline: [],
        activitySummary: {
          version: 1, scope: 'turn', turnId: '8', turnNumber: 8,
          generatedAt: '2026-08-25T00:00:00.000Z',
          generic: { inputSteps: 1, toolCalls: 0, modelGenerations: 0 },
          activities: { readProject: { count: 1, quality: 'raw' } },
        },
      },
    },
  }
  await writeFile(stateFile, JSON.stringify(persisted), 'utf8')
  try {
    const handlers = new Map()
    const ctx = {
      webServer: { register(meta) { handlers.set(meta.path, meta.handler); return () => {} } },
      effect(effect) { return effect() },
      inject() {},
      on() {},
      logger: {},
    }
    apply(ctx, { stateFile })
    const { result, response } = (() => {
      const result = { status: undefined, headers: undefined, body: undefined }
      return {
        result,
        response: {
          writeHead(status, headers) { result.status = status; result.headers = headers },
          end(body) { result.body = body },
        },
      }
    })()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)

    const breath = JSON.parse(result.body)
    assert.equal(breath.source, 'persisted')
    assert.equal(breath.view.last.activitySummary, undefined)
    // 其余合法性不受影响（读侧按字段丢弃，不整树拒绝）
    assert.equal(breath.view.last.turn, 8)
  } finally {
    await rm(stateFile, { force: true })
  }
})

test('session events fold activitySummary into the snapshot without tool-name leakage', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { apply } = await import('../lib/index.js')

  const directory = await mkdtemp(join(tmpdir(), `dsh-jingxi-activity-snapshot-${process.pid}-`))
  const stateFile = join(directory, 'breath-latest.json')
  let listener
  const ctx = {
    webServer: { register() { return () => {} } },
    effect(effect) { return effect() },
    inject() {},
    on(name, handler) { if (name === 'session/event') listener = handler },
    logger: {},
  }
  apply(ctx, { stateFile })
  try {
    await listener({
      id: 'session-activity',
      events: [
        { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
        { type: 'turn/start', time: 100, data: { turn: 9 } },
        { type: 'step/start', time: 100, data: { turn: 9, step: 1 } },
        { type: 'assistant/chunk', time: 110, data: { turn: 9, step: 1, chunk: { type: 'text-delta' } } },
        { type: 'tool/call', time: 120, data: { turn: 9, step: 1, callId: 'x1', name: 'web_search' } },
        { type: 'tool/result', time: 130, data: { turn: 9, step: 1, message: { source: { callId: 'x1' }, content: 'secret' } } },
        { type: 'assistant/message', time: 150, data: { turn: 9, step: 1, usage: { inputTokens: 1, outputTokens: 2 } } },
        { type: 'step/end', time: 150, data: { turn: 9, step: 1 } },
        { type: 'turn/end', time: 200, data: { turn: 9, reason: { kind: 'completed' } } },
      ],
    })
    const payload = JSON.parse(await readFile(stateFile, 'utf8'))
    const summary = payload.view.last.activitySummary
    assert.equal(summary.turnId, '9')
    assert.equal(summary.generic.toolCalls, 1)
    assert.equal(summary.activities.webSearch.count, 1)
    assert.equal(summary.activities.answer.count, 1)
    assert.doesNotMatch(JSON.stringify(payload), /web_search|secret/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// ── V5.6 tok/s 五档：persistedView（index.js）透传 rateQuality（可空）────────
// 合法值（exact/estimated/historical/session/unavailable）随 last/recent/live/
// sessionSummary 持久化解析透传；非法/缺省值丢弃（不整树拒绝）。

test('persisted view carries legal rateQuality through restore and drops illegal values', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { writeFile, rm } = await import('node:fs/promises')
  const { apply } = await import('../lib/index.js')

  const persistAndServe = async (stateFile) => {
    const handlers = new Map()
    const ctx = {
      webServer: { register(meta) { handlers.set(meta.path, meta.handler); return () => {} } },
      effect(effect) { return effect() },
      inject() {},
      on() {},
      logger: {},
    }
    apply(ctx, { stateFile })
    const { result, response } = (() => {
      const result = { status: undefined, headers: undefined, body: undefined }
      return {
        result,
        response: {
          writeHead(status, headers) { result.status = status; result.headers = headers },
          end(body) { result.body = body },
        },
      }
    })()
    await handlers.get('/api/jingxi/breath/current')({ method: 'GET' }, response)
    return JSON.parse(result.body)
  }

  const stateFile = join(tmpdir(), `dsh-jingxi-rate-quality-${process.pid}-${Date.now()}.json`)
  const persisted = {
    ok: true, real: true, source: 'real', demo: false,
    view: {
      kind: 'live',
      live: { turn: 9, durationMs: 400, estimateRateTokS: 88, rateQuality: 'exact', openStep: 1 },
      last: {
        turn: 8, status: 'completed', avgTps: 120, durationMs: 300,
        curveQuality: 'authoritative-calibrated', rateQuality: 'historical', sparkline: [],
      },
      recent: [
        { turn: 7, status: 'completed', avgTps: 50, durationMs: 200, curveQuality: 'estimated-final', rateQuality: 'historical', sparkline: [] },
      ],
      sessionSummary: {
        rounds: 2, steps: 4, avgTps: 74, curveQuality: 'authoritative-calibrated', rateQuality: 'session', updatedAt: 1000,
      },
    },
  }
  await writeFile(stateFile, JSON.stringify(persisted), 'utf8')
  try {
    const breath = await persistAndServe(stateFile)
    assert.equal(breath.source, 'persisted')
    assert.equal(breath.view.live.rateQuality, 'exact')
    assert.equal(breath.view.last.rateQuality, 'historical')
    assert.equal(breath.view.recent[0].rateQuality, 'historical')
    assert.equal(breath.view.sessionSummary.rateQuality, 'session')
    assert.equal(breath.view.live.estimateRateTokS, 88)
  } finally {
    await rm(stateFile, { force: true })
  }

  const badFile = join(tmpdir(), `dsh-jingxi-rate-quality-bad-${process.pid}-${Date.now()}.json`)
  const persistedBad = {
    ok: true, real: true, source: 'real', demo: false,
    view: {
      kind: 'idle', recent: [],
      last: {
        turn: 10, status: 'completed', durationMs: 100, curveQuality: 'estimated-final', rateQuality: 'realtime', sparkline: [],
      },
      sessionSummary: { rounds: 1, steps: 1, curveQuality: 'estimated-final', rateQuality: 'live', updatedAt: 100 },
    },
  }
  await writeFile(badFile, JSON.stringify(persistedBad), 'utf8')
  try {
    const breath = await persistAndServe(badFile)
    assert.equal(breath.source, 'persisted')
    assert.equal(breath.view.last.rateQuality, undefined, 'illegal rateQuality is dropped, not fabricated')
    assert.equal(breath.view.last.turn, 10, 'the rest of the summary stays intact')
    assert.equal(breath.view.sessionSummary.rateQuality, undefined)
  } finally {
    await rm(badFile, { force: true })
  }
})
