# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Airlock is an MCP (Model Context Protocol) stdio server that enables agentic tools (Claude Code, Codex) to automate local Electron desktop applications during development. It uses Playwright's Electron support with a snapshot-act-snapshot loop and safety/policy controls.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run MCP server with tsx (hot reload)
npm run start          # Run compiled server from dist/
npm run test           # Run tests with Vitest
npm run typecheck      # TypeScript type checking (no emit)
npm run lint           # TypeScript type checking (non-pretty output)
npm run format:check   # Prettier check for src/**/*.ts
```

## Architecture

### Flow

```text
Agent (Claude Code / Codex)
  → MCP Server (stdio transport, src/server.ts)
    → Policy + Confirmation Gates (src/policy, src/confirmation)
      → SessionManager (src/session-manager.ts)
        → ElectronDriver (src/driver/playwright.ts)
          → Playwright _electron.launch() or chromium.connectOverCDP()
```

### Key Layers

- **CLI (`src/cli.ts`)** — Entry point. Parses env vars and CLI flags (`AIRLOCK_MODE`, `AIRLOCK_PRESET`, `AIRLOCK_POLICY`, `AIRLOCK_ARTIFACT_ROOT`, `--policy`). Resolves policy and starts `AirlockServer`.
- **Server (`src/server.ts`)** — `AirlockServer` class. Registers tools, validates I/O via Zod, enforces mode + policy + confirmation gates, normalizes MCP envelopes, and records redacted events.
- **SessionManager (`src/session-manager.ts`)** — In-memory map of `sessionId → ManagedSession`. Handles TTL cleanup, ref maps, trace state, and window-default tracking.
- **Driver (`src/driver/`)** — `ElectronDriver` interface in `index.ts`, Playwright implementation in `playwright.ts`. Supports launch, attach, tracing, snapshots, actions, console/network capture.
- **Launch Orchestration (`src/launch/`)**
  - `src/launch/presets.ts` — Versioned preset DSL (electron-vite, forge webpack/vite, electron-builder, pre-launched-attach).
  - `src/launch/readiness.ts` — Composable readiness signal engine.
  - `src/launch/diagnostics.ts` — Launch diagnostics (process buffers, timeline, env summary).
  - `src/launch/playbooks.ts` — Known failure playbooks and matcher.
  - `src/launch/index.ts` — Orchestrates preset flows, attach, fallback, readiness, diagnostics.
- **Policy (`src/policy/`)** — Policy-as-code loader/validator/merger (JSON or YAML), mode ceiling checks, tool disable/confirmation policy, redaction patterns.
- **Confirmation (`src/confirmation/`)** — Pending-confirmation store + helpers used by server confirmation-gate protocol and `confirm` tool.
- **Tools (`src/tools/`)** — 35 MCP tools following `defineAirlockTool()`.
- **Snapshot (`src/snapshot/`)** — Snapshot normalization, token caps, query/viewport/region modes, diffing, and `RefMap` cross-epoch re-resolution.
- **Types (`src/types/`)** — Brand types (`SessionId`, `WindowId`, `RefId`), policy/types, error model, and full Zod schemas.

### Safety Model (3 Modes + Policy)

| Mode             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `safe` (default) | No app kill, no tracing, localhost-only origin defaults                      |
| `standard`       | Enables app kill, tracing, broader selector/origin capability                |
| `trusted`        | Highest capability profile (includes `allowTrustedEval` in capability model) |

Additional V2 safety controls:

- **Policy-as-code**: load policy from JSON/YAML (`AIRLOCK_POLICY` or `--policy`) via `src/policy/`.
- **Tool policy gates**: per-tool disable + per-tool confirmation requirements enforced in `src/server.ts`.
- **Confirmation protocol**: gated tools return `requiresConfirmation` + `confirmationId`; approve with `confirm` tool.
- **Redaction**: event log applies key-based redaction plus policy regex patterns.

### Tool Surface

`src/tools/index.ts` registers **35 tools**:

- Session/Lifecycle: `app_launch`, `app_close`, `app_kill`, `session_info`
- Windowing: `window_list`, `window_focus`, `window_default_get`, `window_default_set`, `wait_for_window`
- Snapshot/Context: `snapshot_interactive`, `snapshot_viewport`, `snapshot_query`, `snapshot_diff`, `snapshot_region`, `scroll_to`
- Actions: `click`, `type`, `press_key`, `select`, `hover`, `screenshot`
- Waits: `wait_for_idle`, `wait_for_visible`, `wait_for_text`
- Observability/Diagnostics: `console_recent`, `network_recent`, `trace_start`, `trace_stop`, `export_artifacts`, `diagnose_session`, `doctor`, `server_status`, `capabilities`
- Safety/Control: `confirm`, `server_reset`

### Artifacts

Session artifacts are written under `.airlock/electron/`:

- `artifacts/<sessionId>/...` (screenshots, exports)
- `logs/`
- `traces/`

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP transport and server
- `zod` — Runtime schema validation
- `yaml` — Policy file parsing (YAML)
- `playwright` (peer dep) — Electron + CDP automation

## Detailed Codebase Map

For architecture, module guide, data flow diagrams, and navigation guide, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Spec & Roadmap

- `docs/airlock-technical.md` — Full technical specification
- `docs/airlock-roadmap-1.md` — V1 scope and baseline plan
- `docs/airlock-roadmap-2.md` — V2 roadmap
- `docs/airlock-roadmap-3-and-beyond.md` — Long-term strategy
- `docs/airlock-v1-status.md` — V1 shipped state
- `docs/airlock-v2-status.md` — V2 shipped state
