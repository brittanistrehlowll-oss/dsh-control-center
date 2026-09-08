// ============================================================================
// dsh-jingxi ◊ 宿主折叠 JS 镜像（lib/telemetry-fold.js）
// 与 target 树 src/host/telemetry/{live-accumulator,turn-settler,jingxi-projection,
// metrics,curve-calibration}.ts 逐项等价（那些 TS 已由 tests/unit 58/58 验证）。
// 为什么有这个：Node 拒绝在 node_modules 下 strip TS 类型，而插件安在 node_modules；
// 生产发布路径是 tsdown/tsc 预编译（本机无 tsc）。此镜像只供本地 spike 使用，
// 并经过奇偶性校验（见 evidence/gate-2/parity）：同一合成事件日志 → TS 与 JS 输出一致。
// 授权红线不变：不存 raw chunk、view 只出小投影、jam record 不含 content。
// ============================================================================

// ── metrics 镜像 ─────────────────────────────────────────────────────────
function finiteNonNegative(v) { return v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined }

function totalTokens(tokens) {
  const vals = [finiteNonNegative(tokens.uncachedInputTokens), finiteNonNegative(tokens.cacheReadTokens),
    finiteNonNegative(tokens.cacheWriteTokens), finiteNonNegative(tokens.outputTokens)]
  if (vals.every(v => v === undefined)) return undefined
  return vals.reduce((s, v) => s + (v ?? 0), 0)
}
function cacheHit(tokens) {
  const read = finiteNonNegative(tokens.cacheReadTokens)
  const uncached = finiteNonNegative(tokens.uncachedInputTokens)
  const write = finiteNonNegative(tokens.cacheWriteTokens)
  if (read === undefined && uncached === undefined && write === undefined) return undefined
  const denominator = (read ?? 0) + (uncached ?? 0) + (write ?? 0)
  if (denominator <= 0) return undefined
  return (read ?? 0) / denominator
}
function authoritativeAverageTps(steps) {
  let tokens = 0, decodeMs = 0, valid = 0
  for (const step of steps) {
    const out = finiteNonNegative(step.outputTokens)
    const dec = finiteNonNegative(step.decodeMs)
    if (!step.usageAvailable || out === undefined || dec === undefined || dec <= 0) continue
    tokens += out; decodeMs += dec; valid += 1
  }
  if (valid === 0 || decodeMs <= 0) return undefined
  return tokens / (decodeMs / 1000)
}
function toolWorkMs(intervals) {
  return intervals.filter(i => i.type === 'tool').reduce((s, i) => s + Math.max(0, i.endMs - i.startMs), 0)
}
function toolWallMs(intervals) {
  const spans = intervals.filter(i => i.type === 'tool' && i.endMs > i.startMs)
    .map(i => [i.startMs, i.endMs]).sort((a, b) => a[0] - b[0])
  if (spans.length === 0) return 0
  let start = spans[0][0], end = spans[0][1], total = 0
  for (let i = 1; i < spans.length; i += 1) {
    const [ns, ne] = spans[i]
    if (ns <= end) { end = Math.max(end, ne); continue }
    total += end - start; start = ns; end = ne
  }
  return total + (end - start)
}

// Event ticks are deliberately metadata-only. They share the same monotonic
// time domain as sparkline points, but never carry tool names, error text or
// any other raw event payload into the projection.
const EVENT_TICK_KINDS = new Set(['tool', 'retry', 'compaction'])
const EVENT_TICK_CAP = 32
const INPUT_TICK_CAP = 128

function recordEventTick(live, kind, time) {
  if (live.turn === undefined || !EVENT_TICK_KINDS.has(kind) || !Number.isFinite(time)) return
  const previous = live.eventTicks[live.eventTicks.length - 1]
  if (previous && previous.kind === kind && previous.tMs === time) return
  live.eventTicks.push({ tMs: time, kind })
  if (live.eventTicks.length > EVENT_TICK_CAP) live.eventTicks.splice(0, live.eventTicks.length - EVENT_TICK_CAP)
}

// Input ticks are metadata-only step anchors. They make the DSH-style
// Input/Model/Tools strip possible without retaining prompt text or payloads.
function recordInputTick(live, time) {
  if (live.turn === undefined || !Number.isFinite(time)) return
  const previous = live.inputTicks[live.inputTicks.length - 1]
  if (previous && previous.tMs === time) return
  live.inputTicks.push({ tMs: time, kind: 'input' })
  if (live.inputTicks.length > INPUT_TICK_CAP) live.inputTicks.splice(0, live.inputTicks.length - INPUT_TICK_CAP)
}

function eventTickKind(type) {
  if (typeof type !== 'string') return undefined
  const normalized = type.toLowerCase().replace(/[._-]+/g, '/')
  if (normalized.includes('retry')) return 'retry'
  if (normalized.includes('compaction') || normalized.includes('compact')) return 'compaction'
  return undefined
}

