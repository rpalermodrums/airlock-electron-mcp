# Airlock: What's Next

Date: 2026-02-07
Status: Active planning document
Supersedes: `airlock-roadmap-3-and-beyond.md` (which remains as strategic reference)

## Where We Are

Airlock V2 shipped with 35 tools, 228 tests, and ~21K lines of TypeScript. The architecture is sound: driver abstraction, policy-as-code, confirmation gates, composable readiness signals, and a structured event log.

We then ran Airlock against a **real Electron application** (canon-keeper: Electron 30.5.1, Vite, React 18, SQLite, 9 views) via CDP attach. The results were clarifying:

**What works well:**

- CDP attach connects cleanly to a running Electron process
- Window detection finds the primary window with correct metadata
- Snapshots capture 47+ nodes with full hierarchy (sidebar, forms, headings, buttons)
- Click by CSS, click by ref, and fill/type all execute correctly against real UI
- Screenshots are high-fidelity (~400KB PNGs capturing the actual rendered state)
- Navigation state changes propagate — clicking "Settings" renders the Settings page, typing into an input enables a submit button

**What needs fixing:**

- The ariaSnapshot parser drops `paragraph: text` lines and leaks YAML annotations (`[disabled]`, `[level=N]`) into node names
- Console and network capture return empty in CDP attach mode
- No readiness gate prevents snapshotting before the page finishes rendering
- The most common real-world Electron setup (Vite + plain Electron) has no matching preset

**What doesn't exist yet:**

- Skills for Claude Code and Codex (spec docs written, SKILL.md files not yet authored)
- npm packaging (missing `files`, `exports`, LICENSE, README)
- An `init` command for easy project onboarding
- End-to-end validation of the full agentic loop through a real MCP skill session

## The Thesis

Airlock's value is making Electron app testing feel as natural as browser automation does today. The gap between "works in unit tests" and "works in a real agent session" is where all the remaining effort should go. Every decision below follows from this:

**Ship a great Electron testing experience. Nothing else until that's proven.**

## Execution Plan

Four legs of work, meant to be executed sequentially. Each builds on the last.

---

### Leg 1: Fix the Parser

**Goal:** Snapshot output that an agent can actually reason over.

The ariaSnapshot parser (`src/driver/playwright.ts:369`, `parseAriaBullet`) was written against a simplified model of Playwright's YAML output. Real apps expose the full format. Six fixes:

| #   | Fix                                                                               | What breaks without it                                                     |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Parse `role: text` format (paragraph, listitem, etc.)                             | Content nodes silently dropped — agent misses on-screen text               |
| 2   | Extract `[disabled]`, `[checked]`, `[level=N]`, `[expanded]` into node properties | Agent can't determine interactive state — clicks disabled buttons          |
| 3   | Strip quotes from names when annotations follow (`"Name" [attr]` → `Name`)        | Names contain literal `"` characters — ref resolution and matching degrade |
| 4   | Handle `role "name": inline text` (e.g., `navigation "Breadcrumb": No project`)   | Inline text content lost, name polluted with colon and trailing text       |
| 5   | Eliminate double document root                                                    | Wastes a node in token budget, confuses tree depth                         |
| 6   | Enable CDP `Runtime`, `Log`, `Network` domains in attach mode                     | Console/network tools return zero entries                                  |

Additionally:

- Add a readiness gate to `attachToCDP()` — wait for `document.readyState === "complete"` on at least one page target before returning the session
- Add a generic Vite+Electron preset covering the `npx electron --remote-debugging-port=N main.ts` pattern

**Validation:** Re-run the integration smoke test against canon-keeper. All 47+ nodes should have clean names, disabled states should be boolean properties (not string annotations), paragraph/text content should be present, and console/network should return entries.

**Test coverage:** Unit tests for each parser fix using real ariaSnapshot output captured from canon-keeper. Integration test formalized as a skippable Vitest suite.

---

### Leg 2: Package and Author Skills

**Goal:** A developer can install Airlock and invoke it from Claude Code or Codex in under 5 minutes.

#### Repo structure

```
integrations/
  claude-code/
    skills/airlock-electron/SKILL.md
    mcp.json.example
    settings.json.example
    README.md
  codex/
    skills/airlock-electron/SKILL.md
    agents/openai.yaml
    config.toml.example
    README.md
```

#### SKILL.md authoring

Both skills encode the same operating procedure with platform-specific details:

1. Confirm objective (restate the UI journey)
2. Start session (`app_launch` with preset or CDP attach config)
3. Select window (default heuristics, ask if ambiguous)
4. Snapshot → act → snapshot loop
5. Evidence collection on failure (screenshot, console, network)
6. Cleanup (close session)

Key adjustments from the spec docs based on integration testing:

- CDP attach is the primary path (not preset launch) — it works with any Electron setup
- CSS selectors are the most reliable locator today; role+name becomes primary after Leg 1 parser fixes
- Actual tool names: `snapshot_interactive` not `snapshot`, `console_recent` not `console_messages`
- No `evaluate_js` or `ipc_invoke` tools exist — remove from permissions examples

