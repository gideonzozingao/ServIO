/**
 * Servio server runtime utilities (src/common/utils/server.utils.ts)
 *
 * Pure helpers for turning raw environment strings into safe, typed runtime
 * settings, plus small operational helpers (retry, timeouts, redaction, client IP).
 *
 *  - Env vars are ALWAYS strings: parse explicitly, fail fast with a clear message.
 *  - Security-sensitive parsers (trusted proxies, CORS origins) REJECT dangerous
 *    values instead of silently accepting them.
 *  - No dependencies beyond Node built-ins.
 *
 * Throws ServerConfigError for bad configuration (surface it at startup).
 */

import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

// ── Errors ───────────────────────────────────────────────────────────────────

export class ServerConfigError extends Error {
  constructor(
    message: string,
    readonly variable?: string,
  ) {
    super(variable ? `${variable}: ${message}` : message);
    this.name = 'ServerConfigError';
  }
}

export class TimeoutError extends Error {
  constructor(
    label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** "a, b,,c" → ["a","b","c"]. */
export function parseCsv(
  raw: string | undefined | null,
  opts: { unique?: boolean } = {},
): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return opts.unique ? [...new Set(items)] : items;
}

// ── Scalars ──────────────────────────────────────────────────────────────────

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off', 'disabled']);

/** Never use Boolean("false") for env flags: it is true. */
export function parseBoolean(
  raw: string | undefined | null,
  opts: { name?: string; fallback?: boolean } = {},
): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new ServerConfigError('is required (true/false)', opts.name);
  }
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new ServerConfigError(
    `"${raw}" is not a boolean (use true/false)`,
    opts.name,
  );
}

export function parseInteger(
  raw: string | undefined | null,
  opts: { name?: string; min?: number; max?: number; fallback?: number } = {},
): number {
  const value = raw?.trim();
  if (value === undefined || value === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new ServerConfigError('is required (integer)', opts.name);
  }
  if (!/^-?\d+$/.test(value))
    throw new ServerConfigError(`"${raw}" is not an integer`, opts.name);
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new ServerConfigError(`"${raw}" is out of range`, opts.name);
  if (opts.min !== undefined && n < opts.min)
    throw new ServerConfigError(`must be >= ${opts.min}`, opts.name);
  if (opts.max !== undefined && n > opts.max)
    throw new ServerConfigError(`must be <= ${opts.max}`, opts.name);
  return n;
}

export function parsePort(
  raw: string | undefined | null,
  opts: { name?: string; fallback?: number } = {},
): number {
  return parseInteger(raw, {
    name: opts.name ?? 'PORT',
    min: 1,
    max: 65535,
    fallback: opts.fallback,
  });
}

export function parseEnum<T extends string>(
  raw: string | undefined | null,
  allowed: readonly T[],
  opts: { name?: string; fallback?: T } = {},
): T {
  const value = raw?.trim();
  if (value === undefined || value === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new ServerConfigError(
      `is required (one of: ${allowed.join(', ')})`,
      opts.name,
    );
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ServerConfigError(
      `"${raw}" is invalid (one of: ${allowed.join(', ')})`,
      opts.name,
    );
  }
  return value as T;
}

const DURATION_UNITS_MS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

/** "500ms" | "30s" | "15m" | "12h" | "7d" | "1500" (ms) → milliseconds. */
export function parseDuration(
  raw: string | undefined | null,
  opts: { name?: string; fallbackMs?: number } = {},
): number {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') {
    if (opts.fallbackMs !== undefined) return opts.fallbackMs;
    throw new ServerConfigError(
      'is required (duration like 30s, 15m, 12h)',
      opts.name,
    );
  }
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(value);
  if (!m)
    throw new ServerConfigError(
      `"${raw}" is not a duration (use 500ms, 30s, 15m, 12h, 7d)`,
      opts.name,
    );
  return Math.round(
    Number(m[1]) *
      DURATION_UNITS_MS[(m[2] ?? 'ms') as keyof typeof DURATION_UNITS_MS],
  );
}

const BYTE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 } as const;

