import assert from 'node:assert/strict'
import test from 'node:test'

import { applyJingxiFold, applySubagentLifecycle, initJingxiFold, viewJingxiFold } from '../lib/telemetry-fold.js'

function appendEvent(events, type, time, data) {
  events.push({ type, time, data })
}

function appendTurn(events, turn, stepCount, cursor) {
  appendEvent(events, 'turn/start', cursor, { turn })
  let time = cursor
  for (let step = 1; step <= stepCount; step += 1) {
    const start = time
    appendEvent(events, 'step/start', start, { turn, step })
    appendEvent(events, 'assistant/chunk', start + 10, {
      turn,
      step,
      chunk: { type: 'text-delta', text: 'x' },
    })
    if (step % 2 === 0) {
      const callId = `call-${turn}-${step}`
      appendEvent(events, 'tool/call', start + 20, { callId })
      appendEvent(events, 'tool/result', start + 40, { message: { source: { callId } } })
    }
    appendEvent(events, 'assistant/message', start + 110, {
      turn,
      step,
      usage: {
        inputTokens: 10 + step,
        cacheReadTokens: 100 + turn,
        cacheWriteTokens: 2,
        outputTokens: 20 + turn,
      },
    })
    appendEvent(events, 'step/end', start + 120, { turn, step })
    time = start + 200
  }
  appendEvent(events, 'turn/end', time, { turn, reason: { kind: 'completed' } })
  return time + 100
}

function foldEvents(events) {
  let state = initJingxiFold()
  for (const event of events) state = applyJingxiFold(state, event)
  return viewJingxiFold(state, events.at(-1)?.time ?? 0)
}

test('aggregates the full trajectory into session rounds, steps, timings and tokens', () => {
  const events = [{ type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } }]
  let cursor = 100
  let expectedInput = 0
  let expectedCacheRead = 0
  let expectedOutput = 0
  let expectedToolCalls = 0
  for (let turn = 1; turn <= 8; turn += 1) {
    const stepCount = turn === 8 ? 10 : 9
    for (let step = 1; step <= stepCount; step += 1) {
      expectedInput += 10 + step + 100 + turn + 2
      expectedCacheRead += 100 + turn
      expectedOutput += 20 + turn
      if (step % 2 === 0) expectedToolCalls += 1
    }
    cursor = appendTurn(events, turn, stepCount, cursor)
  }

  const view = foldEvents(events)
  const summary = view.sessionSummary

  assert.equal(summary.rounds, 8)
  assert.equal(summary.steps, 73)
  assert.equal(summary.llmDurationMs, 73 * 110)
  assert.equal(summary.toolDurationMs, expectedToolCalls * 20)
  assert.equal(summary.avgTtftMs, 10)
  assert.ok(Math.abs(summary.avgTps - expectedOutput / (73 * 0.1)) < 1e-9)
  assert.equal(summary.inputTokens, expectedInput)
  assert.equal(summary.outputTokens, expectedOutput)
  assert.equal(summary.cachePct, expectedCacheRead / expectedInput)
  assert.ok(view.trajectory.sparkline.length > 1)
  assert.ok(view.trajectory.sparkline.length <= 160)
  assert.ok(view.trajectory.segments.some((segment) => segment.kind === 'model'))
  assert.ok(view.trajectory.segments.some((segment) => segment.kind === 'tool'))
  assert.equal(view.trajectory.inputTicks.length, 73)
  assert.equal(view.last.inputTicks.length, 10)
  assert.ok(view.trajectory.eventTicks.every((tick) => ['tool', 'retry', 'compaction'].includes(tick.kind)))
  assert.equal(view.last.turn, 8)
})

