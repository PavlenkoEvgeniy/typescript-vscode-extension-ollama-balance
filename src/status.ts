'use strict';

import * as vscode from 'vscode';
import { moment, money, percent, windowLabel } from './format';
import { RequestError, RequestErrorKind } from './http';
import { QuotaSnapshot, primaryWindow, remainingUsd, usedFraction } from './quota';
import { Spend } from './spend';

export interface Snapshot {
  quota: QuotaSnapshot;
  spend?: Spend;
}

export type View =
  | { phase: 'ok'; snapshot: Snapshot }
  | { phase: 'noKey'; lastUpdated?: Date }
  | { phase: 'error'; error: RequestError; lastSnapshot?: Snapshot; lastUpdated?: Date };

/** Marked on a value that is still shown while the API is unreachable. */
const STALE_MARK = ' ⚠';

/**
 * Errors that mean there is nothing to show, not even a stale value: a rejected
 * key produces no reading at all, whereas a network or parsing failure produces
 * a reading that is merely old (see CONTEXT.md, "Деградировавшее состояние").
 */
function isFatal(kind: RequestErrorKind): boolean {
  return kind === 'auth';
}

function shortError(error: RequestError): string {
  switch (error.kind) {
    case 'auth':
      return 'bad key';
    case 'network':
      return 'offline';
    case 'rateLimit':
      return 'rate limited';
    case 'http':
      return `HTTP ${error.status ?? '?'}`;
    case 'parse':
      return 'bad data';
  }
}

function valueText(snapshot: Snapshot): string {
  const quota = snapshot.quota.quota;
  if (quota.kind === 'credits') {
    return `$(cloud) Ollama ${money(remainingUsd(quota))}`;
  }
  const primary = primaryWindow(quota.windows);
  return primary ? `$(cloud) Ollama ${percent(1 - primary.used)}` : '$(cloud) Ollama —';
}

function shortText(view: View): { text: string; used?: number } {
  switch (view.phase) {
    case 'ok':
      return { text: valueText(view.snapshot), used: usedFraction(view.snapshot.quota.quota) };
    case 'noKey':
      return { text: '$(key) Ollama: no key' };
    case 'error':
      if (isFatal(view.error.kind) || !view.lastSnapshot) {
        return { text: `$(warning) Ollama: ${shortError(view.error)}` };
      }
      return { text: `${valueText(view.lastSnapshot)}${STALE_MARK}`, used: usedFraction(view.lastSnapshot.quota.quota) };
  }
}

function tooltip(view: View): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [
      'ollamaBalance.updateNow',
      'ollamaBalance.setApiKey',
      'ollamaBalance.copyRawResponse',
    ],
  };
  md.appendMarkdown('**Ollama Balance**\n\n');

  switch (view.phase) {
    case 'noKey':
      md.appendMarkdown(
        'No API key set. Create one at [ollama.com/settings/keys](https://ollama.com/settings/keys), then run `Ollama Balance: Set API Key…`.\n',
      );
      break;

    case 'error': {
      md.appendMarkdown(`$(warning) ${view.error.message}\n`);
      if (view.lastSnapshot && !isFatal(view.error.kind)) {
        md.appendMarkdown('\nThe value below was read before this failure.\n\n');
        appendQuota(md, view.lastSnapshot);
        appendSpend(md, view.lastSnapshot);
      }
      appendUpdated(md, 'Last successful update:', view.lastUpdated);
      break;
    }

    case 'ok':
      appendQuota(md, view.snapshot);
      appendSpend(md, view.snapshot);
      appendUpdated(md, 'Updated', view.snapshot.quota.fetchedAt);
      break;
  }

  appendCommands(md);
  return md;
}

function appendQuota(md: vscode.MarkdownString, snapshot: Snapshot): void {
  const quota = snapshot.quota.quota;

  if (quota.kind === 'credits') {
    const allowance = quota.allowanceUsd === undefined ? '' : ` of ${money(quota.allowanceUsd)}`;
    md.appendMarkdown(`Remaining credits: **${money(remainingUsd(quota))}**\n\n`);
    md.appendMarkdown(`- Included: ${money(quota.includedUsd)}${allowance}\n`);
    if (quota.purchasedUsd > 0) {
      md.appendMarkdown(`- Purchased: ${money(quota.purchasedUsd)}\n`);
    }
    const used = usedFraction(quota);
    if (used !== undefined) {
      md.appendMarkdown(`- Plan used: ${percent(used)}\n`);
    }
    if (quota.periodEnd) {
      md.appendMarkdown(`- Resets: ${moment(quota.periodEnd)}\n`);
    }
    return;
  }

  const primary = primaryWindow(quota.windows);
  if (!primary) {
    md.appendMarkdown('The response carried no usage windows.\n');
    return;
  }
  md.appendMarkdown(`Remaining ${windowLabel(primary.name).toLowerCase()} window: **${percent(1 - primary.used)}**\n\n`);
  for (const window of quota.windows) {
    md.appendMarkdown(
      `- ${windowLabel(window.name)}: ${percent(1 - window.used)} left (${percent(window.used)} used)\n`,
    );
  }
  if (primary.resetsAt) {
    md.appendMarkdown(`- ${windowLabel(primary.name)} resets: ${moment(primary.resetsAt)}\n`);
  }
}

function appendSpend(md: vscode.MarkdownString, snapshot: Snapshot): void {
  if (!snapshot.spend) return;
  const range = snapshot.spend.range ? ` ${snapshot.spend.range}` : '';
  md.appendMarkdown(`\nSpent over the last${range}: ${money(snapshot.spend.usd)}\n`);
}

function appendUpdated(md: vscode.MarkdownString, label: string, updated: Date | undefined): void {
  if (updated) {
    md.appendMarkdown(`\n\n${label} ${moment(updated)}\n`);
  }
}

function appendCommands(md: vscode.MarkdownString): void {
  md.appendMarkdown(
    '\n\n[Update now](command:ollamaBalance.updateNow) · [Set API key…](command:ollamaBalance.setApiKey) · [Copy raw response](command:ollamaBalance.copyRawResponse)\n',
  );
}

function backgroundColor(used: number | undefined): vscode.ThemeColor | undefined {
  if (used === undefined) return undefined;
  if (used >= 0.9) return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (used >= 0.5) return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
}

export class StatusBarView implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Ollama Balance';
    this.item.command = 'ollamaBalance.menu';
  }

  showInitial(): void {
    this.render({ phase: 'noKey' });
    this.item.show();
  }

  render(view: View): void {
    const { text, used } = shortText(view);
    this.item.text = text;
    this.item.backgroundColor = backgroundColor(used);
    this.item.tooltip = tooltip(view);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
