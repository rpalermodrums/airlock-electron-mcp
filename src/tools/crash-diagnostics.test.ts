import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DriverWindow, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { diagnoseSessionTool } from "./crash-diagnostics.js";

const createDriver = (): ElectronDriver => {
  return {
    launch: vi.fn(),
    attach: vi.fn(),
    getWindows: vi.fn(),
    startTracing: vi.fn(),
    stopTracing: vi.fn(),
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
    getEnabledTools: () => ["diagnose_session"]
  };
};

const createWindow = (id: string): DriverWindow => {
  return {
    id,
    title: "Main",
    url: "https://example.test",
    kind: "primary",
    focused: true,
    visible: true
  };
};

const addManagedSession = (
  sessions: SessionManager,
  options: {
    processId?: number;
    windowCount: number;
  }
): void => {
  const windows = new Array(options.windowCount).fill(null).map((_value, index) => {
    return {
      windowId: windowId(`w${index + 1}`),
      title: `Window ${index + 1}`,
      url: `https://example.test/${index + 1}`,
      kind: "primary" as const,
      focused: index === 0,
      visible: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z"
    };
  });

  sessions.add({
    session: {
      sessionId: sessionId("s1"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: new Date().toISOString(),
      artifactDir: "/tmp/airlock-tests/artifacts/s1",
      selectedWindowId: windowId("w1"),
      windows
    },
    driverSession: {
      id: "driver-s1",
      launchMode: "preset",
      ...(options.processId === undefined
        ? {}
        : {
            metadata: {
              processId: options.processId
            }
          })
    }
  });
};

describe("diagnoseSessionTool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports healthy for responsive sessions", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      processId: process.pid,
      windowCount: 1
    });
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([createWindow("w1")]);
    vi.mocked(driver.getSnapshot).mockResolvedValue({
      version: 1,
      createdAt: new Date().toISOString(),
      truncated: false,
      nodes: []
    });
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([]);

    context.eventLog.record({
      toolName: "click",
      sessionId: "s1",
      params: { target: { ref: "e1" } },
      resultSummary: {
        status: "ok",
        message: "ok"
      },
      durationMs: 8,
      timestamp: new Date().toISOString()
    });

    const result = await diagnoseSessionTool.handler({ sessionId: "s1" }, context);

    expect(result.data.healthy).toBe(true);
    expect(result.data.issues).toEqual([]);
    expect(result.data.recommendations).toContain("Session appears healthy based on current diagnostics.");
  });

  it("reports unhealthy signals for dead process, snapshot failure, console errors, and stale actions", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      processId: 999_999,
      windowCount: 2
    });
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([createWindow("w1")]);
    vi.mocked(driver.getSnapshot).mockRejectedValue(new Error("renderer hung"));
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([
      {
        level: "error",
        message: "Unhandled rejection",
        timestamp: new Date().toISOString()
      }
    ]);

    context.eventLog.record({
      toolName: "click",
      sessionId: "s1",
      params: { target: { ref: "e1" } },
      resultSummary: {
        status: "ok",
        message: "ok"
      },
      durationMs: 8,
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    });

    const result = await diagnoseSessionTool.handler({ sessionId: "s1" }, context);

    expect(result.data.healthy).toBe(false);
    expect(result.data.issues.some((issue) => issue.includes("is not alive"))).toBe(true);
    expect(result.data.issues.some((issue) => issue.includes("Window count drift detected"))).toBe(true);
    expect(result.data.issues.some((issue) => issue.includes("Snapshot responsiveness check failed"))).toBe(true);
    expect(result.data.issues.some((issue) => issue.includes("console error"))).toBe(true);
    expect(result.data.issues.some((issue) => issue.includes("No successful action"))).toBe(true);
    expect(result.data.recommendations.length).toBeGreaterThan(0);
  });

  it("surfaces missing process metadata, no windows, and console diagnostic failure", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      windowCount: 1
    });
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([]);
    vi.mocked(driver.getConsoleLogs).mockRejectedValue(new Error("console pipe unavailable"));

    const result = await diagnoseSessionTool.handler({ sessionId: "s1" }, context);

    expect(result.data.healthy).toBe(false);
    expect(result.data.issues).toEqual(
      expect.arrayContaining([
        "Electron process ID is unavailable for this session.",
        "No renderer windows are currently discoverable.",
        "No window is available for snapshot responsiveness checks.",
        "Console diagnostics unavailable: console pipe unavailable"
      ])
    );
    expect(result.data.lastActivity.lastSuccessfulActionAt).toBeUndefined();
    expect(result.data.lastActivity.secondsSinceLastSuccessfulAction).toBeUndefined();
  });

  it("flags snapshot timeout as unresponsive renderer signal", async () => {
    vi.useFakeTimers();

    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      processId: process.pid,
      windowCount: 1
    });
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([createWindow("w1")]);
    vi.mocked(driver.getSnapshot).mockImplementation(() => {
      return new Promise(() => undefined);
    });
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([]);

    const resultPromise = diagnoseSessionTool.handler({ sessionId: "s1" }, context);
    await vi.advanceTimersByTimeAsync(3_100);
    const result = await resultPromise;

    expect(result.data.healthy).toBe(false);
    expect(result.data.issues.some((issue) => issue.includes("timed out after 3000ms"))).toBe(true);
  });
});
