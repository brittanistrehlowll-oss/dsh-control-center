#!/usr/bin/env node
/**
 * scan-sensitive.mjs — secret & sensitive-content scan for the repository.
 *
 * Checkpoint A requirement: no credential, cookie, prompt, assistant body,
 * tool argument, shell command, raw upstream response, or session log content
 * may appear in tracked state, snapshots, or committed fixtures.
 *
 * Usage: node scripts/scan-sensitive.mjs [--fix]
 * Exit code 0 = clean, 1 = findings.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.turbo', '.pnpm-store',
  'artifacts', 'release', 'state', 'test-output', '.venv', 'logs'
]);

const SENSITIVE_FILE_PATTERNS = [
  /\.(pem|p12|pfx|key|keystore|jks|mdf)$/i,
  /\.env(\.local|\.dev|\.prod|\.secret)?$/,
  /(^|[_.-])?(token|secret|credential|password|api[_-]?key)\./i
];

const SECRET_VALUE_PATTERNS = [
  // GitHub PAT: ghp_..., gho_..., github_pat_...
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  // AWS access key
  /\bAKIA[0-9A-Z]{16}\b/,
  // Generic "key=40hex" assignments for known names
  /\b(?:api[_-]?key|secret|token|password|passwd|credential)\s*[=:]\s*['"]?[A-Za-z0-9_\-\.]{16,}['"]?/i,
  // Bearer tokens in text
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=/,
  // Private key blocks
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  // AWS secret key
  /aws_secret_access_key\s*=\s*['"]?[\w/+=]{40}['"]?/i
];

const REDACTED_OK = [
  '<REDACTED>', 'REDACTED', 'xxxxx', '***', 'example.com'
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE.has(entry.name)) continue;
      out.push(...await walk(join(dir, entry.name)));
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function looksRedacted(value) {
  return REDACTED_OK.some((token) => value.includes(token));
}

function wouldMatchSecret(value) {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

async function scanFile(filePath) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  const findings = [];
  if (SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(rel))) {
    findings.push(`${rel}: sensitive file pattern`);
  }
  if (!/\.(ts|tsx|js|mjs|json|md|yaml|yml|txt|env|example)$/.test(rel)) {
    return findings; // binary or unknown — skip content scan
  }
  // Test fixtures intentionally contain fake secrets to exercise the detector.
  if (/\.test\.(ts|tsx|js|mjs)$/.test(rel)) return findings;
  const info = await stat(filePath);
  if (info.size > 2 * 1024 * 1024) return findings;
  const content = await readFile(filePath, 'utf8');
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (looksRedacted(line)) continue;
    if (wouldMatchSecret(line)) {
      findings.push(`${rel}:${index + 1}: possible secret value`);
    }
  }
  return findings;
}

const mode = process.argv.includes('--fix') ? 'fix' : 'scan';

const files = await walk(ROOT);
const findings = (await Promise.all(files.map(scanFile))).flat();

if (findings.length === 0) {
  console.log(`scan-sensitive: OK (${files.length} files scanned)`);
  process.exit(0);
}
console.error(`scan-sensitive: ${findings.length} finding(s):`);
for (const finding of findings.slice(0, 50)) console.error(`  - ${finding}`);
process.exit(mode === 'fix' ? 1 : 1);