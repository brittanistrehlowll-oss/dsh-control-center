// dsh-jingxi  ◊  node half (V1.0.1) — Pure Breath host side
//
// 职责（Telemetry/Lifecycle 分离）：
//   GET  /api/jingxi/lifecycle    → fail-closed（mutation 默认关闭）
//   GET  /api/jingxi/status       → 只读
//   GET  /api/jingxi/breath/current → 真实会话折叠视图（source=real）；无事件时 source=none
//   （headless 无 webServer 时自动跳过 web 路由；折叠/投影/落盘始终工作）
//
// 真实遥测：ctx.on('session/event') 增量 replay 进 telemetry-fold（存入
//   $DSH_HOME/jingxi/state/breath-latest.json，throttle 500ms；不存 raw content）。
// 冷启动优先使用 DSH 官方 ctx.sessionQuery 读取最新持久会话，避免重载后
// 只恢复旧快照、丢失 sessionSummary/trajectory。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { initJingxiFold, applyJingxiFold, viewJingxiFold, jingxiProjectionSchema, applySubagentLifecycle } from './telemetry-fold.js'
import { createAssetRouteHandler, JINGXI_ASSET_ROUTE } from './asset-route.js'
import {
  applyDshUpdate,
  buildDshHealthUrl,
  checkDshUpdate,
  executeLifecycleAction,
  getDshUpdateVerification,
  isLifecycleAction,
  isTrustedWebRequest,
  readJsonBody,
  readDshRuntimeHealth,
  requestDshRestart,
} from './dsh-update.js'

export const name = 'dsh-jingxi'
// 不在节点半静态等待服务（headless 无 webServer 时也会阻塞激活）；
// webServer 由 cordis 行级 inject 提供（web profile），apply 内对缺失做 guard。
// Complete cold-start replay depends on the DSH-owned session query service.
// The web profile mounts this service even when no webServer is present, so a
// headless activation still keeps the projection/event fold available.
export const inject = ['sessionQuery']

const DEFAULT_DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_FILE = process.env.JINGXI_STATE_FILE || join(DEFAULT_DSH_HOME, 'jingxi', 'state', 'breath-latest.json')
let persistedWriteChain = Promise.resolve()
const PACKAGE_VERSION = createRequire(import.meta.url)('../package.json').version

const PERSISTED_STATUS = new Set(['completed', 'aborted', 'interrupted', 'max-tokens', 'error', 'unknown'])
const PERSISTED_CURVE_QUALITY = new Set(['authoritative-calibrated', 'estimated-final'])
// V5.6 tok/s 五档：与投影 schema 同一枚举；非法/缺省值一律不落盘不透传（可空）。
const PERSISTED_RATE_QUALITIES = new Set(['exact', 'estimated', 'historical', 'session', 'unavailable'])
const PERSISTED_EVENT_TICK_KINDS = new Set(['tool', 'retry', 'compaction'])
const PERSISTED_INPUT_TICK_KINDS = new Set(['input'])
const PERSISTED_SEGMENT_KINDS = new Set(['model', 'tool'])
const PERSISTED_ACTIVITY_KEYS = new Set(['readProject', 'webSearch', 'answer'])
const PERSISTED_ACTIVITY_QUALITIES = new Set(['exact', 'estimated'])
// V5.9 ②：子代理条目白名单字段（client 五态 + unknown 兼容旧负载）。
// 内部条目字段（provider/local/startMs/endMs/stopReason/outputLen）一律不落盘。
const PERSISTED_SUBAGENT_STATUS = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'])
const REPLAY_CANDIDATE_LIMIT = 8

function persistedSubagent(entry) {
  if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) return undefined
  if (!PERSISTED_SUBAGENT_STATUS.has(entry.status)) return undefined
  const out = { id: entry.id, status: entry.status }
  for (const key of ['parentId', 'label', 'model', 'reasoningEffort']) {
    if (typeof entry[key] === 'string' && entry[key].length > 0) out[key] = entry[key]
  }
  const durationMs = finiteNumber(entry.durationMs)
  if (durationMs !== undefined && durationMs >= 0) out.durationMs = durationMs
  if (Number.isSafeInteger(entry.toolCalls) && entry.toolCalls >= 0) out.toolCalls = entry.toolCalls
  if (isRecord(entry.rate)) {
    const rate = {}
    const value = finiteNumber(entry.rate.value)
    if (value !== undefined) rate.value = value
    if (typeof entry.rate.quality === 'string' && entry.rate.quality.length > 0) rate.quality = entry.rate.quality
    if (Object.keys(rate).length > 0) out.rate = rate
  }
  return out
}

