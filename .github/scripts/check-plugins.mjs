#!/usr/bin/env node
// Checks the plugins in plugins/:
//   - each plugin's manifests agree: .claude-plugin/plugin.json (Claude Code) and
//     plugin.json (Agent Plugins, read by Codex) have the same name and version, and
//     .mcp.json (Claude Code) and mcp.json (Agent Plugins) declare the same servers
//   - both marketplaces list every plugin, and nothing else
//   - skill frontmatter against the Agent Skills spec (https://agentskills.io/specification)
//   - relative links in skills resolve and stay inside their skill directory
//   - bob-gateway: the facts its skills restate still match their sources in
//     bob-collective/bob: the /v4 endpoints and error codes in gateway-docs/openapi.json,
//     and the AllowanceHolder spenders and legacy USDT address in sdk/src/gateway/
//   - with --base <git ref>: a plugin's version was bumped if the plugin changed since then
//
// Usage: node .github/scripts/check-plugins.mjs [--base origin/main] [--bob <path to a bob checkout>]
// Without --bob, the bob-gateway sources are fetched from bob-collective/bob on GitHub.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const CLAUDE_MARKETPLACE = join(ROOT, '.claude-plugin/marketplace.json');
const CODEX_MARKETPLACE = join(ROOT, '.agents/plugins/marketplace.json');
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const BOB_RAW = 'https://raw.githubusercontent.com/bob-collective/bob/master';

const FRONTMATTER_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const MAX_SKILL_LINES = 500;

const errors = new Set();
const fail = (message) => errors.add(message);
const rel = (path) => relative(ROOT, path);
const read = (path) => readFileSync(path, 'utf8');

const option = (name) => {
    const index = process.argv.indexOf(name);
    if (index === -1) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
        console.error(`${name} needs a value`);
        process.exit(2);
    }
    return value;
};
const BASE = option('--base');
const BOB = option('--bob');

function readJson(path) {
    if (!existsSync(path)) {
        fail(`${rel(path)}: missing`);
        return null;
    }
    try {
        return JSON.parse(read(path));
    } catch (error) {
        fail(`${rel(path)}: invalid JSON (${error.message})`);
        return null;
    }
}

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

const subdirs = (dir) =>
    existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name)
              .sort()
        : [];

const pluginDirs = subdirs(PLUGINS_DIR);
const manifests = {};

// ── Plugin manifests ─────────────────────────────────────────────────────────

