---
title: "Airlock: Electron MCP Bridge - V1 Plan (Revised)"
date: "2026-02-07"
author: ""
subtitle: "Airlock - Electron MCP server for agentic, safety-scoped UI automation"
---

# Contents

- Executive summary
- Problem statement
- Design goals and non-goals
- Threat model and safety posture
- Research summary and inspiration sources
- Architecture options (considered)
- Recommendation (revised): Option A with explicit V1 scope cuts
- Core technical design
- MCP tool surface (revised)
- Implementation plan (revised)
- Testing and quality strategy
- Maintenance strategy and dependency risk management
- Appendix A: Example configs
- Appendix B: Native dialog stub recipe (runbook-only, opt-in)

# Executive summary

This document proposes a build-it-yourself, **local-only** automation bridge so agentic coding tools (e.g., Codex, Claude Code) can interact with a **running Electron app** with a workflow comparable to how they drive a local browser at `localhost` via Playwright tooling.

The primary recommendation remains:

- Build a **stdio MCP server** that exposes a **curated, safety-scoped tool surface** for controlling Electron sessions.
- Use **Playwright's Electron APIs** as the primary driver, because they are maintained by a trusted industry actor and already align with your existing agent/browser automation patterns.

This revision incorporates peer feedback that is **valid and actionable**:

- **Launch orchestration is the project.** V1 must be more opinionated, start with one launch preset, and treat launch reliability as the central deliverable.
- **First window acquisition is a known failure point.** The design now makes a **degradation chain** first-class: Playwright launch -> robust window wait -> diagnostic capture -> **CDP attach fallback**.
- **Defer any in-app IPC “test-mode bridge” to V2.** V1 will document limitations and provide runbook workarounds for native dialogs/menus, but will not ship app-instrumentation as a product feature.
- **Multi-window support is simplified for V1.** Window targeting becomes optional: tools default to the “active primary” window but still allow explicit window IDs for determinism.
- **Snapshot token budget is treated as a first-class constraint.** V1 defaults to aggressively pruned, interaction-focused accessibility snapshots, with optional viewport-scoped snapshots and node/text caps.
- **Agent capability discovery is explicitly designed.** Tool descriptions (the natural language metadata agents read) are specified and treated as deliverables.
- **Server lifecycle is addressed.** The plan now explicitly supports both ephemeral and long-lived usage patterns with a cleanup/reset strategy.

The goal is not to create a general-purpose desktop automation framework. The goal is to create a **reliable, safe, maintainable “agent bridge”** built from **trusted upstream components**.

# Project naming and identifiers

This plan assumes the following canonical naming for the project and tool suite:

- **Brand / project name:** Airlock
- **Repository:** `airlock-electron-mcp`
- **npm package (recommended):** `@yourorg/airlock-electron-mcp` (scoped)  
  (Optional unscoped: `airlock-electron-mcp` if you later choose to publish it.)
- **CLI (recommended):** `airlock-electron-mcp` (with an optional convenience alias `airlock-electron`)
- **Default MCP server id:** `airlock-electron` (teams may alias this to `airlock` locally if desired)
- **Environment variables (namespace):**
  - `AIRLOCK_MODE` = `safe` | `standard` | `trusted`
  - `AIRLOCK_PRESET` = preset name (e.g., `electron-vite`)
  - `AIRLOCK_ARTIFACT_ROOT` = artifact root directory (default: `<project>/.airlock/electron`)
- **Default artifact layout (under `AIRLOCK_ARTIFACT_ROOT`):**
  - `artifacts/<sessionId>/...`
  - `logs/<sessionId>.log`
  - `traces/<sessionId>.zip` (when tracing is enabled)

These identifiers are referenced throughout the remainder of the document.

# Problem statement

Browser agent tools work well because the target is a standard web runtime with stable automation primitives:

- deterministic navigation and page lifecycle events
- DOM-based selectors
- mature tooling around screenshots, traces, and debugging
- a standardized control boundary (the browser)

Electron apps break that assumption:

