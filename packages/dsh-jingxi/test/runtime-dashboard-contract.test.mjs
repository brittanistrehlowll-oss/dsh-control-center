import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const clientPath = process.env.JINGXI_CLIENT_PATH
  ? pathToFileURL(process.env.JINGXI_CLIENT_PATH)
  : new URL('../lib/client.js', import.meta.url)

test('Runtime surface exposes the focused Jingxi Breath reading modules', async () => {
  const source = await readFile(clientPath, 'utf8')

  for (const selector of [
    'jx-breath-primary',
    'jx-breath-facts',
    'jx-curve',
    'jx-event-rail',
    'jx-recent',
  ]) {
    if (!source.includes(selector)) {
      throw new Error(`native Breath module is missing: ${selector}`)
    }
  }

  for (const copy of ['Cache First', 'Breath Curve', 'Event Rail', '最近 5']) {
    if (!source.includes(copy)) {
      throw new Error(`native Breath copy is missing: ${copy}`)
    }
  }

  if (!source.includes('jx-phase-narrative') || !source.includes('jx-curve-event-ticks')) {
    throw new Error('V5.5 narrative/tick modules are missing')
  }
  if (source.includes('jx-curve-stages')) {
    throw new Error('fixed phase legend must not reintroduce a second phase UI')
  }

  for (const required of [
    'jx-breath-native',
    'jx-breath-primary',
    'jx-curve',
    'jx-curve-legend',
    'jx-breath-reading',
    'jx-breath-facts',
    'jx-breath-folds',
    'jx-fc-status',
    'jx-phase-story__narrative',
  ]) {
    if (!source.includes(required)) {
      throw new Error(`workbench module is missing: ${required}`)
    }
  }

  for (const obsolete of ['jx-runtime-summary', 'jx-curve-stages']) {
    if (source.includes(obsolete)) throw new Error(`obsolete runtime module remains: ${obsolete}`)
  }
})

test('Reference workbench stays inside the Jingxi modal and leaves the DSH host shell alone', async () => {
  const source = await readFile(clientPath, 'utf8')
  const breathStart = source.indexOf('const BreathSurface')
  const breathEnd = source.indexOf('const BreathOverlay', breathStart)
  const surface = source.slice(breathStart, breathEnd)

  for (const required of [
    'BreathFactItem',
    'PhaseStory',
    'jx-breath-body',
    'jx-breath-facts',
    'jx-breath-folds',
    'jx-curve',
  ]) {
    if (!source.includes(required)) throw new Error(`Reference workbench module is missing: ${required}`)
  }

  if (!surface.includes('h(BreathFactItem')) throw new Error('Breath must render aligned fact items')
  if (surface.includes('h(BreathSessionSummary')) throw new Error('v2.1: Session Summary fold removed — metrics live in the KPI row')
  if (surface.includes('DashboardQuotaCard')) throw new Error('quota card must be removed from Breath')
  if (!surface.includes('h(PhaseStory')) throw new Error('Breath must render Phase Story')
  if (!surface.includes('h(CurveLegend')) throw new Error('v2.1: the curve legend carries trajectory counts')
  if (surface.includes('SessionSummaryCard')) throw new Error('Session Summary card must be removed with the aside rail')
  if (!surface.includes('jx-curve')) throw new Error('Breath must keep the Breath Curve')
  if (!surface.includes('h(EventRail')) throw new Error('Breath must keep the Event Rail')
  if (surface.includes('h(BreathQuotaFold')) throw new Error('V5.6: quota fold must be removed from the dialog — quota lives in the sidebar')
  if (!source.includes("className: 'jx-modal--breath'")) {
    throw new Error('Reference workbench must remain inside the Jingxi Breath modal')
  }
  if (source.includes("className: 'jx-dashboard-card jx-trajectory-strip'")) {
    throw new Error('TrajectoryStrip must not use the obsolete duplicate dashboard card shell')
  }
})