// ── curve-calibration 镜像 ───────────────────────────────────────────────
function settleProxyBins(bins, output) {
  const safe = bins.filter(b => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
    .map(b => ({ ...b, mass: Number.isFinite(b.mass) && b.mass > 0 ? b.mass : 0 }))
  if (safe.length === 0) return []
  const proxyTotal = safe.reduce((s, b) => s + b.mass, 0)
  const o = output !== undefined && Number.isFinite(output) && output >= 0 ? output : undefined
  const scale = o !== undefined && proxyTotal > 0 ? o / proxyTotal : 1
  let cumulative = 0
  const points = safe.map(bin => {
    const settledMass = bin.mass * scale
    const durationSeconds = (bin.endMs - bin.startMs) / 1000
    cumulative += settledMass
    return { tMs: bin.endMs, rateTokS: durationSeconds > 0 ? settledMass / durationSeconds : 0, cumulativeOutputTokens: cumulative }
  })
  if (o !== undefined && points.length > 0) {
    points[points.length - 1] = { ...points[points.length - 1], cumulativeOutputTokens: o }
  }
  return points
}
function downsampleCurve(points, maxPoints) {
  if (maxPoints <= 0 || points.length === 0) return []
  if (points.length <= maxPoints) return points.map(p => ({ ...p }))
  if (maxPoints === 1) return [{ ...points[points.length - 1] }]
  const out = []
  for (let i = 0; i < maxPoints; i += 1) out.push({ ...points[Math.round((i * (points.length - 1)) / (maxPoints - 1))] })
  return out
}

// ── usage-adapter 镜像 ───────────────────────────────────────────────────
function toTokenBuckets(usage) {
  if (usage === undefined) return {}
  return { uncachedInputTokens: usage.inputTokens, cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0, outputTokens: usage.outputTokens }
}
function stepMetricOf(usage, firstTokenTime, stepStartMs, completedMs) {
  const b = toTokenBuckets(usage)
  const decodeMs = completedMs - firstTokenTime
  return {
    outputTokens: b.outputTokens !== undefined && Number.isFinite(b.outputTokens) && b.outputTokens >= 0 ? b.outputTokens : undefined,
    uncachedInputTokens: b.uncachedInputTokens,
    cacheReadTokens: b.cacheReadTokens,
    cacheWriteTokens: b.cacheWriteTokens,
    decodeMs: Number.isFinite(decodeMs) && decodeMs >= 0 ? decodeMs : undefined,
    ttftMs: Number.isFinite(firstTokenTime - stepStartMs) && firstTokenTime - stepStartMs >= 0 ? firstTokenTime - stepStartMs : undefined,
    usageAvailable: usage !== undefined,
  }
}

function isTokenDelta(chunk) {
  if (!chunk || typeof chunk !== 'object') return false
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  if (chunk.type === 'tool-call-delta') return chunk.argumentsDelta !== '' || chunk.name !== undefined
  return false
}

// ── live-accumulator 镜像 ────────────────────────────────────────────────
function newLive() {
  return {
    proxyBins: [], steps: [], stepCount: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0,
    toolIntervals: [], pendingTools: {}, fallbackToolStart: undefined, segments: [], eventTicks: [], inputTicks: [],
    activityCounts: newActivityCounts(), rateWindow: [],
  }
}
function beginTurn(live, turn, time) {
  Object.assign(live, {
    turn, startedAt: time, firstTokenTime: undefined, openStep: undefined,
    proxyBins: [], steps: [], stepCount: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0,
    toolIntervals: [], pendingTools: {}, fallbackToolStart: undefined, segments: [], eventTicks: [], inputTicks: [],
    activityCounts: newActivityCounts(),
  })
}
function closeOpenStep(live, endedAt) {
  const step = live.openStep
  if (step === undefined) return
  const dt0 = live.firstTokenTime
  const messageAt = step.messageAt
  const startedAt = step.startedAt ?? endedAt
  if (messageAt !== undefined) {
    live.llmMs += Math.max(0, messageAt - startedAt)
    if (dt0 !== undefined) {
      live.ttftMs += Math.max(0, dt0 - startedAt)
      live.ttftSteps += 1
      live.steps.push(stepMetricOf(step.usage, dt0, startedAt, messageAt))
    }
    if (messageAt > startedAt) live.segments.push({ kind: 'model', startMs: startedAt, endMs: messageAt })
  }
  live.openStep = undefined
  live.firstTokenTime = undefined
}
function beginStep(live, step, time) {
  if (live.turn === undefined) return
  closeOpenStep(live, time)
  recordInputTick(live, time)
  live.activityCounts.inputSteps += 1
  live.openStep = { step, startedAt: time }
  live.firstTokenTime = undefined
}
function onChunk(live, chunk, time) {
  if (live.turn === undefined) return
  if (chunk?.type === 'usage') { if (live.openStep) live.openStep.usage = chunk.usage; return }
  if (!isTokenDelta(chunk)) return
  live.firstTokenTime = live.firstTokenTime ?? time
  const startMs = Math.floor(time / 250) * 250
  const last = live.proxyBins[live.proxyBins.length - 1]
  if (last !== undefined && last.startMs === startMs) { last.mass += 1; last.endMs = time } else { live.proxyBins.push({ startMs, endMs: time, mass: 1 }) }
}
function onAssistantMessage(live, usage, time) {
  if (live.turn === undefined) return
  live.activityCounts.modelGenerations += 1
  live.activityCounts.answer += 1
  if (live.openStep) live.openStep.usage = usage
  if (live.openStep) live.openStep.messageAt = time
  // 真实 token 流（用户【高】需求）：step 结算时把真实 outputTokens/decodeMs 计入滑动窗口，
  // 供实时速率档（rateEstimate，rateQuality 'exact'）用「最近已结算的真实速度」，
  // 替代全程 proxy mass 平均。
  const step = live.openStep
  if (step && step.messageAt !== undefined && live.firstTokenTime !== undefined) {
    const metric = stepMetricOf(usage, live.firstTokenTime, step.startedAt ?? live.firstTokenTime, step.messageAt)
    if (metric.outputTokens !== undefined && metric.decodeMs !== undefined && metric.decodeMs > 0) {
      live.rateWindow.push({ tokens: metric.outputTokens, decodeMs: metric.decodeMs, settledAt: step.messageAt })
    }
  }
}
function toolCallId(event) {
  const value = event?.data?.callId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function toolResultId(event) {
  const value = event?.data?.message?.source?.callId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function addToolInterval(live, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return
  live.toolIntervals.push({ type: 'tool', startMs, endMs, safeLabel: 'tool' })
  if (endMs > startMs) live.segments.push({ kind: 'tool', startMs, endMs })
}
function onToolStart(live, time, callId, name) {
  if (live.turn === undefined) return
  recordEventTick(live, 'tool', time)
  live.activityCounts.toolCalls += 1
  const activity = activityBucketOf(name)
  if (activity !== undefined) live.activityCounts[activity] += 1
  if (callId !== undefined) live.pendingTools[callId] = time
  else {
    if (live.fallbackToolStart !== undefined) closeTool(live, time)
    live.fallbackToolStart = time
  }
}
function closeTool(live, time, callId) {
  if (callId !== undefined && Object.hasOwn(live.pendingTools, callId)) {
    const start = live.pendingTools[callId]
    delete live.pendingTools[callId]
    addToolInterval(live, start, time)
    return
  }
  if (callId === undefined && live.fallbackToolStart !== undefined) {
    const start = live.fallbackToolStart
    live.fallbackToolStart = undefined
    addToolInterval(live, start, time)
  }
}
function endStep(live, time) {
  if (live.turn === undefined) return
  closeOpenStep(live, time)
  live.stepCount += 1
}

// ── activity-summary 镜像（P1 脱敏活动计数）──────────────────────────────
// 只存 类别+数量。工具名/参数/路径/检索词/prompt/正文一律不落盘；
// tool/call 的 data.name 仅做「白名单→固定枚举」即时查找，从不进入 state。
// 活动键是 toolCalls/modelGenerations 的子集：白名单未命中的调用只计入
// generic.toolCalls，activities 缺省该键（省略≠0，绝无「其他」桶）。
const ACTIVITY_TOOL_ALIASES = Object.freeze({
  readProject: new Set(['read', 'read_image', 'glob', 'grep']), // dsh-tool-fs / dsh-tool-fs-search
  webSearch: new Set(['web_search']), // dsh-tool-web
})
const ACTIVITY_ENTRY_KEYS = ['readProject', 'webSearch', 'answer']
const ACTIVITY_QUALITIES = new Set(['exact', 'estimated'])

function newActivityCounts() {
  return { inputSteps: 0, toolCalls: 0, modelGenerations: 0, readProject: 0, webSearch: 0, answer: 0 }
}

function activityBucketOf(name) {
  if (typeof name !== 'string' || name.length === 0) return undefined
  for (const [activity, aliases] of Object.entries(ACTIVITY_TOOL_ALIASES)) {
    if (aliases.has(name)) return activity
  }
  return undefined
}

function buildActivitySummary(counts, turn, generatedAt) {
  if (typeof generatedAt !== 'string' || generatedAt.length === 0) return undefined
  const generic = {
    inputSteps: counts.inputSteps,
    toolCalls: counts.toolCalls,
    modelGenerations: counts.modelGenerations,
  }
  const activities = {}
  for (const key of ACTIVITY_ENTRY_KEYS) {
    if (counts[key] > 0) activities[key] = { count: counts[key], quality: 'exact' }
  }
  return {
    version: 1, scope: 'turn', turnId: String(turn), turnNumber: turn,
    generatedAt, generic, activities,
  }
}

// ── turn-settler/jingxi-projection 镜像 ──────────────────────────────────
function settleTurnJS({ turn, startedAt, endedAt, status, routeKey, steps, stepCount = 0, llmMs = 0, ttftMs = 0, ttftSteps = 0, segments = [], proxyBins, toolIntervals, eventTicks = [], inputTicks = [], activityCounts, generatedAt, subagents }) {
  const activitySummary = activityCounts !== undefined ? buildActivitySummary(activityCounts, turn, generatedAt) : undefined
  const valid = steps.filter(s => s.usageAvailable)
  const avgTps = authoritativeAverageTps(valid)
  const decodeMs = valid.reduce((sum, step) => sum + (finiteNonNegative(step.decodeMs) ?? 0), 0)
  const decodeTokens = valid.reduce((sum, step) => sum + (finiteNonNegative(step.outputTokens) ?? 0), 0)
  let uncached = 0, cacheRead = 0, cacheWrite = 0, output = 0
  let sawUncached = false, sawRead = false, sawWrite = false, sawOutput = false
  for (const s of valid) {
    if (s.uncachedInputTokens !== undefined) { uncached += s.uncachedInputTokens; sawUncached = true }
    if (s.cacheReadTokens !== undefined) { cacheRead += s.cacheReadTokens; sawRead = true }
    if (s.cacheWriteTokens !== undefined) { cacheWrite += s.cacheWriteTokens; sawWrite = true }
    if (s.outputTokens !== undefined) { output += s.outputTokens; sawOutput = true }
  }
  const buckets = {
    ...(sawUncached ? { uncachedInputTokens: uncached } : {}),
    ...(sawRead ? { cacheReadTokens: cacheRead } : {}),
    ...(sawWrite ? { cacheWriteTokens: cacheWrite } : {}),
    ...(sawOutput ? { outputTokens: output } : {}),
  }
  const curveQuality = sawOutput ? 'authoritative-calibrated' : 'estimated-final'
  const sparkline = downsampleCurve(settleProxyBins(proxyBins, sawOutput ? output : undefined), 40).map(p => ({ ...p }))
  const settledSubagents = subagents !== undefined ? subagentsToView(subagents) : undefined
  return {
    schemaVersion: 1, algorithmVersion: 'jingxi-0.5.3', turn, status,
    startedAt, endedAt, totalDurationMs: Math.max(0, endedAt - startedAt),
    llmMs: Math.max(0, llmMs), ttftTotalMs: Math.max(0, ttftMs), ttftSteps,
    ttftMs: ttftSteps > 0 ? Math.max(0, ttftMs / ttftSteps) : undefined,
    decodeMs, decodeTokens, stepCount,
    tokens: buckets, totalTokens: totalTokens(buckets), cacheHit: cacheHit(buckets), avgTps,
    toolWorkMs: toolWorkMs(toolIntervals), toolWallMs: toolWallMs(toolIntervals),
    curveQuality, sparkline,
    segments: segments.map((segment) => ({ kind: segment.kind, startMs: segment.startMs, endMs: segment.endMs })),
    eventTicks: eventTicks.map((tick) => ({ ...tick })),
    inputTicks: inputTicks.map((tick) => ({ ...tick })),
    ...(settledSubagents !== undefined && settledSubagents.length > 0 ? { subagents: settledSubagents } : {}),
    ...(activitySummary !== undefined ? { activitySummary } : {}),
    ...(routeKey !== undefined ? { routeKey } : {}),
  }
}
function statusOfReason(reason) {
  const kind = reason && reason.kind
  if (kind === 'completed') return 'completed'
  if (kind === 'aborted') return 'aborted'
  if (kind === 'interrupted') return 'interrupted'
  if (kind === 'max-tokens') return 'max-tokens'
  if (kind === 'error') return 'error'
  return 'unknown'
}

const RECENT_CAP = 5
const SESSION_CURVE_CAP = 160
const SESSION_SEGMENT_CAP = 256
const SESSION_EVENT_TICK_CAP = 128
const SESSION_INPUT_TICK_CAP = 256
// V5.9 ②：宿主 subagent/start|end 生命周期投影（stage6-host-agent-probe §4 契约落地）。
// 事件名是 subagent/*（不是 client 旧注释的 agent/start|result）；载荷只含
// runId/provider/id/local（start）+ stopReason/lastAssistantMessage（end）。
// 授权红线：不存 lastAssistantMessage 正文，只保留输出长度（字符级元数据）；
// 事件无时间戳 → 消费方自记 startMs（Date.now() 同域）；无 parentId → 显式
// 置 undefined（不推断），渲染层孤儿节点仍按顶层展示真实上报。
// status 输出收窄到 client 五态（queued/running/completed/failed/cancelled）：
// 宿主 stopReason 按语义映射（completed→completed，aborted/interrupted→cancelled，
// max-tokens/error/refusal→failed），原始 stopReason 保留在内部条目（不暴露）。
const SUBAGENT_RUN_CAP = 24
const SUBAGENT_STOP_STATUS = Object.freeze({
  completed: 'completed',
  aborted: 'cancelled',
  interrupted: 'cancelled',
  'max-tokens': 'failed',
  error: 'failed',
  refusal: 'failed',
})
const SUBAGENT_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'])

function subagentStatusOf(stopReason) {
  const mapped = SUBAGENT_STOP_STATUS[stopReason]
  if (mapped !== undefined) return mapped
  return typeof stopReason === 'string' && stopReason.length > 0 ? 'unknown' : 'unknown'
}

function subagentEntryId(info) {
  const value = info && (info.runId ?? info.id)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeSubagentInfo(info) {
  if (!isRecord(info)) return undefined
  return {
    runId: typeof info.runId === 'string' && info.runId.length > 0 ? info.runId : undefined,
    provider: typeof info.provider === 'string' && info.provider.length > 0 ? info.provider : undefined,
    id: typeof info.id === 'string' && info.id.length > 0 ? info.id : undefined,
    local: info.local === true,
  }
}

function contentLengthOf(message) {
  if (typeof message === 'string') return message.length
  if (Array.isArray(message)) {
    let total = 0
    for (const block of message) {
      if (block && typeof block === 'object' && typeof block.text === 'string') total += block.text.length
    }
    return total
  }
  return 0
}

function trimSubagentMap(map) {
  if (map.size <= SUBAGENT_RUN_CAP) return
  const entries = [...map.entries()]
  const settled = entries.filter(([, entry]) => entry.status !== 'running')
  const evictSource = settled.length > 0 ? settled : entries
  map.delete(evictSource[0][0])
}

// 生命周期折叠（bus 事件与 fold apply 共用同一入口）：
//   subagent/start  → 建 running 条目（幂等：同 runId 重复 start 忽略）
//   subagent/end    → 结算 status/durationMs/outputLen（可先于 start 到达 → 隐式条目）
function applySubagentLifecycle(state, type, info, nowMs) {
  const key = subagentEntryId(info)
  if (key === undefined) return false
  const map = state.subagents
  const time = Number.isFinite(nowMs) ? nowMs : Date.now()
  if (type === 'subagent/start') {
    const normalized = normalizeSubagentInfo(info)
    if (!normalized) return false
    if (map.has(key)) return false
    map.set(key, {
      id: normalized.id ?? key,
      parentId: undefined,
      label: undefined,
      provider: normalized.provider,
      local: normalized.local,
      status: 'running',
      startMs: time,
      endMs: undefined,
      durationMs: undefined,
      stopReason: undefined,
      model: undefined,
      reasoningEffort: undefined,
      toolCalls: undefined,
      rate: undefined,
      outputLen: undefined,
    })
    trimSubagentMap(map)
    return true
  }
  if (type === 'subagent/end') {
    const normalized = normalizeSubagentInfo(info)
    const existing = map.get(key)
    const entry = existing ?? {
      id: normalized?.id ?? key,
      parentId: undefined,
      label: undefined,
      provider: normalized?.provider,
      local: normalized?.local === true,
      status: 'unknown',
      startMs: undefined,
      endMs: undefined,
      durationMs: undefined,
      stopReason: undefined,
      model: undefined,
      reasoningEffort: undefined,
      toolCalls: undefined,
      rate: undefined,
      outputLen: undefined,
    }
    const stopReason = typeof info?.stopReason === 'string' && info.stopReason.length > 0 ? info.stopReason : 'error'
    entry.stopReason = stopReason
    entry.status = subagentStatusOf(stopReason)
    entry.endMs = time
    entry.durationMs = entry.startMs !== undefined ? Math.max(0, time - entry.startMs) : undefined
    if (info?.lastAssistantMessage !== undefined) entry.outputLen = contentLengthOf(info.lastAssistantMessage)
    map.set(key, entry)
    return true
  }
  return false
}

function subagentToView(entry) {
  return {
    id: entry.id,
    ...(entry.parentId !== undefined ? { parentId: entry.parentId } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    status: entry.status,
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
    ...(entry.toolCalls !== undefined ? { toolCalls: entry.toolCalls } : {}),
    ...(entry.rate !== undefined ? { rate: { ...entry.rate } } : {}),
  }
}

function subagentsToView(stateSubagents) {
  return [...stateSubagents.values()].map(subagentToView)
}

function newSession() {
  return {
    rounds: 0, steps: 0, lastTurn: undefined, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
    decodeMs: 0, decodeTokens: 0, tokens: {}, startMs: undefined, endMs: undefined,
    curveQuality: undefined, sparkline: [], segments: [], eventTicks: [], inputTicks: [],
  }
}

function addSessionBucket(session, key, value) {
  const number = finiteNonNegative(value)
  if (number === undefined) return
  session.tokens[key] = (session.tokens[key] ?? 0) + number
}

function mergeSessionSummary(session, summary) {
  if (summary.stepCount > 0 && session.lastTurn !== summary.turn) session.rounds += 1
  session.lastTurn = summary.turn
  session.steps += summary.stepCount
  session.llmMs += summary.llmMs
  session.toolMs += summary.toolWorkMs
  session.ttftMs += summary.ttftTotalMs
  session.ttftSteps += summary.ttftSteps
  session.decodeMs += summary.decodeMs
  session.decodeTokens += summary.decodeTokens
  const outputOffset = session.tokens.outputTokens ?? 0
  for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) addSessionBucket(session, key, summary.tokens[key])
  session.startMs = session.startMs === undefined ? summary.startedAt : Math.min(session.startMs, summary.startedAt)
  session.endMs = session.endMs === undefined ? summary.endedAt : Math.max(session.endMs, summary.endedAt)
  session.curveQuality = session.curveQuality === undefined || session.curveQuality === 'authoritative-calibrated' && summary.curveQuality === 'authoritative-calibrated'
    ? summary.curveQuality
    : 'estimated-final'
  for (const point of summary.sparkline) {
    session.sparkline.push({ ...point, cumulativeOutputTokens: outputOffset + point.cumulativeOutputTokens })
  }
  session.sparkline = downsampleCurve(session.sparkline, SESSION_CURVE_CAP)
  session.segments.push(...summary.segments)
  session.segments = session.segments.slice(-SESSION_SEGMENT_CAP)
  session.eventTicks.push(...summary.eventTicks)
  session.eventTicks = session.eventTicks.slice(-SESSION_EVENT_TICK_CAP)
  session.inputTicks.push(...summary.inputTicks)
  session.inputTicks = session.inputTicks.slice(-SESSION_INPUT_TICK_CAP)
}

function sessionInputTokens(tokens) {
  const values = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map((key) => finiteNonNegative(tokens[key]))
  if (values.every((value) => value === undefined)) return undefined
  return values.reduce((sum, value) => sum + (value ?? 0), 0)
}

function sessionView(session) {
  if (session.steps === 0 && session.rounds === 0) return undefined
  const avgTps = session.decodeMs > 0 && session.decodeTokens > 0 ? session.decodeTokens / (session.decodeMs / 1000) : undefined
  return {
    rounds: session.rounds,
    steps: session.steps,
    llmDurationMs: session.llmMs,
    toolDurationMs: session.toolMs,
    avgTtftMs: session.ttftSteps > 0 ? session.ttftMs / session.ttftSteps : undefined,
    avgTps,
    // 平均档（session）：会话均值真实存在且 ≥2 轮时才标注——单轮会话的均值
    // 与最近档（last.avgTps）同值，最近档优先，避免两档同值冗余。
    ...(avgTps !== undefined && session.rounds > 1 ? { rateQuality: 'session' } : {}),
    cachePct: cacheHit(session.tokens),
    inputTokens: sessionInputTokens(session.tokens),
    outputTokens: finiteNonNegative(session.tokens.outputTokens),
    curveQuality: session.curveQuality,
    updatedAt: session.endMs,
  }
}

function trajectoryView(session) {
  if (session.steps === 0 && session.sparkline.length === 0 && session.segments.length === 0) return undefined
  return {
    startMs: session.startMs,
    endMs: session.endMs,
    segments: session.segments.map((segment) => ({ ...segment })),
    sparkline: session.sparkline.map((point) => ({ ...point })),
    eventTicks: session.eventTicks.map((tick) => ({ ...tick })),
    inputTicks: session.inputTicks.map((tick) => ({ ...tick })),
  }
}

export function initJingxiFold() { return { live: newLive(), recent: [], session: newSession(), subagents: new Map() } }

// 供 node half（index.js）直接消费 bus 事件：subagent/start|end → fold 状态。
export { applySubagentLifecycle }

export function applyJingxiFold(state, event) {
  const tickKind = eventTickKind(event?.type)
  if (tickKind) recordEventTick(state.live, tickKind, event.time)
  switch (event.type) {
    case 'turn/start':
      beginTurn(state.live, event.data.turn, event.time)
      break
    case 'step/start':
      beginStep(state.live, event.data.step, event.time)
      break
    case 'assistant/chunk':
      onChunk(state.live, event.data.chunk, event.time)
      break
    case 'assistant/message':
      onAssistantMessage(state.live, event.data.usage, event.time)
      break
    case 'tool/call':
      onToolStart(state.live, event.time, toolCallId(event), event?.data?.name)
      break
    case 'tool/result':
      closeTool(state.live, event.time, toolResultId(event))
      break
    case 'step/end':
      endStep(state.live, event.time)
      break
    case 'turn/end': {
      const live = state.live
      if (live.turn !== undefined) {
        live.pendingTools = {}
        live.fallbackToolStart = undefined
        closeOpenStep(live, event.time)
        const summary = settleTurnJS({
          turn: live.turn, startedAt: live.startedAt ?? event.time, endedAt: event.time,
          status: state.routeKey !== undefined && event.time > 0 ? statusOfReason(event.data.reason) : 'unknown',
          routeKey: state.routeKey, steps: live.steps, stepCount: live.stepCount, llmMs: live.llmMs,
          ttftMs: live.ttftMs, ttftSteps: live.ttftSteps, segments: live.segments,
          proxyBins: live.proxyBins, toolIntervals: live.toolIntervals, eventTicks: live.eventTicks, inputTicks: live.inputTicks,
          activityCounts: live.activityCounts, generatedAt: new Date().toISOString(),
          subagents: state.subagents,
        })
        state.last = summary
        state.recent = [...state.recent.filter(r => r.turn !== summary.turn), summary].slice(-RECENT_CAP)
        mergeSessionSummary(state.session, summary)
        state.live = newLive()
        state.subagents = new Map()
      }
      break
    }
    case 'subagent/start':
    case 'subagent/end':
      // 宿主子代理生命周期（V5.9 ②）。bus 事件无 time 字段 → 用事件到达时刻
      // （Date.now() 同域）；start 建 running 条目，end 结算 status/durationMs。
      applySubagentLifecycle(state, event.type, event.data, event.time)
      break
    case 'request/context':
      if (event.data.model !== undefined) state.routeKey = `${event.data.provider ?? 'provider'}/${event.data.model}`
      break
    default:
      break
  }
  return state
}

export function viewJingxiFold(state, nowMs) {
  const recent = state.recent.slice(-RECENT_CAP).map(s => ({
    turn: s.turn, status: s.status, avgTps: s.avgTps, totalTokens: s.totalTokens, cachePct: s.cacheHit,
    durationMs: s.totalDurationMs, ttftMs: s.ttftMs, curveQuality: s.curveQuality,
    ...(s.avgTps !== undefined ? { rateQuality: 'historical' } : {}),
    toolWorkMs: s.toolWorkMs, toolWallMs: s.toolWallMs, llmMs: s.llmMs, ttftSteps: s.ttftSteps,
    decodeMs: s.decodeMs, decodeTokens: s.decodeTokens, stepCount: s.stepCount, routeKey: s.routeKey,
    segments: Array.isArray(s.segments) ? s.segments.map(segment => ({ ...segment })) : [],
    tokens: s.tokens ? { ...s.tokens } : undefined,
    eventTicks: Array.isArray(s.eventTicks) ? s.eventTicks.map(tick => ({ ...tick })) : [],
    inputTicks: Array.isArray(s.inputTicks) ? s.inputTicks.map(tick => ({ ...tick })) : [],
    ...(Array.isArray(s.subagents) && s.subagents.length > 0 ? { subagents: s.subagents.map(entry => ({ ...entry })) } : {}),
    ...(s.activitySummary !== undefined ? { activitySummary: { ...s.activitySummary, generic: { ...s.activitySummary.generic }, activities: { ...s.activitySummary.activities } } } : {}),
    sparkline: s.sparkline.map(p => ({ ...p })),
  }))
  const summaryToView = s => ({
    turn: s.turn, status: s.status, avgTps: s.avgTps, totalTokens: s.totalTokens,
    cachePct: s.cacheHit, durationMs: s.totalDurationMs, ttftMs: s.ttftMs,
    curveQuality: s.curveQuality,
    ...(s.avgTps !== undefined ? { rateQuality: 'historical' } : {}),
    toolWorkMs: s.toolWorkMs, toolWallMs: s.toolWallMs,
    llmMs: s.llmMs, ttftSteps: s.ttftSteps, decodeMs: s.decodeMs, decodeTokens: s.decodeTokens,
    stepCount: s.stepCount, segments: Array.isArray(s.segments) ? s.segments.map(segment => ({ ...segment })) : [],
    routeKey: s.routeKey, tokens: s.tokens ? { ...s.tokens } : undefined,
    eventTicks: Array.isArray(s.eventTicks) ? s.eventTicks.map(tick => ({ ...tick })) : [],
    inputTicks: Array.isArray(s.inputTicks) ? s.inputTicks.map(tick => ({ ...tick })) : [],
    ...(Array.isArray(s.subagents) && s.subagents.length > 0 ? { subagents: s.subagents.map(entry => ({ ...entry })) } : {}),
    ...(s.activitySummary !== undefined ? { activitySummary: { ...s.activitySummary, generic: { ...s.activitySummary.generic }, activities: { ...s.activitySummary.activities } } } : {}),
    sparkline: s.sparkline.map(p => ({ ...p })),
  })
  const live = state.live
  const sessionSummary = sessionView(state.session)
  const trajectory = trajectoryView(state.session)
  const liveActivitySummary = live.turn !== undefined
    ? buildActivitySummary(
      live.activityCounts,
      live.turn,
      Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : undefined,
    )
    : undefined
  // 进行中子代理（bus 事件在 turn 边界外到达）：挂到 live 分支，让 SubagentDock
  // 在 turn 未结算时也能看到真实分叉；结算后由 last.subagents 承载。
  const liveSubagents = state.subagents.size > 0 ? subagentsToView(state.subagents) : undefined
  if (live.turn === undefined) return {
    kind: 'idle', last: state.last ? summaryToView(state.last) : undefined, recent,
    ...(liveSubagents !== undefined ? { liveSubagents } : {}),
    ...(sessionSummary ? { sessionSummary } : {}), ...(trajectory ? { trajectory } : {}),
  }
  const rate = rateEstimate(live, nowMs)
  return {
    kind: 'live',
    live: {
      turn: live.turn,
      durationMs: Math.max(0, nowMs - (live.startedAt ?? nowMs)),
      estimateRateTokS: rate.rateTokS,
      rateQuality: rate.rateQuality,
      openStep: live.openStep?.step ?? 0,
      ...(liveActivitySummary !== undefined ? { activitySummary: liveActivitySummary } : {}),
    },
    last: state.last ? summaryToView(state.last) : undefined,
    recent,
    ...(liveSubagents !== undefined ? { liveSubagents } : {}),
    ...(sessionSummary ? { sessionSummary } : {}), ...(trajectory ? { trajectory } : {}),
  }
}

const PROJECTION_STATUSES = new Set(['completed', 'aborted', 'interrupted', 'max-tokens', 'error', 'unknown'])
const PROJECTION_CURVE_QUALITIES = new Set(['authoritative-calibrated', 'estimated-final'])
// V5.6 tok/s 五档：live=exact/estimated/unavailable；最近 turn=historical；会话=session。
// 全局枚举（live 视图理论上不会出现 historical/session；各层写入方保证）。
// 非法值在解析时丢弃（增量字段兼容：旧快照/外部载荷缺省该键等同 undefined，不整树拒绝）。
const PROJECTION_RATE_QUALITIES = new Set(['exact', 'estimated', 'historical', 'session', 'unavailable'])

function projectionViewError(path, message) {
  throw new TypeError(`jingxi projection view ${path}: ${message}`)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireFinite(value, path) {
  if (!Number.isFinite(value)) projectionViewError(path, 'expected a finite number')
}

function requireTurn(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) projectionViewError(path, 'expected a non-negative integer')
}

function optionalFinite(value, path) {
  if (value !== undefined) requireFinite(value, path)
}

function parseSparkline(points, path) {
  if (!Array.isArray(points)) projectionViewError(path, 'expected an array')
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    if (!isRecord(point)) projectionViewError(`${path}[${i}]`, 'expected an object')
    requireFinite(point.tMs, `${path}[${i}].tMs`)
    requireFinite(point.rateTokS, `${path}[${i}].rateTokS`)
    requireFinite(point.cumulativeOutputTokens, `${path}[${i}].cumulativeOutputTokens`)
  }
}

function parseEventTicks(ticks, path) {
  if (ticks === undefined) return
  if (!Array.isArray(ticks)) projectionViewError(path, 'expected an array')
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i]
    if (!isRecord(tick)) projectionViewError(`${path}[${i}]`, 'expected an object')
    requireFinite(tick.tMs, `${path}[${i}].tMs`)
    if (!EVENT_TICK_KINDS.has(tick.kind)) projectionViewError(`${path}[${i}].kind`, 'unknown event tick kind')
  }
}

function parseInputTicks(ticks, path) {
  if (ticks === undefined) return
  if (!Array.isArray(ticks)) projectionViewError(path, 'expected an array')
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i]
    if (!isRecord(tick)) projectionViewError(`${path}[${i}]`, 'expected an object')
    requireFinite(tick.tMs, `${path}[${i}].tMs`)
    if (tick.kind !== 'input') projectionViewError(`${path}[${i}].kind`, 'unknown input tick kind')
  }
}