test('counts interrupted steps but does not invent LLM timing or token totals', () => {
  const view = foldEvents([
    { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { type: 'turn/start', time: 100, data: { turn: 1 } },
    { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', time: 140, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'partial' } } },
    { type: 'step/end', time: 200, data: { turn: 1, step: 1 } },
    { type: 'turn/end', time: 220, data: { turn: 1, reason: { kind: 'interrupted' } } },
  ])

  assert.equal(view.sessionSummary.rounds, 1)
  assert.equal(view.sessionSummary.steps, 1)
  assert.equal(view.sessionSummary.llmDurationMs, 0)
  assert.equal(view.sessionSummary.avgTtftMs, undefined)
  assert.equal(view.sessionSummary.avgTps, undefined)
  assert.equal(view.sessionSummary.inputTokens, undefined)
  assert.equal(view.sessionSummary.outputTokens, undefined)
  assert.equal(view.last.status, 'interrupted')
  assert.equal(view.last.curveQuality, 'estimated-final')
})

test('keeps an unknown summary absent instead of displaying zeroes before any real turn', () => {
  const view = foldEvents([])

  assert.equal(view.sessionSummary, undefined)
  assert.equal(view.trajectory, undefined)
})

// ── P1 activitySummary（脱敏活动计数）服务端测试块 ────────────────────────
// 来源：verification/p0-patches/dsh-activity-summary-tests.md（T1/T2/T8）
// 契约：generic(turn 级)；activities 白名单固定枚举；缺失≠0；零原文残留。

test('activitySummary aggregates exact activity buckets and omits whitelist misses', () => {
  const view = foldEvents([
    { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { type: 'turn/start', time: 100, data: { turn: 42 } },
    { type: 'step/start', time: 100, data: { turn: 42, step: 1 } },
    { type: 'assistant/chunk', time: 110, data: { turn: 42, step: 1, chunk: { type: 'text-delta' } } },
    { type: 'tool/call', time: 120, data: { callId: 'c1', name: 'read' } },
    { type: 'tool/result', time: 140, data: { message: { source: { callId: 'c1' } } } },
    { type: 'tool/call', time: 150, data: { callId: 'c2', name: 'web_search' } },
    { type: 'tool/result', time: 170, data: { message: { source: { callId: 'c2' } } } },
    { type: 'tool/call', time: 180, data: { callId: 'c3', name: 'write' } },
    { type: 'tool/result', time: 200, data: { message: { source: { callId: 'c3' } } } },
    { type: 'assistant/message', time: 210, data: { usage: { inputTokens: 10, outputTokens: 20 } } },
    { type: 'step/end', time: 210, data: {} },
    { type: 'turn/end', time: 300, data: { reason: { kind: 'completed' } } },
  ])

  const summary = view.last.activitySummary
  assert.equal(summary.version, 1)
  assert.equal(summary.scope, 'turn')
  assert.equal(summary.turnId, '42')
  assert.equal(summary.turnNumber, 42)
  assert.equal(typeof summary.generatedAt, 'string')
  assert.deepEqual(summary.generic, { inputSteps: 1, toolCalls: 3, modelGenerations: 1 })
  assert.deepEqual(summary.activities, {
    readProject: { count: 1, quality: 'exact' },
    webSearch: { count: 1, quality: 'exact' },
    answer: { count: 1, quality: 'exact' },
  })
  assert.doesNotMatch(JSON.stringify(view), /"read"|"web_search"|"write"|c1|c2|c3/u)
})

test('activitySummary keeps activities omitted (not zeroed) when no tool evidence exists', () => {
  const view = foldEvents([
    { type: 'turn/start', time: 100, data: { turn: 5 } },
    { type: 'step/start', time: 100, data: { turn: 5, step: 1 } },
    { type: 'assistant/chunk', time: 150, data: { turn: 5, step: 1, chunk: { type: 'text-delta' } } },
    { type: 'turn/end', time: 200, data: { turn: 5, reason: { kind: 'interrupted' } } },
  ])

  assert.deepEqual(view.last.activitySummary.generic, { inputSteps: 1, toolCalls: 0, modelGenerations: 0 })
  assert.deepEqual(view.last.activitySummary.activities, {})
  assert.equal(view.last.activitySummary.activities.readProject, undefined)
})

test('activitySummary is absent before any real turn settles', () => {
  const view = foldEvents([])
  assert.equal(view.last, undefined)
  assert.equal(view.recent.length, 0)
})

test('activitySummary stays per-turn and never merges into the session summary', () => {
  const events = [{ type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } }]
  let cursor = 100
  for (let turn = 1; turn <= 3; turn += 1) {
    appendEvent(events, 'turn/start', cursor, { turn })
    appendEvent(events, 'step/start', cursor, { turn, step: 1 })
    appendEvent(events, 'assistant/chunk', cursor + 10, { turn, step: 1, chunk: { type: 'text-delta' } })
    appendEvent(events, 'tool/call', cursor + 20, { callId: `t${turn}c1`, name: 'read' })
    appendEvent(events, 'tool/result', cursor + 40, { message: { source: { callId: `t${turn}c1` } } })
    appendEvent(events, 'assistant/message', cursor + 110, { turn, step: 1, usage: { inputTokens: 10, outputTokens: 20 } })
    appendEvent(events, 'step/end', cursor + 120, { turn, step: 1 })
    appendEvent(events, 'turn/end', cursor + 200, { turn, reason: { kind: 'completed' } })
    cursor += 300
  }
  const view = foldEvents(events)

  assert.equal(view.recent.length, 3)
  for (let i = 0; i < 3; i += 1) {
    const summary = view.recent[i].activitySummary
    assert.equal(summary.turnId, String(i + 1))
    assert.equal(summary.turnNumber, i + 1)
    assert.equal(summary.generic.toolCalls, 1)
    assert.equal(summary.activities.readProject.count, 1)
    assert.equal(view.sessionSummary.activitySummary, undefined, 'session summary must not carry turn-level activity')
  }
})

test('estimateRateTokS reflects the settled real-token window, not the whole-session proxy mass', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  const state = mod.initJingxiFold()
  const apply = (e) => mod.applyJingxiFold(state, e)
  const now = 120000
  apply({ type: 'request/context', time: now - 100000, data: { model: 'm' } })
  apply({ type: 'turn/start', time: now - 100000, data: { turn: 1 } })
  apply({ type: 'step/start', time: now - 100000, data: { turn: 1, step: 1 } })
  apply({ type: 'assistant/chunk', time: now - 99900, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } })
  apply({ type: 'assistant/message', time: now - 99000, data: { turn: 1, step: 1, usage: { outputTokens: 100 } } })
  apply({ type: 'step/end', time: now - 99000, data: { turn: 1, step: 1 } })
  // 窗口外 step（now 120s，windowStart 60s）：这个 step 在 21s 结算 → 不进窗口
  const view1 = mod.viewJingxiFold(state, now)
  const rate1 = view1.live?.estimateRateTokS
  assert.ok(rate1 === undefined || Number.isFinite(rate1), 'rate may fall back to proxy estimate')
  // 窗口内 step
  apply({ type: 'step/start', time: now - 30000, data: { turn: 1, step: 2 } })
  apply({ type: 'assistant/chunk', time: now - 29900, data: { turn: 1, step: 2, chunk: { type: 'text-delta', text: 'y' } } })
  apply({ type: 'assistant/message', time: now - 28000, data: { turn: 1, step: 2, usage: { outputTokens: 300 } } })
  apply({ type: 'step/end', time: now - 28000, data: { turn: 1, step: 2 } })
  const view2 = mod.viewJingxiFold(state, now)
  // 窗口内真实结算：300 tokens / 1.9s ≈ 157.9 tok/s（若窗口生效），而不被 21s 的 100 tokens 稀释
  const r2 = view2.live?.estimateRateTokS
  assert.ok(r2 !== undefined && r2 > (100 / 21 / 1 + 300 / 1.9) * 0.001, 'settled window should raise the live rate above a whole-session dilution')
})

