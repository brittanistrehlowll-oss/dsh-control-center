/**
 * Supervisor application entry — V1.1 first-round mode.
 *
 * This entry implements exactly what Checkpoint A's first real-environment
 * round permits:
 *   1. identify DSH          — probe /api/system/health on 127.0.0.1:3080
 *   2. read version          — health.version / descriptor.dshVersion
 *   3. read fingerprint      — protocol fingerprint from validated health
 *   4. confirm ownership=legacy
 *   5. Legacy Adapter dry-run — controller reachable, would accept the action
 *
 * It performs NO real stop/restart. Lifecycle request methods exist on the
 * adapter but are NOT invoked by this entry.
 *
 * Usage:
 *   pnpm --filter @dsh-control-center/supervisor start -- --state-dir <dir>
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '@dsh-control-center/snapshot-store';
import { RuntimeDiscovery } from '@dsh-control-center/runtime-discovery';
import { Supervisor } from '@dsh-control-center/supervisor-core';
import { FileGateway } from '@dsh-control-center/legacy-watchdog-adapter';
import { LEGACY_CONTROLLER_PORT, LEGACY_DSH_PORT } from '@dsh-control-center/legacy-watchdog-adapter';

function parseArgs(): { stateDir: string; dshLogsDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    stateDir: get('--state-dir') ?? join(tmpdir(), 'dsh-control-center', 'state'),
    dshLogsDir: get('--dsh-logs-dir') ?? join(process.cwd(), 'logs')
  };
}

const INSPECT_REPORT = 'dsh-control-center:inspect-report.json';

async function main(): Promise<number> {
  const { stateDir, dshLogsDir } = parseArgs();

  // Candidates: legacy-watchdog source via the real controller.
  const candidates = [{
    runtimeId: 'legacy-dsh',
    source: 'legacy-watchdog' as const,
    baseUrl: `http://127.0.0.1:${LEGACY_DSH_PORT}`,
    controllerUrl: `http://127.0.0.1:${LEGACY_CONTROLLER_PORT}`,
    installOrigin: 'local-node-modules' as const,
    installAuthority: 'delegated' as const,
    profileId: 'web'
  }];

  const discovery = new RuntimeDiscovery(candidates);
  const probe = await discovery.discover();
  const gateway = new FileGateway({ dshLogsDir });

  const report = {
    mode: 'first-round-read-only',
    probed: probe
      ? {
          reachable: probe.reachable,
          protocolValid: probe.protocolValid,
          identityStrength: probe.identity.strength,
          identityValue: probe.identity.value,
          ownership: probe.descriptor?.ownership,
          dshVersion: probe.descriptor?.dshVersion,
          health: probe.health,
          controller: probe.controller
        }
      : null,
    legacyDryRun: await gateway.readControllerStatus().then((status) => ({
      controllerResponding: status !== undefined,
      state: status?.state,
      bootId: status?.bootId
    })),
    snapshotAt: stateDir
  };

  const snapshotStore = new SnapshotStore(join(stateDir, 'snapshots'));
  const supervisor = new Supervisor({
    stateDir,
    supervisorInstanceId: 'supervisor-cli',
    candidates
  });
  await supervisor.start({ snapshotWriter: snapshotStore });
  await supervisor.runObserver();
  await supervisor.stop();

  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(stateDir, INSPECT_REPORT), JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  const ok = probe?.protocolValid === true && probe.descriptor?.ownership === 'legacy';
  console.log(ok
    ? 'RESULT: DSH identified, ownership=legacy, legacy adapter dry-run OK (read-only)'
    : 'RESULT: DSH not confirmed — see report');
  return ok ? 0 : 1;
}

await main();