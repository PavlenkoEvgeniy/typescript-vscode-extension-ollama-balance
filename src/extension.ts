'use strict';

import * as vscode from 'vscode';
import { moment, money, percent, windowLabel } from './format';
import { RawResponse, RequestError } from './http';
import { fetchQuota, primaryWindow, remainingUsd, usedFraction } from './quota';
import { fetchSpend } from './spend';
import { Snapshot, StatusBarView, View } from './status';

const SECTION = 'ollamaBalance';
const SECRET_KEY = 'apiKey';
const POLL_INTERVAL_SETTING = 'pollInterval';
const DEPRECATED_SETTING = 'apiKey';
const MIGRATION_STATE = 'deprecatedApiKeySeen';
const OUTPUT_CHANNEL = 'Ollama Balance';

const DEFAULT_INTERVAL_SECONDS = 120;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 1800;
const MAX_BACKOFF_MULTIPLIER = 8;
/** Ceiling on a `Retry-After` the server may ask us to wait out. */
const MAX_WAIT_SECONDS = 4 * 60 * 60;
const MAX_REMEMBERED_RESPONSES = 4;

export function activate(context: vscode.ExtensionContext): void {
  const view = new StatusBarView();
  context.subscriptions.push(view);

  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  context.subscriptions.push(channel);

  let timer: NodeJS.Timeout | undefined;
  let backoffMultiplier = 1;
  let lastUpdated: Date | undefined;
  let lastSnapshot: Snapshot | undefined;
  let currentPhase: View['phase'] | undefined;
  let notifiedErrorKind: string | undefined;
  let remembered: RawResponse[] = [];

  context.subscriptions.push({
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  });

  // Holds the tail of what the API actually answered, so that the next time a
  // response shape changes the user can hand over a dump instead of a riddle.
  // Bodies only — the key travels in a header and is never recorded.
  const rememberRaw = (raw: RawResponse | undefined): void => {
    if (!raw) return;
    remembered = [raw, ...remembered.filter((other) => other.url !== raw.url)].slice(0, MAX_REMEMBERED_RESPONSES);
  };

  const pollIntervalSeconds = (): number => {
    const value = vscode.workspace.getConfiguration(SECTION).get<number>(POLL_INTERVAL_SETTING);
    return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, value ?? DEFAULT_INTERVAL_SECONDS));
  };

  const schedule = (retryAfterSeconds?: number): void => {
    if (timer) clearTimeout(timer);
    const base = pollIntervalSeconds() * backoffMultiplier;
    const wait = Math.min(MAX_WAIT_SECONDS, Math.max(base, retryAfterSeconds ?? 0));
    timer = setTimeout(() => void update(false), wait * 1000);
  };

  const showErrorNotice = (message: string, err: RequestError | undefined): void => {
    const details = err ? ` ${err.message}` : '';
    vscode.window
      .showWarningMessage(`Ollama Balance: ${message}${details}`, 'Retry now')
      .then((choice) => {
        if (choice === 'Retry now') void update(true);
      });
  };

  const update = async (manual: boolean): Promise<void> => {
    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      currentPhase = 'noKey';
      view.render({ phase: 'noKey' });
      schedule();
      return;
    }

    const previousPhase = currentPhase;
    let retryAfterSeconds: number | undefined;

    try {
      const quota = await fetchQuota(apiKey);
      rememberRaw(quota.raw);

      // Spend is decoration: `GET /api/usage` is documented as statistics and
      // its failure must never take the quota reading down with it.
      const spend = await fetchSpend(apiKey).catch((err: unknown) => {
        if (err instanceof RequestError) {
          rememberRaw(err.raw);
          if (err.kind === 'rateLimit') retryAfterSeconds = err.retryAfterSeconds;
        }
        return undefined;
      });
      if (spend) rememberRaw(spend.raw);

      lastSnapshot = { quota, spend: spend?.spend };
      lastUpdated = quota.fetchedAt;
      backoffMultiplier = 1;
      currentPhase = 'ok';
      notifiedErrorKind = undefined;
      view.render({ phase: 'ok', snapshot: lastSnapshot });
    } catch (err: unknown) {
      const error =
        err instanceof RequestError ? err : new RequestError('network', `Unexpected error: ${String(err)}`);
      rememberRaw(error.raw);
      retryAfterSeconds = error.retryAfterSeconds;
      currentPhase = 'error';
      view.render({ phase: 'error', error, lastSnapshot, lastUpdated });
      channel.appendLine(`${new Date().toISOString()} ${error.kind}: ${error.message}`);
      // Notify once per new error kind; manual updates always report.
      if (manual || previousPhase !== 'error' || notifiedErrorKind !== error.kind) {
        notifiedErrorKind = error.kind;
        showErrorNotice('update failed.', error);
      }
      if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) backoffMultiplier *= 2;
    }

    schedule(retryAfterSeconds);
  };

  const copyRawResponse = async (): Promise<void> => {
    if (remembered.length === 0) {
      vscode.window.showInformationMessage(
        'Ollama Balance: nothing captured yet — run "Update now" once the API key is set.',
      );
      return;
    }
    const text = remembered
      .map((raw) => `${raw.url}\nHTTP ${raw.status} at ${raw.receivedAt.toISOString()}\n\n${raw.body}`)
      .join('\n\n---\n\n');
    // Clear first: the channel is a view of the current dump, not an ever-growing log.
    channel.clear();
    channel.appendLine('Raw responses, most recent first. The API key is not included.');
    channel.appendLine('');
    channel.appendLine(text);
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(
      'Ollama Balance: raw response copied to the clipboard (the API key is not included).',
    );
  };

  const setApiKey = async (): Promise<void> => {
    const key = await vscode.window.showInputBox({
      title: 'Ollama Balance',
      prompt: 'API key for ollama.com (create one at https://ollama.com/settings/keys)',
      password: true,
      placeHolder: 'sk-…',
    });
    if (!key) return;
    await context.secrets.store(SECRET_KEY, key);
    vscode.window.showInformationMessage('Ollama Balance: API key stored in the system keychain.');
    await vscode.workspace
      .getConfiguration(SECTION)
      .update(DEPRECATED_SETTING, undefined, vscode.ConfigurationTarget.Global);
    await update(true);
  };

  const showDetails = (): void => {
    const items: (vscode.QuickPickItem & { run?: () => void })[] = [];
    if (lastSnapshot) {
      const quota = lastSnapshot.quota.quota;
      if (quota.kind === 'credits') {
        const allowance = quota.allowanceUsd === undefined ? '' : ` of ${money(quota.allowanceUsd)}`;
        items.push({
          label: `$(credit-card) Remaining credits: ${money(remainingUsd(quota))}`,
          detail: `Included ${money(quota.includedUsd)}${allowance}, purchased ${money(quota.purchasedUsd)} — shown in the status bar`,
        });
      } else {
        const primary = primaryWindow(quota.windows);
        for (const window of quota.windows) {
          items.push({
            label: `$(calendar) ${windowLabel(window.name)}: ${percent(1 - window.used)} left`,
            detail: `${percent(window.used)} used${window === primary ? ' — shown in the status bar' : ''}`,
          });
        }
      }
      if (lastSnapshot.spend) {
        const range = lastSnapshot.spend.range ? ` (${lastSnapshot.spend.range})` : '';
        items.push({
          label: `$(graph) Spent: ${money(lastSnapshot.spend.usd)}`,
          detail: `Not part of the quota${range}`,
        });
      }
      items.push({
        label: '$(clock) Updated',
        detail: lastUpdated ? moment(lastUpdated) : 'unknown',
      });
    } else {
      items.push({ label: '$(warning) No data', detail: 'Run "Update now" once the API key is set.' });
    }
    items.push({
      label: '$(refresh) Update now',
      detail: 'Force a refresh of quota data',
      run: () => void update(true),
    });
    vscode.window.showQuickPick(items, { title: 'Ollama Balance — details' })?.then((pick) => pick?.run?.());
  };

  const menu = vscode.commands.registerCommand('ollamaBalance.menu', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(refresh) Update now', action: () => void update(true) },
        { label: '$(key) Set API key…', action: () => void setApiKey() },
        { label: '$(book) Show details', action: showDetails },
        { label: '$(clippy) Copy raw response', action: () => void copyRawResponse() },
        {
          label: '$(gear) Open settings',
          action: () => void vscode.commands.executeCommand('workbench.action.openSettings', 'ollamaBalance'),
        },
      ],
      { title: 'Ollama Balance' },
    );
    pick?.action();
  });

  const updateNow = vscode.commands.registerCommand('ollamaBalance.updateNow', () => void update(true));
  const setApiKeyCommand = vscode.commands.registerCommand('ollamaBalance.setApiKey', () => void setApiKey());
  const showDetailsCommand = vscode.commands.registerCommand('ollamaBalance.showDetails', showDetails);
  const copyRawCommand = vscode.commands.registerCommand('ollamaBalance.copyRawResponse', () =>
    void copyRawResponse(),
  );
  const openSettingsCommand = vscode.commands.registerCommand('ollamaBalance.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'ollamaBalance'),
  );

  const deprecatedSettingSeen = (): string | undefined => context.globalState.get<string>(MIGRATION_STATE);

  // The "apiKey" setting is ignored for API calls (keys live in the keychain).
  // If a plain-text key is present, offer a one-time move.
  const checkDeprecatedSetting = async (): Promise<void> => {
    const raw = vscode.workspace.getConfiguration(SECTION).get<string>(DEPRECATED_SETTING);
    if (!raw || raw === deprecatedSettingSeen()) return;
    context.globalState.update(MIGRATION_STATE, raw);
    const choice = await vscode.window.showWarningMessage(
      'Ollama Balance: "ollamaBalance.apiKey" sits in settings.json where plain-text keys leak. Move it to the system keychain?',
      'Move to secure storage',
      'Dismiss',
    );
    if (choice === 'Move to secure storage') {
      await context.secrets.store(SECRET_KEY, raw);
      await vscode.workspace
        .getConfiguration(SECTION)
        .update(DEPRECATED_SETTING, undefined, vscode.ConfigurationTarget.Global);
      await update(true);
    }
  };

  const secretsListener = context.secrets.onDidChange(async ({ key }) => {
    if (key === SECRET_KEY) await update(true);
  });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(SECTION)) return;
    if (backoffMultiplier > 1) backoffMultiplier = 1; // retry sooner at the new interval
    void checkDeprecatedSetting();
    schedule();
  });

  context.subscriptions.push(
    menu,
    updateNow,
    setApiKeyCommand,
    showDetailsCommand,
    copyRawCommand,
    openSettingsCommand,
    secretsListener,
    configListener,
  );

  view.showInitial();
  void (async () => {
    await checkDeprecatedSetting();
    await update(false);
  })();
}