function parseSegments(segments, path) {
  if (!Array.isArray(segments)) projectionViewError(path, 'expected an array')
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (!isRecord(segment)) projectionViewError(`${path}[${i}]`, 'expected an object')
    if (!['model', 'tool'].includes(segment.kind)) projectionViewError(`${path}[${i}].kind`, 'unknown segment kind')
    requireFinite(segment.startMs, `${path}[${i}].startMs`)
    requireFinite(segment.endMs, `${path}[${i}].endMs`)
    if (segment.endMs < segment.startMs) projectionViewError(`${path}[${i}]`, 'segment end precedes start')
  }
}

function parseSessionSummary(summary, path) {
  if (!isRecord(summary)) projectionViewError(path, 'expected an object')
  requireTurn(summary.rounds, `${path}.rounds`)
  requireTurn(summary.steps, `${path}.steps`)
  if (!PROJECTION_CURVE_QUALITIES.has(summary.curveQuality)) projectionViewError(`${path}.curveQuality`, 'unknown curve quality')
  if (summary.rateQuality !== undefined && !PROJECTION_RATE_QUALITIES.has(summary.rateQuality)) delete summary.rateQuality
  for (const key of ['llmDurationMs', 'toolDurationMs', 'avgTtftMs', 'avgTps', 'cachePct', 'inputTokens', 'outputTokens', 'updatedAt']) optionalFinite(summary[key], `${path}.${key}`)
}

