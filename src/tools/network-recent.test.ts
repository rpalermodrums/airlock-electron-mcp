import { describe, expect, it, vi } from "vitest";

import type { ElectronDriver, NetworkEntry } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { networkRecentTool } from "./network-recent.js";

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
    getEnabledTools: () => ["network_recent"]
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

describe("networkRecentTool", () => {
  it("validates input shape and limit bounds", () => {
    expect(networkRecentTool.inputSchema.safeParse({ sessionId: "s1", limit: 0 }).success).toBe(false);
    expect(networkRecentTool.inputSchema.safeParse({ sessionId: "s1", limit: 10 }).success).toBe(true);
  });

  it("returns recent entries for the resolved target window", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions);
    const entries: NetworkEntry[] = [
      {
        url: "https://api.example.test/a",
        method: "GET",
        status: 200,
        mimeType: "application/json",
        timestamp: "2026-01-01T00:00:00.000Z"
      },
      {
        url: "https://api.example.test/b",
        method: "POST",
        status: 201,
        mimeType: "application/json",
        timestamp: "2026-01-01T00:00:01.000Z"
      }
    ];

    vi.mocked(driver.getNetworkLogs).mockResolvedValue(entries);

    const result = await networkRecentTool.handler(
      {
        sessionId: "s1",
        limit: 25
      },
      context
    );

    expect(driver.getNetworkLogs).toHaveBeenCalledWith(
      {
        id: "driver-session-1",
        launchMode: "preset"
      },
      {
        windowId: "w1",
        limit: 25
      }
    );
    expect(result.data.entries.map((entry) => entry.url)).toEqual([
      "https://api.example.test/b",
      "https://api.example.test/a"
    ]);
  });

  it("throws SESSION_NOT_FOUND for unknown sessions", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions);

    await expect(networkRecentTool.handler({ sessionId: "missing", limit: 5 }, context)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND"
    });
  });
});
