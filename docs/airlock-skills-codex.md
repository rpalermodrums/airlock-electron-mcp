# Airlock + Codex Integration Specification (Skill + MCP)

Date: 2026-02-07  
Audience: Airlock maintainers, security reviewers, and end users running Codex locally.

## 1. Purpose

Airlock’s goal is to let agentic coding tools drive a **local Electron development environment** with a **browser-like interaction loop** (snapshot → act → re-snapshot), while maintaining a tight, auditable safety boundary.

This document specifies how **Airlock (MCP server)** and a **Codex Agent Skill** should be packaged and used together during a Codex session.

## 2. System components

### 2.1 Airlock brand and package names

- Brand: **Airlock**
- Repo / npm package: **airlock-electron-mcp**
- CLI (human-facing): **airlock-electron**
- MCP server id (in configs): **airlock**

### 2.2 Components and responsibilities

**A) Airlock MCP server (airlock-electron-mcp)**  
Runs locally over **stdio**. Provides a curated tool surface for:

- Launching / closing Electron sessions (dev + packaged)
- Enumerating and selecting windows
- Generating deterministic UI state via accessibility snapshots
- Performing UI actions (click/type/press) scoped to a selected window
- Capturing artifacts (screenshots, console logs, traces, network summaries)

**B) Airlock Codex Skill (airlock-electron)**  
A skill directory containing:

- `SKILL.md`: task framing + operating procedure for agentic Electron automation
- Optional `scripts/`: helper scripts for deterministic setup / cleanup / artifact collection
- Optional `references/`: troubleshooting notes and selector strategy

The skill’s job is to make Codex reliably:

1. determine whether Airlock should be used,
2. set up or validate the MCP connection, and
3. run a safe, repeatable interaction loop.

**C) Codex MCP configuration**  
Codex must be configured to launch the `airlock` MCP server automatically at session start (or otherwise make it available to the session).

## 3. How Codex skills and MCP fit together

### 3.1 Codex skill loading model (progressive disclosure)

Codex starts with skill metadata (`name`, `description`, file path, and optional `agents/openai.yaml`) and loads the full `SKILL.md` body only when it decides to use the skill. This makes the **frontmatter description** the critical trigger surface.

### 3.2 Skill activation modes

Codex can use skills:

- **Explicitly**: the user selects/mentions the skill (e.g., from the `/skills` picker).
- **Implicitly**: Codex chooses the skill when the user request matches the skill’s `description`.

Airlock’s Codex skill should be designed to be safe under implicit activation, but written so it is _unlikely_ to trigger unless the user is clearly asking for Electron UI automation.

### 3.3 MCP server lifecycle (Codex)

Codex can run **stdio MCP servers** defined in `~/.codex/config.toml` (or project overrides in `.codex/config.toml` for trusted projects). Codex can also manage MCP servers via `codex mcp ...` commands.

## 4. End-to-end Codex session model

### 4.1 “Happy path” session flow

1. **Preflight**
   - Confirm the repository is the intended Electron app.
   - Confirm the app uses a supported launch preset (v1 is intentionally opinionated; see below).
   - Confirm Airlock MCP server is available to Codex.

2. **Start an Airlock session**
   - Use the Airlock tool to launch the app (or attach if supported).
   - Receive a `sessionId`.

3. **Window selection**
   - List windows, select the most relevant (default heuristics should be adequate for single-window apps).

4. **Agentic interaction loop**
   - `snapshot` (interactive-filtered by default)
   - Decide next action(s)
   - `click` / `type` / `press_key`
   - `snapshot` again
   - Repeat until objective complete

5. **Diagnostics + artifacts**
   - On failures: capture `screenshot`, `console_messages`, and (if enabled) traces.
   - Persist artifacts into an Airlock-owned folder (see §7.3).

6. **Teardown**
   - Close the session (`app_close`) unless user requests it stay open.

### 4.2 v1 launch preset policy (Codex-facing)

To keep v1 tractable, the Codex skill should assume **exactly one “bulletproof” launch preset** (e.g., electron-vite) and treat everything else as “best effort.” The skill must:

