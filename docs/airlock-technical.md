Airlock - Electron MCP Bridge for Local Development  
Research and Technical Implementation Plan

Audience: Internal engineering and security  
Date: 2026-02-07

# Executive summary

Objective: build a tool that lets Codex and Claude Code interact with a
local Electron development environment with a workflow comparable to
localhost browser automation (navigate, inspect, click, type, assert),
but with safety and maintainability appropriate to desktop automation.

Core finding: the underlying automation primitives already exist in
well-maintained upstreams (Electron recommends Playwright/WebdriverIO;
Playwright exposes an Electron automation API; MCP provides a standard
transport and security guidance). The missing piece is a trusted,
production-grade “agent bridge” that packages these primitives into a
constrained, agent-friendly tool surface (snapshots + ref-based
actions), and hardens launch, window targeting, and security boundaries.
\[9, 7, 1\]

Recommendation: implement an in-house MCP stdio server that uses
Playwright’s Electron APIs as the backend driver, while borrowing
interaction and safety patterns from Microsoft’s Playwright MCP server
and Playwright CLI projects (accessibility-first snapshots, ref-based
selection, bounded outputs, artifact collection). Keep main-process code
execution disabled by default and use a selective “test-mode bridge”
(IPC allowlist) only where UI automation is inherently flaky (native
dialogs, menu bar, deep internal state). \[7, 14, 15, 9\]

# 1. Scope, goals, and success criteria

## 1.1 Target user workflow

The intended workflow mirrors how agents already use localhost browser
automation:

1. Start the Electron dev environment (optionally including the renderer
   dev server)
2. Launch the Electron app
3. Enumerate windows and select a target window
4. Obtain a structured snapshot for element discovery
5. Perform actions (click/type/press) via stable element references
6. Validate outcomes and collect artifacts for debugging
7. Close the app and clean up resources

## 1.2 Functional requirements (v1)

- Local-first: runs on developer machines via stdio (no exposed
  network service by default). \[16, 17\]

- Cross-platform: macOS, Windows, Linux (within practical
  Playwright/Electron constraints). \[7, 9\]

- Launch + attach: support launching a fresh app session and attaching
  to an existing session via CDP where appropriate. \[7, 9\]

- Multi-window: list/select windows deterministically; never rely on
  implicit 'current window' state alone.

- Accessibility-first inspection: snapshots produce stable ref IDs
  (e.g., e21) for low-token, deterministic targeting. \[14, 15\]

- Artifacts: screenshots, console/network summaries, and optional
  Playwright traces/videos in a server-controlled output directory.
  \[7, 14\]

- Safety modes: safe by default, explicit upgrades to enable high-risk
  capabilities.

## 1.3 Non-goals (for v1)

- General-purpose OS RPA across arbitrary desktop applications.

- Automating privileged OS dialogs without either app instrumentation
  or platform-specific UI automation.

- Replacing existing web E2E tests; this tool complements them for
  Electron-specific coverage.

## 1.4 Definition of “done”

A v1 is “done” when all of the following are true:  
• Codex can launch the local Electron app, discover UI elements via
snapshot, execute a 10-20 step smoke journey, and capture artifacts.  
• Claude Code can run the same journey using the same MCP server
configuration.  
• The default mode is safe: no arbitrary code execution in app processes
and no arbitrary filesystem read/write.  
• The server is stable across at least two common dev setups (e.g.,
Electron Forge + Webpack; electron-vite + Vite).  
• The server cleans up processes reliably on failure (no orphaned
Electron instances).

# 2. Research: primitives, guidance, and prior art

## 2.1 Electron’s official automated testing guidance

Electron’s automated testing guide points developers to modern tooling
(including Playwright and WebdriverIO) and documents that Spectron is
deprecated. It also documents a “custom test driver” pattern where the
app’s main process exposes a test API over IPC/stdio, which is directly
relevant if you later want a deterministic in-app bridge. \[9, 10\]

