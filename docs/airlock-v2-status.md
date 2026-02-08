---
title: "Airlock V2: Implementation Status"
date: "2026-02-08"
---

# Airlock V2 Implementation Status

## Overview

V2 is implemented on top of the V1 foundation. The server now includes expanded launch orchestration (versioned preset DSL + attach-first paths), snapshot evolution (`snapshot_diff`, `snapshot_region`, `scroll_to` + cross-epoch re-resolution), explicit window-default tooling, tracing/artifact export/health diagnostics, policy-as-code with confirmation gates, and completion of the previously deferred V1 tool set (except a standalone `app_attach` MCP tool).

For baseline context and V1 implementation details, see [airlock-v1-status.md](./airlock-v1-status.md).
For planned V2 scope, see [airlock-roadmap-2.md](./airlock-roadmap-2.md).

## What Shipped

### A. Launch Orchestration

- Preset DSL v2 implemented in `src/launch/presets.ts`:
  - `electron-vite` (v2)
  - `electron-forge-webpack` (v2)
  - `electron-forge-vite` (v2)
  - `electron-builder` (v2)
  - `pre-launched-attach` (v2)
- Launch modes are explicit (`launch` vs `attach`) in preset definitions (`src/launch/presets.ts`).
- Composable readiness signal engine shipped (`src/launch/readiness.ts`):
  - `processStable`
  - `devServerReady`
  - `windowCreated`
  - `rendererReady`
  - `appMarkerReady`
- First-class CDP attach flow shipped as orchestration API via `attachToCDP()` and attach-mode preset flow (`src/launch/index.ts`, `src/driver/playwright.ts`).
- Attach diagnostics shipped (target discovery + selection rationale) and returned through metadata/diagnostics (`src/driver/playwright.ts`, `src/launch/diagnostics.ts`, `src/launch/index.ts`).
- Launch diagnostics shipped with:
  - process output ring buffers
  - readiness timeline
  - event timeline
  - sanitized environment summary
    (`src/launch/diagnostics.ts`)
- Failure playbooks shipped and matched by preset/platform/symptom (`src/launch/playbooks.ts`), surfaced via `doctor`.

### B. Snapshot Evolution

- `snapshot_diff` shipped (`src/tools/snapshot.ts`, `src/snapshot/index.ts`).
- `snapshot_region` shipped with `rect` or `anchorRef + radiusPx` semantics (`src/tools/snapshot.ts`, `src/snapshot/index.ts`).
- `scroll_to` shipped as best-effort locator scroll via hover resolution (`src/tools/scroll-to.ts`).
- Cross-epoch ref re-resolution shipped:
  - stale descriptor history in `RefMap`
  - `reResolveRef()` matching by identity hints
    (`src/snapshot/ref-map.ts`).
- Query-first guidance/defaults improved:
  - `snapshot_interactive` default cap lowered to 200 nodes and truncation suggestions
  - `snapshot_query` guidance for focused discovery
    (`src/tools/snapshot.ts`).

### C. Window Management

- `wait_for_window` shipped (`src/tools/wait-for-window.ts`).
- `window_default_get` / `window_default_set` shipped (`src/tools/window-default.ts`).
- Enhanced implicit targeting shipped in shared resolver (`src/tools/helpers.ts`) with strategy order:
  - explicit `windowId`
  - session default window
  - likely modal window
  - most recently interacted window
  - most recently focused primary window
  - first non-devtools window
  - first available window
- Modal detection heuristics shipped (`src/tools/helpers.ts`) via kind/title/url/size/type hints.

### D. Observability

- `trace_start` / `trace_stop` shipped (`src/tools/trace.ts`, `src/driver/playwright.ts`).
- `export_artifacts` shipped (`src/tools/export-artifacts.ts`, `src/artifacts/index.ts`).
- Crash/hang diagnostics shipped as `diagnose_session` (`src/tools/crash-diagnostics.ts`) with process liveness, snapshot responsiveness, recent console errors, and activity staleness checks.
- `network_recent` shipped (`src/tools/network-recent.ts`, `src/driver/playwright.ts`).

### E. Safety

- Policy-as-code shipped (`src/policy/`):
  - schema validation (`src/policy/schema.ts`)
  - JSON/YAML loader (`src/policy/loader.ts`)
  - runtime merge + mode ceiling enforcement (`src/policy/merge.ts`)
- Policy-based tool gates shipped in server runtime:
  - disable tool list
  - require confirmation list
    (`src/server.ts`).
- Confirmation-gate protocol shipped:
  - pending confirmation creation/storage (`src/confirmation/`)
  - `confirm` tool for explicit approval handoff (`src/tools/confirm.ts`)
  - re-invocation flow validated by tests (`src/server.test.ts`).
