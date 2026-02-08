import { describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { serverResetTool } from "./server-reset.js";

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
    getEnabledTools: () => ["server_reset"]
  };
};

const createManagedSession = (id: string, cleanup: (() => Promise<void>) | undefined = undefined) => {
  return {
    session: {
      sessionId: sessionId(id),
      state: "running" as const,
      mode: "standard" as const,
      launchMode: "preset" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: `/tmp/airlock/${id}`,
      selectedWindowId: undefined,
      windows: []
    },
    ...(cleanup === undefined ? {} : { cleanup })
  };
};

describe("serverResetTool", () => {
  it("validates an empty input object", () => {
    expect(serverResetTool.inputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(serverResetTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("closes all active sessions and returns closedCount", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    sessions.add(createManagedSession("s1", async () => {}));
    sessions.add(createManagedSession("s2", async () => {}));
    const context = createContext(sessions);

    const result = await serverResetTool.handler({}, context);

    expect(result.data).toEqual({
      ok: true,
      closedCount: 2
    });
    expect(sessions.count()).toBe(0);
  });

  it("throws INTERNAL_ERROR when one or more session cleanups fail", async () => {
    const sessions = new SessionManager({ ttlMs: 30_000 });
    sessions.add(
      createManagedSession("s1", async () => {
        throw new Error("cleanup failed");
      })
    );
    const context = createContext(sessions);

    await expect(serverResetTool.handler({}, context)).rejects.toMatchObject({
      code: "INTERNAL_ERROR"
    });
  });
});
