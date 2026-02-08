import process from "node:process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { appKillTool } from "./app-kill.js";

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

const createContext = (
  driver: ElectronDriver,
  sessionManager: SessionManager,
  mode: "safe" | "standard" | "trusted" = "standard"
): AirlockToolContext => {
  return {
    mode,
    policy: {
      mode,
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
    sessions: sessionManager,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["app_kill"]
  };
};

const addManagedSession = (
  sessionManager: SessionManager,
  options?: {
    metadata?: Record<string, unknown>;
    cleanup?: () => Promise<void>;
  }
): void => {
  const cleanup =
    options?.cleanup === undefined
      ? undefined
      : async () => {
          await options.cleanup?.();
        };

  sessionManager.add({
    session: {
      sessionId: "s1" as never,
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: "/tmp/airlock/s1",
      selectedWindowId: "w1" as never,
      windows: []
    },
    driverSession: {
      id: "driver-session-1",
      launchMode: "preset",
      metadata: options?.metadata ?? {
        processId: 4242
      }
    },
    ...(cleanup === undefined ? {} : { cleanup })
  });
};

describe("appKillTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates required input", () => {
    expect(appKillTool.inputSchema.safeParse({}).success).toBe(false);
    expect(appKillTool.inputSchema.safeParse({ sessionId: "s1" }).success).toBe(true);
  });

  it("force-kills a session and removes it from SessionManager", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, "standard");

    vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.mocked(driver.close).mockResolvedValue(undefined);

    const result = await appKillTool.handler({ sessionId: "s1" }, context);

    expect(process.kill).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(driver.close).toHaveBeenCalledWith({
      id: "driver-session-1",
      launchMode: "preset",
      metadata: {
        processId: 4242
      }
    });
    expect(result.data.ok).toBe(true);
    expect(sessions.get("s1")).toBeUndefined();
  });

  it("throws SESSION_NOT_FOUND when the session does not exist", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions, "standard");

    await expect(appKillTool.handler({ sessionId: "missing" }, context)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND"
    });
  });

  it("rejects app_kill in safe mode", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, "safe");

    await expect(appKillTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "POLICY_VIOLATION"
    });
  });

  it("falls back to driver.close when no Electron PID exists", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      metadata: {
        launchPath: "cdp_attach"
      }
    });
    const context = createContext(driver, sessions, "standard");

    vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.mocked(driver.close).mockResolvedValue(undefined);

    const result = await appKillTool.handler({ sessionId: "s1" }, context);

    expect(process.kill).not.toHaveBeenCalled();
    expect(driver.close).toHaveBeenCalledTimes(1);
    expect(result.data.message).toContain("no direct Electron PID was available");
  });

  it("treats ESRCH as already-exited process and still removes the session", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, "standard");

    vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("no such process") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });
    vi.mocked(driver.close).mockResolvedValue(undefined);

    const result = await appKillTool.handler({ sessionId: "s1" }, context);

    expect(result.data.ok).toBe(true);
    expect(result.data.message).toContain("was not running");
    expect(sessions.get("s1")).toBeUndefined();
  });

  it("uses custom cleanup callback when provided", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const cleanup = vi.fn(async () => undefined);
    addManagedSession(sessions, {
      cleanup
    });
    const context = createContext(driver, sessions, "standard");

    vi.spyOn(process, "kill").mockImplementation(() => true);

    await appKillTool.handler({ sessionId: "s1" }, context);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(driver.close).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR with cleanup details when teardown fails", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, "standard");

    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("permission denied");
    });
    vi.mocked(driver.close).mockRejectedValue(new Error("close failed"));

    await expect(appKillTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: expect.objectContaining({
        sessionId: "s1",
        cleanupErrors: expect.arrayContaining([
          expect.stringContaining("Failed to SIGKILL process 4242"),
          expect.stringContaining("Cleanup failed: close failed")
        ])
      })
    });

    expect(sessions.get("s1")).toBeUndefined();
  });
});
