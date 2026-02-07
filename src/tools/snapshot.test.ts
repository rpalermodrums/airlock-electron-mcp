import { describe, it, expect, vi, beforeEach } from "vitest";

import type { RawSnapshot, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { refId, sessionId, windowId, type SafetyPolicy } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { snapshotInteractiveTool, snapshotQueryTool, snapshotViewportTool } from "./snapshot.js";

const { buildSnapshotMock, buildViewportSnapshotMock, buildQuerySnapshotMock } = vi.hoisted(() => {
  return {
    buildSnapshotMock: vi.fn(),
    buildViewportSnapshotMock: vi.fn(),
    buildQuerySnapshotMock: vi.fn()
  };
});

vi.mock("../snapshot/index.js", () => {
  return {
    buildSnapshot: buildSnapshotMock,
    buildViewportSnapshot: buildViewportSnapshotMock,
    buildQuerySnapshot: buildQuerySnapshotMock
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
    getConsoleLogs: vi.fn(),
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

const createPolicy = (): SafetyPolicy => {
  return {
    mode: "standard",
    allowedOrigins: ["http://localhost"],
    artifactRoot: "/tmp/airlock-tests",
    maxSessionTtlMs: 30_000
  };
};

const createManagedContext = (driver: ElectronDriver): AirlockToolContext => {
  const sessions = new SessionManager({ ttlMs: 30_000 });
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
          title: "Main Window",
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

  return {
    mode: "standard",
    policy: createPolicy(),
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
    getEnabledTools: () => ["snapshot_interactive", "snapshot_viewport", "snapshot_query"]
  };
};

const createRawSnapshot = (): RawSnapshot => {
  return {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    truncated: false,
    viewportRect: {
      x: 10,
      y: 20,
      width: 640,
      height: 480
    },
    nodes: []
  };
};

describe("snapshot tools", () => {
  beforeEach(() => {
    buildSnapshotMock.mockReset();
    buildViewportSnapshotMock.mockReset();
    buildQuerySnapshotMock.mockReset();
  });

  it("snapshot_interactive calls driver.getSnapshot and processes result", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    });

    const result = await snapshotInteractiveTool.handler(
      {
        sessionId: "s1",
        maxNodes: 50,
        maxTextCharsPerNode: 90
      },
      context
    );

    expect(driver.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "w1",
        title: "Main Window"
      })
    );
    expect(buildSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      expect.objectContaining({
        sessionId: "s1",
        windowId: "w1",
        filter: "interactive",
        maxNodes: 50,
        maxTextCharsPerNode: 90
      })
    );
    expect(result).toEqual({
      data: {
        snapshotVersion: 7,
        window: {
          title: "Main Window",
          url: "https://example.test/main"
        },
        nodes: [{ ref: "e1", role: "button", name: "Save" }],
        truncated: false
      }
    });
  });

  it("snapshot_viewport returns viewport-scoped results", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildViewportSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 8,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "link", name: "Details" }]
    });

    const result = await snapshotViewportTool.handler(
      {
        sessionId: "s1",
        maxNodes: 100,
        maxTextCharsPerNode: 120
      },
      context
    );

    expect(buildViewportSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      rawSnapshot.viewportRect,
      expect.objectContaining({
        filter: "interactive",
        maxNodes: 100,
        maxTextCharsPerNode: 120
      })
    );
    expect(result.data.snapshotVersion).toBe(8);
    expect(result.data.nodes).toEqual([{ ref: "e1", role: "link", name: "Details" }]);
    expect(result.data.window.title).toBe("Main Window");
  });

  it("snapshot_query filters by query criteria", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildQuerySnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e2"), role: "button", name: "Submit" }]
    });

    const result = await snapshotQueryTool.handler(
      {
        sessionId: "s1",
        query: {
          role: "button",
          nameContains: "sub"
        }
      },
      context
    );

    expect(buildQuerySnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      {
        role: "button",
        nameContains: "sub"
      },
      expect.objectContaining({
        sessionId: "s1",
        windowId: "w1",
        filter: "all"
      })
    );
    expect(result).toEqual({
      data: {
        snapshotVersion: 9,
        window: {
          title: "Main Window",
          url: "https://example.test/main"
        },
        nodes: [{ ref: "e2", role: "button", name: "Submit" }],
        truncated: false
      }
    });
  });
});
