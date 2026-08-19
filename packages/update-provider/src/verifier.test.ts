import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdateVerifier, type KeyProvider } from './verifier.js';
import type { UpdateManifest } from '@dsh-control-center/control-contract';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const keypair = generateKeyPairSync('ed25519');
const WRONG_KEY = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) as string;

function keyProvider(pem: string | undefined): KeyProvider {
  return { resolvePublicKey: () => pem };
}

function manifestFor(content: Buffer, overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const signature = sign(null, content, keypair.privateKey).toString('base64');
  return {
    version: '0.1.0-rc.8',
    artifactUrl: 'https://github.com/deepseek-ai/deepseek-harness/releases/download/dsh-v0.1.0-rc.8/artifact',
    sha256,
    signatureBase64: signature,
    ...overrides
  };
}

describe('UpdateVerifier (Ed25519 + SHA256, fail-closed)', () => {
  it('accepts a valid package + manifest + key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-verify-'));
    tempRoots.push(root);
    const file = join(root, 'pkg.bin');
    const content = Buffer.from('staged runtime bytes');
    await writeFile(file, content);
    const publicPem = keypair.publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const verifier = new UpdateVerifier(keyProvider(publicPem));
    const result = await verifier.verifyPackage(file, manifestFor(content));
    expect(result.valid).toBe(true);
  });

  it('rejects tampered bytes (signature mismatch)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-verify-'));
    tempRoots.push(root);
    const file = join(root, 'pkg.bin');
    const content = Buffer.from('staged runtime bytes');
    await writeFile(file, Buffer.concat([content, Buffer.from('x')]));
    const publicPem = keypair.publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const verifier = new UpdateVerifier(keyProvider(publicPem));
    const result = await verifier.verifyPackage(file, manifestFor(content));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checksum mismatch');
  });

  it('rejects a signature verified against the wrong key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-verify-'));
    tempRoots.push(root);
    const file = join(root, 'pkg.bin');
    const content = Buffer.from('pkg');
    await writeFile(file, content);

    // The manifest is validly signed by the real private key, but we verify
    // against a DIFFERENT public key -> signature must fail.
    const manifest = manifestFor(content);
    const verifier = new UpdateVerifier(keyProvider(WRONG_KEY));
    const result = await verifier.verifyPackage(file, manifest);
    expect(result.valid).toBe(false);
  });

  it('fails closed when no public key is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cc-verify-'));
    tempRoots.push(root);
    const file = join(root, 'pkg.bin');
    const content = Buffer.from('pkg');
    await writeFile(file, content);
    const verifier = new UpdateVerifier(keyProvider(undefined));
    const result = await verifier.verifyPackage(file, manifestFor(content));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('no trusted public key');
  });

  it('fails closed on a malformed manifest', () => {
    expect(() => UpdateVerifier.parseManifest({ version: 'x' })).toThrow();
    expect(UpdateVerifier.parseManifest({
      version: '0.1.0-rc.8',
      artifactUrl: 'https://example.com/pkg',
      sha256: 'a'.repeat(64),
      signatureBase64: 'c2ln'
    })).toBeTruthy();
  });
});