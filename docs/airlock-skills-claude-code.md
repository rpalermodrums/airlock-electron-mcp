# Airlock + Claude Code Integration Specification (Skill + MCP)

Date: 2026-02-07  
Audience: Airlock maintainers, security reviewers, and end users running Claude Code locally.

## 1. Purpose

This document specifies how **Airlock (Electron MCP bridge)** should integrate with **Claude Code** through:

1. an **MCP server** (stdio) that exposes Airlock’s Electron automation tools, and
2. a **Claude Code skill** that teaches Claude how to use those tools safely and repeatably.

The primary outcome is a workflow that feels like “Claude-in-browser” tooling, but for **local Electron apps**.

## 2. System components

### 2.1 Airlock brand and package names

- Brand: **Airlock**
- Repo / npm package: **airlock-electron-mcp**
- CLI (human-facing): **airlock-electron**
- MCP server id (in configs): **airlock**
- Claude Code skill name: **airlock-electron** (slash command: `/airlock-electron`)

### 2.2 Responsibilities

**A) Airlock MCP server**  
Provides the tool surface (launch, window management, snapshots, actions, artifacts) and enforces safety modes.

**B) Claude Code skill**  
Encodes:

- when to use Airlock
- the step-by-step interaction loop
- safety rules (mode escalation, confirmations, artifact hygiene)
- troubleshooting heuristics

**C) Claude Code MCP configuration**  
Binds the `airlock` server id to a stdio command, either via:

- `claude mcp add` (user/local/project scope), or
- `.mcp.json` (project scope, check-in friendly), or
- a plugin-bundled `.mcp.json`.

## 3. Claude Code: skills + MCP fundamentals relevant to Airlock

### 3.1 Skill file structure and naming (critical)

Anthropic’s skill guidance emphasizes:

- each skill is a folder with a **case-sensitive** `SKILL.md` file,
- use **kebab-case** names (no spaces/capitals),
- keep additional materials under `scripts/`, `references/`, `assets/` (avoid README inside the skill folder),
- the YAML frontmatter description is the primary trigger surface.

### 3.2 Claude Code skill frontmatter features we will use

Claude Code skills support YAML frontmatter fields such as:

- `name`
- `description`
- `argument-hint`
- `disable-model-invocation`
- `allowed-tools`
- `context: fork` (run in a subagent)

For Airlock, the default posture should be **manual invocation**:

- `disable-model-invocation: true`  
  to prevent Claude from auto-loading Airlock in unrelated coding tasks.

### 3.3 MCP configuration in Claude Code

Claude Code supports:

- stdio MCP servers added via `claude mcp add --transport stdio ...`
- project scope servers stored in a root `.mcp.json`
- approval prompts for project-scoped servers (resettable)

It also supports environment variable expansion in `.mcp.json` and plugin-relative variables (see §6).

### 3.4 Permissions model for MCP tools

Claude Code has a tiered permission system and supports fine-grained rules. MCP tools can be controlled with rule patterns like:

- `mcp__airlock` (all tools from the airlock server)
- `mcp__airlock__*` (wildcard all tools)
- `mcp__airlock__snapshot` (single tool)

Airlock should ship with a recommended permission profile (safe-by-default).

## 4. End-to-end Claude Code session model

### 4.1 “Happy path” user workflow

1. **Install Airlock** (CLI available on PATH)
2. **Add MCP server** named `airlock` (stdio) to the desired scope
3. **Verify MCP** inside Claude Code (`/mcp` UI)
4. **Invoke skill**: `/airlock-electron <preset> <mode>`
5. **Run the loop**:
   - launch app
   - select window
   - snapshot → action → snapshot
   - collect artifacts
6. **Close session** unless user requests it remain open

### 4.2 v1 launch preset policy (Claude-facing)

Same as Codex: v1 should focus on **one bulletproof preset** (e.g., electron-vite). The skill should treat other setups as “unsupported / best effort” until Airlock explicitly expands the launch matrix.

