#!/usr/bin/env node
/**
 * verify-contract.mjs — contract/schema surface verification.
 *
 * Verifies that the schema versions embedded in contract output stay pinned to
 * the expected value and that all contract modules export what the root
 * depends on. This is a lightweight build-time guard, not a runtime check.
 *
 * Usage: node scripts/verify-contract.mjs
 * Exit 0 = ok, 1 = drift detected.
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CONTRACT_DIR = join(ROOT, 'packages', 'control-contract', 'src');

const EXPECTED_SCHEMA_VERSION = 1;
const REQUIRED_EXPORTS = [
  'RuntimeDescriptorSchema',
  'InstanceIdentitySchema',
  'RuntimeSnapshotSchema',
  'LifecycleOperationSchema',
  'OperationJournalEventSchema',
  'SurfaceSnapshotSchema',
  'ControlHelloRequestSchema',
  'ControlHelloResponseSchema',
  'MutationRequestSchema',
  'UpdateCandidateSchema',
  'CompatibilityResultSchema',
  'RuntimeManifestSchema',
  'DiagnosticSummarySchema',
  'QuotaSnapshotSchema',
  'OwnershipSchema',
  'InstallOriginSchema',
  'InstallAuthoritySchema',
  'CapabilitySetSchema'
];

const files = (await readdir(CONTRACT_DIR)).filter((name) => /\.ts$/.test(name));
const source = (await Promise.all(files.map(async (name) => {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(CONTRACT_DIR, name), 'utf8');
}))).join('\n');

const findings = [];

const versionMatch = source.match(/export const ContractVersion\s*=\s*(\d+)\s*as const/);
if (!versionMatch) {
  findings.push('ContractVersion constant not found');
} else if (Number(versionMatch[1]) !== EXPECTED_SCHEMA_VERSION) {
  findings.push(`ContractVersion mismatch: expected ${EXPECTED_SCHEMA_VERSION}, found ${versionMatch[1]}`);
}

for (const name of REQUIRED_EXPORTS) {
  if (!source.includes(`export const ${name}`) && !source.includes(`export const ${name} =`)) {
    findings.push(`missing export: ${name}`);
  }
}

if (findings.length === 0) {
  console.log(`verify-contract: OK (${files.length} file(s), ${REQUIRED_EXPORTS.length} exports, schemaVersion=${EXPECTED_SCHEMA_VERSION})`);
  process.exit(0);
}
console.error('verify-contract: drift detected:');
for (const finding of findings) console.error(`  - ${finding}`);
process.exit(1);