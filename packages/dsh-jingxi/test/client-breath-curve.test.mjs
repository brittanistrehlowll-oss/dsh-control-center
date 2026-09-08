import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const clientPath = process.env.JINGXI_CLIENT_PATH
  ? pathToFileURL(process.env.JINGXI_CLIENT_PATH)
  : new URL('../lib/client.js', import.meta.url)

function elementTree(type, props, children) {
  return { type, props: props ?? {}, children }
}

function walk(value, output = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return output
  if (seen.has(value)) return output
  seen.add(value)
  if (Array.isArray(value)) {
    for (const child of value) walk(child, output, seen)
    return output
  }
  output.push(value)
  for (const child of value.children || []) walk(child, output, seen)
  return output
}

function textContent(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (typeof value === 'object') return textContent(value.children || [])
  return ''
}

async function renderBreathCurve(_legacyQuotaPercents = [45, 50, 25], lastSparkline, updatePayload, breathStatus = 'completed', options = {}) {
  const source = await readFile(clientPath, 'utf8')
  const registrations = new Map()
  const breathPayload = options.empty
    ? {
      ok: true,
      source: options.source ?? 'none',
      stale: options.stale ?? false,
      demo: options.demo ?? false,
      view: {
        ...(options.viewKind ? { kind: options.viewKind } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        last: undefined,
        live: options.live ?? null,
        recent: options.recentRows ?? [],
      },
    }
    : {
    ok: true,
    source: options.source ?? 'real',
    stale: options.stale ?? false,
    demo: options.demo ?? false,
    view: {
      ...(options.viewKind ? { kind: options.viewKind } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.sessionSummary ? { sessionSummary: options.sessionSummary } : {}),
      ...(options.trajectory ? { trajectory: options.trajectory } : {}),
      last: {
        status: breathStatus,
        turn: options.turn,
        ...(options.lastInputTicks ? { inputTicks: options.lastInputTicks } : {}),
        ...(options.lastSegments ? { segments: options.lastSegments } : {}),
        ...(options.lastActivitySummary ? { activitySummary: options.lastActivitySummary } : {}),
        ...(options.lastRateQuality ? { rateQuality: options.lastRateQuality } : {}),
        ...(options.lastSubagents ? { subagents: options.lastSubagents } : {}),
        ...(options.lastAvgTps !== undefined ? { avgTps: options.lastAvgTps } : { avgTps: 20 }),
        totalTokens: 30,
        cachePct: Object.prototype.hasOwnProperty.call(options, 'cachePct') ? options.cachePct : 0.5,
        durationMs: 100,
        eventTicks: options.eventTicks ?? [],
        sparkline: lastSparkline ?? [
          { tMs: 100000, rateTokS: 10 },
          { tMs: 100100, rateTokS: 20 },
        ],
      },
      live: options.live ?? null,
      recent: [{
        turn: 1,
        status: 'completed',
        avgTps: 12,
        totalTokens: 1234,
        cachePct: 0.8,
        durationMs: 1200,
        sparkline: [
          { tMs: 100000, rateTokS: 8 },
          { tMs: 100100, rateTokS: 12 },
        ],
      }],
    },
    }
  const dshUpdatePayload = updatePayload ?? {
    ok: true,
    currentVersion: '0.1.0-rc.8',
    latestVersion: '0.1.0-rc.7',
    updateAvailable: false,
    state: 'current-newer',
  }
  const requests = []
  let updateVerificationReads = 0
  let intervalCount = 0
  let clearCount = 0
  const windowListeners = new Map()
  const documentListeners = new Map()
  const addListener = (map, type, listener) => {
    const listeners = map.get(type) ?? []
    listeners.push(listener)
    map.set(type, listeners)
  }
  const React = {
    createElement: (type, props, ...children) => {
      if (typeof type !== 'function') return elementTree(type, props, children)
      const nextProps = { ...(props ?? {}) }
      if (children.length > 0) {
        nextProps.children = children.length === 1 ? children[0] : children
      }
      return type(nextProps)
    },
    useCallback: (fn) => fn,
    useEffect: (effect) => { effect() },
    useReducer: (_reducer, initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const window = {
    addEventListener: (type, listener) => addListener(windowListeners, type, listener),
    removeEventListener: () => {},
    setInterval: () => { intervalCount += 1; return intervalCount },
    clearInterval: () => { clearCount += 1 },
    __ModuleLoader__: {
      load: ({ factory }) => {
        const require = (id) => {
          if (id === 'react') return React
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return {
            Button: ({ children, icon, ...props }) => elementTree('button', {
              type: 'button',
              ...props,
            }, [icon, children]),
            FishLogo: ({ size = 24, className, ...fishProps }) => React.createElement('svg', {
              width: size,
              height: size * 17.04 / 23.16,
              className,
              ...fishProps,
              'data-test-fish-logo': 'official',
            }),
            IconRefreshOutline14: ({ size = 14 }) => elementTree('svg', {
              width: size,
              height: size,
              'data-test-refresh-icon': 'true',
            }, []),
            IconRefreshOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-refresh-icon-16': 'true',
            }, []),
            IconSendOutline14: ({ size = 14, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-send-icon-14': 'true',
            }, []),
            IconCheckOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-check-icon-16': 'true',
            }, []),
            IconPauseOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-pause-icon-16': 'true',
            }, []),
            IconPlayOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-play-icon-16': 'true',
            }, []),
            IconRightUpOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-right-up-icon-16': 'true',
            }, []),
            IconWarningOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-warning-icon-16': 'true',
            }, []),
            IconLoadingOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-loading-icon-16': 'true',
            }, []),
            IconCloseOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-close-icon-16': 'true',
            }, []),
            IconSettingsOutline16: ({ size = 16, className }) => elementTree('svg', {
              width: size,
              height: size,
              className,
              'data-test-settings-icon-16': 'true',
            }, []),
            Modal: ({ open, title, onClose, className, contentClassName, children, footer }) => open
              ? elementTree('div', {
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': title,
                className,
                contentClassName,
                onClose,
              }, [children, footer])
              : null,
          }
          throw new Error(`Unexpected client dependency: ${id}`)
        }
        window.plugin = factory(require)
      },
    },
  }
  const document = {
    hidden: false,
    visibilityState: 'visible',
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    addEventListener: (type, listener) => addListener(documentListeners, type, listener),
    removeEventListener: () => {},
  }
  const context = {
    window,
    document,
    fetch: (url, requestOptions = {}) => {
      requests.push({ url, options: requestOptions })
      // 乱序/延迟注入：breathResponses 为响应函数队列（每次 breath 请求消费一个）；
      // 每个函数返回 Promise，允许测试手动控制 resolve 顺序（epoch 迟到保护）。
      if (url === '/api/jingxi/breath/current' && Array.isArray(options.breathResponses)) {
        const responder = options.breathResponses.shift()
        if (typeof responder === 'function') return responder(requestOptions)
      }
      const payload = url === '/api/jingxi/breath/current'
        ? breathPayload
        : url === '/api/jingxi/update'
          ? dshUpdatePayload
          : { ok: true, state: 'restarting' }
      if (url === '/api/jingxi/update' && options.updateResponse) return Promise.resolve(options.updateResponse)
      if (url === '/api/jingxi/lifecycle' && options.lifecycleResponse) return Promise.resolve(options.lifecycleResponse)
      if (url.startsWith('/api/jingxi/update/status')) {
        const verification = typeof options.updateVerificationResponse === 'function'
          ? options.updateVerificationResponse(updateVerificationReads++)
          : options.updateVerificationResponse ?? { ok: true, state: 'idle', complete: false, verified: false }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(verification), text: () => Promise.resolve(JSON.stringify(verification)) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload), text: () => Promise.resolve(JSON.stringify(payload)) })
    },
    console: { info: () => {}, warn: () => {} },
  }
  context.globalThis = context
  vm.runInNewContext(source, context, { filename: clientPath.pathname })

  const slots = {
    inject: (_slot, register) => register(),
    register: (meta, component) => {
      registrations.set(`${meta.name}:${meta.id}`, { meta, component })
      return { meta, component }
    },
  }
  window.plugin.apply({ slots })
  await new Promise((resolve) => setImmediate(resolve))

  const footer = registrations.get('sidebar.footer.action:jingxi').component({ wide: true })
  const railFooter = registrations.get('sidebar.footer.action:jingxi').component({ wide: false })
  // V1.0.1：侧栏入口点击直达呼吸轨迹（无中间面板）——wide/rail 入口均为
  // 'breath' surface trigger；registrations 中不再有 jingxi-panel/jingxi-update。
  assert.equal(registrations.has('shell.overlay:jingxi-panel'), false, 'V1.0.1: the Jingxi panel overlay must not be registered')
  assert.equal(registrations.has('shell.overlay:jingxi-update'), false, 'V1.0.1: the DSH update overlay must not be registered')
  const jingxiButton = walk(footer).find((node) => node.props?.['data-jx-surface-trigger'] === 'breath')
  assert.ok(jingxiButton, 'Sidebar Footer should expose a single Jingxi Breath entry button')
  jingxiButton.props.onClick({ currentTarget: { focus() {} } })
  // V5.7：openBreath 现在 force-load（随会话切换），等待 fetch mock 完成提交 view，
  // 避免后续断言读到刚清空的 loading 空态。
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  const overlay = registrations.get('shell.overlay:jingxi').component({})
  const tree = walk(overlay)
  const curveSvg = tree.find((node) => node.props?.className === 'jx-curve-svg')
  const path = curveSvg ? walk(curveSvg).find((node) => node.type === 'path') : undefined
  if (!options.empty && !options.allowEmptyCurve) assert.ok(path, 'BreathSurface should render an SVG path for two sparkline points')
  return {
    path: path?.props?.d,
    tree,
    footerTree: walk(footer),
    railFooterTree: walk(railFooter),
    breathComponent: registrations.get('shell.overlay:jingxi').component,
    footerComponent: registrations.get('sidebar.footer.action:jingxi').component,
    settingsComponent: registrations.get('settings.section:jingxi')?.component,
    registrations,
    requests,
    windowListeners,
    documentListeners,
    setDocumentHidden: (value) => { document.hidden = value },
    intervalCount: () => intervalCount,
    clearCount: () => clearCount,
    source,
  }
}

test('BreathCurve maps a Turn-relative time span across the full chart width', async () => {
  const { path } = await renderBreathCurve()

  assert.match(path, /^M4(?:\.0)? /)
  assert.match(path, / C/, 'BreathCurve should use a smoothed cubic path')
  assert.equal(Number(path.match(/([0-9.]+) [0-9.]+$/)?.[1]), 556)
})

test('Completed real sessions disclose snapshot state instead of claiming live activity', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'real',
    sessionSummary: { rounds: 1, steps: 1, avgTps: 74, cachePct: 0.98 },
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [{ kind: 'model', startMs: 0, endMs: 1000 }],
      inputTicks: [{ tMs: 0, kind: 'input' }],
      sparkline: [{ tMs: 0, rateTokS: 40 }, { tMs: 1000, rateTokS: 74 }],
      eventTicks: [],
    },
  })
  const source = result.tree.find((node) => node.props?.className === 'jx-curve-source')
  const cursor = result.tree.find((node) => node.props?.className === 'jx-curve-cursor')

  assert.match(textContent(source), /^已完成会话/u)
  assert.doesNotMatch(textContent(source), /实时会话/u)
  assert.equal(cursor?.props?.['data-state'], 'complete')
  assert.equal(textContent(cursor), '结束')
})

test('BreathCurve exposes real axes, a filled plot, and a live cursor only for live sessions', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'real',
    live: { openStep: 3 },
    trajectory: {
      startMs: 1000,
      endMs: 61000,
      segments: [{ kind: 'model', startMs: 1000, endMs: 61000 }],
      inputTicks: [{ tMs: 1000, kind: 'input' }],
      sparkline: [{ tMs: 1000, rateTokS: 12 }, { tMs: 31000, rateTokS: 48 }, { tMs: 61000, rateTokS: 74 }],
      eventTicks: [{ tMs: 31000, kind: 'tool' }],
    },
  })
  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  const axis = result.tree.find((node) => node.props?.className === 'jx-curve-yaxis')
  const timeAxis = result.tree.find((node) => node.props?.className === 'jx-curve-xaxis')
  const svg = walk(curve).find((node) => node.props?.className === 'jx-curve-svg')
  const area = walk(svg).find((node) => node.props?.className === 'jx-curve-area')
  const cursor = result.tree.find((node) => node.props?.className === 'jx-curve-cursor')

  assert.ok(axis, 'The plot should expose a visible rate axis')
  assert.ok(textContent(axis).includes('0'), 'The rate axis should disclose its zero baseline')
  assert.ok(timeAxis, 'The plot should expose a visible elapsed-time axis')
  assert.ok(textContent(timeAxis).includes('0s'), 'The time axis should start at zero elapsed seconds')
  assert.ok(area?.props?.d, 'The real curve should expose a filled area path')
  assert.equal(cursor?.props?.['data-state'], 'live')
  assert.equal(textContent(cursor), 'Now')
  assert.match(result.source, /jx-curve-guides/u)
  assert.match(result.source, /jx-curve-area/u)
})

test('Reference workbench keeps the cache fact in one aligned KPI with data context', async () => {
  // V5.8 P2.1：英文状态词（GOOD/GREAT/PERFECT）从用户可见文案删除；
  // 颜色档位只保留在内部 data-quality（high/medium），不进入任何可见文本。
  const cases = [
    { cachePct: 0.75, value: '75%', tier: undefined },
    { cachePct: 0.9, value: '90%', tier: 'medium' },
    { cachePct: 0.9899, value: '98.99%', tier: 'medium' },
    { cachePct: 0.99, value: '99%', tier: 'high' },
    { cachePct: 0.9999, value: '99.99%', tier: 'high' },
    { cachePct: 1, value: '100%', tier: 'high' },
  ]

  for (const expected of cases) {
    const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', expected)
    const cacheKpi = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
    const quality = cacheKpi && walk(cacheKpi).find((node) => node.props?.className === 'jx-fact__meta')
    assert.ok(cacheKpi, 'The reference workbench should expose one Cache KPI')
    assert.ok(quality, 'Known cache ratios should expose one data context line')
    assert.match(textContent(cacheKpi), new RegExp(expected.value))
    assert.equal(cacheKpi.props['data-quality'], expected.tier, `${expected.value} keeps its internal colour tier`)
    assert.match(textContent(quality), /缓存命中/u, 'the quality context line stays pure Chinese data copy')
    assert.doesNotMatch(textContent(cacheKpi), /(?:GOOD|GREAT|PERFECT)/u)
  }
})

test('Reference workbench follows the supplied effect image anatomy and keeps real metrics visible', async () => {
  const result = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    live: { openStep: 3, estimateRateTokS: 33 },
    sessionSummary: {
      rounds: 8,
      steps: 73,
      llmDurationMs: 1246000,
      toolDurationMs: 1323000,
      avgTtftMs: 5500,
      avgTps: 74,
      cachePct: 0.83,
      inputTokens: 4_200_000,
      outputTokens: 140_000,
    },
    trajectory: {
      startMs: 0,
      endMs: 420_000,
      segments: [
        { kind: 'model', startMs: 20_000, endMs: 70_000 },
        { kind: 'tool', startMs: 110_000, endMs: 135_000 },
      ],
      inputTicks: [{ tMs: 10_000, kind: 'input' }],
      sparkline: [
        { tMs: 0, rateTokS: 20, cumulativeOutputTokens: 0 },
        { tMs: 120_000, rateTokS: 134, cumulativeOutputTokens: 72_000 },
        { tMs: 420_000, rateTokS: 52, cumulativeOutputTokens: 140_000 },
      ],
      eventTicks: [{ tMs: 110_000, kind: 'tool' }],
    },
  })

  const facts = result.tree.filter((node) => node.props?.className === 'jx-fact')
  assert.equal(facts.length, 5, 'the first screen keeps exactly five metric cards')
  assert.equal(facts.every((node) => walk(node).some((child) => child.props?.className === 'jx-fact__value')), true)
  const cacheFact = result.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  const statusFact = walk(result.tree).find((node) => node.props?.className === 'jx-title-lockup' && textContent(node).includes('线程状态'))
  assert.ok(walk(cacheFact).find((node) => node.props?.className === 'jx-fact__meta'), 'cache keeps its quality context line')
  assert.match(textContent(statusFact), /生成中/u, 'a live session keeps the generating status in the header (v2.1)')
  assert.doesNotMatch(result.source, /jx-dashboard-kpi__spinner/u, 'the plugin spinner is removed')
  const tokenKpi = result.tree.find((node) => node.props?.['data-metric'] === 'tokens')
  assert.match(textContent(tokenKpi), /4\.20M/u, 'token facts live in the KPI row (v2.1)')
  const durationKpi = result.tree.find((node) => node.props?.['data-metric'] === 'duration')
  assert.match(textContent(durationKpi), /7m0s/u, 'duration = trajectory wall-clock span (v2.1)')

  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  assert.ok(curve, 'v2.1: the curve card is the single trajectory timeline')
  const now = walk(curve).find((node) => node.props?.className === 'jx-curve-cursor')
  assert.ok(now, 'v2.1: the curve exposes the current-moment cursor')

  const axis = result.tree.find((node) => node.props?.className === 'jx-curve-yaxis')
  assert.equal(walk(axis).filter((node) => node.props?.className === 'jx-curve-yaxis__tick').length, 5, 'The curve should expose five reference y-axis ticks')
  const legendText = textContent(result.tree.find((node) => node.props?.className === 'jx-curve-legend'))
  assert.doesNotMatch(legendText, /Cache Hit/u, 'B8 (v2.1): Cache hit-rate lives only in the header chip, not the legend')
  const cacheChip = result.tree.find((node) => node.props?.['data-header-fact'] === 'cache')
  assert.match(textContent(cacheChip), /83%/u, 'Cache hit-rate shows in the header chip when real telemetry exists')

  const foldTools = result.tree.filter((node) => node.props?.['data-jx-fold-action'])
  assert.deepEqual(foldTools.map((node) => node.props?.['data-jx-fold-action']), [], 'quota/tools fold actions must not live in the dialog (sidebar owns them)')
  assert.doesNotMatch(textContent(result.tree), /额度|重启|更新/u, 'the dialog must not duplicate the sidebar quota/tools copy')
  assert.match(textContent(result.tree.find((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/u).includes('jx-phase-story'))), /启动.*加速.*巡航.*扰动.*收敛.*完成/u)
  assert.equal(result.tree.some((node) => node.props?.className === 'jx-session-summary-card'), false, 'The aside Session Summary card must be removed')
})

