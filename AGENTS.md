# Project Guidelines

BOB plugins for AI agents, published as a Claude Code marketplace
(`.claude-plugin/marketplace.json`) and a Codex marketplace
(`.agents/plugins/marketplace.json`). Each plugin lives in `plugins/<name>/`. The
layout is in `README.md`; the rules for plugins and skills are in `CONTRIBUTING.md`.

The `bob-gateway` skills restate facts from
[bob-collective/bob](https://github.com/bob-collective/bob) (Gateway OpenAPI spec and
SDK). Check them against it before changing endpoints, error codes, spender
addresses or token addresses.

## Checks

```sh
node .github/scripts/check-plugins.mjs --base origin/main
claude plugin validate .
```