## 2.2 Playwright’s Electron support: capabilities and caveats

Playwright exposes an Electron automation API via the \_electron
namespace. It can launch Electron, obtain an ElectronApplication handle,
control renderer windows as Page objects, and evaluate code in the main
process (ElectronApplication.evaluate). Playwright documents Electron
automation as experimental and calls out a known launch issue related to
Electron fuses (nodeCliInspect). \[7, 8\]

## 2.3 Spectron deprecation and implications

Spectron’s deprecation is an important historical signal: tightly
coupling a framework to Electron internals can create long-term
maintenance risk. Any in-house tool should minimize reliance on private
Electron APIs and prefer supported automation surfaces (Playwright
Electron, WebDriver, CDP) where possible. \[10\]

## 2.4 Selenium + electron/chromedriver

Electron maintains a dedicated ChromeDriver distribution for Electron.
This keeps the “Selenium route” viable and relatively well supported,
though it tends to be renderer-focused. Main-process and native behavior
typically require additional instrumentation beyond pure WebDriver.
\[12, 9\]

## 2.5 WebdriverIO Electron service

WebdriverIO’s Electron service exists as a Spectron successor and
provides Electron-specific ergonomics on top of WebDriver. This may be
attractive if you already use WebdriverIO, but it is a heavier runtime
and its interaction model is oriented around test suites rather than
persistent, interactive agent loops. \[11\]

## 2.6 Agentic automation patterns from trusted actors

Microsoft’s Playwright MCP server is a widely distributed, trusted
implementation of “agent -\> MCP -\> Playwright -\> browser” that uses
structured accessibility snapshots. Microsoft’s Playwright CLI project
further emphasizes a ref-based UI model and argues that CLI+skills can
be token-efficient for agents. \[14, 15\]

## 2.7 Codex and Claude Code integration constraints

Codex supports MCP servers and configuration via a shared config.toml
file for CLI and IDE extension, including stdio servers (local
subprocesses) and streamable HTTP. Claude Code similarly supports MCP
servers, stores project-scoped server configuration in .mcp.json, and
supports plugins bundling skills + MCP servers. \[16, 17, 19, 18\]

## 2.8 Safety research: prompt injection and agent tooling

Prompt injection is a major risk for agentic browsing. Electron apps may
render untrusted content (remote pages, user-supplied HTML, embedded
webviews), so browser-use safety lessons carry over. The design should
avoid exposing high-impact capabilities by default and should treat UI
text as untrusted input. \[20\]

## 2.9 Community Electron MCP servers (inspiration only)

Community MCP servers targeting Electron exist (e.g., Playwright-backed
Electron MCP servers). These can provide ideas (CDP attach mode, tool
naming), but many are immature and not suitable as dependencies if you
require high assurance and long-term maintenance. \[21\]

# 3. Architecture options and tradeoffs

This section enumerates plausible architectures. The intent is not to
mandate one approach, but to surface the design space and the failure
modes you need to handle.

## 3.1 Option A: Playwright-backed Electron MCP server (local stdio)

Concept: build an MCP stdio server that launches and controls an
ElectronApplication using Playwright’s \_electron API. Expose a curated
tool set modeled after Playwright MCP/CLI (snapshot + ref actions). \[7,
14, 15\]

## 3.2 Option B: MCP facade over WebdriverIO Electron service

Concept: use WebdriverIO + its Electron service as the execution
runtime; your MCP server becomes an adapter translating tool calls into
WebDriver commands. \[11\]

## 3.3 Option C: MCP facade over Selenium + electron/chromedriver

Concept: standardize on WebDriver semantics by driving Electron via
electron/chromedriver. Useful if your org already uses Selenium widely.
\[12, 9\]

## 3.4 Option D: In-app test driver + thin MCP shell

Concept: add a test-only API surface inside the app (main process +
preload) and drive it via IPC/stdio or a loopback socket. Electron
explicitly documents this pattern for automation. \[9\]