test('Reference workbench keeps the cache quality context single and shows thread status in the aligned status KPI', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { cachePct: 0.9831 })
  const cacheKpi = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  const qualityLabels = walk(cacheKpi).filter((node) => node.props?.className === 'jx-fact__meta')
  const statusFact = walk(tree).find((node) => node.props?.className === 'jx-title-lockup' && textContent(node).includes('线程状态'))
  const header = walk(tree).find((node) => node.props?.className === 'jx-header')

  assert.equal(qualityLabels.length, 1, 'Cache quality keeps one semantic label')
  assert.equal(cacheKpi.props['data-quality'], 'medium', '98.31% keeps the medium internal colour tier')
  assert.doesNotMatch(textContent(cacheKpi), /(?:GOOD|GREAT|PERFECT)/u, 'no English cache status word reaches the UI')
  assert.match(textContent(header), /鲸息.*运行轨迹/u)
  assert.match(textContent(statusFact), /线程状态：已完成/u, 'the status fact carries the current thread status')
})


test('V5.5 keeps cache quality honest below threshold and for unknown telemetry', async () => {
  const low = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { cachePct: 0.52 })
  const lowText = textContent(low.tree)
  assert.match(lowText, /52%/)
  assert.doesNotMatch(lowText, /(?:GOOD|GREAT|PERFECT)/)

  const unknown = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { cachePct: undefined })
  const unknownKpi = unknown.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  assert.match(textContent(unknownKpi), /—/)
  assert.doesNotMatch(textContent(unknown.tree), /(?:GOOD|GREAT|PERFECT)/)
})

test('V5.5 uses one phase narrative and overlays event ticks on the Breath Curve axis', async () => {
  const { tree, source } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 8 },
    { tMs: 100100, rateTokS: 20 },
    { tMs: 100200, rateTokS: 18 },
    { tMs: 100300, rateTokS: 24 },
  ], undefined, 'completed', {
    cachePct: 0.9,
    eventTicks: [
      { tMs: 100150, kind: 'tool' },
      { tMs: 100225, kind: 'retry' },
    ],
  })
  const narrative = tree.find((node) => node.props?.className === 'jx-phase-narrative')
  const ticks = tree.filter((node) => node.props?.className === 'jx-curve-event-tick')

  assert.ok(narrative, 'Breath should expose a compact phase narrative')
  assert.match(textContent(narrative), /启动/)
  assert.match(textContent(narrative), /工具停顿/)
  assert.match(textContent(narrative), /收束/)
  assert.equal(ticks.length, 2, 'Each safe runtime event should become one curve tick')
  assert.equal(ticks[0].props['data-event-kind'], 'tool')
  assert.equal(ticks[1].props['data-event-kind'], 'retry')
  assert.match(ticks[0].props.style.left, /50%/)
  assert.match(ticks[1].props.style.left, /75%/)
  assert.doesNotMatch(source, /jx-curve-stages/u, 'Fixed phase legend must not return as a second phase UI')
})

test('BreathCurve discloses trajectory provenance and rendered sample counts', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'real',
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [{ kind: 'model', startMs: 0, endMs: 1000 }, { kind: 'tool', startMs: 400, endMs: 600 }],
      inputTicks: [{ tMs: 200, kind: 'input' }],
      sparkline: [{ tMs: 200, rateTokS: 40 }, { tMs: 800, rateTokS: 74 }],
      eventTicks: [],
    },
  })

  const source = result.tree.find((node) => node.props?.className === 'jx-curve-source')

  assert.equal(textContent(source), '已完成会话 · 2 点 · 2 段')
})

test('BreathCurve spreads display event highlights across real trajectory segments', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'real',
    sessionSummary: { rounds: 3, steps: 3, avgTps: 74, cachePct: 0.98 },
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [
        { kind: 'model', startMs: 0, endMs: 180 },
        { kind: 'tool', startMs: 120, endMs: 150 },
        { kind: 'model', startMs: 180, endMs: 700 },
        { kind: 'tool', startMs: 620, endMs: 650 },
        { kind: 'model', startMs: 700, endMs: 1000 },
      ],
      inputTicks: [{ tMs: 0, kind: 'input' }, { tMs: 500, kind: 'input' }],
      sparkline: [
        { tMs: 0, rateTokS: 40 },
        { tMs: 500, rateTokS: 74 },
        { tMs: 1000, rateTokS: 60 },
      ],
      // The persisted event projection can be sparse or limited to the latest
      // turn. The display should still use the real trajectory segment starts.
      eventTicks: [{ tMs: 620, kind: 'tool' }],
    },
  })

  const ticks = result.tree.filter((node) => node.props?.className === 'jx-curve-event-tick')
  const positions = ticks.map((node) => Number.parseFloat(String(node.props?.style?.left ?? '')))

  assert.equal(ticks.length, 2, 'A persisted event at a segment start should not duplicate the display marker')
  assert.ok(positions.some((position) => position >= 10 && position <= 15), 'An early real tool segment should create a curve highlight')
  assert.ok(positions.some((position) => position >= 60 && position <= 65), 'A later real tool segment should remain highlighted')
})

test('BreathCurve compresses dense tool markers without discarding trajectory data', async () => {
  const eventTicks = Array.from({ length: 48 }, (_, index) => ({
    tMs: 100 + index * 15,
    kind: 'tool',
  }))
  const { tree } = await renderBreathCurve([45, 50, 25], [
    { tMs: 0, rateTokS: 40 },
    { tMs: 1000, rateTokS: 74 },
  ], undefined, 'completed', { eventTicks })
  const ticks = tree.filter((node) => node.props?.className === 'jx-curve-event-tick')

  assert.ok(ticks.length <= 24, 'Dense tool events should be clustered into a quiet curve overlay')
  assert.ok(
    ticks.some((node) => Number(node.props?.['data-event-count']) > 1),
    'A clustered marker should disclose that it represents multiple tool events',
  )
})

test('dense real BreathCurve smooths only the display path and discloses raw sample count', async () => {
  const sparkline = Array.from({ length: 160 }, (_, index) => ({
    tMs: index * 1000,
    rateTokS: index % 9 === 0 ? 420 : 72 + (index % 7) * 5,
  }))
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    trajectory: {
      startMs: 0,
      endMs: 159000,
      segments: [{ kind: 'model', startMs: 0, endMs: 159000 }],
      inputTicks: [{ tMs: 0, kind: 'input' }],
      sparkline,
      eventTicks: [],
    },
  })
  const svg = walk(tree).find((node) => node.props?.className === 'jx-curve-svg')

  assert.equal(svg?.props?.['data-curve-samples'], 160, 'The chart should disclose the raw sample count')
  assert.equal(svg?.props?.['data-curve-display'], 'smoothed', 'Dense samples should use a quieter display path')
  assert.ok(
    Number(svg?.props?.['data-curve-render-samples']) < 160,
    'The display path should be reduced without changing the underlying trajectory payload',
  )
})

test('Reference BreathCurve scales its axis to contain real peaks (B6) while preserving outlier disclosure', async () => {
  const sparkline = Array.from({ length: 24 }, (_, index) => ({
    tMs: index * 1000,
    rateTokS: index % 4 === 2 ? 911 : 74 + (index % 4) * 5,
  }))
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    trajectory: {
      startMs: 0,
      endMs: 23000,
      segments: [{ kind: 'model', startMs: 0, endMs: 23000 }],
      inputTicks: [{ tMs: 0, kind: 'input' }],
      sparkline,
      eventTicks: [],
    },
  })
  const svg = walk(tree).find((node) => node.props?.className === 'jx-curve-svg')
  const peak = tree.find((node) => node.props?.className === 'jx-curve-peak')

  assert.ok(Number(svg?.props?.['data-curve-axis-max']) >= 1000, 'The axis must contain the 911 tok/s peak (×1.1) instead of clamping at 160 (B6)')
  assert.equal(svg?.props?.['data-curve-axis-max'], 1020, 'The axis scales to ceil(peak×1.1/20)×20 (B6)')
  assert.match(textContent(peak), /峰值 911 tok\/s/u, 'The raw outlier must remain visible as a peak fact')
})

test('BreathCurve centers a flat rate sample instead of pinning it to the top edge', async () => {
  const { path } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 10 },
    { tMs: 100100, rateTokS: 10 },
  ])

  const yValues = [...path.matchAll(/(?:M|C)[^ ]+ ([0-9.]+)/g)].map((match) => Number(match[1]))
  assert.ok(yValues.length > 0, 'BreathCurve should expose path coordinates')
  assert.ok(yValues.every((value) => value > 40 && value < 120), 'Flat samples should stay visually centered')
})

test('BreathCurve smoothing keeps every control point inside the plot bounds', async () => {
  const { path } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 1 },
    { tMs: 100010, rateTokS: 1000 },
    { tMs: 100500, rateTokS: 2 },
    { tMs: 100600, rateTokS: 900 },
    { tMs: 100700, rateTokS: 3 },
  ])

  const coordinates = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
  assert.equal(coordinates.length % 2, 0, 'BreathCurve path should contain complete x/y pairs')
  for (let index = 0; index < coordinates.length; index += 2) {
    const x = coordinates[index]
    const y = coordinates[index + 1]
    assert.ok(x >= 4 && x <= 556, `curve x coordinate ${x} should stay inside the plot`)
    assert.ok(y >= 4 && y <= 156, `curve y coordinate ${y} should stay inside the plot`)
  }
})

test('Jingxi panel uses JingxiMark and renders the focused Breath surface', async () => {
  const { tree } = await renderBreathCurve()
  const mark = tree.find((node) =>
    typeof node.props?.className === 'string' && node.props.className.includes('jx-mark'))
  const header = tree.find((node) => node.props?.className === 'jx-header')
  const headerMark = header
    ? walk(header).find((node) => node.props?.className === 'jx-mark')
    : undefined
  const row = tree.find((node) => node.props?.className === 'jx-recent-row')
  const footerMark = tree.find((node) =>
    typeof node.props?.className === 'string' && node.props.className.includes('jx-fc-jingxi'))

  assert.ok(mark, 'Breath title should anchor itself with the owned JingxiMark')
  assert.ok(headerMark, 'Breath header should keep the reference whale anchor')
  assert.ok(
    walk(headerMark).some((node) => node.props?.['data-dsh-official-fish-logo'] === 'true'),
    'Breath header whale should use the official DSH fish mark',
  )
  assert.ok(
    walk(mark).some((node) => node.props?.['data-dsh-official-fish-logo'] === 'true'),
    'The Session Summary should use the official DSH fish mark',
  )
  assert.equal(footerMark, undefined, 'Jingxi panel should not nest another Footer entry')
  assert.ok(tree.some((node) => node.props?.className === 'jx-event-rail'), 'Breath panel should expose the neutral Event Rail')
  assert.ok(row, 'BreathSurface should render a Recent 5 row')
  assert.equal(row.props.role, 'listitem', 'Recent 5 rows should expose list semantics')

  assert.equal(tree.filter((node) => node.props?.className === 'jx-fact').length, 5, 'Breath panel should lead with five aligned metric cards')
  assert.ok(tree.some((node) => node.props?.className === 'jx-breath-facts'), 'Breath panel should expose the facts band')
  assert.ok(tree.some((node) => node.props?.className === 'jx-curve'), 'Breath panel should expose the Breath Curve')
  assert.ok(tree.some((node) => node.props?.className === 'jx-event-rail'), 'Breath panel should expose the Event Rail')
  assert.ok(tree.some((node) => node.props?.className === 'jx-recent'), 'Breath panel should expose Recent 5')
  assert.ok(tree.some((node) => node.props?.className === 'jx-breath-folds'), 'Breath panel should expose the detail folds')

  const rowClasses = walk(row)
    .map((node) => node.props?.className)
    .filter((value) => typeof value === 'string')
  assert.ok(rowClasses.includes('jx-recent-row__turn'), 'Recent rows should expose a turn column')
  assert.ok(rowClasses.includes('jx-recent-row__status'), 'Recent rows should expose a status column')
  assert.ok(rowClasses.includes('jx-recent-row__metric'), 'Recent rows should expose metric columns')

  assert.equal(tree.some((node) => node.props?.className === 'jx-jingxi-tools'), false, 'Breath panel should not add a duplicate host shortcut dashboard')
})

test('Breath surface follows the focused native hierarchy without changing the host shell', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    sessionSummary: {
      rounds: 8,
      steps: 73,
      llmDurationMs: 1246000,
      toolDurationMs: 1323000,
      avgTtftMs: 5500,
      avgTps: 74,
      cachePct: 0.9831,
      inputTokens: 7374683,
      outputTokens: 64125,
      curveQuality: 'authoritative-calibrated',
    },
    trajectory: {
      startMs: 1000,
      endMs: 2000,
      segments: [
        { kind: 'model', startMs: 1000, endMs: 1500 },
        { kind: 'tool', startMs: 1500, endMs: 1700 },
      ],
      inputTicks: [{ tMs: 1100, kind: 'input' }],
      sparkline: [
        { tMs: 1100, rateTokS: 40, cumulativeOutputTokens: 100 },
        { tMs: 1800, rateTokS: 74, cumulativeOutputTokens: 64125 },
      ],
      eventTicks: [{ tMs: 1500, kind: 'tool' }],
    },
  })
  const hasClass = (name) => result.tree.some((node) =>
    typeof node.props?.className === 'string' && node.props.className.split(/\s+/u).includes(name))

  assert.ok(hasClass('jx-breath-native'), 'Breath should use the focused native surface')
  assert.ok(hasClass('jx-curve'), 'v2.1: the trajectory timeline lives inside the curve card')
  assert.ok(hasClass('jx-curve-legend'), 'v2.1: the compact legend carries trajectory counts')
  assert.ok(hasClass('jx-breath-reading'), 'Breath should expose the curve reading region')
  for (const required of ['jx-breath-body', 'jx-breath-facts', 'jx-breath-folds', 'jx-phase-story', 'jx-curve']) {
    assert.equal(hasClass(required), true, `${required} should be part of the reference Breath workbench`)
  }
  assert.match(result.source, /\.jx-modal--breath\{width:min\(920px,calc\(100vw - 96px\)\);max-height:min\(574px,calc\(100dvh - 146px\)\);/u)
  assert.equal(result.tree.some((node) => node.props?.className === 'jx-fold__tool'), false, 'dialog fold tool buttons must be gone (tools live in the sidebar)')
  assert.equal(hasClass('jx-fc-actions'), false, 'Workbench must not add a second host footer action strip')
})

test('Breath dashboard follows the reference workbench hierarchy with real session facts', async () => {
  const result = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    sessionSummary: {
      rounds: 8,
      steps: 73,
      llmDurationMs: 1246000,
      toolDurationMs: 1323000,
      avgTtftMs: 5500,
      avgTps: 74,
      cachePct: 0.9831,
      inputTokens: 7374683,
      outputTokens: 64125,
    },
    trajectory: {
      startMs: 1000,
      endMs: 3857972,
      segments: [
        { kind: 'model', startMs: 1000, endMs: 1500 },
        { kind: 'tool', startMs: 1500, endMs: 1700 },
      ],
      inputTicks: [{ tMs: 1100, kind: 'input' }],
      sparkline: [
        { tMs: 1000, rateTokS: 20, cumulativeOutputTokens: 10 },
        { tMs: 2000, rateTokS: 74, cumulativeOutputTokens: 120 },
      ],
      eventTicks: [{ tMs: 1500, kind: 'tool' }],
    },
  })
  const hasClass = (name) => result.tree.some((node) =>
    typeof node.props?.className === 'string' && node.props.className.split(/\s+/u).includes(name))
  const all = result.tree

  assert.ok(hasClass('jx-breath-body'), 'Breath should expose the scrolling dialog body')
  assert.ok(hasClass('jx-breath-facts'), 'Breath should keep trajectory and curve inside the body column')
  assert.equal(hasClass('jx-dashboard-side'), false, 'The aside summary rail must be removed')
  assert.equal(all.filter((node) => node.props?.className === 'jx-fact').length, 5, 'Breath should expose five aligned metric cards')
  assert.ok(hasClass('jx-breath-folds'), 'The dialog folds should replace the aside quick actions')
  assert.equal(hasClass('jx-session-summary-card'), false, 'The Session Summary card must be removed')
  assert.equal(hasClass('jx-dashboard-quota'), false, 'The quota card must be removed')
  assert.equal(all.filter((node) => node.props?.className === 'jx-phase-story__card').length, 6, 'Reference dashboard should expose six phase story cards')
  assert.match(textContent(result.tree), /快照 · 2 点 · 2 段/u, 'The compact strip should keep the real trajectory meta sentence')
  assert.match(textContent(result.tree), /阶段叙事/u)
})

test('Breath main column keeps the real session facts without the aside readout', async () => {
  const result = await renderBreathCurve([30, 47, 6], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    sessionSummary: {
      rounds: 8,
      steps: 73,
      llmDurationMs: 1246000,
      toolDurationMs: 1323000,
      avgTtftMs: 5500,
      avgTps: 74,
      cachePct: 0.9831,
      inputTokens: 7374683,
      outputTokens: 64125,
    },
    trajectory: {
      startMs: 1000,
      endMs: 2000,
      segments: [{ kind: 'model', startMs: 1000, endMs: 2000 }],
      inputTicks: [{ tMs: 1100, kind: 'input' }],
      sparkline: [
        { tMs: 1100, rateTokS: 40 },
        { tMs: 1800, rateTokS: 74 },
      ],
      eventTicks: [],
    },
  })
  const text = textContent(result.tree)
  assert.match(text, /快照/u, 'The persisted snapshot should stay visible in the compact strip meta')
  const readout = result.tree.find((node) => node.props?.className === 'jx-session-readout')
  assert.ok(result.tree.some((node) => node.props?.['data-metric'] === 'tokens'), 'The main Breath workbench exposes session facts via the KPI row (v2.1)')
  // v2.1：readout 已并入 KPI 行——轮次·步数在 rounds 卡，Token 在 tokens 卡。
  const roundsKpi = result.tree.find((node) => node.props?.['data-metric'] === 'rounds')
  assert.match(textContent(roundsKpi), /8\s*轮/u, 'rounds live in the KPI row (v2.1)')
  assert.match(textContent(roundsKpi), /73\s*步/u, 'steps live in the KPI row (v2.1)')
  const tokensKpi = result.tree.find((node) => node.props?.['data-metric'] === 'tokens')
  assert.match(textContent(tokensKpi), /7\.44M/u, 'tokens live in the KPI row (v2.1)')
})