- the app is a _packaged Chromium + Node runtime with a main process_
- launch flows differ across build systems and dev setups
- multiple windows and OS-native dialogs complicate targeting and interaction
- some controls are not DOM-accessible (menus, dialogs, system UI)
- “attach vs launch” is non-trivial in dev workflows

**You want a tool that provides a browser-like agent interaction contract for Electron** while preserving a strong safety posture and avoiding dependency risk from small, new, or untrusted projects.

# Design goals and non-goals

## Goals

1. **Agentic control of Electron in local dev**
   - Launch or attach to an Electron session (dev or packaged).
   - Discover windows, select targets, read app state, and perform interactions.

2. **A “browser-like” tool contract**
   - Snapshot -> act -> snapshot loop.
   - Repeatable state targeting, minimal guesswork.

3. **High reliability for one common setup in V1**
   - V1 is deliberately opinionated to avoid launch-matrix explosion.

4. **Strong safety defaults**
   - The tool should be safe by default even when the agent is wrong or compromised.
   - Explicit, auditable boundaries around filesystem/process/network exposure.

5. **Maintainability**
   - Prefer stable upstream primitives with strong institutional backing.
   - Minimize app-specific instrumentation.

## Non-goals (V1)

- Full OS-level automation (native menus, OS file pickers, window manager).
- A generalized desktop automation product competing with commercial tools.
- A full E2E test runner (suites, reporters, CI sharding). We only need the agent bridge.
- Shipping a permanent “test API” in your Electron product code.

# Threat model and safety posture

This project must assume:

- **Prompt injection and tool misuse** are plausible (including via app content).
- The agent may attempt unsafe actions if prompted by untrusted text.
- Local automation tools can quickly expand blast radius (filesystem, shell, secrets).

Safety design principles:

- **Local-only transport**: stdio MCP server invoked by the client.
- **Deny by default** for high-risk capabilities (arbitrary JS eval, arbitrary file access, arbitrary process control).
- **Roots model enforcement**: restrict any file paths to explicit workspace roots.
- **Mode-based capability sets**:
  - `safe` (default): UI interaction, snapshots, screenshots, logs, diagnostics.
  - `standard`: enables limited extra capabilities with explicit allowlists.
  - `trusted`: enables high-risk tools (eval / IPC), explicitly opted in.

# Research summary and inspiration sources

This project intentionally draws from “trusted actor” primitives and proven patterns rather than emerging niche tools.

## Electron testing ecosystem (high-level)

- Spectron is deprecated; Electron’s guidance points to modern frameworks.
- Practical Electron automation approaches cluster around:
  - Playwright (Electron support exists, but includes caveats)
  - WebdriverIO’s Electron service (mature ecosystem, heavier runtime model)
  - Selenium/electron-chromedriver (CDP/WebDriver attach patterns)

## Agentic automation patterns worth borrowing

- **Ref-based snapshot model** (as seen in Microsoft’s Playwright MCP approach): agents act on structured snapshots rather than guessing selectors.
- **Artifact-first debugging**: traces, screenshots, console logs, network logs are first-class outputs.
- **Narrow tool surfaces**: a small set of reliable tools beats a wide set of flaky ones.

# Architecture options (considered)

The options are deliberately broad; the recommendation is not mandatory. Each has a place depending on constraints.

## Option A: Playwright-backed Electron MCP server (recommended)

- MCP stdio server controls Electron via Playwright’s Electron APIs.
- Agent interacts via a curated toolset: launch, snapshot, click/type, wait, screenshot, logs.

Why it fits:

- leverages trusted upstream maintenance
- matches your existing Playwright mental model
- supports agent-style snapshot/act loops

Primary risk:

- Electron support has edge cases; launch/window readiness needs hardening.

## Option B: WebdriverIO Electron service behind MCP

- MCP server translates tool calls to WebdriverIO commands.

Why it fits:

- mature desktop testing ecosystem
- strong support for classic E2E patterns

Primary risk:

- heavier config/runtime model
- less natural for interactive agent loops (command granularity mismatch)

## Option C: Selenium/electron-chromedriver adapter behind MCP

