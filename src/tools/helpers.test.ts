import { describe, it, expect, vi } from "vitest";

import type { DriverSession, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager, type ManagedSession } from "../session-manager.js";
import type { SafetyPolicy, Window } from "../types/index.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { isLikelyModal, resolveManagedSession, resolveWindow, toActionToolResult } from "./helpers.js";

const createDriver = (): ElectronDriver => {
  return {
    launch: vi.fn(),
    attach: vi.fn(),
    getWindows: vi.fn(),
    getSnapshot: vi.fn(),
    performAction: vi.fn(),
    screenshot: vi.fn(),
    getConsoleLogs: vi.fn(),
    getNetworkLogs: vi.fn(),
    close: vi.fn()
  } as unknown as ElectronDriver;
};

const createLogger = (): Logger => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger;
};

const createPolicy = (): SafetyPolicy => {
  return {
    mode: "standard",
    allowedOrigins: ["http://localhost"],
    artifactRoot: "/tmp/airlock-tests",
    maxSessionTtlMs: 30_000
  };
};

const createWindow = (
  id: string,
  title: string,
  options: {
    url?: string;
    kind?: Window["kind"];
    focused?: boolean;
    visible?: boolean;
    lastSeenAt?: string;
  } = {}
): Window => {
  return {
    windowId: windowId(id),
    title,
    url: options.url ?? `https://example.com/${id}`,
    kind: options.kind ?? "primary",
    focused: options.focused ?? id === "w1",
    visible: options.visible ?? true,
    lastSeenAt: options.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  };
};

const createManagedSession = (
  options: {
    selectedWindowId?: string;
    windows?: readonly Window[];
    includeDriverSession?: boolean;
    defaultWindowId?: string;
    lastInteractedWindowId?: string;
    lastFocusedPrimaryWindowId?: string;
  } = {}
): ManagedSession => {
  const windows = options.windows ?? [createWindow("w1", "Main"), createWindow("w2", "Workspace")];
  const driverSession: DriverSession | undefined =
    options.includeDriverSession === false
      ? undefined
      : {
          id: "driver-session-1",
          launchMode: "preset"
        };

  return {
    session: {
      sessionId: sessionId("s1"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: "/tmp/airlock/s1",
      selectedWindowId: options.selectedWindowId === undefined ? undefined : windowId(options.selectedWindowId),
      windows: [...windows]
    },
    ...(options.defaultWindowId === undefined ? {} : { defaultWindowId: windowId(options.defaultWindowId) }),
    ...(options.lastInteractedWindowId === undefined
      ? {}
      : { lastInteractedWindowId: windowId(options.lastInteractedWindowId) }),
    ...(options.lastFocusedPrimaryWindowId === undefined
      ? {}
      : { lastFocusedPrimaryWindowId: windowId(options.lastFocusedPrimaryWindowId) }),
    ...(driverSession === undefined ? {} : { driverSession })
  };
};

const createContext = (sessionManager: SessionManager): AirlockToolContext => {
  return {
    mode: "standard",
    policy: createPolicy(),
    supportedPresets: ["electron-vite"],
    limits: {
      maxNodes: 250,
      maxTextCharsPerNode: 80
    },
    metadata: {
      name: "airlock-electron",
      version: "0.1.0"
    },
    startedAtMs: 0,
    driver: createDriver(),
    sessions: sessionManager,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["snapshot_interactive", "click"]
  };
};

const captureSyncError = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw.");
};