test('Reference KPI cards expose the session speed and cache quality context', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    sessionSummary: { rateQuality: 'session', avgTps: 74, cachePct: 0.9831, inputTokens: 1000, outputTokens: 200 },
    trajectory: {
      startMs: 1000,
      endMs: 3000,
      sparkline: [
        { tMs: 1000, rateTokS: 20 },
        { tMs: 1800, rateTokS: 70 },
        { tMs: 3000, rateTokS: 45 },
      ],
      segments: [],
      inputTicks: [],
      eventTicks: [],
    },
  })
  const rateKpi = result.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'rate')
  const cacheKpi = result.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  assert.ok(rateKpi, 'Reference Breath should expose the speed fact')
  assert.ok(cacheKpi, 'Reference Breath should expose the cache fact')
  assert.match(textContent(rateKpi), /74\s*tok\/s/u)
  assert.match(textContent(cacheKpi), /98\.31%/u)
  assert.ok(walk(cacheKpi).some((node) => node.props?.className === 'jx-fact__meta'))
  assert.match(result.source, /\.jx-fact__value\{/u)
})

test('Reference KPI cards keep the speed and cache lockups aligned in the same grid', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    sessionSummary: { avgTps: 74, cachePct: 0.9831, inputTokens: 1000, outputTokens: 200 },
    trajectory: {
      startMs: 1000,
      endMs: 3000,
      sparkline: [
        { tMs: 1000, rateTokS: 20 },
        { tMs: 1800, rateTokS: 70 },
        { tMs: 3000, rateTokS: 45 },
      ],
      segments: [],
      inputTicks: [],
      eventTicks: [],
    },
  })
  const facts = result.tree.filter((node) => node.props?.className === 'jx-fact')
  assert.equal(facts.length, 5, 'the first screen keeps the three audit facts')
  assert.deepEqual(facts.map((node) => node.props['data-metric']), ['tokens', 'duration', 'rounds', 'tools', 'errors'])
  assert.match(result.source, /\.jx-breath-facts\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/u)
})

test('Reference desktop workbench keeps the effect-image top breathing room without moving mobile surfaces', async () => {
  const result = await renderBreathCurve()

  assert.doesNotMatch(result.source, /@media \(min-width:1100px\)\{\.jx-modal--breath/u, 'the 1100px+ workbench inset must be removed')
  assert.match(
    result.source,
    /@media \(max-width:520px\)\{[^}]*\.jx-breath-native\{padding-bottom:12px;/u,
    'The mobile surface should keep its existing compact spacing contract',
  )
})

test('Breath restores the DSH native mask instead of a transparent full-screen veil', async () => {
  const result = await renderBreathCurve()

  assert.doesNotMatch(result.source, /div:has\(>\.jx-modal--breath\)/u, 'the host-rail workbench framing must be gone')
  assert.doesNotMatch(result.source, /\[class\*="_mask_"\]\{background:transparent/u, 'Breath must not erase the DSH modal mask')
  assert.doesNotMatch(result.source, /\.jx-modal--breath \.jx-breath-surface\{height:100%;max-height:100%;padding-inline:43px;/u)
})

test('Breath header keeps the official whale visible at the native scale', async () => {
  const result = await renderBreathCurve()

  assert.doesNotMatch(result.source, /\.jx-modal--breath \.jx-breath-native \.jx-header \.jx-mark\{display:none;/u, 'the dialog whale must stay visible')
  assert.doesNotMatch(result.source, /\.jx-breath-native \.jx-mark\{[^}]*width:2[46]px!important/u, 'no !important mark override may survive')
  const headerMark = walk(result.tree).find((node) => node.props?.className === 'jx-mark')
  assert.equal(headerMark?.props?.style?.width, 20, 'the header whale stays at the 20px native scale')
})

test('Breath keeps a three-fact runtime band without duplicating host lifecycle surfaces', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    sessionSummary: {
      rounds: 8, steps: 73, llmDurationMs: 1246000, toolDurationMs: 1323000,
      avgTtftMs: 5500, avgTps: 74, cachePct: 0.9831,
      inputTokens: 7374683, outputTokens: 64125,
    },
    trajectory: {
      startMs: 1000, endMs: 3857972, segments: [], inputTicks: [],
      sparkline: [{ tMs: 1000, rateTokS: 20 }, { tMs: 3857972, rateTokS: 74 }],
      eventTicks: [],
    },
  })
  const facts = result.tree.filter((node) => node.props?.className === 'jx-fact')
  assert.equal(facts.length, 5, 'the band keeps the five metric cards')
  assert.deepEqual(facts.map((node) => node.props['data-metric']), ['tokens', 'duration', 'rounds', 'tools', 'errors'])
  const statusFact = walk(result.tree).find((node) => node.props?.className === 'jx-title-lockup' && textContent(node).includes('线程状态'))
  assert.match(textContent(statusFact), /完成/u)
  const tokenKpi = result.tree.find((node) => node.props?.['data-metric'] === 'tokens')
  assert.match(textContent(tokenKpi), /7\.37M/u, 'the token total lives in the KPI row (v2.1)')
  const durationKpi = result.tree.find((node) => node.props?.['data-metric'] === 'duration')
  assert.match(textContent(durationKpi), /1h4m/u, 'the session duration lives in the KPI row (v2.1)')
  assert.equal(result.tree.some((node) => node.props?.className === 'jx-dashboard-side'), false)
})

test('Breath header exposes the current thread state and data freshness beside the title', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    sessionSummary: { rounds: 8, steps: 73, avgTps: 74, cachePct: 0.9831 },
    trajectory: {
      startMs: 1000,
      endMs: 3000,
      segments: [],
      inputTicks: [],
      sparkline: [
        { tMs: 1000, rateTokS: 20 },
        { tMs: 3000, rateTokS: 74 },
      ],
      eventTicks: [],
    },
  })
  const header = result.tree.find((node) => node.props?.className === 'jx-header')
  const note = walk(header).find((node) => node.props?.className === 'jx-quota-title__note')

  assert.ok(note, 'Breath header should retain a visible status line below the title')
  assert.equal(note.props['data-thread-status'], 'stable')
  assert.match(textContent(note), /线程状态：已完成/u)
  assert.match(textContent(note), /已保存快照 · 刷新可重新抓取/u)
})

test('Phase Story keeps the reference accent colors when host theme tokens are absent', async () => {
  const result = await renderBreathCurve()

  assert.match(
    result.source,
    /\.jx-phase-story__card\[data-tone="purple"\] \.jx-phase-story__dot\{background:var\(--jx-trajectory-input,currentColor\);\}/u,
    'Acceleration should use the same purple accent as the Input trajectory lane',
  )
  assert.match(
    result.source,
    /\.jx-phase-story__card\[data-tone="orange"\] \.jx-phase-story__dot\{background:var\(--jx-trajectory-model,currentColor\);\}/u,
    'Turbulence should use the same orange accent family as the Model activity band',
  )
})

test('Active breath marks use a restrained spout pulse and stop under reduced motion', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    live: { tMs: 2000, elapsedMs: 1000, openStep: 1 },
  })
  const activeMarks = [...walk(result.tree)].filter((node) => node.props?.['data-breath-state'] === 'active')

  assert.ok(activeMarks.length > 0, 'An active session should mark its visible whale as breathing')
  assert.match(result.source, /@keyframes jx-breath-pulse\{/u)
  assert.match(result.source, /\.jx-mark\[data-breath-state="active"\] \.jx-mark__spout\{[^}]*animation:jx-breath-pulse/u)
  assert.match(result.source, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.jx-mark\[data-breath-state="active"\] \.jx-mark__spout\{animation:none/u)
})

test('Phase Story highlights the currently inferred phase without inventing a new data source', async () => {
  const result = await renderBreathCurve([45, 52, 29], [
    { tMs: 1000, rateTokS: 18 },
    { tMs: 2000, rateTokS: 74 },
  ], undefined, 'completed', {
    live: { tMs: 2000, elapsedMs: 1000, openStep: 2 },
    eventTicks: [{ tMs: 1800, kind: 'tool' }],
  })
  const turbulence = walk(result.tree).find((node) => node.props?.className === 'jx-phase-story__card' && node.props?.['data-phase'] === 'turbulence')

  assert.equal(turbulence?.props?.['data-state'], 'active', 'A live tool interval should highlight Turbulence')
  assert.match(result.source, /\.jx-phase-story__card\[data-state="active"\]\{[^}]*box-shadow:/u)
})

test('Breath drops the quick-dock quota glyph; quota stays inside its own panel surface', async () => {
  const { tree, source } = await renderBreathCurve()
  assert.equal(tree.some((node) => node.props?.['data-jx-quick-action']), false, 'the quick dock is gone')
  assert.doesNotMatch(source, /jx-quick-action__quota-glyph|QuotaGlyph/u)
  assert.equal(tree.some((node) => node.props?.['aria-label'] === '额度'), false, 'quota facts must not live in the dialog fold')
})


test('JingxiMark constrains transparent artwork to the requested visual size', async () => {
  const { tree, footerTree } = await renderBreathCurve()
  const marks = [...walk(tree), ...walk(footerTree)].filter((node) => node.props?.className === 'jx-mark')

  assert.ok(marks.length > 0, 'Jingxi surfaces should render at least one JingxiMark')
  for (const mark of marks) {
    const fish = walk(mark).find((node) => node.props?.['data-dsh-official-fish-logo'] === 'true')
    assert.ok(fish, 'JingxiMark should use the host official FishLogo seam')
    assert.equal(mark.props.style?.width, fish.props.width, 'JingxiMark width should match the requested FishLogo size')
    assert.ok(fish.props.height <= mark.props.style?.height, 'FishLogo should stay inside the requested mark box')
  }
})

test('Footer declares intrinsic rail and wide widths for DSH sidebar slots', async () => {
  const { source } = await renderBreathCurve()

  assert.doesNotMatch(source, /\.jx-fc\[data-sidebar-mode="rail"\]\{[^}]*width:(?:48|240|280)px;/, 'Rail width must not be hard-coded by the plugin')
  assert.doesNotMatch(source, /\.jx-fc\[data-sidebar-mode="wide"\]\{[^}]*width:(?:48|240|280)px;/, 'Expanded width must not be hard-coded by the plugin')
  assert.match(source, /\.jx-fc-btn\{[^}]*width:36px;[^}]*min-width:36px;/, 'Sidebar entry should keep the DSH rail control footprint')
  assert.match(source, /'data-jx-surface-trigger': 'breath'/, 'Sidebar should expose one Jingxi Breath entry')
  assert.doesNotMatch(source, /\.jx-fc-heading\b/u, 'Expanded Sidebar should not expose a redundant Jingxi heading')
  assert.doesNotMatch(source, /\.jx-fc-actions\{/u, 'Expanded Sidebar should not use the old horizontal action strip')
  assert.doesNotMatch(source, /setInterval\([^)]*30000/u, 'Sidebar should not poll provider quota independently')
})

test('Sidebar reference layout keeps one Jingxi Breath entry in both wide and rail states', async () => {
  const { footerTree, railFooterTree } = await renderBreathCurve()
  const wideEntries = footerTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath')
  const railEntries = railFooterTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath')
  const providerRows = footerTree.filter((node) => node.props?.['data-jx-provider'])

  assert.equal(wideEntries.length, 1, 'Wide sidebar should expose one Jingxi Breath entry')
  assert.equal(railEntries.length, 1, 'Rail sidebar should expose one Jingxi Breath entry')
  assert.equal(providerRows.length, 0, 'Provider rows should not be duplicated in the Sidebar Footer')
  assert.equal(
    footerTree.some((node) => node.props?.['data-jx-quick-action']),
    false,
    'V1.0.1: the wide sidebar no longer carries a quick actions band',
  )
  assert.equal(
    footerTree.some((node) => node.props?.className === 'jx-fc-version'),
    false,
    'V1.0.1: the Harness version row is removed from the sidebar footer',
  )
  assert.equal(
    footerTree.some((node) => typeof node.props?.className === 'string' && node.props.className.includes('jx-fc-actions')),
    false,
    'Wide sidebar should not collapse actions into the old horizontal action strip',
  )
  assert.doesNotMatch(textContent(railFooterTree), /DS|Go|¥|%/u, 'Rail should remain a compact Jingxi-only entry')
})

test('Shared surfaces follow DSH modal geometry and native action rhythm', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /h\(Modal,/u, 'Jingxi surfaces should delegate mask, portal and dialog geometry to DSH Modal')
  assert.match(source, /\.jx-modal--breath\{width:min\(920px,calc\(100vw - 96px\)\);max-height:min\(574px,calc\(100dvh - 146px\)\);/, 'Breath should own the converged reference workbench width')
  assert.doesNotMatch(source, /\.jx-modal--update\{/u, 'V1.0.1: the update modal geometry is removed with the overlay')
  assert.doesNotMatch(source, /\.jx-modal--panel\{/u, 'V1.0.1: the panel modal geometry is removed with the overlay')
  assert.doesNotMatch(source, /\.jx-panel-tool\{/u, 'V1.0.1: panel tool styles are removed with the Jingxi panel')
  assert.doesNotMatch(source, /--dsw-alias-shadow-lv3/, 'Jingxi must not reference the unavailable alias shadow token')
})

test('Breath surface uses the DSH modal placement instead of a full-height dock', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /className: 'jx-modal--breath'/, 'Runtime should use the native DSH dialog layer')
  assert.match(source, /headless: true/, 'Breath should keep its own focused header while the host owns the dialog shell')
  assert.match(
    source,
    /\.jx-breath-surface\{[^}]*container-type:inline-size;[^}]*width:100%;[^}]*max-height:min\(574px,calc\(100dvh - 146px\)\);/,
    'Runtime content should remain responsive without recreating the modal shell',
  )
  assert.doesNotMatch(source, /\.jx-breath-surface\{[^}]*height:calc\(100vh - 2px\);/, 'Runtime must not force a viewport-height panel')
})

test('BreathCurve exposes a restrained data legend without recreating a dashboard', async () => {
  const { tree, source } = await renderBreathCurve()

  assert.equal(tree.some((node) => node.props?.className === 'jx-curve-legend'), true, 'BreathCurve should expose the chart encodings in one restrained legend')
  assert.match(source, /\.jx-curve-legend\{/, 'The chart legend should have a dedicated compact style')
  assert.doesNotMatch(source, /Cache Hit.*异常/u, 'Tool, cache and error semantics should stay in the curve data/event layer')
})

test('Runtime surface consumes DSH semantic tokens instead of a parallel color system', async () => {
  const { source } = await renderBreathCurve()
  const runtimeStyles = source.slice(source.indexOf("'.jx-breath-surface"), source.indexOf("'.jx-phase-story{min-width:0;"))

  assert.doesNotMatch(runtimeStyles.replace(/\.jx-fc-version__badge\{[^}]*\}/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/iu, 'Runtime styles must not carry literal colors (version badge is the user-approved black-on-white brand chip)')
  assert.match(runtimeStyles, /--dsw-alias-label-primary/, 'Runtime styles should use the host primary label token')
  assert.match(runtimeStyles, /--dsw-alias-state-success-primary/, 'Runtime healthy states should use the host success token')
  assert.doesNotMatch(runtimeStyles, /color-scheme:light/, 'Runtime must not flatten the host Dark theme into a light-only sheet')
  assert.doesNotMatch(runtimeStyles, /background:Canvas/, 'Runtime overlay must retain the host mask instead of replacing it with a light canvas')
  assert.doesNotMatch(runtimeStyles, /--dsw-alias-bg-layer-2:Canvas/, 'Runtime surface must consume the host background token')
  assert.match(runtimeStyles, /\.jx-breath-surface\{[^}]*color:var\(--dsw-alias-label-primary,currentColor\);/, 'Runtime content should inherit host semantic label tokens')
})

test('Sidebar stays quiet without owning a provider polling lifecycle', async () => {
  const result = await renderBreathCurve()

  assert.equal(result.documentListeners.has('visibilitychange'), false, 'Sidebar should not create a provider polling lifecycle')
  assert.equal(result.windowListeners.has('visibilitychange'), false, 'Window should not own refresh events')
  assert.equal(result.footerTree.some((node) => node.props?.className === 'jx-fc-refresh'), false, 'Wide Sidebar should not expose a second refresh control')
})

test('Breath Surface switches its recent table by container width', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-breath-surface\{[^}]*container-type:inline-size;[^}]*container-name:jingxi-surface;/,
    'Breath Surface should expose its own width to responsive rules',
  )
  assert.match(
    source,
    /@container jingxi-surface \(max-width:520px\)\{[^}]*\.jx-recent-row\{/,
    'Recent rows should compact when the host content area is narrow',
  )
})

