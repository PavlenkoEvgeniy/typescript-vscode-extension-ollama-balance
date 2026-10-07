'use strict';

// Helpers for reading an untrusted JSON body. Nothing in the response is
// trusted outright, and every rejection has to be able to say *what* it saw:
// the previous shape of these endpoints changed without warning, and a parser
// that drops values silently turns a units mistake into "the API changed".

export function readField(source: unknown, key: string): unknown {
  return (source as Record<string, unknown> | null | undefined)?.[key];
}

export function readObject(source: unknown, key: string): Record<string, unknown> | undefined {
  const value = readField(source, key);
  return isObject(value) ? (value as Record<string, unknown>) : undefined;
}

export function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Numbers the wire sends as strings are accepted; anything else is rejected. */
export function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Renders a rejected value for an error message, keeping it short and quoted. */
export function describe(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return 'an object';
}

export function formatKeys(keys: readonly string[]): string {
  return keys.length === 0 ? 'none' : keys.map((key) => `\`${key}\``).join(', ');
}
