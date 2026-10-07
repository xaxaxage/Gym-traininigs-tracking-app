import { useEffect, useState } from 'preact/hooks';

/**
 * A log of every request this device sends to an AI provider, and what the
 * providers told us about their limits. Only on this device: it's for seeing
 * where requests go, not part of the training log.
 */

export const USAGE_KEY = 'gym-tracker:ai-usage';
const KEEP_DAYS = 30;
const MAX_RECORDS = 3000;

export type UsageKind = 'exercise' | 'models';

export type UsageOutcome =
  | 'ok'
  /** Google's per-minute limit (requests or tokens). */
  | 'minute-limit'
  /** Google's daily limit. */
  | 'day-limit'
  /** A limit without details, or Anthropic's rate limit. */
  | 'limit'
  | 'busy'
  | 'failed'
  | 'cancelled';

export interface UsageRecord {
  at: number;
  /** Requests made for the same estimate share this. */
  op: string;
  provider: 'gemini' | 'claude';
  model: string;
  kind: UsageKind;
  outcome: UsageOutcome;
  /** How long the request took. */
  ms: number;
  tokensIn?: number;
  /** Output tokens, thinking included. */
  tokensOut?: number;
  /**
   * The model that actually answered, when Google says: "gemini-flash-latest"
   * is a name for whichever Flash is newest, and its requests count toward
   * that model's limits.
   */
  served?: string;
  /** What the provider said when it failed, e.g. "503 · This model is currently experiencing high demand…". */
  error?: string;
}

export interface ModelLimits {
  /** Requests per day, as Google last reported it. */
  perDay?: number;
  perMinute?: number;
  /** Google said the daily limit is used up; skip the model until then. */
  dayUsedUpUntil?: number;
  /** Google said the model is overloaded: rest it until then, so requests go where they get answers. */
  restUntil?: number;
  /** Overloaded replies in a row, for resting longer each time. */
  busyStreak?: number;
}

interface UsageData {
  records: UsageRecord[];
  limits: Record<string, ModelLimits>;
  /** Alias → the model it pointed to last time ("gemini-flash-latest" → "gemini-3.8-flash"). */
  aliases: Record<string, string>;
}

function load(): UsageData {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null');
    if (raw && Array.isArray(raw.records)) {
      const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      return { records: raw.records, limits: obj(raw.limits) as UsageData['limits'], aliases: obj(raw.aliases) as UsageData['aliases'] };
    }
  } catch {
    // unreadable: start over
  }
  return { records: [], limits: {}, aliases: {} };
}

let data: UsageData = load();
const listeners = new Set<() => void>();

function save() {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  data.records = data.records.filter((r) => r.at >= cutoff).slice(-MAX_RECORDS);
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full: the log is a convenience, the training log matters more.
  }
  listeners.forEach((l) => l());
}

export function usageRecords(): UsageRecord[] {
  return data.records;
}

export function modelLimits(model: string): ModelLimits {
  return data.limits[model] ?? {};
}

export function allLimits(): Record<string, ModelLimits> {
  return data.limits;
}

export function recordUsage(record: UsageRecord) {
  data = { ...data, records: [...data.records, record] };
  save();
}

export function clearUsage() {
  data = { records: [], limits: data.limits, aliases: data.aliases };
  save();
}

/** Remember which model an alias pointed to. */
export function noteServed(requested: string, served: string | undefined) {
  if (!served || served === requested || data.aliases[requested] === served) return;
  data = { ...data, aliases: { ...data.aliases, [requested]: served } };
  save();
}

/** The model whose limits a request counts toward: an alias resolved to the model it last pointed to. */
export function realModel(id: string): string {
  return data.aliases[id] ?? id;
}

/**
 * Free-tier limits as Google AI Studio showed them for free keys in September
 * 2026 (Flash: 5 a minute, 20 a day; Flash-Lite: 15 a minute, 500 a day).
 * Google changes these and keys with billing get more, so they're only shown,
 * never enforced; a limit Google reports in a "limit reached" reply wins.
 */