test('Breath facts stay readable on phone-width surfaces', async () => {
  const { source } = await renderBreathCurve()

  assert.doesNotMatch(
    source,
    /@container jingxi-surface \(max-width:560px\)\{\.jx-breath-facts\{grid-template-columns:minmax\(0,1fr\);/,
    'Phone-width Breath should not spend most of the viewport stacking three short facts',
  )
  assert.match(
    source,
    /@container jingxi-surface \(max-width:360px\)\{\.jx-breath-facts\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/,
    'Phone-width Breath keeps a compact three-fact band with narrow typography',
  )
  assert.match(
    source,
    /@container jingxi-surface \(max-width:560px\)\{[\s\S]*?\.jx-summary-grid\{gap:2px 8px;/,
    'Phone-width summary grids should keep a compact column gap',
  )
})

test('Breath chart keeps terminal status labels inside the plot and reduces narrow time ticks', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-curve-cursor\[data-state="live"\],\.jx-curve-cursor\[data-state="complete"\]\{[^}]*top:0;/,
    'Live and completed cursor labels should stay inside the plot frame',
  )
  assert.match(
    source,
    /@container jingxi-surface \(max-width:520px\)\{[\s\S]*?\.jx-curve-xaxis__tick:nth-child\(2\),\.jx-curve-xaxis__tick:nth-child\(4\)\{display:none;\}/,
    'Narrow charts should keep only start, midpoint, and end time labels',
  )
})


test('Sidebar Breath entry keeps a clickable hit layer above the narrow host pane', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-fc\{[^}]*position:relative;[^}]*z-index:50;/,
    'Footer Breath entry should stay above the host empty-pane layer at narrow widths',
  )
})

test('Breath overlay stays above the host narrow workbench layer', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /h\(Modal,/u, 'A visible Jingxi surface should use the host portal layer above narrow workbench panels')
  assert.doesNotMatch(source, /className: 'jx-overlay'/u, 'Jingxi must not create a competing overlay layer')
})

test('Breath overlay restores focus to the invoking entry after it closes', async () => {
  const { source } = await renderBreathCurve()
  const breathOverlay = source.slice(source.indexOf('const BreathOverlay'), source.indexOf('const updateStatusText'))

  assert.match(source, /const openBreath = \(invoker\) => \{[\s\S]*?breathFocusReturn = captureFocusTarget\(invoker\)/)
  assert.match(source, /const closeBreath = \(\) => \{[\s\S]*?restoreFocusTarget\(breathFocusReturn\)/)
  assert.doesNotMatch(breathOverlay, /const previousFocus = typeof document !== 'undefined' \? document\.activeElement : undefined/)
  assert.doesNotMatch(breathOverlay, /if \(previousFocus && typeof previousFocus\.focus === 'function'\) previousFocus\.focus\(\)/)
})

test('Surface entry captures its invoker before the host can rerender the footer', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /const captureFocusTarget = \(candidate\) =>/)
  assert.match(source, /const restoreFocusTarget = \(target\) =>/)
  assert.match(source, /const focusTriggerSelector = \(surface\) =>/)
  assert.match(source, /data-jx-surface-trigger/)
  assert.match(source, /let breathFocusReturn = null/)
  assert.match(source, /const openBreath = \(invoker\) => \{[\s\S]*?breathFocusReturn = captureFocusTarget\(invoker\)/)
  assert.match(source, /onClick: \(event\) => openBreath\(event\.currentTarget\)/)
  assert.doesNotMatch(source, /openJingxiPanel|openUpdate|updateFocusReturn|jingxiPanelFocusReturn/, 'V1.0.1: panel/update invoker plumbing is removed with the overlays')
})

test('Open DSH surfaces move keyboard focus into their dialog', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /const useModalFocusGuard = \(open, selector\) =>/)
  assert.match(source, /useModalFocusGuard\(breathOpen, '\.jx-modal--breath'\)/)
  assert.doesNotMatch(source, /useModalFocusGuard\(updateOpen/u, 'V1.0.1: the update surface focus guard is removed with the overlay')
  assert.match(
    source,
    /dialog\.querySelector\('button\[aria-label\^="关闭"\]'\)/u,
    'Modal focus should prefer the host close control and stay inside the active surface',
  )
})

test('Breath surface exposes the reference workbench hierarchy', async () => {
  const { tree, source } = await renderBreathCurve()
  const classes = new Set(
    tree
      .map((node) => node.props?.className)
      .filter((className) => typeof className === 'string'),
  )

  assert.ok(classes.has('jx-breath-facts'), 'Breath should lead with the facts band')
  assert.ok(classes.has('jx-breath-folds'), 'Breath should expose the detail folds band')
  assert.ok(classes.has('jx-curve'), 'BreathCurve should remain the visual anchor')
  assert.ok(classes.has('jx-event-rail'), 'Runtime Event Layer should remain available as semantic state')
  assert.ok(classes.has('jx-recent'), 'Recent 5 should remain available below the curve')
  for (const required of ['jx-phase-story', 'jx-breath-folds']) {
    assert.equal([...classes].some((value) => typeof value === 'string' && value.split(/\s+/u).includes(required)), true, `${required} should remain in the reference Breath workbench`)
  }
  assert.match(source, /jx-breath-surface/, 'The surface should carry the focused Runtime surface identity')
  assert.match(source, /\.jx-breath-surface\{[^}]*color:var\(--dsw-alias-label-primary,currentColor\);/, 'The reference surface content should inherit host semantic tokens')
})

test('Breath fact band keeps cache quiet and honest with one value', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    cachePct: 0.75,
    lastRateQuality: 'historical',
  })
  const cacheItem = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  const rateItem = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'rate')

  assert.ok(cacheItem, 'Breath exposes a dedicated cache fact')
  assert.equal((textContent(cacheItem).match(/75%/gu) ?? []).length, 1)
  assert.equal(cacheItem.props['data-quality'], undefined, '75% stays colour-neutral (no invented praise tier)')
  assert.doesNotMatch(textContent(cacheItem), /(?:GOOD|GREAT|PERFECT)/u)
  assert.ok(textContent(rateItem).includes('20'), 'the band keeps the latest speed value')
  assert.ok(textContent(tree).includes('已保存快照 · 刷新可重新抓取'))
  assert.equal(tree.find((node) => node.props?.className === 'jx-breath-metrics'), undefined, 'the secondary metadata row is absorbed')
})





test('Session readout keeps complete metrics together and follows native trajectory marker geometry', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-session-readout\{[^}]*gap:4px 0;[^}]*min-width:0;[^}]*max-width:100%;/u,
    'The summary should use a compact, bounded native stats-line layout',
  )
  assert.match(
    source,
    /\.jx-session-readout__metric\{[^}]*display:inline-flex;[^}]*white-space:nowrap;/u,
    'A metric and its separator should remain one non-breaking unit',
  )
  assert.match(
    source,
    /\.jx-session-lane__track\{[^}]*height:8px;/u,
    'Trajectory lanes should keep the native 8px event strip height',
  )
  assert.match(
    source,
    /\.jx-session-lane__marker\{[^}]*width:8px;[^}]*height:8px;[^}]*border-radius:1px;/u,
    'All trajectory events should use native square markers',
  )
  assert.match(
    source,
    /\.jx-session-lane__marker\[data-kind="model"\]\{[^}]*color-mix\(in srgb/u,
    'Model events should use the DSH assistant semantic mix instead of the brand color alone',
  )
  assert.match(
    source,
    /\.jx-session-lane__marker\[data-kind="tool"\]\{[^}]*state-warn-label/u,
    'Tool events should use the DSH native warning label token',
  )
  assert.match(
    source,
    /\.jx-session-readout\{[^}]*font-size:13px;[^}]*line-height:20px;/u,
    'The complete session readout should use the native metadata text scale',
  )
  assert.match(
    source,
    /\.jx-session-readout__separator\{[^}]*margin-inline:6px;/u,
    'The complete session readout should keep visible separation between metrics',
  )
})

test('BreathCurve uses the session trajectory domain for every plotted layer', async () => {
  const result = await renderBreathCurve([45, 50, 25], [
    { tMs: 100, rateTokS: 10 },
    { tMs: 900, rateTokS: 20 },
  ], undefined, 'completed', {
    sessionSummary: {
      rounds: 1,
      steps: 1,
      avgTps: 15,
      curveQuality: 'authoritative-calibrated',
    },
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [{ kind: 'model', startMs: 0, endMs: 1000 }],
      inputTicks: [{ tMs: 250, kind: 'input' }],
      sparkline: [
        { tMs: 100, rateTokS: 40, cumulativeOutputTokens: 10 },
        { tMs: 900, rateTokS: 80, cumulativeOutputTokens: 80 },
      ],
      eventTicks: [{ tMs: 250, kind: 'tool' }],
    },
  })

  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  const svg = walk(curve).find((node) => node.type === 'svg' && node.props?.className === 'jx-curve-svg')
  const path = svg ? walk(svg).find((node) => node.type === 'path') : undefined
  const tick = walk(curve).find((node) => node.props?.className === 'jx-curve-event-tick')

  assert.equal(curve.props['data-trajectory-source'], 'session')
  assert.equal(curve.props['data-plot-start-ms'], 0)
  assert.equal(curve.props['data-plot-end-ms'], 1000)
  assert.ok(path && typeof path.props?.d === 'string', 'The curve should render a path with the full session domain')
  assert.match(path.props.d, /^M59\.2 /u, 'The curve should use the full session domain, not the first sample as x=0')
  assert.equal(tick.props.style.left, '25%', 'Event ticks should share the session domain with the curve and lanes')
})


test('BreathCurve never mixes a sparse session trajectory with the latest Turn curve', async () => {
  const result = await renderBreathCurve([45, 50, 25], [
    { tMs: 100, rateTokS: 10 },
    { tMs: 900, rateTokS: 20 },
  ], undefined, 'completed', {
    sessionSummary: {
      rounds: 8,
      steps: 73,
      avgTps: 74,
      curveQuality: 'estimated-final',
    },
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [],
      inputTicks: [{ tMs: 250, kind: 'input' }],
      sparkline: [{ tMs: 500, rateTokS: 74, cumulativeOutputTokens: 64_100 }],
      eventTicks: [],
    },
    allowEmptyCurve: true,
  })

  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  const empty = walk(curve).find((node) => node.props?.className === 'jx-curve-empty')

  assert.equal(curve.props['data-trajectory-source'], 'session')
  assert.equal(curve.props['data-curve-state'], 'empty')
  assert.match(textContent(empty), /会话轨迹.*速度采样不足/u)
  assert.doesNotMatch(textContent(empty), /更多采样后/u, 'The message must not imply that another Turn can complete this session plot')
})

test('Breath surface keeps the curve and design modules in one readable journey', async () => {
  const { tree, source } = await renderBreathCurve()
  assert.equal(tree.some((node) => node.props?.className === 'jx-curve'), true)
  assert.equal(tree.filter((node) => node.props?.className === 'jx-fact').length, 5)
  assert.equal(tree.some((node) => node.props?.className === 'jx-event-rail'), true)
  assert.equal(tree.some((node) => node.props?.className === 'jx-recent'), true)
  assert.equal(tree.some((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/u).includes('jx-phase-story')), true)
  assert.doesNotMatch(source, /\.jx-dashboard__grid\{/u)
})

test('Breath empty state keeps its next-step message visible without becoming a card', async () => {
  const { tree, source } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { empty: true })
  const empty = tree.find((node) => node.props?.className === 'jx-curve-empty')
  const rail = tree.find((node) => node.props?.className === 'jx-event-rail')

  assert.ok(empty, 'Empty Breath should remain discoverable to assistive technology')
  assert.ok(empty.props['aria-live'], 'Empty Breath should announce the next step')
  assert.equal(empty.props['data-visual'], undefined, 'Empty Breath copy should remain visible as the chart empty state')
  assert.equal(rail.props['data-visual'], undefined, 'Event Rail should remain visible as a quiet semantic row')
  assert.ok(tree.some((node) => node.props?.className === 'jx-fact'), 'Empty Breath should keep the facts band structure')
  assert.ok(tree.some((node) => node.props?.className === 'jx-event-rail'), 'Empty Breath should keep the semantic event row')
})

test('BreathCurve distinguishes a settled Turn with insufficient samples from an empty runtime', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 20 },
  ], undefined, 'completed', { allowEmptyCurve: true })
  const empty = tree.find((node) => node.props?.className === 'jx-curve-empty')

  assert.ok(empty, 'A single real sample should keep the chart empty state visible')
  const copy = textContent(empty)
  assert.match(copy, /速度采样不足/, 'A settled Turn should explain why the curve is not drawn yet')
  assert.match(copy, /更多采样/, 'The insufficient-sample state should give a concrete next step')
  assert.doesNotMatch(copy, /等待下一轮 Turn/, 'A completed Turn must not be presented as if no Turn has run')
})

test('BreathCurve empty state removes plot-grid weight while keeping real curves on the full grid', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-curve-grid:has\(\.jx-curve-empty\)\{[^}]*min-height:88px;[^}]*background:none;[^}]*border-top:0;[^}]*border-bottom:0;/,
    'Empty Breath should read as a quiet state, not a blank monitoring grid',
  )
  assert.match(source, /\.jx-curve-grid\{[^}]*min-height:128px;/, 'Real BreathCurve should retain the full plotting height')
})

test('BreathCurve keeps the plotting frame quiet instead of repeating a dashboard grid', async () => {
  const { source } = await renderBreathCurve()

  assert.match(
    source,
    /\.jx-curve-grid\{[^}]*background:transparent;/,
    'The real BreathCurve should use the curve itself as the primary visual signal',
  )
  assert.match(
    source,
    /\.jx-breath-surface \.jx-curve\[data-curve-state="empty"\] \.jx-curve-grid\{[^}]*background:none;/,
    'The sparse-data state should not reintroduce a monitoring grid',
  )
})

test('BreathCurve marks and compacts the real-data empty state', async () => {
  const { tree, source } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 10 },
  ], undefined, 'completed', { allowEmptyCurve: true })
  const curve = tree.find((node) => node.props?.className === 'jx-curve')

  assert.equal(curve?.props?.['data-curve-state'], 'empty', 'A single real sample must be explicitly marked as an empty plot state')
  assert.equal(textContent(curve).includes('启动'), true, 'The empty plot should keep the one-line phase narrative')
  assert.equal(textContent(curve).includes('收束'), true, 'A completed sparse Turn should end its narrative')
  assert.match(
    source,
    /\.jx-breath-surface \.jx-curve\[data-curve-state="empty"\]\{[^}]*min-height:210px;/,
    'The empty plot should preserve the reference chart frame',
  )
  assert.match(
    source,
    /\.jx-phase-narrative\{/,
    'The empty plot should retain the compact phase narrative style',
  )
})

test('Breath surface uses a focused reading vertical rhythm', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /\.jx-breath-primary\{[^}]*margin-top:24px;/, 'Breath should establish the primary reading rhythm')
  assert.match(source, /\.jx-breath-facts\{[^}]*padding:4px 0 4px;/, 'The facts band should establish the primary reading rhythm')
  assert.match(source, /\.jx-breath-surface \.jx-curve\{[^}]*margin-top:14px;[^}]*padding:13px 0 10px;/, 'Breath Curve should follow the trajectory with deliberate spacing')
  assert.match(source, /\.jx-curve-grid\{[^}]*min-height:128px;/, 'The empty curve should leave enough plotting space without pushing lower sections away')
  assert.match(source, /\.jx-curve-grid \.jx-curve-svg\{height:128px;/, 'Real curves should use the same compact plotting height as the empty state')
  assert.match(source, /\.jx-event-rail\{[^}]*border-bottom:1px solid var\(--dsw-alias-border-l2,/u)
})

