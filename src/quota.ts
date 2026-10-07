'use strict';

// Client and defensive parser for `GET /api/balance` — the documented source of
// the account's remaining credits (see docs/adr/0004).
//
// The response is a `oneOf` of two mutually exclusive branches: money (new
// plans) and remaining percentages (legacy plans). Both are normalised into the
// domain unit — `used`, the 0..1 fraction of the quota spent — exactly once,
// here, at the wire boundary. Nothing downstream ever sees a wire value
// (see docs/adr/0003).

import { Fetched, RawResponse, RequestError, getJson } from './http';
import { clamp01, describe, formatKeys, readField, readObject, toDate, toNumber } from './json';

const BALANCE_URL = 'https://ollama.com/api/balance';

export type WindowName = 'monthly' | 'weekly' | 'session';

export const WINDOW_ORDER: ReadonlyArray<WindowName> = ['monthly', 'weekly', 'session'];

export interface QuotaWindow {
  name: WindowName;
  /** Fraction of the window already used, 0..1. */
  used: number;
  resetsAt?: Date;
}

/** Money branch: what the account can still spend, against the plan's allowance. */
export interface CreditsQuota {
  kind: 'credits';
  /** Remaining credits included in the plan. */
  includedUsd: number;
  /** Remaining credits bought on top of the plan; only unexpired ones count. */
  purchasedUsd: number;
  /** The plan's allowance for the period — the denominator of `usedFraction`. */
  allowanceUsd?: number;
  periodEnd?: Date;
}

/** Legacy branch: the plan exposes windows of remaining share instead of money. */
export interface PercentQuota {
  kind: 'percent';
  windows: QuotaWindow[];
}

export type Quota = CreditsQuota | PercentQuota;

export interface QuotaSnapshot {
  quota: Quota;
  raw: RawResponse;
  fetchedAt: Date;
}

export async function fetchQuota(apiKey: string): Promise<QuotaSnapshot> {
  const { body, raw }: Fetched = await getJson(BALANCE_URL, apiKey);
  return { quota: parseBalance(body, raw), raw, fetchedAt: new Date() };
}

/**
 * Fraction of the quota spent, 0..1 — the single number every threshold and
 * colour is computed from. Undefined when the response carries no basis for it
 * (a plan with no allowance), in which case the item is simply not coloured.
 */
export function usedFraction(quota: Quota): number | undefined {
  if (quota.kind === 'percent') {
    return primaryWindow(quota.windows)?.used;
  }
  const { includedUsd, allowanceUsd } = quota;
  if (allowanceUsd === undefined || allowanceUsd <= 0) return undefined;
  // Deliberately the *plan's* share only: purchased credits extend what can be
  // spent, but they are not part of the allowance, and counting them here would
  // keep the red threshold from ever firing for someone who bought top-ups
  // (see docs/adr/0003).
  return clamp01(1 - includedUsd / allowanceUsd);
}

/** Credits left in dollars: included plus unexpired purchased (see docs/adr/0003). */
export function remainingUsd(quota: CreditsQuota): number {
  return quota.includedUsd + quota.purchasedUsd;
}

/** The window shown in the status bar: the first of monthly/weekly/session present. */
export function primaryWindow(windows: readonly QuotaWindow[]): QuotaWindow | undefined {
  for (const name of WINDOW_ORDER) {
    const found = windows.find((window) => window.name === name);
    if (found) return found;
  }
  return undefined;
}

export function parseBalance(body: unknown, raw?: RawResponse): Quota {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('parse', `Balance response is not a JSON object, it is ${describe(body)}.`, { raw });
  }

  const included = readObject(body, 'included');
  if (!included) {
    const keys = Object.keys(body as Record<string, unknown>);
    throw new RequestError(
      'parse',
      `Balance response has no \`included\` object; top-level keys: ${formatKeys(keys)}.`,
      { raw },
    );
  }

  const credits = parseCredits(included, body, raw);
  if (credits) return credits;

  const windows = parsePercentWindows(included);
  if (windows.length > 0) return { kind: 'percent', windows };

  throw new RequestError('parse', describeUnusable(included), { raw });
}

function parseCredits(
  included: Record<string, unknown>,
  body: unknown,
  raw?: RawResponse,
): CreditsQuota | undefined {
  const wireIncluded = readField(included, 'balance_usd');
  if (wireIncluded === undefined) return undefined; // not the money branch

  const includedUsd = toNumber(wireIncluded);
  if (includedUsd === undefined) {
    throw new RequestError(
      'parse',
      `\`included.balance_usd\` is ${describe(wireIncluded)}, expected a number.`,
      { raw },
    );
  }

  return {
    kind: 'credits',
    includedUsd,
    purchasedUsd: toNumber(readField(readObject(body, 'purchased'), 'balance_usd')) ?? 0,
    allowanceUsd: toNumber(readField(included, 'allowance_usd')),
    periodEnd: toDate(readField(readObject(included, 'period'), 'until')),
  };
}

/** `remaining_percent` counts what is *left*, so the polarity flips here. */
function parsePercentWindows(included: Record<string, unknown>): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  for (const name of WINDOW_ORDER) {
    const entry = readObject(included, name);
    if (!entry) continue;
    const remainingPercent = toNumber(readField(entry, 'remaining_percent'));
    if (remainingPercent === undefined || remainingPercent < 0 || remainingPercent > 100) continue;
    windows.push({
      name,
      used: clamp01(1 - remainingPercent / 100),
      resetsAt: toDate(readField(entry, 'resets_at')),
    });
  }
  return windows;
}

/** Says what was actually found, so a shape change is a diagnosis and not a riddle. */
function describeUnusable(included: Record<string, unknown>): string {
  const present = WINDOW_ORDER.filter((name) => readObject(included, name) !== undefined);
  if (present.length === 0) {
    return (
      'Balance response carries neither credits (`included.balance_usd`) nor usage windows; ' +
      `\`included\` keys: ${formatKeys(Object.keys(included))}.`
    );
  }
  const reasons = present.map((name) => {
    const entry = readObject(included, name)!;
    const value = readField(entry, 'remaining_percent');
    return value === undefined
      ? `${name}: no \`remaining_percent\` (keys: ${formatKeys(Object.keys(entry))})`
      : `${name}: \`remaining_percent\` is ${describe(value)}, expected 0..100`;
  });
  return `Balance response has usage windows, but none usable — ${reasons.join('; ')}.`;
}