- Use WebDriver semantics for attach/launch.

Why it fits:

- mature protocol tooling
- can attach to running Chromium targets

Primary risk:

- Electron-specific footguns
- more work to map agent snapshot semantics cleanly

## Option D: CDP-native driver behind MCP (no Playwright)

- Use Chrome DevTools Protocol directly.

Why it fits:

- explicit control, fewer Playwright abstractions
- potentially better attach semantics

Primary risk:

- large surface area to implement (input, navigation, screenshots, a11y tree, etc.)
- more custom maintenance

## Option E: In-app test-mode bridge (IPC) + MCP wrapper (deferred to V2)

- Add a test mode to the app that exposes high-level actions/state.

Why it fits:

- can be extremely deterministic for app-specific flows
- can solve native dialogs/menus via app-controlled bypasses

Primary risk:

- introduces product code instrumentation and security/maintenance burden
- can recreate “Spectron-style” coupling if not carefully constrained

## Option F: OS-level automation (e.g., accessibility APIs, system input)

Why it fits:

- can drive native menus/dialogs

Primary risk:

- fragile and platform-specific
- high-permission posture, poor safety story
- not aligned with “trusted primitive reuse”

## Comparison summary (qualitative)

- **Option A: Playwright Electron MCP**
  - Reliability potential: High (after launch hardening)
  - Engineering effort: Medium
  - Agent fit: High
  - Safety posture: Strong (narrow tool surface possible)
  - Maintenance risk: Medium (depends on Playwright Electron stability)

- **Option B: WebdriverIO (WDIO) behind MCP**
  - Reliability potential: High
  - Engineering effort: Medium-High
  - Agent fit: Medium (heavier command model for interactive agent loops)
  - Safety posture: Strong (can still gate risky behaviors)
  - Maintenance risk: Medium

- **Option C: Selenium/electron-chromedriver adapter behind MCP**
  - Reliability potential: Medium
  - Engineering effort: Medium-High
  - Agent fit: Medium
  - Safety posture: Medium
  - Maintenance risk: Medium

- **Option D: CDP-native driver behind MCP**
  - Reliability potential: Medium-High
  - Engineering effort: High
  - Agent fit: High
  - Safety posture: Medium
  - Maintenance risk: High (custom protocol surface)

- **Option E: In-app test-mode bridge (IPC) + MCP wrapper (deferred to V2)**
  - Reliability potential: Very high (app-specific)
  - Engineering effort: Medium-High
  - Agent fit: High
  - Safety posture: Depends on design (adds new product surfaces)
  - Maintenance risk: Medium-High

- **Option F: OS-level automation (accessibility APIs, system input)**
  - Reliability potential: Low-Medium
  - Engineering effort: High
  - Agent fit: Low-Medium
  - Safety posture: Weak (high-permission posture)
  - Maintenance risk: High

# Recommendation (revised): Option A with explicit V1 scope cuts

## V1 scope decision: be opinionated

To avoid “launch matrix” scope creep, V1 will:

1. **Support exactly one first-class dev preset**:
   - Recommended preset: **electron-vite** (or whichever single stack your org standardizes on).
   - “First-class” means: tested, documented, and in the done criteria.

2. Provide a **best-effort “custom launch”** interface:
   - available for power users
   - explicitly not guaranteed in V1
   - returns actionable diagnostics when it fails

3. Treat **launch orchestration + first window readiness** as the core deliverable.

This is explicitly a product decision to maximize the probability of a reliable tool in V1.

## V1: Defer the in-app IPC bridge

V1 will _not_ ship a generic IPC bridge tool surface.

Instead, V1 will:

- document limitations around OS-native dialogs/menus
- provide runbook workarounds (see “Native dialogs and menus: V1 limitations”)
- leave IPC/test-mode as a V2 track after the core bridge is proven

## V1: Multi-window defaults

V1 will:

- track all windows and expose explicit window IDs
- but default actions to **the active primary window**:
  - “most recently focused non-devtools window”
  - or a stable “main window” heuristic if available