test('BreathCurve clamps its tall height between the reference limits', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /\.jx-breath-native \.jx-curve-grid\{min-height:340px;/u, 'the plot grid bounds at the reference clamp')
  assert.match(source, /\.jx-breath-native \.jx-curve-plot\{height:340px;/u)
  assert.match(source, /\.jx-breath-native \.jx-curve-yaxis\{height:308px;/u)
  assert.match(source, /\.jx-breath-native \.jx-curve-plot \.jx-curve-svg\{height:308px;/u)
  assert.doesNotMatch(source, /@media \(max-height:900px\) and \(min-width:521px\)/u, 'the viewport-compressed 160px pass must be removed')
  assert.doesNotMatch(source, /\.jx-breath-native \.jx-curve-plot \.jx-curve-svg\{height:130px;/u, 'the short-viewport fixed height must be gone')
})

test('Breath surface exposes the complete reference workbench modules', async () => {
  const { tree, source } = await renderBreathCurve()
  const classes = new Set(
    tree
      .map((node) => node.props?.className)
      .filter((className) => typeof className === 'string'),
  )

  assert.ok(classes.has('jx-breath-facts'), 'The facts band should establish the run overview')
  assert.ok(classes.has('jx-breath-folds'), 'Detail folds should remain available')
  assert.ok(classes.has('jx-curve'), 'BreathCurve should remain the chart subject')
  assert.ok(classes.has('jx-event-rail'), 'Event Rail should explain the current run state')
  assert.ok(classes.has('jx-recent'), 'Recent 5 should remain available as rows')
  assert.equal(classes.has('jx-phase-story jx-phase-story--compact'), true, 'Phase Story should stay as the compact fold')
  assert.equal(classes.has('jx-session-summary-card'), false, 'The Session Summary card must be gone')
  assert.equal(classes.has('jx-dashboard-quota'), false, 'The quota card must be gone')
  assert.equal(classes.has('jx-breath-folds'), true, 'The dialog folds should remain')
  assert.doesNotMatch(source, /\.jx-dashboard__grid\{/u, 'Runtime should not create a second legacy dashboard surface')
})

test('Breath design surface keeps unsupported runtime facts explicitly unknown', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { empty: true })
  const text = textContent(tree)
  const cacheKpi = tree.find((node) => node.props?.className === 'jx-dashboard-kpi' && node.props?.['data-kpi'] === 'cache')

  assert.ok(text.includes('等待下一轮 Turn'), 'Empty runtime should tell the user how to get new data')
  assert.ok(text.includes('—'), 'Unsupported runtime facts should remain visibly unknown')
  assert.equal(text.includes('Breath Curve'), true, 'Empty runtime should retain the named curve region')
  assert.equal(text.includes('Event Rail'), false, 'Event Rail should stay a semantic aria label rather than extra visible copy')
  assert.equal(text.includes('demo'), false, 'The live empty state must not silently present demo data')
})



test('Sidebar owns one official Whale entry while update checks stay read-only in Settings', async () => {
  const { footerTree, railFooterTree, settingsComponent, requests } = await renderBreathCurve()
  const footerMark = footerTree.find((node) => node.props?.['data-jx-surface-trigger'] === 'breath')

  assert.ok(footerMark, 'Sidebar should use a Jingxi runtime mark for the Breath entry')
  assert.equal(
    footerTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath').length,
    1,
    'Sidebar should not render a second redundant Jingxi row beside the native selector',
  )
  const footerImages = footerTree.filter((node) => node.type === 'img')
  assert.equal(
    footerImages.some((node) => (node.props?.src?.includes('/assets/icons/brand/') && !node.props?.src?.includes('harness-badge')) || node.props?.src?.includes('/assets/icons/v15/runtime/')),
    false,
    'V1.5 Footer runtime marks should use the official FishLogo seam, not raster whale bodies',
  )
  const footerRuntimeMarks = footerTree.filter((node) => node.props?.['data-jx-runtime-mark'] === 'true')
  assert.equal(footerRuntimeMarks.length, 1, 'Sidebar should use one whale runtime mark')
  assert.deepEqual(
    footerRuntimeMarks.map((node) => node.props?.['data-action']),
    ['jingxi'],
    'Sidebar runtime mark should only represent the Jingxi entry',
  )
  assert.equal(footerRuntimeMarks[0].props?.['data-state'], 'stable', 'Completed turns should keep the collapsed entry calm')
  assert.ok(
    footerRuntimeMarks.every((node) => walk(node).some((child) => child.props?.['data-dsh-official-fish-logo'] === 'true')),
    'V1.5 Footer runtime marks should use the DSH official FishLogo seam',
  )
  assert.deepEqual(
    footerRuntimeMarks.map((node) => walk(node).find((child) => child.props?.['data-water-language'])?.props?.['data-water-language']),
    [undefined],
    'A settled sidebar entry should keep the official whale calm without active breath decoration',
  )
  assert.equal(
    footerTree.filter((node) => node.props?.['data-jx-action-icon'] === 'true').length,
    0,
    'Sidebar Footer should not carry lifecycle action glyphs',
  )

  const railActions = railFooterTree.filter((node) => node.props?.className?.split?.(' ').includes('jx-fc-btn'))
  assert.deepEqual(railActions.map((node) => node.props['aria-label']), ['鲸息'], 'Collapsed Sidebar should expose only the Jingxi entry')
  assert.equal(
    footerTree.some((node) => node.props?.['data-jx-quick-action']),
    false,
    'V1.0.1: restart/update quick actions are removed from the sidebar footer',
  )
  assert.equal(textContent(railFooterTree).includes('$1'), false, 'Rail sidebar must not render balance values')
  assert.equal(textContent(railFooterTree).includes('45%'), false, 'Rail sidebar must not render quota percentages')
  assert.equal(
    textContent(railFooterTree).includes('USD'),
    false,
    'Rail sidebar should not render provider details',
  )
  // V1.0.1：更新状态只在 Settings Doctor 只读呈现——渲染设置区之前不应有更新请求
  assert.equal(
    requests.some((request) => request.url === '/api/jingxi/update'),
    false,
    'No update request is fired before the Settings surface is opened',
  )
  walk(settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const settingsAfter = walk(settingsComponent({}))
  assert.ok(
    requests.some((request) => request.url === '/api/jingxi/update'),
    'Settings diagnostics should trigger the read-only DSH version check',
  )
  const settingsText = textContent(settingsAfter)
  assert.ok(settingsText.includes('更新可用'), 'Settings Doctor should keep the update availability row')
  assert.ok(settingsText.includes('最新'), 'Settings Doctor should surface the up-to-date state read-only')
  assert.ok(settingsText.includes('0.1.0-rc.8'), 'Settings should disclose the real runtime DSH version')
})

test('Settings Doctor keeps canonical update state rows when update is blocked or fails', async () => {
  const blocked = await renderBreathCurve([45, 50, 25], undefined, {
    ok: true,
    currentVersion: '0.1.0-rc.8',
    latestVersion: '0.1.1-rc.2',
    updateAvailable: true,
    state: 'available',
    mutationAllowed: false,
    compatibility: { state: 'unknown', reason: 'compatibility-unverified' },
  })
  walk(blocked.settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const blockedText = textContent(walk(blocked.settingsComponent({})))
  assert.ok(blockedText.includes('有更新'), 'Doctor should surface the available update read-only')
  assert.ok(blockedText.includes('已阻止'), 'Doctor should mark the unverified update as prevented')

  const failed = await renderBreathCurve([45, 50, 25], undefined, {
    ok: false,
    state: 'error',
    error: '暂时无法连接更新源，请稍后重试。',
  })
  walk(failed.settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const failedText = textContent(walk(failed.settingsComponent({})))
  assert.ok(failedText.includes('最新'), 'A failed check must not fabricate an available update')
  assert.doesNotMatch(failed.source, /runDshUpdate|lifecycle\(/u, 'V1.0.1: no client-side update/restart mutation remains')
})

test('Collapsed sidebar maps an interrupted turn to the official error state without provider details', async () => {
  const { railFooterTree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'interrupted')
  const mark = railFooterTree.find((node) => node.props?.['data-jx-runtime-mark'] === 'true')
  assert.equal(mark?.props?.['data-action'], 'jingxi')
  assert.equal(mark?.props?.['data-state'], 'failed')
  assert.ok(walk(mark).some((node) => node.props?.src?.includes('/assets/icons/v15/status/error.png')), 'Error state should add the red status badge')
  assert.equal(textContent(railFooterTree).includes('%'), false, 'Collapsed entry must stay free of quota details')
})

test('All terminal failure statuses use the same red Jingxi state across the workbench and sidebar', async () => {
  const cases = [
    ['interrupted', '线程状态：已中断'],
    ['aborted', '线程状态：已终止'],
    ['error', '线程状态：异常'],
    ['max-tokens', '线程状态：已达到 Token 上限'],
  ]

  for (const [status, expectedCopy] of cases) {
    const result = await renderBreathCurve([45, 50, 25], undefined, undefined, status)
  const statusFact = walk(result.tree).find((node) => node.props?.className === 'jx-title-lockup' && textContent(node).includes('线程状态'))
    const sidebarStatus = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-status__label')
    const eventRail = result.tree.find((node) => node.props?.className === 'jx-event-rail')
    const mark = result.railFooterTree.find((node) => node.props?.['data-jx-runtime-mark'] === 'true')

    assert.match(textContent(statusFact), new RegExp(expectedCopy), `${status} keeps its terminal copy`)
    assert.match(textContent(sidebarStatus), /需关注/u, `${status} surfaces as 需关注 in the expanded sidebar`)
    assert.equal(eventRail?.props?.['data-state'], 'error', `${status} should use the error Event Rail state`)
    assert.equal(mark?.props?.['data-state'], 'failed', `${status} should use the failed sidebar whale state`)
  }
})

test('Client never invokes the lifecycle mutation endpoint from its own surfaces', async () => {
  const result = await renderBreathCurve()
  walk(result.settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(
    result.requests.some((entry) => entry.url === '/api/jingxi/lifecycle'),
    false,
    'V1.0.1: no client surface may POST to the lifecycle mutation endpoint',
  )
  assert.doesNotMatch(result.source, /lifecycle\(/u, 'lifecycle() helper removed with the restart/update actions')
})

test('Breath surface follows the reference workbench hierarchy', async () => {
  const { tree, source } = await renderBreathCurve()
  assert.ok(tree.some((node) => node.props?.className?.split?.(' ').includes('jx-breath-surface')), 'Breath surface should expose its focused surface class')
  assert.equal(tree.filter((node) => node.props?.className === 'jx-fact').length, 5, 'Breath should lead with five aligned metric cards')
  assert.ok(tree.some((node) => node.props?.className === 'jx-breath-facts'), 'Breath should expose the facts band')
  assert.ok(tree.some((node) => node.props?.className === 'jx-curve'), 'BreathCurve should remain the visual anchor')
  assert.ok(tree.some((node) => node.props?.className === 'jx-event-rail'), 'Breath should expose the current runtime event semantically')
  assert.ok(tree.some((node) => node.props?.className === 'jx-recent'), 'Breath should keep Recent 5')
  for (const required of ['jx-phase-story', 'jx-breath-folds']) {
    assert.equal(tree.some((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/u).includes(required)), true, `${required} should remain in Breath`)
  }
  assert.match(source, /jx-breath-surface/, 'The Breath surface should identify the intended Runtime surface')
})

test('Breath surface uses the design copy for the Recent 5 section', async () => {
  const { tree } = await renderBreathCurve()
  const recent = tree.find((node) => node.props?.className === 'jx-recent')

  assert.equal(textContent(recent).includes('最近 5'), true, 'The visible recent-section label should match the design reference')
})

test('BreathCurve exposes a textual speed-range summary for assistive technology', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 8 },
    { tMs: 100100, rateTokS: 20 },
  ])
  const curve = tree.find((node) => node.props?.className === 'jx-curve')

  assert.match(
    curve?.props?.['aria-label'] ?? '',
    /BreathCurve.*8.*20.*tok\/s/u,
    'BreathCurve should communicate its sampled speed range without relying on the visual path',
  )
})

test('Breath surface gives an explicit empty state without a large blank chart', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { empty: true })
  const empty = tree.find((node) => node.props?.className === 'jx-curve-empty')
  const rail = tree.find((node) => node.props?.className === 'jx-event-rail')

  assert.ok(empty, 'Empty Breath should explain how to produce the first curve')
  assert.ok(textContent(empty).includes('当前会话暂无可绘制事件'), 'Empty Breath should use the V5.8 official no-event empty copy')
  assert.ok(textContent(rail).includes('等待下一轮 Turn'), 'Empty Event Rail should not look like a broken blank state')
  assert.equal(tree.some((node) => node.props?.className === 'jx-curve-placeholder'), false, 'Empty Breath must not render the old blank placeholder')
})

test('Breath surface keeps a persisted completed Turn visible while idle', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    viewKind: 'idle',
  })
  const text = textContent(tree)
  const status = tree.find((node) => node.props?.className === 'jx-event-rail')

  assert.equal(text.includes('完成'), true, 'A persisted completed Turn remains useful history while the host is idle')
  assert.equal(text.includes('等待会话'), false, 'Idle with history must not masquerade as an empty runtime')
  assert.equal(status?.props?.['data-state'], 'complete', 'The last completed Turn should retain its completed state')
  assert.equal(status?.children?.some((child) => child?.props?.className === 'jx-event-rail__detail'), true, 'Completed status should keep its Turn detail')
  assert.equal(tree.some((node) => node.props?.className === 'jx-fact'), true)
  assert.equal(tree.some((node) => node.props?.className === 'jx-recent'), true)
})

test('Breath surface uses the design waiting state only when idle has no history', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    empty: true,
    viewKind: 'idle',
  })
  const text = textContent(tree)
  const status = tree.find((node) => node.props?.className === 'jx-event-rail')

  assert.equal(text.includes('等待会话'), true, 'An empty idle projection should match the design waiting state')
  assert.equal(status?.props?.['data-state'], 'idle')
  assert.equal(status?.children?.some((child) => child?.props?.className === 'jx-event-rail__detail'), true)
  assert.equal(tree.some((node) => node.props?.className === 'jx-fact'), true)
  assert.equal(tree.some((node) => node.props?.className === 'jx-recent'), true)
})

test('Breath surface keeps stale disclosure out of the title row', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    viewKind: 'idle',
  })
  const header = tree.find((node) => node.props?.className === 'jx-header')
  const freshness = tree.find((node) => node.props?.className === 'jx-event-rail__detail')

  assert.equal(
    walk(header).some((node) => node.props?.className === 'jx-demo-badge'),
    false,
    'The Runtime title row should stay as quiet as the design reference',
  )
  assert.ok(textContent(freshness).includes('已保存快照 · 刷新可重新抓取'), 'Snapshot disclosure should remain available in the runtime event row')
})

test('Breath fact reading uses the compact reference copy and discloses persisted freshness', async () => {
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    lastRateQuality: 'historical',
  })
  const text = textContent(tree)
  const cacheItem = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  const rateItem = tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'rate')

  assert.ok(textContent(cacheItem).includes('50%'))
  assert.ok(textContent(rateItem).includes('20') && textContent(rateItem).includes('tok/s'))
  assert.equal((textContent(cacheItem).match(/50%/gu) ?? []).length, 1)
  assert.ok(text.includes('已保存快照 · 刷新可重新抓取'))
  assert.equal(text.includes('Total Tokens 30'), false)
})

test('Settings Doctor surfaces a readable error when the update check fails', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    updateResponse: {
      ok: false,
      status: 503,
      text: () => Promise.resolve('spawn pnpm.cmd ENOENT'),
    },
  })
  walk(result.settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const settingsText = textContent(walk(result.settingsComponent({})))
  assert.ok(settingsText.includes('找不到 pnpm'), 'Doctor should translate a spawn failure into an actionable message')
  assert.equal(settingsText.includes('Unexpected token'), false, 'Doctor must not leak JSON parse errors')
  assert.equal(settingsText.includes('spawn pnpm.cmd ENOENT'), false, 'Raw process errors must stay out of the UI')
})

test('Jingxi surfaces use DSH native Modal and Button primitives', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /const \{[^}]*Button[^}]*Modal[^}]*\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)
  assert.match(source, /h\(Modal,/u, 'Breath and update surfaces should be hosted by the DSH Modal primitive')
  assert.match(source, /h\(Button,/u, 'Jingxi actions should use the DSH Button primitive')
  assert.doesNotMatch(source, /window\.confirm/u, 'Update confirmation must not depend on the browser confirm dialog')
  assert.doesNotMatch(source, /className: 'jx-overlay'/u, 'Jingxi must not recreate the host modal overlay')
})

test('Effect-oriented trajectory keeps real event highlights on the curve reading surface', async () => {
  const result = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 18 },
    { tMs: 100500, rateTokS: 64 },
    { tMs: 101000, rateTokS: 32 },
  ], undefined, 'completed', {
    eventTicks: [{ tMs: 100500, kind: 'tool' }],
  })

  const tick = result.tree.find((node) => node.props?.className === 'jx-curve-event-tick')
  const dot = walk(tick).find((node) => node.props?.className === 'jx-curve-event-tick__dot')

  assert.ok(dot, 'Every real event highlight should expose a point on the Breath Curve')
  assert.match(dot.props.style?.top ?? '', /%$/u, 'The event point should be positioned by the sampled speed')
  assert.match(result.source, /\.jx-trajectory-strip\{[^}]*border:1px solid var\(--dsw-alias-border-l2,/u)
  assert.match(result.source, /\.jx-trajectory-strip\{[^}]*border-radius:12px;/u)
  assert.match(result.source, /\.jx-breath-native \.jx-curve\{[^}]*border:1px solid var\(--dsw-alias-border-l2,/u)
  assert.match(result.source, /\.jx-curve-event-tick__dot\{/u)
  assert.match(result.source, /\.jx-trajectory-strip \.jx-session-lane__track\{[^}]*border-radius:999px;/u, 'Trajectory rails should use the soft pill treatment from the reference')
  assert.match(result.source, /\.jx-trajectory-strip \.jx-session-lane__marker\{[^}]*border-radius:999px;/u, 'Trajectory segments should use rounded ends')
  assert.match(result.source, /\.jx-curve-event-tick\[data-event-kind="tool"\] \.jx-curve-event-tick__dot\{[^}]*background:var\(--dsw-alias-state-warn-primary,/u, 'Tool highlights should retain the host warning semantic color')
  assert.match(result.source, /\.jx-curve-event-tick\[data-event-kind="tool"\]::before\{[^}]*background:var\(--dsw-alias-state-warn-primary,/u, 'The event rail cap should use the same semantic color as the tool node')
})

test('Effect workbench keeps snapshot freshness compact inside the speed KPI', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    lastRateQuality: 'historical',
  })
  const rateKpi = result.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'rate')
  const meta = walk(rateKpi).find((node) => node.props?.className === 'jx-fact__meta')
  assert.equal(textContent(meta), '已保存快照')
  assert.doesNotMatch(textContent(rateKpi), /刷新可重新抓取/u)
})

test('Effect image event highlights use a readable dot weight without changing the data layer', async () => {
  const { source } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 18 },
    { tMs: 100500, rateTokS: 64 },
    { tMs: 101000, rateTokS: 32 },
  ], undefined, 'completed', {
    eventTicks: [{ tMs: 100500, kind: 'tool' }],
  })

  assert.match(source, /\.jx-curve-event-tick\{[^}]*opacity:\.75;/u, 'Event rails should stay visible but subordinate to the speed curve')
  assert.match(source, /\.jx-curve-event-tick__dot\{[^}]*width:10px;[^}]*height:10px;[^}]*box-shadow:/u, 'Event points should read as intentional highlights at effect-image scale')
})

test('Breath drops the tall-desktop workbench resizing pass', async () => {
  const { source } = await renderBreathCurve([45, 50, 25], [
    { tMs: 100000, rateTokS: 18 },
    { tMs: 100500, rateTokS: 64 },
    { tMs: 101000, rateTokS: 32 },
  ], undefined, 'completed', {
    trajectory: {
      startMs: 100000, endMs: 101000,
      segments: [
        { kind: 'model', startMs: 100000, endMs: 100300 },
        { kind: 'tool', startMs: 100500, endMs: 100700 },
      ],
      inputTicks: [{ tMs: 100010, kind: 'input' }],
      sparkline: [{ tMs: 100000, rateTokS: 18 }, { tMs: 100500, rateTokS: 64 }, { tMs: 101000, rateTokS: 32 }],
      eventTicks: [{ tMs: 100500, kind: 'tool' }],
    },
  })

  assert.doesNotMatch(source, /@media \(min-width:521px\) and \(min-height:901px\)\{\.jx-breath-native\{padding-top:18px;/u)
  assert.doesNotMatch(source, /\.jx-breath-native \.jx-header \.jx-mark\{[^}]*width:26px!important/u)
  assert.doesNotMatch(source, /jx-dashboard-kpi|jx-dashboard-quota|jx-dashboard-side/u)
  assert.match(source, /\.jx-breath-native \.jx-title\{[^}]*font-size:20px;/u)
})

test('Desktop Breath modal converges to a centered ≤920px dialog', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /\.jx-modal--breath\{width:min\(920px,calc\(100vw - 96px\)\);max-height:min\(574px,calc\(100dvh - 146px\)\);/u, 'the modal stays 920×574 content-bounded')
  assert.doesNotMatch(source, /@media \(min-width:1100px\)\{\.jx-modal--breath\{[^}]*height:calc\(100vh - 48px\);/u)
  assert.doesNotMatch(source, /left:100px|calc\(100vw - 100px\)|border-radius:0/u)
  assert.match(source, /\.jx-breath-body\{[^}]*flex:1 1 auto;[^}]*overflow:auto;/u, 'the body owns the inner scroll')
  assert.match(source, /\.jx-breath-native \.jx-header\{[^}]*flex:0 0 auto;/u, 'header stays fixed')
})

test('Breath refreshes a live session without polling completed snapshots', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface')
  const breathEnd = source.indexOf('const BreathOverlay', breathStart)
  const surface = source.slice(breathStart, breathEnd)

  assert.match(
    surface,
    /const liveRefreshEnabled = Boolean\(live\)[\s\S]*React\.useEffect\(\(\) => \{[\s\S]*if \(!liveRefreshEnabled\) return undefined[\s\S]*window\.setInterval\(\(\) => \{[\s\S]*?setBreathCountdown\(5\)[\s\S]*?breathService\.load\(\{ force: true \}\)[\s\S]*?\}, 5000\)[\s\S]*window\.clearInterval\(timerId\)[\s\S]*\}, \[liveRefreshEnabled\]\)/u,
    'Only a live session should schedule a five-second refresh, and the timer must be cleaned up when the state settles or the surface closes',
  )
})

