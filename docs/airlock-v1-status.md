---
title: "Airlock V1: Implementation Status"
date: "2026-02-07"
---

# Airlock V1 Implementation Status

## Overview

V1 Phase 0+1 is implemented. The codebase now includes production scaffolding, a typed MCP stdio server, a Playwright-backed driver behind an `ElectronDriver` interface, snapshot/ref-map processing, core action and wait primitives, observability/diagnostic tools, and a complete Vitest suite.

For the original planning document and full design rationale, see [airlock-roadmap-1.md](./airlock-roadmap-1.md).

## What Shipped

### Architecture

- MCP stdio server via `@modelcontextprotocol/sdk` (`src/server.ts`, `src/cli.ts`).
- `ElectronDriver` abstraction exists at the boundary (`src/driver/index.ts`) with Playwright implementation in `src/driver/playwright.ts`.
- All tools return `ToolResult<T>` with optional `meta` (`suggestions`, `warnings`, `diagnostics`) (`src/types/tool-result.ts`).
- Domain layer uses branded `SessionId`, `WindowId`, `RefId` types while driver APIs use plain strings (`src/types/session.ts`, `src/driver/index.ts`).
- Safety modes `safe` / `standard` / `trusted` gate capabilities and session policy (`src/types/policy.ts`, `src/server.ts`).
- `playwright` is a peer dependency, not a direct runtime dependency (`package.json`).

### Tool Surface (17 tools)

#### Session

- `app_launch`: Launches/attaches an Electron session, creates a managed Airlock session, and returns discovered windows.
- `app_close`: Closes and removes a managed session, with idempotent behavior for missing sessions.

#### Window

- `window_list`: Refreshes current windows for a session and returns selected window context.

#### Snapshot

- `snapshot_interactive`: Returns interactive-element accessibility snapshot with refs for action targeting.
- `snapshot_viewport`: Returns a viewport-scoped snapshot for reduced token footprint.
- `snapshot_query`: Returns query-matched nodes with context by role/name/testId/text filters.

#### Actions

- `click`: Clicks a target resolved from ref, role+name, testId, or css.
- `type`: Types/appends or fills text into a targeted input element.
- `press_key`: Sends keyboard key/shortcut input to the selected window.
- `screenshot`: Captures PNG to session artifact storage.

#### Waits

- `wait_for_idle`: Waits for network idle and animation quiescence.
- `wait_for_visible`: Waits for a target element to become visible.
- `wait_for_text`: Waits for text visibility in the renderer.

#### Observability

- `capabilities`: Reports mode, enabled tools, limits, preset support, and server version info.
- `server_status`: Reports uptime and active session lifecycle state.
- `console_recent`: Returns recent normalized renderer console entries.

#### Diagnostics

- `doctor`: Runs environment checks for Playwright/Electron/Node/platform plus known issue hints.

### Type System

