# Airlock Electron MCP

Airlock is a local-first MCP server that lets coding agents drive Electron apps with a browser-style loop: snapshot UI state, take action, validate, and collect artifacts.

It is built for real development workflows:

- 35 MCP tools across launch, windowing, snapshots, actions, waits, diagnostics, and safety controls.
- Playwright-backed Electron automation with both launch and CDP attach paths.
- Policy-as-code with mode ceilings, tool allow/deny controls, and confirmation gates.
- Deterministic ref-based snapshots for low-token, stable targeting.
- Artifact-first debugging with screenshots, console/network tails, traces, and export manifests.

## Why Airlock

Electron automation often breaks down into brittle selectors, ad-hoc scripts, and poor failure visibility. Airlock wraps that surface into a typed, auditable MCP server so agents can operate predictably in desktop UI flows.

If browser MCP tooling had a desktop sibling, this is it.

## Architecture (ASCII)

```text
┌──────────────────────────────┐   stdio MCP   ┌─────────────────────────────────────────────┐
│ Agent Client                 │◄─────────────►│ Airlock Server                               │
│ (Codex / Claude / MCP host)  │               │ src/cli.ts -> src/server.ts                 │
└──────────────────────────────┘               │ - tool registration + validation             │
                                               │ - policy + mode + confirmation gates         │
                                               │ - session manager + event log                │
                                               └──────────────────┬──────────────────────────┘
                                                                  │
              ┌───────────────────────────────────────────────────┼──────────────────────────────────────────────────┐
              │                                                   │                                                  │
     ┌────────▼─────────┐                                ┌────────▼─────────┐                               ┌────────▼─────────┐
     │ Launch Engine     │                                │ Snapshot + Action │                               │ Diagnostics       │
     │ src/launch/*      │                                │ src/snapshot/*    │                               │ src/tools/doctor  │
     │ presets/readiness │                                │ src/actions/*     │                               │ src/artifacts/*   │
     └────────┬──────────┘                                └────────┬──────────┘                               └────────┬──────────┘
              │                                                   │                                                  │
              └───────────────────────────────────────┬───────────┴──────────────────────────────────────────────────┘
                                                      │
                                         ┌────────────▼────────────────────┐
                                         │ Playwright Electron Driver       │
                                         │ src/driver/playwright.ts         │
                                         │ - launch/attach, windows, input  │
                                         │ - snapshot extraction, logs, trace│
                                         └────────────┬─────────────────────┘
                                                      │
                             ┌────────────────────────▼────────────────────────┐
                             │ Local Electron app + optional dev server / CDP │
                             └─────────────────────────────────────────────────┘
```

## Feature Highlights

- `app_launch` orchestration with preset DSL v2 (`electron-vite`, `electron-forge-webpack`, `electron-forge-vite`, `electron-builder`, `pre-launched-attach`).
- Snapshot suite: `snapshot_interactive`, `snapshot_viewport`, `snapshot_query`, `snapshot_diff`, `snapshot_region`.
- Action suite: `click`, `type`, `press_key`, `select`, `hover`, `scroll_to`, `screenshot`.
- Wait suite: `wait_for_idle`, `wait_for_visible`, `wait_for_text`, `wait_for_window`.
- Operational tools: `doctor`, `capabilities`, `server_status`, `session_info`, `export_artifacts`, `trace_start`, `trace_stop`, `diagnose_session`.
- Safety controls: `safe`/`standard`/`trusted` modes, policy-based tool disables, confirmation workflow via `confirm`.

## Project Layout

Core runtime code lives in `src/`.

- `src/cli.ts`: CLI entrypoint and runtime bootstrap.
- `src/server.ts`: MCP server, tool registration, validation, policy/confirmation gates.
- `src/tools/`: MCP tool handlers (`coreTools`, 35 tools).
- `src/driver/`: Electron driver interface + Playwright implementation.
- `src/launch/`: launch orchestration, presets, readiness chain, diagnostics, playbooks.
- `src/policy/`: policy schema/loader/merge.
- `src/confirmation/`: pending confirmation storage + helpers.
- `src/snapshot/`: snapshot build/query/diff/region + ref-map logic.
- `src/actions/`: target resolution + action execution.
- `src/artifacts/`: artifact directories and export manifests.
- `src/types/`: schemas, IDs, safety/policy types, error definitions.
- `src/utils/`: logging, event-log redaction, time helpers.
- `docs/`: architecture, roadmap, and technical notes.

For a deep module index, see `docs/CODEBASE_MAP.md`.

## Requirements

- Node.js 20+ recommended.
- `npm`.
- `playwright` installed in the same workspace (peer dependency).
- A local Electron project you want to automate.

## Setup

### 1. Install dependencies

```bash
npm install
npm install playwright
```

### 2. Build (for production-style execution)