test('Expanded sidebar reorders into the audit section: divider → jingxi → status/steps → divider', async () => {
  const result = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    turn: 17,
    lastInputTicks: [
      { tMs: 0, kind: 'input' }, { tMs: 10, kind: 'input' },
      { tMs: 20, kind: 'input' }, { tMs: 30, kind: 'input' },
    ],
    lastSegments: [
      { kind: 'tool', startMs: 0, endMs: 100 },
      { kind: 'tool', startMs: 200, endMs: 300 },
      { kind: 'tool', startMs: 400, endMs: 500 },
      { kind: 'model', startMs: 600, endMs: 700 },
      { kind: 'model', startMs: 800, endMs: 900 },
      { kind: 'model', startMs: 1000, endMs: 1100 },
      { kind: 'model', startMs: 1200, endMs: 1300 },
    ],
  })
  // 步骤文本 = label + count（排除 ✓/○/— 标记字形，aria-hidden 语义）
  const stepText = (node) => textContent(
    walk(node).filter((child) =>
      ['jx-fc-step__label', 'jx-fc-step__count'].includes(child.props?.className)))
  const footer = result.footerTree
  const order = footer.map((node) => (typeof node.props?.className === 'string' ? node.props.className : ''))
  const firstDivider = order.findIndex((name) => name.includes('jx-fc-divider--breath'))
  const entryIndex = order.findIndex((name) => name.includes('jx-fc-entry'))
  const statusIndex = order.findIndex((name) => name.includes('jx-fc-status'))
  const stepsIndex = order.findIndex((name) => name.includes('jx-fc-steps'))
  const quotaGone = order.every((name) => !name.includes('jx-fc-quota'))
  const lastDivider = order.lastIndexOf('jx-fc-divider jx-fc-divider--breath')
  assert.ok(firstDivider >= 0 && lastDivider > firstDivider, 'top and bottom divider rows exist')
  assert.ok(quotaGone, 'V1.0.1: the sidebar carries no quota summary row')
  assert.equal(
    order.some((name) => name.includes('jx-fc-quick-actions') || name.includes('jx-fc-version')),
    false,
    'V1.0.1: quick actions and the version row are removed from the sidebar footer',
  )
  assert.ok(
    firstDivider < entryIndex && entryIndex < statusIndex && statusIndex < stepsIndex && stepsIndex < lastDivider,
    'audit order: divider → jingxi → status → steps → divider',
  )

  const statusText = textContent(walk(footer).find((node) => node.props?.className === 'jx-fc-status'))
  assert.match(statusText, /运行正常/u, 'the status block shows the stable copy')
  assert.match(statusText, /最近 Turn #17/u, 'the status block shows the latest turn')
  const steps = walk(footer).filter((node) => node.props?.className === 'jx-fc-step')
  assert.deepEqual(steps.map(stepText), ['输入步骤4 次', '工具调用3 次', '模型生成4 次'], 'the sidebar lists the three recent-turn counts')
})

test('Sidebar counts come from the recent turn, never the session trajectory', async () => {
  const result = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    turn: 17,
    lastInputTicks: [{ tMs: 0, kind: 'input' }, { tMs: 1, kind: 'input' }, { tMs: 2, kind: 'input' }, { tMs: 3, kind: 'input' }],
    lastSegments: [
      { kind: 'tool', startMs: 0, endMs: 10 },
      { kind: 'tool', startMs: 20, endMs: 30 },
      { kind: 'tool', startMs: 40, endMs: 50 },
      { kind: 'model', startMs: 60, endMs: 70 },
      { kind: 'model', startMs: 80, endMs: 90 },
      { kind: 'model', startMs: 100, endMs: 110 },
      { kind: 'model', startMs: 120, endMs: 130 },
    ],
    trajectory: {
      startMs: 0, endMs: 1000,
      segments: Array.from({ length: 26 }, (_, i) => ({ kind: 'tool', startMs: i * 10, endMs: i * 10 + 5 })),
      inputTicks: Array.from({ length: 256 }, (_, i) => ({ tMs: i, kind: 'input' })),
      sparkline: [{ tMs: 0, rateTokS: 10 }, { tMs: 1000, rateTokS: 20 }],
      eventTicks: [],
    },
  })
  // 步骤文本 = label + count（排除标记字形）
  const stepText = (node) => textContent(
    walk(node).filter((child) =>
      ['jx-fc-step__label', 'jx-fc-step__count', 'jx-panel-step__label', 'jx-panel-step__count'].includes(child.props?.className)))
  const firstStepsUl = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-steps')
  const sidebarSteps = firstStepsUl ? walk(firstStepsUl).filter((node) => node.props?.className === 'jx-fc-step') : []
  assert.deepEqual(
    sidebarSteps.map(stepText),
    ['输入步骤4 次', '工具调用3 次', '模型生成4 次'],
    'counts must match the recent turn metadata, not the 26/256 session totals',
  )
  const firstPanelUl = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-steps')
  assert.ok(firstPanelUl, 'the sidebar keeps the shared steps model after the panel removal')
})

test('Natural activity labels require an exact desensitized activitySummary', async () => {
  const exact = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    turn: 17,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 100 }],
    lastActivitySummary: { version: 1, readProject: 14, webSearch: 26, answer: 14, quality: 'exact' },
  })
  const stepText = (node) => textContent(
    walk(node).filter((child) =>
      ['jx-fc-step__label', 'jx-fc-step__count', 'jx-panel-step__label', 'jx-panel-step__count'].includes(child.props?.className)))
  const exactUl = walk(exact.footerTree).find((node) => node.props?.className === 'jx-fc-steps')
  const exactSteps = exactUl ? walk(exactUl).filter((node) => node.props?.className === 'jx-fc-step') : []
  assert.deepEqual(exactSteps.map(stepText), ['读取资料14 次', '全网检索26 次', '生成回答14 次'], 'exact activitySummary enables natural labels with real values')

  const estimated = await renderBreathCurve([38, 47, 23], undefined, undefined, 'completed', {
    turn: 17,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'tool', startMs: 0, endMs: 100 }],
    lastActivitySummary: { readProject: 14, webSearch: 26, answer: 14, quality: 'estimated' },
  })
  const estimatedUl = walk(estimated.footerTree).find((node) => node.props?.className === 'jx-fc-steps')
  const estimatedSteps = estimatedUl ? walk(estimatedUl).filter((node) => node.props?.className === 'jx-fc-step') : []
  assert.deepEqual(estimatedSteps.map(stepText), ['输入步骤1 次', '工具调用1 次', '模型生成'], 'estimated sources must not impersonate exact facts')
})

test('Sidebar waits for real turn data without a settled turn', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { empty: true })
  const firstStatus = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-status-block')
  const sidebarText = firstStatus ? textContent(walk(firstStatus)) : ''
  assert.match(sidebarText, /等待下一轮/u)
  assert.match(sidebarText, /等待真实 Turn 数据/u, 'no fabricated zero-completion list')
})

test('Breath production code keeps zero hard-coded turn counts', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 3,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 1000 }],
  })
  assert.doesNotMatch(result.source, /\b(?:14|26)\s*次/u, 'example counts must not be baked into client.js')
  const stepText = (node) => textContent(
    walk(node).filter((child) =>
      ['jx-fc-step__label', 'jx-fc-step__count'].includes(child.props?.className)))
  const readStep = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-step' && node.props?.['data-step'] === 'read')
  assert.match(stepText(readStep), /输入步骤1 次/u, 'rendered counts always come from real metadata')
})

test('Breath dialog restores the official whale, native mask and official close icon', async () => {
  const { tree, source } = await renderBreathCurve()
  const dialog = tree.find((node) => node.props?.role === 'dialog')
  assert.equal(dialog?.props?.['aria-modal'], 'true')
  const closeButton = walk(dialog).find((node) => node.props?.['data-jx-close'] === 'true')
  assert.ok(closeButton?.props?.['aria-label'] === '关闭鲸息呼吸轨迹', 'close keeps the convergence label')
  assert.ok(walk(closeButton).some((node) => node.props?.['data-test-close-icon-16'] === 'true'), 'close uses the official close icon')
  assert.ok(walk(tree).some((node) => node.props?.['data-dsh-official-fish-logo'] === 'true'), 'the dialog keeps the official whale')
  assert.doesNotMatch(source, /div:has\(>\.jx-modal--breath\)/u)
  assert.doesNotMatch(source, /\[class\*="_mask_"\]\{background:transparent/u)
})

test('Breath modal stays centered at ≤920px with a fixed header and scrolling body', async () => {
  const { source } = await renderBreathCurve()
  assert.match(source, /\.jx-modal--breath\{width:min\(920px,calc\(100vw - 96px\)\);max-height:min\(574px,calc\(100dvh - 146px\)\);/u)
  assert.doesNotMatch(source, /left:100px|calc\(100vw - 100px\)|height:100vh|border-radius:0/u)
  assert.match(source, /\.jx-breath-surface\{[^}]*display:flex;[^}]*flex-direction:column;[^}]*overflow:hidden;/u)
  assert.match(source, /\.jx-breath-native \.jx-header\{[^}]*flex:0 0 auto;/u, 'header stays fixed while the body scrolls')
  assert.match(source, /\.jx-breath-body\{[^}]*flex:1 1 auto;[^}]*overflow:auto;/u)
})

test('Breath folds keep only session details inside the dialog; quota and tools live in the sidebar', async () => {
  const result = await renderBreathCurve([38, 47, 23])
  assert.equal(result.tree.some((node) => node.props?.['aria-label'] === '额度'), false, 'the quota fold must be gone from the dialog')
  assert.equal(result.tree.some((node) => node.props?.['aria-label'] === '系统工具'), false, 'the tools fold must be gone from the dialog')
  assert.deepEqual(result.tree.filter((node) => node.props?.['data-jx-fold-action']), [], 'no fold-action shortcuts may remain in the dialog')
  assert.doesNotMatch(textContent(result.tree), /额度|重启|更新/u, 'the dialog must not duplicate sidebar quota/tools copy')
  assert.doesNotMatch(result.source, /\.jx-fold__tool\{/u, 'fold-tool CSS must be removed together with the tools fold')
  assert.equal(result.tree.some((node) => node.props?.['data-jx-quick-action']), false, 'the quick dock is gone')
})

test('V5.6 trajectory dedup keeps metrics in the dialog without a sidebar operation band', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    sessionSummary: {
      rounds: 8, steps: 73, avgTps: 74, cachePct: 0.9831, avgTtftMs: 5500,
      inputTokens: 7374683, outputTokens: 64125, llmDurationMs: 1246000, toolDurationMs: 1323000,
    },
    trajectory: {
      startMs: 1000, endMs: 3000, segments: [], inputTicks: [],
      sparkline: [{ tMs: 1000, rateTokS: 20 }, { tMs: 3000, rateTokS: 74 }],
      eventTicks: [],
    },
  })
  const modalText = textContent(result.tree)
  assert.doesNotMatch(modalText, /额度|重启|更新/u, 'the breath dialog must not carry quota/restart/update copy')
  assert.ok(result.tree.some((node) => node.props?.['data-metric'] === 'tokens'), 'KPI row stays (v2.1: Session Summary fold merged into KPI)')
  assert.ok(result.tree.some((node) => node.props?.['data-metric'] === 'tokens'), 'the KPI row carries session facts (v2.1)')
  // V1.0.1：快捷操作带已移除——侧栏只保留鲸息入口与状态区
  assert.equal(result.footerTree.some((node) => node.props?.['data-jx-quick-action']), false, 'V1.0.1: the wide sidebar no longer carries an operation band')
  assert.equal(
    result.footerTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath').length,
    1,
    'the sidebar keeps exactly one Breath entry',
  )
})

test('Sidebar and dialog expose the convergence ARIA contract', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 1,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 1000 }],
  })
  const statusRow = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-status')
  assert.equal(statusRow?.props.role, 'status')
  assert.equal(statusRow?.props['aria-live'], 'polite')
  assert.equal(statusRow?.props['aria-atomic'], 'true')
  const dot = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-status__dot')
  assert.equal(dot?.props['aria-hidden'], 'true')
  const stepsList = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-steps')
  assert.equal(stepsList?.props['aria-label'], '本轮鲸息步骤统计')
})

test('Expanded sidebar status dot animation stops under reduced motion', async () => {
  const { source } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    live: { openStep: 1 },
  })
  assert.match(source, /\.jx-fc-status__dot\[data-state="active"\]\{animation:jx-dot-breathe 1600ms ease-in-out infinite;\}/u)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)\{[^}]*\}\.jx-spouts\{transition:none;transform:none;\}\.jx-fc-status__dot\[data-state="active"\]\{animation:none;\}/u)
})

test('Convergence CSS keeps the DSH token-only rule (no hex, rgba or gradients)', async () => {
  const { source } = await renderBreathCurve()
  // V1.0.1：快捷操作/版本行 CSS 已移除，区间改为 breath-body → 560px 容器查询；
  // 该区间不含 --jx-trajectory-* 调色板（定义在 .jx-breath-native 上，区间之前）。
  const start = source.indexOf(".jx-breath-body{")
  const end = source.indexOf('@container jingxi-surface (max-width:560px)', start)
  const block = source.slice(start, end)
  assert.ok(start > 0, 'the convergence CSS block should anchor on the breath body row')
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/iu, 'new styles must not carry literal colors')
  assert.doesNotMatch(block, /(?:repeating-)?linear-gradient|radial-gradient/iu, 'new styles must not carry gradients')
  for (const token of [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-border-l2',
  ]) {
    assert.ok(block.includes(token), `convergence styles should consume ${token}`)
  }
})

test('Breath opens as a single modal: the sidebar entry opens it directly with no hand-off seams', async () => {
  const { source } = await renderBreathCurve()
  assert.match(source, /onClick: \(event\) => openBreath\(event\.currentTarget\)/u, 'the sidebar entry opens Breath directly')
  assert.doesNotMatch(source, /openBreathFromPanel|closeJingxiPanel|openUpdateFromBreath|openQuotaFromBreath/u, 'no panel/quota/update hand-off seams remain')
  assert.match(source, /useModalFocusGuard\(breathOpen, '\.jx-modal--breath'\)/)
  assert.match(source, /closeLabel: '关闭鲸息呼吸轨迹'/u)
})

test('Expanded sidebar uses the DSH settings optical axis instead of a wide provider slot', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /\.jx-fc\[data-sidebar-mode="wide"\] \.jx-fc-entry__icon\{[^}]*width:20px;[^}]*flex:0 0 20px;/u)
  assert.match(source, /\.jx-fc\[data-sidebar-mode="wide"\] \.jx-fc-entry__icon \.jx-runtime-mark\{[^}]*position:relative;[^}]*left:auto;[^}]*transform:none;/u)
  assert.doesNotMatch(source, /\.jx-fc-entry__icon[^{]*\{[^}]*left:26px;/u)
})

