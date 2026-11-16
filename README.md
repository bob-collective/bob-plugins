# BOB for AI agents

Plugins that let AI agents use [BOB](https://gobob.xyz). Each plugin bundles
[Agent Skills](https://agentskills.io) with the MCP server they call, and ships in
two formats: a Claude Code plugin and an [Agent Plugins](https://agent-plugins.org)
package that Codex installs.

| Plugin | What it does |
|---|---|
| [`bob-gateway`](plugins/bob-gateway) | Swap native BTC to and from tokens on EVM chains and Tron through BOB Gateway, track the orders, and integrate Gateway into an app |

## Install

```sh
# Claude Code
claude plugin marketplace add bob-collective/bob-plugins
claude plugin install bob-gateway@bob

# Codex
codex plugin marketplace add bob-collective/bob-plugins --ref main
codex plugin add bob-gateway@bob
```

Start a new agent session after installation. For other agents, and for API keys
and environment variables, see the plugin's README.

The plugins never hold keys or sign anything: the agent prepares each action, and
your own wallet signs it. Never give an agent a wallet seed or private key.

## Repository layout

```text
.claude-plugin/marketplace.json     Claude Code marketplace
.agents/plugins/marketplace.json    Codex marketplace
plugins/<name>/
  .claude-plugin/plugin.json        Claude Code manifest
  .mcp.json                         MCP servers for Claude Code
  plugin.json                       Agent Plugins manifest, with Codex metadata
  mcp.json                          MCP servers in the Agent Plugins format
  skills/<skill>/SKILL.md           Agent Skills; agents/openai.yaml adds Codex metadata
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to change a plugin or add one.

## Learn more

- [BOB website](https://gobob.xyz)
- [BOB documentation](https://docs.gobob.xyz)
- [Gateway for AI agents](https://docs.gobob.xyz/gateway/agents)
