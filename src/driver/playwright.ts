import process from "node:process";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import { _electron, chromium } from "playwright";

import { createAirlockError } from "../types/index.js";
import type {
  ActionResult,
  ConsoleEntry,
  ConsoleLogOptions,
  DriverAction,
  DriverAttachConfig,
  DriverLaunchConfig,
  DriverSession,
  DriverWindow,
  ElectronDriver,
  RawSnapshot,
  RawSnapshotNode,
  ScreenshotOptions,
  ActionTarget
} from "./index.js";

type ElectronApplication = Awaited<ReturnType<typeof _electron.launch>>;
type CDPBrowser = Awaited<ReturnType<typeof chromium.connectOverCDP>>;
type Page = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;
type Locator = ReturnType<Page["locator"]>;

interface SnapshotRefDescriptor {
  role: string;
  name: string;
  nth: number;
}

interface DriverRuntime {
  sessionId: string;
  launchMode: DriverSession["launchMode"];
  electronApp?: ElectronApplication;
  browser?: CDPBrowser;
  processRef?: ChildProcess;
  windowsById: Map<string, Page>;
  pageIds: WeakMap<Page, string>;
  refDescriptorsByWindowId: Map<string, Map<string, SnapshotRefDescriptor>>;
  consoleEntries: ConsoleEntry[];
  teardownCallbacks: Array<() => void>;
  windowSequence: {
    value: number;
  };
  recentStdout: LineRingBuffer;
  recentStderr: LineRingBuffer;
}

interface AccessibilityNode {
  role?: unknown;
  name?: unknown;
  value?: unknown;
  disabled?: unknown;
  checked?: unknown;
  children?: unknown;
}

interface LineRingBuffer {
  pushChunk: (chunk: string) => void;
  lines: () => readonly string[];
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;
const DEFAULT_FIRST_WINDOW_TIMEOUT_MS = 20_000;
const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
const DEFAULT_ATTACH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SNAPSHOT_NODES = 500;
const DEFAULT_MAX_TEXT_CHARS = 240;
const DEFAULT_CONSOLE_LIMIT = 100;
const CONSOLE_BUFFER_LIMIT = 500;
const DIAGNOSTIC_RING_LINES = 80;

const LEVEL_PRIORITY: Record<ConsoleEntry["level"], number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

const VALID_ROLES = new Set([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "dialog",
  "directory",
  "document",
  "feed",
  "figure",
  "form",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem"
]);

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const asErrorMessage = (value: unknown): string => {
  return value instanceof Error ? value.message : String(value);
};

const normalizeRole = (role: string): string => {
  return role.trim().toLowerCase().replace(/\s+/g, "");
};

const isValueType = (value: unknown): value is string | number | boolean | null => {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
};

const toBoolean = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const toNumberOption = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
};

const createLineRingBuffer = (capacity: number): LineRingBuffer => {
  const state = {
    carry: "",
    lines: [] as string[]
  };

  const pushLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    state.lines.push(trimmed);
    if (state.lines.length > capacity) {
      state.lines.splice(0, state.lines.length - capacity);
    }
  };

  return {
    pushChunk: (chunk: string): void => {
      const combined = `${state.carry}${chunk}`;
      const parts = combined.split(/\r?\n/);
      const complete = parts.slice(0, -1);
      state.carry = parts.at(-1) ?? "";

      for (const line of complete) {
        pushLine(line);
      }
    },
    lines: (): readonly string[] => {
      return [...state.lines, ...(state.carry.trim().length > 0 ? [state.carry.trim()] : [])];
    }
  };
};

const attachStreamRingBuffer = (stream: Readable | null | undefined, ring: LineRingBuffer): (() => void) => {
  if (stream === null || stream === undefined) {
    return () => {
      return;
    };
  }

  const onData = (chunk: Buffer | string): void => {
    ring.pushChunk(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  };

  stream.on("data", onData);
  return () => {
    stream.off("data", onData);
  };
};

const classifyWindowKind = (url: string): DriverWindow["kind"] => {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith("devtools://")) {
    return "devtools";
  }

  if (normalized.startsWith("chrome-devtools://")) {
    return "devtools";
  }

  return "primary";
};

const mapConsoleLevel = (type: string): ConsoleEntry["level"] => {
  if (type === "error") {
    return "error";
  }

  if (type === "warning" || type === "warn") {
    return "warn";
  }

  if (type === "debug") {
    return "debug";
  }

  if (type === "trace") {
    return "trace";
  }

  return "info";
};

const parseJsonString = (input: string): string | null => {
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
};

