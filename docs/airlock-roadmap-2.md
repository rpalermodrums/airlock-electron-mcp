---
title: "Airlock: V2 Plan (Detailed)"
date: "2026-02-07"
status: "Planning (post-V1)"
fidelity: "High for near-term items; medium for later V2.x items"
---

# Executive summary

This document describes the **V2 plan** for the Airlock (Electron MCP Bridge) (a local stdio MCP server enabling Codex and Claude Code to drive an Electron dev environment with a browser-like snapshot/act loop).

It intentionally focuses on what is **valid, actionable, and likely** after V1:

- Make **launch orchestration** more robust and configurable without exploding scope.
- Improve **snapshot quality under token budgets** (diffs, query-scoped views, better pruning).
- Strengthen **multi-window ergonomics** (defaults that work, explicit IDs when needed).
- Add **observability** expected from real-world debugging (traces, artifacts, richer diagnostics).
- Mature **safety policy controls** (policy-as-code, consistent confirmation gates).
- Package for **team rollout** (Claude Code plugin path; Codex skill improvements).

# Naming and identifiers

In V2 and beyond, this project is referred to as **Airlock** and is packaged as an Electron MCP server:

- **Repository:** `airlock-electron-mcp`
- **npm package (recommended):** `@yourorg/airlock-electron-mcp`
- **CLI:** `airlock-electron-mcp`
- **Default MCP server id:** `airlock-electron`
- **Environment variable namespace:** `AIRLOCK_*`
- **Default artifact root:** `<project>/.airlock/electron`

## Fidelity note

This V2 plan has two layers:

- **V2.0 (high fidelity)**: items required to scale beyond a single preset and reduce flakiness.
- **V2.1+ (medium fidelity)**: items that depend on what V1 reveals (driver stability, app patterns, user pain).

# Scope boundaries for V2

## In scope

1. **Preset expansion** beyond the single V1 preset, but still constrained (no “support everything” promise).
2. **First-class attach flow** (CDP attach) as a peer to launch, not just a fallback.
3. **Snapshot improvements** to stay within context budgets in complex apps.
4. **Ergonomic window defaults** that reduce agent verbosity in the common case.
5. **Tracing and artifact bundling** so failures are diagnosable.
6. **Policy-as-code** safety controls and mode gating hardening.
7. **Packaging and distribution** improvements for teams.

## Explicitly not in scope (V2)

- General OS-level automation (menus, native dialogs, window manager) as a default strategy.
- A broad in-app IPC automation bridge shipped as MCP tools (still deferred unless strongly justified by V1 evidence).
- Replacing Playwright as the primary driver backend (unless V1 reveals a hard blocker).

# Assumptions and constraints

## Assumptions (revisit after V1)

- Playwright Electron remains viable for your app class (even if “experimental” in docs).
- The V1 degradation chain (launch -> diagnostics -> CDP attach) materially reduces “first window” failures.
- The majority of your workflows can be driven via renderer UI, not OS UI.

## Constraints (non-negotiable)

- Local-only (stdio MCP) remains the default transport.
- Safe-by-default tool surface remains the default posture.
- Workspace-rooted file boundaries remain enforced.

# Workstreams

## Workstream A: Launch orchestration v2 (the primary workstream)

### Goals

- Support more than one dev setup **without** a combinatorial explosion.
- Make attach vs launch a deliberate choice.
- Improve readiness and window acquisition determinism.

### Deliverables

#### A1. Preset system v2 (a small, versioned “preset DSL”)

A preset defines:

- how to start dependencies (dev server)
- how to launch Electron (or attach)
- how to detect readiness (multi-signal)
- what diagnostics to collect on failure

**Design constraints**

- Presets are versioned and tested.
- Presets are intentionally few (2-4 in V2.0).
- “Custom mode” exists but is explicitly best-effort.

**Candidate presets (choose based on your ecosystem)**

- electron-vite (carry forward from V1)
- Electron Forge (Webpack/Vite variants)
- electron-builder dev workflow (where applicable)
- “pre-launched attach” preset (for manual start + attach)

#### A2. First-class attach flow (CDP attach as a peer to launch)

V2 elevates attach into a first-class capability:

- `app_attach({ debugPort | endpoint, ... })`
- discovery helpers:
  - parse debug port from stdout
  - optional known port configuration
  - target selection heuristics (renderer vs devtools vs extension targets)
- attach diagnostics: list targets and selection rationale

#### A3. Readiness signal engine (composable)

Instead of one “wait for first window,” define a readiness graph:

- process stable
- dev server ready (preset-specific)
- window created
- renderer lifecycle (domcontentloaded best-effort)
- optional: app-level “ready marker” (renderer-visible only; no IPC bridge)

Each signal has:

- timeout
- retry policy
- diagnostic payload on failure

#### A4. Launch/attach diagnostics as artifacts

On any failure, store:

- ring-buffered stdout/stderr
- timeline of signal checks
- window/target event log
- environment summary (sanitized)
  Return a concise error + paths.

### Acceptance criteria

- The top 2-3 presets run the V1 smoke journey repeatedly with materially reduced flake.
- Failures produce actionable diagnostics without manual “guesswork.”

### Confidence

- High (this work is the most predictable follow-on from V1).

## Workstream B: Snapshot and context-budget engineering

### Goals

- Maintain agent usefulness as UI complexity grows.
- Avoid 20k-60k token snapshots that degrade agent performance.

### Deliverables

#### B1. Snapshot diffs (delta snapshots)

Add:

- `snapshot_diff({ sinceEpoch, mode })`
  Returns only:
- changed nodes
- added/removed nodes
- changed properties
  Plus minimal context (ancestors) for readability.

#### B2. Query-first discovery workflow (enforced by defaults)

