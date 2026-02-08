# Airlock Skill Packaging & Distribution Gameplan

Date: 2026-02-07
Status: Draft
References: [airlock-skills-claude-code.md](./airlock-skills-claude-code.md), [airlock-skills-codex.md](./airlock-skills-codex.md)

## 1. Goal

Ship Airlock as a usable skill for both **Claude Code** and **Codex**, with a frictionless install path and a safe-by-default experience. This document covers repo structure, packaging, distribution, CLI alignment, and a phased implementation plan.

## 2. Current State Assessment

### What exists

| Asset                 | Status              | Notes                                                         |
| --------------------- | ------------------- | ------------------------------------------------------------- |
| MCP server (stdio)    | Working             | 35 tools, 228 tests, zero type errors                         |
| CLI entry point       | Working             | `dist/cli.js` with shebang, `serve` + `help` commands         |
| `bin` in package.json | Present             | `"airlock-electron-mcp": "dist/cli.js"`                       |
| Driver (Playwright)   | Working             | CDP attach validated against real Electron app                |
| Snapshot pipeline     | Working (with bugs) | 47 nodes captured, but parser has quality issues (see §3)     |
| Action pipeline       | Working             | Click by CSS/ref, fill/type all validated                     |
| Skills                | **Not written**     | Spec exists in docs, SKILL.md files not yet authored          |
| MCP config examples   | **Not written**     | `.mcp.json` and `.codex/config.toml` not yet created          |
| npm packaging         | **Incomplete**      | Missing `files`, `exports`, `prepublishOnly`, LICENSE, README |
| CLI naming            | **Misaligned**      | Docs say `airlock-electron`, bin says `airlock-electron-mcp`  |

### Blocking issues from integration testing

These must be resolved before the skill experience is acceptable:

1. **`parseAriaBullet` parser bugs** — `paragraph: text` lines dropped, `[disabled]`/`[level=N]` annotations leak into names, quoted names not stripped correctly
2. **Console/network logs empty in CDP attach mode** — domains not explicitly enabled
3. **No readiness gate for CDP attach** — snapshot can hit unrendered state
4. **Double document root** — synthetic wrapper redundant with Playwright's `- document:` line

## 3. Repo Structure Proposal

### Current

```
airlock-electron-mcp/
  src/                # TypeScript source
  dist/               # Compiled output
  docs/               # Specs, roadmaps, status
  .airlock/           # Runtime artifacts (gitignored)
  coverage/           # Test coverage (gitignored)
  test-diag-*.mjs     # Ad-hoc integration test scripts
```

### Proposed

```
airlock-electron-mcp/
  src/                    # MCP server source (unchanged)
  dist/                   # Compiled output (unchanged)
  docs/                   # Specs, roadmaps, status (unchanged)

  integrations/
    claude-code/
      skills/
        airlock-electron/
          SKILL.md                  # Claude Code skill
      mcp.json.example              # .mcp.json template
      settings.json.example         # .claude/settings.json permissions template
      README.md                     # Claude Code setup instructions

    codex/
      skills/
        airlock-electron/
          SKILL.md                  # Codex skill
          agents/
            openai.yaml             # Optional UI metadata
      config.toml.example           # .codex/config.toml template
      README.md                     # Codex setup instructions

  README.md                 # User-facing project README
  LICENSE                   # MIT or similar
  CLAUDE.md                 # Dev guidance (unchanged, not published)
  AGENTS.md                 # Dev guidance (unchanged, not published)
```

### Why skills belong in this repo

- **Tight coupling**: SKILL.md references specific tool names, parameters, and operating procedures that must match the server's tool surface. When tools change, skills must update.
- **Single source of truth**: Avoids drift between server and skill docs.
- **Versionable together**: A git tag covers both the server and the skill instructions.
- **Easy to extract later**: If a separate plugin package is needed (Claude Code plugin, Codex skill repo), it can pull from `integrations/` at build time.

### What gets published to npm

Only the MCP server + CLI. Skills and config examples are **not** published to npm — they're consumed by copying from the repo or from a separate distribution mechanism (see §7).

## 4. CLI Naming Alignment

### The problem

The two skill spec docs reference the CLI as `airlock-electron` with a subcommand pattern:

```bash
airlock-electron mcp serve --stdio
```

But the current binary is named `airlock-electron-mcp` with a simpler pattern:

```bash
airlock-electron-mcp serve
```

### Recommendation: keep `airlock-electron-mcp` as primary, add `airlock-electron` alias

Add a second bin entry:

```json
{
  "bin": {
    "airlock-electron-mcp": "dist/cli.js",
    "airlock-electron": "dist/cli.js"
  }
}
```

Both resolve to the same entry point. The CLI already defaults to `serve` when invoked without a subcommand, so both invocation styles work:

```bash
# These all do the same thing:
airlock-electron-mcp serve
airlock-electron-mcp
airlock-electron serve
airlock-electron
```

The `mcp serve --stdio` pattern from the spec docs is redundant since the server always runs on stdio. Update the skill docs to match reality rather than adding unnecessary subcommand nesting.