const parseRoleSelector = (selector: string): { role: string; name?: string } | null => {
  const fullMatch = selector.match(
    /^page\.getByRole\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*,\s*\{\s*name\s*:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*\}\s*\)$/
  );
  if (fullMatch !== null) {
    const roleInput = fullMatch[1];
    const nameInput = fullMatch[4];
    const role = typeof roleInput === "string" ? parseJsonString(roleInput) : null;
    const name = typeof nameInput === "string" ? parseJsonString(nameInput) : null;
    if (typeof role === "string" && typeof name === "string") {
      return {
        role,
        name
      };
    }
  }

  const roleOnlyMatch = selector.match(/^page\.getByRole\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*\)$/);
  if (roleOnlyMatch !== null) {
    const roleInput = roleOnlyMatch[1];
    const role = typeof roleInput === "string" ? parseJsonString(roleInput) : null;
    if (typeof role === "string") {
      return {
        role
      };
    }
  }

  return null;
};

const parseCallArgumentString = (
  selector: string,
  functionName: "page.getByTestId" | "page.locator"
): string | null => {
  const prefix = `${functionName}(`;
  if (!selector.startsWith(prefix) || !selector.endsWith(")")) {
    return null;
  }

  const argumentText = selector.slice(prefix.length, -1).trim();
  return parseJsonString(argumentText);
};

const maybeParseNode = (value: unknown): AccessibilityNode | null => {
  return isObject(value) ? (value as AccessibilityNode) : null;
};

const unquoteAriaText = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }

  return trimmed;
};

const parseAriaBullet = (line: string): { role: string; name: string; value?: string } | null => {
  if (!line.startsWith("- ")) {
    return null;
  }

  const content = line.slice(2).trim();
  if (content.length === 0) {
    return null;
  }

  const textMatch = content.match(/^text:\s*(.+)$/);
  if (textMatch !== null) {
    const textValue = unquoteAriaText(textMatch[1] ?? "");
    return {
      role: "text",
      name: textValue,
      ...(textValue.length > 0 ? { value: textValue } : {})
    };
  }

  const withoutColon = content.endsWith(":") ? content.slice(0, -1).trim() : content;
  const roleNameMatch = withoutColon.match(/^([a-zA-Z0-9_-]+)(?:\s+(.+))?$/);
  if (roleNameMatch === null) {
    return null;
  }

  const role = (roleNameMatch[1] ?? "").trim().toLowerCase();
  const rawName = roleNameMatch[2];
  const name = rawName === undefined ? "" : unquoteAriaText(rawName);
  if (role.length === 0) {
    return null;
  }

  return {
    role,
    name
  };
};

const parseAriaSnapshot = (snapshot: string): AccessibilityNode | null => {
  const lines = snapshot.split(/\r?\n/);
  const root: AccessibilityNode = {
    role: "document",
    name: "",
    children: []
  };
  const stack: Array<{ indent: number; node: AccessibilityNode }> = [
    {
      indent: -1,
      node: root
    }
  ];

  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const parsed = parseAriaBullet(rawLine.trimStart());
    if (parsed === null) {
      continue;
    }

    while (stack.length > 1 && indent <= (stack.at(-1)?.indent ?? -1)) {
      stack.pop();
    }

    const parent = stack.at(-1)?.node;
    if (parent === undefined) {
      continue;
    }

    const childNode: AccessibilityNode = {
      role: parsed.role,
      name: parsed.name,
      ...(parsed.value === undefined ? {} : { value: parsed.value }),
      children: []
    };

    const parentChildren = Array.isArray(parent.children) ? (parent.children as unknown[]) : [];
    parent.children = [...parentChildren, childNode];
    stack.push({
      indent,
      node: childNode
    });
  }

  const rootChildren = Array.isArray(root.children) ? root.children : [];
  return rootChildren.length === 0 ? null : root;
};

const safeTitle = async (page: Page): Promise<string> => {
  try {
    return await page.title();
  } catch {
    return "";
  }
};

const safeFocused = async (page: Page): Promise<boolean> => {
  try {
    return await page.evaluate(() => document.hasFocus());
  } catch {
    return false;
  }
};

const readActionTimeout = (action: DriverAction): number => {
  const candidate = isObject(action) ? action["timeoutMs"] : undefined;
  return toNumberOption(candidate, DEFAULT_ACTION_TIMEOUT_MS);
};