for (const dir of pluginDirs) {
    const root = join(PLUGINS_DIR, dir);
    const claude = readJson(join(root, '.claude-plugin/plugin.json'));
    const portable = readJson(join(root, 'plugin.json'));
    manifests[dir] = claude;

    if (claude && claude.name !== dir) fail(`plugins/${dir}/.claude-plugin/plugin.json: name "${claude.name}" must be "${dir}"`);
    if (claude && !/^\d+\.\d+\.\d+$/.test(claude.version ?? '')) {
        fail(`plugins/${dir}/.claude-plugin/plugin.json: version "${claude.version ?? ''}" is not semver`);
    }
    if (portable) {
        if (portable.$schema !== PLUGIN_SCHEMA) fail(`plugins/${dir}/plugin.json: "$schema" must be ${PLUGIN_SCHEMA}`);
        if (portable.name !== dir) fail(`plugins/${dir}/plugin.json: name "${portable.name}" must be "${dir}"`);
    }
    if (claude && portable) {
        for (const key of ['version', 'description', 'homepage', 'repository']) {
            if (claude[key] !== portable[key]) {
                fail(`plugins/${dir}: "${key}" differs between .claude-plugin/plugin.json and plugin.json`);
            }
        }
    }

    const claudeMcp = existsSync(join(root, '.mcp.json')) ? readJson(join(root, '.mcp.json')) : { mcpServers: {} };
    const portableMcp = existsSync(join(root, 'mcp.json')) ? readJson(join(root, 'mcp.json')) : { mcpServers: {} };
    if (portableMcp && existsSync(join(root, 'mcp.json')) && portableMcp.$schema !== MCP_SCHEMA) {
        fail(`plugins/${dir}/mcp.json: "$schema" must be ${MCP_SCHEMA}`);
    }
    if (claudeMcp && portableMcp) {
        const names = (config) => Object.keys(config.mcpServers ?? {}).sort().join(', ');
        if (names(claudeMcp) !== names(portableMcp)) {
            fail(`plugins/${dir}: .mcp.json declares [${names(claudeMcp)}], mcp.json declares [${names(portableMcp)}]`);
        }
        // Agent Plugins headers are visible package data: never a credential.
        for (const [name, server] of Object.entries(portableMcp.mcpServers ?? {})) {
            for (const header of Object.keys(server.headers ?? {})) {
                if (/^(authorization|.*api[-_]?key.*|.*token.*)$/i.test(header)) {
                    fail(`plugins/${dir}/mcp.json: server "${name}" sets "${header}"; mcp.json must not carry credentials`);
                }
            }
        }
    }

    // A Codex skill dependency on an MCP server must name a server the plugin ships.
    const servers = new Set(Object.keys(portableMcp?.mcpServers ?? {}));
    for (const skill of subdirs(join(root, 'skills'))) {
        const openai = join(root, 'skills', skill, 'agents/openai.yaml');
        if (!existsSync(openai)) continue;
        for (const [, server] of read(openai).matchAll(/type:\s*"?mcp"?\s*\n\s*value:\s*"?([\w-]+)"?/g)) {
            if (!servers.has(server)) fail(`${rel(openai)}: depends on MCP server "${server}", which plugins/${dir}/mcp.json does not declare`);
        }
    }
}

// ── Marketplaces ─────────────────────────────────────────────────────────────

function checkListing(file, sourceOf) {
    const marketplace = readJson(file);
    if (!marketplace) return;
    const listed = new Map((marketplace.plugins ?? []).map((entry) => [entry.name, entry]));
    for (const dir of pluginDirs) {
        const entry = listed.get(dir);
        if (!entry) fail(`${rel(file)}: plugins/${dir} is not listed`);
        else if (sourceOf(entry) !== `./plugins/${dir}`) fail(`${rel(file)}: "${dir}" must have source ./plugins/${dir}`);
    }
    for (const name of listed.keys()) {
        if (!pluginDirs.includes(name)) fail(`${rel(file)}: lists "${name}", which is not a directory in plugins/`);
    }
    return marketplace;
}

const claudeMarketplace = checkListing(CLAUDE_MARKETPLACE, (entry) => entry.source);
const codexMarketplace = checkListing(CODEX_MARKETPLACE, (entry) =>
    typeof entry.source === 'string' ? entry.source : entry.source?.path
);
if (claudeMarketplace && codexMarketplace && claudeMarketplace.name !== codexMarketplace.name) {
    fail(`marketplace name is "${claudeMarketplace.name}" for Claude Code but "${codexMarketplace.name}" for Codex`);
}
for (const entry of codexMarketplace?.plugins ?? []) {
    if (!entry.policy?.installation || !entry.policy?.authentication || !entry.category) {
        fail(`${rel(CODEX_MARKETPLACE)}: "${entry.name}" needs policy.installation, policy.authentication and category`);
    }
}

// ── Skills ───────────────────────────────────────────────────────────────────

