# Ollama Balance

A VS Code status-bar item that shows how many ollama.com cloud credits you have left — `☁ Ollama $97.50`.

The reading comes from ollama.com's documented `GET https://ollama.com/api/balance` endpoint, parsed defensively (see [docs/adr/0004](docs/adr/0004-документированный-api-balance.md)). The extension does not compute or accumulate a balance of its own: whatever the endpoint reports is what you see. Ollama Balance is an unofficial extension — it is not affiliated with, endorsed by, or supported by Ollama.

## What it shows

The status-bar item has one of these forms:

| State | Looks like | Means |
| --- | --- | --- |
| Credits | `☁ Ollama $97.50` | The remaining amount in dollars (included credits plus unexpired purchased ones) |
| Legacy plan | `☁ Ollama 62%` | The plan reports a percentage of the window left instead of money |
| No key | `🔑 Ollama: no key` | No API key has been stored yet |
| Degraded, with a previous value | `☁ Ollama $97.50 ⚠` | The last successful reading, kept in place while the API is unreachable |
| Degraded, with nothing to show | `⚠ Ollama: bad key`, `offline`, `rate limited`, `HTTP 500`, `bad data` | The failure itself, because there is no stale value to fall back on |

The item is coloured from the plan's own usage: orange at ≥ 50 % used, red at ≥ 90 %. It stays uncoloured when the response carries no basis for a fraction — a plan with no allowance. Purchased credits count towards the *amount* shown but never towards the *fraction*, so buying top-ups cannot hide a plan that is nearly exhausted.

Hovering shows a tooltip with the breakdown — included and purchased credits, the plan used percentage, when the quota resets, and the spend statistics — plus links to **Update now**, **Set API key…** and **Copy raw response**.

## Requirements

- VS Code 1.90 or newer
- An ollama.com account with an API key

## Install

From the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=PavlenkoEvgeny.ollama-balance) — this is the path that updates itself:

```sh
code --install-extension PavlenkoEvgeny.ollama-balance
```

Or search for **Ollama Balance** in the Extensions view.

If you would rather pin a specific version, every release also attaches its `.vsix` to the GitHub release:

1. Download the `.vsix` for the version you want from the release assets.
2. Install it:

   ```sh
   code --install-extension ollama-balance-<version>.vsix
   ```

   A `.vsix` install does not update itself, so come back and install the newer file when you want the newer version.

## Setup