function persistedSubagents(value, limit = 24) {
  if (!Array.isArray(value)) return []
  return value.slice(-limit).flatMap((entry) => {
    const sanitized = persistedSubagent(entry)
    return sanitized !== undefined ? [sanitized] : []
  })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : undefined
}

function persistedSparkline(value, limit = 40) {
  if (!Array.isArray(value)) return []
  return value.slice(-limit).flatMap((point) => {
    if (!isRecord(point)) return []
    const tMs = finiteNumber(point.tMs)
    const rateTokS = finiteNumber(point.rateTokS)
    const cumulativeOutputTokens = finiteNumber(point.cumulativeOutputTokens)
    if (tMs === undefined || rateTokS === undefined || cumulativeOutputTokens === undefined) return []
    return [{ tMs, rateTokS, cumulativeOutputTokens }]
  })
}

function persistedSegments(value, limit = 256) {
  if (!Array.isArray(value)) return []
  return value.slice(-limit).flatMap((segment) => {
    if (!isRecord(segment) || !PERSISTED_SEGMENT_KINDS.has(segment.kind)) return []
    const startMs = finiteNumber(segment.startMs)
    const endMs = finiteNumber(segment.endMs)
    if (startMs === undefined || endMs === undefined || endMs < startMs) return []
    return [{ kind: segment.kind, startMs, endMs }]
  })
}

function persistedEventTicks(value) {
  if (!Array.isArray(value)) return []
  return value.slice(-32).flatMap((tick) => {
    if (!isRecord(tick) || !Number.isFinite(tick.tMs) || !PERSISTED_EVENT_TICK_KINDS.has(tick.kind)) return []
    return [{ tMs: tick.tMs, kind: tick.kind }]
  })
}

function persistedInputTicks(value, limit = 256) {
  if (!Array.isArray(value)) return []
  return value.slice(-limit).flatMap((tick) => {
    if (!isRecord(tick) || !Number.isFinite(tick.tMs) || !PERSISTED_INPUT_TICK_KINDS.has(tick.kind)) return []
    return [{ tMs: tick.tMs, kind: 'input' }]
  })
}

function persistedActivitySummary(value) {
  if (!isRecord(value) || value.version !== 1 || value.scope !== 'turn') return undefined
  if (typeof value.turnId !== 'string' || value.turnId.length === 0) return undefined
  if (!Number.isSafeInteger(value.turnNumber) || value.turnNumber < 0) return undefined
  if (typeof value.generatedAt !== 'string' || value.generatedAt.length === 0) return undefined
  if (!isRecord(value.generic)) return undefined
  const generic = {}
  for (const key of ['inputSteps', 'toolCalls', 'modelGenerations']) {
    if (!Number.isSafeInteger(value.generic[key]) || value.generic[key] < 0) return undefined
    generic[key] = value.generic[key]
  }
  if (!isRecord(value.activities)) return undefined
  const activities = {}
  for (const [key, entry] of Object.entries(value.activities)) {
    if (!PERSISTED_ACTIVITY_KEYS.has(key) || !isRecord(entry)) return undefined
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) return undefined
    if (!PERSISTED_ACTIVITY_QUALITIES.has(entry.quality)) return undefined
    activities[key] = { count: entry.count, quality: entry.quality }
  }
  return {
    version: 1, scope: 'turn', turnId: value.turnId, turnNumber: value.turnNumber,
    generatedAt: value.generatedAt, generic, activities,
  }
}