function parseTrajectory(trajectory, path) {
  if (!isRecord(trajectory)) projectionViewError(path, 'expected an object')
  requireFinite(trajectory.startMs, `${path}.startMs`)
  requireFinite(trajectory.endMs, `${path}.endMs`)
  if (trajectory.endMs < trajectory.startMs) projectionViewError(path, 'trajectory end precedes start')
  parseSegments(trajectory.segments, `${path}.segments`)
  parseSparkline(trajectory.sparkline, `${path}.sparkline`)
  parseEventTicks(trajectory.eventTicks, `${path}.eventTicks`)
  parseInputTicks(trajectory.inputTicks, `${path}.inputTicks`)
}

function parseActivitySummary(summary, path) {
  if (!isRecord(summary)) projectionViewError(path, 'expected an object')
  if (summary.version !== 1) projectionViewError(`${path}.version`, 'expected 1')
  if (summary.scope !== 'turn') projectionViewError(`${path}.scope`, 'expected turn')
  if (typeof summary.turnId !== 'string' || summary.turnId.length === 0) projectionViewError(`${path}.turnId`, 'expected a non-empty string')
  requireTurn(summary.turnNumber, `${path}.turnNumber`)
  if (typeof summary.generatedAt !== 'string' || summary.generatedAt.length === 0) projectionViewError(`${path}.generatedAt`, 'expected an ISO string')
  if (!isRecord(summary.generic)) projectionViewError(`${path}.generic`, 'expected an object')
  for (const key of ['inputSteps', 'toolCalls', 'modelGenerations']) requireTurn(summary.generic[key], `${path}.generic.${key}`)
  if (!isRecord(summary.activities)) projectionViewError(`${path}.activities`, 'expected an object')
  for (const [key, entry] of Object.entries(summary.activities)) {
    if (!ACTIVITY_ENTRY_KEYS.includes(key)) projectionViewError(`${path}.activities.${key}`, 'unknown activity key')
    if (!isRecord(entry)) projectionViewError(`${path}.activities.${key}`, 'expected an object')
    requireTurn(entry.count, `${path}.activities.${key}.count`)
    if (!ACTIVITY_QUALITIES.has(entry.quality)) projectionViewError(`${path}.activities.${key}.quality`, 'unknown quality')
  }
}

