import { describe, it, expect, vi } from "vitest";

import type { DriverSession, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager, type ManagedSession } from "../session-manager.js";
import type { SafetyPolicy, Window } from "../types/index.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { resolveManagedSession, resolveWindow, toActionToolResult } from "./helpers.js";

const createDriver = (): ElectronDriver => {
  return {
    launch: vi.fn(),
    attach: vi.fn(),
    getWindows: vi.fn(),
    getSnapshot: vi.fn(),
    performAction: vi.fn(),
    screenshot: vi.fn(),
    getConsoleLogs: vi.fn(),
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

const createWindow = (id: string, title: string): Window => {
  return {
    windowId: windowId(id),
    title,
    url: `https://example.com/${id}`,
    kind: "primary",
    focused: id === "w1",
    visible: true,
    lastSeenAt: "2026-01-01T00:00:00.000Z"
  };
};

const createManagedSession = (
  options: {
    selectedWindowId?: string;
    windows?: readonly Window[];
    includeDriverSession?: boolean;
  } = {}
): ManagedSession => {
  const windows = options.windows ?? [createWindow("w1", "Main"), createWindow("w2", "Settings")];
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

  it("resolveWindow() returns default window when no windowId specified", () => {
    const managedSession = createManagedSession({
      windows: [createWindow("w1", "Main"), createWindow("w2", "Settings")]
    });

    const resolvedWindow = resolveWindow(managedSession);

    expect(resolvedWindow.windowId).toBe(windowId("w1"));
    expect(resolvedWindow.title).toBe("Main");
  });

  it("resolveWindow() returns specific window when windowId provided", () => {
    const managedSession = createManagedSession({
      windows: [createWindow("w1", "Main"), createWindow("w2", "Settings")]
    });

    const resolvedWindow = resolveWindow(managedSession, "w2");

    expect(resolvedWindow.windowId).toBe(windowId("w2"));
    expect(resolvedWindow.title).toBe("Settings");
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
