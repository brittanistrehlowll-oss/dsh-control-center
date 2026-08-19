import { createHash, verify as cryptoVerify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { UpdateManifestSchema, type UpdateManifest } from '@dsh-control-center/control-contract';

/**
 * UpdateVerifier — Ed25519 signature + SHA-256 verification for update
 * artifacts (supply-chain security).
 *
 * Final design notes (improvements over the review draft):
 *  - `UpdateManifest` is a Zod schema in control-contract (contract-first).
 *  - Fail-closed: missing public key or missing signature => valid:false,
 *    never a vacuous pass.
 *  - `cryptoVerify(null, …)` is the correct Ed25519 usage in Node.
 *  - A `KeyProvider` seam resolves the trusted public key so tests inject a
 *    key and no secret ever touches the repo.
 */

export interface KeyProvider {
  /** Resolve the trusted Ed25519 public key (SPKI PEM). */
  resolvePublicKey(): string | undefined;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export class UpdateVerifier {
  constructor(private readonly keyProvider: KeyProvider) {}

  /** Parse and validate a manifest (fail-closed on malformed input). */
  static parseManifest(value: unknown): UpdateManifest {
    return UpdateManifestSchema.parse(value);
  }

  /**
   * Verify a downloaded package file against the manifest + trusted key.
   * Steps: manifest schema -> hash -> Ed25519 signature. Fail-closed.
   */
  async verifyPackage(packageFilePath: string, manifest: UpdateManifest): Promise<VerifyResult> {
    const publicKeyPem = this.keyProvider.resolvePublicKey();
    if (!publicKeyPem) {
      return { valid: false, reason: 'no trusted public key configured (fail-closed)' };
    }
    if (!manifest.signatureBase64) {
      return { valid: false, reason: 'missing signature (fail-closed)' };
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(packageFilePath);
    } catch {
      return { valid: false, reason: 'unable to read package file' };
    }

    // 1. SHA-256 hash check (lowercase, constant-time-ish).
    const computed = createHash('sha256').update(fileBuffer).digest('hex');
    if (computed.toLowerCase() !== manifest.sha256.toLowerCase()) {
      return { valid: false, reason: `checksum mismatch: expected ${manifest.sha256}, got ${computed}` };
    }

    // 2. Ed25519 signature.
    let signature: Buffer;
    try {
      signature = Buffer.from(manifest.signatureBase64, 'base64');
    } catch {
      return { valid: false, reason: 'malformed signature encoding' };
    }
    let verified: boolean;
    try {
      verified = cryptoVerify(null, fileBuffer, publicKeyPem, signature);
    } catch (error) {
      return { valid: false, reason: 'signature verification error: ' + (error instanceof Error ? error.message : String(error)) };
    }
    if (!verified) {
      return { valid: false, reason: 'cryptographic signature verification failed' };
    }
    return { valid: true };
  }
}

export type { UpdateManifest };