export function freeTierLimits(model: string): { perMinute: number; perDay: number } | undefined {
  const id = model.toLowerCase();
  if (!id.startsWith('gemini-') || id.includes('pro')) return undefined;
  if (id.includes('lite')) return { perMinute: 15, perDay: 500 };
  if (id.includes('flash')) return { perMinute: 5, perDay: 20 };
  return undefined;
}

/** The limits to show for a model: what Google reported, else the usual free-tier ones. */
export function limitsFor(model: string): { perMinute?: number; perDay?: number; reported: boolean } {
  const real = realModel(model);
  const learned = { ...data.limits[model], ...data.limits[real] };
  const free = freeTierLimits(real) ?? freeTierLimits(model);
  return {
    perMinute: learned.perMinute ?? free?.perMinute,
    perDay: learned.perDay ?? free?.perDay,
    reported: learned.perMinute !== undefined || learned.perDay !== undefined,
  };
}

/**
 * Whether Google counted a request toward its limits: it was answered, or turned away as overloaded (developers
 * report those count too — September 2026). One turned away at a limit isn't counted.
 */
export const countedByGoogle = (r: UsageRecord) =>
  r.provider === 'gemini' && r.kind !== 'models' && (r.outcome === 'ok' || r.outcome === 'busy' || r.tokensIn !== undefined);

const REST_FIRST = 5 * 60_000;
const REST_MAX = 30 * 60_000;

/**
 * Google said the model is overloaded. Rest it — 5 minutes, then 10, 20, up to 30 while it keeps saying so —
 * so estimates go to a model that answers instead of spending the day's requests on failures.
 */
export function noteBusy(model: string, now = Date.now()) {
  const cur = data.limits[model] ?? {};
  const streak = (cur.busyStreak ?? 0) + 1;
  const rest = Math.min(REST_MAX, REST_FIRST * 2 ** (streak - 1));
  data = { ...data, limits: { ...data.limits, [model]: { ...cur, busyStreak: streak, restUntil: now + rest } } };
  save();
}

/** The model answered: no more resting. */
export function noteAnswered(model: string) {
  const cur = data.limits[model];
  if (!cur?.busyStreak && !cur?.restUntil) return;
  const { busyStreak: _s, restUntil: _r, ...rest } = cur;
  data = { ...data, limits: { ...data.limits, [model]: rest } };
  save();
}

/** True while an overloaded model is resting (for an alias: the model behind it). */
export function resting(model: string, now = Date.now()): boolean {
  return Math.max(data.limits[model]?.restUntil ?? 0, data.limits[realModel(model)]?.restUntil ?? 0) > now;
}

/** When a resting model will be tried again. */
export function restUntil(model: string): number | undefined {
  const t = Math.max(data.limits[model]?.restUntil ?? 0, data.limits[realModel(model)]?.restUntil ?? 0);
  return t > 0 ? t : undefined;
}

/** Requests this device made to a model (aliases included) since a time. */
export function usedSince(model: string, since: number, records = data.records): number {
  const real = realModel(model);
  return records.filter((r) => r.at >= since && countedByGoogle(r) && (r.served ?? realModel(r.model)) === real).length;
}

/**
 * Before a request: whether this device has already used up a limit Google
 * reported for the model — skip it for the day, or wait for the minute to pass.
 */
export function checkBudget(model: string, now = Date.now()): { skipForDay?: boolean; waitMs?: number } {
  const real = realModel(model);
  const learned = { ...data.limits[model], ...data.limits[real] };
  if (learned.perDay && usedSince(real, pacificDayStart(now)) >= learned.perDay) return { skipForDay: true };
  if (learned.perMinute) {
    const recent = data.records
      .filter((r) => r.at > now - 60_000 && countedByGoogle(r) && (r.served ?? realModel(r.model)) === real)
      .map((r) => r.at)
      .sort((a, b) => a - b);
    if (recent.length >= learned.perMinute) return { waitMs: recent[recent.length - learned.perMinute] + 60_000 - now + 250 };
  }
  return {};
}

