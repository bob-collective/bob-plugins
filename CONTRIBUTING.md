# Contributing

## Plugins

- Each plugin is a directory in `plugins/`, named like the plugin. It carries two
  manifests: `.claude-plugin/plugin.json` for Claude Code and `plugin.json` for
  [Agent Plugins](https://agent-plugins.org) clients such as Codex, with Codex
  presentation under `extensions.com.openai`. Keep `name`, `version`, `description`,
  `homepage` and `repository` the same in both.
- MCP servers go in `.mcp.json` for Claude Code and `mcp.json` for Agent Plugins,
  under the same server names. Only `.mcp.json` may read secrets, through
  `${VAR}` expansion; Agent Plugins headers are visible package data, so `mcp.json`
  never carries a credential.
- List every plugin in both marketplaces: `.claude-plugin/marketplace.json` and
  `.agents/plugins/marketplace.json`, with source `./plugins/<name>`.
- Bump `version` in both manifests with every change to a plugin. Claude Code and
  Codex only update an installed plugin when its version changes.
- Each plugin has a README that says what it does and how to install it in Claude
  Code, Codex and other agents.

## Skills

- Each skill is a directory in `plugins/<plugin>/skills/` with a `SKILL.md` that
  follows the [Agent Skills specification](https://agentskills.io/specification).
  Its frontmatter `name` is the directory name: lowercase letters, digits and
  hyphens, at most 64 characters. Its `description`, at most 1024 characters, starts
  with "Use when" and says when to load the skill.
- Keep each skill self-contained: link only to files inside its own directory.
  Installers copy each skill directory on its own.
- Keep the skills agent-neutral. Name MCP tools as the server names them, and give
  no instructions that only one agent understands. Agent-specific metadata goes in
  files beside `SKILL.md`, such as `agents/openai.yaml` for Codex.
- Skills never handle keys, and never sign or send a transaction. They tell the
  user what to sign.
- The skills are read by agents outside BOB: keep them to public endpoints, tools
  and docs.

## Checks

```sh
node .github/scripts/check-plugins.mjs                            # sources fetched from GitHub
node .github/scripts/check-plugins.mjs --bob ../bob               # sources from a local bob checkout
node .github/scripts/check-plugins.mjs --base origin/main         # also require a version bump
claude plugin validate .
```

`check-plugins.mjs` checks the rules above that a script can check. For
`bob-gateway`, it also checks the skills against the sources they restate in
[bob-collective/bob](https://github.com/bob-collective/bob): the endpoints and error
codes in `gateway-docs/openapi.json`, the AllowanceHolder spenders in
`sdk/src/gateway/allowance-holder.ts`, and the legacy USDT address in
`sdk/src/gateway/client.ts`.

The `Check` workflow runs it on every pull request and push to `main`, and every
Monday to catch changes in bob-collective/bob. It also runs the Agent Skills
reference validator
([`skills-ref validate`](https://github.com/agentskills/agentskills/tree/main/skills-ref))
on each skill and `claude plugin validate` on the marketplace and each plugin.
