'use strict';

import { WindowName } from './quota';

const WINDOW_LABELS: Record<WindowName, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  session: 'Session',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function windowLabel(name: WindowName): string {
  return WINDOW_LABELS[name];
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Dollars with a fixed two decimals and no locale formatting: a status bar is
 * narrow, and a separator that changes with the machine's locale makes the item
 * jump around.
 */
export function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * An instant as `22-Oct-2026 13:54 UTC`, never through `toLocaleString()`.
 *
 * The extension host's locale is the Node process's, not the display language of
 * VS Code, so a Russian user can be shown `10/22/2026, 4:54:37 PM` — a reading
 * that is also ambiguous to anyone outside the US. Hence the fixed English month
 * table instead of `Intl`.
 *
 * The moment printed is a UTC instant from the wire: the reset boundary of a
 * period, which the provider defines in UTC. Rendering it in the machine's zone
 * moves it to another day for a reset shortly after midnight, so the UTC getters
 * here are deliberate — swapping them for `getDate()`/`getHours()` is the bug
 * this function exists to prevent.
 */
export function moment(date: Date): string {
  const day = pad(date.getUTCDate());
  const month = MONTHS[date.getUTCMonth()];
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return `${day}-${month}-${date.getUTCFullYear()} ${time} UTC`;
}
