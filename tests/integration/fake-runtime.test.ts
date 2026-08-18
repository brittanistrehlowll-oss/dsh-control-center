import { afterEach, describe, expect, it } from 'vitest';
import { FakeDshRuntime } from '@dsh-control-center/fake-runtime';
import { probeDsh } from '@dsh-control-center/runtime-discovery';

const runtimes: FakeDshRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

describe('Fake DSH Runtime integration (real DSH surface)', () => {
  it('exposes a valid health protocol and changes boot identity across restarts', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'fake-1' });
    runtimes.push(runtime);
    const first = await runtime.start();
    const firstProbe = await probeDsh({
      runtimeId: first.runtimeId,
      source: 'legacy-watchdog',
      baseUrl: first.baseUrl,
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: first.profile,
      processId: first.processId,
      processStartedAt: first.processStartedAt,
      commandFingerprint: first.commandFingerprint
    });
    expect(firstProbe.protocolValid).toBe(true);
    expect(firstProbe.health?.bootId).toBe(first.bootId);
    expect(firstProbe.identity.evidence.bootId).toBe(first.bootId);
    expect(firstProbe.descriptor?.ownership).toBe('legacy');

    await runtime.stop();
    const second = await runtime.start();
    const secondProbe = await probeDsh({
      runtimeId: second.runtimeId,
      source: 'legacy-watchdog',
      baseUrl: second.baseUrl,
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: second.profile,
      processId: second.processId,
      processStartedAt: second.processStartedAt,
      commandFingerprint: second.commandFingerprint
    });
    expect(secondProbe.identity.strength).toBe('strong');
    expect(secondProbe.identity.value).not.toBe(firstProbe.identity.value);
  });

  it('corroborates identity through the legacy controller surface', async () => {
    const runtime = new FakeDshRuntime({ runtimeId: 'fake-2', controllerEnabled: true });
    runtimes.push(runtime);
    const address = await runtime.start();
    const probe = await probeDsh({
      runtimeId: address.runtimeId,
      source: 'legacy-watchdog',
      baseUrl: address.baseUrl,
      controllerUrl: address.controllerUrl,
      installOrigin: 'local-node-modules',
      installAuthority: 'delegated',
      profileId: address.profile,
      processId: address.processId,
      processStartedAt: address.processStartedAt,
      commandFingerprint: address.commandFingerprint
    });
    expect(probe.protocolValid).toBe(true);
    expect(probe.controller?.state).toBe('running');
    expect(probe.controller?.bootId).toBe(address.bootId);
  });
});