- `Session`, `Window`, `SnapshotNode`, `Snapshot`, `SnapshotQuery`, `SessionSummary` domain models in `src/types/session.ts`.
- `SnapshotNode.locatorHints` includes `testId`, `roleAndName`, `label`, and `textContent`.
- `AirlockError` with 12 codes (`INVALID_INPUT`, `MODE_RESTRICTED`, `SESSION_NOT_FOUND`, `WINDOW_NOT_FOUND`, `REF_NOT_FOUND`, `REF_STALE`, `SNAPSHOT_NOT_FOUND`, `STALE_SNAPSHOT`, `POLICY_VIOLATION`, `LAUNCH_FAILED`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`) in `src/types/errors.ts`.
- `SafetyPolicy`, `SafetyMode`, and `ModeCapabilities` in `src/types/policy.ts`.
- `ToolResult<T>` and `ToolMeta` in `src/types/tool-result.ts`.

### Snapshot Engine

- Two-layer pipeline: driver `RawSnapshot` -> domain `Snapshot` (`src/driver/index.ts`, `src/snapshot/index.ts`, `src/tools/snapshot.ts`).
- Deterministic tool-facing refs use traversal order and are assigned as `e1`, `e2`, ... (`src/snapshot/index.ts`).
- Default token guardrails are enforced at snapshot build: `maxNodes=250`, `maxTextCharsPerNode=80` (`src/cli.ts`, `src/snapshot/index.ts`).
- `RefMap` selector priority chain is implemented as `testId(100) > role(90) > label(80) > text(70) > css(10)` (`src/snapshot/ref-map.ts`).
- Ref staleness is epoch-based (`RefMap.currentEpoch`, `rebuildFromSnapshot`, `isStale`) (`src/snapshot/ref-map.ts`).
- Snapshot modes implemented: interactive, viewport, query (`src/tools/snapshot.ts`, `src/snapshot/index.ts`).

### Safety & Observability

- Mode capabilities shipped: `allowAppKill`, `allowTrustedEval`, `allowOriginOverrides`, `allowRawSelectors` (`src/types/policy.ts`).
- Mode TTLs shipped: safe `30m`, standard `2h`, trusted `8h` (`src/types/policy.ts`).
- Allowed origins by mode shipped: safe localhost only, standard adds `file://`, trusted `*` (`src/types/policy.ts`).
- `EventLog` ring buffer defaults to 2000 entries and redacts sensitive keys recursively (`src/utils/event-log.ts`).
- Structured JSON logger writes to stderr (`src/utils/logger.ts`).

### Infrastructure

- TypeScript ESM build with `module: NodeNext`, `moduleResolution: NodeNext`, `exactOptionalPropertyTypes: true` (`tsconfig.json`).
- Vitest suite contains 17 test files and 94 test cases (`src/**/*.test.ts`).
- CI runs GitHub Actions matrix on Node 20 and 22 with typecheck, build, and test (`.github/workflows/ci.yml`).
- Lefthook gates:
  - pre-commit: lint, typecheck, format-check
  - pre-push: tests
    (`lefthook.yml`)

## Design Decisions That Diverged From the Roadmap

1. Driver abstraction (`ElectronDriver`) was pulled forward from the longer-term architecture rather than binding tools directly to Playwright.
2. `ToolResult<T>` response envelope with `meta` (`suggestions`, `warnings`, `diagnostics`) was added across tools to support richer agent workflows.
3. Branded ID types (`SessionId`, `WindowId`, `RefId`) replaced all-plain-string domain IDs.
4. `ActionTargetSchema` is a flat object validated with `superRefine` instead of a discriminated union.
5. `locatorHints` expanded to four hint categories (`testId`, `roleAndName`, `label`, `textContent`) rather than the earlier narrow hint model.
6. `selectedWindowId` is explicit session state, not only a computed heuristic.
7. Playwright is configured as a peer dependency for backend swappability.
8. Console level naming differs between layers and is currently normalized in tooling:
   - driver: `trace/debug/info/warn/error`
   - tool schema/output: `error/warning/info/log/debug`

## Deferred to V1 Completion

These items are scoped to V1 in the roadmap but were phased out of the initial delivery. They are not blockers for using the server in its current state but should be completed before V1 is considered feature-complete.

Tools and flows not yet wired as MCP tools:

- `app_attach` (driver method exists, no MCP tool)
- `app_kill` (capability flag exists, no MCP tool)
- `session_info` (schemas exist, no MCP tool)
- `window_focus` (not implemented)
- `window_set_default` (not implemented)
- `select` action tool (driver action exists, no MCP tool)
- `hover` action tool (driver action exists, no MCP tool)
- `network_recent` (not implemented)
- `export_artifacts` (not implemented)
- `server_reset` (SessionManager `reset()` exists, no MCP tool)

Launch orchestration checklist items tracked as incomplete for V1 completion:

- `electron-vite` preset definition exists, but launch hardening is not complete end-to-end.
- CDP attach fallback chain exists in launch logic but is not fully orchestrated to roadmap completion criteria.
- Readiness signal chain is not complete to roadmap completion criteria.
- Dev server lifecycle management is present in launch path but not fully wired to roadmap completion criteria.

## Deferred to V2+

- In-app IPC bridge / `ipc_invoke` tool
- `evaluate_js` MCP tool (driver has optional `evaluate()`)
- Policy-as-code (YAML/JSON policy files)
- Confirmation gates
- Differential snapshots
- Playwright tracing integration
- Recording and replay
- Additional launch presets (Forge, electron-builder)
- Native dialog automation

## File Inventory

All TypeScript source and test files under `src/` with line counts.

| Path                             | Lines | Description                                                                                   |
| -------------------------------- | ----: | --------------------------------------------------------------------------------------------- |
| `src/actions/index.ts`           |   391 | Action execution pipeline, ref resolution, locator translation, failure diagnostics.          |
| `src/actions/index.test.ts`      |   345 | Tests for action target resolution, error handling, and diagnostics behavior.                 |
| `src/artifacts/index.ts`         |    55 | Artifact root/session directory allocation and bootstrap helpers.                             |
| `src/artifacts/index.test.ts`    |    58 | Tests for artifact path creation and directory guarantees.                                    |
| `src/cli.ts`                     |   130 | CLI entrypoint and server bootstrap for `serve`/`help`.                                       |
| `src/driver/index.ts`            |   129 | Driver interface contracts and raw model types.                                               |
| `src/driver/playwright.ts`       |  1351 | Playwright Electron/CDP driver implementation, snapshots, actions, logs, and attach/launch.   |
| `src/launch/index.ts`            |   468 | Launch preset model, dev-server readiness, launch/attach fallback orchestration.              |
| `src/launch/index.test.ts`       |   233 | Tests for preset resolution and launch orchestration behavior.                                |
| `src/server.ts`                  |   547 | MCP server core, tool registration, mode gating, envelope/error normalization, event logging. |
| `src/server.test.ts`             |   334 | Tests for server tool execution, validation, and mode restrictions.                           |
| `src/session-manager.ts`         |   197 | Session registry, ref-map tracking, TTL cleanup, and reset lifecycle.                         |
| `src/session-manager.test.ts`    |   208 | Tests for session add/get/list/touch/ref-map/cleanup/reset behavior.                          |
| `src/snapshot/index.ts`          |   461 | Snapshot normalization, filtering, truncation, versioning, viewport/query builders.           |
| `src/snapshot/index.test.ts`     |   490 | Tests for snapshot filtering, truncation, query, and version semantics.                       |
| `src/snapshot/ref-map.ts`        |   146 | Ref-to-selector descriptor mapping, priority selection, epoch staleness support.              |
| `src/snapshot/ref-map.test.ts`   |   214 | Tests for descriptor selection, locator conversion, and epoch behavior.                       |
| `src/tools/index.ts`             |    47 | Tool exports and `coreTools` registration list.                                               |
| `src/tools/app-launch.ts`        |   310 | `app_launch` tool and session bootstrap wiring around launch flows.                           |
| `src/tools/app-close.ts`         |    70 | `app_close` tool and controlled teardown behavior.                                            |
| `src/tools/window-list.ts`       |   124 | `window_list` tool and selected-window refresh logic.                                         |
| `src/tools/capabilities.ts`      |    82 | `capabilities` tool output for mode/tool/runtime limits metadata.                             |
| `src/tools/capabilities.test.ts` |   136 | Tests for capabilities output and suggestion/warning metadata.                                |
| `src/tools/server-status.ts`     |    80 | `server_status` tool over session uptime/activity state.                                      |
| `src/tools/doctor.ts`            |   209 | `doctor` environment diagnostics (Playwright/Electron/Node/platform).                         |
| `src/tools/doctor.test.ts`       |   178 | Tests for diagnostic output and degraded environment handling.                                |
| `src/tools/click.ts`             |    40 | `click` action tool wrapper.                                                                  |
| `src/tools/type.ts`              |    39 | `type` action tool wrapper (`type` vs `fill`).                                                |
| `src/tools/press-key.ts`         |    43 | `press_key` action tool wrapper.                                                              |
| `src/tools/screenshot.ts`        |    52 | `screenshot` artifact capture tool.                                                           |
| `src/tools/console-recent.ts`    |    92 | `console_recent` log normalization/filtering tool.                                            |
| `src/tools/wait.ts`              |    99 | Wait tools: `wait_for_idle`, `wait_for_visible`, `wait_for_text`.                             |
| `src/tools/snapshot.ts`          |   248 | Snapshot tools and ref-map caching bridge.                                                    |
| `src/tools/snapshot.test.ts`     |   276 | Tests for snapshot tool outputs and metadata.                                                 |
| `src/tools/helpers.ts`           |   157 | Shared tool helpers for session/window resolution and action result shaping.                  |
| `src/tools/helpers.test.ts`      |   196 | Tests for helper resolution and error cases.                                                  |
| `src/types/index.ts`             |     5 | Type barrel exports.                                                                          |
| `src/types/errors.ts`            |    45 | Airlock error code set and factory helpers.                                                   |
| `src/types/errors.test.ts`       |    50 | Tests for error construction semantics.                                                       |
| `src/types/policy.ts`            |    71 | Safety modes, policies, capabilities, and per-mode defaults.                                  |
| `src/types/policy.test.ts`       |    72 | Tests for policy defaults and capability matrices.                                            |
| `src/types/schemas.ts`           |   288 | zod schemas for tool I/O and domain model validation.                                         |
| `src/types/session.ts`           |    92 | Branded IDs and domain session/window/snapshot types.                                         |
| `src/types/session.test.ts`      |    45 | Tests for branded IDs and session model invariants.                                           |
| `src/types/tool-result.ts`       |    10 | Generic `ToolResult<T>` and `ToolMeta` envelope types.                                        |
| `src/utils/event-log.ts`         |   128 | Event ring buffer with sensitive key redaction.                                               |
| `src/utils/event-log.test.ts`    |   139 | Tests for redaction, retention, and retrieval behavior.                                       |
| `src/utils/index.ts`             |    10 | Utility barrel exports.                                                                       |
| `src/utils/logger.ts`            |    88 | Structured stderr JSON logger with scoped child loggers.                                      |
| `src/utils/logger.test.ts`       |   115 | Tests for log level filtering and structured payload output.                                  |
| `src/utils/time.ts`              |     1 | Time utility module shim.                                                                     |
| `src/utils/time.test.ts`         |    18 | Tests for time utility behavior.                                                              |

## Build & Run

- `npm install && npm install playwright`
- `npm run typecheck`
- `npm test`
- `npm run dev`
- `npm run build && npm start`
