import { access, readFile, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = new URL('../assets/icons/manifest.json', import.meta.url)

const requiredAssets = [
  ['status-v15', 'success', 'assets/icons/v15/status/success.png'],
  ['status-v15', 'error', 'assets/icons/v15/status/error.png'],
  ['status-v15', 'info', 'assets/icons/v15/status/info.png'],
  ['spout-v15', 'idle', 'assets/icons/v15/spout/idle.png'],
  ['spout-v15', 'light', 'assets/icons/v15/spout/light.png'],
  ['spout-v15', 'stable', 'assets/icons/v15/spout/stable.png'],
]

test('V1.5 manifest registers the split runtime/status/spout icon library (V1.0.1 Pure Breath)', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.designVersion, 'V1.5')
  assert.equal(manifest.productVersion, 'V1.0.1')
  assert.equal(manifest.canvas.background, 'transparent')

  for (const [group, id, path] of requiredAssets) {
    const entry = manifest.groups[group]?.find((item) => item.id === id)
    assert.ok(entry, `Manifest should register ${group}/${id}`)
    assert.equal(entry.path, path)
    const file = new URL(`../${path}`, import.meta.url)
    await access(file)
    const info = await stat(file)
    assert.ok(info.size > 100, `${path} should contain a real PNG asset`)
  }
})

test('V1.5 manifest keeps visual roles explicit', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.layers.runtimeV15.allowedSurfaces.includes('sidebar.entry'), true)
  assert.equal(manifest.layers.runtimeV15.allowedSurfaces.includes('panel.runtime'), true)
  assert.equal(manifest.layers.runtimeV15.hostComponent, '@deepseek-ai/dsh-client-ui-primitives:FishLogo')
  assert.equal(manifest.layers.providerV15, undefined, 'V1.0.1: the provider quota layer is removed from the icon system')
  assert.equal(manifest.layers.quota, undefined, 'V1.0.1: the quota layer is removed from the icon system')
  assert.equal(manifest.groups['provider-v15'], undefined, 'V1.0.1: provider raster artwork ships no longer')
  for (const entry of manifest.groups['runtime-v15']) {
    assert.equal(entry.implementation, 'official-fishlogo-plus-local-decoration')
    assert.equal(entry.path, undefined)
  }
})