function persistedSummary(value) {
  if (!isRecord(value) || !Number.isSafeInteger(value.turn) || value.turn < 0) return undefined
  if (!PERSISTED_STATUS.has(value.status) || !PERSISTED_CURVE_QUALITY.has(value.curveQuality)) return undefined
  const durationMs = finiteNumber(value.durationMs)
  if (durationMs === undefined || durationMs < 0) return undefined
  const summary = {
    turn: value.turn,
    status: value.status,
    durationMs,
    curveQuality: value.curveQuality,
    eventTicks: persistedEventTicks(value.eventTicks),
    ...(Array.isArray(value.inputTicks) ? { inputTicks: persistedInputTicks(value.inputTicks) } : {}),
    sparkline: persistedSparkline(value.sparkline),
  }
  for (const key of ['avgTps', 'totalTokens', 'cachePct', 'ttftMs', 'llmMs', 'ttftSteps', 'decodeMs', 'decodeTokens', 'stepCount', 'toolWorkMs', 'toolWallMs']) {
    const number = finiteNumber(value[key])
    if (number !== undefined) summary[key] = number
  }
  if (PERSISTED_RATE_QUALITIES.has(value.rateQuality)) summary.rateQuality = value.rateQuality
  if (isRecord(value.tokens)) {
    const tokens = {}
    for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) {
      const number = finiteNumber(value.tokens[key])
      if (number !== undefined && number >= 0) tokens[key] = number
    }
    if (Object.keys(tokens).length > 0) summary.tokens = tokens
  }
  const segments = persistedSegments(value.segments, 64)
  if (segments.length > 0) summary.segments = segments
  if (value.activitySummary !== undefined) {
    const activitySummary = persistedActivitySummary(value.activitySummary)
    if (activitySummary !== undefined) summary.activitySummary = activitySummary
  }
  const subagents = persistedSubagents(value.subagents)
  if (subagents.length > 0) summary.subagents = subagents
  return summary
}

function persistedSessionSummary(value) {
  if (!isRecord(value)) return undefined
  for (const key of ['rounds', 'steps']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return undefined
  }
  if (!PERSISTED_CURVE_QUALITY.has(value.curveQuality)) return undefined
  const summary = { rounds: value.rounds, steps: value.steps, curveQuality: value.curveQuality }
  for (const key of ['llmDurationMs', 'toolDurationMs', 'avgTtftMs', 'avgTps', 'cachePct', 'inputTokens', 'outputTokens', 'updatedAt']) {
    const number = finiteNumber(value[key])
    if (number !== undefined && number >= 0) summary[key] = number
  }
  if (PERSISTED_RATE_QUALITIES.has(value.rateQuality)) summary.rateQuality = value.rateQuality
  return summary
}

function persistedTrajectory(value) {
  if (!isRecord(value)) return undefined
  const startMs = finiteNumber(value.startMs)
  const endMs = finiteNumber(value.endMs)
  if (startMs === undefined || endMs === undefined || endMs < startMs) return undefined
  return {
    startMs,
    endMs,
    segments: persistedSegments(value.segments),
    sparkline: persistedSparkline(value.sparkline, 160),
    eventTicks: persistedEventTicks(value.eventTicks).slice(-128),
    ...(Array.isArray(value.inputTicks) ? { inputTicks: persistedInputTicks(value.inputTicks) } : {}),
  }
}

function persistedLive(value) {
  if (!isRecord(value) || !Number.isSafeInteger(value.turn) || value.turn < 0) return undefined
  const live = { turn: value.turn }
  for (const key of ['durationMs', 'estimateRateTokS', 'openStep']) {
    const number = finiteNumber(value[key])
    if (number !== undefined) live[key] = number
  }
  if (PERSISTED_RATE_QUALITIES.has(value.rateQuality)) live.rateQuality = value.rateQuality
  if (value.activitySummary !== undefined) {
    const activitySummary = persistedActivitySummary(value.activitySummary)
    if (activitySummary !== undefined) live.activitySummary = activitySummary
  }
  return live
}