## 5. Claude Code Skill spec (airlock-electron)

### 5.1 Skill location and distribution options

Claude Code loads skills from:

- user scope: `~/.claude/skills/<skill-name>/SKILL.md`
- project scope: `.claude/skills/<skill-name>/SKILL.md` (commit to git)
- plugin scope: `<plugin-root>/skills/<skill-name>/SKILL.md`

For Airlock, we recommend:

- **project scope** for per-repo tooling, and
- **plugin distribution** for multi-repo team rollout (v2+).

### 5.2 Example SKILL.md (Claude Code)

```markdown
---
name: airlock-electron
description: Drive and test a local Electron app UI through the Airlock MCP server (launch, snapshot, click/type, screenshots, console logs). Use ONLY when the user asks to automate or debug an Electron UI flow locally. Not for generic coding tasks or web browsing.
argument-hint: "[preset] [dev|packaged]"
disable-model-invocation: true
# allowed-tools: (intentionally omitted for safety; rely on permissions rules)
---

# Airlock: Electron UI Automation (Claude Code)

## Usage

Run:

- `/airlock-electron electron-vite dev`
- `/airlock-electron electron-vite packaged`

If arguments are omitted, assume: `electron-vite dev`.

## Preconditions

- The Airlock MCP server is configured in Claude Code with server id `airlock`.
- The user intends to drive a local Electron app UI.

If the MCP server is not present, stop and instruct the user to add it.

## Operating procedure

1. Confirm objective
   - Restate the UI journey or bug reproduction goal.
   - Identify any required inputs (credentials, seed data).

2. Start an Airlock session
   - Launch the app using the preset + mode.
   - Record `sessionId`.

3. Select the target window
   - List windows.
   - Default to the most recently focused non-devtools window.
   - If ambiguous, ask the user which one to use.

4. Iterate (snapshot -> act -> snapshot)
   - Take an interactive snapshot.
   - Prefer locators:
     1. role + accessible name
     2. data-testid
     3. text
     4. CSS as last resort
   - After each state-changing action, re-snapshot before continuing.

5. Evidence and artifacts
   - On failures or unexpected UI state:
     - screenshot
     - console messages (errors/warnings)
   - Summarize in chat; keep full artifacts on disk.

6. Cleanup
   - Close the session unless the user requests it remain open.

## Safety rules

- Default to Airlock safe mode.
- Do not use high-risk tools (JS evaluation / IPC / arbitrary file access) unless the user explicitly approves enabling “trusted mode.”
- If user requests escalation, explain the risks and require confirmation.
```

### 5.3 Optional: a second skill for “smoke journeys”

For teams, it is often useful to ship a second skill that is:

- user-invocable,
- tightly scoped to a known smoke path (login → create item → verify),
- and heavily artifacted.

Example names:

- `airlock-smoke`
- `airlock-regression-sample`

This reduces prompt ambiguity and improves repeatability.

## 6. Claude Code MCP configuration spec

### 6.1 Option A: add a user-scoped stdio server

```bash
# One-time install (example)
npm i -g airlock-electron-mcp

# Add server
claude mcp add --transport stdio airlock -- airlock-electron mcp serve --stdio
```

### 6.2 Option B: project-scoped `.mcp.json` (recommended for teams)

Create `<repo-root>/.mcp.json`:

```json
{
  "mcpServers": {
    "airlock": {
      "command": "airlock-electron",
      "args": ["mcp", "serve", "--stdio"],
      "env": {
        "AIRLOCK_MODE": "safe",
        "AIRLOCK_ROOT": "${PWD:-.}"
      }
    }
  }
}
```

Claude Code will prompt for approval before using project-scoped servers. Users can reset approval choices with:

```bash
claude mcp reset-project-choices
```

### 6.3 Option C: plugin-bundled `.mcp.json`

Claude Code plugins can include an `.mcp.json` at the plugin root. This is appropriate for distributing Airlock across many repositories without copying configs.