## 3.5 Option E: CDP attach (renderer-only) + reuse existing browser MCP semantics

Concept: run Electron with a remote debugging port, connect to Chromium
via CDP, and treat the renderer like a browser target. This can be a
useful fallback when ElectronApplication launch is unreliable, but it
often sacrifices main-process visibility. \[7\]

## 3.6 Option F: OS-level UI automation (accessibility frameworks)

Concept: drive the app via macOS AX / Windows UIA / Linux AT-SPI. This
can automate native menus and dialogs without app modifications, but is
typically costly, flaky, and requires OS-specific permissions and
tooling. Consider it a last resort.

## 3.7 Comparison matrix (simplified)

| Option                     | Best for                                | Key strengths                                           | Primary risks / costs                                                  |
| -------------------------- | --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| A: Playwright Electron MCP | Agentic exploratory UI + smoke flows    | Snapshot/ref UX; can align with Playwright MCP patterns | Electron support is experimental; launch and window hardening required |
| B: WDIO adapter            | Existing WDIO/WebDriver test ecosystems | WebDriver maturity; Electron-specific helpers           | Heavier runtime; agent loop impedance mismatch                         |
| C: Selenium + chromedriver | Selenium-standardized orgs              | Industry standard; Electron-maintained driver           | Renderer-centric; main process/native flows need extra work            |
| D: In-app driver           | High determinism; complex native flows  | Deterministic and fast; good for menus/dialogs          | Requires app changes; test-surface security risk if not isolated       |
| E: CDP attach              | Fallback / attach-to-running            | Avoids some launch issues; can reuse browser tooling    | Limited main process; multi-window targeting can be awkward            |
| F: OS automation           | Hard-to-stub native UI                  | Can cover true native UI                                | High maintenance; cross-platform complexity; permissions friction      |

# 4. Recommended implementation strategy (flexible, not mandatory)

A pragmatic strategy is to build Option A first (Playwright-backed
Electron MCP server), because it delivers the “browser-like agent
workflow” quickly and uses trusted upstreams. Then add Option D
selectively as reliability pressure demands. Keep Option E (CDP attach)
as a deliberate fallback mode.

## 4.1 Why Option A is the best default

- Matches how agents already operate in browsers: snapshot -\> choose
  element -\> click/type -\> re-snapshot. \[14\]

- Uses a single automation runtime across web and Electron
  (Playwright), simplifying developer mental models. \[7\]

- Allows optional main-process coordination when needed, but can keep
  it disabled by default. \[8\]

## 4.2 Why you may still need a test-mode bridge

Certain Electron behaviors are inherently hard to automate solely
through renderer DOM interactions:  
• Native file dialogs (dialog.showOpenDialog / showSaveDialog)  
• OS menu bar interactions  
• Deep internal app state toggles that have no stable UI
representation

Electron’s testing guide explicitly documents custom driver patterns for
cases like these. A test-mode bridge should be small, allowlisted, and
compiled out of production builds if possible. \[9\]

# 5. Technical design: Electron Agent MCP server

## 5.1 Transport and process model

Transport: MCP stdio by default. Codex and Claude Code both support
local subprocess servers. \[16, 17\]

Process model:  
• The client launches the MCP server as a local process.  
• The MCP server launches (or attaches to) an Electron app session.  
• All session state is held inside the MCP server process and is not
shared between clients.

Note: MCP supports richer transports (streamable HTTP) and features
(tasks, cancellation, logging). For a local dev tool, stdio keeps the
trust boundary tight. \[5, 6\]

## 5.2 Core data model

Define explicit IDs to avoid ambiguity:  
• sessionId: unique per ElectronApplication / CDP connection  
• windowId: stable identifier for a BrowserWindow/Page within a
session  
• refId: stable short ID for an element in the most recent snapshot
(scoped to windowId + snapshotVersion)