- detect mismatches early, and
- provide a clear “what to do next” path (known config knobs, docs pointers).

## 5. Codex Skill spec (airlock-electron)

### 5.1 Skill directory layout

Recommended (repo-scoped):

```
<repo-root>/
  .agents/
    skills/
      airlock-electron/
        SKILL.md
        agents/
          openai.yaml        # optional (UI metadata only)
        references/
          troubleshooting.md # optional
          selector-guide.md  # optional
        scripts/
          airlock-doctor.sh  # optional
          collect-artifacts.sh  # optional
```

### 5.2 Design constraints for SKILL.md

- `name` and `description` are required in Codex skills.
- The description must include explicit trigger phrases and explicit non-goals.
- The instructions must push Codex toward:
  - accessibility-first targeting,
  - minimal tool surface,
  - explicit confirmation for “mode upgrades” (safe → trusted),
  - and deterministic cleanup.

### 5.3 Example SKILL.md (Codex)

```markdown
---
name: airlock-electron
description: Drive and test a local Electron app UI through the Airlock MCP server (launch, snapshot, click/type, screenshots, console logs). Use when the user asks to reproduce/debug an Electron UI flow locally. Do NOT use for general web browsing or non-UI code tasks.
---

# Airlock: Electron UI Automation (Codex)

## What this skill is for

Use Airlock to interact with a **local Electron app** the way browser automation interacts with a localhost web app:

- launch the app (dev or packaged)
- read state via accessibility snapshots
- click/type/press keys
- capture screenshots + logs for debugging

## Preconditions

- The Airlock MCP server is configured in Codex as server id: `airlock`.
- The user intends to automate a local Electron app (not a website).
- The project uses a supported launch preset (v1: electron-vite preset).

If any precondition is not met, stop and explain what’s missing.

## Operating procedure

1. Confirm objective
   - Restate the UI journey or bug reproduction goal.
   - Ask for any required inputs (test account, seed data) only if necessary.

2. Start the session
   - Use Airlock to launch the app in dev mode using the preset.
   - Record the returned `sessionId`.

3. Identify the target window
   - List windows.
   - Prefer the most recently focused non-devtools window.
   - If ambiguous, ask the user which window to target.

4. Iterate (snapshot -> act -> snapshot)
   - Take an `interactive` snapshot.
   - Choose locators in this order:
     1. role + accessible name
     2. data-testid (if present)
     3. text
     4. CSS selector only as a last resort
   - After each action, re-snapshot before deciding the next action.

5. Debugging and evidence
   - On unexpected UI state, capture:
     - screenshot
     - console messages (errors/warnings)
   - Keep outputs small: summarize; store full artifacts on disk.

6. Cleanup
   - Close the app session unless the user explicitly wants it left running.

## Safety rules

- Default to Airlock safe mode. Do not request or use JS evaluation / IPC unless the user explicitly approves “trusted mode.”
- If the user asks for high-risk actions, explain the tradeoff and require confirmation before proceeding.

## Outputs

- Provide:
  - a short action log (what you did)
  - artifact paths (screenshots/traces/logs)
  - the minimal reproduction steps (if relevant)
```

### 5.4 Optional `agents/openai.yaml` (Codex UI)

Codex supports optional `agents/openai.yaml` for UI appearance metadata. Airlock should use it only for presentation (display name, icon, etc.), not for critical behavior.

Example:

```yaml
interface:
  display_name: "Airlock (Electron)"
  short_description: "Drive and test a local Electron app UI via the Airlock MCP server."
  brand_color: "#111827"
  default_prompt: "Use Airlock to automate this Electron UI flow safely and collect artifacts."
```

## 6. Codex MCP configuration spec

Airlock must be configured as a **stdio MCP server** named `airlock`.

### 6.1 Option A (recommended for individuals): `codex mcp add`

Example pattern:

```bash
# Install Airlock CLI (one-time)
npm i -g airlock-electron-mcp

# Register the MCP server
codex mcp add airlock -- airlock-electron mcp serve --stdio
```

Notes:

- Prefer a stable command that resolves on PATH (`airlock-electron`).
- Use environment variables to keep safe defaults (see §8.2).

