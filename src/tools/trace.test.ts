import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager, type ManagedSession } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { traceStartTool, traceStopTool } from "./trace.js";

const createdRoots = new Set<string>();

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "airlock-trace-tool-test-"));
  createdRoots.add(root);
  return root;
};

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

const createContext = (
  driver: ElectronDriver,
  sessions: SessionManager,
  artifactRoot: string,
  mode: "safe" | "standard" | "trusted" = "standard"
): AirlockToolContext => {
  return {
    mode,
    policy: {
      mode,
      allowedOrigins: ["http://localhost"],
      artifactRoot,
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
    getEnabledTools: () => ["trace_start", "trace_stop"]
  };
};

const addManagedSession = (
  sessions: SessionManager,
  options?: {
    cleanup?: ManagedSession["cleanup"];
    traceState?: {
      active: boolean;
      tracePath?: string;
    };
  }
) => {
  sessions.add({
    session: {
      sessionId: sessionId("s1"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: "/tmp/airlock-tests/artifacts/s1",
      selectedWindowId: windowId("w1"),
      ...(options?.traceState === undefined ? {} : { traceState: options.traceState }),
      windows: [
        {
          windowId: windowId("w1"),
          title: "Main",
          url: "https://example.test",
          kind: "primary",
          focused: true,
          visible: true,
          lastSeenAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    },
    driverSession: {
      id: "driver-s1",
      launchMode: "preset"
    },
    ...(options?.cleanup === undefined ? {} : { cleanup: options.cleanup })
  });
};

describe("trace tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([...createdRoots].map((root) => rm(root, { recursive: true, force: true })));
    createdRoots.clear();
  });

  it("starts and stops tracing while updating session trace state", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, artifactRoot);

    const startResult = await traceStartTool.handler(
      {
        sessionId: "s1",
        options: {
          screenshots: false,
          snapshots: true
        }
      },
      context
    );

    expect(driver.startTracing).toHaveBeenCalledWith(
      {
        id: "driver-s1",
        launchMode: "preset"
      },
      {
        screenshots: false,
        snapshots: true
      }
    );
    expect(startResult.data.ok).toBe(true);
    expect(sessions.get("s1")?.session.traceState).toEqual({
      active: true
    });

    vi.mocked(driver.stopTracing).mockResolvedValue(undefined);
    const stopResult = await traceStopTool.handler({ sessionId: "s1" }, context);
    const expectedTracePath = path.join(artifactRoot, "traces", "s1.zip");

    expect(driver.stopTracing).toHaveBeenCalledWith(
      {
        id: "driver-s1",
        launchMode: "preset"
      },
      expectedTracePath
    );
    expect(stopResult.data).toEqual({
      ok: true,
      tracePath: expectedTracePath
    });
    expect(sessions.get("s1")?.session.traceState).toEqual({
      active: false,
      tracePath: expectedTracePath
    });
  });

  it("rejects trace_start in safe mode", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, artifactRoot, "safe");

    await expect(traceStartTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "POLICY_VIOLATION"
    });
  });

  it("rejects trace_stop in safe mode", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, artifactRoot, "safe");

    await expect(traceStopTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "POLICY_VIOLATION"
    });
  });

  it("rejects trace_start when tracing is already active", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      traceState: {
        active: true
      }
    });
    const context = createContext(driver, sessions, artifactRoot);

    await expect(traceStartTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("returns idempotent response when trace_stop is called after a prior stop", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      traceState: {
        active: false,
        tracePath: "/tmp/trace.zip"
      }
    });
    const context = createContext(driver, sessions, artifactRoot);

    const result = await traceStopTool.handler({ sessionId: "s1" }, context);

    expect(result.data).toEqual({
      ok: true,
      tracePath: "/tmp/trace.zip"
    });
    expect(result.meta?.warnings).toEqual(["Tracing was already stopped for this session."]);
    expect(driver.stopTracing).not.toHaveBeenCalled();
  });

  it("rejects trace_stop when tracing has never started", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, artifactRoot);

    await expect(traceStopTool.handler({ sessionId: "s1" }, context)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("stops active traces before wrapped session cleanup", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    vi.mocked(driver.stopTracing).mockResolvedValue(undefined);
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const originalCleanup = vi.fn(async () => undefined);
    addManagedSession(sessions, {
      cleanup: originalCleanup
    });
    const context = createContext(driver, sessions, artifactRoot);

    await traceStartTool.handler({ sessionId: "s1" }, context);

    const managedSession = sessions.get("s1");
    if (managedSession === undefined || managedSession.cleanup === undefined) {
      throw new Error("Expected managed session with cleanup wrapper.");
    }

    await managedSession.cleanup(managedSession);

    const expectedTracePath = path.join(artifactRoot, "traces", "s1.zip");
    expect(driver.stopTracing).toHaveBeenCalledWith(
      {
        id: "driver-s1",
        launchMode: "preset"
      },
      expectedTracePath
    );
    expect(originalCleanup).toHaveBeenCalledTimes(1);
    expect(sessions.get("s1")?.session.traceState).toEqual({
      active: false,
      tracePath: expectedTracePath
    });
  });

  it("cleanup wrapper falls back to driver.close when no prior cleanup exists", async () => {
    const artifactRoot = await createTempRoot();
    const driver = createDriver();
    vi.mocked(driver.stopTracing).mockResolvedValue(undefined);
    vi.mocked(driver.close).mockResolvedValue(undefined);
    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions);
    const context = createContext(driver, sessions, artifactRoot);

    await traceStartTool.handler({ sessionId: "s1" }, context);

    const managedSession = sessions.get("s1");
    if (managedSession === undefined || managedSession.cleanup === undefined) {
      throw new Error("Expected managed session with cleanup wrapper.");
    }

    await managedSession.cleanup(managedSession);

    expect(driver.stopTracing).toHaveBeenCalledTimes(1);
    expect(driver.close).toHaveBeenCalledWith({
      id: "driver-s1",
      launchMode: "preset"
    });
  });
});