/** "512kb" | "10mb" | "1gb" | "2048" (bytes) → bytes. */
export function parseBytes(
  raw: string | undefined | null,
  opts: { name?: string; fallback?: number } = {},
): number {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new ServerConfigError(
      'is required (size like 512kb, 10mb)',
      opts.name,
    );
  }
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/.exec(value);
  if (!m)
    throw new ServerConfigError(
      `"${raw}" is not a size (use 512kb, 10mb, 1gb)`,
      opts.name,
    );
  return Math.round(
    Number(m[1]) * BYTE_UNITS[(m[2] ?? 'b') as keyof typeof BYTE_UNITS],
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

// ── URLs ─────────────────────────────────────────────────────────────────────

/** Validates a URL env var and returns it without a trailing slash (default). */
export function parseUrl(
  raw: string | undefined | null,
  opts: {
    name?: string;
    protocols?: readonly string[];
    stripTrailingSlash?: boolean;
  } = {},
): string {
  const { protocols = ['http:', 'https:'], stripTrailingSlash = true } = opts;
  const value = raw?.trim();
  if (!value) throw new ServerConfigError('is required (URL)', opts.name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServerConfigError(`"${raw}" is not a valid URL`, opts.name);
  }
  if (!protocols.includes(url.protocol)) {
    throw new ServerConfigError(
      `protocol must be one of: ${protocols.join(', ')}`,
      opts.name,
    );
  }
  return stripTrailingSlash ? value.replace(/\/+$/, '') : value;
}

/** joinUrl("https://x.com/", "/a", "b/") → "https://x.com/a/b". */
export function joinUrl(base: string, ...parts: string[]): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const path = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return path ? `${trimmedBase}/${path}` : trimmedBase;
}

// ── Trusted proxies (Express `trust proxy`) ──────────────────────────────────

/** What Express accepts for `app.set('trust proxy', …)`. `false` = trust nothing. */
export type TrustProxySetting = false | number | string[];

const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MAX_PROXY_HOPS = 10;

function isCidr(entry: string): boolean {
  const parts = entry.split('/');
  if (parts.length !== 2) return false;
  const [ip, prefixText] = parts;
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  const family = isIP(ip);
  if (family === 4) return prefix >= 1 && prefix <= 32; // /0 would trust the whole internet
  if (family === 6) return prefix >= 1 && prefix <= 128;
  return false;
}

/**
 * TRUSTED_PROXIES → Express setting.
 *   ""                       → false      (no proxy in front, e.g. local dev)
 *   "1" / "2"                → hop count  (number of proxies in front of the app)
 *   "loopback,10.0.0.0/16"   → list of keywords / IPs / CIDRs
 * Rejects "true", "*", and /0 ranges: they let any client spoof its IP via X-Forwarded-For.
 */
export function parseTrustedProxies(
  raw: string | undefined | null,
  name = 'TRUSTED_PROXIES',
): TrustProxySetting {
  const value = raw?.trim() ?? '';
  if (value === '') return false;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops === 0) return false;
    if (hops > MAX_PROXY_HOPS)
      throw new ServerConfigError(
        `hop count must be between 1 and ${MAX_PROXY_HOPS}`,
        name,
      );
    return hops;
  }

  const entries = parseCsv(value, { unique: true }).map((e) =>
    PROXY_KEYWORDS.has(e.toLowerCase()) ? e.toLowerCase() : e,
  );
  for (const entry of entries) {
    if (PROXY_KEYWORDS.has(entry) || isIP(entry) !== 0 || isCidr(entry))
      continue;
    const hint = /^(true|\*|all)$/i.test(entry)
      ? ' (trusting every proxy lets clients spoof their IP; list your proxies or use a hop count)'
      : ' (expected a hop count, loopback/linklocal/uniquelocal, an IP, or a CIDR such as 10.0.0.0/16)';
    throw new ServerConfigError(`invalid entry "${entry}"${hint}`, name);
  }
  return entries;
}

// ── CORS ─────────────────────────────────────────────────────────────────────

/** Canonical origin: lowercase scheme/host, default ports dropped, no path or trailing slash. */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * CORS_ORIGINS → list of canonical origins.
 * Rejects "*" (credentialed requests need explicit origins), non-http(s) schemes, and entries with a path.
 */
export function parseCorsOrigins(
  raw: string | undefined | null,
  name = 'CORS_ORIGINS',
): string[] {
  const out: string[] = [];
  for (const entry of parseCsv(raw)) {
    if (entry === '*')
      throw new ServerConfigError(
        'wildcard "*" is not allowed with credentials; list explicit origins',
        name,
      );
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new ServerConfigError(
        `"${entry}" is not a valid origin (example: https://app.example.com)`,
        name,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ServerConfigError(`"${entry}" must use http or https`, name);
    }
    if (
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new ServerConfigError(
        `"${entry}" must be an origin only (no path, query, or credentials)`,
        name,
      );
    }
    out.push(url.origin);
  }
  return [...new Set(out)];
}

export function isOriginAllowed(
  origin: string | undefined | null,
  allowed: readonly string[],
): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowed.includes(normalized);
}

/**
 * Callback for Nest/Express `cors({ origin })`.
 * Requests without an Origin header (mobile apps, curl, server-to-server) are allowed by default,
 * because CORS only constrains browsers; authentication still applies.
 */
export function createCorsOriginCheck(
  allowed: readonly string[],
  opts: { allowNoOrigin?: boolean } = {},
) {
  const { allowNoOrigin = true } = opts;
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    if (!origin) return callback(null, allowNoOrigin);
    callback(null, isOriginAllowed(origin, allowed));
  };
}