Store in-memory maps:  
• sessions\[sessionId\] -\> { electronApp \| browser, context, windows,
selectedWindowId, policy, artifactDir }  
• windows\[windowId\] -\> { page, browserWindowHandle?, lastSeenAt,
metadata }  
• snapshots\[(sessionId, windowId)\] -\> { version, refMap, createdAt }

## 5.3 Window enumeration and deterministic targeting

Electron apps are frequently multi-window. The server must:  
• list all windows with metadata: windowId, title, URL, visibility,
focus, and (if available) BrowserWindow.id. \[8\]  
• require windowId on any action OR maintain an explicit
selectedWindowId that is always echoed in responses.  
• handle window lifecycle: windows can close/reopen; IDs must either be
recycled safely or remain unique.

Implementation note: Playwright’s ElectronApplication exposes methods
like firstWindow() and browserWindow(page), and a browser context for
routing. \[8\]

## 5.4 Snapshot engine and ref-based selection

Design goal: enable the model to discover and target elements without
guessing CSS selectors.

Approach:  
• Use Playwright accessibility snapshots as the source of truth
(role/name/value/state).  
• Filter to “interactive” nodes by default (buttons, links, textboxes,
checkboxes, menuitems, etc.).  
• Assign short deterministic ref IDs (e.g., e1, e2, …) in a stable
traversal order.  
• Compute a robust selector strategy per node in priority order:

1. data-testid / test-id conventions (if present)
2. role + accessible name
3. label associations
4. text locators as last resort

Store a refMap { refId -\> selectorDescriptor } keyed by
snapshotVersion. Action tools accept refId and will fail with a typed
error if the snapshotVersion is stale.

## 5.5 Action primitives

Implement a small set of robust primitives, each returning structured
results:  
• click / dblclick / right_click / hover  
• type (append), fill (replace), press_key  
• wait_for (selector/text/load state)  
• screenshot

Each action should:  
• validate sessionId + windowId  
• resolve refId -\> selector  
• execute with bounded timeout  
• on failure, capture a screenshot + include last snapshot summary to
aid debugging

## 5.6 Launch orchestration

Launch orchestration is usually where most time is spent. Support three
first-class launch patterns:  
A) Dev-managed: server starts renderer dev server, waits for readiness,
launches Electron.  
B) Dev-unmanaged: server launches Electron, assumes dev server already
running.  
C) Packaged: server launches a packaged binary.

Readiness signals should be layered (process alive, window exists,
renderer load state, optional app ping). Document known
Playwright/Electron caveats such as nodeCliInspect fuse issues and
provide mitigations. \[7\]

## 5.7 CDP attach mode (fallback)

CDP attach mode should be explicit about limitations:  
• Renderer automation only.  
• No main-process evaluation.  
• Window mapping may be less reliable, depending on target
enumeration.

Use it when ElectronApplication launch is not viable (packaged builds
with restrictive fuses, unusual startup constraints). \[7\]

## 5.8 Optional test-mode bridge (IPC allowlist)

If you choose to implement an in-app bridge, constrain it
aggressively:  
• It should only exist in test builds or when an explicit environment
flag is set.  
• It should expose a small, versioned allowlist of commands (ping,
setFeatureFlag, stubOpenDialog, etc.).  
• Prefer a single IPC channel with a schema (command + params) and
server-side validation.  
• Do not expose arbitrary eval or filesystem access through this
bridge.

Electron’s guide describes building a custom test driver as a general
pattern; MCP can be that external controller. \[9\]

# 6. Safety and security design

## 6.1 Why Electron automation is higher risk than localhost web automation

An Electron app can have filesystem access, OS integrations, and
privileged APIs. Even if your automation driver only clicks UI elements,
it can trigger destructive behavior. Additionally, prompt injection
risks apply anywhere an agent consumes untrusted text, including app UI.
\[20\]

## 6.2 Alignment with MCP security guidance