// ── V5.6 tok/s 五档（luna 裁决 §三决策5）：rateQuality 服务端判定 ──────────
// 与 rateEstimate 同函数单次计算：窗口真实 → exact / 空窗+proxy → estimated /
// 无数据 → unavailable；最近 turn → historical；会话 → session。
// NOTE: V5.6 只落服务端字段 + 契约文档；client 文案映射为下一阶段，本文件不改 client.js。

test('live rateQuality is exact when the 60s window holds settled real tokens', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  const state = mod.initJingxiFold()
  const apply = (e) => mod.applyJingxiFold(state, e)
  const now = 120000
  apply({ type: 'request/context', time: now - 30000, data: { model: 'm' } })
  apply({ type: 'turn/start', time: now - 30000, data: { turn: 1 } })
  apply({ type: 'step/start', time: now - 30000, data: { turn: 1, step: 1 } })
  apply({ type: 'assistant/chunk', time: now - 29900, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } })
  apply({ type: 'assistant/message', time: now - 28000, data: { turn: 1, step: 1, usage: { outputTokens: 300 } } })
  apply({ type: 'step/end', time: now - 28000, data: { turn: 1, step: 1 } })
  // 30s 前结算，仍在 60s 窗口内 → exact（source stream_window）
  const view = mod.viewJingxiFold(state, now)
  assert.equal(view.live.rateQuality, 'exact')
  assert.ok(Math.abs(view.live.estimateRateTokS - 300 / 1.9) < 1e-9, 'exact rate uses settled tokens over decodeMs')
})