const buildPressShortcut = (action: DriverAction): string => {
  const key = action.key;
  if (typeof key !== "string" || key.length === 0) {
    throw createAirlockError("INVALID_INPUT", "Key is required for keyboard press actions.", false);
  }

  if (key.includes("+")) {
    return key;
  }

  const modifiers = Array.isArray(action.modifiers)
    ? action.modifiers.filter((modifier): modifier is string => typeof modifier === "string" && modifier.length > 0)
    : [];

  return [...modifiers, key].join("+");
};

const toLaunchMode = (config: DriverLaunchConfig): DriverSession["launchMode"] => {
  return config.preset === undefined ? "custom" : "preset";
};

const withOptionalKey = <TValue>(
  key: string,
  value: TValue | undefined
): Record<string, TValue> | Record<string, never> => {
  return value === undefined ? {} : { [key]: value };
};

const toLaunchEnv = (overrides: DriverLaunchConfig["env"] | undefined): Record<string, string> => {
  const merged = {
    ...process.env,
    ...(overrides ?? {})
  };

  return Object.entries(merged).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (typeof value === "string") {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
};

const toDriverError = (
  code:
    | "INVALID_INPUT"
    | "SESSION_NOT_FOUND"
    | "WINDOW_NOT_FOUND"
    | "STALE_SNAPSHOT"
    | "LAUNCH_FAILED"
    | "INTERNAL_ERROR",
  message: string,
  retriable: boolean,
  details?: Record<string, unknown>
) => {
  return createAirlockError(code, message, retriable, details);
};

export class PlaywrightElectronDriver implements ElectronDriver {
  private readonly runtimes: Map<string, DriverRuntime>;
  private readonly windowToSessionIndex: Map<string, string>;

  public constructor() {
    this.runtimes = new Map<string, DriverRuntime>();
    this.windowToSessionIndex = new Map<string, string>();
  }

  public async launch(config: DriverLaunchConfig): Promise<DriverSession> {
    const sessionId = config.sessionId ?? randomUUID();
    const launchMode = toLaunchMode(config);
    const launchTimeoutMs = config.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
    const firstWindowTimeoutMs = config.firstWindowTimeoutMs ?? DEFAULT_FIRST_WINDOW_TIMEOUT_MS;

    const launchOptions = {
      args: [...(config.args ?? [])],
      cwd: config.projectRoot,
      env: toLaunchEnv(config.env),
      timeout: launchTimeoutMs,
      ...withOptionalKey("executablePath", config.executablePath)
    };

    const recentStdout = createLineRingBuffer(DIAGNOSTIC_RING_LINES);
    const recentStderr = createLineRingBuffer(DIAGNOSTIC_RING_LINES);

    try {
      const electronApp = await _electron.launch(launchOptions);
      const processRef = electronApp.process();
      const teardownCallbacks = [
        attachStreamRingBuffer(processRef?.stdout, recentStdout),
        attachStreamRingBuffer(processRef?.stderr, recentStderr)
      ];

      const windowEvents: string[] = [];
      const onWindow = (page: Page): void => {
        const titlePromise = safeTitle(page);
        void titlePromise.then((title) => {
          const url = page.url();
          windowEvents.push(`${new Date().toISOString()} ${title} ${url}`.trim());
          if (windowEvents.length > DIAGNOSTIC_RING_LINES) {
            windowEvents.splice(0, windowEvents.length - DIAGNOSTIC_RING_LINES);
          }
        });
      };

      electronApp.on("window", onWindow);
      teardownCallbacks.push(() => {
        electronApp.off("window", onWindow);
      });

      try {
        await electronApp.firstWindow({ timeout: firstWindowTimeoutMs });
      } catch (error: unknown) {
        await electronApp.close().catch(() => {
          return;
        });

        throw toDriverError(
          "LAUNCH_FAILED",
          "Electron launched but no first window became ready within timeout.",
          true,
          {
            sessionId,
            timeoutMs: firstWindowTimeoutMs,
            launchMode,
            executablePath: config.executablePath,
            args: config.args,
            projectRoot: config.projectRoot,
            processId: processRef?.pid,
            exitCode: processRef?.exitCode,
            signalCode: processRef?.signalCode,
            stdout: recentStdout.lines(),
            stderr: recentStderr.lines(),
            windowEvents,
            cause: asErrorMessage(error)
          }
        );
      }

      const runtime = this.createRuntime({
        sessionId,
        launchMode,
        electronApp,
        processRef,
        recentStdout,
        recentStderr,
        teardownCallbacks
      });

      this.registerRuntime(runtime);
      this.bindElectronConsole(runtime);
      await this.refreshWindows(runtime);

      return {
        id: sessionId,
        launchMode,
        metadata: {
          runtimeId: sessionId,
          electronApp,
          processId: processRef?.pid
        }
      };
    } catch (error: unknown) {
      if (isObject(error) && typeof error.code === "string" && typeof error.message === "string") {
        throw error;
      }

      throw toDriverError("LAUNCH_FAILED", "Failed to launch Electron via Playwright.", true, {
        sessionId,
        projectRoot: config.projectRoot,
        executablePath: config.executablePath,
        args: config.args,
        stdout: recentStdout.lines(),
        stderr: recentStderr.lines(),
        cause: asErrorMessage(error)
      });
    }
  }

  public async attach(config: DriverAttachConfig): Promise<DriverSession> {
    const endpoint = config.wsEndpoint ?? config.cdpUrl;
    if (endpoint === undefined || endpoint.length === 0) {
      throw toDriverError("INVALID_INPUT", "Attach requires either wsEndpoint or cdpUrl.", false);
    }

    const sessionId = config.sessionId ?? randomUUID();
    const timeoutMs = config.timeoutMs ?? DEFAULT_ATTACH_TIMEOUT_MS;

    try {
      const browser = await chromium.connectOverCDP(endpoint, {
        timeout: timeoutMs
      });
      const cdpTargets = await (async (): Promise<{
        targets: readonly { type?: string; url?: string; targetId?: string }[];
        primaryRendererTargetId?: string;
        primaryRendererUrl?: string;
      }> => {
        try {
          const cdpSession = await browser.newBrowserCDPSession();
          const response = (await cdpSession.send("Target.getTargets")) as {
            targetInfos?: Array<{ type?: string; url?: string; targetId?: string }>;
          };
          await cdpSession.detach();
          const targets = Array.isArray(response.targetInfos) ? response.targetInfos : [];
          const primaryRenderer =
            targets.find(
              (target) =>
                target.type === "page" &&
                typeof target.url === "string" &&
                !target.url.toLowerCase().startsWith("devtools://") &&
                !target.url.toLowerCase().startsWith("chrome-devtools://")
            ) ?? targets.find((target) => target.type === "page");

          return {
            targets,
            ...(primaryRenderer?.targetId === undefined ? {} : { primaryRendererTargetId: primaryRenderer.targetId }),
            ...(primaryRenderer?.url === undefined ? {} : { primaryRendererUrl: primaryRenderer.url })
          };
        } catch {
          return {
            targets: []
          };
        }
      })();

      const runtime = this.createRuntime({
        sessionId,
        launchMode: "attached",
        browser,
        recentStdout: createLineRingBuffer(DIAGNOSTIC_RING_LINES),
        recentStderr: createLineRingBuffer(DIAGNOSTIC_RING_LINES),
        teardownCallbacks: []
      });

      this.registerRuntime(runtime);
      this.bindBrowserConsole(runtime);
      const windows = await this.refreshWindows(runtime);
      const primaryWindow =
        (cdpTargets.primaryRendererUrl === undefined
          ? undefined
          : windows.find((window) => window.url === cdpTargets.primaryRendererUrl && window.kind !== "devtools")) ??
        windows.find((window) => window.kind !== "devtools") ??
        windows[0];

      return {
        id: sessionId,
        launchMode: "attached",
        metadata: {
          runtimeId: sessionId,
          browser,
          cdpEndpoint: endpoint,
          primaryWindowId: primaryWindow?.id,
          attachTargetCount: cdpTargets.targets.length,
          ...(cdpTargets.primaryRendererTargetId === undefined
            ? {}
            : {
                primaryRendererTargetId: cdpTargets.primaryRendererTargetId
              })
        }
      };
    } catch (error: unknown) {
      throw toDriverError("LAUNCH_FAILED", "Failed to attach to Electron via CDP.", true, {
        endpoint,
        timeoutMs,
        cause: asErrorMessage(error)
      });
    }
  }

  public async getWindows(session: DriverSession): Promise<DriverWindow[]> {
    const runtime = this.requireRuntime(session);
    return this.refreshWindows(runtime);
  }

  public async getSnapshot(driverWindow: DriverWindow, options?: Record<string, unknown>): Promise<RawSnapshot> {
    const page = this.requireWindowPage(driverWindow.id);
    const runtime = this.requireRuntimeForWindow(driverWindow.id);
    const maxNodes = toNumberOption(options?.maxNodes, DEFAULT_MAX_SNAPSHOT_NODES);
    const maxTextChars = toNumberOption(options?.maxTextCharsPerNode, DEFAULT_MAX_TEXT_CHARS);

    try {
      const ariaSnapshot = await page.locator(":root").ariaSnapshot();
      const tree = parseAriaSnapshot(ariaSnapshot);
      const refDescriptors = new Map<string, SnapshotRefDescriptor>();
      const duplicateCounters = new Map<string, number>();
      const traversal = {
        nodeCount: 0,
        truncated: false,
        truncationReason: undefined as string | undefined
      };

      const walk = (candidate: unknown): RawSnapshotNode | null => {
        if (traversal.truncated) {
          return null;
        }

        const node = maybeParseNode(candidate);
        if (node === null) {
          return null;
        }

        if (traversal.nodeCount >= maxNodes) {
          traversal.truncated = true;
          traversal.truncationReason = `Exceeded maxNodes=${maxNodes}.`;
          return null;
        }

        traversal.nodeCount += 1;
        const ref = `ax-${traversal.nodeCount}`;
        const role = typeof node.role === "string" && node.role.length > 0 ? node.role : "unknown";
        const rawName = typeof node.name === "string" ? node.name : "";
        const name = rawName.length > maxTextChars ? rawName.slice(0, maxTextChars) : rawName;
        const duplicateKey = `${normalizeRole(role)}::${name}`;
        const nth = duplicateCounters.get(duplicateKey) ?? 0;
        duplicateCounters.set(duplicateKey, nth + 1);
        const disabled = toBoolean(node.disabled);
        const checked = toBoolean(node.checked);

        const rawNode: RawSnapshotNode = {
          ref,
          role,
          name,
          ...(isValueType(node.value) ? { value: node.value } : {}),
          ...(disabled === undefined ? {} : { disabled }),
          ...(checked === undefined ? {} : { checked })
        };

        const normalizedRole = normalizeRole(role);
        if (VALID_ROLES.has(normalizedRole) || name.length > 0) {
          refDescriptors.set(ref, {
            role: normalizedRole,
            name,
            nth
          });
        }

        const children = Array.isArray(node.children) ? node.children : [];
        const mappedChildren: RawSnapshotNode[] = [];
        for (const child of children) {
          const mappedChild = walk(child);
          if (mappedChild !== null) {
            mappedChildren.push(mappedChild);
          }

          if (traversal.truncated) {
            break;
          }
        }

        return mappedChildren.length > 0
          ? {
              ...rawNode,
              children: mappedChildren
            }
          : rawNode;
      };

      const mappedRoot = walk(tree);
      runtime.refDescriptorsByWindowId.set(driverWindow.id, refDescriptors);
      const viewportRect = await page
        .evaluate(() => ({
          x: 0,
          y: 0,
          width: globalThis.innerWidth,
          height: globalThis.innerHeight
        }))
        .catch(() => undefined);

      return {
        version: 1,
        createdAt: new Date().toISOString(),
        truncated: traversal.truncated,
        ...(traversal.truncationReason === undefined ? {} : { truncationReason: traversal.truncationReason }),
        nodes: mappedRoot === null ? [] : [mappedRoot],
        ...(viewportRect === undefined ? {} : { viewportRect })
      };
    } catch (error: unknown) {
      throw toDriverError(
        "INTERNAL_ERROR",
        `Failed to capture accessibility snapshot for window "${driverWindow.id}".`,
        true,
        {
          windowId: driverWindow.id,
          cause: asErrorMessage(error)
        }
      );
    }
  }

  public async performAction(window: DriverWindow, action: DriverAction): Promise<ActionResult> {
    const page = this.requireWindowPage(window.id);
    const timeout = readActionTimeout(action);

    try {
      if (action.action === "click") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        const clickButton = action.button ?? "left";
        const clickModifiers = Array.isArray(action.modifiers)
          ? action.modifiers.filter(
              (modifier): modifier is "Alt" | "Control" | "Meta" | "Shift" =>
                modifier === "Alt" || modifier === "Control" || modifier === "Meta" || modifier === "Shift"
            )
          : undefined;
        await locator.click({
          timeout,
          button: clickButton,
          ...(clickModifiers === undefined || clickModifiers.length === 0 ? {} : { modifiers: clickModifiers })
        });
        return {
          ok: true
        };
      }

      if (action.action === "fill") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        await locator.fill(action.text ?? "", { timeout });
        return {
          ok: true
        };
      }

      if (action.action === "type") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        await locator.type(action.text ?? "", { timeout });
        return {
          ok: true
        };
      }

      if (action.action === "hover") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        await locator.hover({ timeout });
        return {
          ok: true
        };
      }

      if (action.action === "press" || action.action === "press_key") {
        const shortcut = buildPressShortcut(action);
        await page.keyboard.press(shortcut);
        return {
          ok: true
        };
      }

      if (action.action === "select") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        if (typeof action.text !== "string") {
          throw toDriverError("INVALID_INPUT", "Select actions require `text` as the option value.", false, {
            windowId: window.id
          });
        }

        await locator.selectOption(action.text, { timeout });
        return {
          ok: true
        };
      }

      if (action.action === "wait_for_idle") {
        await page.waitForLoadState("networkidle", { timeout });
        await page.waitForFunction(
          () => {
            if (typeof document.getAnimations !== "function") {
              return true;
            }

            return document.getAnimations().every((animation) => animation.playState !== "running");
          },
          undefined,
          { timeout }
        );
        return {
          ok: true
        };
      }

      if (action.action === "wait_for_visible") {
        const locator = this.resolveTargetLocator(window.id, page, action.target);
        await locator.first().waitFor({
          state: "visible",
          timeout
        });
        return {
          ok: true
        };
      }

      if (action.action === "wait_for_text") {
        if (typeof action.text !== "string" || action.text.length === 0) {
          throw toDriverError("INVALID_INPUT", "wait_for_text actions require non-empty `text`.", false, {
            windowId: window.id
          });
        }

        await page.getByText(action.text).first().waitFor({
          state: "visible",
          timeout
        });
        return {
          ok: true
        };
      }

      throw toDriverError("INVALID_INPUT", `Unsupported action "${String(action.action)}".`, false, {
        windowId: window.id
      });
    } catch (error: unknown) {
      if (isObject(error) && typeof error.code === "string" && typeof error.message === "string") {
        throw error;
      }

      throw toDriverError("INTERNAL_ERROR", `Action "${action.action}" failed for window "${window.id}".`, true, {
        windowId: window.id,
        action,
        cause: asErrorMessage(error)
      });
    }
  }

  public async screenshot(window: DriverWindow, options?: ScreenshotOptions): Promise<Buffer> {
    const page = this.requireWindowPage(window.id);

    try {
      const screenshotOptions = {
        fullPage: options?.fullPage ?? false,
        ...withOptionalKey("path", options?.outputPath)
      };
      return await page.screenshot(screenshotOptions);
    } catch (error: unknown) {
      throw toDriverError("INTERNAL_ERROR", `Failed to capture screenshot for window "${window.id}".`, true, {
        windowId: window.id,
        outputPath: options?.outputPath,
        fullPage: options?.fullPage ?? false,
        cause: asErrorMessage(error)
      });
    }
  }

  public async getConsoleLogs(session: DriverSession, options?: ConsoleLogOptions): Promise<ConsoleEntry[]> {
    const runtime = this.requireRuntime(session);
    const threshold = options?.level ?? "trace";
    const limit = toNumberOption(options?.limit, DEFAULT_CONSOLE_LIMIT);

    const filtered = runtime.consoleEntries.filter((entry) => {
      return LEVEL_PRIORITY[entry.level] >= LEVEL_PRIORITY[threshold];
    });

    return filtered.slice(-limit);
  }

  public async close(session: DriverSession): Promise<void> {
    const runtime = this.runtimes.get(session.id);
    if (runtime === undefined) {
      return;
    }

    const closeAttempts = [
      async (): Promise<void> => {
        if (runtime.electronApp !== undefined) {
          await runtime.electronApp.close();
        }
      },
      async (): Promise<void> => {
        if (runtime.browser !== undefined) {
          await runtime.browser.close();
        }
      }
    ];

    const closeResults = await Promise.allSettled(closeAttempts.map((attempt) => attempt()));

    for (const callback of runtime.teardownCallbacks) {
      callback();
    }

    for (const windowId of runtime.windowsById.keys()) {
      this.windowToSessionIndex.delete(windowId);
    }

    this.runtimes.delete(runtime.sessionId);

    const rejected = closeResults.find((result) => result.status === "rejected");
    if (rejected !== undefined) {
      throw toDriverError("INTERNAL_ERROR", `Failed to close driver session "${session.id}" cleanly.`, true, {
        sessionId: session.id,
        cause: asErrorMessage(rejected.reason)
      });
    }
  }

  public async evaluate(window: DriverWindow, fn: string): Promise<unknown> {
    const page = this.requireWindowPage(window.id);

    try {
      return await page.evaluate((source: string) => {
        const evaluated = globalThis.eval(source);
        if (typeof evaluated === "function") {
          return evaluated();
        }

        return evaluated;
      }, fn);
    } catch (error: unknown) {
      throw toDriverError("INTERNAL_ERROR", `Failed to evaluate script in window "${window.id}".`, true, {
        windowId: window.id,
        cause: asErrorMessage(error)
      });
    }
  }

  private createRuntime(config: {
    sessionId: string;
    launchMode: DriverSession["launchMode"];
    electronApp?: ElectronApplication;
    browser?: CDPBrowser;
    processRef?: ChildProcess;
    recentStdout: LineRingBuffer;
    recentStderr: LineRingBuffer;
    teardownCallbacks: Array<() => void>;
  }): DriverRuntime {
    return {
      sessionId: config.sessionId,
      launchMode: config.launchMode,
      ...(config.electronApp === undefined ? {} : { electronApp: config.electronApp }),
      ...(config.browser === undefined ? {} : { browser: config.browser }),
      ...(config.processRef === undefined ? {} : { processRef: config.processRef }),
      windowsById: new Map<string, Page>(),
      pageIds: new WeakMap<Page, string>(),
      refDescriptorsByWindowId: new Map<string, Map<string, SnapshotRefDescriptor>>(),
      consoleEntries: [],
      teardownCallbacks: [...config.teardownCallbacks],
      windowSequence: {
        value: 0
      },
      recentStdout: config.recentStdout,
      recentStderr: config.recentStderr
    };
  }

  private registerRuntime(runtime: DriverRuntime): void {
    this.runtimes.set(runtime.sessionId, runtime);
  }

  private requireRuntime(session: DriverSession): DriverRuntime {
    const runtime = this.runtimes.get(session.id);
    if (runtime === undefined) {
      throw toDriverError("SESSION_NOT_FOUND", `No runtime found for driver session "${session.id}".`, false, {
        sessionId: session.id
      });
    }

    return runtime;
  }

  private requireRuntimeForWindow(windowId: string): DriverRuntime {
    const sessionId = this.windowToSessionIndex.get(windowId);
    if (sessionId === undefined) {
      throw toDriverError("WINDOW_NOT_FOUND", `Window "${windowId}" is not registered.`, false, {
        windowId
      });
    }

    const runtime = this.runtimes.get(sessionId);
    if (runtime === undefined) {
      throw toDriverError("SESSION_NOT_FOUND", `Runtime for window "${windowId}" is not available.`, false, {
        windowId,
        sessionId
      });
    }

    return runtime;
  }

  private requireWindowPage(windowId: string): Page {
    const runtime = this.requireRuntimeForWindow(windowId);
    const page = runtime.windowsById.get(windowId);
    if (page === undefined || page.isClosed()) {
      throw toDriverError("WINDOW_NOT_FOUND", `Window "${windowId}" is not available.`, false, {
        windowId,
        sessionId: runtime.sessionId
      });
    }

    return page;
  }

  private bindElectronConsole(runtime: DriverRuntime): void {
    if (runtime.electronApp === undefined) {
      return;
    }

    const context = runtime.electronApp.context();
    const bindPage = (page: Page): void => {
      this.attachConsoleListener(runtime, page);
      this.ensurePageId(runtime, page);
    };

    for (const page of context.pages()) {
      bindPage(page);
    }

    const onPage = (page: Page): void => {
      bindPage(page);
    };

    context.on("page", onPage);
    runtime.teardownCallbacks.push(() => {
      context.off("page", onPage);
    });
  }

  private bindBrowserConsole(runtime: DriverRuntime): void {
    if (runtime.browser === undefined) {
      return;
    }

    const contexts = runtime.browser.contexts();
    for (const context of contexts) {
      const bindPage = (page: Page): void => {
        this.attachConsoleListener(runtime, page);
        this.ensurePageId(runtime, page);
      };

      for (const page of context.pages()) {
        bindPage(page);
      }

      const onPage = (page: Page): void => {
        bindPage(page);
      };

      context.on("page", onPage);
      runtime.teardownCallbacks.push(() => {
        context.off("page", onPage);
      });
    }
  }

  private attachConsoleListener(runtime: DriverRuntime, page: Page): void {
    const pageId = this.ensurePageId(runtime, page);
    const onConsole = (message: { type: () => string; text: () => string }): void => {
      const entry: ConsoleEntry = {
        level: mapConsoleLevel(message.type()),
        message: `[${pageId}] ${message.text()}`,
        timestamp: new Date().toISOString()
      };

      runtime.consoleEntries.push(entry);
      if (runtime.consoleEntries.length > CONSOLE_BUFFER_LIMIT) {
        runtime.consoleEntries.splice(0, runtime.consoleEntries.length - CONSOLE_BUFFER_LIMIT);
      }
    };

    page.on("console", onConsole);
    runtime.teardownCallbacks.push(() => {
      page.off("console", onConsole);
    });
  }

  private ensurePageId(runtime: DriverRuntime, page: Page): string {
    const existing = runtime.pageIds.get(page);
    if (existing !== undefined) {
      runtime.windowsById.set(existing, page);
      this.windowToSessionIndex.set(existing, runtime.sessionId);
      return existing;
    }

    runtime.windowSequence.value += 1;
    const windowId = `${runtime.sessionId}:window-${runtime.windowSequence.value}`;
    runtime.pageIds.set(page, windowId);
    runtime.windowsById.set(windowId, page);
    this.windowToSessionIndex.set(windowId, runtime.sessionId);
    return windowId;
  }

  private collectPages(runtime: DriverRuntime): readonly Page[] {
    if (runtime.electronApp !== undefined) {
      return runtime.electronApp.context().pages();
    }

    if (runtime.browser !== undefined) {
      return runtime.browser.contexts().flatMap((context) => context.pages());
    }

    return [];
  }

  private async refreshWindows(runtime: DriverRuntime): Promise<DriverWindow[]> {
    const pages = this.collectPages(runtime);
    const windowEntries = await Promise.all(
      pages.map(async (page) => {
        const id = this.ensurePageId(runtime, page);
        const url = page.url();
        return {
          id,
          title: await safeTitle(page),
          url,
          kind: classifyWindowKind(url),
          focused: await safeFocused(page),
          visible: !page.isClosed()
        } satisfies DriverWindow;
      })
    );

    const activeIds = new Set(windowEntries.map((entry) => entry.id));
    for (const windowId of runtime.windowsById.keys()) {
      if (activeIds.has(windowId)) {
        continue;
      }

      runtime.windowsById.delete(windowId);
      runtime.refDescriptorsByWindowId.delete(windowId);
      this.windowToSessionIndex.delete(windowId);
    }

    return windowEntries;
  }

  private resolveTargetLocator(windowId: string, page: Page, target?: ActionTarget): Locator {
    if (target !== undefined && "selector" in target) {
      const selector = target.selector.trim();
      const parsedRoleSelector = parseRoleSelector(selector);
      if (parsedRoleSelector !== null) {
        return parsedRoleSelector.name === undefined
          ? page.getByRole(parsedRoleSelector.role as never)
          : page.getByRole(parsedRoleSelector.role as never, { name: parsedRoleSelector.name });
      }

      const parsedTestId = parseCallArgumentString(selector, "page.getByTestId");
      if (parsedTestId !== null) {
        return page.getByTestId(parsedTestId);
      }

      const parsedLocatorArg = parseCallArgumentString(selector, "page.locator");
      if (parsedLocatorArg !== null) {
        return page.locator(parsedLocatorArg);
      }

      return page.locator(selector);
    }

    if (target !== undefined && "css" in target) {
      return page.locator(target.css);
    }

    if (target !== undefined && "testId" in target) {
      return page.getByTestId(target.testId);
    }

    if (target !== undefined && "role" in target && "name" in target) {
      return page.getByRole(target.role as never, { name: target.name });
    }

    if (target === undefined || !("ref" in target)) {
      throw toDriverError(
        "INVALID_INPUT",
        "Action target requires `ref`, `selector`, `role+name`, `testId`, or `css`.",
        false,
        {
          windowId
        }
      );
    }

    const runtime = this.requireRuntimeForWindow(windowId);
    const windowRefs = runtime.refDescriptorsByWindowId.get(windowId);
    const descriptor = windowRefs?.get(target.ref);

    if (descriptor === undefined) {
      throw toDriverError(
        "STALE_SNAPSHOT",
        `Reference "${target.ref}" is stale or unknown for window "${windowId}".`,
        false,
        {
          windowId,
          ref: target.ref
        }
      );
    }

    if (VALID_ROLES.has(descriptor.role)) {
      if (descriptor.name.length > 0) {
        return page.getByRole(descriptor.role as never, { name: descriptor.name }).nth(descriptor.nth);
      }

      return page.getByRole(descriptor.role as never).nth(descriptor.nth);
    }

    if (descriptor.name.length > 0) {
      return page.getByText(descriptor.name).nth(descriptor.nth);
    }

    throw toDriverError(
      "STALE_SNAPSHOT",
      `Reference "${target.ref}" did not resolve to an actionable locator.`,
      false,
      {
        windowId,
        ref: target.ref
      }
    );
  }
}

export const createPlaywrightElectronDriver = (): ElectronDriver => {
  return new PlaywrightElectronDriver();
};
