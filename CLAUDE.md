# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Airlock is an MCP (Model Context Protocol) stdio server that enables agentic tools (Claude Code, Codex) to automate local Electron desktop applications during development. It uses Playwright's experimental Electron support to provide a snapshot-act-snapshot loop similar to browser automation.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run MCP server with tsx (hot reload)
npm run start          # Run compiled server from dist/
npm run test           # Run tests with Vitest
npm run typecheck      # TypeScript type checking (no emit)
npm run lint           # TypeScript type checking (non-pretty output)
```

## Architecture

### Flow

```
Agent (Claude Code / Codex)
  → MCP Server (stdio transport, src/server.ts)
    → SessionManager (src/session-manager.ts)
      → ElectronDriver (src/driver/playwright.ts)
        → Playwright _electron.launch() or chromium.connectOverCDP()
```

### Key Layers

- **CLI (`src/cli.ts`)** — Entry point. Parses env vars `AIRLOCK_MODE`, `AIRLOCK_PRESET`, `AIRLOCK_ARTIFACT_ROOT`. Creates and starts the AirlockServer.
- **Server (`src/server.ts`)** — `AirlockServer` class. Registers all tools with the MCP SDK, validates inputs/outputs via Zod, normalizes errors into `{ ok, result?, error? }` envelopes.
- **SessionManager (`src/session-manager.ts`)** — In-memory map of `sessionId → ManagedSession`. Handles TTL-based cleanup, per-window RefMaps, and cleanup callbacks (kill Electron process, close dev server).
- **Driver (`src/driver/`)** — `ElectronDriver` interface in `index.ts`, Playwright implementation in `playwright.ts`. Manages ElectronApplication/Browser/Page instances, accessibility tree extraction, action execution, console log capture.
- **Launch (`src/launch/index.ts`)** — Launch presets (e.g. `electron-vite`). Orchestrates dev server spawning, readiness detection via regex, Electron launch, and CDP attach fallback.
- **Tools (`src/tools/`)** — 16 tools following `defineAirlockTool()` pattern. Each has a Zod input/output schema and an async handler receiving `AirlockToolContext`.
- **Snapshot (`src/snapshot/`)** — Flattens accessibility tree, assigns ephemeral `ref` IDs (e.g. "e1", "e2"), stores RefMap for later action resolution. Truncates to `maxNodes`/`maxTextCharsPerNode`.
- **Types (`src/types/`)** — Brand types (`SessionId`, `WindowId`, `RefId`), Zod schemas for all tool I/O, safety policy definitions, error types.

### Safety Model (3 Modes)

| Mode             | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `safe` (default) | No code execution, localhost-only origins, no app kill      |
| `standard`       | Adds file:// origins, raw CSS selectors, app kill           |
| `trusted`        | Adds main-process eval via IPC bridge (not yet implemented) |

### Tool Target Resolution

Action tools (click, type, wait_for_visible) accept one target type:

- `ref` — Ephemeral ID from most recent snapshot (preferred)
- `role` + `name` — Accessibility role/name pair
- `testId` — `data-testid` attribute
- `css` — CSS selector (standard mode+)
- `selector` — Playwright selector (standard mode+)

Refs are tied to a specific snapshot version. The RefMap stores `refId → { role, name, nth }` to re-locate elements across snapshots.

### Artifacts

Session artifacts (screenshots, snapshots, logs, traces) are written to `.airlock/electron/artifacts/<sessionId>/`.

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP transport and server
- `zod` — Runtime schema validation for all tool I/O
- `playwright` (peer dep) — Electron and Chrome automation

## Detailed Codebase Map

For comprehensive architecture details, import graph, data flow diagrams, module guide, and navigation guide, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Spec & Roadmap

Comprehensive technical spec and roadmap live in `docs/`:

- `docs/airlock-technical.md` — Full technical specification
- `docs/airlock-roadmap-1.md` — V1 scope
- `docs/airlock-roadmap-2.md` — V2 (IPC bridge)
- `docs/airlock-roadmap-3-and-beyond.md` — Long-term vision