- allow overriding with `windowId` for deterministic control when needed

# Core technical design

## Server model and lifecycle

### MCP server process

- **stdio MCP server** launched by the client (Codex or Claude Code).
- Designed to be safe to run locally inside a repo.

### Ephemeral vs long-lived usage

The server must behave well in two distinct client patterns:

1. **Ephemeral (Codex-like)**
   - server starts for a task, runs a small number of tool calls, exits
   - simplest to reason about
   - minimizes leaked state

2. **Long-lived (Claude Code-like interactive sessions)**
   - server stays up for the duration of an interactive session
   - supports multiple Electron sessions over time
   - needs strict cleanup and state reset

#### Long-lived cleanup strategy (required)

- Each Electron session has:
  - a session ID
  - a “last activity” timestamp
  - a max TTL (configurable)
- Background cleanup:
  - auto-close stale sessions on tool call boundaries (no background threads required)
- Explicit tools:
  - `server_status` (shows active sessions, TTL, mode)
  - `server_reset` (closes all sessions; only available in `standard`/`trusted` or with confirmation)

## Session and window model

### Session

A session represents one Electron process tree under automation.

- `sessionId`: stable UUID
- metadata:
  - launch mode (dev preset, custom)
  - platform info
  - timestamps
- artifacts directory:
  - `./.airlock/electron/artifacts/<sessionId>/...`

### Window

A window corresponds to a Playwright `Page` (renderer) plus metadata.

- `windowId`: stable per session
- properties:
  - title
  - URL
  - bounds (if available)
  - type classification: `primary | modal | devtools | utility | unknown`
  - focus score and last-focused timestamp

### Default window selection heuristic (V1)

When a tool call does not specify `windowId`:

1. prefer the last-focused `primary` window
2. else prefer the first created non-devtools window
3. else fall back to the most recently created non-devtools window
4. else error with diagnostics (window list)

This reduces agent verbosity while keeping determinism (the heuristic is explicit).

## Snapshot model (accessibility-first, token-budgeted)

Agents need structured state. Pixel-only interaction is too noisy.

### Snapshot outputs (V1)

V1 provides two snapshot modes:

1. `snapshot_interactive` (default)
   - aggressively pruned
   - focuses on actionable nodes:
     - buttons, links, textfields, checkboxes, menus _as exposed in the a11y tree_
   - includes role/name/state/value where applicable
   - caps nodes and truncates text aggressively

2. `snapshot_viewport`
   - same as interactive but limited to likely-visible nodes
   - uses a blend of:
     - bounding boxes (if obtainable)
     - DOM viewport intersection heuristics
     - depth pruning

### Token budget constraints (explicit)

Complex Electron apps can have thousands of accessible nodes. V1 must enforce:

- `maxNodes` default: 250 (tunable)
- `maxTextCharsPerNode` default: 80
- attribute allowlist (no dumping full props)
- remove invisible/disabled nodes unless they matter for interaction
- collapse repeated structures (lists, tables) into summaries with “expand” hints

When the snapshot exceeds budget, the tool returns:

- `truncated: true`
- `truncationReason`
- suggested follow-up:
  - “use viewport snapshot”
  - “use query snapshot”
  - “increase maxNodes (trusted mode)”

### Query-scoped snapshots (V1 add)

To prevent “dump the entire UI” behaviors, V1 includes:

- `snapshot_query({ query: { role?, nameContains?, testId?, textContains? } })`
- returns a small matching subset plus nearest ancestors for context

This is often the single most effective token-control feature.

## Interaction model: ref-based targeting

### Principle

The agent should click/type based on **stable references produced by the snapshot**, not by guessing CSS selectors.

### Node references

Snapshot returns elements with:

- `ref`: opaque stable reference (per snapshot epoch)
- `role`, `name`, `value`, `checked`, `disabled`
- optional `locatorHints`:
  - role/name locator suggestion
  - test-id locator suggestion when present

### Ref validity

Ref stability is bounded:

- refs are valid for the current window state epoch
- any state-changing action returns a new `snapshotEpoch`
- tools accept either:
  - `ref` (preferred)
  - locator (fallback)
  - raw CSS (last resort; allowed but discouraged)