function parseSubagents(subagents, path) {
  if (subagents === undefined) return
  if (!Array.isArray(subagents)) projectionViewError(path, 'expected an array')
  for (let i = 0; i < subagents.length; i += 1) {
    const entry = subagents[i]
    if (!isRecord(entry)) projectionViewError(`${path}[${i}]`, 'expected an object')
    if (typeof entry.id !== 'string' || entry.id.length === 0) projectionViewError(`${path}[${i}].id`, 'expected a non-empty string')
    if (entry.parentId !== undefined && (typeof entry.parentId !== 'string' || entry.parentId.length === 0)) projectionViewError(`${path}[${i}].parentId`, 'expected a non-empty string')
    if (entry.label !== undefined && typeof entry.label !== 'string') projectionViewError(`${path}[${i}].label`, 'expected a string')
    if (!SUBAGENT_STATUSES.has(entry.status)) projectionViewError(`${path}[${i}].status`, 'unknown subagent status')
    if (entry.durationMs !== undefined) requireFinite(entry.durationMs, `${path}[${i}].durationMs`)
    if (entry.model !== undefined && typeof entry.model !== 'string') projectionViewError(`${path}[${i}].model`, 'expected a string')
    if (entry.reasoningEffort !== undefined && typeof entry.reasoningEffort !== 'string') projectionViewError(`${path}[${i}].reasoningEffort`, 'expected a string')
    if (entry.toolCalls !== undefined) requireTurn(entry.toolCalls, `${path}[${i}].toolCalls`)
    if (entry.rate !== undefined) {
      if (!isRecord(entry.rate)) projectionViewError(`${path}[${i}].rate`, 'expected an object')
      if (entry.rate.value !== undefined) requireFinite(entry.rate.value, `${path}[${i}].rate.value`)
      if (entry.rate.quality !== undefined && typeof entry.rate.quality !== 'string') projectionViewError(`${path}[${i}].rate.quality`, 'expected a string')
    }
  }
}