### 6.2 Option B (team / repo): `.codex/config.toml`

A project-scoped override is useful for teams, but should only be loaded when Codex trusts the project.

Example:

```toml
[mcp_servers.airlock]
command = "airlock-electron"
args = ["mcp", "serve", "--stdio"]

[mcp_servers.airlock.env]
AIRLOCK_MODE = "safe"
AIRLOCK_ROOT = "."
```

### 6.3 Tool allowlisting (strongly recommended)

Codex can restrict which tools from the Airlock MCP server are exposed by listing `enabled_tools` per server.

Example:

```toml
[mcp_servers.airlock]
command = "airlock-electron"
args = ["mcp", "serve", "--stdio"]
enabled_tools = [
  "app_launch",
  "app_close",
  "window_list",
  "window_select",
  "snapshot",
  "click",
  "type",
  "press_key",
  "wait_for_selector",
  "wait_for_load_state",
  "screenshot",
  "console_messages"
]
```

Keep “high-risk” tools (e.g., `evaluate_js`, `ipc_invoke`) off by default.

## 7. Packaging the full system

### 7.1 Airlock repo layout (recommended)

```
airlock-electron-mcp/
  packages/
    airlock-electron-mcp/        # MCP server + CLI
  integrations/
    codex/
      .agents/skills/airlock-electron/...
      .codex/config.toml.example
```

### 7.2 Release artifacts

Publish:

- npm package: `airlock-electron-mcp`
- optional GitHub release zip containing:
  - Codex skill directory
  - example `.codex/config.toml`
  - quickstart docs

### 7.3 Artifact conventions

Airlock should write artifacts under a predictable root, e.g.:

```
<project>/.airlock/
  sessions/<sessionId>/
    logs/
    screenshots/
    traces/
```

The Codex skill should point users to these paths rather than dumping large outputs into chat.

## 8. End-user installation and usage (Codex)

### 8.1 Install the Codex skill

**Project-scoped (recommended for teams)**  
Copy (or symlink) the skill directory into:

```
<repo>/.agents/skills/airlock-electron/
```

**User-scoped**  
Copy into:

```
~/.agents/skills/airlock-electron/
```

Restart Codex if the skill does not appear.

### 8.2 Install / configure the Airlock MCP server

Recommended: global install + config:

```bash
npm i -g airlock-electron-mcp
codex mcp add airlock -- airlock-electron mcp serve --stdio
```

### 8.3 Verify

Inside Codex:

- Ensure Airlock MCP tools are visible (via your MCP listing UX).
- Run `/skills` and confirm `airlock-electron` appears.

### 8.4 Typical usage prompts

- “Use Airlock to reproduce the settings dialog bug and capture a screenshot and console logs.”
- “Use the airlock-electron skill to run the smoke journey: open app, create a note, verify it appears.”

### 8.5 Uninstall / disable

To disable a skill without deleting it, use `[[skills.config]]` entries in `~/.codex/config.toml`.

## 9. Troubleshooting checklist

1. **Skill not visible**
   - Confirm folder is in a scanned `.agents/skills` location.
   - Restart Codex.

2. **MCP server not starting**
   - Validate you can run: `airlock-electron mcp serve --stdio`
   - Check `~/.codex/config.toml` for typos.
   - Increase startup timeout in config if needed.

3. **App launches but no windows detected**
   - Capture Airlock logs.
   - Confirm the launch preset is supported.
   - Try with a packaged build to isolate dev-server readiness issues.

4. **Snapshots are too large**
   - Use interactive-only snapshots.
   - Prefer viewport-scoped snapshots (if supported) or narrow to a subtree.

## 10. Security posture (Codex)

Recommended defaults:

- Airlock runs in **safe** mode by default.
- Codex exposes only a small allowlist of Airlock tools.
- High-risk tools require explicit user opt-in (env flag + config change).
- Artifacts stay local; the skill summarizes.

## 11. Source references (for maintainers)

- OpenAI Codex Agent Skills docs: https://developers.openai.com/codex/skills/
- OpenAI Codex MCP docs: https://developers.openai.com/codex/mcp
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference/