## Launch orchestration (revised: central focus)

Launch orchestration is not a subsection; it is the core engineering challenge.

### V1 “electron-vite” launch preset (example)

The preset defines:

- how to start the dev server (if needed)
- how to launch Electron with the correct entrypoint
- how to detect readiness
- what diagnostics to collect on failure

Inputs:

- `projectRoot`
- `devCommand` (default: `npm run dev`)
- `electronCommand` (default derived from electron-vite conventions)
- env allowlist / overrides
- timeouts

### Readiness signals (layered)

V1 must not rely on a single readiness check. Use a chain:

1. **Process spawned and stable**
   - Electron PID exists and stays alive for N seconds
2. **Dev server ready** (if applicable)
   - parse stdout for “ready” patterns (preset-specific)
   - optionally probe an HTTP URL if known
3. **Electron main process reachable**
   - Playwright ElectronApplication object created (when launching)
4. **Window readiness**
   - robust window wait (see below)
5. **Renderer readiness**
   - window URL not blank / expected scheme
   - `domcontentloaded` (best-effort)
   - optional: network idle (avoid deadlocks)

### First-window acquisition: explicit fallback chain (required)

This revision makes the “degradation path” first-class.

**Chain A: Playwright launch path**

- Attempt `_electron.launch(...)`
- Wait for window via an event-driven strategy:
  - subscribe to `electronApp.on('window')` (or equivalent)
  - wait up to `T1` for at least one non-devtools window
  - if created, apply renderer readiness checks

If `firstWindow()` (or equivalent) times out or returns unstable state:

- capture diagnostics:
  - Electron stdout/stderr (ring buffer)
  - process exit code if exited
  - recent window events
  - environment + launch args
  - trace if available

**Chain B: CDP attach fallback (first-class in V1)**

If the preset supports it, retry with an attach strategy:

- (preferred) launch Electron with a known `--remote-debugging-port=0` or fixed port and parse the port from logs
- connect using Playwright’s `chromium.connectOverCDP(...)` or a minimal attach helper
- locate Electron renderer targets and select the primary window target
- continue with the same snapshot/interaction model

If CDP attach succeeds, the MCP server returns:

- `mode: "attached"`
- diagnostic note that launch path was bypassed

If attach fails:

- return a structured error including:
  - what was attempted
  - what signals were observed
  - what the user can change (timeouts, flags, fuse settings)

This design ensures “launch flakiness” does not become a total blocker.

### Configuration surface to avoid combinatorial explosion

V1 uses:

- one “preset” (`electron-vite`)
- one “custom” mode with explicit parameters

V2 can add additional presets once V1 is proven (Forge, electron-builder, etc.).

## Native dialogs and menus: V1 limitations (and runbook workarounds)

V1 does not attempt to click OS-native dialogs or menus.

Workarounds (documented; not shipped as MCP tools):

1. Prefer renderer-based file inputs when possible:
   - use `<input type="file">` patterns for file selection
2. For `dialog.showOpenDialog`-style flows, add a **tiny, explicit, opt-in stub** in dev builds only:
   - gated by `AIRLOCK_AUTOMATION=1`
   - returns a deterministic path from an env var
   - never enabled in production builds
3. When stubbing is not possible:
   - instruct the developer to manually complete the dialog once, then continue automation

These workarounds avoid shipping a generic IPC bridge in V1 while providing a path for common workflows.

# MCP tool surface (revised)

## Tool design principles

- Tools are **small, composable, and deterministic**.
- Each tool includes:
  - strict parameter validation
  - strong error typing
  - natural-language `description` metadata designed for agents
- Default behavior aims to be “quiet”:
  - return only what is needed
  - store large artifacts to disk and return paths

## Capability discovery (new)

Agents need to understand what the server can do _right now_.

V1 adds:

- `capabilities()`: returns tool modes, enabled features, preset support, limits (maxNodes, etc.)
- `server_status()`: returns active sessions and health
- `doctor()`: returns environment diagnostics (Playwright version, Electron version if available, OS, known issues)