function parseSummary(summary, path) {
  if (!isRecord(summary)) projectionViewError(path, 'expected an object')
  requireTurn(summary.turn, `${path}.turn`)
  if (!PROJECTION_STATUSES.has(summary.status)) projectionViewError(`${path}.status`, 'unknown status')
  optionalFinite(summary.avgTps, `${path}.avgTps`)
  optionalFinite(summary.totalTokens, `${path}.totalTokens`)
  optionalFinite(summary.cachePct, `${path}.cachePct`)
  requireFinite(summary.durationMs, `${path}.durationMs`)
  optionalFinite(summary.ttftMs, `${path}.ttftMs`)
  if (!PROJECTION_CURVE_QUALITIES.has(summary.curveQuality)) projectionViewError(`${path}.curveQuality`, 'unknown curve quality')
  if (summary.rateQuality !== undefined && !PROJECTION_RATE_QUALITIES.has(summary.rateQuality)) delete summary.rateQuality
  if (summary.tokens !== undefined) {
    if (!isRecord(summary.tokens)) projectionViewError(`${path}.tokens`, 'expected an object')
    for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) optionalFinite(summary.tokens[key], `${path}.tokens.${key}`)
  }
  if (summary.segments !== undefined) parseSegments(summary.segments, `${path}.segments`)
  if (summary.activitySummary !== undefined) parseActivitySummary(summary.activitySummary, `${path}.activitySummary`)
  parseSubagents(summary.subagents, `${path}.subagents`)
  parseSparkline(summary.sparkline, `${path}.sparkline`)
  parseEventTicks(summary.eventTicks, `${path}.eventTicks`)
  parseInputTicks(summary.inputTicks, `${path}.inputTicks`)
}

