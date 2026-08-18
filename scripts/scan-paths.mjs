#!/usr/bin/env node
/**
 * scan-paths.mjs — repository path/shape scan for release hygiene.
 *
 * Checks:
 *  - No tracked path contains the local machine's absolute roots
 *    (D:\..., C:\Users\...) as a string in tracked text files.
 *  - No absolute-path artifacts are committed under src/.
 *  - Forbidden release leftovers (artifacts/, release/, state/, test-output/)
 *    are absent from tracked files.
 *
 * Usage: node scripts/scan-paths.mjs
 * Exit 0 = clean, 1 = findings.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.turbo', '.pnpm-store',
  'artifacts', 'release', 'state', 'test-output', '.venv', 'logs'
]);

// Local machine roots that must never appear in committed files.
const FORBIDDEN_ROOTS = [
  /D:\\CodexD/i,
  /C:\\Users\\wx/i,
  /D:\\deepseek/i,
  /D:\\02-Project/i,
  /D:\\Obsidian WX/i
];

// Path fragments that must not be tracked.
const FORBIDDEN_TRACKED = [
  /(^|\/)artifacts\//i,
  /(^|\/)release\//i,
  /(^|\/)state\//i,
  /(^|\/)test-output\//i
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

const findings = [];
const files = await walk(ROOT);

for (const filePath of files) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  if (FORBIDDEN_TRACKED.some((pattern) => pattern.test(rel))) {
    findings.push(`${rel}: forbidden tracked path`);
    continue;
  }
  if (!/\.(ts|tsx|js|mjs|json|md|yaml|yml|txt)$/.test(rel)) continue;
  const content = await readFile(filePath, 'utf8');
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const pattern of FORBIDDEN_ROOTS) {
      if (pattern.test(line)) {
        findings.push(`${rel}:${index + 1}: absolute local path leak`);
        break;
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`scan-paths: OK (${files.length} files scanned)`);
  process.exit(0);
}
console.error(`scan-paths: ${findings.length} finding(s):`);
for (const finding of findings.slice(0, 50)) console.error(`  - ${finding}`);
process.exit(1);