function persistedView(value) {
  if (!isRecord(value)) return undefined
  const last = persistedSummary(value.last)
  const recent = Array.isArray(value.recent)
    ? value.recent.map(persistedSummary).filter(Boolean).slice(-5)
    : []
  const live = persistedLive(value.live)
  const sessionSummary = persistedSessionSummary(value.sessionSummary)
  const trajectory = persistedTrajectory(value.trajectory)
  const liveSubagents = persistedSubagents(value.liveSubagents)
  if (!last && recent.length === 0 && !live && !sessionSummary && !trajectory && liveSubagents.length === 0) return undefined
  return {
    kind: live ? 'live' : 'idle',
    ...(live ? { live } : {}),
    ...(last ? { last } : {}),
    recent,
    ...(liveSubagents.length > 0 ? { liveSubagents } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
    ...(trajectory ? { trajectory } : {}),
  }
}

function parsePersistedPayload(text) {
  try {
    return JSON.parse(text)
  } catch {
    // A process can be terminated while two legacy writeFile calls overlap,
    // leaving an intact JSON object followed by the beginning of another
    // payload. Recover only the first complete top-level object; the normal
    // persistedView validation below remains the security boundary.
    const start = text.search(/\S/)
    if (start < 0 || text[start] !== '{') return undefined
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)) } catch { return undefined }
        }
      }
    }
    return undefined
  }
}

function readPersistedBreathSnapshot(stateFile) {
  try {
    const payload = parsePersistedPayload(readFileSync(stateFile, 'utf8'))
    const view = persistedView(payload?.view)
    if (!view) return undefined
    // V5.8 P0.1：快照携带会话指纹（脱敏，非原始 sessionId）。旧快照若只有
    // 顶层 sessionId（历史格式），按同一 sha256 规则指纹化后继续可用。
    const rawFingerprint = typeof payload?.sessionFingerprint === 'string' ? payload.sessionFingerprint : undefined
    const sessionFingerprint = rawFingerprint && rawFingerprint.length > 0
      ? rawFingerprint
      : (typeof payload?.sessionId === 'string' && payload.sessionId.length > 0
        ? sessionFingerprintOf(payload.sessionId)
        : undefined)
    return {
      writtenAt: typeof payload.writtenAt === 'string' ? payload.writtenAt : undefined,
      sessionFingerprint,
      view,
    }
  } catch {
    return undefined
  }
}

function resolveStateFile(config) {
  const configured = typeof config?.stateFile === 'string' ? config.stateFile.trim() : ''
  return configured || STATE_FILE
}