function parseJingxiProjectionView(value) {
  if (!isRecord(value)) projectionViewError('<root>', 'expected an object')
  if (value.kind !== 'idle' && value.kind !== 'live') projectionViewError('kind', 'expected idle or live')
  if (!Array.isArray(value.recent)) projectionViewError('recent', 'expected an array')
  for (let i = 0; i < value.recent.length; i += 1) parseSummary(value.recent[i], `recent[${i}]`)
  if (value.last !== undefined) parseSummary(value.last, 'last')
  parseSubagents(value.liveSubagents, 'liveSubagents')
  if (value.sessionSummary !== undefined) parseSessionSummary(value.sessionSummary, 'sessionSummary')
  if (value.trajectory !== undefined) parseTrajectory(value.trajectory, 'trajectory')

  if (value.kind === 'live') {
    if (!isRecord(value.live)) projectionViewError('live', 'expected an object for a live view')
    requireTurn(value.live.turn, 'live.turn')
    requireFinite(value.live.durationMs, 'live.durationMs')
    optionalFinite(value.live.estimateRateTokS, 'live.estimateRateTokS')
    if (value.live.rateQuality !== undefined && !PROJECTION_RATE_QUALITIES.has(value.live.rateQuality)) delete value.live.rateQuality
    requireTurn(value.live.openStep, 'live.openStep')
    if (value.live.activitySummary !== undefined) parseActivitySummary(value.live.activitySummary, 'live.activitySummary')
  }
  return value
}