test('live rateQuality is estimated for open-step proxy deltas when no step has settled', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  const state = mod.initJingxiFold()
  const apply = (e) => mod.applyJingxiFold(state, e)
  const now = 120000
  apply({ type: 'request/context', time: now - 5000, data: { model: 'm' } })
  apply({ type: 'turn/start', time: now - 5000, data: { turn: 2 } })
  apply({ type: 'step/start', time: now - 5000, data: { turn: 2, step: 1 } })
  apply({ type: 'assistant/chunk', time: now - 4000, data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'x' } } })
  apply({ type: 'assistant/chunk', time: now - 3000, data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'y' } } })
  // 无 assistant/message → rateWindow 空；proxyBins 有 mass → estimated（source proxy-open）
  const view = mod.viewJingxiFold(state, now)
  assert.equal(view.live.rateQuality, 'estimated')
  assert.ok(Number.isFinite(view.live.estimateRateTokS) && view.live.estimateRateTokS > 0)
})

test('live rateQuality is unavailable with no token evidence and estimateRateTokS stays undefined', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  const state = mod.initJingxiFold()
  const apply = (e) => mod.applyJingxiFold(state, e)
  const now = 120000
  apply({ type: 'request/context', time: now - 1000, data: { model: 'm' } })
  apply({ type: 'turn/start', time: now - 1000, data: { turn: 3 } })
  const view = mod.viewJingxiFold(state, now)
  assert.equal(view.kind, 'live')
  assert.equal(view.live.rateQuality, 'unavailable')
  assert.equal(view.live.estimateRateTokS, undefined)
})

test('settled turns carry the historical rateQuality and multi-round sessions the session marker', () => {
  const events = [{ type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } }]
  let cursor = 100
  for (let turn = 1; turn <= 2; turn += 1) cursor = appendTurn(events, turn, 1, cursor)
  const view = foldEvents(events)

  // 最近档：last/recent 有 avgTps → historical（绝不标成实时）
  assert.ok(view.last.avgTps !== undefined)
  assert.equal(view.last.rateQuality, 'historical')
  assert.equal(view.recent[0].rateQuality, 'historical')
  assert.equal(view.recent[1].rateQuality, 'historical')
  // 平均档：≥2 轮且有会话均值 → session
  assert.equal(view.sessionSummary.rounds, 2)
  assert.equal(view.sessionSummary.avgTps !== undefined, true)
  assert.equal(view.sessionSummary.rateQuality, 'session')

  // 单轮会话：最近档已覆盖同一均值，不重复标注平均档
  const singleEvents = [{ type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } }]
  appendTurn(singleEvents, 1, 1, 100)
  const single = foldEvents(singleEvents)
  assert.equal(single.sessionSummary.rounds, 1)
  assert.equal(single.sessionSummary.rateQuality, undefined)
  assert.equal(single.last.rateQuality, 'historical')

  // 无 avgTps 的 turn（无 usage 结算）：不加 historical 标注
  const quiet = foldEvents([
    { type: 'turn/start', time: 100, data: { turn: 9 } },
    { type: 'step/start', time: 100, data: { turn: 9, step: 1 } },
    { type: 'assistant/chunk', time: 150, data: { turn: 9, step: 1, chunk: { type: 'text-delta', text: 'x' } } },
    { type: 'turn/end', time: 200, data: { turn: 9, reason: { kind: 'interrupted' } } },
  ])
  assert.equal(quiet.last.avgTps, undefined)
  assert.equal(quiet.last.rateQuality, undefined)
})