These tools reduce “guessing” and improve safe use.

## Tool set (V1)

### Session tools

- `app_launch(preset|custom, ...)`
- `app_attach(...)` (optional; used by CDP fallback)
- `app_close(sessionId)`
- `app_kill(sessionId)` (disabled in `safe`; requires confirmation)
- `session_info(sessionId)`

### Window tools

- `window_list(sessionId)`
- `window_focus(sessionId, windowId)` (best-effort)
- `window_set_default(sessionId, windowId)` (optional helper)

### Snapshot tools

- `snapshot_interactive(sessionId, windowId?, options?)`
- `snapshot_viewport(sessionId, windowId?, options?)`
- `snapshot_query(sessionId, windowId?, query, options?)`

### Action tools

- `click(sessionId, target, windowId?)`
- `type(sessionId, target, text, windowId?)`
- `press_key(sessionId, key, modifiers?, windowId?)`
- `select(sessionId, target, value, windowId?)` (if needed)
- `hover(sessionId, target, windowId?)` (if needed)

Target supports:

- `{ ref: string }` (preferred)
- `{ role, name }` locator
- `{ testId }`
- `{ css }` (discouraged)

### Wait tools

- `wait_for_idle(sessionId, windowId?, timeoutMs?)`
- `wait_for_visible(sessionId, target, windowId?, timeoutMs?)`
- `wait_for_text(sessionId, text, windowId?, timeoutMs?)`

### Observability tools

- `screenshot(sessionId, windowId?, path?, fullPage?)`
- `console_recent(sessionId, level?, limit?)`
- `network_recent(sessionId, limit?)` (best-effort)
- `export_artifacts(sessionId)` (returns artifact bundle path)

### High-risk tools (V2 or `trusted` only)

- `evaluate_js(...)` (default disabled)
- `ipc_invoke(...)` (deferred to V2; not shipped in V1)

## Agent-facing tool descriptions (new deliverable)

For each tool, ship a carefully written description. Example pattern:

- what the tool does
- what it cannot do
- what defaults it uses (especially window defaults and token limits)
- what to do on common errors (next recommended tool call)
- safety notes (what is restricted in safe mode)

This is treated as part of the “API”, not documentation garnish.

# Implementation plan (revised)

## Phase 0: Project scaffolding (2-3 days)

Deliverables:

- TypeScript MCP server skeleton (stdio)
- schema validation (zod or equivalent)
- artifact directory management
- structured logging and error types
- `capabilities`, `server_status`, `doctor`

Done criteria:

- server runs locally, passes a lint/test baseline
- returns deterministic, typed responses

## Phase 1: V1 POC focused on one preset (1 week)

Deliverables:

- `electron-vite` launch preset
- robust first window wait
- snapshot_interactive
- click/type/press
- screenshot + console capture
- one end-to-end “smoke journey” in your app

Done criteria:

- the same smoke journey runs repeatedly on your primary dev machine without manual recovery

## Phase 2: Launch hardening + CDP fallback (2 weeks)

Deliverables:

- first-class degradation chain:
  - Playwright launch -> window wait -> diagnostics -> CDP attach
- better readiness signals and timeouts
- actionable diagnostics on failure
- session cleanup/TTL

Done criteria:

- flake rate reduced materially across repeated runs
- failure mode is diagnosable (logs/paths returned)

## Phase 3: Snapshot and window hardening (1-2 weeks)

Deliverables:

- snapshot_viewport + snapshot_query
- pruning improvements and token budget enforcement
- default window heuristic + window focus helpers
- improved multi-window edge handling (transient windows, closes)

Done criteria:

- agents can operate effectively without flooding context
- common multi-window flows are manageable with minimal explicit window targeting

## Phase 4: Packaging, runbooks, and rollout (1 week)

Deliverables:

- Codex skill package:
  - preflight checks
  - canonical “snapshot -> act -> verify” loop
  - native dialog workaround recipes
- Claude Code project config (`.mcp.json`) template
- team runbook: troubleshooting, limitations, safe mode guidance