test('Expanded sidebar keeps one current-Turn sentence and omits idle or reset-time clutter', async () => {
  const result = await renderBreathCurve([37, 14, 89], undefined, undefined, 'interrupted', {
    turn: 17,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [
      { kind: 'tool', startMs: 0, endMs: 10 },
      { kind: 'model', startMs: 20, endMs: 30 },
    ],
  })
  const footerRoot = result.footerTree.find((node) => node.props?.className === 'jx-fc')
  const footerText = textContent(footerRoot)

  assert.equal((footerText.match(/最近 Turn #17/gu) ?? []).length, 1, 'the Turn sentence must not be duplicated by a scope row')
  assert.equal(walk(result.footerTree).some((node) => node.props?.className === 'jx-fc-status-scope'), false)
  const rateRow = walk(result.footerTree).find((node) => node.props?.className === 'jx-fc-entry__rate')
  assert.equal(rateRow, undefined, 'an interrupted turn hides the stale rate row (V5.9 review #1)')
  assert.doesNotMatch(footerText, /重置/u, 'reset timing belongs to quota detail, not the compact sidebar')
  assert.match(textContent(result.tree), /线程状态：已中断/u, 'the dialog names the interrupted thread status honestly')
})

test('Sidebar fails closed when only session-level trajectory counts are available', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 17,
    trajectory: {
      startMs: 0,
      endMs: 1000,
      segments: [
        { kind: 'tool', startMs: 0, endMs: 10 },
        { kind: 'model', startMs: 20, endMs: 30 },
      ],
      inputTicks: [{ tMs: 0, kind: 'input' }],
      sparkline: [{ tMs: 0, rateTokS: 10 }, { tMs: 1000, rateTokS: 20 }],
      eventTicks: [],
    },
  })
  const sidebarText = textContent(result.footerTree)

  assert.match(sidebarText, /最近 Turn #17/u, 'the current thread sentence remains visible')
  assert.match(sidebarText, /等待真实 Turn 数据/u)
  assert.doesNotMatch(sidebarText, /本会话累计/u)
})

test('Phone-width Breath uses the available modal width and keeps the three facts in one compact band', async () => {
  const { source } = await renderBreathCurve()

  assert.match(source, /@media \(max-width:520px\)\{\.jx-modal--breath\{width:calc\(100vw - 24px\);max-height:calc\(100dvh - 32px\);\}/u)
  assert.doesNotMatch(source, /@container jingxi-surface \(max-width:560px\)\{\.jx-breath-facts\{grid-template-columns:minmax\(0,1fr\);/u)
  assert.match(source, /@container jingxi-surface \(max-width:360px\)\{\.jx-breath-facts\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/u)
})

// ── V5.6 阶段 1+2：会话 P0（epoch/清旧/空态）+ tok/s 五档文案映射 ──
// 手动控制 resolve 顺序的延迟响应（harness breathResponses 消费）。
const makeGate = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const breathResponse = (payload) => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve(payload),
  text: () => Promise.resolve(JSON.stringify(payload)),
})
const rateFactOf = (tree) => tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'rate')
const sidebarRateRow = (tree) => walk(tree).find((node) => node.props?.className === 'jx-fc-entry__rate')
const refreshBreath = (tree) => {
  const button = tree.find((node) => node.props?.['data-jx-refresh'] === 'breath')
  assert.ok(button, 'the Breath surface exposes its refresh action')
  button.props.onClick()
}

test('Breath drops a late response after a newer load (epoch guard)', async () => {
  const stale = makeGate()
  const fresh = makeGate()
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    allowEmptyCurve: true,
    breathResponses: [() => Promise.resolve(breathResponse({ ok: true, source: 'real', view: { live: { rateQuality: 'exact', estimateRateTokS: 1 }, last: undefined, recent: [] } })), () => stale.promise, () => fresh.promise],
  })
  // 初始 load 挂起：UI 处于 loading 空态（无旧视图可显示）。
  let tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /等待速度数据/u, 'a pending load must stay in the waiting empty state')

  // 新 load（epoch 2）的响应先到并提交：exact → 「实时 33」。
  refreshBreath(tree)
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /等待速度数据/u, 'a second load clears the view until its response commits')
  fresh.resolve(breathResponse({ ok: true, source: 'real', view: { live: { rateQuality: 'exact', estimateRateTokS: 33 }, last: undefined, recent: [] } }))
  await new Promise((resolve) => setImmediate(resolve))
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /实时(?:速度)?\s*\d+/u, 'the newest response commits')

  // 旧 load 的响应后到：epoch 已变 → 丢弃，绝不覆盖新视图。
  stale.resolve(breathResponse({ ok: true, source: 'real', view: { live: { rateQuality: 'estimated', estimateRateTokS: 12 }, last: undefined, recent: [] } }))
  await new Promise((resolve) => setImmediate(resolve))
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /实时(?:速度)?\s*\d+/u, 'the late stale response must not overwrite the newer view')
  assert.doesNotMatch(textContent(rateFactOf(tree)), /估算(?:速度)?\s*12/u, 'the discarded response never reaches the UI')
})

test('Breath drops a response whose sessionId disagrees with the committed session', async () => {
  const first = makeGate()
  const second = makeGate()
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    allowEmptyCurve: true,
    breathResponses: [() => Promise.resolve(breathResponse({ ok: true, source: 'real', view: { live: { rateQuality: 'exact', estimateRateTokS: 1 }, last: undefined, recent: [] } })), () => first.promise, () => second.promise],
  })
  first.resolve(breathResponse({
    ok: true, source: 'real',
    view: { sessionId: 'sess-a', last: { status: 'completed', turn: 1, rateQuality: 'historical', avgTps: 20 }, live: null, recent: [] },
  }))
  await new Promise((resolve) => setImmediate(resolve))
  let tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /最近(?:速度)?\s*20/u, 'the first committed session shows its historical rate')

  // 刷新后新会话视图（sessionId 不同）：epoch 通过但会话自洽校验失败 → 丢弃。
  refreshBreath(tree)
  second.resolve(breathResponse({
    ok: true, source: 'real',
    view: { sessionId: 'sess-b', live: { rateQuality: 'exact', estimateRateTokS: 33 }, last: undefined, recent: [] },
  }))
  await new Promise((resolve) => setImmediate(resolve))
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /等待速度数据/u, 'a mismatched session must fail closed into the waiting state')
  assert.doesNotMatch(textContent(rateFactOf(tree)), /实时/u, 'the other session view never reaches the rate fact')
  assert.doesNotMatch(textContent(rateFactOf(tree)), /最近(?:速度)?\s*20/u, 'the previous session data is not re-presented as current')
  const latestFooter = walk(result.footerComponent({ wide: true }))
  assert.match(textContent(sidebarRateRow(latestFooter)), /等待速度数据/u, 'the sidebar stays in the waiting state as well')
  assert.doesNotMatch(textContent(sidebarRateRow(latestFooter)), /实时/u)
})

test('Breath empty projection never shows previous-session data as the current rate', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    empty: true,
    viewKind: 'idle',
    recentRows: [{
      turn: 9, status: 'completed', avgTps: 31, totalTokens: 900, cachePct: 0.5, durationMs: 500,
      sparkline: [{ tMs: 0, rateTokS: 10 }, { tMs: 100, rateTokS: 31 }],
    }],
  })
  const text = textContent(result.tree)
  assert.ok(result.tree.find((node) => node.props?.className === 'jx-curve-empty'), 'no data means the curve stays in its empty state')
  assert.match(textContent(rateFactOf(result.tree)), /等待速度数据/u, 'fail-closed: no data → no rate value at all')
  assert.doesNotMatch(textContent(rateFactOf(result.tree)), /31/u, 'the recent-active 31 tok/s must not leak into the current fact')
  assert.doesNotMatch(textContent(rateFactOf(result.tree)), /tok\/s/u, 'no data → no unit is fabricated')
  assert.doesNotMatch(text, /最近活跃/u, 'no global-recent copy may masquerade as the current projection')
})

test('Rate copy maps the five server tiers in the sidebar and the fact band', async () => {
  const cases = [
    { name: 'exact', options: { live: { rateQuality: 'exact', estimateRateTokS: 33 } }, footer: /实时(?:速度)?\s*\d+\s*tok\/s/u, fact: /实时(?:速度)?\s*\d+/u, state: 'live' },
    { name: 'estimated', options: { live: { rateQuality: 'estimated', estimateRateTokS: 12 } }, footer: /估算(?:速度)?\s*12\s*tok\/s/u, fact: /估算(?:速度)?\s*12/u, state: 'live' },
    { name: 'historical', options: { lastRateQuality: 'historical', lastAvgTps: 84 }, footer: /最近(?:速度)?\s*84\s*tok\/s/u, fact: /最近(?:速度)?\s*84/u, state: 'settled' },
    { name: 'session', options: { sessionSummary: { rateQuality: 'session', avgTps: 42, cachePct: 0.5 } }, footer: /平均(?:速度)?\s*42\s*tok\/s/u, fact: /平均(?:速度)?\s*42/u, state: 'settled' },
    { name: 'waiting', options: {}, footer: /等待速度数据/u, fact: /等待速度数据/u, state: 'waiting' },
  ]
  for (const c of cases) {
    const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', c.options)
    assert.match(textContent(sidebarRateRow(result.footerTree)), c.footer, `${c.name} sidebar copy`)
    assert.match(textContent(rateFactOf(result.tree)), c.fact, `${c.name} fact copy`)
    assert.equal(sidebarRateRow(result.footerTree).props['data-state'], c.state, `${c.name} row state`)
  }
})

test('Historical and session averages are never labelled realtime', async () => {
  for (const options of [
    { lastRateQuality: 'historical', lastAvgTps: 84 },
    { sessionSummary: { rateQuality: 'session', avgTps: 42, cachePct: 0.5 } },
  ]) {
    const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', options)
    const row = sidebarRateRow(result.footerTree)
    assert.doesNotMatch(textContent(row), /实时/u, 'historical averages must not claim realtime')
    assert.notEqual(row.props['data-state'], 'live', 'historical averages stay outside the live state')
    assert.doesNotMatch(textContent(rateFactOf(result.tree)), /实时/u, 'the fact band keeps the same honesty rule')
  }
})

test('Breath clears the previous view while a fresh load is pending and commits the newest response', async () => {
  const first = makeGate()
  const second = makeGate()
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    allowEmptyCurve: true,
    breathResponses: [() => Promise.resolve(breathResponse({ ok: true, source: 'real', view: { live: { rateQuality: 'exact', estimateRateTokS: 1 }, last: undefined, recent: [] } })), () => first.promise, () => second.promise],
  })
  const view = (rateQuality, estimateRateTokS) => ({
    ok: true, source: 'real',
    view: { live: { rateQuality, estimateRateTokS }, last: undefined, recent: [] },
  })
  first.resolve(breathResponse(view('exact', 28)))
  await new Promise((resolve) => setImmediate(resolve))
  let tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /实时(?:速度)?\s*\d+/u, 'the first committed view is live')

  // 刷新 → 新 load 未返回时：旧视图已清（loading 空态），绝不显示上一会话数据。
  refreshBreath(tree)
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /等待速度数据/u, 'a pending fresh load shows the waiting empty state')
  assert.doesNotMatch(textContent(rateFactOf(tree)), /28/u, 'the previous session data must not linger while loading')
  assert.ok(tree.find((node) => node.props?.className === 'jx-curve-empty'), 'the curve is not rendered from stale data')

  second.resolve(breathResponse(view('exact', 55)))
  await new Promise((resolve) => setImmediate(resolve))
  tree = walk(result.breathComponent({}))
  assert.match(textContent(rateFactOf(tree)), /实时(?:速度)?\s*\d+/u, 'the newest response replaces the waiting state')
  assert.doesNotMatch(textContent(rateFactOf(tree)), /28/u, 'the old view is gone for good')
})

test('Stale snapshot rate keeps the data-older suffix and never claims realtime', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    source: 'persisted',
    stale: true,
    lastRateQuality: 'historical',
    lastAvgTps: 84,
  })
  const row = sidebarRateRow(result.footerTree)
  assert.match(textContent(row), /最近(?:速度)?\s*84\s*tok\/s\s*·\s*数据较旧/u, 'stale keeps the data-older suffix')
  assert.equal(row.props['data-stale'], 'true', 'the stale flag remains disclosed')
  assert.doesNotMatch(textContent(row), /实时/u, 'a stale historical average is never realtime')
  assert.match(textContent(rateFactOf(result.tree)), /已保存快照/u, 'the fact band keeps the snapshot freshness meta')
})

// ── V5.6 波次 3：侧栏操作区（luna §三决策4）+ Harness 版本行 ──
test('Settings version surface renders the real runtime version and never impersonates latest or up-to-date', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, {
    ok: true,
    currentVersion: '5.6.0',
    latestVersion: '5.6.1',
    updateAvailable: true,
    state: 'available',
    mutationAllowed: true,
    compatibility: { state: 'verified' },
  })
  // V1.0.1：侧栏不再有版本行——版本事实只在 Settings 版本区呈现
  assert.equal(
    result.footerTree.some((node) => node.props?.['data-jx-harness-version'] === 'true' || node.props?.className === 'jx-fc-version'),
    false,
    'V1.0.1: no version row in the sidebar footer',
  )
  walk(result.settingsComponent({}))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const settingsText = textContent(walk(result.settingsComponent({})))
  assert.ok(settingsText.includes('5.6.0'), 'the real runtime currentVersion renders in Settings')
  assert.equal(settingsText.includes('5.6.1'), false, 'latestVersion must not impersonate the running version')
  assert.doesNotMatch(settingsText, /已是最新/u, 'the version line never claims up-to-date')
  assert.ok(settingsText.includes('有更新'), 'Doctor surfaces the available update read-only')
})

test('Sidebar entry opens the Breath surface directly with the shared openBreath service', async () => {
  const result = await renderBreathCurve([45, 50, 25])
  const wideEntries = result.footerTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath')
  assert.equal(wideEntries.length, 1, 'the wide sidebar owns exactly one Breath entry')
  assert.equal(
    result.railFooterTree.filter((node) => node.props?.['data-jx-surface-trigger'] === 'breath').length,
    1,
    'the rail sidebar owns exactly one Breath entry',
  )
  assert.equal(
    result.footerTree.some((node) => node.props?.['data-jx-quick-action']),
    false,
    'V1.0.1: the quick actions band is removed — the entry itself opens Breath',
  )

  // harness 已处于打开态（入口点击直达）：呼吸浮层即为唯一 dialog
  const dialog = walk(result.breathComponent({})).find((node) => node.props?.role === 'dialog')
  assert.ok(dialog, 'the Breath surface opens directly from the sidebar entry')
  assert.match(dialog.props?.['aria-label'] ?? '', /鲸息/u, 'the opened surface is the Jingxi Breath dialog')

  const capsule = result.source.slice(result.source.indexOf('const FooterStatusCapsule'), result.source.indexOf('// ── Settings / System secondary'))
  assert.match(capsule, /onClick: \(event\) => openBreath\(event\.currentTarget\)/, 'the sidebar entry calls the shared openBreath')
  assert.doesNotMatch(capsule, /closeJingxiPanel|openJingxiPanel/u, 'no intermediate panel remains in the entry flow')
})

test('V5.6 P0 provenance: tool events are marked as inferred, never as agents or models', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 2,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [
      { kind: 'tool', startMs: 100, endMs: 300 },
      { kind: 'tool', startMs: 400, endMs: 600 },
      { kind: 'model', startMs: 700, endMs: 900 },
    ],
    eventTicks: [{ tMs: 100, kind: 'tool' }],
  })
  const rail = walk(result.tree).find((node) => node.props?.className === 'jx-event-rail')
  assert.ok(rail, 'EventRail should render')
  const railText = textContent(walk(rail))
  assert.match(railText, /工具事件/u, 'tool events should be surfaced with provenance')
  assert.match(railText, /由调用推断/u, 'provenance must stay honest: inferred from tool calls')
  // 注记含「非子代理」是否定式（诚实降级）；冒充式字样才禁止
  assert.doesNotMatch(railText, /Luna/u, 'no impersonation of Luna in P0')
  assert.doesNotMatch(railText, /模型未上报/u, 'no fake model reporting before P1')
  assert.doesNotMatch(result.source, /scoreLuna/u, 'client must not fake Luna scoring before P1 events')
})

test('V5.6 S2: subagent dock shows empty state without real agent events and never infers from tools', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 2,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'tool', startMs: 100, endMs: 300 }],
    eventTicks: [{ tMs: 100, kind: 'tool' }],
  })
  const dock = walk(result.tree).find((node) => node.props?.['aria-label'] === '子代理调用')
  assert.ok(dock, 'subagent dock should render')
  const dockText = textContent(walk(dock))
  assert.match(dockText, /暂无子代理调用/u, 'empty state without agent events')
  assert.doesNotMatch(dockText, /Luna|模型未上报/u, 'no model impersonation')
  assert.equal(walk(dock).filter((node) => node.props?.['data-status']).length, 0, 'no fabricated agent cards')
  // populated state via last.subagents (P1 contract reserve)
  const populated = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 3,
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 100 }],
    lastSubagents: [{ id: 'ab12cd34', name: '核验', status: 'ok' }],
  })
  const populatedDock = walk(populated.tree).find((node) => node.props?.['aria-label'] === '子代理调用')
  assert.match(textContent(walk(populatedDock)), /子代理 1 个/u, 'populated state renders real agent entries')
})

test('V5.8 P2.3: subagent dock maps the five statuses to Chinese copy and colors', async () => {
  const statuses = [
    { status: 'queued', label: '等待', css: 'queued' },
    { status: 'running', label: '运行中', css: 'running' },
    { status: 'completed', label: '完成', css: 'completed' },
    { status: 'failed', label: '失败', css: 'failed' },
    { status: 'cancelled', label: '已取消', css: 'cancelled' },
  ]
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 4,
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 100 }],
    lastSubagents: statuses.map((entry, index) => ({
      id: `agent-${index}`,
      label: `核验${index + 1}`,
      status: entry.status,
      durationMs: 125000,
      model: 'deepseek/deepseek-v4-flash',
      reasoningEffort: 'high',
      toolCalls: 3,
      rate: { value: 42, quality: 'estimated' },
    })),
  })
  const dock = walk(result.tree).find((node) => node.props?.['aria-label'] === '子代理调用')
  assert.ok(dock, 'subagent dock should render the populated state')
  const items = walk(dock).filter((node) => node.props?.['data-depth'] === '1')
  assert.equal(items.length, 5, 'each status should render one top-level card')

  for (let index = 0; index < statuses.length; index += 1) {
    const expected = statuses[index]
    const item = items.find((node) => node.props?.['data-status'] === expected.css)
    assert.ok(item, `status ${expected.status} should map to data-status="${expected.css}"`)
    const statusCell = walk(item).find((node) => node.props?.className === 'jx-subagent-dock__status')
    assert.equal(textContent(statusCell), expected.label, `status ${expected.status} should render 中文 ${expected.label}`)
  }

  const firstCard = walk(items[0])
  const meta = firstCard.find((node) => node.props?.className === 'jx-subagent-dock__meta')
  assert.match(textContent(meta), /时长 2m 05s/u, 'durationMs formats as 分:秒')
  assert.match(textContent(meta), /模型 deepseek\/deepseek-v4-flash/u, 'the real model is disclosed')
  assert.match(textContent(meta), /推理 high/u, 'reasoningEffort is disclosed')
  assert.match(textContent(meta), /工具 3 次/u, 'tool call count is disclosed')
  assert.match(textContent(meta), /速率 42 tok\/s · estimated/u, 'rate quality is disclosed')
  assert.doesNotMatch(textContent(meta), /未上报/u, 'a fully reported agent must not fall back to 未上报')
})

