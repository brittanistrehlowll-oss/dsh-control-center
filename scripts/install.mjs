#!/usr/bin/env node
/**
 * DSH Control Center — V2 thin installer layer (Phase 4).
 *
 * A meta-package / installer for the two runtime plugins:
 *   - dsh-quota-panel  (额度 capsule + card)
 *   - dsh-lifecycle    (左下角控制条 + 关闭后启动页)
 *
 * It NEVER starts/stops DSH itself. It only:
 *   - detects the DSH install, profile, and plugin state;
 *   - copies plugin entry files into the profile plugins dir;
 *   - writes/removes cordis.patch.yml insert entries;
 *   - checks the controller (:3081), DSH (:3080), markers and watchdog.
 *
 * Safety:
 *   - `--dry-run` prints what WOULD happen without touching anything.
 *   - Default mode prints a plan and requires `--apply` to mutate.
 *   - No process kill, no marker write, no DSH restart, no secrets logged.
 *
 * Usage:
 *   node scripts/install.mjs detect [--dsh-root <dir>] [--profile <name>]
 *   node scripts/install.mjs install [--apply] [--dry-run]
 *   node scripts/install.mjs uninstall [--apply] [--dry-run]
 *   node scripts/install.mjs healthcheck
 */
import { access, copyFile, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

// ————————————————————————————————————————————————
// Config / discovery
// ————————————————————————————————————————————————

const DEFAULT_DSH_CANDIDATES = [
  resolve('D:\\CodexD\\DSH'),
  join(homedir(), '.dsh'),
  join(homedir(), 'dsh')
];

const PLUGIN_SOURCES = {
  'dsh-quota-panel': {
    entry: 'dsh-quota-panel.mjs',
    sourceCandidates: [
      (root) => join(root, '..', '..', 'deepseek', 'dsh-quota-panel', 'lib', 'dsh-quota-panel.mjs'),
      (root) => join(root, '..', 'dsh-quota-panel', 'lib', 'dsh-quota-panel.mjs'),
      (root) => join(root, '..', '..', 'deepseek', 'dsh-quota-panel', 'lib', 'dsh-quota-panel-v6.mjs'),
      (root) => join(root, '..', 'dsh-quota-panel', 'lib', 'dsh-quota-panel-v6.mjs')
    ]
  },
  'dsh-lifecycle': {
    entry: 'dsh-restart-button.mjs',
    sourceCandidates: [
      (root) => join(root, '..', '..', 'deepseek', 'dsh-lifecycle', 'lib', 'dsh-restart-button.mjs'),
      (root) => join(root, '..', 'dsh-lifecycle', 'lib', 'dsh-restart-button.mjs')
    ]
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const command = args.find((a) => !a.startsWith('-')) ?? 'detect';
  return {
    command,
    dshRoot: get('--dsh-root'),
    profile: get('--profile') ?? 'web',
    apply: args.includes('--apply'),
    dryRun: args.includes('--dry-run') || !args.includes('--apply')
  };
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function findDshRoot(hint) {
  if (hint) return (await exists(hint)) ? hint : undefined;
  for (const candidate of DEFAULT_DSH_CANDIDATES) {
    if (await exists(join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}

async function detect({ dshRoot, profile }) {
  const root = await findDshRoot(dshRoot);
  if (!root) {
    return {
      ok: false,
      dshRoot: undefined,
      reason: 'DSH install not found (looked at D:\\CodexD\\DSH, ~/.dsh, ~/dsh)'
    };
  }
  const profileDir = join(root, 'home', 'profiles', profile);
  const pluginsDir = join(profileDir, 'plugins');
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const hasProfile = await exists(join(profileDir, 'package.json'));
  const hasPluginsDir = await exists(pluginsDir);
  const hasPatch = await exists(patchPath);
  const hasController = await exists(join(root, 'dsh-controller.mjs'));
  const hasWatchdog = await exists(join(root, 'Start-DSH-Watchdog.ps1'));

  const patch = hasPatch ? await readFile(patchPath, 'utf8') : '';
  const installed = {
    'quota-panel': hasPluginsDir && patch.includes('quota-panel'),
    'lifecycle': hasPluginsDir && patch.includes('restart-button')
  };

  return {
    ok: hasProfile,
    dshRoot: root,
    profile,
    profileDir,
    pluginsDir,
    hasProfile,
    hasPluginsDir,
    hasPatch,
    hasController,
    hasWatchdog,
    installed,
    version: await readPackageVersion(root)
  };
}

async function readPackageVersion(root) {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    return pkg.dependencies?.['@deepseek-ai/dsh'] ?? pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ————————————————————————————————————————————————
// Commands
// ————————————————————————————————————————————————

async function cmdDetect(opts) {
  const info = await detect(opts);
  console.log(JSON.stringify(info, null, 2));
  return info.ok ? 0 : 1;
}

// ————————————————————————————————————————————————
// Bundle-based install (DSH official mechanism)
// ————————————————————————————————————————————————

const BUNDLES = [
  { id: 'dsh-quota-panel', pkg: 'dsh-quota-panel', source: 'github:brittanistrehlowll-oss/dsh-quota-panel' },
  { id: 'dsh-lifecycle', pkg: 'dsh-lifecycle', source: 'github:brittanistrehlowll-oss/dsh-lifecycle' }
];

async function readProfilePkg(profileDir) {
  const p = join(profileDir, 'package.json');
  if (!(await exists(p))) return undefined;
  return JSON.parse(await readFile(p, 'utf8'));
}

async function writeProfilePkg(profileDir, pkg) {
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

async function cmdInstall(opts) {
  const info = await detect(opts);
  if (!info.ok) { console.error('detect failed: ' + info.reason); return 1; }
  const actions = [];

  const profilePkg = await readProfilePkg(info.profileDir);
  if (!profilePkg) {
    console.error(`profile package.json not found at ${info.profileDir}`);
    return 1;
  }
  const deps = profilePkg.dependencies ?? {};
  const bundles = profilePkg.dsh?.profile?.bundles ?? [];

  for (const bundle of BUNDLES) {
    const depPresent = deps[bundle.pkg] !== undefined;
    const bundlePresent = bundles.includes(bundle.pkg);
    if (depPresent && bundlePresent) {
      actions.push(`[skip] ${bundle.id}: already a bundle dependency`);
    } else {
      actions.push(`[add]  ${bundle.id}: dependency ${bundle.source} + bundles entry "${bundle.pkg}"`);
    }
  }

  // Legacy fallback check: file-copy mode (old manual installs).
  for (const [plugin, spec] of Object.entries(PLUGIN_SOURCES)) {
    if (await exists(join(info.pluginsDir, spec.entry))) {
      actions.push(`[note] ${plugin}: legacy file install detected at plugins/${spec.entry} (bundle install recommended instead)`);
    }
  }

  if (opts.dryRun) {
    console.log('DRY-RUN — nothing was changed. Add --apply to execute.');
    for (const a of actions) console.log('  ' + a);
    return 0;
  }
  if (!opts.apply) {
    console.log('Plan (no changes made). Run with --apply to execute.');
    for (const a of actions) console.log('  ' + a);
    return 0;
  }

  // ——— apply ———
  let changed = false;
  for (const bundle of BUNDLES) {
    if (deps[bundle.pkg] === undefined) { deps[bundle.pkg] = bundle.source; changed = true; }
    if (!bundles.includes(bundle.pkg)) { bundles.push(bundle.pkg); changed = true; }
  }
  if (changed) {
    profilePkg.dependencies = deps;
    profilePkg.dsh = profilePkg.dsh ?? {};
    profilePkg.dsh.profile = profilePkg.dsh.profile ?? {};
    profilePkg.dsh.profile.bundles = bundles;
    await writeProfilePkg(info.profileDir, profilePkg);
    console.log(`  [ok] ${info.profileDir}/package.json updated (deps + bundles)`);
  } else {
    console.log('  [ok] profile already up to date');
  }
  console.log('install done. Run `pnpm install` inside the profile dir, then restart DSH web via the external watchdog to activate.');
  return 0;
}

async function cmdUninstall(opts) {
  const info = await detect(opts);
  if (!info.ok) { console.error('detect failed: ' + info.reason); return 1; }
  const actions = [];
  const profilePkg = await readProfilePkg(info.profileDir);

  if (profilePkg) {
    const deps = profilePkg.dependencies ?? {};
    const bundles = profilePkg.dsh?.profile?.bundles ?? [];
    for (const bundle of BUNDLES) {
      if (deps[bundle.pkg] !== undefined || bundles.includes(bundle.pkg)) {
        actions.push(`[rm] profile: remove ${bundle.pkg} from dependencies + bundles`);
      }
    }
  }
  for (const spec of Object.values(PLUGIN_SOURCES)) {
    const target = join(info.pluginsDir, spec.entry);
    if (await exists(target)) actions.push(`[rm] plugins/${spec.entry}`);
  }

  if (opts.dryRun) {
    console.log('DRY-RUN — nothing changed. Add --apply to execute.');
    for (const a of actions) console.log('  ' + a);
    return 0;
  }
  if (!opts.apply) {
    console.log('Plan (no changes made). Run with --apply to execute.');
    for (const a of actions) console.log('  ' + a);
    return 0;
  }

  const { rm } = await import('node:fs/promises');
  if (profilePkg) {
    const deps = profilePkg.dependencies ?? {};
    const bundles = profilePkg.dsh?.profile?.bundles ?? [];
    let changed = false;
    for (const bundle of BUNDLES) {
      if (deps[bundle.pkg] !== undefined) { delete deps[bundle.pkg]; changed = true; }
      const idx = bundles.indexOf(bundle.pkg);
      if (idx >= 0) { bundles.splice(idx, 1); changed = true; }
    }
    if (changed) {
      await writeProfilePkg(info.profileDir, profilePkg);
      console.log(`  [ok] profile package.json: removed ${BUNDLES.map((b) => b.pkg).join(', ')}`);
    }
  }
  for (const spec of Object.values(PLUGIN_SOURCES)) {
    const target = join(info.pluginsDir, spec.entry);
    if (await exists(target)) { await rm(target, { force: true }); console.log(`  [ok] removed plugins/${spec.entry}`); }
  }
  console.log('uninstall done. Run `pnpm install` inside the profile dir, then restart DSH web via the external watchdog to deactivate.');
  return 0;
}

async function cmdHealthcheck(opts) {
  const info = await detect(opts);
  const results = { dshInstall: info.ok, profile: info.hasProfile };

  // Controller :3081
  try {
    const controller = await fetchJson('http://127.0.0.1:3081/api/status');
    results.controller = { ok: true, state: controller?.state ?? 'unknown' };
  } catch {
    results.controller = { ok: false, error: 'controller :3081 unreachable' };
  }
  // DSH :3080
  try {
    const health = await fetchJson('http://127.0.0.1:3080/api/system/health');
    results.dsh = { ok: true, ready: health?.ready ?? false, bootId: health?.bootId ?? null };
  } catch {
    results.dsh = { ok: false, error: 'DSH :3080 unreachable (may be stopped — normal when off)' };
  }
  // Markers
  if (info.dshRoot) {
    const logs = join(info.dshRoot, 'logs');
    results.markers = {
      restart: await exists(join(logs, 'restart.requested')),
      stop: await exists(join(logs, 'stop.requested')),
      start: await exists(join(logs, 'start.requested'))
    };
  }
  results.watchdogScript = info.hasWatchdog;
  results.plugins = info.installed;

  console.log(JSON.stringify(results, null, 2));
  const degraded = results.controller?.ok === false;
  return degraded ? 2 : 0;
}

async function fetchJson(url) {
  // Use node:http with a plain timeout (no AbortController) to avoid the
  // Windows UV handle-closing crash when the process exits right after fetch.
  const { get } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = get(url, { timeout: 2_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('bad json')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ————————————————————————————————————————————————
// Main
// ————————————————————————————————————————————————

const opts = parseArgs();
const handlers = {
  detect: cmdDetect,
  install: cmdInstall,
  uninstall: cmdUninstall,
  healthcheck: cmdHealthcheck
};
const handler = handlers[opts.command];
if (!handler) {
  console.error(`unknown command: ${opts.command} (expected detect|install|uninstall|healthcheck)`);
  process.exit(1);
}
const code = await handler(opts);
// Natural exit: let pending handles drain (avoids the Windows UV assert when
// an HTTP request just completed). process.exitCode is honored by Node.
process.exitCode = code;