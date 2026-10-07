'use strict';

import { WindowName } from './quota';

const WINDOW_LABELS: Record<WindowName, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  session: 'Session',
};

export function windowLabel(name: WindowName): string {
  return WINDOW_LABELS[name];
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
