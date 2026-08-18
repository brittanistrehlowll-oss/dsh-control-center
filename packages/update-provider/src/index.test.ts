import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_REPOSITORY,
  UpdateProviderError,
  checkToolchain,
  decideRollback,
  evaluateCompatibility,
  normalizeSource,
  parseDshTag,
  verifyTagChain
} from './index.js';

describe('update-provider', () => {
  it('pins the official repository and flags dev sources as untrusted', () => {
    expect(normalizeSource(OFFICIAL_REPOSITORY).kind).toBe('official');
    const dev = normalizeSource('brittanistrehlowll-oss/dsh-fork');
    expect(dev.kind).toBe('untrusted-development');
    expect(dev.developmentNote).toBe('UNTRUSTED DEVELOPMENT SOURCE');
  });

  it('parses only dsh-v<semver> tags', () => {
    expect(parseDshTag('dsh-v0.1.0-rc.7')?.version).toBe('0.1.0-rc.7');
    expect(parseDshTag('dsh-v1.2.3')?.version).toBe('1.2.3');
    expect(parseDshTag('v0.1.0-rc.7')).toBeUndefined();
    expect(parseDshTag('master')).toBeUndefined();
    expect(parseDshTag('latest')).toBeUndefined();
  });

  it('verifies the tag → commit → version chain for official releases', () => {
    const verified = verifyTagChain({
      repository: OFFICIAL_REPOSITORY,
      tag: 'dsh-v0.1.0-rc.7',
      commitSha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      packageJsonVersion: '0.1.0-rc.7'
    });
    expect(verified.candidate.verifiedOfficialSource).toBe(true);
    expect(verified.candidate.channel).toBe('preview'); // rc => preview
  });

  it('rejects a version mismatch in the chain', () => {
    expect(() => verifyTagChain({
      repository: OFFICIAL_REPOSITORY,
      tag: 'dsh-v0.1.0-rc.7',
      commitSha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      packageJsonVersion: '0.2.0'
    })).toThrow(UpdateProviderError);
  });

  it('rejects non-official sources even with valid tags', () => {
    expect(() => verifyTagChain({
      repository: 'someone/dsh',
      tag: 'dsh-v0.1.0',
      commitSha: 'abcdef1234567890'
    })).toThrow(UpdateProviderError);
  });

  it('checks node/pnpm toolchain against DSH requirements', () => {
    expect(checkToolchain('24.19.0', '11.19.0').compatible).toBe(true);
    expect(checkToolchain('22.19.0', '11.7.0').compatible).toBe(true);
    expect(checkToolchain('22.18.0', '11.7.0').compatible).toBe(false);
    expect(checkToolchain('20.11.0', '11.7.0').compatible).toBe(false);
    expect(checkToolchain('24.0.0', '9.0.0').compatible).toBe(false);
  });

  it('gates one-click update on all required checks', () => {
    const ok = evaluateCompatibility({
      toolchain: { node: '24.19.0', pnpm: '11.19.0' },
      runtimeFingerprint: true,
      sessionList: true,
      projection: true,
      deepLink: true,
      installAuthority: 'mutable',
      ownership: 'legacy'
    });
    expect(ok.allowed).toBe(true);

    const blocked = evaluateCompatibility({
      toolchain: { node: '20.11.0', pnpm: '11.7.0' },
      runtimeFingerprint: true,
      sessionList: true,
      installAuthority: 'read-only',
      ownership: 'observe-only'
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.result.compatible).toBe(false);
  });

  it('maps every update-failure cause to a rollback decision', () => {
    for (const cause of [
      'start-failed', 'health-timeout', 'fingerprint-invalid', 'version-mismatch',
      'api-incompatible', 'profile-mismatch', 'identity-unconfirmed'
    ] as const) {
      const decision = decideRollback(cause);
      expect(decision.shouldRollback).toBe(true);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});