### Updated invocation for MCP configs

```json
{ "command": "airlock-electron-mcp", "args": ["serve"] }
```

or

```json
{ "command": "npx", "args": ["airlock-electron-mcp", "serve"] }
```

The `npx` variant works without global install.

## 5. Package.json Changes

```jsonc
{
  "name": "airlock-electron-mcp",
  "version": "0.1.0",
  "type": "module",
  "description": "MCP server for agentic Electron app automation via Playwright",
  "license": "MIT",
  "bin": {
    "airlock-electron-mcp": "dist/cli.js",
    "airlock-electron": "dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./driver": {
      "types": "./dist/driver/index.d.ts",
      "import": "./dist/driver/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "prepublishOnly": "npm run typecheck && npm run test && npm run build"
  },
  "engines": {
    "node": ">=18"
  }
}
```

### Notes

- `exports` makes the driver importable for integration tests and custom setups: `import { createPlaywrightElectronDriver } from "airlock-electron-mcp/driver"`
- `files` keeps the published package minimal (~100KB dist vs multi-MB with docs/tests)
- `prepublishOnly` prevents publishing broken builds
- Need to create a `src/index.ts` barrel export if one doesn't exist
- `engines` documents the minimum Node version

## 6. Skill Authoring

### Differences from spec docs

The spec docs were written before integration testing. Key adjustments based on real findings:

| Spec assumption                                | Reality                                                      | Skill adjustment                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| "One bulletproof preset (electron-vite)"       | Most real apps use plain Vite+Electron, not electron-vite    | Skills should document CDP attach as the primary path for v1, with preset launch as secondary |
| "Snapshot returns role+name"                   | Names contain YAML annotations until parser is fixed         | Skills should note that refs (`ax-N`) are the most reliable locator, not role+name            |
| Tool names: `snapshot`, `console_messages`     | Actual names: `snapshot_interactive`, `console_recent`       | Skills must use actual tool names                                                             |
| `evaluate_js`, `ipc_invoke` as high-risk tools | These don't exist in v2                                      | Permissions examples need updating                                                            |
| `wait_for_selector`, `wait_for_load_state`     | Actual: `wait_for_visible`, `wait_for_idle`, `wait_for_text` | Update all references                                                                         |

### Skill authoring plan

1. **Write `integrations/claude-code/skills/airlock-electron/SKILL.md`** — adapted from spec §5.2 with corrected tool names and updated operating procedure
2. **Write `integrations/codex/skills/airlock-electron/SKILL.md`** — adapted from spec §5.3
3. **Write config examples** — `.mcp.json`, `settings.json`, `config.toml`
4. **Write integration READMEs** — step-by-step setup for each platform

### Locator strategy (updated for skills)

Based on integration testing, the recommended locator priority for SKILL.md:

1. **CSS selector** — most reliable today (refs change per snapshot, role+name has parser issues)
2. **Ref (`ax-N`)** — reliable within a single snapshot epoch
3. **Role + accessible name** — once parser bugs are fixed, this becomes preferred
4. **data-testid** — if the app uses them

This priority inverts once the P0 parser fixes land, at which point role+name becomes primary.

## 7. Distribution Strategy

### Phase 1: Repo-local (immediate)

Users clone or copy skill files into their project:

```bash
# Claude Code
mkdir -p .claude/skills/airlock-electron
cp <airlock-repo>/integrations/claude-code/skills/airlock-electron/SKILL.md .claude/skills/airlock-electron/
cp <airlock-repo>/integrations/claude-code/mcp.json.example .mcp.json

# Codex
mkdir -p .agents/skills/airlock-electron
cp <airlock-repo>/integrations/codex/skills/airlock-electron/SKILL.md .agents/skills/airlock-electron/
```

### Phase 2: npx init script (near-term)

Add an `init` subcommand to the CLI:

```bash
npx airlock-electron-mcp init --target claude-code
npx airlock-electron-mcp init --target codex
npx airlock-electron-mcp init --target both
```

This copies the appropriate skill files, config templates, and permissions into the current project. It's idempotent (won't overwrite existing files without `--force`).

### Phase 3: Claude Code plugin (future, post-adoption)

Package as a Claude Code plugin for one-command install across repos:

```bash
claude plugin add airlock-electron
```

This bundles the skill, MCP config, and permissions as a single installable unit. Only pursue this after validating the skill experience with Phase 1/2 users.

### npm publish strategy

- Publish `airlock-electron-mcp` to npm when v0.2.0 (with parser fixes) is ready
- The npm package is **CLI + library only** — no skills, no docs
- Skills and configs are distributed via repo copy or `init` command
- Consider `@airlock/electron-mcp` scoped name if publishing publicly (prevents name squatting)

## 8. Permissions: Safe Defaults

### Claude Code (`.claude/settings.json`)