MCP’s security best practices emphasize user consent/control, careful
authorization, and mitigating attack vectors specific to tool-using
agents. Even though a local stdio server does not use OAuth, you should
adopt the same mindset: least privilege, explicit boundaries, and
auditability. \[2, 1\]

## 6.3 Enforced roots and filesystem policy

MCP roots are a coordination mechanism and not a security boundary by
themselves; server implementations should still validate and enforce
root boundaries. \[3\]

Server policy (recommended):  
• Default: write-only artifacts to a server-chosen output directory.  
• If read access is ever added: allow only within provided roots;
normalize paths; block traversal; cap file size.  
• Never provide arbitrary “run shell” or “kill process” tools in this
server (delegate those to the agent host’s normal capabilities and
approvals).

## 6.4 Origin allowlisting

In dev, renderer windows often load http://localhost:\*. Enforce
allowlists:  
• Default allowed origins: localhost/127.0.0.1 only.  
• If the app navigates to a remote origin, surface a warning in tool
outputs and optionally deny interaction unless explicitly permitted.

Microsoft’s Playwright MCP server includes origin/host restriction
flags; replicate the concept for Electron windows. \[14\]

## 6.5 Dangerous capabilities: main-process evaluation and arbitrary JS

ElectronApplication.evaluate executes code in the main process. This is
essentially remote code execution and should be treated as highly
privileged. \[8\]

Policy:  
• Do not expose main-process eval in v1 safe mode.  
• If exposed at all, require explicit config enablement + client-side
approvals + an allowlist of operations.  
• Prefer safer alternatives (IPC allowlist bridge) for needed
functionality.

## 6.6 Audit logging and redaction

Every tool call should produce an audit record: timestamp, tool name,
session/window, target element (refId), outcome, and artifact pointers.
Redact obvious secrets in logs (tokens, keys) and cap outputs to avoid
accidental exfiltration.

# 7. Tool contract: detailed proposal

## 7.1 Naming and compatibility considerations

Naming matters because agents learn tool patterns. Two viable
strategies:  
A) Electron-specific tool names (electron_app_launch, electron_click, …)
to avoid collisions.  
B) Playwright-MCP-aligned names (browser_click, browser_snapshot) but
scoped by session/window to include Electron.

If you expect to run both browser and Electron servers simultaneously,
prefer Electron-specific names to reduce ambiguity.

## 7.2 Tool schemas (draft)

This section provides a concrete starting point for JSON schemas. Keep
schemas stable and versioned.

app_launch({  
"projectRoot": "string",  
"launchMode": "dev-managed \| dev-unmanaged \| packaged",  
"entryScriptPath": "string (optional)",  
"electronExecutablePath": "string (optional)",  
"args": \["..."\],  
"env": { "KEY": "VALUE" },  
"devServer": {  
"command": "string",  
"cwd": "string (optional)",  
"url": "string",  
"readyRegex": "string (optional)",  
"timeoutMs": 120000  
},  
"timeouts": {  
"launchMs": 60000,  
"firstWindowMs": 60000,  
"readyMs": 60000  
},  
"policy": {  
"mode": "safe \| standard \| trusted",  
"allowedOrigins": \["http://localhost:3000"\],  
"artifactRoot": "string"  
}  
}) -\> { "sessionId": "s1", "windows": \[{ "windowId": "w1", "title":
"...", "url": "..." }\], "selectedWindowId": "w1" }

snapshot({  
"sessionId": "s1",  
"windowId": "w1",  
"filter": "interactive \| all",  
"maxNodes": 250  
}) -\> {  
"snapshotVersion": 3,  
"window": { "title": "...", "url": "..." },  
"nodes": \[  
{ "ref": "e21", "role": "button", "name": "Sign in", "state": {
"disabled": false }, "selector": { "type": "role", "role": "button",
"name": "Sign in" } }  
\]  
}

click({  
"sessionId": "s1",  
"windowId": "w1",  
"ref": "e21",  
"snapshotVersion": 3,  
"button": "left \| right",  
"modifiers": \["Alt", "Shift"\]  
}) -\> { "ok": true }