// ── Redaction (logs, startup banners, error reports) ─────────────────────────

const SECRET_KEY_RE =
  /(SECRET|PASSWORD|PASSWD|TOKEN|PEPPER|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL)/i;
const URL_LIKE_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function maskSecret(value: string, visibleTail = 0): string {
  if (visibleTail <= 0 || value.length <= visibleTail * 2) return '***';
  return `***${value.slice(-visibleTail)}`;
}

/** postgresql://user:pass@host/db → postgresql://user:***@host/db (username kept, password hidden). */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return raw.replace(/(\/\/[^/:@\s]+:)[^@\s]*@/, '$1***@');
  }
}

/** Copy of an env map that is safe to log. Secret-looking keys are masked, URL credentials are hidden. */
export function redactEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) out[key] = undefined;
    else if (URL_LIKE_RE.test(value)) out[key] = redactUrl(value);
    else if (SECRET_KEY_RE.test(key)) out[key] = maskSecret(value);
    else out[key] = value;
  }
  return out;
}

// ── Environment ──────────────────────────────────────────────────────────────

export type NodeEnv = 'development' | 'test' | 'production';

export function parseNodeEnv(
  raw: string | undefined | null = process.env.NODE_ENV,
): NodeEnv {
  return parseEnum(raw, ['development', 'test', 'production'] as const, {
    name: 'NODE_ENV',
    fallback: 'development',
  });
}

export function isProduction(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === 'production';
}

// ── Client IP and request id ─────────────────────────────────────────────────

/** Valid IP in canonical form (IPv4-mapped IPv6 "::ffff:1.2.3.4" → "1.2.3.4"), else undefined. */
export function normalizeIp(
  raw: string | undefined | null,
): string | undefined {
  let value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4)
    value = value.slice(7);
  return isIP(value) !== 0 ? value : undefined;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function firstHeader(
  headers: HeaderBag | undefined,
  name: string,
): string | undefined {
  const v = headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Client IP for rate limiting, audit logs and sessions.
 *  1. `ip`: Express req.ip, already computed through the `trust proxy` setting (preferred).
 *  2. `x-real-ip`: only when trustHeaders is true (your proxy overwrites it; never enable without one).
 *  3. The raw socket address.
 * For Socket.IO pass handshake.headers and handshake.address.
 */
export function getClientIp(
  input: { ip?: string; headers?: HeaderBag; remoteAddress?: string },
  opts: { trustHeaders?: boolean } = {},
): string {
  const fromIp = normalizeIp(input.ip);
  if (fromIp) return fromIp;
  if (opts.trustHeaders) {
    const real = normalizeIp(firstHeader(input.headers, 'x-real-ip'));
    if (real) return real;
  }
  return normalizeIp(input.remoteAddress) ?? 'unknown';
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** Accepts a sane incoming X-Request-Id, otherwise generates one (prevents log injection). */
export function normalizeRequestId(
  incoming: string | string[] | undefined | null,
): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && REQUEST_ID_RE.test(value) ? value : randomUUID();
}

// ── Async helpers (startup dependencies, health checks) ──────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with TimeoutError if `promise` does not settle in time. The underlying work is not cancelled. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  /** Retries after the first attempt (default 5, so up to 6 attempts). */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** Randomise each delay to 50–100% to avoid thundering herds (default true). */
  jitter?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests. */
  random?: () => number;
}

/** Exponential backoff. Use for connecting to Postgres/Redis at startup. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    retries = 5,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    factor = 2,
    jitter = true,
    shouldRetry,
    onRetry,
    random = Math.random,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || (shouldRetry && !shouldRetry(error, attempt)))
        throw error;
      const raw = Math.min(maxDelayMs, baseDelayMs * factor ** attempt);
      const delay = Math.round(jitter ? raw * (0.5 + random() * 0.5) : raw);
      onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

/** Polls `check` until it returns true (or throws TimeoutError). */
export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const { timeoutMs = 10_000, intervalMs = 100, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new TimeoutError(label, timeoutMs);
    await sleep(intervalMs);
  }
}

// ── Runtime info (health and diagnostics) ────────────────────────────────────

export interface RuntimeInfo {
  node: string;
  pid: number;
  platform: string;
  uptimeSeconds: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
}

export function getRuntimeInfo(): RuntimeInfo {
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
  return {
    node: process.version,
    pid: process.pid,
    platform: process.platform,
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: mb(mem.rss),
    heapUsedMb: mb(mem.heapUsed),
    heapTotalMb: mb(mem.heapTotal),
  };
}

export function safeJsonParse<T>(
  text: string | undefined | null,
  fallback: T,
): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
