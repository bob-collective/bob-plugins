# BOB Gateway

Teach AI agents to use [BOB Gateway](https://docs.gobob.xyz/gateway/overview): swap
native BTC to and from tokens on EVM chains and Tron, and swap tokens across those
chains. The plugin bundles the Gateway MCP server with three skills in the open
[Agent Skills](https://agentskills.io) format, so the skills also work in Cursor,
Gemini CLI, GitHub Copilot, OpenCode and other agents that read `SKILL.md` files.

| Skill | Use it to |
|---|---|
| [`gateway-swap`](skills/gateway-swap/SKILL.md) | Quote a swap, create the order, and hand the user what to sign |
| [`gateway-order-status`](skills/gateway-order-status/SKILL.md) | Look up an order or an address's history and explain the status |
| [`gateway-integrate`](skills/gateway-integrate/SKILL.md) | Write or review code that integrates Gateway (SDK, REST API, CLI) |

`gateway-swap` and `gateway-order-status` call the tools of the Gateway MCP server:
`get_routes`, `get_quote`, `create_order`, `register_tx`, `get_order`, `get_orders`
and `get_max_spendable`. The server is a pass-through to the public Gateway V4 API.
`gateway-integrate` works without it.

Neither the server nor the skills hold keys or sign anything. The agent prepares
the order and tells the user what to sign, and the user's own wallet signs and
broadcasts every transaction, token approvals included.

## Install

### Claude Code

The plugin installs the three skills and the MCP server:

```bash
claude plugin marketplace add bob-collective/bob-plugins
claude plugin install bob-gateway@bob
```

The plugin reads two environment variables when Claude Code starts:

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_API_KEY` | none | Integrator API key, sent as `Authorization: Bearer <key>` (see [API key](#api-key)) |
| `BOB_GATEWAY_MCP_URL` | `https://mcp.gobob.xyz/mcp` | Point the plugin at another Gateway MCP server |

### Codex

```bash
codex plugin marketplace add bob-collective/bob-plugins --ref main
codex plugin add bob-gateway@bob
```

The Codex plugin connects to `https://mcp.gobob.xyz/mcp` without an API key. To send
one, install the skills on their own and connect the server with
`--bearer-token-env-var`, as [Other agents](#other-agents) shows.

### Other agents

Install the skills with the [`skills` CLI](https://github.com/vercel-labs/skills),
which knows where each agent looks for them:

```bash
npx skills add bob-collective/bob-plugins                # into the current project
npx skills add bob-collective/bob-plugins -g -a codex    # for one agent, user-wide
```

Or copy the directories in [`skills/`](skills/) into `.agents/skills/` in your
project. Codex, Cursor, Gemini CLI, GitHub Copilot and OpenCode all read that
directory.

Then connect the MCP server: streamable HTTP at `https://mcp.gobob.xyz/mcp`, with
an optional `Authorization: Bearer <key>` header. Without a key, leave the header
(or Codex's `--bearer-token-env-var`) out.

**Codex**

```bash
codex mcp add bob-gateway --url https://mcp.gobob.xyz/mcp --bearer-token-env-var GATEWAY_API_KEY
```

**Cursor** — `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bob-gateway": {
      "url": "https://mcp.gobob.xyz/mcp",
      "headers": { "Authorization": "Bearer ${env:GATEWAY_API_KEY}" }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json` in the project, or `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "bob-gateway": {
      "httpUrl": "https://mcp.gobob.xyz/mcp",
      "headers": { "Authorization": "Bearer ${GATEWAY_API_KEY}" }
    }
  }
}
```

**GitHub Copilot** — `.mcp.json` in the workspace root, or `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "bob-gateway": {
      "type": "http",
      "url": "https://mcp.gobob.xyz/mcp",
      "headers": { "Authorization": "Bearer ${GATEWAY_API_KEY}" }
    }
  }
}
```

**Claude Code without the plugin**

```bash
claude mcp add --transport http bob-gateway https://mcp.gobob.xyz/mcp \
  --header "Authorization: Bearer $GATEWAY_API_KEY"
```

Any other agent: add a streamable HTTP MCP server named `bob-gateway` with the same
URL and header.

## API key

`GATEWAY_API_KEY` is an optional 32-character integrator API key. With it, the
gateway applies that integrator's pricing to the orders; every tool works without
it. Request one from gateway@gobob.xyz, and set it in the environment your agent
starts from, never in chat.

`create_order` creates a real order, and `register_tx` broadcasts a Bitcoin
transaction that cannot be undone. Keep both behind your agent's tool-approval
prompt.

## Learn more

- [Gateway for AI agents](https://docs.gobob.xyz/gateway/agents)
- [Gateway documentation](https://docs.gobob.xyz/gateway/overview)
- [BOB website](https://gobob.xyz)
