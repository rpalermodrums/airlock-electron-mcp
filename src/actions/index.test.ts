import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "uuid-test")
}));

import { mkdir, writeFile } from "node:fs/promises";

import type { ElectronDriver } from "../driver/index.js";
import type { RefMap } from "../snapshot/ref-map.js";
import type { ManagedSession } from "../session-manager.js";
import { sessionId, windowId, type SnapshotNode } from "../types/session.js";
import { executeAction, resolveTarget } from "./index.js";

type ThrowingFn = () => unknown;

const getThrown = (fn: ThrowingFn): unknown => {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }

  throw new Error("Expected function to throw.");
};

const createRefMapMock = (): {
  refMap: RefMap;
  resolveRef: ReturnType<typeof vi.fn>;
  toPlaywrightLocator: ReturnType<typeof vi.fn>;
} => {
  const resolveRef = vi.fn();
  const toPlaywrightLocator = vi.fn();
  const refMap = {
    currentEpoch: 1,
    resolveRef,
    toPlaywrightLocator,
    rebuildFromSnapshot: vi.fn((_nodes: readonly SnapshotNode[]) => 1),
    isStale: vi.fn(() => false)
  } as unknown as RefMap;

  return {
    refMap,
    resolveRef,
    toPlaywrightLocator
  };
};

const createDriverMock = (): {
  driver: ElectronDriver;
  performAction: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
} => {
  const performAction = vi.fn();
  const screenshot = vi.fn();
  const driver = {
    launch: vi.fn(),
    attach: vi.fn(),
    getWindows: vi.fn(),
    getSnapshot: vi.fn(),
    performAction,
    screenshot,
    getConsoleLogs: vi.fn(),
    close: vi.fn()
  } as unknown as ElectronDriver;

  return {
    driver,
    performAction,
    screenshot
  };
};

const createManagedSession = (refMap?: RefMap): ManagedSession => {
  const now = "2026-02-07T00:00:00.000Z";
  return {
    session: {
      sessionId: sessionId("session-actions"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      artifactDir: "/tmp/airlock-artifacts",
      selectedWindowId: windowId("window-main"),
      windows: [
        {
          windowId: windowId("window-main"),
          title: "Main Window",
          url: "https://app.local",
          kind: "primary",
          focused: true,
          visible: true,
          lastSeenAt: now
        }
      ]
    },
    driverSession: {
      id: "driver-session",
      launchMode: "preset"
    },
    refMaps: new Map(refMap === undefined ? [] : [["window-main", refMap]])
  };
};

describe("actions/index resolveTarget()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolveTarget() with ref target uses RefMap to resolve", () => {
    const { refMap, resolveRef, toPlaywrightLocator } = createRefMapMock();
    const descriptor = {
      type: "testId",
      value: "save-btn",
      priority: 100
    };
    resolveRef.mockReturnValue(descriptor);

    const resolved = resolveTarget(
      {
        ref: "e1"
      },
      refMap
    );

    expect(resolveRef).toHaveBeenCalledWith("e1");
    expect(resolved.locator).toBe('[data-testid="save-btn"]');
    expect(resolved.descriptor).toEqual(descriptor);
    expect(toPlaywrightLocator).not.toHaveBeenCalled();
  });

  it("resolveTarget() with role+name target builds locator", () => {
    const { refMap } = createRefMapMock();

    const resolved = resolveTarget(
      {
        role: "button",
        name: "Save"
      },
      refMap
    );

    expect(resolved).toEqual({
      locator: 'role=button[name="Save"]'
    });
  });

  it("resolveTarget() with testId target builds locator", () => {
    const { refMap } = createRefMapMock();

    const resolved = resolveTarget(
      {
        testId: "save-btn"
      },
      refMap
    );

    expect(resolved).toEqual({
      locator: '[data-testid="save-btn"]'
    });
  });

  it("resolveTarget() with css target builds locator with warning", () => {
    const { refMap } = createRefMapMock();

    const resolved = resolveTarget(
      {
        css: ".danger .cta"
      },
      refMap
    );

    expect(resolved.locator).toBe(".danger .cta");
    expect(resolved.warnings?.[0]).toContain("brittle");
  });

  it("resolveTarget() throws REF_NOT_FOUND for unknown ref", () => {
    const { refMap, resolveRef } = createRefMapMock();
    resolveRef.mockReturnValue(undefined);

    const thrown = getThrown(() =>
      resolveTarget(
        {
          ref: "missing-ref"
        },
        refMap
      )
    );

    expect(thrown).toMatchObject({
      code: "REF_NOT_FOUND",
      retriable: false
    });
  });

  it("resolveTarget() throws REF_STALE for stale epoch", () => {
    const { refMap, resolveRef } = createRefMapMock();
    resolveRef.mockReturnValue({
      type: "css",
      value: "#stale",
      priority: 10,
      stale: true
    });

    const thrown = getThrown(() =>
      resolveTarget(
        {
          ref: "e2"
        },
        refMap
      )
    );

    expect(thrown).toMatchObject({
      code: "REF_STALE",
      retriable: false
    });
  });
});