- Output redaction enhancements shipped:
  - recursive key-based redaction
  - configurable regex pattern redaction from policy
    (`src/utils/event-log.ts`, `src/server.ts`).

### F. Packaging & DX

- `doctor` expanded to include preflight checks and playbook matching (`src/tools/doctor.ts`, `src/launch/playbooks.ts`).
- Launch diagnostics include sanitized environment snapshots (`src/launch/diagnostics.ts`).
- CLI supports policy file loading via `--policy` / `AIRLOCK_POLICY` (`src/cli.ts`).

### Deferred V1 Tools Completed in V2

The following V1-deferred tools are now implemented and registered:

- `app_kill`
- `session_info`
- `window_focus`
- `select`
- `hover`
- `network_recent`
- `server_reset`

## New Tool Surface (V1 + V2)

Current `coreTools` registry exposes 35 MCP tools (`src/tools/index.ts`):

### Session & Lifecycle

- `app_launch`
- `app_close`
- `app_kill`
- `session_info`

### Windowing

- `window_list`
- `window_focus`
- `window_default_get`
- `window_default_set`
- `wait_for_window`

### Snapshot & Context

- `snapshot_interactive`
- `snapshot_viewport`
- `snapshot_query`
- `snapshot_diff`
- `snapshot_region`
- `scroll_to`

### Actions

- `click`
- `type`
- `press_key`
- `select`
- `hover`
- `screenshot`

### Waits

- `wait_for_idle`
- `wait_for_visible`
- `wait_for_text`

### Observability & Diagnostics

- `console_recent`
- `network_recent`
- `trace_start`
- `trace_stop`
- `export_artifacts`
- `diagnose_session`
- `doctor`
- `server_status`
- `capabilities`

### Safety & Control

- `confirm`
- `server_reset`

## Design Decisions That Diverged From Roadmap

1. No standalone `app_attach` MCP tool was added. Attach is first-class in launch orchestration via `pre-launched-attach` preset and `attachToCDP()` path inside `app_launch` flows (`src/launch/index.ts`, `src/tools/app-launch.ts`).
2. `export_artifacts` writes a structured manifest bundle (JSON + artifact path list), not a zipped archive (`src/tools/export-artifacts.ts`, `src/artifacts/index.ts`).
3. Policy file fields `roots` and `allowedEnvVars` are parsed/merged but are not yet broadly enforced by tool-level filesystem/env execution boundaries in V2 runtime paths.
4. `capabilities` preset support is currently sourced from CLI-configured `supportedPresets` (default constant includes `electron-vite`) while launch registry itself defines five presets; this creates a reporting mismatch unless startup config is widened (`src/cli.ts`, `src/tools/capabilities.ts`, `src/launch/presets.ts`).

## Roadmap Cross-Check: Still Deferred After V2

Compared to [airlock-roadmap-2.md](./airlock-roadmap-2.md), the following remain partially or fully deferred:

- Standalone MCP `app_attach(...)` tool (attach is orchestration-level, not separate tool).
- Zip bundling for artifact export (manifest export shipped instead).
- Packaging/distribution deliverables in roadmap F1 (templates/plugin packaging/versioning guidance) are not represented as shipped code in `src/`.
- Broad policy enforcement for all declared policy domains (for example, roots/env pass-through enforcement) is not fully wired across tool execution paths.

## File Inventory

All TypeScript files under `src/` with line counts.