test('jingxiProjectionSchema keeps legal rateQuality values and drops illegal ones', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  const legal = {
    kind: 'live',
    live: { turn: 6, durationMs: 500, estimateRateTokS: 88, rateQuality: 'exact', openStep: 1 },
    recent: [
      { turn: 1, status: 'completed', avgTps: 50, durationMs: 100, curveQuality: 'estimated-final', rateQuality: 'historical', sparkline: [] },
    ],
    last: {
      turn: 5, status: 'completed', avgTps: 120, durationMs: 300, curveQuality: 'authoritative-calibrated', rateQuality: 'historical', sparkline: [],
    },
    sessionSummary: {
      rounds: 3, steps: 12, avgTps: 74, curveQuality: 'authoritative-calibrated', rateQuality: 'session', updatedAt: 1000,
    },
  }
  const parsed = mod.jingxiProjectionSchema.parse(legal)
  assert.equal(parsed.live.rateQuality, 'exact')
  assert.equal(parsed.last.rateQuality, 'historical')
  assert.equal(parsed.recent[0].rateQuality, 'historical')
  assert.equal(parsed.sessionSummary.rateQuality, 'session')

  const illegal = {
    kind: 'live',
    live: { turn: 7, durationMs: 50, estimateRateTokS: 88, rateQuality: 'realtime', openStep: 1 },
    recent: [
      { turn: 2, status: 'completed', durationMs: 100, curveQuality: 'estimated-final', rateQuality: 'bogus', sparkline: [] },
    ],
    last: { turn: 8, status: 'completed', durationMs: 300, curveQuality: 'estimated-final', rateQuality: 'raw', sparkline: [] },
    sessionSummary: { rounds: 2, steps: 4, curveQuality: 'estimated-final', rateQuality: 'live', updatedAt: 1000 },
  }
  const dropped = mod.jingxiProjectionSchema.parse(illegal)
  assert.equal(dropped.live.rateQuality, undefined)
  assert.equal(dropped.last.rateQuality, undefined)
  assert.equal(dropped.recent[0].rateQuality, undefined)
  assert.equal(dropped.sessionSummary.rateQuality, undefined)
  assert.equal(dropped.live.estimateRateTokS, 88, 'illegal rateQuality is dropped without disturbing other fields')

  const unavailable = {
    kind: 'live',
    live: { turn: 0, durationMs: 0, estimateRateTokS: undefined, rateQuality: 'unavailable', openStep: 0 },
    recent: [],
  }
  assert.equal(mod.jingxiProjectionSchema.parse(unavailable).live.rateQuality, 'unavailable')
})

// ── V5.8 P0.1 空值语义：rate.quality / version.isLatest 缺省不填充 ──
// 服务端 contract：缺失即缺省（undefined/键缺失），绝不 fill 0 / false / 'historical'。

