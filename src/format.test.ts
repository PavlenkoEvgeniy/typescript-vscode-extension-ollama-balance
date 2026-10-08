'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moment, money, percent } from './format';

test('moment renders a day, an English month and a UTC time', () => {
  assert.equal(moment(new Date('2026-10-22T13:54:37Z')), '22-Oct-2026 13:54 UTC');
});

test('moment pads the day, the hour and the minute', () => {
  assert.equal(moment(new Date('2026-01-05T04:07:00Z')), '05-Jan-2026 04:07 UTC');
});

test('moment names every month from the fixed table', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const [index, name] of months.entries()) {
    const date = new Date(Date.UTC(2026, index, 15, 12, 0));
    assert.equal(moment(date), `15-${name}-2026 12:00 UTC`, `month ${name}`);
  }
});

test('moment prints the UTC calendar day, not the machine-zone one', () => {
  // 22:30 UTC is already the 22nd in Moscow, and still the 21st in Los Angeles.
  // The wire instant is UTC, so the UTC day is the one that must be printed.
  assert.equal(moment(new Date('2026-10-21T22:30:00Z')), '21-Oct-2026 22:30 UTC');
});

test('moment survives midnight and the month and year boundaries', () => {
  assert.equal(moment(new Date('2026-11-01T00:00:00Z')), '01-Nov-2026 00:00 UTC');
  assert.equal(moment(new Date('2026-12-31T23:59:00Z')), '31-Dec-2026 23:59 UTC');
});

test('moment drops the seconds rather than rounding the minute up', () => {
  assert.equal(moment(new Date('2026-10-22T13:54:59Z')), '22-Oct-2026 13:54 UTC');
});

test('money and percent stay free of locale separators', () => {
  assert.equal(money(1234.5), '$1234.50');
  assert.equal(percent(0.755), '76%');
});