#### npm packaging

- Add `files: ["dist", "README.md", "LICENSE"]` to package.json
- Add `exports` for library consumers (`airlock-electron-mcp/driver`)
- Add `airlock-electron` as second bin alias
- Add `prepublishOnly: "npm run typecheck && npm run test && npm run build"`
- Create README.md (user-facing quickstart)
- Create LICENSE (MIT)
- Create `src/index.ts` barrel export

#### Permissions profiles

Ship recommended permission configs for both platforms:

- **allow**: read-only tools (snapshots, screenshots, logs, status, capabilities)
- **ask**: state-changing tools (launch, close, click, type, press, select, hover, scroll, wait, trace)
- **deny**: destructive tools (server_reset, diagnose_session)

---

### Leg 3: End-to-End Validation

**Goal:** Prove the full agentic loop works through a real skill session, not just driver-level calls.

#### Claude Code validation

1. Install the skill and MCP config into canon-keeper
2. Start a Claude Code session in canon-keeper
3. Invoke `/airlock-electron`
4. Execute a multi-step journey:
   - Launch (or attach to) the app
   - Navigate to Setup view
   - Fill in a project folder path
   - Click "Create / Open Project"
   - Add a manuscript file
   - Navigate to different views (Dashboard, Settings)
   - Capture screenshots at each step
5. Close the session
6. Review: Did the agent choose good locators? Were snapshots readable? Did error recovery work? Was the experience smooth?

#### Codex validation

Same journey, if Codex is available. Otherwise defer to post-publish.

#### Friction log

Document every point of friction:

- Confusing tool output
- Bad locator choices
- Snapshot noise
- Missing suggestions in `meta`
- Tool names that don't match what the agent expects
- Permission prompts that interrupt flow unnecessarily

Feed findings back into SKILL.md refinements and tool output improvements.

---

### Leg 4: Distribution Polish

**Goal:** External developers can adopt Airlock without reading source code.

1. **`npx airlock-electron-mcp init`** — scaffolds skill files, MCP config, and permissions into the current project
   - `--target claude-code` / `--target codex` / `--target both`
   - Idempotent (won't overwrite without `--force`)
   - Prints next-steps instructions after scaffolding

2. **npm publish** — v0.2.0 with parser fixes and clean packaging

3. **Quickstart guide** — standalone doc (or README section) covering:
   - Install
   - Configure MCP
   - Install skill
   - First session walkthrough with screenshots

4. **Claude Code plugin** (stretch) — bundle skill + MCP config as a plugin for `claude plugin add`. Only if adoption warrants the infrastructure.

---

## What's Explicitly Deferred

These items from the original V3 roadmap are **not on the critical path** and should not be pursued until the four legs above are complete and adoption signals are positive:

| Item                                                             | Gate                         | Rationale                                               |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| Inspector UI                                                     | G1 (adoption)                | High payoff but only after the CLI experience is proven |
| Recording / replay                                               | G1 (adoption)                | Scope can balloon; need clear user demand first         |
| CI profile (Xvfb, headless)                                      | Separate concern             | Doesn't affect local developer experience               |
| Alternative backends (WDIO, CDP-native)                          | G3 (Playwright insufficient) | Playwright works; no evidence it's the bottleneck       |
| Hybrid vision mode (a11y + screenshots)                          | G3                           | Accessibility tree is rich enough for real apps         |
| Automation hooks package                                         | G2 (native dialog blocker)   | No evidence native dialogs are a major blocker          |
| Remote execution                                                 | Not planned                  | Large security surface, no demonstrated need            |
| Beyond Electron (Tauri, Flutter, Qt)                             | Not planned                  | Out of scope for the foreseeable future                 |
| Long-lived server robustness (memory monitoring, leak detection) | Post-Leg 3                   | Address when real usage surfaces issues                 |

## Success Criteria

Airlock is "done enough" for v0.2.0 when:

1. A developer with no Airlock knowledge can install and run their first agentic Electron session in under 5 minutes
2. The snapshot-act-snapshot loop works reliably against at least one real Electron app (canon-keeper) with clean node names, correct disabled/checked state, and no dropped content
3. Console and network capture return real entries in CDP attach mode
4. Both Claude Code and Codex skills exist with accurate tool names, sensible operating procedures, and safe default permissions
5. The npm package is publishable with correct `files`, `exports`, `bin`, and no dev artifacts leaked

## Estimated Timeline

| Leg | Scope                                          | Sessions |
| --- | ---------------------------------------------- | -------- |
| 1   | Parser fixes + readiness gate + generic preset | 1–2      |
| 2   | Packaging + skills + configs + README/LICENSE  | 1        |
| 3   | E2E validation + friction log                  | 1        |
| 4   | Init command + npm publish + quickstart        | 1–2      |

Total: 4–6 sessions from here to a publishable v0.2.0.
