import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { hoverTool } from "./hover.js";

const { executeActionMock } = vi.hoisted(() => {
  return {
    executeActionMock: vi.fn()
  };
});

vi.mock("../actions/index.js", () => {
  return {
    executeAction: executeActionMock
  };
});

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
    getEnabledTools: () => ["hover"]
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

describe("hoverTool", () => {
  beforeEach(() => {
    executeActionMock.mockReset();
  });

  it("validates required target input", () => {
    expect(hoverTool.inputSchema.safeParse({ sessionId: "s1" }).success).toBe(false);
    expect(
      hoverTool.inputSchema.safeParse({
        sessionId: "s1",
        target: {
          ref: "e1"
        }
      }).success
    ).toBe(true);
  });

  it("executes a hover action through the action pipeline", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(sessions);
    executeActionMock.mockResolvedValue({
      ok: true
    });

    const result = await hoverTool.handler(
      {
        sessionId: "s1",
        target: {
          ref: "e3"
        }
      },
      context
    );

    expect(executeActionMock).toHaveBeenCalledWith(
      context.driver,
      expect.objectContaining({
        session: expect.objectContaining({ sessionId: "s1" })
      }),
      "w1",
      {
        action: "hover",
        target: {
          ref: "e3"
        }
      }
    );
    expect(result.data.ok).toBe(true);
  });

  it("throws SESSION_NOT_FOUND when hovering on a missing session", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(sessions);

    await expect(
      hoverTool.handler(
        {
          sessionId: "missing",
          target: {
            ref: "e1"
          }
        },
        context
      )
    ).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND"
    });
  });
});
