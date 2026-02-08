import { describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { windowDefaultGetTool, windowDefaultSetTool } from "./window-default.js";

const createDriver = (): ElectronDriver => {
  return {
    launch: vi.fn(),
    attach: vi.fn(),
    getWindows: vi.fn(),
    getSnapshot: vi.fn(),
    performAction: vi.fn(),
    screenshot: vi.fn(),
    focusWindow: vi.fn(),
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

const createContext = (sessions: SessionManager): AirlockToolContext => {
  return {
    mode: "standard",
    policy: {
      mode: "standard",
      allowedOrigins: ["http://localhost"],
      artifactRoot: "/tmp/airlock-tests",
      maxSessionTtlMs: 30_000
    },
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
    sessions,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["window_default_get", "window_default_set"]
  };
};

const addManagedSession = (sessions: SessionManager): void => {
  sessions.add({
    session: {
      sessionId: sessionId("s1"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: "/tmp/airlock/s1",
      selectedWindowId: windowId("w1"),
      windows: [
        {
          windowId: windowId("w1"),
          title: "Main",
          url: "https://example.test/main",
          kind: "primary",
          focused: true,
          visible: true,
          lastSeenAt: "2026-01-01T00:00:00.000Z"
        },
        {
          windowId: windowId("w2"),
          title: "Workspace",
          url: "https://example.test/workspace",
          kind: "utility",
          focused: false,
          visible: true,
          lastSeenAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    },
    driverSession: {
      id: "driver-session-1",
      launchMode: "preset"
    }
  });
};

describe("window default tools", () => {
  it("window_default_get reports null when no default is configured", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);

    const result = await windowDefaultGetTool.handler({ sessionId: "s1" }, context);

    expect(result.data.defaultWindowId).toBeNull();
    expect(result.data.currentWindows.map((window) => window.windowId)).toEqual(["w1", "w2"]);
    expect(result.meta?.suggestions).toEqual([
      "Use window_default_set() to pin a deterministic default window for implicit tool targeting."
    ]);
  });

  it("window_default_set stores default and returns previous default when replaced", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);

    const firstSet = await windowDefaultSetTool.handler({ sessionId: "s1", windowId: "w2" }, context);
    expect(firstSet.data).toMatchObject({
      ok: true,
      message: 'Default window set to "w2" (Workspace).'
    });
    expect("previousDefault" in firstSet.data).toBe(false);
    expect(firstSet.meta?.suggestions).toEqual([
      "Run actions without windowId to target this default window implicitly."
    ]);

    const secondSet = await windowDefaultSetTool.handler({ sessionId: "s1", windowId: "w1" }, context);
    expect(secondSet.data).toMatchObject({
      ok: true,
      previousDefault: "w2"
    });

    const getResult = await windowDefaultGetTool.handler({ sessionId: "s1" }, context);
    expect(getResult.data.defaultWindowId).toBe("w1");
  });

  it("window_default_set throws WINDOW_NOT_FOUND for unknown windows", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);

    await expect(
      windowDefaultSetTool.handler({ sessionId: "s1", windowId: "missing-window" }, context)
    ).rejects.toMatchObject({
      code: "WINDOW_NOT_FOUND"
    });
  });

  it("window_default_get clears stale default if target window disappeared", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);

    await windowDefaultSetTool.handler({ sessionId: "s1", windowId: "w2" }, context);

    const managedSession = sessions.get("s1");
    if (managedSession === undefined) {
      throw new Error("Expected managed session");
    }

    managedSession.session.windows = managedSession.session.windows.filter((window) => window.windowId !== "w2");

    const result = await windowDefaultGetTool.handler({ sessionId: "s1" }, context);

    expect(result.data.defaultWindowId).toBeNull();
  });

  it("window_default_set updates session activity timestamps", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);
    const beforeUpdatedAt = sessions.get("s1")?.session.updatedAt;

    await windowDefaultSetTool.handler({ sessionId: "s1", windowId: "w1" }, context);

    const managed = sessions.get("s1");
    expect(managed?.session.updatedAt).not.toBe(beforeUpdatedAt);
    expect(managed?.session.lastActivityAt).toBe(managed?.session.updatedAt);
  });

  it("window default tools throw SESSION_NOT_FOUND when session is missing", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(sessions);

    await expect(windowDefaultGetTool.handler({ sessionId: "missing" }, context)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND"
    });
    await expect(windowDefaultSetTool.handler({ sessionId: "missing", windowId: "w1" }, context)).rejects.toMatchObject(
      {
        code: "SESSION_NOT_FOUND"
      }
    );
  });
});
