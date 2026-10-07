'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestError, getJson, parseRetryAfter } from './http';

const SECRET = 'super-secret-key';

/** Runs `getJson` against a canned response, restoring the real fetch afterwards. */
async function withFetch(response: Response, run: (call: Promise<unknown>) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    await run(getJson('https://ollama.com/api/balance', SECRET));
  } finally {
    globalThis.fetch = original;
  }
}

test('parseRetryAfter reads a number of seconds', () => {
  assert.equal(parseRetryAfter('30'), 30);
  assert.equal(parseRetryAfter('0'), 0);
});

test('parseRetryAfter reads an HTTP date', () => {
  const now = Date.parse('2026-10-07T20:00:00Z');
  assert.equal(parseRetryAfter('Wed, 07 Oct 2026 20:00:45 GMT', now), 45);
});

test('parseRetryAfter ignores what it cannot parse, and an absent header', () => {
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

test('a 429 reports the wait and keeps the body for diagnosis', async () => {
  const response = new Response('{"error":"slow down"}', {
    status: 429,
    headers: { 'retry-after': '30' },
  });
  await withFetch(response, async (call) => {
    await assert.rejects(call, (err: unknown) => {
      assert.ok(err instanceof RequestError);
      assert.equal(err.kind, 'rateLimit');
      assert.equal(err.retryAfterSeconds, 30);
      assert.equal(err.status, 429);
      assert.equal(err.raw?.status, 429);
      assert.match(err.raw?.body ?? '', /slow down/);
      return true;
    });
  });
});

test('a rejected key is reported as auth, and never carries the key along', async () => {
  const response = new Response('{"error":"invalid credentials"}', { status: 401 });
  await withFetch(response, async (call) => {
    await assert.rejects(call, (err: unknown) => {
      assert.ok(err instanceof RequestError);
      assert.equal(err.kind, 'auth');
      const carried = JSON.stringify({ message: err.message, raw: err.raw });
      assert.ok(!carried.includes(SECRET), 'the API key must never appear in an error');
      return true;
    });
  });
});

test('a body that is not JSON is reported as a parse failure', async () => {
  await withFetch(new Response('<html>nope</html>', { status: 200 }), async (call) => {
    await assert.rejects(call, (err: unknown) => {
      assert.ok(err instanceof RequestError);
      assert.equal(err.kind, 'parse');
      assert.match(err.raw?.body ?? '', /nope/);
      return true;
    });
  });
});