Done criteria:

- a new developer can use the tool in under 30 minutes following the runbook

## Timeline and buffer

The earlier 3-5 week estimate is plausible for a narrow V1, but launch hardening is unpredictable.

Revised estimate:

- **4-6 weeks** for a team-usable baseline (includes a buffer week)

# Testing and quality strategy

## Test matrix (V1)

- One app
- One preset (electron-vite)
- At least two OSes if your team is cross-platform (otherwise defer)

## Regression tests for the MCP server

- unit tests for schema validation and tool mode gating
- integration test harness that:
  - launches a minimal Electron fixture app
  - exercises tool calls end-to-end
  - validates snapshots are within budget

## Flake control

- deterministic waits over arbitrary sleeps
- always return diagnostics on timeout
- idempotent `app_close` and cleanup logic

# Maintenance strategy and dependency risk management

Your risk posture is “avoid small/new tooling with uncertain maintenance.”

This plan aligns by:

- depending primarily on:
  - Playwright (Microsoft)
  - Electron project guidance
  - standard Node/TypeScript ecosystem
- keeping your custom code focused on:
  - orchestration
  - safety gating
  - snapshot shaping
  - agent UX metadata

Maintenance practices:

- pin Playwright versions; test upgrades via a small compatibility suite
- track Electron/Chromium version changes that affect CDP/automation
- treat presets as “contracts” with versioned behavior

# Appendix A: Example configs

These examples assume the recommended identifiers:

- **CLI:** `airlock-electron-mcp`
- **Default MCP server id:** `airlock-electron`
- **Env vars:** `AIRLOCK_MODE`, `AIRLOCK_PRESET`, `AIRLOCK_ARTIFACT_ROOT`

## Claude Code `.mcp.json` (project-level)

### Using a repo-local checkout (recommended during development)

```json
{
  "mcpServers": {
    "airlock-electron": {
      "command": "node",
      "args": ["./tools/airlock-electron-mcp/dist/cli.js", "serve"],
      "env": {
        "AIRLOCK_MODE": "safe",
        "AIRLOCK_PRESET": "electron-vite",
        "AIRLOCK_ARTIFACT_ROOT": ".airlock/electron"
      }
    }
  }
}
```

### Using npm (recommended for consumers)

```json
{
  "mcpServers": {
    "airlock-electron": {
      "command": "npx",
      "args": ["-y", "@yourorg/airlock-electron-mcp", "serve"],
      "env": {
        "AIRLOCK_MODE": "safe",
        "AIRLOCK_PRESET": "electron-vite",
        "AIRLOCK_ARTIFACT_ROOT": ".airlock/electron"
      }
    }
  }
}
```

## Codex TOML config (example)

### Using a repo-local checkout

```toml
[mcp_servers.airlock_electron]
command = "node"
args = ["./tools/airlock-electron-mcp/dist/cli.js", "serve"]

[mcp_servers.airlock_electron.env]
AIRLOCK_MODE = "safe"
AIRLOCK_PRESET = "electron-vite"
AIRLOCK_ARTIFACT_ROOT = ".airlock/electron"
```

### Using npm

```toml
[mcp_servers.airlock_electron]
command = "npx"
args = ["-y", "@yourorg/airlock-electron-mcp", "serve"]

[mcp_servers.airlock_electron.env]
AIRLOCK_MODE = "safe"
AIRLOCK_PRESET = "electron-vite"
AIRLOCK_ARTIFACT_ROOT = ".airlock/electron"
```

# Appendix B: Native dialog stub recipe (runbook-only, opt-in)

This is not part of the MCP tool surface. It is a developer workaround for dev builds.

Example concept:

- If `AIRLOCK_AUTOMATION=1` and `AIRLOCK_AUTOMATION_OPEN_DIALOG_PATH=/path/to/file`,
- override `dialog.showOpenDialog` to return that path without opening a native dialog.

Security notes:

- gate strictly to dev builds
- never enable in production
- do not accept arbitrary remote input; only environment variables set locally