let opCounter = 0;
/** An id for one estimate (or model list), grouping the requests made for it. */
export function newOp(): string {
  return `${Date.now().toString(36)}-${(opCounter++).toString(36)}`;
}

/** Remember what Google said about a model's limits. */
export function noteLimit(model: string, scope: 'minute' | 'day', limit: number | undefined, now = Date.now()) {
  const cur = data.limits[model] ?? {};
  const next: ModelLimits =
    scope === 'day'
      ? { ...cur, ...(limit ? { perDay: limit } : {}), dayUsedUpUntil: nextPacificMidnight(now) }
      : { ...cur, ...(limit ? { perMinute: limit } : {}) };
  data = { ...data, limits: { ...data.limits, [model]: next } };
  save();
}

/** True while Google has said the model's daily free uses are gone (for an alias: the model it points to). */
export function dayUsedUp(model: string, now = Date.now()): boolean {
  return Math.max(data.limits[model]?.dayUsedUpUntil ?? 0, data.limits[realModel(model)]?.dayUsedUpUntil ?? 0) > now;
}

/** Try a model again before its limit resets (e.g. after turning on billing). */
export function forgetDayLimit(model: string) {
  const limits = { ...data.limits };
  for (const id of new Set([model, realModel(model)])) {
    const cur = limits[id];
    if (!cur) continue;
    const { dayUsedUpUntil: _gone, restUntil: _rest, busyStreak: _streak, ...rest } = cur;
    limits[id] = rest;
  }
  data = { ...data, limits };
  save();
}

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-render when the log changes. */
export function useUsage(): UsageData {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeUsage(() => setTick((t) => t + 1));
    return () => {
      unsubscribe();
    };
  }, []);
  return data;
}

// ── Google's day ──────────────────────────────────────────────────────────

const PACIFIC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function pacificClock(ts: number): { h: number; m: number; s: number } {
  const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return { h: Number(parts.hour), m: Number(parts.minute), s: Number(parts.second) };
}

/** When the current day began in California, where Google resets its daily limits. */
export function pacificDayStart(now = Date.now()): number {
  const { h, m, s } = pacificClock(now);
  let start = now - ((h * 60 + m) * 60 + s) * 1000 - (now % 1000);
  // On the days the clocks change, the day is 23 or 25 hours long.
  const { h: at } = pacificClock(start);
  if (at === 23) start += 3_600_000;
  else if (at === 1) start -= 3_600_000;
  return start;
}

/** When Google's daily limits reset next (midnight in California). */
export function nextPacificMidnight(now = Date.now()): number {
  return pacificDayStart(pacificDayStart(now) + 26 * 3_600_000);
}

// ── Reading Google's limit errors ─────────────────────────────────────────

/** "503 · This model is currently experiencing high demand…" from a Gemini SDK error (its message is Google's JSON). */
export function googleError(message: string, status?: number): string {
  let text = message;
  try {
    const start = message.indexOf('{');
    const body = start >= 0 ? JSON.parse(message.slice(start)) : undefined;
    if (typeof body?.error?.message === 'string') text = body.error.message;
    status ??= typeof body?.error?.code === 'number' ? body.error.code : undefined;
  } catch {
    // not JSON: use the message as it is
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 160) text = `${text.slice(0, 157)}…`;
  return status ? `${status} · ${text}` : text;
}

export interface QuotaInfo {
  scope: 'minute' | 'day' | 'unknown';
  /** The model the limit belongs to (for an alias, the model behind it). */
  model?: string;
  /** The limit's size, when Google says. */
  limit?: number;
  /** How long Google asks to wait. */
  retryAfterMs?: number;
}

