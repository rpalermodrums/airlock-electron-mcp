import { describe, expect, it, vi } from "vitest";

import type { DriverWindow, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { windowFocusTool } from "./window-focus.js";

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

const createContext = (driver: ElectronDriver, sessions: SessionManager): AirlockToolContext => {
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
    driver,
    sessions,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["window_focus"]
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
          title: "Settings",
          url: "https://example.test/settings",
          kind: "modal",
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

describe("windowFocusTool", () => {
  it("validates required input", () => {
    expect(windowFocusTool.inputSchema.safeParse({ sessionId: "s1" }).success).toBe(false);
    expect(windowFocusTool.inputSchema.safeParse({ sessionId: "s1", windowId: "w1" }).success).toBe(true);
  });

  it("focuses the requested window and updates selectedWindowId", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);
    const refreshedWindows: DriverWindow[] = [
      {
        id: "w1",
        title: "Main",
        url: "https://example.test/main",
        kind: "primary",
        focused: false,
        visible: true
      },
      {
        id: "w2",
        title: "Settings",
        url: "https://example.test/settings",
        kind: "modal",
        focused: true,
        visible: true
      }
    ];

    vi.mocked(driver.focusWindow).mockResolvedValue(undefined);
    vi.mocked(driver.getWindows).mockResolvedValue(refreshedWindows);

    const result = await windowFocusTool.handler({ sessionId: "s1", windowId: "w2" }, context);

    expect(driver.focusWindow).toHaveBeenCalledWith(
      {
        id: "driver-session-1",
        launchMode: "preset"
      },
      "w2"
    );
    expect(result.data).toEqual({
      ok: true,
      message: 'Focused window "w2".'
    });
    expect(sessions.get("s1")?.session.selectedWindowId).toBe("w2");
  });

  it("throws WINDOW_NOT_FOUND for unknown windows", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);

    await expect(windowFocusTool.handler({ sessionId: "s1", windowId: "missing" }, context)).rejects.toMatchObject({
      code: "WINDOW_NOT_FOUND"
    });
  });
});
