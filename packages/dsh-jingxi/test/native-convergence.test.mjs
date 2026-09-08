import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../lib/client.js', import.meta.url)

test('Breath is a focused Jingxi workbench while the host shell remains native', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface')
  const breathEnd = source.indexOf('const BreathOverlay', breathStart)
  assert.ok(breathStart > 0, 'BreathSurface must have a stable source boundary')
  assert.ok(breathEnd > breathStart, 'BreathOverlay must follow BreathSurface')
  const surface = source.slice(breathStart, breathEnd)

  for (const className of [
    'jx-curve',
    'jx-recent',
    'jx-breath-facts',
    'jx-breath-folds',
  ]) {
    assert.match(surface, new RegExp(className), `${className} must remain in the Jingxi workbench`)
  }
  assert.match(surface, /h\(EventRail/u, 'Breath must render the shared Event Rail component')

  for (const surfaceClass of [
    'jx-breath-native',
    'jx-trajectory-strip',
    'jx-trajectory-strip__meta',
    'jx-breath-reading',
    'jx-session-readout',
  ]) {
    assert.match(source, new RegExp(surfaceClass), `${surfaceClass} must remain in the focused Breath surface`)
  }
  assert.match(surface, /h\(BreathFactItem/u, 'Breath must render the three aligned core facts')
  assert.doesNotMatch(surface, /h\(BreathToolsFold/u, 'V5.6: dialog tools fold removed — restart/update live in the sidebar quick actions')
  assert.doesNotMatch(surface, /h\(DashboardQuotaCard|h\(SessionSummaryCard|h\(BreathQuickActions/u, 'the aside rail cards must be removed from Breath')
  assert.match(surface, /h\(PhaseStory/u, 'Breath must render the phase story')
  assert.match(surface, /h\(CurveLegend/u, 'v2.1: the curve legend is the single trajectory legend')
  assert.match(surface, /className: 'jx-curve'/u, 'v2.1: the curve card is the single timeline view')

  assert.match(surface, /label: 'Cache 命中率'/u)
  assert.match(surface, /缓存命中/u)
  assert.match(surface, /Breath Curve/u)
  assert.match(surface, /jx-phase-narrative/u)
  assert.match(source, /const deriveSegmentCounts/u, 'recent-turn counts come from one pure function')
  assert.match(source, /const JingxiWideStatus/u, 'the expanded sidebar renders the status/steps block')
  assert.doesNotMatch(source, /const BreathToolsFold/u, 'V5.6: BreathToolsFold removed — restart/update live in the sidebar quick actions')
  assert.match(source, /const PhaseStory/u)
  assert.doesNotMatch(source, /const SessionSummaryCard|const DashboardQuotaCard|const QuotaRing/u, 'aside card components must be fully removed')
  assert.doesNotMatch(source, /jx-dashboard-card jx-trajectory-strip/u, 'trajectory must not use an obsolete duplicate card shell')
  assert.match(source, /jx-curve-event-ticks/u)
  assert.doesNotMatch(surface, /jx-curve-stages/u)
  assert.match(surface, /最近 5/u)
  assert.doesNotMatch(source, /\.jx-dashboard__grid\{/u, 'obsolete dashboard layout CSS must be removed')
  assert.match(source, /data-jx-workbench': 'reference'/u, 'Breath should opt into the reference workbench framing')
  assert.match(source, /\.jx-modal--breath\{width:min\(920px,calc\(100vw - 96px\)\);max-height:min\(574px,calc\(100dvh - 146px\)\);/u, 'Breath converges to a centered ≤920px dialog')
  assert.doesNotMatch(source, /left:100px|calc\(100vw - 100px\)|height:100vh|border-radius:0/u, 'the 1100px+ full-screen workbench geometry must be removed')
  assert.doesNotMatch(source, /\.jx-fc-heading\b/u, 'wide sidebar must not render a redundant Jingxi heading row')
  assert.match(source, /\.jx-fc-divider\{/u, 'wide sidebar must keep a divider seam between Workspace and Jingxi')
  assert.doesNotMatch(source, /\.jx-fc-actions\{/u)
})

test('Breath header keeps the reference description while preserving live thread status', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface')
  const breathEnd = source.indexOf('const BreathOverlay', breathStart)
  const surface = source.slice(breathStart, breathEnd)

  assert.match(source, /className: 'jx-breath-subtitle__status'/u)
  // v2.1：营销副标题已删（单页化）——不再断言 description 文案与 CSS。
  assert.match(surface, /headerStatus/u)
  assert.match(surface, /headerFreshness/u)
})

test('Breath is the only client surface; update checks stay read-only in Settings', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface')
  const breathEnd = source.indexOf('const BreathOverlay', breathStart)
  const surface = source.slice(breathStart, breathEnd)

  assert.doesNotMatch(surface, /data-jx-surface-trigger.*(?:quota|update)/u)
  assert.match(source, /data-jx-surface-trigger': 'breath'/u)
  // V1.0.1：更新/重启不再是客户端浮层——更新检查只经 Settings Doctor 只读触发
  assert.doesNotMatch(source, /data-jx-surface-trigger': 'update'/u)
  assert.doesNotMatch(source, /data-jx-surface-trigger': 'jingxi-panel'/u)
  const settings = source.slice(source.indexOf('const Settings ='))
  assert.match(settings, /checkDshUpdate\(\)\.catch\(\(\) => \{\}\)/u, 'Settings diagnostics must trigger the read-only update check')
  assert.doesNotMatch(settings, /runDshUpdate|lifecycle\(/u, 'Settings stays read-only — no update/restart mutations')
  assert.doesNotMatch(source, /(?:\.jx-fc-refresh|className:\s*'jx-fc-refresh')/u, 'Sidebar must not add a second refresh control')
})

test('Footer entry uses the DSH primitive icon seam and the host row rhythm', async () => {
  const source = await readFile(clientPath, 'utf8')

  // V1.0.1：快捷操作行与版本行已移除——侧栏只剩鲸息入口；官方图标原语
  // 仍服务于呼吸浮层刷新（IconRefreshOutline14）与事实行图标。
  assert.match(source, /IconRefreshOutline14/u, 'Breath refresh should use the official DSH refresh primitive')
  assert.match(source, /IconLoadingOutline16/u, 'Busy states should use the official DSH loading primitive')
  assert.doesNotMatch(source, /IconSendOutline14/u, 'quick-action update icon removed with the quick actions row')
  assert.doesNotMatch(source, /const DshActionIcon|const DshActionGlyph/u, 'Footer must not keep a plugin-owned hand-drawn action icon')

  assert.doesNotMatch(source, /\.jx-panel-tool\{/u, 'panel tool styles removed with the Jingxi panel')
  assert.doesNotMatch(source, /data-jx-panel-action/u, 'panel actions removed with the Jingxi panel')
  assert.doesNotMatch(source, /\.jx-fc-quick-action/u, 'quick actions row removed from the sidebar footer')
  assert.doesNotMatch(source, /\.jx-fc-version\{/u, 'version row removed from the sidebar footer')
  assert.doesNotMatch(source, /\.jx-action-icon\{/u, 'action icon wrapper removed with DshActionGlyph')
  assert.doesNotMatch(source, /\.jx-fc-provider\{/u, 'Provider rows should not be owned by the Sidebar Footer')
  assert.doesNotMatch(source, /\.jx-fc-action\{/u, 'Lifecycle rows should not be owned by the Sidebar Footer')
  assert.doesNotMatch(source, /\.jx-fc-heading\b/u, 'wide sidebar should not render a redundant Jingxi heading')
})

test('Sidebar icon slots keep the entry and settings marks optically aligned', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /h\(JingxiRuntimeMark, \{ action: 'jingxi', state: entryState, size: 20, decorative: true \}\)/u)
  assert.match(source, /IconSettingsOutline16/u)
  assert.match(source, /h\('span', \{ className: 'jx-settings-row__icon'/u)
  assert.match(source, /\.jx-settings-row\{[^}]*min-height:48px;/u)
  assert.match(source, /\.jx-settings-row__icon\{[^}]*width:28px;height:28px;[^}]*flex:0 0 28px;/u)
  assert.doesNotMatch(source, /DshActionGlyph/u, 'lifecycle glyph wrapper removed with the panel')
  assert.doesNotMatch(source, /\.jx-panel-tool__icon/u, 'panel tool icon slots removed with the panel')
})

test('Sidebar utility marks converge on the reference icon language', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.doesNotMatch(source, /IconChevronDownOutline14/u, 'redundant section chevron should not be rendered')
  assert.doesNotMatch(source, /jx-panel-tool__icon--update/u, 'Update should use the host icon without a plugin shell')
  assert.match(source, /IconSettingsOutline16/u, 'Settings should use the official vector primitive')
})

test('Sidebar exposes one Jingxi entry that opens the Breath surface directly', async () => {
  const source = await readFile(clientPath, 'utf8')
  const footerStart = source.indexOf('const FooterStatusCapsule')
  const settingsStart = source.indexOf('const Settings', footerStart)
  const footer = source.slice(footerStart, settingsStart)

  // V1.0.1：wide/rail 入口点击直达呼吸轨迹，不再经过中间面板
  assert.match(footer, /onClick: \(event\) => openBreath\(event\.currentTarget\)/u)
  assert.match(footer, /data-jx-surface-trigger': 'breath'/u)
  assert.doesNotMatch(footer, /data-jx-surface-trigger': 'jingxi-panel'/u)
  assert.doesNotMatch(footer, /data-jx-provider/u, 'Provider facts do not belong to the sidebar')
  assert.doesNotMatch(footer, /data-jx-sidebar-action|data-jx-quick-action/u, 'companion actions removed from the sidebar')
  assert.doesNotMatch(footer, /jx-fc-version/u, 'version row removed from the sidebar footer')
  assert.match(footer, /data-jx-selected': breathSurfaceOpen \? 'true' : undefined/u, 'rail entry selected state follows the Breath overlay')
  assert.doesNotMatch(source, /const JingxiPanel\b/u, 'JingxiPanel removed — the entry opens Breath directly')
  assert.doesNotMatch(source, /const JingxiPanelOverlay\b/u)
  assert.doesNotMatch(source, /const UpdateOverlay\b/u, 'Update overlay removed — checks are read-only in Settings')
  assert.match(source, /const BreathOverlay\b/u)
})


test('Sidebar runtime mark keeps the whale calm when settled and colors thread status semantically', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(
    source,
    /action === 'jingxi' && state === 'active' \? h\(RuntimeSpout, \{ state, size \}\) : null/u,
    'Only an active thread should show the breath spout on the collapsed whale',
  )
  assert.match(source, /\.jx-fc-entry__status\[data-thread-status="active"\]\{[^}]*var\(--dsw-alias-brand-primary/u)
  assert.match(source, /\.jx-fc-entry__status\[data-thread-status="stable"\]\{[^}]*var\(--dsw-alias-state-success-primary/u)
  assert.match(source, /\.jx-fc-entry__status\[data-thread-status="failed"\]\{[^}]*var\(--dsw-alias-state-error-primary/u)
})

test('Thread status copy follows the current thread, not lifecycle action failures', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('const threadStatusCopy')
  const end = source.indexOf('const BreathEmptyState', start)
  const statusCopy = source.slice(start, end)

  assert.doesNotMatch(statusCopy, /runtime\?\.(restart|update)/u, 'restart/update failures must not mask the thread status')
  assert.match(statusCopy, /if \(view\?\.live\) return '线程状态：生成中'/u)
  assert.match(statusCopy, /if \(status === 'completed'\) return '线程状态：已完成'/u)
  assert.match(statusCopy, /if \(status === 'interrupted'\) return '线程状态：已中断'/u)
  assert.match(statusCopy, /return '线程状态：等待下一轮'/u)
})

test('Breath surface exposes the refresh control with the official tool marks', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface =')
  const breathEnd = source.indexOf('const BreathOverlay =', breathStart)
  const breath = source.slice(breathStart, breathEnd)

  assert.match(breath, /h\(JingxiDialogHeader, \{/u, 'Breath keeps the shared Jingxi dialog header')
  assert.match(breath, /data-jx-refresh': 'breath'/u)
  assert.match(breath, /breathService\.load\(\{ force: true \}\)/u)
  assert.match(breath, /aria-label': '刷新呼吸节奏'/u)
  assert.match(source, /h\(JingxiMark, \{ size: 20, decorative: true, showSpout/u, 'Breath header keeps the official 20px Jingxi mark')
  assert.doesNotMatch(source, /jx-panel-tool__icon--update/u)
})

test('Sidebar reference assets stay on their semantic surfaces', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /IconSettingsOutline16/u, 'Settings should use the official vector artwork')
  assert.match(source, /className: 'jx-settings-row'/u, 'Settings should expose a compact semantic row')
})

test('Update UI translates a bare Windows EINVAL or ENIVAL error', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /e\(\?:inval\|nival\)/u)
  assert.match(source, /Windows 包管理器调用失败/u)
})

test('P0: Settings section is a real version/status/Doctor surface with a 320px alternate entry', async () => {
  const source = await readFile(clientPath, 'utf8')
  const settingsStart = source.indexOf('const Settings =')
  const settings = source.slice(settingsStart)

  // 版本 / 运行状态功能区
  assert.match(settings, /jx-settings-body/u)
  assert.match(settings, /jx-settings-section/u)
  assert.match(settings, /'版本'/u)
  assert.match(settings, /'运行状态'/u)
  assert.match(settings, /status\?\.jingxiVersion/u)
  assert.match(settings, /status\?\.designVersion/u)
  assert.match(settings, /status\?\.projectionRegistered/u)
  assert.match(settings, /status\?\.realListening/u)
  // 320px 备用入口：从设置直接打开 Breath（先关设置面板避免 modal-on-modal）
  assert.match(settings, /jx-settings-open/u)
  assert.match(settings, /'打开鲸息'/u)
  assert.match(settings, /openBreath\(null\)/u, 'settings entry must open the Breath surface, not stack another modal')
  assert.match(settings, /typeof props\?\.close === 'function'/u, 'settings entry must close the settings panel before opening')
  // Doctor 折叠块：只读，不引入 mutation
  assert.match(settings, /jx-settings-doctor/u)
  assert.match(settings, /'诊断与修复'/u)
  assert.match(settings, /jx-settings-doctor__(summary|body)/u)
  // 保留既有语义行与官方图标
  assert.match(settings, /className: 'jx-settings-row'/u)
  assert.match(settings, /IconSettingsOutline16/u)
  // 不引入第二个 Dashboard 或新 sheet：设置区只读展示，不写 provider / 不建卡片墙
  assert.doesNotMatch(settings, /jx-settings.*card|data-jx-provider/u)
})