export async function writePersistedBreathSnapshot(stateFile, payload) {
  const operation = persistedWriteChain.then(async () => {
    const directory = dirname(stateFile)
    const temporaryFile = `${stateFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    const content = JSON.stringify(payload)
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporaryFile, content, 'utf8')
      try {
        await rename(temporaryFile, stateFile)
      } catch (error) {
        // Windows does not replace an existing file with fs.rename. The
        // process-wide write chain prevents interleaving while the fallback
        // updates the existing file, so concurrent telemetry frames cannot
        // splice two JSON payloads together.
        if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
        await writeFile(stateFile, content, 'utf8')
      }
    } finally {
      await unlink(temporaryFile).catch(() => {})
    }
  })
  persistedWriteChain = operation.catch(() => {})
  return operation
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

// cordis 对未注入的服务【访问即抛】；用安全取值避免把缺失服务当真值判断。
function svc(ctx, name) {
  try { return ctx[name] } catch { return undefined }
}

export const jingxiProjectionDefinition = Object.freeze({
  key: 'jingxi',
  schema: jingxiProjectionSchema,
  init: initJingxiFold,
  apply: applyJingxiFold,
  view: (state) => viewJingxiFold(state, Date.now()),
  stateVersion: 1,
})

// ── Gate 2 管线条底线：显式 demo:true（绝不冒充真实用户数据）
const DEMO_EVENTS = [
  { type: 'request/context', time: -50, data: { provider: 'opencode-go', model: 'deepseek-v4-flash' } },
  { type: 'turn/start', time: 0, data: { turn: 901 } },
  { type: 'step/start', time: 0, data: { turn: 901, step: 1 } },
  { type: 'assistant/chunk', time: 300, data: { turn: 901, step: 1, chunk: { type: 'text-delta' } } },
  { type: 'assistant/chunk', time: 800, data: { turn: 901, step: 1, chunk: { type: 'text-delta' } } },
  { type: 'assistant/chunk', time: 1300, data: { turn: 901, step: 1, chunk: { type: 'text-delta' } } },
  { type: 'assistant/message', time: 1400, data: { turn: 901, step: 1, usage: { inputTokens: 100, outputTokens: 400, cacheReadTokens: 900, cacheWriteTokens: 0 } } },
  { type: 'step/end', time: 1400, data: { turn: 901, step: 1 } },
  { type: 'turn/end', time: 2000, data: { turn: 901, reason: { kind: 'completed' } } },
]

function buildDemoView() {
  let state = initJingxiFold()
  for (const ev of DEMO_EVENTS) state = applyJingxiFold(state, ev)
  return viewJingxiFold(state, 2000)
}

// ── 真实会话实时折叠（用户已授权真实操作；仅增量 replay，不存内容）──
function createRealFold() {
  return {
    bySession: new Map(), // session id -> { state, lastSeq }
    current: undefined,   // { state, key, lastEventTime } 最近活跃/重放会话
    lastWrite: 0,
    replayReady: Promise.resolve(),
  }
}

function sessionIdOf(value) {
  const candidates = [value?.id, value?.header?.id, value?.session?.id]
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0)
}

// V5.8 P0.1：脱敏会话指纹。真实 sessionId（可能是路径/URL/长 UUID）永不进入
// projection 或任何响应；只透出 sha256 前 16 hex 的稳定短指纹，供客户端做
// 「同一会话自洽」校验（epoch 之外的迟到保护第二闸）。指纹本身不可逆推原文。
function sessionFingerprintOf(sessionKey) {
  if (typeof sessionKey !== 'string' || sessionKey.length === 0) return undefined
  return createHash('sha256').update(sessionKey, 'utf8').digest('hex').slice(0, 16)
}

function sessionKeyOf(session) {
  return sessionIdOf(session) ?? (isRecord(session) ? session : undefined)
}

function sessionEventsOf(session, event) {
  if (Array.isArray(session?.events) && session.events.length > 0) return session.events
  return event && typeof event === 'object' ? [event] : []
}

function foldEventList(realFold, sessionKey, events, stateFile) {
  if (!Array.isArray(events)) return Promise.resolve()
  let cell = realFold.bySession.get(sessionKey)
  if (cell === undefined) {
    cell = { state: initJingxiFold(), lastSeq: -1 }
    realFold.bySession.set(sessionKey, cell)
  }

  let changed = false
  let lastEventTime = cell.lastEventTime ?? Number.NEGATIVE_INFINITY
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const sequence = Number.isSafeInteger(event?.seq) ? event.seq : index
    if (sequence <= cell.lastSeq) continue
    if (Number.isFinite(event?.time)) lastEventTime = Math.max(lastEventTime, event.time)
    if (event && typeof event.type === 'string' && isRecord(event.data)) {
      applyJingxiFold(cell.state, {
        type: event.type,
        time: typeof event.time === 'number' ? event.time : 0,
        data: event.data,
      })
      changed = true
    }
    cell.lastSeq = sequence
  }
  cell.lastEventTime = lastEventTime
  if (!changed) return Promise.resolve()
  const candidate = { state: cell.state, key: sessionKey, lastEventTime }
  if (realFold.current === undefined || lastEventTime > (realFold.current.lastEventTime ?? Number.NEGATIVE_INFINITY)) {
    realFold.current = candidate
    return persistBreath(realFold, candidate, stateFile)
  }
  return Promise.resolve()
}

function foldSession(realFold, session, event, stateFile = STATE_FILE) {
  const sessionKey = sessionKeyOf(session)
  if (sessionKey === undefined) return Promise.resolve()
  return foldEventList(realFold, sessionKey, sessionEventsOf(session, event), stateFile)
}

function applyRealSubagentLifecycle(realFold, type, info, stateFile) {
  const current = realFold.current
  if (current === undefined) return false
  const applied = applySubagentLifecycle(current.state, type, info, Date.now())
  if (!applied) return false
  return persistBreath(realFold, current, stateFile)
}

function sessionCreatedAt(record) {
  const value = record?.header?.createdAt ?? record?.session?.createdAt ?? record?.createdAt
  return Number.isFinite(value) ? value : 0
}

function refreshCurrentSession(realFold, sessionQuery, stateFile, logger) {
  // 后台 fire-and-forget：不阻塞端点响应。失败静默（保留现有 fold）。
  Promise.resolve().then(async () => {
    const records = await sessionQuery.listSessions()
    if (!Array.isArray(records)) return
    const newest = records
      .filter((record) => sessionIdOf(record) !== undefined)
      .slice()
      .sort((a, b) => sessionCreatedAt(b) - sessionCreatedAt(a))[0]
    const newestId = newest ? sessionIdOf(newest) : undefined
    const currentKey = realFold.current && realFold.current.key !== undefined
      ? realFold.current.key
      : (realFold.current && realFold.current.sessionId) || undefined
    if (newestId !== undefined && newestId !== currentKey) {
      await replayLatestPersistedSession(realFold, sessionQuery, stateFile, logger)
    }
  }).catch((error) => {
    logger?.warn?.('[jingxi] breath background refresh skipped:', String(error))
  })
}

async function replayLatestPersistedSession(realFold, sessionQuery, stateFile, logger) {
  if (!sessionQuery || typeof sessionQuery.listSessions !== 'function' || typeof sessionQuery.readSession !== 'function') return
  let records
  try {
    records = await sessionQuery.listSessions()
  } catch (error) {
    logger?.warn?.('[jingxi] persisted session list skipped:', String(error))
    return
  }
  if (!Array.isArray(records)) return

  const candidates = records
    .filter((record) => sessionIdOf(record) !== undefined)
    .slice()
    .sort((a, b) => sessionCreatedAt(b) - sessionCreatedAt(a))

  for (const record of candidates.slice(0, REPLAY_CANDIDATE_LIMIT)) {
    const sessionId = sessionIdOf(record)
    try {
      const snapshot = await sessionQuery.readSession(sessionId)
      const session = {
        id: sessionId,
        events: Array.isArray(snapshot?.events) ? snapshot.events : [],
      }
      await foldSession(realFold, session, undefined, stateFile)
    } catch (error) {
      // One corrupt/unavailable historical session must not hide newer usable
      // telemetry or prevent the web endpoint from serving its last snapshot.
      logger?.warn?.('[jingxi] persisted session replay skipped:', String(error))
    }
  }
}

function persistBreath(realFold, cur, stateFile = STATE_FILE) {
  if (!cur || !(cur.state.recent.length > 0 || cur.state.live.turn !== undefined)) return Promise.resolve()
  const settled = cur.state.recent.length > 0
  const now = Date.now()
  // 纯 live 帧节流 500ms；已 settle（turn/end 后）必须落盘，避免进程退出前丢结算
  if (!settled && now - realFold.lastWrite < 500) return
  realFold.lastWrite = now
  const fingerprint = sessionFingerprintOf(cur.key)
  const payload = {
    ok: true, real: true, source: 'real', demo: false,
    ...(fingerprint !== undefined ? { sessionFingerprint: fingerprint } : {}),
    view: viewJingxiFold(cur.state, now),
    writtenAt: new Date().toISOString(),
  }
  return writePersistedBreathSnapshot(stateFile, payload).catch(() => {})
}

export function apply(ctx, config) {
  ctx.effect(() => {
    const disposers = []
    const logger = svc(ctx, 'logger')
    const stateFile = resolveStateFile(config)
    const realFold = createRealFold()
let sessionCheckAt = 0
    // Restore the last safe projection after a host/plugin reload. The file
    // contains only scalar telemetry + sparkline points; it never becomes a
    // source for raw session content. A test-only stateFile override keeps the
    // endpoint contract deterministic without changing production ownership.
    let persisted = readPersistedBreathSnapshot(stateFile)

    // ── 核心（有无 webServer 都运行）：投影注册 + 真实事件折叠 ──
    let projectionRegistered = false
    try {
      ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register(jingxiProjectionDefinition)
        projectionRegistered = true
        logger?.info?.('[jingxi] projection registered')
      })
    } catch (error) {
      logger?.warn?.('[jingxi] projection registration skipped:', String(error))
    }

    let realListening = false
    try {
      ctx.on('session/event', (session, event) => {
        return realFold.replayReady
          .then(() => foldSession(realFold, session, event, stateFile))
          .catch((error) => { logger?.warn?.('[jingxi] fold err', String(error)); return undefined })
      })
      realListening = true
    } catch (error) {
      logger?.warn?.('[jingxi] real event listen skipped:', String(error))
    }

    // V5.9 ②：宿主子代理生命周期订阅（subagent/start|end → fold 投影）。
    // 与 session/event 并列注册；事件经 Cordis 总线，无 HTTP 依赖。
    try {
      ctx.on('subagent/start', (info) => {
        return realFold.replayReady
          .then(() => applyRealSubagentLifecycle(realFold, 'subagent/start', info, stateFile))
          .catch((error) => { logger?.warn?.('[jingxi] subagent start err', String(error)); return undefined })
      }, { global: true })
      ctx.on('subagent/end', (info) => {
        return realFold.replayReady
          .then(() => applyRealSubagentLifecycle(realFold, 'subagent/end', info, stateFile))
          .catch((error) => { logger?.warn?.('[jingxi] subagent end err', String(error)); return undefined })
      }, { global: true })
    } catch (error) {
      logger?.warn?.('[jingxi] subagent event listen skipped:', String(error))
    }

    // 冷启动重放必须在 breath endpoint 返回前完成：先读 DSH 官方持久
    // 查询服务，再补扫当前内存会话。只把脱敏 fold 结果留在 realFold/stateFile。
    const sessionQuery = svc(ctx, 'sessionQuery')
    const sessions = svc(ctx, 'sessions')
    realFold.replayReady = replayLatestPersistedSession(realFold, sessionQuery, stateFile, logger)
      .then(async () => {
        if (!sessions || typeof sessions.list !== 'function') return
        const currentSessions = await sessions.list()
        if (!Array.isArray(currentSessions)) return
        for (const session of currentSessions) await foldSession(realFold, session, undefined, stateFile)
      })
      .catch((error) => { logger?.warn?.('[jingxi] session replay skipped:', String(error)) })

    // ── web 路由（webServer 存在才注册；headless 无 webServer 自动跳过）──
    const webServer = svc(ctx, 'webServer')
    if (webServer) {
      const assets = webServer.register({
        kind: 'prefix', path: JINGXI_ASSET_ROUTE, handler: createAssetRouteHandler(),
      })
      disposers.push(assets)

      const dshRoot = typeof config?.dshRoot === 'string' && config.dshRoot.trim() ? config.dshRoot : undefined
      const dshHealthUrl = buildDshHealthUrl(webServer.port) ?? null
      const handleUpdateCheck = async (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
        const result = await checkDshUpdate({ root: dshRoot })
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(result))
      }
      const update = webServer.register({
        kind: 'exact', path: '/api/jingxi/update', handler: handleUpdateCheck,
      })
      disposers.push(update)
      const updateCompat = webServer.register({
        kind: 'exact', path: '/api/jingxi/update-check', handler: handleUpdateCheck,
      })
      disposers.push(updateCompat)

      const updateVerification = webServer.register({
        kind: 'exact', path: '/api/jingxi/update/status',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
          const requestUrl = new URL(req.url || '/api/jingxi/update/status', 'http://127.0.0.1')
          const restartId = requestUrl.searchParams.get('restartId') || undefined
          const result = await getDshUpdateVerification({ root: dshRoot, restartId, healthUrl: dshHealthUrl })
          const status = result.ok || result.state === 'verification-pending' || result.state === 'idle' ? 200 : 503
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(result))
        },
      })
      disposers.push(updateVerification)

      const lifecycle = webServer.register({
        kind: 'exact', path: '/api/jingxi/lifecycle',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
          if (!isTrustedWebRequest(req)) {
            res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'loopback same-origin request required' }))
            return
          }
          let body
          try {
            body = await readJsonBody(req)
          } catch (error) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'invalid request body' }))
            return
          }
          const action = body && typeof body === 'object' ? body.action : undefined
          if (!isLifecycleAction(action)) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, state: 'invalid-action', error: 'only restart and update are supported' }))
            return
          }

          const baseline = action === 'update'
            ? await readDshRuntimeHealth({ url: dshHealthUrl })
            : undefined
          const result = action === 'update' && !baseline?.ok
            ? {
              ok: false,
              state: 'blocked',
              complete: false,
              verified: false,
              errorCode: 'runtime-baseline-unavailable',
              error: 'DSH 重启前运行态基线不可验证，更新未执行。',
            }
            : await executeLifecycleAction(action, {
              update: () => applyDshUpdate({ root: dshRoot }),
              restart: ({ update } = {}) => requestDshRestart(dshRoot, {
                pendingVerification: action === 'update' && update?.mutated
                  ? { expectedVersion: update.installedVersion, previousBootId: baseline.bootId }
                  : undefined,
              }),
            })
          const status = result.ok ? (result.state === 'up-to-date' || result.state === 'current-newer' ? 200 : 202)
            : result.state === 'busy' ? 409 : 503
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(result))
        },
      })
      disposers.push(lifecycle)

      const status = webServer.register({
        kind: 'exact', path: '/api/jingxi/status',
        handler: async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({
            ok: true,
            jingxiVersion: PACKAGE_VERSION,
            packageVersion: PACKAGE_VERSION,
            designVersion: 'V1.0.1',
            projectionRegistered,
            realListening,
          }))
        },
      })
      disposers.push(status)

      const breath = webServer.register({
        kind: 'exact', path: '/api/jingxi/breath/current',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
          await realFold.replayReady
          // V5.9 会话同步（用户反馈：切换会话后状态/tok/s 不变）：
          // 宿主无 session/switch 事件——后台异步核对最新持久化会话（不阻塞响应）。
          // 性能（166 会话/158MB）：listSessions 遍历慢（~10-20s）——**30s 冷却**
          // 才重新列举（轮询 5s 不触发），且仅 id 比较、不同才重放。
          // fire-and-forget：响应立返，刷新在后台完成，下轮轮询看到新会话。
          try {
            const nowCheck = Date.now()
            if (sessionQuery && typeof sessionQuery.listSessions === 'function' && nowCheck - (sessionCheckAt || 0) > 30000) {
              sessionCheckAt = nowCheck
              refreshCurrentSession(realFold, sessionQuery, stateFile, logger)
            }
          } catch (error) {
            logger?.warn?.('[jingxi] breath session refresh skipped:', String(error))
          }
          const cur = realFold.current
          const hasReal = cur !== undefined && (cur.state.recent.length > 0 || cur.state.live.turn !== undefined)
          // V5.8 P0.1：响应顶层与 view 顶层同时稳定暴露 sessionId（sha256 脱敏
          // 指纹，非原始会话 ID）。客户端 gate 读 d.view.sessionId 做会话自洽校验，
          // 双位置避免任何表面取错层级；指纹不可逆推原文，不违反脱敏契约。
          const realFingerprint = cur !== undefined ? sessionFingerprintOf(cur.key) : undefined
          if (hasReal) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true, real: true, source: 'real', demo: false,
              ...(realFingerprint !== undefined ? { sessionId: realFingerprint } : {}),
              view: {
                ...(realFingerprint !== undefined ? { sessionId: realFingerprint } : {}),
                ...viewJingxiFold(cur.state, Date.now()),
              },
            }))
            return
          }
          // The real fold is authoritative while an in-memory session exists.
          // When the host has no current session, refresh the safe scalar
          // snapshot so another Desktop/runtime writer is visible without a
          // plugin reload. Invalid or partially written replacements are
          // ignored and keep the last known-safe snapshot.
          const latestPersisted = readPersistedBreathSnapshot(stateFile)
          if (latestPersisted) persisted = latestPersisted
          if (persisted) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              real: true,
              source: 'persisted',
              stale: true,
              demo: false,
              ...(persisted.sessionFingerprint !== undefined ? { sessionId: persisted.sessionFingerprint } : {}),
              ...(persisted.writtenAt ? { writtenAt: persisted.writtenAt } : {}),
              view: {
                ...(persisted.sessionFingerprint !== undefined ? { sessionId: persisted.sessionFingerprint } : {}),
                ...persisted.view,
              },
            }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          if (process.env.JINGXI_PREVIEW === 'true') {
            res.end(JSON.stringify({ ok: true, source: 'demo', demo: true, view: buildDemoView() }))
            return
          }
          res.end(JSON.stringify({ ok: true, source: 'none', demo: false, view: viewJingxiFold(initJingxiFold(), Date.now()) }))
        },
      })
      disposers.push(breath)
    }

    return () => { for (const d of disposers) d() }
  }, 'dsh-jingxi: telemetry fold + projection + lifecycle (V1.0.1)')
}