describe("actions/index executeAction()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it("executeAction() calls driver.performAction with correct params", async () => {
    const { driver, performAction } = createDriverMock();
    performAction.mockResolvedValue({
      ok: true
    });

    const result = await executeAction(driver, createManagedSession(), "window-main", {
      action: "click",
      target: {
        role: "button",
        name: "Save"
      }
    });

    expect(performAction).toHaveBeenCalledTimes(1);
    expect(performAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "window-main",
        title: "Main Window",
        url: "https://app.local",
        kind: "primary"
      }),
      {
        action: "click",
        target: {
          selector: 'role=button[name="Save"]'
        }
      }
    );
    expect(result).toEqual({
      ok: true
    });
  });

  it("executeAction() captures screenshot on failure", async () => {
    const { driver, performAction, screenshot } = createDriverMock();
    const screenshotBuffer = Buffer.from("png-data");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    performAction.mockResolvedValue({
      ok: false,
      message: "Click failed",
      diagnostics: {
        reason: "not-clickable"
      }
    });
    screenshot.mockResolvedValue(screenshotBuffer);

    const result = await executeAction(driver, createManagedSession(), "window-main", {
      action: "click",
      target: {
        testId: "save-btn"
      }
    });
    nowSpy.mockRestore();

    expect(screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "window-main"
      }),
      {
        fullPage: true
      }
    );
    expect(mkdir).toHaveBeenCalledWith("/tmp/airlock-artifacts/screenshots", {
      recursive: true
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/airlock-artifacts/screenshots/action-failure-1700000000000-uuid-test.png",
      screenshotBuffer
    );
    expect(result).toMatchObject({
      ok: false,
      message: "Click failed",
      screenshotPath: "/tmp/airlock-artifacts/screenshots/action-failure-1700000000000-uuid-test.png",
      diagnostics: {
        sessionId: "session-actions",
        windowId: "window-main",
        action: "click",
        reason: "not-clickable"
      }
    });
  });

  it("executeAction() wraps driver errors in AirlockError", async () => {
    const { driver, performAction, screenshot } = createDriverMock();
    const screenshotBuffer = Buffer.from("png-data");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000001);
    performAction.mockRejectedValue(new Error("renderer crashed"));
    screenshot.mockResolvedValue(screenshotBuffer);

    const result = await executeAction(driver, createManagedSession(), "window-main", {
      action: "click",
      target: {
        css: ".save"
      }
    });
    nowSpy.mockRestore();

    expect(result).toMatchObject({
      ok: false,
      message: "renderer crashed",
      screenshotPath: "/tmp/airlock-artifacts/screenshots/action-failure-1700000000001-uuid-test.png",
      diagnostics: {
        sessionId: "session-actions",
        windowId: "window-main",
        action: "click",
        error: "renderer crashed"
      }
    });
  });
});
