import { describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { sessionInfoTool } from "./session-info.js";

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

const createContext = (sessionManager: SessionManager): AirlockToolContext => {
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
    sessions: sessionManager,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["session_info"]
  };
};

describe("sessionInfoTool", () => {
  it("validates required input", () => {
    expect(sessionInfoTool.inputSchema.safeParse({}).success).toBe(false);
    expect(sessionInfoTool.inputSchema.safeParse({ sessionId: "s1" }).success).toBe(true);
  });

  it("returns detailed session metadata and artifact paths", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    sessions.add({
      session: {
        sessionId: sessionId("s1"),
        state: "running",
        mode: "standard",
        launchMode: "preset",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        lastActivityAt: "2026-01-01T00:00:02.000Z",
        artifactDir: "/tmp/airlock-tests/artifacts/s1",
        selectedWindowId: windowId("w1"),
        windows: [
          {
            windowId: windowId("w1"),
            title: "Main",
            url: "https://example.test",
            kind: "primary",
            focused: true,
            visible: true,
            lastSeenAt: "2026-01-01T00:00:02.000Z"
          }
        ]
      }
    });
    const context = createContext(sessions);

    const result = await sessionInfoTool.handler({ sessionId: "s1" }, context);

    expect(result.data.session.sessionId).toBe("s1");
    expect(result.data.details.launchMode).toBe("preset");
    expect(result.data.details.mode).toBe("standard");
    expect(result.data.details.windowCount).toBe(1);
    expect(result.data.details.artifactPaths).toEqual({
      rootDir: "/tmp/airlock-tests",
      sessionDir: "/tmp/airlock-tests/artifacts/s1",
      screenshotsDir: "/tmp/airlock-tests/artifacts/s1/screenshots",
      logsDir: "/tmp/airlock-tests/logs",
      tracesDir: "/tmp/airlock-tests/traces"
    });
  });

  it("throws SESSION_NOT_FOUND for unknown sessions", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(sessions);

    await expect(sessionInfoTool.handler({ sessionId: "missing" }, context)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND"
    });
  });
});
