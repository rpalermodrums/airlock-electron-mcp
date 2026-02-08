import { afterEach, describe, expect, it, vi } from "vitest";

import type { DriverWindow, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { waitForWindowTool } from "./wait-for-window.js";

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
    getEnabledTools: () => ["wait_for_window"]
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
        }
      ]
    },
    driverSession: {
      id: "driver-session-1",
      launchMode: "preset"
    }
  });
};

const MAIN_WINDOW: DriverWindow = {
  id: "w1",
  title: "Main",
  url: "https://example.test/main",
  kind: "primary",
  focused: true,
  visible: true
};

const MODAL_WINDOW: DriverWindow = {
  id: "w2",
  title: "Confirm Delete",
  url: "https://example.test/confirm",
  kind: "modal",
  focused: true,
  visible: true
};

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForWindowTool", () => {
  it("requires at least one matcher", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);

    await expect(waitForWindowTool.handler({ sessionId: "s1", timeoutMs: 1000 }, context)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("polls until a matching window appears", async () => {
    vi.useFakeTimers();

    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows)
      .mockResolvedValueOnce([MAIN_WINDOW])
      .mockResolvedValueOnce([MAIN_WINDOW, MODAL_WINDOW]);

    const resultPromise = waitForWindowTool.handler(
      {
        sessionId: "s1",
        titleContains: "confirm",
        timeoutMs: 2_000
      },
      context
    );

    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    expect(driver.getWindows).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({
      windowId: "w2",
      title: "Confirm Delete",
      url: "https://example.test/confirm"
    });
    expect(result.meta?.diagnostics).toEqual({
      pollIntervalMs: 500,
      matchedWindowId: "w2"
    });
    expect(sessions.get("s1")?.session.selectedWindowId).toBe("w2");
  });

  it("supports createdAfter matching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows)
      .mockResolvedValueOnce([MAIN_WINDOW])
      .mockResolvedValueOnce([MAIN_WINDOW, MODAL_WINDOW]);

    const createdAfter = Date.now();
    const resultPromise = waitForWindowTool.handler(
      {
        sessionId: "s1",
        createdAfter,
        timeoutMs: 2_000
      },
      context
    );

    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    expect(result.data.windowId).toBe("w2");
  });

  it("throws WINDOW_NOT_FOUND on timeout with diagnostics", async () => {
    vi.useFakeTimers();

    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([MAIN_WINDOW]);

    const resultPromise = waitForWindowTool.handler(
      {
        sessionId: "s1",
        urlContains: "never-appears",
        timeoutMs: 1_100
      },
      context
    );

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).rejects.toMatchObject({
      code: "WINDOW_NOT_FOUND",
      details: {
        sessionId: "s1",
        timeoutMs: 1_100,
        currentWindows: [
          {
            windowId: "w1",
            title: "Main",
            url: "https://example.test/main"
          }
        ]
      }
    });
  });

  it("prunes stale tracked window IDs and refreshes interaction/focus tracking", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);
    const managed = sessions.get("s1");
    if (managed === undefined) {
      throw new Error("Expected managed session");
    }

    managed.defaultWindowId = windowId("stale-default");
    managed.lastInteractedWindowId = windowId("stale-interacted");
    managed.lastFocusedPrimaryWindowId = windowId("stale-primary");
    managed.session.selectedWindowId = windowId("stale-selected");

    vi.mocked(driver.getWindows).mockResolvedValue([MAIN_WINDOW]);

    const result = await waitForWindowTool.handler(
      {
        sessionId: "s1",
        titleContains: "main",
        timeoutMs: 1_000
      },
      context
    );

    expect(result.data.windowId).toBe("w1");
    expect(managed.defaultWindowId).toBeUndefined();
    expect(managed.lastInteractedWindowId).toBe("w1");
    expect(managed.lastFocusedPrimaryWindowId).toBe("w1");
    expect(managed.session.selectedWindowId).toBe("w1");
  });
});