test('V5.8 P2.3: subagent dock renders two levels and merges deeper nodes into 另有 N 个下级调用', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 5,
    lastSegments: [{ kind: 'model', startMs: 0, endMs: 100 }],
    // depth-3 树：root → a → b → c（b 有子 c；c 无子）
    lastSubagents: [
      { id: 'root', label: '主编排', status: 'completed', durationMs: 1000 },
      { id: 'a', parentId: 'root', label: '审计', status: 'running', durationMs: 500 },
      { id: 'b', parentId: 'a', label: '核验', status: 'failed', durationMs: 200 },
      { id: 'c', parentId: 'b', label: '复核', status: 'cancelled', durationMs: 100 },
    ],
  })
  const dock = walk(result.tree).find((node) => node.props?.['aria-label'] === '子代理调用')
  assert.ok(dock, 'subagent dock should render')
  const items = walk(dock).filter((node) => node.props?.['data-depth'])
  assert.equal(items.filter((node) => node.props?.['data-depth'] === '1').length, 1, 'one top-level card')
  assert.equal(items.filter((node) => node.props?.['data-depth'] === '2').length, 1, 'one second-level card')
  assert.equal(items.filter((node) => node.props?.['data-depth'] === '3').length, 1, 'deeper nodes collapse to one merged row')
  const merged = items.find((node) => node.props?.['data-depth'] === '3')
  assert.equal(merged.props['data-merged'], '2', 'N = number of nodes deeper than level 2')
  assert.match(textContent(merged), /另有 2 个下级调用/u)
  const topCard = items.find((node) => node.props?.['data-depth'] === '1')
  assert.match(textContent(topCard), /主编排/u)
  assert.match(textContent(topCard), /完成/u)
  const secondCard = items.find((node) => node.props?.['data-depth'] === '2')
  assert.match(textContent(secondCard), /审计/u)
  assert.match(textContent(secondCard), /运行中/u)
  const dockText = textContent(dock)
  assert.match(dockText, /子代理 4 个/u)
  assert.doesNotMatch(dockText, /核验/u, 'depth-3 node b must not render as its own card')
  assert.doesNotMatch(dockText, /复核/u, 'depth-4 node c must not render as its own card')
})

test('V5.8 P2.3: empty dock stays honest and never infers agents from tool events', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    turn: 6,
    lastInputTicks: [{ tMs: 0, kind: 'input' }],
    lastSegments: [{ kind: 'tool', startMs: 100, endMs: 300 }, { kind: 'model', startMs: 300, endMs: 500 }],
    eventTicks: [{ tMs: 100, kind: 'tool' }],
  })
  const dock = walk(result.tree).find((node) => node.props?.['aria-label'] === '子代理调用')
  assert.ok(dock, 'subagent dock should render')
  assert.match(textContent(dock), /暂无子代理调用/u, 'no real agent events keeps the empty state')
  assert.equal(walk(dock).filter((node) => node.props?.['data-depth']).length, 0, 'tool events must not fabricate agent cards')
  assert.equal(walk(dock).filter((node) => node.props?.['data-status']).length, 0, 'no fabricated status cells')
  assert.doesNotMatch(textContent(dock), /Luna|模型未上报/u, 'no model impersonation in the empty state')
})

test('V5.8 P2.2: empty curve uses the official no-event copy when the session has nothing to plot', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', { empty: true })
  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  const empty = walk(curve).find((node) => node.props?.className === 'jx-curve-empty')

  assert.ok(empty, 'an empty runtime keeps the curve empty state visible')
  assert.equal(curve?.props?.['data-curve-event-empty'], 'true', 'the empty curve should disclose that no event is drawable')
  assert.match(textContent(empty), /当前会话暂无可绘制事件/u, 'V5.8 official empty copy')
  assert.equal(empty?.props?.['data-state'], 'waiting', 'an empty runtime stays a waiting state, not an insufficient-sample state')
  assert.doesNotMatch(textContent(empty), /速度采样不足/u, 'the no-event copy must not be replaced by the sample-insufficient copy')
})

test('V5.8 P2.2: curve event ticks trace real timestamps across the session domain', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    trajectory: {
      startMs: 1000,
      endMs: 3000,
      segments: [{ kind: 'model', startMs: 1000, endMs: 3000 }],
      inputTicks: [{ tMs: 1100, kind: 'input' }],
      sparkline: [
        { tMs: 1000, rateTokS: 20 },
        { tMs: 2000, rateTokS: 74 },
        { tMs: 3000, rateTokS: 45 },
      ],
      eventTicks: [
        { tMs: 1500, kind: 'tool' },
        { tMs: 2000, kind: 'retry' },
        { tMs: 2500, kind: 'compaction' },
      ],
    },
  })
  const curve = result.tree.find((node) => node.props?.className === 'jx-curve')
  const ticks = walk(curve).filter((node) => node.props?.className === 'jx-curve-event-tick')

  assert.equal(curve.props['data-plot-time-mode'], 'wall-clock', 'a continuous session keeps the wall-clock timeline')
  assert.equal(ticks.length, 3, 'each real event tick becomes one curve overlay marker')
  assert.deepEqual(
    ticks.map((node) => node.props.style.left),
    ['25%', '50%', '75%'],
    'tool/retry/compaction ticks must trace their real tMs across the session span',
  )
  assert.deepEqual(
    ticks.map((node) => node.props['data-event-kind']),
    ['tool', 'retry', 'compaction'],
  )
  assert.ok(
    ticks.every((node) => walk(node).some((child) => child.props?.className === 'jx-curve-event-tick__dot')),
    'every real timestamp keeps a dot on the curve',
  )
})

test('V5.8 P2.2: dense real tool events cluster into time buckets without overlap', async () => {
  const eventTicks = Array.from({ length: 48 }, (_, index) => ({
    tMs: 2000 + index * 20,
    kind: 'tool',
  }))
  const { tree } = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    trajectory: {
      startMs: 1000,
      endMs: 3000,
      segments: [{ kind: 'model', startMs: 1000, endMs: 3000 }],
      inputTicks: [],
      sparkline: [
        { tMs: 1000, rateTokS: 20 },
        { tMs: 3000, rateTokS: 74 },
      ],
      eventTicks,
    },
  })
  const ticks = tree.filter((node) => node.props?.className === 'jx-curve-event-tick')

  assert.ok(ticks.length <= 24, 'dense tool events must be aggregated into the bucket ceiling')
  const positions = ticks.map((node) => Number.parseFloat(String(node.props?.style?.left ?? '')))
  assert.equal(new Set(positions).size, positions.length, 'first-screen bucket positions must not overlap')
  assert.ok(
    ticks.some((node) => Number(node.props?.['data-event-count']) > 1),
    'an aggregated bucket discloses its real event count',
  )
})
test('V5.8 P3.2: visibilitychange pauses the 5s breath poll while hidden and resumes when visible', async () => {
  const result = await renderBreathCurve([45, 50, 25], undefined, undefined, 'completed', {
    live: { openStep: 1 },
  })
  const startIntervals = result.intervalCount()
  const startClears = result.clearCount()

  // 页面隐藏：visibilitychange 监听器应清理轮询 timer（clearInterval 增），
  // 且不新增 setInterval。
  result.setDocumentHidden(true)
  for (const listener of result.documentListeners.get('visibilitychange') ?? []) listener()
  const hiddenIntervals = result.intervalCount()
  const hiddenClears = result.clearCount()
  assert.ok(hiddenClears > startClears, 'hiding the page should clear the live poll timer')
  assert.equal(hiddenIntervals, startIntervals, 'hiding the page must not schedule a new poll')

  // 恢复可见：重启轮询（新 setInterval），不清理（clear 数不变）。
  result.setDocumentHidden(false)
  for (const listener of result.documentListeners.get('visibilitychange') ?? []) listener()
  assert.ok(result.intervalCount() > hiddenIntervals, 'restoring visibility should restart the live poll')
  assert.equal(result.clearCount(), hiddenClears, 'restoring visibility must not clear the fresh timer')

  // 生产代码：轮询仅在 live 会话开启，且清理函数覆盖 visibilitychange 监听。
  const surface = result.source.slice(
    result.source.indexOf('const BreathSurface'),
    result.source.indexOf('const BreathOverlay'),
  )
  assert.match(surface, /document\.addEventListener\?\.\('visibilitychange', onVisibility\)/u)
  assert.match(surface, /document\.removeEventListener\?\.\('visibilitychange', onVisibility\)/u)
  assert.match(surface, /if \(hidden\(\) && timerId !== null\) \{[^}]*window\.clearInterval\(timerId\)/u)
})

test('V5.8 P3.3: key interactive controls expose Chinese aria-labels', async () => {
  const result = await renderBreathCurve()
  const all = [...result.tree, ...result.footerTree, ...result.railFooterTree]

  const buttons = all.filter((node) => node.type === 'button')
  assert.ok(buttons.length > 0, 'the surfaces expose interactive controls')

  const labelled = buttons.filter((node) => typeof node.props?.['aria-label'] === 'string' && node.props['aria-label'].length > 0)
  assert.ok(labelled.length >= buttons.length - 2, 'nearly every icon-only or dense control carries an aria-label')

  const labelledNames = labelled.map((node) => node.props['aria-label'])
  for (const expected of ['关闭鲸息呼吸轨迹', '刷新呼吸节奏']) {
    assert.ok(
      labelledNames.some((name) => name.includes(expected)),
      'the surfaces should label the control "' + expected + '"',
    )
  }

  // V1.0.1：备用直达入口迁至 Settings——设置区提供「打开鲸息呼吸轨迹」与 Doctor「重新检查」
  const settingsLabels = walk(result.settingsComponent({})).map((node) => node.props?.['aria-label']).filter(Boolean)
  assert.ok(settingsLabels.some((name) => name.includes('打开鲸息呼吸轨迹')), 'the Settings surface should label the direct Breath entry')
  assert.ok(settingsLabels.some((name) => name.includes('重新检查')), 'the Settings Doctor should label the diagnostics re-check')

  // 错误空态的重试按钮：源码必须同时存在中文 aria-label 与 onRefresh 接线。
  assert.match(result.source, /'aria-label': '重试刷新呼吸节奏'/u, 'the retry control should carry its Chinese aria-label in production code')
  const emptyStateCall = result.source.slice(
    result.source.indexOf('const BreathEmptyState'),
    result.source.indexOf('const BreathSurface'),
  )
  assert.match(emptyStateCall, /error && onRefresh \? h\(Button/u, 'the empty state should render the retry only with an error and a refresh handler')
  assert.match(result.source, /h\(BreathEmptyState, \{[\s\S]*?onRefresh: \(\) => breathService\.load\(\{ force: true \}\)/u, 'BreathSurface should wire the empty-state refresh to the shared service')
})

test('V5.8 P3.3: Breath overlay owns Escape close and restores focus to the invoker', async () => {
  const result = await renderBreathCurve()

  // Breath：注册 Esc 守卫（P3.2 前缺失，现在与 Panel/Update 对齐）。
  const breathOverlay = result.source.slice(
    result.source.indexOf('const BreathOverlay'),
    result.source.indexOf('const updateStatusText'),
  )
  assert.match(breathOverlay, /useModalEscapeGuard\(breathOpen, closeBreath\)/u, 'Breath overlay should own Escape close')

  // Esc 事件会经 useModalEscapeGuard 的 document keydown 监听触发 close*；
  // 关闭函数内 restoreFocusTarget(breathFocusReturn) 回返触发入口。
  assert.match(result.source, /const closeBreath = \(\) => \{[\s\S]*?restoreFocusTarget\(breathFocusReturn\)/u)
  assert.ok(
    (result.documentListeners.get('keydown') ?? []).length >= 2,
    'Open surfaces should register document keydown guards (focus + escape)',
  )
})

// ── V5.8 P2.1：头部同层（title→rate→cache→auto-refresh→refresh→close）+ 删 GREAT 等状态词 ──
const headerDirectChildren = (tree) => {
  const header = tree.find((node) => node.props?.className === 'jx-header')
  assert.ok(header, 'Breath should expose its header')
  return [...header.children]
}

test('V5.8 P2.1: Breath header keeps title, rate, cache, auto-refresh, refresh and close in one same-layer row', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    live: { openStep: 1, rateQuality: 'exact', estimateRateTokS: 33 },
    sessionSummary: { avgTps: 74, cachePct: 0.9749, inputTokens: 1000, outputTokens: 200 },
  })
  const direct = headerDirectChildren(result.tree)
  const lockup = direct.find((node) => typeof node.props?.className === 'string' && node.props.className.includes('jx-title-lockup'))
  const facts = direct.find((node) => node.props?.className === 'jx-header-facts')
  const actions = direct.find((node) => node.props?.className === 'jx-dialog-actions')
  assert.ok(lockup && facts && actions, 'title, rate/cache facts and action cluster are direct header children')
  assert.ok(direct.indexOf(facts) > direct.indexOf(lockup), 'rate/cache facts follow the title')
  assert.ok(direct.indexOf(actions) > direct.indexOf(facts), 'the action cluster follows the facts')

  const chips = walk(facts).filter((node) => node.props?.['data-header-fact'])
  assert.deepEqual(chips.map((node) => node.props['data-header-fact']), ['rate', 'cache'], 'rate then cache inside the header facts')
  assert.match(textContent(chips[0]), /实时速度.*33\s*tok\/s|33\s*tok\/s.*实时速度/u, 'the header rate chip carries the live speed value')
  assert.match(textContent(chips[1]), /Cache 命中率.*97\.49%/u, 'the header cache chip carries the cache value')

  const actionButtons = walk(actions).filter((node) => node.type === 'button')
  const autoRefresh = actionButtons.find((node) => node.props?.['data-jx-auto-refresh'] === 'true')
  const refresh = actionButtons.find((node) => node.props?.['data-jx-refresh'] === 'breath')
  const close = actionButtons.find((node) => node.props?.['data-jx-close'] === 'true')
  assert.ok(autoRefresh && refresh && close, 'auto-refresh, manual refresh and close all live in the header')
  assert.ok(
    actionButtons.indexOf(autoRefresh) < actionButtons.indexOf(refresh)
    && actionButtons.indexOf(refresh) < actionButtons.indexOf(close),
    'order: auto-refresh → manual refresh → close',
  )
  assert.ok(walk(autoRefresh).some((node) => node.props?.['data-test-pause-icon-16'] === 'true'), 'an enabled auto-refresh toggle shows the pause glyph')
})

test('V5.8 P2.1: auto-refresh toggle pauses the live poll and re-arms it on continue', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    live: { openStep: 1, rateQuality: 'exact', estimateRateTokS: 33 },
  })
  const header = result.tree.find((node) => node.props?.className === 'jx-header')
  const toggle = walk(header).find((node) => node.props?.['data-jx-auto-refresh'] === 'true')
  assert.ok(toggle, 'a live session exposes the auto-refresh toggle')
  assert.equal(toggle.props['data-state'], 'on', 'auto-refresh starts enabled for a live session')
  assert.equal(toggle.props.disabled, false, 'a live session keeps the toggle usable')
  assert.match(toggle.props['aria-label'] ?? '', /暂停/u, 'the on-state labels the pause action')

  toggle.props.onClick()
  const paused = walk(result.breathComponent({})).find((node) => node.props?.['data-jx-auto-refresh'] === 'true')
  assert.equal(paused.props['data-state'], 'off', 'clicking pauses auto-refresh')
  assert.match(paused.props['aria-label'] ?? '', /继续/u, 'the off-state labels the continue action')

  // 轮询门控：暂停后 liveRefreshEnabled 为 false → 5s 轮询 effect 不再调度 interval。
  const surface = result.source.slice(
    result.source.indexOf('const BreathSurface'),
    result.source.indexOf('const BreathOverlay'),
  )
  assert.match(surface, /Boolean\(live\)\s*&&\s*autoRefreshOn/u, 'the 5s poll is gated on the auto-refresh flag')

  // 继续：恢复轮询并立即补一帧 force load（load 先清旧视图进入 loading，
  // fetch 落定后 live 视图回来，开关回到 on）。
  paused.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const resumed = walk(result.breathComponent({})).find((node) => node.props?.['data-jx-auto-refresh'] === 'true')
  assert.equal(resumed.props['data-state'], 'on', 'clicking continue re-arms auto-refresh')
  assert.ok(result.requests.some((entry) => entry.url === '/api/jingxi/breath/current'), 'resume issues a fresh breath load')

  // 非 live 会话：开关禁用并保持 off。
  const settled = await renderBreathCurve()
  const settledToggle = walk(settled.tree).find((node) => node.props?.['data-jx-auto-refresh'] === 'true')
  assert.ok(settledToggle, 'a settled session still exposes the auto-refresh control')
  assert.equal(settledToggle.props.disabled, true, 'settled sessions disable the auto-refresh toggle')
  assert.equal(settledToggle.props['data-state'], 'off', 'settled sessions show auto-refresh off')
})

test('V5.8 P2.1: GREAT/PERFECT/GOOD status words are removed from user-visible copy and source', async () => {
  const result = await renderBreathCurve([45, 52, 29], undefined, undefined, 'completed', {
    sessionSummary: { rounds: 8, steps: 73, avgTps: 74, cachePct: 0.99, inputTokens: 1000, outputTokens: 200 },
    trajectory: {
      startMs: 1000,
      endMs: 2000,
      segments: [],
      inputTicks: [],
      sparkline: [{ tMs: 1000, rateTokS: 20 }, { tMs: 2000, rateTokS: 74 }],
      eventTicks: [],
    },
  })
  assert.doesNotMatch(textContent(result.tree), /(?:GOOD|GREAT|PERFECT)/u, 'no English cache status word reaches the rendered UI')
  assert.doesNotMatch(result.source, /(?:GOOD|GREAT|PERFECT)/u, 'client source drops the English status tiers entirely')
  const cacheKpi = result.tree.find((node) => node.props?.className === 'jx-header-fact' && node.props?.['data-header-fact'] === 'cache')
  assert.ok(cacheKpi, 'the cache fact stays visible')
  assert.equal(cacheKpi.props['data-quality'], 'high', 'a 99% cache keeps its internal colour tier')
  const meta = walk(cacheKpi).find((node) => node.props?.className === 'jx-fact__meta')
  assert.match(textContent(meta), /缓存命中/u, 'the meta line uses pure Chinese data copy')
  assert.doesNotMatch(textContent(result.tree), /Avg Speed/u, 'no English status suffix remains')
  const headerFacts = result.tree.find((node) => node.props?.className === 'jx-header-facts')
  assert.ok(headerFacts, 'the same-layer header keeps the rate/cache facts')
})