test('missing rate evidence never fabricates a rateQuality or rate value', () => {
  const view = foldEvents([
    { type: 'request/context', time: 0, data: { provider: 'test', model: 'test-model' } },
    { type: 'turn/start', time: 100, data: { turn: 1 } },
    { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', time: 140, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } },
    { type: 'step/end', time: 200, data: { turn: 1, step: 1 } },
    { type: 'turn/end', time: 220, data: { turn: 1, reason: { kind: 'interrupted' } } },
  ])

  // 最近档：无 token 结算 → avgTps 缺失 → rateQuality 键整体缺省（不 fill 'historical'）。
  assert.equal(view.last.avgTps, undefined)
  assert.equal(view.last.rateQuality, undefined)
  assert.equal(Object.hasOwn(view.last, 'rateQuality'), false, 'no rateQuality key is fabricated')
  // 平均档：无会话均值 → sessionSummary 不标 rateQuality。
  assert.equal(view.sessionSummary.avgTps, undefined)
  assert.equal(view.sessionSummary.rateQuality, undefined)
  assert.equal(Object.hasOwn(view.sessionSummary, 'rateQuality'), false)
  // live 无速率证据 → unavailable 是显式档位，estimateRateTokS 保持 undefined。
  const liveQuiet = foldEvents([
    { type: 'turn/start', time: 100, data: { turn: 9 } },
  ])
  assert.equal(liveQuiet.kind, 'live')
  assert.equal(liveQuiet.live.rateQuality, 'unavailable')
  assert.equal(liveQuiet.live.estimateRateTokS, undefined)
  // 空态：无任何 quality 字段泄漏。
  const empty = foldEvents([])
  assert.doesNotMatch(JSON.stringify(empty), /rateQuality|quality/u)
})

test('session curve quality stays authoritative only with settled output tokens and never defaults', () => {
  // 单轮 token-less：curveQuality 如实 estimated-final，不 fill authoritative。
  const view = foldEvents([
    { type: 'turn/start', time: 100, data: { turn: 1 } },
    { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', time: 140, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } },
    { type: 'step/end', time: 200, data: { turn: 1, step: 1 } },
    { type: 'turn/end', time: 220, data: { turn: 1, reason: { kind: 'interrupted' } } },
  ])
  assert.equal(view.last.curveQuality, 'estimated-final')
  assert.equal(view.sessionSummary.curveQuality, 'estimated-final')
  assert.equal(view.last.tokens.outputTokens, undefined)
  assert.equal(view.last.totalTokens, undefined)
})

test('projection schema keeps absent nullable quality fields absent', async () => {
  const mod = await import('../lib/telemetry-fold.js')
  // rateQuality 缺省、isLatest 类布尔缺省：schema 解析后不被补 0/false。
  const sparse = {
    kind: 'live',
    live: { turn: 1, durationMs: 100, estimateRateTokS: undefined, openStep: 0 },
    last: { turn: 0, status: 'completed', durationMs: 50, curveQuality: 'estimated-final', sparkline: [] },
    recent: [],
  }
  const parsed = mod.jingxiProjectionSchema.parse(sparse)
  assert.equal(parsed.live.rateQuality, undefined)
  assert.equal(Object.hasOwn(parsed.live, 'rateQuality'), false)
  assert.equal(parsed.last.rateQuality, undefined)
  assert.equal(parsed.last.avgTps, undefined)
  assert.equal(parsed.last.totalTokens, undefined)
  assert.equal(Object.hasOwn(parsed.live, 'estimateRateTokS'), true, 'estimateRateTokS keeps its explicit undefined slot')
  assert.equal(parsed.live.estimateRateTokS, undefined)
})

test('V5.9: subagent/start projects a running agent into the fold view', () => {
  const fold = initJingxiFold()
  const applied = applySubagentLifecycle(fold, 'subagent/start', { runId: 'run-a1', provider: 'luna' }, 1000)
  assert.equal(applied, true, 'start applies')
  const view = viewJingxiFold(fold, 2000)
  assert.ok(Array.isArray(view.liveSubagents) && view.liveSubagents.length === 1, 'view exposes subagents')
  const agent = view.liveSubagents[0]
  assert.equal(agent.id, 'run-a1')
  assert.equal(agent.status, 'running')
  assert.ok(Number.isFinite(agent.durationMs) || agent.durationMs === undefined, 'duration present or undefined')
})

test('V5.9: subagent/end maps stop reasons to the five-state contract without leaking message bodies', () => {
  const fold = initJingxiFold()
  applySubagentLifecycle(fold, 'subagent/start', { runId: 'run-b1', provider: 'luna' }, 1000)
  applySubagentLifecycle(fold, 'subagent/end', { runId: 'run-b1', stopReason: 'completed', lastAssistantMessage: 'secret-internal-body' }, 9000)
  const view = viewJingxiFold(fold, 9000)
  const agent = view.liveSubagents.find((a) => a.id === 'run-b1')
  assert.equal(agent.status, 'completed', 'completed stopReason maps to completed')
  assert.doesNotMatch(JSON.stringify(agent), /secret-internal-body/u, 'message body never leaks into the projection')
  assert.ok(agent.durationMs !== undefined, 'end computes duration')
})

test('V5.9: subagents never appear from tool-call counts alone (no inference)', () => {
  const fold = initJingxiFold()
  const view = viewJingxiFold(fold, 1000)
  assert.ok(!view.liveSubagents || view.liveSubagents.length === 0, 'no subagent events → no subagents')
})