/** Top-level `key: value` pairs of a SKILL.md frontmatter, keeping each raw value. */
function readFrontmatter(file) {
    const match = read(file).match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) {
        fail(`${rel(file)}: no YAML frontmatter`);
        return {};
    }
    const fields = {};
    for (const line of match[1].split('\n')) {
        if (line.trim() === '' || /^\s/.test(line)) continue; // blank, or nested under `metadata`
        const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
        if (!pair) {
            fail(`${rel(file)}: cannot parse frontmatter line "${line}"`);
            continue;
        }
        const [, key, raw] = pair;
        fields[key] = { raw, value: raw.replace(/^(['"])(.*)\1$/, '$2') };
    }
    return fields;
}

const LINK = /\]\(([^)\s]+)\)/g;

for (const plugin of pluginDirs) {
    const skillsDir = join(PLUGINS_DIR, plugin, 'skills');
    const skillDirs = subdirs(skillsDir);

    for (const dir of skillDirs) {
        const file = join(skillsDir, dir, 'SKILL.md');
        if (!existsSync(file)) {
            fail(`${rel(join(skillsDir, dir))}: no SKILL.md`);
            continue;
        }
        const fields = readFrontmatter(file);

        for (const [key, { raw }] of Object.entries(fields)) {
            if (!FRONTMATTER_KEYS.has(key)) fail(`${rel(file)}: frontmatter key "${key}" is not in the Agent Skills spec`);
            // Unquoted YAML breaks on ": " and " #", and block scalars defeat simple parsers.
            if (!/^['"]/.test(raw) && (/: | #/.test(raw) || /^[>|]/.test(raw))) {
                fail(`${rel(file)}: quote the "${key}" value or keep it on one line without ": " and " #"`);
            }
        }

        const name = fields.name?.value;
        if (name !== dir) fail(`${rel(file)}: name "${name ?? ''}" must equal the directory name "${dir}"`);
        if (!name || name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
            fail(`${rel(file)}: name must be 1-64 lowercase letters, digits and single hyphens`);
        }

        const description = fields.description?.value ?? '';
        if (!description) fail(`${rel(file)}: no description`);
        if (description.length > 1024) fail(`${rel(file)}: description is ${description.length} characters; the limit is 1024`);
        if (description && !description.startsWith('Use when')) fail(`${rel(file)}: description must start with "Use when"`);

        const lines = read(file).split('\n').length;
        if (lines > MAX_SKILL_LINES) {
            fail(`${rel(file)}: ${lines} lines; keep SKILL.md under ${MAX_SKILL_LINES} and move detail into files beside it`);
        }
    }

    for (const file of existsSync(skillsDir) ? walk(skillsDir).filter((path) => path.endsWith('.md')) : []) {
        const [skill] = relative(skillsDir, file).split(sep);
        const skillRoot = skillDirs.includes(skill) ? join(skillsDir, skill) : null;
        for (const [, target] of read(file).matchAll(LINK)) {
            if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // anchor or URL
            const path = resolve(dirname(file), decodeURI(target.split('#')[0]));
            if (!existsSync(path)) {
                fail(`${rel(file)}: broken link "${target}"`);
            } else if (skillRoot && !`${path}${sep}`.startsWith(`${skillRoot}${sep}`)) {
                fail(`${rel(file)}: link "${target}" leaves the skill directory; installers copy each skill on its own`);
            }
        }
    }
}

// ── bob-gateway: facts restated from bob-collective/bob ─────────────────────

async function bobSource(path) {
    if (BOB) return read(join(resolve(BOB), path));
    const response = await fetch(`${BOB_RAW}/${path}`);
    if (!response.ok) throw new Error(`GET ${BOB_RAW}/${path}: HTTP ${response.status}`);
    return response.text();
}

async function checkGateway() {
    const SKILLS_DIR = join(PLUGINS_DIR, 'bob-gateway/skills');
    const API_REFERENCE = join(SKILLS_DIR, 'gateway-integrate/api-reference.md');
    const SPENDER_TABLE = join(SKILLS_DIR, 'gateway-swap/SKILL.md');
    const OPENAPI = 'gateway-docs/openapi.json';
    const ALLOWANCE_HOLDER_TS = 'sdk/src/gateway/allowance-holder.ts';
    const SDK_CLIENT_TS = 'sdk/src/gateway/client.ts';
    const from = (path) => `bob-collective/bob ${path}`;

    // Upper-case identifiers the skills may name that are not in the OpenAPI spec.
    const KNOWN_IDENTIFIERS = {
        GATEWAY_API_KEY: 'environment variable',
        BOB_GATEWAY_MCP_URL: 'environment variable',
    };

    let sources;
    try {
        sources = Object.fromEntries(
            await Promise.all([OPENAPI, ALLOWANCE_HOLDER_TS, SDK_CLIENT_TS].map(async (path) => [path, await bobSource(path)]))
        );
    } catch (error) {
        fail(`cannot read the bob-gateway sources: ${error.message}`);
        return;
    }
    const markdownFiles = walk(SKILLS_DIR).filter((path) => path.endsWith('.md'));

    // OpenAPI spec: endpoints and error codes
    const spec = JSON.parse(sources[OPENAPI]);
    const normalize = (path) => path.replace(/\{[^}]*\}/g, '{}');
    const METHODS = ['get', 'put', 'post', 'patch', 'delete'];
    const specOperations = new Set(
        Object.entries(spec.paths)
            .filter(([path]) => path.startsWith('/v4/'))
            .flatMap(([path, item]) =>
                Object.keys(item)
                    .filter((method) => METHODS.includes(method))
                    .map((method) => `${method.toUpperCase()} ${normalize(path)}`)
            )
    );

    const ENDPOINT = /\b(GET|PUT|POST|PATCH|DELETE) (\/v4\/[\w\-/{}]+)/g;
    const operationsIn = (file) => [...read(file).matchAll(ENDPOINT)].map(([, method, path]) => [method, path]);

    for (const file of markdownFiles) {
        for (const [method, path] of operationsIn(file)) {
            if (!specOperations.has(`${method} ${normalize(path)}`)) fail(`${rel(file)}: ${method} ${path} is not in ${from(OPENAPI)}`);
        }
    }
    const documented = new Set(operationsIn(API_REFERENCE).map(([method, path]) => `${method} ${normalize(path)}`));
    for (const operation of specOperations) {
        if (!documented.has(operation)) fail(`${rel(API_REFERENCE)}: ${operation} is in the OpenAPI spec but not listed`);
    }

    const IDENTIFIER = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
    const specIdentifiers = new Set(JSON.stringify(spec).match(IDENTIFIER));
    for (const file of markdownFiles) {
        for (const [, identifier] of read(file).matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) {
            if (!specIdentifiers.has(identifier) && !(identifier in KNOWN_IDENTIFIERS)) {
                fail(`${rel(file)}: \`${identifier}\` is not in ${from(OPENAPI)}; fix it, or add it to KNOWN_IDENTIFIERS with a reason`);
            }
        }
    }

    // AllowanceHolder spenders
    const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    /** Hex form of a Tron Base58 address: 0x41 prefix, 20-byte address, 4-byte checksum. */
    function tronToHex(address) {
        let value = 0n;
        for (const char of address) {
            const digit = BASE58.indexOf(char);
            if (digit < 0) return null;
            value = value * 58n + BigInt(digit);
        }
        const hex = value.toString(16).padStart(50, '0');
        return hex.length === 50 && hex.startsWith('41') ? `0x${hex.slice(2, 42)}` : null;
    }

    const toHex = (address) => (address.startsWith('T') ? tronToHex(address) : address.toLowerCase());

    function sdkSpenders() {
        const source = sources[ALLOWANCE_HOLDER_TS];
        const constants = Object.fromEntries(
            [...source.matchAll(/const (\w+): Address = '(0x[0-9a-fA-F]{40})'/g)].map(([, name, address]) => [name, address.toLowerCase()])
        );
        const table = source.match(/ALLOWANCE_HOLDER_BY_CHAIN[^{]*\{([\s\S]*?)\n\}/)?.[1];
        if (!table) {
            fail(`${from(ALLOWANCE_HOLDER_TS)}: cannot find ALLOWANCE_HOLDER_BY_CHAIN`);
            return {};
        }
        return Object.fromEntries(
            [...table.matchAll(/^\s*['"]?([\w-]+)['"]?:\s*(\w+),/gm)].map(([, chain, constant]) => [chain, constants[constant]])
        );
    }

    function skillSpenders() {
        const spenders = {};
        const ROW = /^\|(.*)\|\s*`(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})`\s*\|\s*$/gm;
        for (const [, chains, address] of read(SPENDER_TABLE).matchAll(ROW)) {
            for (const [, chain] of chains.matchAll(/`([a-z0-9-]+)`/g)) spenders[chain] = toHex(address);
        }
        return spenders;
    }

    const expected = sdkSpenders();
    const actual = skillSpenders();
    for (const [chain, address] of Object.entries(expected)) {
        if (actual[chain] !== address) {
            fail(`${rel(SPENDER_TABLE)}: spender for "${chain}" is ${actual[chain] ?? 'missing'}; the SDK has ${address}`);
        }
    }
    for (const chain of Object.keys(actual)) {
        if (!(chain in expected)) fail(`${rel(SPENDER_TABLE)}: spender listed for "${chain}", which the SDK does not know`);
    }

    // Every chain with a spender needs a row in the approve-page table, even if it says "none".
    const approvePages = read(SPENDER_TABLE).match(/^\| Source chain \| Approve page \|\n\|[-|]+\|\n((?:\|.*\|\n)+)/m)?.[1];
    if (!approvePages) {
        fail(`${rel(SPENDER_TABLE)}: no "| Source chain | Approve page |" table`);
    } else {
        const pageChains = new Set(
            [...approvePages.matchAll(/^\|([^|]*)\|/gm)].flatMap(([, cell]) => [...cell.matchAll(/`([a-z0-9-]+)`/g)].map(([, chain]) => chain))
        );
        for (const chain of Object.keys(expected)) {
            if (!pageChains.has(chain)) fail(`${rel(SPENDER_TABLE)}: no approve page row for "${chain}"`);
        }
        for (const chain of pageChains) {
            if (!(chain in expected)) fail(`${rel(SPENDER_TABLE)}: approve page row for "${chain}", which has no spender`);
        }
    }

    // The legacy-USDT warning must name the token the SDK resets before approving.
    const legacyUsdt = sources[SDK_CLIENT_TS].match(/export const ETHEREUM_USDT_ADDRESS = '(0x[0-9a-fA-F]{40})'/)?.[1];
    if (!legacyUsdt) {
        fail(`${from(SDK_CLIENT_TS)}: cannot find ETHEREUM_USDT_ADDRESS`);
    } else if (!read(SPENDER_TABLE).toLowerCase().includes(legacyUsdt.toLowerCase())) {
        fail(`${rel(SPENDER_TABLE)}: the legacy USDT warning does not name ${legacyUsdt}, which the SDK resets before approving`);
    }
}

if (pluginDirs.includes('bob-gateway')) await checkGateway();

// ── Version bump ─────────────────────────────────────────────────────────────

if (BASE) {
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const dir of pluginDirs) {
        const version = manifests[dir]?.version;
        if (!version) continue;
        const changed = git('diff', '--name-only', `${BASE}...HEAD`, '--', `plugins/${dir}`).trim();
        let baseVersion;
        try {
            baseVersion = JSON.parse(git('show', `${BASE}:plugins/${dir}/.claude-plugin/plugin.json`)).version;
        } catch {
            // The plugin does not exist on the base yet: nothing to compare.
        }
        if (changed && baseVersion === version) {
            fail(`plugins/${dir}: changed since ${BASE}, but the version is still ${version}; bump it in both plugin.json files`);
        }
    }
}

// ── Report ───────────────────────────────────────────────────────────────────

if (errors.size > 0) {
    for (const message of errors) console.error(`✗ ${message}`);
    console.error(`\n${errors.size} problem(s) in the plugins.`);
    process.exit(1);
}
console.log(`✓ ${pluginDirs.length} plugin(s) checked`);