1. Create an API key at [ollama.com/settings/keys](https://ollama.com/settings/keys).
2. Run the command **Ollama Balance: Set API Key…** and paste it.

The key is written to VS Code's `SecretStorage`, which is the operating system keychain — never to `settings.json`. If you already put a key into the deprecated `ollamaBalance.apiKey` setting, the extension notices it on startup and offers a one-time move into secure storage, then removes the plain-text setting.

## Behavior

- **Polling.** The extension reads `balance` every `ollamaBalance.pollInterval` seconds (default 120, range 30–1800), once at startup, and on demand. Changing the setting reschedules immediately.
- **Spend statistics.** A second, optional request to `usage` adds the spend figures shown in the tooltip. It is decoration, not quota: a failure there never degrades the credit reading.
- **Backoff.** Repeated failures double the wait each time, up to 8× the configured interval. A configuration change resets the backoff so the new interval takes effect at once.
- **Rate limits.** A `429` is obeyed through its `Retry-After` header, capped at 4 hours. ollama.com allows 10 requests per minute per account, shared across every key and device — the two endpoints appear to draw on the same budget.
- **Degradation.** A missing or rejected key means there is nothing to show; a network, HTTP or parsing failure leaves the last known value in place with a `⚠` mark and explains itself in the tooltip. A notification appears once per new kind of error, never once per poll, and always carries a **Retry now** button. Manual updates always report their outcome.
- **Formatting.** Dollars are printed with fixed two decimals and no locale formatting, so the item does not jump around between machines. `balance`'s percentages are rounded to whole numbers.
- **Copy raw response** puts the last raw API responses onto the clipboard and into the *Ollama Balance* output channel, so a change in the API shape can be reported as a dump instead of a riddle.

## Commands

| Command | What it does |
| --- | --- |
| `Ollama Balance: Update Now` | Forces a refresh, ignoring the current backoff |
| `Ollama Balance: Set API Key…` | Stores a key in the system keychain and clears the deprecated setting |
| `Ollama Balance: Show Details` | Opens a picker with the quota breakdown, spend, and the time of the last update |
| `Ollama Balance: Copy Raw Response` | Copies the raw response bodies (never the key) to the clipboard |
| `Ollama Balance: Open Settings` | Opens the extension's settings |

Clicking the status-bar item itself opens a menu with the same actions.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ollamaBalance.pollInterval` | integer, 30–1800 | `120` | How often to poll `balance` for the remaining credits and `usage` for spend statistics, in seconds. Failures back off up to 8× this interval. |
| `ollamaBalance.apiKey` | string | — | **Deprecated and ignored.** Kept only so the extension can detect a plain-text key and offer to move it to secure storage. |

## Privacy and security

- The API key is stored only in the system keychain via VS Code's `SecretStorage`.
- It travels in the `Authorization` header and is never echoed into an error message, the output channel, or the clipboard.
- The extension talks to exactly two hosts, both on `ollama.com`: `/api/balance` and `/api/usage`. There is no telemetry and no other network traffic.
- *Copy raw response* captures response **bodies** only. They are truncated at 8 KB each, and at most the four most recent distinct URLs are kept — enough to report a shape change, not enough to accumulate.
- Nothing is sent anywhere except to ollama.com, and nothing is written to disk by the extension.

## Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| `Ollama: no key` | No key in the keychain | Run **Ollama Balance: Set API Key…** |
| `bad key` | ollama.com answered 401/403 | The key is wrong or revoked — create a new one and set it again |
| `offline` | The request never reached ollama.com | Check connectivity; the last known value stays on screen with `⚠` |
| `rate limited` | HTTP 429 | Nothing — the extension waits out `Retry-After` on its own |
| `HTTP 500` (etc.) | Another non-OK status | Usually transient; the tooltip shows the status |
| `bad data` | The response was not JSON, or not the shape the parser expects | Run **Copy raw response** and attach the dump to a bug report |
| A percentage instead of dollars | Your plan is on the legacy branch, which reports windows (`monthly`, `weekly`, `session`) rather than money | Expected; the status bar shows the first window present, in that order |

## Development

```sh
npm install
npm run typecheck
npm test                   # node:test, bundled with the esbuild already present
npm run compile            # writes dist/extension.js
npm run package            # produces ollama-balance-<version>.vsix
code --install-extension ollama-balance-<version>.vsix
```

`npm run watch` rebuilds `dist/extension.js` on change.

## Releasing

The release workflow (`.github/workflows/release.yml`) runs when a GitHub release is published. It checks out the release's tag, verifies that the tag matches the version in `package.json`, runs the typecheck and the tests, builds `dist/`, packages the `.vsix`, uploads it as a workflow artifact, and attaches it to the release.

So the order matters:

1. Bump `version` in `package.json` and commit it to `main`.
2. Create a GitHub release whose tag is `v<version>` — for version `X.Y.Z`, the tag is `vX.Y.Z` — pointing at that commit.
3. Publish the release. The workflow builds and attaches `ollama-balance-<version>.vsix`.

A tag cannot be repointed, so if the workflow fails with a version mismatch, the fix is a new commit and a **new** tag, never a moved one. Re-running the workflow from the release page is safe: the upload uses `--clobber`.

Publishing to the Marketplace is **not** part of that workflow — it is a separate, manual step. [docs/publishing.md](docs/publishing.md) has the procedure, and says which replacement for it currently works and which does not. That procedure rests on an Azure DevOps personal access token, which stops working for Marketplace publishing on **1 December 2026**; [ADR 0005](docs/adr/0005-публикация-в-marketplace.md) records why the replacement is not yet chosen.

## License

MIT — see [LICENSE](LICENSE).

## Further reading

- [CONTEXT.md](CONTEXT.md) — the domain glossary: what *credits*, *window*, *period* and *usage fraction* mean here, and which of them are wire concepts rather than domain ones.
- [docs/adr](docs/adr) — the decisions behind the current shape:
  - [0004](docs/adr/0004-документированный-api-balance.md) — reading the quota from the documented `GET /api/balance`
  - [0003](docs/adr/0003-доллары-вместо-процентов.md) — dollars instead of percentages
  - [0002](docs/adr/0002-неофициальный-api-usage.md) — the earlier, unofficial `GET /api/usage`
  - [0001](docs/adr/0001-проценты-вместо-долларов.md) — the original percentage-based reading