| Path                                  | Lines |
| ------------------------------------- | ----: |
| `src/actions/index.test.ts`           |   345 |
| `src/actions/index.ts`                |   391 |
| `src/artifacts/index.test.ts`         |    58 |
| `src/artifacts/index.ts`              |   162 |
| `src/cli.ts`                          |   260 |
| `src/confirmation/index.test.ts`      |    56 |
| `src/confirmation/index.ts`           |    42 |
| `src/confirmation/store.test.ts`      |    65 |
| `src/confirmation/store.ts`           |    65 |
| `src/driver/index.ts`                 |   158 |
| `src/driver/playwright.ts`            |  1613 |
| `src/launch/diagnostics.test.ts`      |    80 |
| `src/launch/diagnostics.ts`           |   305 |
| `src/launch/index.test.ts`            |   120 |
| `src/launch/index.ts`                 |   981 |
| `src/launch/playbooks.test.ts`        |    42 |
| `src/launch/playbooks.ts`             |   193 |
| `src/launch/presets.test.ts`          |    58 |
| `src/launch/presets.ts`               |   239 |
| `src/launch/readiness.test.ts`        |   105 |
| `src/launch/readiness.ts`             |   480 |
| `src/policy/index.test.ts`            |    53 |
| `src/policy/index.ts`                 |     3 |
| `src/policy/loader.test.ts`           |   103 |
| `src/policy/loader.ts`                |    99 |
| `src/policy/merge.test.ts`            |   101 |
| `src/policy/merge.ts`                 |   121 |
| `src/policy/schema.test.ts`           |    50 |
| `src/policy/schema.ts`                |    38 |
| `src/server.test.ts`                  |   518 |
| `src/server.ts`                       |   747 |
| `src/session-manager.test.ts`         |   208 |
| `src/session-manager.ts`              |   218 |
| `src/snapshot/index.test.ts`          |   683 |
| `src/snapshot/index.ts`               |   789 |
| `src/snapshot/ref-map.test.ts`        |   405 |
| `src/snapshot/ref-map.ts`             |   271 |
| `src/tools/app-close.ts`              |    70 |
| `src/tools/app-kill.test.ts`          |   243 |
| `src/tools/app-kill.ts`               |   120 |
| `src/tools/app-launch.test.ts`        |   348 |
| `src/tools/app-launch.ts`             |   310 |
| `src/tools/capabilities.test.ts`      |   136 |
| `src/tools/capabilities.ts`           |    82 |
| `src/tools/click.ts`                  |    40 |
| `src/tools/confirm.test.ts`           |    98 |
| `src/tools/confirm.ts`                |    47 |
| `src/tools/console-recent.ts`         |    92 |
| `src/tools/crash-diagnostics.test.ts` |   260 |
| `src/tools/crash-diagnostics.ts`      |   245 |
| `src/tools/doctor.test.ts`            |   255 |
| `src/tools/doctor.ts`                 |   476 |
| `src/tools/export-artifacts.test.ts`  |   316 |
| `src/tools/export-artifacts.ts`       |   163 |
| `src/tools/helpers.test.ts`           |   344 |
| `src/tools/helpers.ts`                |   497 |
| `src/tools/hover.test.ts`             |   177 |
| `src/tools/hover.ts`                  |    36 |
| `src/tools/index.ts`                  |   105 |
| `src/tools/network-recent.test.ts`    |   159 |
| `src/tools/network-recent.ts`         |    60 |
| `src/tools/press-key.ts`              |    43 |
| `src/tools/screenshot.ts`             |    52 |
| `src/tools/scroll-to.test.ts`         |   197 |
| `src/tools/scroll-to.ts`              |    61 |
| `src/tools/select.test.ts`            |   190 |
| `src/tools/select.ts`                 |    37 |
| `src/tools/server-reset.test.ts`      |   117 |
| `src/tools/server-reset.ts`           |    51 |
| `src/tools/server-status.ts`          |    80 |
| `src/tools/session-info.test.ts`      |   122 |
| `src/tools/session-info.ts`           |    79 |
| `src/tools/snapshot.test.ts`          |   849 |
| `src/tools/snapshot.ts`               |   592 |
| `src/tools/trace.test.ts`             |   324 |
| `src/tools/trace.ts`                  |   186 |
| `src/tools/type.ts`                   |    39 |
| `src/tools/wait-for-window.test.ts`   |   265 |
| `src/tools/wait-for-window.ts`        |   201 |
| `src/tools/wait.ts`                   |    99 |
| `src/tools/window-default.test.ts`    |   202 |
| `src/tools/window-default.ts`         |   107 |
| `src/tools/window-focus.test.ts`      |   164 |
| `src/tools/window-focus.ts`           |    67 |
| `src/tools/window-list.ts`            |   129 |
| `src/types/errors.test.ts`            |    65 |
| `src/types/errors.ts`                 |    49 |
| `src/types/index.ts`                  |     5 |
| `src/types/policy.test.ts`            |    72 |
| `src/types/policy.ts`                 |   102 |
| `src/types/schemas.ts`                |   722 |
| `src/types/session.test.ts`           |    45 |
| `src/types/session.ts`                |    92 |
| `src/types/tool-result.ts`            |    10 |
| `src/utils/event-log.test.ts`         |   158 |
| `src/utils/event-log.ts`              |   156 |
| `src/utils/index.ts`                  |    10 |
| `src/utils/logger.test.ts`            |   115 |
| `src/utils/logger.ts`                 |    88 |
| `src/utils/time.test.ts`              |    18 |
| `src/utils/time.ts`                   |     1 |

## Build & Run

- `npm install`
- `npm install playwright`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run dev`
- `npm run build && npm run start`

### With Policy File

- `npm run dev -- --policy .airlock-policy.json`
- or `AIRLOCK_POLICY=.airlock-policy.yaml npm run dev`