```json
{
  "permissions": {
    "allow": [
      "mcp__airlock__capabilities",
      "mcp__airlock__server_status",
      "mcp__airlock__doctor",
      "mcp__airlock__window_list",
      "mcp__airlock__window_default_get",
      "mcp__airlock__snapshot_interactive",
      "mcp__airlock__snapshot_viewport",
      "mcp__airlock__snapshot_query",
      "mcp__airlock__snapshot_diff",
      "mcp__airlock__snapshot_region",
      "mcp__airlock__screenshot",
      "mcp__airlock__console_recent",
      "mcp__airlock__network_recent",
      "mcp__airlock__session_info"
    ],
    "ask": [
      "mcp__airlock__app_launch",
      "mcp__airlock__app_close",
      "mcp__airlock__app_kill",
      "mcp__airlock__click",
      "mcp__airlock__type",
      "mcp__airlock__press_key",
      "mcp__airlock__select",
      "mcp__airlock__hover",
      "mcp__airlock__scroll_to",
      "mcp__airlock__window_focus",
      "mcp__airlock__window_default_set",
      "mcp__airlock__wait_for_idle",
      "mcp__airlock__wait_for_visible",
      "mcp__airlock__wait_for_text",
      "mcp__airlock__wait_for_window",
      "mcp__airlock__trace_start",
      "mcp__airlock__trace_stop",
      "mcp__airlock__export_artifacts",
      "mcp__airlock__confirm"
    ],
    "deny": ["mcp__airlock__server_reset", "mcp__airlock__diagnose_session"]
  }
}
```

Rationale:

- **allow**: Read-only tools (snapshots, screenshots, logs, status) — no side effects
- **ask**: State-changing tools (launch, close, UI actions, tracing) — user sees what's happening
- **deny**: Destructive tools (server_reset, diagnose_session) — only for manual debugging

### Codex (`enabled_tools`)

```toml
[mcp_servers.airlock]
enabled_tools = [
  "app_launch", "app_close",
  "window_list", "window_focus", "window_default_get", "window_default_set",
  "snapshot_interactive", "snapshot_viewport", "snapshot_query", "snapshot_diff",
  "click", "type", "press_key", "select", "hover", "scroll_to",
  "screenshot", "console_recent", "network_recent",
  "wait_for_idle", "wait_for_visible", "wait_for_text", "wait_for_window",
  "session_info", "capabilities", "doctor"
]
```

Excludes: `app_kill`, `server_reset`, `trace_start`, `trace_stop`, `export_artifacts`, `diagnose_session`, `confirm`, `snapshot_region`.

## 9. Implementation Phases

### Phase 0: Parser Fixes (prerequisite)

**Must complete before any skill work.** Without these, the agent experience is degraded:

| Fix                                                      | Impact                                                  | Effort |
| -------------------------------------------------------- | ------------------------------------------------------- | ------ |
| Parse `role: text` format in ariaSnapshot                | Paragraph nodes silently dropped — agent misses content | Medium |
| Extract `[disabled]`/`[checked]`/`[level=N]` annotations | Agent can't determine element state                     | Medium |
| Strip quotes from names with annotations                 | Names contain literal `"` characters                    | Small  |
| Remove double document root                              | Wastes a node in token budget, confuses tree            | Small  |
| Enable CDP domains for console/network in attach         | Console/network tools return empty                      | Small  |
| Add readiness gate for CDP attach                        | First snapshot can hit blank state                      | Medium |

Estimated: 1–2 focused sessions.

### Phase 1: Packaging & Skill Authoring

After parser fixes:

1. Create `integrations/` directory structure
2. Write both SKILL.md files (Claude Code + Codex)
3. Write config examples (`.mcp.json`, `settings.json`, `config.toml`)
4. Write integration READMEs
5. Update `package.json` (`files`, `exports`, `prepublishOnly`, second bin alias)
6. Create `src/index.ts` barrel export
7. Add README.md and LICENSE at top level
8. Clean up test-diag scripts (move to `scripts/` or delete)

Estimated: 1 session.

### Phase 2: End-to-End Validation

1. Install Airlock skill in canon-keeper project (Claude Code)
2. Run a full agentic session: `/airlock-electron` → launch → snapshot → navigate → verify
3. Document friction points, adjust SKILL.md
4. Repeat for Codex if available
5. Record a demo (screenshot sequence or short walkthrough)

Estimated: 1 session.

### Phase 3: Distribution Polish

1. Implement `npx airlock-electron-mcp init` command
2. npm publish v0.2.0
3. Write quickstart guide for external users
4. Consider Claude Code plugin packaging if adoption warrants

Estimated: 1–2 sessions.

## 10. Open Questions

1. **License**: MIT is standard for dev tools. Confirm before creating LICENSE file.
2. **Scoped npm name**: `airlock-electron-mcp` (current) vs `@airlock/electron-mcp` (scoped). Scoped requires an npm org. Unscoped is simpler for v1.
3. **Codex availability**: Can we test the Codex skill path? If not, author it but defer validation.
4. **Plugin packaging**: Claude Code plugin distribution is the cleanest UX but requires more infrastructure. Defer to Phase 3 unless there's demand.
5. **Monorepo vs single package**: The current single-package structure works for now. If we add the `init` CLI command with template files, those templates need to be included in `files` or bundled differently. Consider this when implementing Phase 3.
