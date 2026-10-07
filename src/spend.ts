'use strict';

// Client and parser for `GET /api/usage`, which ollama.com documents as spend
// statistics rather than quota (see docs/adr/0004) — the endpoint used to carry
// the quota windows, which is why this extension stopped reading it for them.
//
// Decorative: a failure here must never degrade the quota indicator, so callers
// treat spend as optional and swallow its errors.

import { Fetched, RawResponse, RequestError, getJson } from './http';
import { describe, readField, readObject, toDate, toNumber } from './json';

const USAGE_URL = 'https://ollama.com/api/usage';

export interface Spend {
  usd: number;
  /** The window the API summed over, e.g. `7d`. */
  range?: string;
  from?: Date;
  until?: Date;
}

export interface SpendSnapshot {
  spend: Spend;
  raw: RawResponse;
  fetchedAt: Date;
}

export async function fetchSpend(apiKey: string): Promise<SpendSnapshot> {
  const { body, raw }: Fetched = await getJson(USAGE_URL, apiKey);
  return { spend: parseSpend(body, raw), raw, fetchedAt: new Date() };
}

export function parseSpend(body: unknown, raw?: RawResponse): Spend {
  const totals = readObject(body, 'totals');
  if (!totals) {
    const keys = body !== null && typeof body === 'object' ? Object.keys(body as Record<string, unknown>) : [];
    throw new RequestError(
      'parse',
      `Usage response has no \`totals\` object; top-level keys: ${keys.length === 0 ? 'none' : keys.map((k) => `\`${k}\``).join(', ')}.`,
      { raw },
    );
  }
  const usd = toNumber(readField(totals, 'usage_usd'));
  if (usd === undefined) {
    throw new RequestError(
      'parse',
      `\`totals.usage_usd\` is ${describe(readField(totals, 'usage_usd'))}, expected a number.`,
      { raw },
    );
  }
  const range = readField(body, 'range');
  return {
    usd,
    range: typeof range === 'string' ? range : undefined,
    from: toDate(readField(body, 'from')),
    until: toDate(readField(body, 'until')),
  };
}
