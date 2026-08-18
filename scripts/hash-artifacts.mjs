#!/usr/bin/env node
/**
 * hash-artifacts.mjs — compute SHA-256 for release artifacts.
 *
 * Usage: node scripts/hash-artifacts.mjs [dir...]
 * Defaults to scanning release/ and artifacts/ if present, else nothing (OK).
 * Writes SHA256SUMS.txt into each scanned directory.
 *
 * Exit 0 = hashes written (or nothing to hash), 1 = error.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

const targets = process.argv.slice(2).map((dir) => resolve(ROOT, dir));
if (targets.length === 0) {
  for (const dir of ['release', 'artifacts']) {
    const full = join(ROOT, dir);
    try { await stat(full); targets.push(full); } catch { /* absent */ }
  }
}

let wroteAny = false;
for (const dir of targets) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    continue; // dir absent — fine
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt');
  if (files.length === 0) continue;
  const lines = [];
  for (const entry of files) {
    const filePath = join(dir, entry.name);
    const hash = await sha256(filePath);
    lines.push(`${hash}  ${entry.name}`);
  }
  lines.sort();
  await writeFile(join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
  wroteAny = true;
  console.log(`hash-artifacts: wrote ${join(dir, 'SHA256SUMS.txt')} (${lines.length} file(s))`);
}

if (!wroteAny) {
  console.log('hash-artifacts: no artifacts to hash (clean)');
}
process.exit(0);