describe("tool helpers", () => {
  it("resolveManagedSession() returns session for valid ID", () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const managedSession = createManagedSession();
    sessions.add(managedSession);
    const context = createContext(sessions);

    const resolved = resolveManagedSession(context, "s1");

    expect(resolved).toMatchObject(managedSession);
    expect(resolved.driverSession.id).toBe("driver-session-1");
  });

  it("resolveManagedSession() throws SESSION_NOT_FOUND for invalid ID", () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(sessions);

    const error = captureSyncError(() => {
      resolveManagedSession(context, "missing-session");
    }) as { code: string };

    expect(error.code).toBe("SESSION_NOT_FOUND");
  });

  it("resolveWindow() returns default heuristic window when no windowId specified", () => {
    const managedSession = createManagedSession({
      windows: [createWindow("w1", "Main"), createWindow("w2", "Workspace")]
    });

    const resolvedWindow = resolveWindow(managedSession, undefined, { trackAsInteracted: false });

    expect(resolvedWindow.windowId).toBe(windowId("w1"));
    expect(resolvedWindow.title).toBe("Main");
  });

  it("resolveWindow() returns specific window when windowId provided", () => {
    const managedSession = createManagedSession({
      windows: [createWindow("w1", "Main"), createWindow("w2", "Workspace")],
      defaultWindowId: "w1"
    });

    const resolvedWindow = resolveWindow(managedSession, "w2", { trackAsInteracted: false });

    expect(resolvedWindow.windowId).toBe(windowId("w2"));
    expect(resolvedWindow.title).toBe("Workspace");
  });

  it("resolveWindow() prioritizes configured default over modal candidates", () => {
    const managedSession = createManagedSession({
      windows: [
        createWindow("w1", "Main", { kind: "primary", focused: true }),
        createWindow("w2", "Confirm Delete", { kind: "utility", focused: false })
      ],
      defaultWindowId: "w1"
    });

    const diagnostics: Record<string, unknown> = {};
    const resolvedWindow = resolveWindow(managedSession, undefined, {
      diagnostics,
      trackAsInteracted: false
    });

    expect(resolvedWindow.windowId).toBe(windowId("w1"));
    expect(diagnostics).toMatchObject({
      windowSelection: {
        strategy: "default_window",
        selectedWindowId: "w1"
      }
    });
  });

  it("resolveWindow() prioritizes likely modal over last interacted window", () => {
    const managedSession = createManagedSession({
      windows: [
        createWindow("w1", "Main", { kind: "primary", focused: true }),
        createWindow("w2", "Alert: Save changes", { kind: "utility", focused: false }),
        createWindow("w3", "Workspace", { kind: "utility", focused: false })
      ],
      lastInteractedWindowId: "w3"
    });

    const resolvedWindow = resolveWindow(managedSession, undefined, { trackAsInteracted: false });

    expect(resolvedWindow.windowId).toBe(windowId("w2"));
  });

  it("resolveWindow() prioritizes last interacted over focused primary", () => {
    const managedSession = createManagedSession({
      windows: [
        createWindow("w1", "Main", { kind: "primary", focused: true }),
        createWindow("w2", "Workspace", { kind: "utility", focused: false })
      ],
      lastInteractedWindowId: "w2"
    });

    const diagnostics: Record<string, unknown> = {};
    const resolvedWindow = resolveWindow(managedSession, undefined, {
      diagnostics,
      trackAsInteracted: false
    });

    expect(resolvedWindow.windowId).toBe(windowId("w2"));
    expect(diagnostics).toMatchObject({
      windowSelection: {
        strategy: "most_recently_interacted_window",
        selectedWindowId: "w2"
      }
    });
  });

  it("resolveWindow() falls back to first non-devtools window", () => {
    const managedSession = createManagedSession({
      windows: [
        createWindow("devtools", "DevTools", { kind: "devtools", focused: false }),
        createWindow("w2", "Secondary", { kind: "utility", focused: false })
      ]
    });

    const diagnostics: Record<string, unknown> = {};
    const resolvedWindow = resolveWindow(managedSession, undefined, {
      diagnostics,
      trackAsInteracted: false
    });

    expect(resolvedWindow.windowId).toBe(windowId("w2"));
    expect(diagnostics).toMatchObject({
      windowSelection: {
        strategy: "first_non_devtools_window",
        selectedWindowId: "w2"
      }
    });
  });

  it("resolveWindow() throws WINDOW_NOT_FOUND for invalid windowId", () => {
    const managedSession = createManagedSession({
      windows: [createWindow("w1", "Main")]
    });

    const error = captureSyncError(() => {
      resolveWindow(managedSession, "w404");
    }) as { code: string };

    expect(error.code).toBe("WINDOW_NOT_FOUND");
  });

  it("isLikelyModal() detects modal title/url patterns", () => {
    const windows: [Window, Window, Window] = [
      createWindow("w1", "Main", { kind: "primary", focused: true }),
      createWindow("w2", "Preferences", { kind: "utility", focused: false }),
      createWindow("w3", "Popup", { kind: "utility", focused: false, url: "about:blank" })
    ];
    const [, preferencesWindow, popupWindow] = windows;

    expect(isLikelyModal(preferencesWindow, windows)).toBe(true);
    expect(isLikelyModal(popupWindow, windows)).toBe(true);
  });

  it("isLikelyModal() detects dialog/alert type hints when present", () => {
    const typedDialogWindow = {
      ...createWindow("w2", "Untitled", { kind: "utility", focused: false }),
      type: "dialog"
    } as Window;

    expect(isLikelyModal(typedDialogWindow, [createWindow("w1", "Main"), typedDialogWindow])).toBe(true);
  });

  it("isLikelyModal() can use size heuristic when bounds are present", () => {
    const mainWindow = {
      ...createWindow("w1", "Main", { kind: "primary", focused: true }),
      bounds: {
        width: 1400,
        height: 1000
      }
    } as Window;
    const smallWindow = {
      ...createWindow("w2", "Inspector", { kind: "utility", focused: false }),
      bounds: {
        width: 600,
        height: 420
      }
    } as Window;

    expect(isLikelyModal(smallWindow, [mainWindow, smallWindow])).toBe(true);
  });

  it("toActionToolResult() wraps ActionResult in ToolResult with suggestions", () => {
    const actionResult = {
      ok: true,
      message: "Clicked successfully."
    };

    const result = toActionToolResult(actionResult, "Run snapshot_interactive() next.");

    expect(result).toEqual({
      data: actionResult,
      meta: {
        suggestions: ["Run snapshot_interactive() next."]
      }
    });
  });
});
