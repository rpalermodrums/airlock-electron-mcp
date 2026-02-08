import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RawSnapshot, ElectronDriver } from "../driver/index.js";
import type { RefMap } from "../snapshot/ref-map.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { refId, sessionId, windowId, type SafetyPolicy } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import {
  snapshotDiffTool,
  snapshotInteractiveTool,
  snapshotQueryTool,
  snapshotRegionTool,
  snapshotViewportTool
} from "./snapshot.js";

const {
  buildSnapshotMock,
  buildViewportSnapshotMock,
  buildQuerySnapshotMock,
  buildRegionSnapshotMock,
  buildSnapshotDiffMock,
  findSnapshotNodeBoundsMock
} = vi.hoisted(() => {
  return {
    buildSnapshotMock: vi.fn(),
    buildViewportSnapshotMock: vi.fn(),
    buildQuerySnapshotMock: vi.fn(),
    buildRegionSnapshotMock: vi.fn(),
    buildSnapshotDiffMock: vi.fn(),
    findSnapshotNodeBoundsMock: vi.fn()
  };
});

vi.mock("../snapshot/index.js", () => {
  return {
    buildSnapshot: buildSnapshotMock,
    buildViewportSnapshot: buildViewportSnapshotMock,
    buildQuerySnapshot: buildQuerySnapshotMock,
    buildRegionSnapshot: buildRegionSnapshotMock,
    buildSnapshotDiff: buildSnapshotDiffMock,
    findSnapshotNodeBounds: findSnapshotNodeBoundsMock
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
    getEnabledTools: () => [
      "snapshot_interactive",
      "snapshot_viewport",
      "snapshot_query",
      "snapshot_diff",
      "snapshot_region"
    ]
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
    buildRegionSnapshotMock.mockReset();
    buildSnapshotDiffMock.mockReset();
    findSnapshotNodeBoundsMock.mockReset();
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

  it("snapshot_interactive defaults to maxNodes=200 when maxNodes is omitted", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 8,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    });

    await snapshotInteractiveTool.handler(
      {
        sessionId: "s1"
      },
      context
    );

    expect(buildSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      expect.objectContaining({
        maxNodes: 200
      })
    );
  });

  it("snapshot_interactive adds query-first suggestion metadata when truncated", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: true,
      truncationReason: "Node limit reached at 200.",
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    });

    const result = await snapshotInteractiveTool.handler(
      {
        sessionId: "s1"
      },
      context
    );

    expect(result.meta?.suggestions).toEqual(["Consider using snapshot_query for focused results."]);
    expect(result.meta?.diagnostics).toMatchObject({
      snapshotTruncated: true,
      returnedNodeCount: 1
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
      version: 10,
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
    expect(result.data.snapshotVersion).toBe(10);
    expect(result.data.nodes).toEqual([{ ref: "e1", role: "link", name: "Details" }]);
    expect(result.data.window.title).toBe("Main Window");
  });

  it("snapshot_viewport derives viewport rect from metadata when viewportRect is missing", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot: RawSnapshot = {
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [],
      metadata: {
        viewport: {
          x: 5,
          y: 6,
          width: 700,
          height: 500
        }
      }
    };

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildViewportSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: []
    });

    await snapshotViewportTool.handler(
      {
        sessionId: "s1",
        maxNodes: 250,
        maxTextCharsPerNode: 80
      },
      context
    );

    expect(buildViewportSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      {
        x: 5,
        y: 6,
        width: 700,
        height: 500
      },
      expect.anything()
    );
  });

  it("snapshot_query filters by query criteria", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildQuerySnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 11,
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
        snapshotVersion: 11,
        window: {
          title: "Main Window",
          url: "https://example.test/main"
        },
        nodes: [{ ref: "e2", role: "button", name: "Submit" }],
        truncated: false
      }
    });
  });

  it("snapshot_query returns guidance when no matching nodes are found", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildQuerySnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 12,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: []
    });

    const result = await snapshotQueryTool.handler(
      {
        sessionId: "s1",
        query: {
          role: "button"
        }
      },
      context
    );

    expect(result.data.nodes).toEqual([]);
    expect(result.meta?.suggestions).toEqual([
      "No matches found. Broaden `nameContains`/`textContains` or run snapshot_interactive() for discovery."
    ]);
  });

  it("snapshot_diff compares against cached history epoch", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    const previousSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 20,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    };
    const currentSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 21,
      createdAt: "2026-01-01T00:00:01.000Z",
      truncated: false,
      nodes: [{ ref: refId("e2"), role: "button", name: "Submit" }]
    };

    buildSnapshotMock.mockReturnValueOnce(previousSnapshot).mockReturnValueOnce(currentSnapshot);
    buildSnapshotDiffMock.mockReturnValue({
      added: [{ ref: refId("e2"), role: "button", name: "Submit" }],
      removed: [{ ref: refId("e1"), role: "button", name: "Save" }],
      changed: [],
      context: []
    });

    await snapshotInteractiveTool.handler({ sessionId: "s1" }, context);
    const result = await snapshotDiffTool.handler(
      {
        sessionId: "s1",
        sinceEpoch: 20
      },
      context
    );

    expect(buildSnapshotDiffMock).toHaveBeenCalledWith(currentSnapshot, previousSnapshot);
    expect(result.data).toEqual({
      window: {
        title: "Main Window",
        url: "https://example.test/main"
      },
      sinceEpoch: 20,
      currentEpoch: 21,
      added: [{ ref: "e2", role: "button", name: "Submit" }],
      removed: [{ ref: "e1", role: "button", name: "Save" }],
      changed: [],
      context: []
    });
  });

  it("snapshot_diff throws INVALID_INPUT when sinceEpoch is not in cached history", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);

    await expect(
      snapshotDiffTool.handler(
        {
          sessionId: "s1",
          sinceEpoch: 99999
        },
        context
      )
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({
        availableEpochs: expect.any(Array)
      })
    });
  });

  it("snapshot_diff returns no-change guidance when added/removed/changed are empty", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const previousSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    };
    const currentSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 51,
      createdAt: "2026-01-01T00:00:01.000Z",
      truncated: false,
      nodes: [{ ref: refId("e1"), role: "button", name: "Save" }]
    };

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValueOnce(previousSnapshot).mockReturnValueOnce(currentSnapshot);
    buildSnapshotDiffMock.mockReturnValue({
      added: [],
      removed: [],
      changed: [],
      context: []
    });

    await snapshotInteractiveTool.handler({ sessionId: "s1" }, context);
    const result = await snapshotDiffTool.handler(
      {
        sessionId: "s1",
        sinceEpoch: 50
      },
      context
    );

    expect(result.meta?.suggestions).toEqual([
      "No changes detected for this epoch pair. Run another interaction and capture a fresh snapshot before diffing."
    ]);
  });

  it("snapshot_region uses explicit rect filtering", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const regionRect = {
      x: 100,
      y: 100,
      width: 300,
      height: 200
    };

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildRegionSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 30,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e3"), role: "button", name: "In Region" }]
    });

    const result = await snapshotRegionTool.handler(
      {
        sessionId: "s1",
        rect: regionRect,
        radiusPx: 120,
        maxNodes: 200,
        maxTextCharsPerNode: 80
      },
      context
    );

    expect(buildRegionSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      regionRect,
      expect.objectContaining({
        filter: "all"
      })
    );
    expect(result.data.regionRect).toEqual(regionRect);
    expect(result.data.nodes).toEqual([{ ref: "e3", role: "button", name: "In Region" }]);
  });

  it("snapshot_region resolves anchorRef across epochs before filtering", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const resolutionSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 40,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e8"), role: "button", name: "Anchor" }]
    };
    const regionSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 41,
      createdAt: "2026-01-01T00:00:01.000Z",
      truncated: false,
      nodes: [{ ref: refId("e9"), role: "button", name: "Nearby" }]
    };
    const reResolveRefMock = vi.fn(() => refId("e8"));
    const refMap = {
      reResolveRef: reResolveRefMock,
      rebuildFromSnapshot: vi.fn()
    } as unknown as RefMap;

    context.sessions.setRefMap("s1", "w1", refMap);
    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue(resolutionSnapshot);
    buildRegionSnapshotMock.mockReturnValue(regionSnapshot);
    findSnapshotNodeBoundsMock.mockReturnValue({
      x: 100,
      y: 200,
      width: 50,
      height: 30
    });

    const result = await snapshotRegionTool.handler(
      {
        sessionId: "s1",
        anchorRef: "e1",
        radiusPx: 40,
        maxNodes: 200,
        maxTextCharsPerNode: 80
      },
      context
    );

    expect(reResolveRefMock).toHaveBeenCalledWith("e1", resolutionSnapshot);
    expect(buildRegionSnapshotMock).toHaveBeenCalledWith(
      rawSnapshot,
      {
        x: 60,
        y: 160,
        width: 130,
        height: 110
      },
      expect.objectContaining({
        filter: "all"
      })
    );
    expect(result.data.nodes).toEqual([{ ref: "e9", role: "button", name: "Nearby" }]);
  });

  it("snapshot_region requires exactly one of rect or anchorRef", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);

    await expect(
      snapshotRegionTool.handler(
        {
          sessionId: "s1",
          radiusPx: 120,
          maxNodes: 200,
          maxTextCharsPerNode: 80,
          rect: {
            x: 0,
            y: 0,
            width: 100,
            height: 100
          },
          anchorRef: "e1"
        },
        context
      )
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    await expect(
      snapshotRegionTool.handler(
        {
          sessionId: "s1",
          radiusPx: 120,
          maxNodes: 200,
          maxTextCharsPerNode: 80
        },
        context
      )
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("snapshot_region anchorRef requires cached ref-map state", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);

    await expect(
      snapshotRegionTool.handler(
        {
          sessionId: "s1",
          radiusPx: 120,
          maxNodes: 200,
          maxTextCharsPerNode: 80,
          anchorRef: "e1"
        },
        context
      )
    ).rejects.toMatchObject({
      code: "REF_NOT_FOUND"
    });
  });

  it("snapshot_region returns REF_NOT_FOUND when reResolveRef cannot find anchor", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const refMap = {
      reResolveRef: vi.fn(() => null),
      rebuildFromSnapshot: vi.fn()
    } as unknown as RefMap;
    context.sessions.setRefMap("s1", "w1", refMap);

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 70,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: []
    });

    await expect(
      snapshotRegionTool.handler(
        {
          sessionId: "s1",
          radiusPx: 120,
          maxNodes: 200,
          maxTextCharsPerNode: 80,
          anchorRef: "e1"
        },
        context
      )
    ).rejects.toMatchObject({
      code: "REF_NOT_FOUND"
    });
  });

  it("snapshot_region returns REF_NOT_FOUND when anchor bounds are unavailable", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const resolutionSnapshot = {
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 80,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: [{ ref: refId("e8"), role: "button", name: "Anchor" }]
    };
    const refMap = {
      reResolveRef: vi.fn(() => refId("e8")),
      rebuildFromSnapshot: vi.fn()
    } as unknown as RefMap;

    context.sessions.setRefMap("s1", "w1", refMap);
    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildSnapshotMock.mockReturnValue(resolutionSnapshot);
    findSnapshotNodeBoundsMock.mockReturnValue(undefined);

    await expect(
      snapshotRegionTool.handler(
        {
          sessionId: "s1",
          radiusPx: 120,
          maxNodes: 200,
          maxTextCharsPerNode: 80,
          anchorRef: "e1"
        },
        context
      )
    ).rejects.toMatchObject({
      code: "REF_NOT_FOUND"
    });
  });

  it("snapshot_region returns guidance when region contains no nodes", async () => {
    const driver = createDriver();
    const context = createManagedContext(driver);
    const rawSnapshot = createRawSnapshot();
    const regionRect = {
      x: 0,
      y: 0,
      width: 50,
      height: 50
    };

    vi.mocked(driver.getSnapshot).mockResolvedValue(rawSnapshot);
    buildRegionSnapshotMock.mockReturnValue({
      sessionId: sessionId("s1"),
      windowId: windowId("w1"),
      version: 90,
      createdAt: "2026-01-01T00:00:00.000Z",
      truncated: false,
      nodes: []
    });

    const result = await snapshotRegionTool.handler(
      {
        sessionId: "s1",
        radiusPx: 120,
        maxNodes: 200,
        maxTextCharsPerNode: 80,
        rect: regionRect
      },
      context
    );

    expect(result.data.nodes).toEqual([]);
    expect(result.meta?.suggestions).toEqual([
      "No nodes intersected this region. Increase `radiusPx` or use a larger `rect` and retry."
    ]);
  });
});
