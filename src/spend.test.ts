'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestError } from './http';
import { parseSpend } from './spend';

const USAGE_BODY = {
  range: '7d',
  scope: 'self',
  granularity: 'day',
  from: '2026-09-30T00:00:00Z',
  until: '2026-10-07T20:27:08Z',
  totals: { request_count: 4846, usage_usd: 16.80911, input_tokens: 442218472 },
  buckets: [{ from: '2026-09-30T00:00:00Z', until: '2026-10-01T00:00:00Z', usage_usd: 3.16299 }],
};

test('spend: totals.usage_usd is read along with the range label', () => {
  const spend = parseSpend(USAGE_BODY);
  assert.equal(spend.usd, 16.80911);
  assert.equal(spend.range, '7d');
  assert.equal(spend.from?.toISOString(), '2026-09-30T00:00:00.000Z');
});

test('spend: a response with no totals names the keys it did see', () => {
  assert.throws(
    () => parseSpend({ buckets: [] }),
    (err: unknown) => {
      assert.ok(err instanceof RequestError);
      assert.match(err.message, /`buckets`/);
      return true;
    },
  );
});

test('spend: an absent usage_usd is named rather than read as zero', () => {
  assert.throws(
    () => parseSpend({ totals: { request_count: 12 } }),
    (err: unknown) => {
      assert.match((err as Error).message, /totals\.usage_usd/);
      assert.match((err as Error).message, /absent/);
      return true;
    },
  );
});