// The host projection registry invokes schema.parse() on every history read and
// checkpoint restore. Keep this dependency-free so the package remains loadable
// in headless profiles that do not expose the host's zod installation.
export const jingxiProjectionSchema = Object.freeze({ parse: parseJingxiProjectionView })

// 实时速率：默认 60s 滑动窗口，只用「最近已结算的真实 token/decode」加权，
// 不再用全程 proxy mass 平均（用户【高】需求：真实 token 流，尽量准确）。
// V5.6 tok/s 五档（luna 裁决 §三决策5）：rateQuality 与 estimateRateTokS 同源、
// 同函数单次计算，判定绝不分叉——
//   60s 窗口内有已结算真实 step（rateWindow 非空）→ 'exact'（source stream_window）
//   空窗但当前 turn 在产 proxy 增量（proxyBins 非空）→ 'estimated'（source proxy-open）
//   两者皆无 → 'unavailable'，rateTokS 为 undefined（UI 显示 —）
// estimateRateTokS 字段名保持兼容（client 既有消费），语义由 rateQuality 显式标注。
const RATE_WINDOW_MS = 60 * 1000
function rateEstimate(live, nowMs) {
  const windowStart = nowMs - RATE_WINDOW_MS
  const settled = Array.isArray(live.rateWindow) ? live.rateWindow.filter((w) => w.settledAt >= windowStart) : []
  if (settled.length > 0) {
    const tokens = settled.reduce((s, w) => s + w.tokens, 0)
    const decode = settled.reduce((s, w) => s + w.decodeMs, 0)
    if (decode > 0) return { rateTokS: tokens / (decode / 1000), rateQuality: 'exact' }
  }
  // 退路：open step 的 proxy 增量（代理质量，窗内 mass/时间；
  // firstTokenTime 与 proxyBins 由同一 chunk 置位，二者同时为空）。
  const start = live.firstTokenTime
  if (start !== undefined && Array.isArray(live.proxyBins) && live.proxyBins.length > 0) {
    const recentBins = live.proxyBins.filter((b) => b.endMs >= windowStart)
    const total = recentBins.reduce((s, b) => s + b.mass, 0)
    const elapsed = Math.max(0.001, (nowMs - start) / 1000)
    return { rateTokS: total / elapsed, rateQuality: 'estimated' }
  }
  return { rateTokS: undefined, rateQuality: 'unavailable' }
}