Evolve the agent loop to:

- start with `snapshot_interactive` (small)
- then `snapshot_query` for focused results
- only use full snapshots with explicit opt-in and caps

#### B3. Viewport and region snapshots

Add:

- `snapshot_region({ rect | anchorRef, radiusPx })`
- `scroll_to({ ref | locator })` (best-effort)
  This reduces node count by focusing on the visible/nearby area.

#### B4. Stable element re-resolution

Improve ref targeting:

- ref -> cached locator hints
- cross-epoch re-resolution:
  - testId (preferred)
  - role + name
  - fallback heuristics (position/ancestor path)
    Return clear errors when re-resolution is ambiguous.

### Acceptance criteria

- Typical snapshot responses remain within a defined target (e.g., <= 2,000-4,000 tokens for default modes).
- Agents can reliably find and act on targets without full-tree dumps.

### Confidence

- Medium-high (implementation complexity is moderate but tractable).

## Workstream C: Window lifecycle and targeting ergonomics

### Goals

- Reduce tool call verbosity in the common single-window case.
- Make transient windows manageable without complicated agent logic.

### Deliverables

#### C1. Default window targeting improvements

- keep explicit `windowId` support
- enhance implicit default selection:
  - last-focused primary window
  - modal detection (when supported)
  - “active window” score refined with recent interactions

#### C2. Window watch and “expected window” helpers

Add helpers:

- `wait_for_window({ titleContains | urlContains | createdAfter, timeoutMs })`
- `window_default_get/set`

#### C3. Safer window classification (minimal use of main-process introspection)

If V1 shows the need, optionally allow limited introspection in `standard` mode only:

- window titles/URLs/bounds
- exclude any arbitrary code eval access

### Acceptance criteria

- Most actions do not need explicit `windowId`.
- Multi-window flows remain deterministic when `windowId` is provided.

### Confidence

- Medium (depends on real app behavior and Playwright/Electron window events).

## Workstream D: Observability and debugging

### Goals

- Make failures diagnosable.
- Make artifact capture consistent and low-friction.

### Deliverables

#### D1. Playwright tracing integration

Add tools:

- `trace_start({ sessionId, options })`
- `trace_stop({ sessionId }) -> { tracePath }`
  Policy:
- tracing is off by default in safe mode
- can be enabled per session or via env

#### D2. Artifact bundling

- `export_artifacts(sessionId)` produces a zipped bundle:
  - logs, screenshots, traces, diagnostics summary

#### D3. Crash and hang diagnostics (best-effort)

- detect renderer unresponsiveness
- capture last known snapshot + screenshot + console tail

### Confidence

- High for tracing/bundling; medium for crash/hang detection.

## Workstream E: Safety hardening v2 (policy-as-code)

### Goals

- Make safety controls explicit, reviewable, and enforceable across teams.

### Deliverables

#### E1. Policy file (YAML or JSON)

Defines:

- workspace roots
- allowed env var passthrough
- allowed network hostnames (if any)
- which tools are enabled per mode (safe/standard/trusted)
- confirmation requirements for destructive actions

#### E2. Consistent confirmation gates

For actions like:

- killing a process
- writing artifacts outside the artifact root
- enabling trusted mode tools

Implementation approach:

- tools return `requiresConfirmation: true` + `confirmationId`
- client calls `confirm(confirmationId)` to proceed (or the user re-runs with an override flag)

#### E3. Output redaction

- redact secrets in logs (simple patterns + allowlist-based output)
- avoid returning large raw logs into the agent context

### Confidence

- High (design mostly internal).

## Workstream F: Packaging and rollout

### Goals

- Make adoption low-friction and update-safe.

### Deliverables

#### F1. Claude Code distribution improvements

- project-level `.mcp.json` templates
- optional org-level plugin packaging
- version pinning strategy + upgrade guide

#### F2. Codex skill improvements

- preflight checks + doctor integration
- “known failure” playbooks (“first window timeout”, “dev server not ready”)

### Confidence

- High.

# Proposed V2 milestones

## V2.0 (high fidelity)

- Preset DSL + 2-3 presets
- First-class attach flow
- Better diagnostics and readiness signals
- Snapshot query improvements and stricter default caps
- Artifact bundling

## V2.1 (medium fidelity)

- Snapshot diffs
- Region snapshots + scroll helpers
- Trace tooling polish + sampling presets
- Window watch helpers

## V2.2 (medium-low fidelity)

- Optional minimal “automation hooks” helper package (dev-only, gated) if V1 data proves dialogs are a blocker
- Additional preset expansion based on demand and stability

# Open questions to resolve after V1 data

1. Which launch preset should be second and third (Forge vs electron-builder vs attach-first)?
2. How often do native dialogs block workflows in practice?
3. Are snapshot diffs enough, or do we need stronger structural summarization?
4. Does long-lived server usage produce state leakage or resource issues requiring stricter resets?

# Updated risk register (V2)

1. Preset explosion (scope creep)
   - Mitigation: strict preset count, versioned presets, “best-effort custom” labeling.

2. Attach target selection ambiguity
   - Mitigation: explicit target listing diagnostics; stable heuristics; user override.

3. Token budget regressions
   - Mitigation: enforce caps; query-first workflow; diffs; region snapshots.

4. Safety regressions as capabilities expand
   - Mitigation: policy-as-code; mode gating; confirmation flows; audit logs.

5. Cross-platform variance
   - Mitigation: prioritize platforms used by the team; treat others as best-effort until tested.

# Definition of done (V2 baseline)

V2 is “done” when:

- at least 2-3 presets are stable for your org’s common dev workflows
- attach flow is reliable and diagnosable
- agents can operate on complex UIs without flooding context
- artifacts make failures actionable
- safety controls are explicit and reviewable