Plugin `.mcp.json` can use plugin-relative variables (if needed) such as `${CLAUDE_PLUGIN_ROOT}`.

## 7. Permissions: recommended safe-by-default profile

### 7.1 Why permissions matter for Airlock

MCP tools can trigger real UI interactions. Even with Airlock’s own safety modes, Claude Code permissions should provide defense-in-depth:

- allow safe read-like tools (snapshots, window list)
- ask for state-changing tools (click/type/launch/close)
- deny high-risk tools (eval/ipc) unless explicitly enabled

### 7.2 Example `.claude/settings.json` (project scope)

Create `<repo-root>/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__airlock__window_list",
      "mcp__airlock__snapshot",
      "mcp__airlock__screenshot",
      "mcp__airlock__console_messages"
    ],
    "ask": [
      "mcp__airlock__app_launch",
      "mcp__airlock__app_close",
      "mcp__airlock__click",
      "mcp__airlock__type",
      "mcp__airlock__press_key",
      "mcp__airlock__wait_for_selector",
      "mcp__airlock__wait_for_load_state"
    ],
    "deny": ["mcp__airlock__evaluate_js", "mcp__airlock__ipc_invoke"]
  }
}
```

Teams can tighten further by denying `mcp__airlock__*` and only allowing a minimal subset.

## 8. Packaging the full system for Claude Code

### 8.1 Repo-local (fastest) packaging

Commit:

```
<repo-root>/
  .claude/
    skills/
      airlock-electron/
        SKILL.md
    settings.json          # optional but recommended (permissions)
  .mcp.json                # MCP server configuration (project scope)
```

### 8.2 Plugin packaging (team rollout)

Plugin structure example:

```
airlock-claude-plugin/
  .claude-plugin/
    plugin.json
  skills/
    airlock-electron/
      SKILL.md
  .mcp.json
  README.md
```

End users can test locally with:

```bash
claude --plugin-dir ./airlock-claude-plugin
```

## 9. End-user installation and usage (Claude Code)

### 9.1 Install Airlock

```bash
npm i -g airlock-electron-mcp
```

Verify:

```bash
airlock-electron --version
```

### 9.2 Add MCP server

User scope:

```bash
claude mcp add --transport stdio airlock -- airlock-electron mcp serve --stdio
```

Project scope (preferred for teams): commit `.mcp.json` as above.

### 9.3 Install skill

Project scope (recommended):

```
<repo>/.claude/skills/airlock-electron/SKILL.md
```

User scope:

```
~/.claude/skills/airlock-electron/SKILL.md
```

### 9.4 Run

In Claude Code:

1. Verify MCP: `/mcp`
2. Invoke the skill:
   - `/airlock-electron electron-vite dev`

### 9.5 Uninstall / disable

- Remove the skill directory, or set `disable-model-invocation: true` (already default).
- Remove or disable the MCP server configuration (scope-dependent).

## 10. Troubleshooting

1. **Skill not visible**
   - Confirm the folder name and `SKILL.md` are correct.
   - Ensure the skill is in `~/.claude/skills` or `.claude/skills`.

2. **MCP server not found**
   - Confirm `claude mcp list`
   - Ensure the command is on PATH.
   - On Windows, Claude docs recommend wrapping stdio servers with `cmd /c`.

3. **Project-scoped server not approved**
   - Re-run and approve, or reset via `claude mcp reset-project-choices`.

4. **MCP output too large**
   - Reduce snapshot size (interactive-only, viewport scoping)
   - Increase max output token limit with the relevant env var (Claude Code supports `MAX_MCP_OUTPUT_TOKENS`).

## 11. Source references (for maintainers)

- Anthropic: The Complete Guide to Building Skill for Claude (PDF): https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf?hsLang=en
- Claude Code skills docs: https://code.claude.com/docs/en/skills
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude Code permissions docs: https://code.claude.com/docs/en/permissions
- Claude Code plugins docs: https://code.claude.com/docs/en/plugins