const seconds = (text: unknown) => {
  const m = /([\d.]+)\s*s/.exec(String(text ?? ''));
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
};

/**
 * Google's 429 errors say which limit was hit (QuotaFailure: e.g.
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier, value 20) and how long to
 * wait (RetryInfo). The Gemini SDK puts the error's JSON in the message.
 */
export function parseGeminiQuota(message: string): QuotaInfo {
  let body: any;
  try {
    const start = message.indexOf('{');
    body = start >= 0 ? JSON.parse(message.slice(start)) : undefined;
  } catch {
    body = undefined;
  }
  const details: any[] = Array.isArray(body?.error?.details) ? body.error.details : [];
  const violation = details.find((d) => /QuotaFailure/.test(d?.['@type'] ?? ''))?.violations?.[0];
  const retry = details.find((d) => /RetryInfo/.test(d?.['@type'] ?? ''))?.retryDelay;
  const id = `${violation?.quotaId ?? ''} ${violation?.quotaMetric ?? ''}`;
  const text = String(body?.error?.message ?? message);
  const scope: QuotaInfo['scope'] = /PerDay/i.test(id) ? 'day' : /PerMinute/i.test(id) ? 'minute' : 'unknown';
  const limit = Number(violation?.quotaValue ?? /limit:\s*(\d+)/.exec(text)?.[1]);
  const retryAfterMs = seconds(retry) ?? seconds(/retry in ([\d.]+s)/i.exec(text)?.[1]);
  const model = violation?.quotaDimensions?.model;
  return {
    scope,
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

// ── Summaries for the usage screen ────────────────────────────────────────

/** Requests that count toward a provider's limits (listing models doesn't). */
export const counts = (r: UsageRecord) => r.kind !== 'models';

export interface Tally {
  requests: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

export function tally(records: UsageRecord[]): Tally {
  const t: Tally = { requests: 0, failed: 0, tokensIn: 0, tokensOut: 0 };
  for (const r of records) {
    if (!counts(r)) continue;
    t.requests++;
    if (r.outcome !== 'ok' && r.outcome !== 'cancelled') t.failed++;
    t.tokensIn += r.tokensIn ?? 0;
    t.tokensOut += r.tokensOut ?? 0;
  }
  return t;
}

export interface Operation {
  op: string;
  at: number;
  kind: UsageKind;
  requests: UsageRecord[];
}

/** Requests grouped by the estimate they were made for, newest first. */
export function operations(records: UsageRecord[], limit = 20): Operation[] {
  const byOp = new Map<string, Operation>();
  for (const r of records) {
    const op = byOp.get(r.op);
    if (op) op.requests.push(r);
    else byOp.set(r.op, { op: r.op, at: r.at, kind: r.kind, requests: [r] });
  }
  return [...byOp.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Requests per model since Google's last daily reset, most used first. */
export function perModelToday(records: UsageRecord[], now = Date.now()): { model: string; provider: UsageRecord['provider']; tally: Tally }[] {
  const since = pacificDayStart(now);
  const groups = new Map<string, UsageRecord[]>();
  for (const r of records) {
    if (r.at < since || !counts(r)) continue;
    const model = r.provider === 'gemini' ? r.served ?? realModel(r.model) : r.model;
    groups.set(model, [...(groups.get(model) ?? []), r]);
  }
  return [...groups]
    .map(([model, rs]) => ({ model, provider: rs[0].provider, tally: tally(rs) }))
    .sort((a, b) => b.tally.requests - a.tally.requests);
}

/** The most requests Google counted for a model within any 60 seconds since a time (AI Studio's "peak RPM"). */
export function peakPerMinute(model: string, since: number, records = data.records): number {
  const real = realModel(model);
  const times = records
    .filter((r) => r.at >= since && countedByGoogle(r) && (r.served ?? realModel(r.model)) === real)
    .map((r) => r.at)
    .sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= 60_000) i++;
    peak = Math.max(peak, j - i + 1);
  }
  return peak;
}