```bash
npm run build
```

### 3. Run the server

Development mode:

```bash
npm run dev
```

Built mode:

```bash
npm run start
```

CLI help:

```bash
node dist/cli.js help
```

## MCP Client Wiring

Airlock runs as a stdio MCP server.

Example (generic MCP client using built output):

```toml
[mcp_servers.airlock]
command = "node"
args = ["/absolute/path/to/airlock-electron-mcp/dist/cli.js", "serve"]

[mcp_servers.airlock.env]
AIRLOCK_MODE = "safe"
```

If installed globally and on `PATH`, you can use:

```toml
[mcp_servers.airlock]
command = "airlock-electron-mcp"
args = ["serve"]
```

## How To Use

Typical session loop:

1. Run preflight diagnostics.
2. Launch or attach to an Electron session.
3. Discover the target window and snapshot the UI.
4. Perform actions by ref (`e1`, `e2`, ...) when possible.
5. Wait/assert, collect artifacts, then close.

### 1) Preflight

Call:

```json
{}
```

on tool `doctor`.

Then call `capabilities` to verify active mode and enabled tools.

### 2) Launch

Tool: `app_launch`

```json
{
  "projectRoot": "/absolute/path/to/your/electron-app",
  "preset": "electron-vite"
}
```

Response includes `sessionId`, discovered windows, and session artifact directory.

### 3) Snapshot and Act

Tool: `snapshot_interactive`

```json
{
  "sessionId": "YOUR_SESSION_ID"
}
```

Use returned refs for actions:

Tool: `click`

```json
{
  "sessionId": "YOUR_SESSION_ID",
  "target": { "ref": "e12" }
}
```

Tool: `type`

```json
{
  "sessionId": "YOUR_SESSION_ID",
  "target": { "ref": "e18" },
  "text": "hello world",
  "replace": true
}
```

### 4) Observe and Diagnose

- `console_recent` for renderer console tails.
- `network_recent` for recent network activity.
- `trace_start` / `trace_stop` for Playwright tracing.
- `diagnose_session` for health/recency checks.
- `export_artifacts` for a manifest of screenshot/log/trace outputs.

### 5) Cleanup

Tool: `app_close`

```json
{
  "sessionId": "YOUR_SESSION_ID"
}
```

`app_kill` is available in `standard` and `trusted` modes when force termination is needed.

## Runtime Configuration

### Environment variables

- `AIRLOCK_MODE`: `safe` (default), `standard`, or `trusted`.
- `AIRLOCK_PRESET`: default preset used when `app_launch` omits `preset`.
- `AIRLOCK_POLICY`: path to JSON/YAML policy file.
- `AIRLOCK_ARTIFACT_ROOT`: root output directory (default resolves to `.airlock/electron` in project root).

### Safety modes

| Mode       | Intended posture          | Session TTL default | Notable capabilities                                              |
| ---------- | ------------------------- | ------------------- | ----------------------------------------------------------------- |
| `safe`     | Lowest-risk default       | 30 minutes          | Localhost-style origin defaults and conservative runtime behavior |
| `standard` | Balanced local automation | 2 hours             | Adds `file://` origin allowance and enables `app_kill`            |
| `trusted`  | Maximum local control     | 8 hours             | Wildcard origin allowance and the broadest capability envelope    |

### Policy-as-code

Policy files support JSON or YAML, schema version `1`.

Example `airlock-policy.yaml`:

```yaml
version: 1
mode: safe
allowedOrigins:
  - "http://localhost:5173"
tools:
  disabled:
    - "app_kill"
  requireConfirmation:
    - "server_reset"
maxSessionTTLMs: 1200000
maxSnapshotNodes: 200
redactionPatterns:
  - "(?i)api[_-]?key\\s*=\\s*[^\\s]+"
```

Run with policy:

```bash
npm run dev -- --policy ./airlock-policy.yaml
```

When a tool requires confirmation, Airlock returns a `confirmationId`. Confirm with `confirm`, then re-run the original tool with the same params plus `confirmationId`.

## Development Commands

- `npm run dev`: start local stdio server from source.
- `npm run build`: compile TypeScript to `dist/`.
- `npm run start`: run built server.
- `npm run lint`: TypeScript no-emit structural check.
- `npm run typecheck`: strict project typecheck.
- `npm test`: run Vitest suite.
- `npm run format:check`: Prettier verification.

## Contributing

1. Fork and branch from `main`.
2. Keep changes focused and module-local where possible.
3. Add or update `*.test.ts` files near changed code.
4. Run the full verification set before opening a PR:

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
```

5. Use Conventional Commits (example: `feat(tools): add wait-for-window matcher`).
6. Include PR notes with behavior changes, test evidence, and artifacts/screenshots for UI automation changes.

## License

This project is licensed under the MIT License. See `LICENSE` for full text.