Key schema choices:  
• snapshotVersion must be provided on actions to detect stale refs.  
• selectorDescriptor is returned for transparency/debugging, but ref IDs
remain the primary interface.  
• outputs should be bounded; do not dump unbounded accessibility trees
into the model context.

# 8. Engineering hard parts and how to de-risk them

## 8.1 Launch matrix and dev-server coordination

You will likely need presets for common setups (Forge, electron-vite,
electron-builder, custom). The server should not attempt to auto-detect
every setup; instead, provide a small set of presets and allow a fully
explicit config for edge cases.

## 8.2 Window targeting drift

Multi-window drift is a frequent source of nondeterminism. Make window
selection explicit and stable:  
• default to selectedWindowId, but require per-action windowId in
non-interactive contexts  
• return window metadata after each action to help agents detect context
changes (title/url updates)  
• detect and report when the selected window closes

## 8.3 Native dialogs and menus

Decide early how to handle dialogs:  
• Prefer stubbing/mocking in test builds via the optional IPC bridge.  
• If you must automate them “for real,” consider OS-level automation
only for those narrow cases.

Avoid weakening app security globally (e.g., disabling contextIsolation)
just to make automation easier; if you must, isolate it to test builds
and document it clearly. Community examples sometimes toggle Electron
security settings for CI convenience; treat that as a caution, not a
default pattern. \[22\]

## 8.4 Known Playwright Electron edge cases

Track known edge cases such as launch hangs and firstWindow timeouts.
Provide diagnostics: capture Electron logs, expose the resolved launch
command, and surface actionable hints. One known class of issues
involves firstWindow timing and devtools; another involves
nodeCliInspect fuse. \[7, 23\]

# 9. Delivery and packaging

## 9.1 Distribution model

Recommended: publish as an internal npm package with a single CLI
entrypoint that starts the MCP server. Keep it “boring”: minimal
dependencies, pinned Playwright versions, and a strict semver policy.

## 9.2 Codex configuration template

Example Codex config.toml entry (stdio):

\[mcp_servers.airlock_electron\]  
command = "node"  
args = \["./node_modules/.bin/airlock-electron-mcp", "serve"\]  
cwd = "/absolute/path/to/repo"

\[mcp_servers.airlock_electron.env\]  
AIRLOCK_MODE = "safe"  
AIRLOCK_PRESET = "electron-vite"  
AIRLOCK_ARTIFACT_ROOT = "/absolute/path/to/repo/.airlock/electron"

## 9.3 Claude Code configuration template

Example project-scoped .mcp.json entry:

{  
"mcpServers": {  
"airlock-electron": {  
"command": "npx",  
"args": \["-y", "@yourorg/airlock-electron-mcp", "serve"\],  
"env": {  
"AIRLOCK_MODE": "safe",  
"AIRLOCK_PRESET": "electron-vite",  
"AIRLOCK_ARTIFACT_ROOT": ".airlock/electron"  
}  
}  
}  
}

## 9.4 Plugin/skill packaging

For organization-wide rollout in Claude Code, package as a plugin that
bundles:  
• the MCP server  
• a short skill/runbook describing the canonical test loop  
• troubleshooting instructions

Claude Code supports plugin-provided MCP servers. \[18\]

# 10. Project plan and estimates

## 10.1 Suggested milestones

**Week 1: POC:** Launch + snapshot + click/type + screenshot + close for
one app config; basic artifacts.

**Weeks 2-3: Beta hardening:** Multi-window, launch presets, better
waits, error taxonomy, safe mode enforcement, CI demo app.

**Weeks 4-5: Production baseline:** Artifacts/tracing polish, CDP attach
fallback, documentation, skill/plugin packaging, security review.

**Optional: App bridge:** IPC allowlist for dialogs/menus and “app ping”
readiness; keep separate from core server.

## 10.2 Maintenance plan (avoid future maintenance risk)

