---
title: "Airlock: V3+ Roadmap and Strategic Options"
date: "2026-02-07"
status: "Exploratory roadmap (post-V2)"
fidelity: "Decreasing with horizon (see bands below)"
---

# Executive summary

This document covers **V3 and beyond** for the Airlock (Electron MCP Bridge). It is deliberately more speculative than V2.

The roadmap is organized into **fidelity bands** to reflect uncertainty:

- **Band 1 (0-3 months after V2): higher fidelity**
  - incremental improvements that are natural extensions of V2
  - mainly engineering hardening and UX polish
- **Band 2 (3-9 months after V2): medium fidelity**
  - meaningful capability expansion, but dependent on usage data and upstream constraints
- **Band 3 (9-18+ months after V2): low fidelity**
  - strategic bets and optional directions; assumptions may not hold

A key principle: **do not broaden the tool surface faster than safety, diagnostics, and reliability maturity.**

# Naming and identifiers

For V3+ planning, assume the same packaging and identifiers as V1/V2:

- **Repository:** `airlock-electron-mcp`
- **npm package (recommended):** `@yourorg/airlock-electron-mcp`
- **CLI:** `airlock-electron-mcp`
- **Default MCP server id:** `airlock-electron`
- **Environment variable namespace:** `AIRLOCK_*`
- **Default artifact root:** `<project>/.airlock/electron`

# Strategy choices (the “shape” of V3+)

You will likely converge on one of these strategic postures:

## Strategy S1: Narrow and reliable (default)

- Continue focusing on Electron with Playwright as the primary backend.
- Add only the minimal features needed for agent-driven local dev and limited CI.
- Strong governance and safety posture; small tool surface.

Best for:

- teams that mainly need local agentic automation for developer workflows
- organizations that prioritize security and maintenance simplicity

## Strategy S2: Internal desktop automation platform (selective expansion)

- Add more backends (WDIO adapter, CDP-native fallback).
- Add inspector and recording tools.
- Add stronger CI support and centralized artifact pipelines.

Best for:

- orgs with multiple Electron apps and a central platform team

## Strategy S3: Product-like ecosystem (highest risk)

- Generalize beyond Electron (Tauri, Flutter, Qt).
- Build a plugin ecosystem for app-specific drivers.
- Add remote execution and multi-user management.

This has the highest maintenance and safety risk and is not recommended unless there is clear org-level demand and resourcing.

# Roadmap by fidelity band

## Band 1 (0-3 months after V2): Higher fidelity

### 1. Reliability hardening (launch and attach)

- Expand preset test coverage.
- Improve attach target selection heuristics.
- Add deterministic retries with bounded backoff for known transient failures.

**Why this is high confidence:** it is a direct continuation of V2 pain points.

### 2. Snapshot UX polish

- Better “explain why I cannot find this element” errors.
- Add “suggested next actions” in tool outputs (e.g., recommend `snapshot_query`).

### 3. Long-lived server robustness

- Improve TTL cleanup.
- Add explicit `server_reset` in standard mode with confirmations.
- Add memory usage monitoring and leak detection hooks (best-effort).

### 4. Developer experience improvements

- “One command” setup scripts for common stacks.
- More complete runbooks.
- Known issues database keyed by preset + OS + Electron version.

**Confidence:** high.

## Band 2 (3-9 months after V2): Medium fidelity

### 5. Optional “automation hooks” package (if justified)

If V2 usage data shows native dialogs/menus are a major blocker, introduce a separate package:

- `@org/electron-automation-hooks` (dev-only, gated)
- enabled only when `ELECTRON_AUTOMATION=1`
- provides narrowly scoped, declarative hooks:
  - dialog bypass (open/save)
  - deterministic app state reset helpers
  - safe “ready” signals surfaced in the renderer
- never exposes arbitrary IPC invocation from the agent

**Key safety constraint:** hooks are opt-in, minimal, and strongly gated.

**Confidence:** medium (depends on V2 evidence).

### 6. Inspector UI (human-assisted debugging for agents)

A lightweight inspector can dramatically improve productivity:

- shows current windows
- renders the pruned accessibility tree
- allows clicking nodes to copy `ref` / locator hints
- shows the last snapshot epoch and diff highlights

This is not required for automation, but it reduces time spent guessing.

**Confidence:** medium (engineering cost is moderate; payoff is high).

### 7. Recording and replay (bridging to tests)

Add a “record journey” tool that captures:

- snapshots
- actions
- timings
  Output formats:
- agent-readable playbook (markdown)
- optional Playwright test skeleton

**Confidence:** medium (useful, but scope can balloon).

### 8. CI profile (selective)

Electron in CI is feasible but fragile. A bounded CI profile could include:

- Linux Xvfb support
- deterministic packaged builds for CI runs
- artifact upload integration (org-specific)

**Confidence:** medium (depends on CI environment and app constraints).

## Band 3 (9-18+ months after V2): Low fidelity (strategic bets)

### 9. Alternative backend support

Introduce adapters that can be swapped behind the MCP tool surface:

- WDIO adapter (for teams already invested in WDIO)
- CDP-native minimal driver (as a fallback)
- Selenium adapter (lowest priority unless demanded)

**Motivation:** hedge against Playwright Electron limitations.

**Confidence:** low-medium (depends on Playwright trajectory and real blockers).

### 10. Hybrid interaction model (a11y + vision)

For apps that are not a11y-friendly (canvas-heavy, custom controls):

- allow a vision-assisted mode that:
  - uses screenshots + region targeting
  - still prefers deterministic anchors (window, region, previous ref)
- keep it opt-in and tightly capped to avoid context bloat.

**Confidence:** low (engineering and reliability challenges; may require different tool expectations).

### 11. Remote execution service (org platform)

If multiple dev machines or CI runners are needed:

- introduce a remote runner that executes MCP-like calls and returns artifacts
- strong authentication, sandboxing, and audit logging required

**Confidence:** low (large operational surface and security implications).

### 12. Expansion beyond Electron

Potential future targets:

- Tauri (WebView + Rust)
- Flutter desktop
- Qt-based apps
  This likely requires new driver strategies and is a major scope shift.

**Confidence:** low.

# Decision gates and success metrics

To avoid drifting into a maintenance trap, use explicit gates.

## Gate G1: Post-V2 adoption signal

Proceed to Band 2 items only if:

- the tool is used regularly by multiple developers
- reliability is acceptable (defined flake rate threshold)
- diagnostic artifacts reduce time-to-fix vs baseline

## Gate G2: Justification for hooks

Introduce automation hooks only if:

- native dialogs/menus block high-value workflows frequently
- runbook workarounds are insufficient
- security review approves a gated, minimal surface

## Gate G3: Justification for additional backends

Add WDIO/CDP/Selenium support only if:

- Playwright Electron proves insufficient for core workflows
- the added complexity does not compromise safety policy enforcement
- the unified MCP tool surface remains stable

# Long-term safety and governance (required if scope expands)

As the system grows:

- maintain a signed, reviewable policy configuration
- maintain structured audit logs for tool calls and destructive actions
- keep high-risk tools (eval/IPC) behind explicit allowlists and confirmations
- keep the default tool surface minimal

# Appendix: Candidate backlog (idea pool)

This section is intentionally not committed; it is a pool of options.

- incremental snapshot summarization (hierarchical tree summaries)
- semantic element search (local index of recent snapshots)
- deterministic app state reset recipes per preset
- “golden journey” library (smoke flows for common app shells)
- permissions harness (camera/mic/notifications) for Electron-specific scenarios
- auto-update test harness (stubbed) for dev builds
