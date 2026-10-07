'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestError } from './http';
import { parseBalance, primaryWindow, remainingUsd, usedFraction } from './quota';

// The money branch, as `docs/ollama.com/api/balance` documents it for new plans.
const CREDITS_BODY = {
  included: {
    balance_usd: 72.5,
    allowance_usd: 100,
    period: { from: '2026-09-15T09:30:00Z', until: '2026-10-15T09:30:00Z' },
  },
  purchased: { balance_usd: 25 },
};

// The legacy branch. Note it carries `purchased` too, and no `balance_usd`
// under `included` — the field that decides which branch we are on.
const PERCENT_BODY = {
  included: {
    session: { remaining_percent: 75, resets_at: '2026-10-01T07:00:00Z' },
    weekly: { remaining_percent: 40, resets_at: '2026-10-05T00:00:00Z' },
  },
  purchased: { balance_usd: 25 },
};

function creditsFrom(body: unknown) {
  const quota = parseBalance(body);
  assert.equal(quota.kind, 'credits');
  return quota as Extract<typeof quota, { kind: 'credits' }>;
}

test('credits branch: the remaining amount is included plus purchased', () => {
  const quota = creditsFrom(CREDITS_BODY);
  assert.equal(remainingUsd(quota), 97.5);
  assert.equal(quota.periodEnd?.toISOString(), '2026-10-15T09:30:00.000Z');
});

test('credits branch: the plan share drives the colour, not the top-ups', () => {
  // 72.5 left of a 100 allowance is 27.5% used, even though $25 was bought on top.
  assert.equal(usedFraction(creditsFrom(CREDITS_BODY)), 0.275);
});

test('legacy branch: remaining_percent counts what is left, so `used` is inverted', () => {
  const quota = parseBalance(PERCENT_BODY);
  assert.ok(quota.kind === 'percent');
  const weekly = quota.windows.find((window) => window.name === 'weekly');
  const session = quota.windows.find((window) => window.name === 'session');
  assert.equal(weekly?.used, 0.6); // 40% left => 60% used
  assert.equal(session?.used, 0.25); // 75% left => 25% used
  assert.equal(weekly?.resetsAt?.toISOString(), '2026-10-05T00:00:00.000Z');
});

test('legacy branch: a purchased balance does not hijack the money branch', () => {
  assert.equal(parseBalance(PERCENT_BODY).kind, 'percent');
});

test('legacy branch: without a monthly window the status bar falls back to weekly', () => {
  const quota = parseBalance(PERCENT_BODY);
  assert.ok(quota.kind === 'percent');
  assert.equal(primaryWindow(quota.windows)?.name, 'weekly');
});

test('numbers sent as strings are accepted', () => {
  assert.equal(remainingUsd(creditsFrom({ included: { balance_usd: '72.5', allowance_usd: '100' } })), 72.5);
});

test('a plan with no allowance yields no colour basis rather than a wrong one', () => {
  assert.equal(usedFraction(parseBalance({ included: { balance_usd: 0, allowance_usd: 0 } })), undefined);
});

test('an unusable balance_usd is named, not silently dropped', () => {
  assert.throws(
    () => parseBalance({ included: { balance_usd: null, allowance_usd: 100 } }),
    (err: unknown) => {
      assert.ok(err instanceof RequestError);
      assert.equal(err.kind, 'parse');
      assert.match(err.message, /included\.balance_usd/);
      assert.match(err.message, /null/);
      return true;
    },
  );
});

test('a missing `included` names the top-level keys it did see', () => {
  // This is the shape that produced "no usage windows" before ADR-0004.
  assert.throws(
    () => parseBalance({ limits: { monthly: { usage: 0.12 } } }),
    (err: unknown) => {
      assert.match((err as Error).message, /`limits`/);
      return true;
    },
  );
});

test('a window still carrying the retired `usage` field says exactly that', () => {
  assert.throws(
    () => parseBalance({ included: { monthly: { usage: 0.12 } } }),
    (err: unknown) => {
      assert.match((err as Error).message, /no `remaining_percent`/);
      assert.match((err as Error).message, /`usage`/);
      return true;
    },
  );
});

test('a remaining_percent outside 0..100 is named with its value', () => {
  assert.throws(
    () => parseBalance({ included: { session: { remaining_percent: 150 } } }),
    (err: unknown) => {
      assert.match((err as Error).message, /session/);
      assert.match((err as Error).message, /150/);
      return true;
    },
  );
});
