'use strict';

// Shared HTTP layer for the ollama.com endpoints.
//
// The API key travels in the Authorization header and is never echoed into an
// error message, the diagnostics channel, or the clipboard — the raw response
// captured here is the response *body*, which does not contain it.

export type RequestErrorKind = 'auth' | 'http' | 'rateLimit' | 'network' | 'parse';

/** The response as it arrived, kept so the user can paste it into a bug report. */
export interface RawResponse {
  url: string;
  status: number;
  body: string;
  receivedAt: Date;
}

export interface RequestErrorInit {
  status?: number;
  /** From the `Retry-After` header of a 429, in seconds. */
  retryAfterSeconds?: number;
  raw?: RawResponse;
}

export class RequestError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly raw?: RawResponse;

  constructor(readonly kind: RequestErrorKind, detail: string, init: RequestErrorInit = {}) {
    super(detail);
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.raw = init.raw;
  }
}

export interface Fetched {
  body: unknown;
  raw: RawResponse;
}

/** Keeps a copy of the body bounded, so a hostile response cannot balloon memory. */
const MAX_RAW_BYTES = 8192;

/**
 * `Retry-After` is either a number of seconds or an HTTP date. Returns seconds,
 * or undefined when the header is absent or unparseable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - now) / 1000));
}

export async function getJson(url: string, apiKey: string): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  } catch (err: unknown) {
    throw new RequestError('network', `Network request failed: ${String(err)}`);
  }

  const text = await response.text().catch(() => '');
  const raw: RawResponse = {
    url,
    status: response.status,
    body: text.length > MAX_RAW_BYTES ? `${text.slice(0, MAX_RAW_BYTES)}… (truncated)` : text,
    receivedAt: new Date(),
  };

  if (response.status === 401 || response.status === 403) {
    throw new RequestError('auth', 'ollama.com rejected the API key (HTTP 401/403).', { status: response.status, raw });
  }
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
    const wait = retryAfterSeconds === undefined ? '' : ` Retry after ${retryAfterSeconds}s.`;
    throw new RequestError('rateLimit', `ollama.com rate-limited the request (HTTP 429).${wait}`, {
      status: 429,
      retryAfterSeconds,
      raw,
    });
  }
  if (!response.ok) {
    throw new RequestError('http', `ollama.com answered HTTP ${response.status}.`, { status: response.status, raw });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RequestError('parse', 'Response is not valid JSON.', { raw });
  }
  return { body, raw };
}
