# V2 Build Session Prompt

Use this as the opening prompt for the next Claude Code + Codex Orchestrator session.

---

## Prompt

```
/codex-orchestrator

Read the following docs in order to build full context:

1. docs/airlock-v1-status.md — what V1 actually shipped (17 tools, driver abstraction, branded types, snapshot engine, test suite)
2. docs/airlock-roadmap-2.md — the V2 spec you'll be implementing
3. docs/airlock-v1-status.md "Deferred to V1 Completion" section — some of these items are prerequisites for V2

Before spawning any agents, confirm your understanding of:

### V2 Workstreams (from the roadmap)

**A. Launch Orchestration Hardening**
- Add 2-4 versioned launch presets (electron-vite already exists, add Electron Forge + electron-builder)
- Build a composable readiness signal engine (replace the current monolithic wait)
- Elevate CDP attach from fallback to first-class peer entry point
- Actionable diagnostics on every failure path

**B. Snapshot System Evolution**
- `snapshot_diff({ sinceEpoch })` — delta snapshots (changed/added/removed nodes)
- `snapshot_region({ rect | anchorRef, radiusPx })` — viewport/region-scoped
- `scroll_to({ ref | locator })` — best-effort scroll helper
- Query-first defaults (enforce caps on full snapshots)
- Cross-epoch ref re-resolution using cached locatorHints (the V1 foundation is already in place)

**C. Window Management**
- `wait_for_window({ titleContains | urlContains | createdAfter, timeoutMs })` — wait for transient/modal windows
- `window_default_get` / `window_default_set` — explicit default window management
- Enhanced implicit window targeting with modal detection

**D. Observability**
- `trace_start({ sessionId })` / `trace_stop({ sessionId })` — Playwright tracing
- `export_artifacts(sessionId)` — zipped bundle of all session artifacts
- Crash/hang diagnostics (best-effort: detect renderer unresponsiveness)

**E. Safety**
- Policy-as-code: YAML/JSON policy files defining roots, allowed env vars, allowed hostnames, per-mode tool gating
- Confirmation gates: tools can return `requiresConfirmation: true` + `confirmationId`; client calls `confirm(confirmationId)` to proceed
- Output redaction for secrets in logs (pattern-based + allowlist)

**F. Packaging & DX**
- Improved doctor/preflight tooling
- Known failure playbooks keyed by preset + OS + Electron version

### V1 Foundation You're Building On

These architectural decisions are already in place — use them, don't rebuild them:

- `ElectronDriver` interface in `src/driver/index.ts` — all tools go through this abstraction
- `ToolResult<T>` with `meta: { suggestions, warnings, diagnostics }` — extensible response envelope
- `defineAirlockTool()` in `src/server.ts` — tool registration with mode gating, validation, event logging
- Branded types: `SessionId`, `WindowId`, `RefId` in `src/types/session.ts`
- `RefMap` with epoch tracking and `SelectorDescriptor` priority chain in `src/snapshot/ref-map.ts`
- `SessionManager` with TTL cleanup and per-window ref-map tracking in `src/session-manager.ts`
- `EventLog` ring buffer with redaction in `src/utils/event-log.ts`
- `Session.traceState` already has the optional slot for V2 tracing
- `AirlockError` already has `requiresConfirmation` and `confirmationId` fields for V2 confirmation gates
- Safety policy types (`SafetyPolicy`, `ModeCapabilities`) already structured as config objects

### Also Complete the Deferred V1 Items

Before or alongside V2 work, finish these V1-scoped items that aren't yet wired:

- `app_kill` tool (capability flag `allowAppKill` exists, needs tool)
- `session_info` tool (schemas exist, needs tool)
- `window_focus` tool
- `select` action tool (driver supports it)
- `hover` action tool (driver supports it)
- `network_recent` tool (needs driver method + tool)
- `server_reset` tool (SessionManager.reset() exists, needs tool)

### Agent Strategy

Suggested Codex agent waves:

**Wave 1 (parallel):**
- Agent 1: Deferred V1 tools (app_kill, session_info, window_focus, select, hover, network_recent, server_reset)
- Agent 2: Composable readiness signal engine + preset DSL refactor
- Agent 3: Policy-as-code engine (YAML/JSON loader, validation, integration with existing mode gating)

**Wave 2 (parallel, depends on Wave 1):**
- Agent 4: New snapshot tools (snapshot_diff, snapshot_region, scroll_to) + cross-epoch ref re-resolution
- Agent 5: Window management tools (wait_for_window, window_default_get/set, modal detection)
- Agent 6: Tracing + export_artifacts + crash diagnostics

**Wave 3 (parallel, depends on Wave 2):**
- Agent 7: Confirmation gate protocol implementation
- Agent 8: Additional launch presets (Forge, electron-builder)
- Agent 9: Tests for all new tools and features

**Wave 4:**
- Agent 10: Typecheck fix-up (exactOptionalPropertyTypes will cause issues)
- Agent 11: Documentation updates (v2-status.md)
- Agent 12: Commit agent (conventional commits, chunked logically)

### Key Lessons From V1 Build

- Codex agents conflict on shared files (especially `src/tools/index.ts`) — tell each agent to treat existing files as baseline and only ADD their tools
- `exactOptionalPropertyTypes: true` in tsconfig causes bulk type errors with Zod-parsed optional fields — the typefix agent should expect ~20-30 errors
- `page.accessibility.snapshot()` is deprecated in modern Playwright — the driver already handles this but new snapshot code should use the locator-based approach
- Codex sandbox can't install npm packages or modify .git — handle installs and commits with dedicated agents or locally
- Always send "treat existing files as baseline" when agents detect unexpected files from parallel work

Now plan the implementation and spawn agents.
```
