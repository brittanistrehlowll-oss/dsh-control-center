/**
 * security — redaction, sensitive-value detection, and safe logging helpers.
 *
 * Shared by snapshot-store (assertSafeSurfaceSnapshot), quota/session paths,
 * and the supervisor's log pipeline. The rules here mirror the V1.1 invariant:
 * prompts, assistant bodies, tool arguments, shell commands, file contents,
 * credentials, cookies and raw upstream responses must never be persisted or
 * forwarded to the renderer.
 */

export const SENSITIVE_KEY_PATTERN =
  /prompt|assistant|tool|argument|shell|command|transcript|raw.?response|session.?log|cookie|authorization|api[-_ ]?key|secret|credential|password|token|private.?key|access.?key/i;

export const REDACTED = '<REDACTED>';

/** Well-known secret prefixes (GitHub PAT, AWS, OpenAI-style sk-…). */
const SECRET_PREFIX_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

/** Generic assignment of a long opaque value to a sensitive-looking key. */
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:api[_-]?key|secret|token|password|passwd|credential|authorization)\s*[=:]\s*['"]?[A-Za-z0-9_\-./+=]{16,}['"]?/i;

export interface RedactionPolicy {
  /** Keys matched by this pattern are replaced by {@link REDACTED}. */
  keyPattern?: RegExp;
  /** If true, value-level secret scanning is applied instead of key-level. */
  scanValues?: boolean;
}

const DEFAULT_POLICY: Required<RedactionPolicy> = {
  keyPattern: SENSITIVE_KEY_PATTERN,
  scanValues: true
};

export function looksLikeSecret(value: string): boolean {
  return SECRET_PREFIX_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep-redact a plain-JSON value: keys matching the policy are replaced with
 * the redaction marker; when scanValues is on, string values that look like
 * secrets are also replaced. Arrays and nested objects are walked.
 */
export function redact(value: unknown, policy: RedactionPolicy = {}): unknown {
  const merged: Required<RedactionPolicy> = {
    keyPattern: policy.keyPattern ?? DEFAULT_POLICY.keyPattern,
    scanValues: policy.scanValues ?? DEFAULT_POLICY.scanValues
  };
  return walk(value, merged, 'root');
}

function walk(value: unknown, policy: Required<RedactionPolicy>, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => walk(item, policy, `${path}[${index}]`));
  }
  if (typeof value === 'string') {
    if (policy.scanValues && looksLikeSecret(value)) return REDACTED;
    return value;
  }
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (policy.keyPattern.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = walk(child, policy, nextPath);
  }
  return out;
}

/** Redact a log line: replaces secret-like tokens, keeps structure. */
export function redactLogLine(line: string): string {
  return line
    .replace(SECRET_PREFIX_PATTERN, REDACTED)
    .replace(SECRET_ASSIGNMENT_PATTERN, `${REDACTED}`)
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`);
}

export class UnsafeContentError extends Error {
  constructor(path: string) {
    super(`Unsafe content refused at ${path}`);
    this.name = 'UnsafeContentError';
  }
}

/**
 * Assert a plain-JSON value carries no sensitive keys (key-name based).
 * Throws {@link UnsafeContentError} on the first match.
 */
export function assertNoSensitiveKeys(value: unknown): void {
  walkForCheck(value, 'root');
}

function walkForCheck(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForCheck(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (isSensitiveKey(key)) throw new UnsafeContentError(nextPath);
    walkForCheck(child, nextPath);
  }
}