To reduce maintenance risk:  
• Track Playwright versions and test against latest regularly.  
• Keep the server’s tool surface stable and minimal.  
• Add regression tests for every flake fix.  
• Prefer upstream patterns (Playwright MCP/CLI) to bespoke inventions.  
• Perform periodic security review focusing on tool gating, root
enforcement, and log redaction.

# References

**\[1\] Model Context Protocol Specification (protocol revision
2025-11-25). modelcontextprotocol.io.** Accessed 2026-02-07.  
https://modelcontextprotocol.io/specification/2025-11-25

**\[2\] Security Best Practices (MCP, 2025-11-25).
modelcontextprotocol.io.** Accessed 2026-02-07.  
https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices

**\[3\] Roots (MCP, 2025-11-25). modelcontextprotocol.io.** Accessed
2026-02-07.  
https://modelcontextprotocol.io/specification/2025-11-25/client/roots

**\[5\] Transports (MCP, 2025-11-25). modelcontextprotocol.io.**
Accessed 2026-02-07.  
https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

**\[6\] Tasks utility (MCP, 2025-11-25). modelcontextprotocol.io.**
Accessed 2026-02-07.  
https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks

**\[7\] Electron (Playwright API documentation). playwright.dev.**
Accessed 2026-02-07.  
https://playwright.dev/docs/api/class-electron

**\[8\] ElectronApplication (Playwright API documentation).
playwright.dev.** Accessed 2026-02-07.  
https://playwright.dev/docs/api/class-electronapplication

**\[9\] Automated Testing (Electron documentation). electronjs.org.**
Accessed 2026-02-07.  
https://www.electronjs.org/docs/latest/tutorial/automated-testing

**\[10\] Spectron deprecation notice (Electron blog). electronjs.org.**
Accessed 2026-02-07.  
https://www.electronjs.org/blog/spectron-deprecation-notice

**\[11\] WebdriverIO Electron Service documentation. webdriver.io.**
Accessed 2026-02-07.  
https://webdriver.io/docs/wdio-electron-service/

**\[12\] electron/chromedriver releases (Electron ChromeDriver
distribution). GitHub.** Accessed 2026-02-07.  
https://github.com/electron/chromedriver/releases

**\[14\] Microsoft Playwright MCP server (repository). GitHub.**
Accessed 2026-02-07.  
https://github.com/microsoft/playwright-mcp

**\[15\] Microsoft Playwright CLI (repository). GitHub.** Accessed
2026-02-07.  
https://github.com/microsoft/playwright-cli

**\[16\] OpenAI Codex: Model Context Protocol documentation.
developers.openai.com.** Accessed 2026-02-07.  
https://developers.openai.com/codex/mcp/

**\[17\] Claude Code: Connect to tools via MCP. code.claude.com.**
Accessed 2026-02-07.  
https://code.claude.com/docs/en/mcp

**\[18\] Claude Code: Plugins reference. code.claude.com.** Accessed
2026-02-07.  
https://code.claude.com/docs/en/plugins-reference

**\[19\] Claude Code: Settings (.mcp.json, server config).
code.claude.com.** Accessed 2026-02-07.  
https://code.claude.com/docs/en/settings

**\[20\] Mitigating the risk of prompt injections in browser use.
anthropic.com.** Accessed 2026-02-07.  
https://www.anthropic.com/research/prompt-injection-defenses

**\[21\] electron-test-mcp (community example; inspiration only).
GitHub.** Accessed 2026-02-07.  
https://github.com/lazy-dinosaur/electron-test-mcp

**\[22\] electron-playwright-example (multi-window Playwright tests for
Electron). GitHub.** Accessed 2026-02-07.  
https://github.com/spaceagetv/electron-playwright-example

**\[23\] Playwright issue \#21117: Electron firstWindow() timeouts
unless devtools opened. GitHub.** Accessed 2026-02-07.  
https://github.com/microsoft/playwright/issues/21117
