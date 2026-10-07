# Ollama Balance

A VS Code status-bar item that shows how many ollama.com cloud credits you have left, e.g. `☁ Ollama $97.50`.

The data comes from ollama.com's documented `GET https://ollama.com/api/balance` endpoint and is parsed defensively (see [docs/adr/0004](docs/adr/0004-документированный-api-balance.md)).

## Setup

1. Create an API key at [ollama.com/settings/keys](https://ollama.com/settings/keys).
2. Run the command **Ollama Balance: Set API Key…** — the key is stored in the system keychain, never in settings.json.

## Behavior

- Polls `ollama.com/api/balance` for the remaining credits every `ollamaBalance.pollInterval` seconds (default 120, range 30–1800), on startup, and on demand ("Update now"). A second, optional request to `ollama.com/api/usage` adds the spend statistics shown in the tooltip; a failure there never affects the credit reading.
- Shows dollars when the API reports them, and falls back to the remaining percentage on legacy plans, which return windows (`session`, `weekly`) instead of money.
- The remaining amount is the included credits plus unexpired purchased ones; the colour is driven by the plan's own allowance, so top-ups cannot mask a nearly exhausted plan.
- Colors: orange at ≥50 % used, red at ≥90 % used.
- Failures degrade the indicator rather than hide it: a network, HTTP or parsing problem leaves the last known value in place with a `⚠` mark and explains itself in the tooltip, while a missing or rejected key shows the error itself. A notification appears once per new error kind, never per poll.
- A `429` is obeyed through its `Retry-After` header; the spend request is dropped first, the credit reading last.
- Clicking the item opens a menu: Update now / Set API key… / Show details / Copy raw response / Open settings.
- **Copy raw response** puts the last raw API responses (bodies only — never the key) on the clipboard and into the *Ollama Balance* output channel, so a future change in the API shape can be reported as a dump instead of a riddle.

## Development

```sh
npm install
npm run typecheck
npm test                   # node:test, bundled with the esbuild already present
npm run compile
npm run package            # produces ollama-balance-1.1.0.vsix
code --install-extension ollama-balance-1.1.0.vsix
```
