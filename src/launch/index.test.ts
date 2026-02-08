import { describe, expect, it, vi } from "vitest";

import type { DriverSession, DriverWindow, ElectronDriver } from "../driver/index.js";
import { PRE_LAUNCHED_ATTACH_PRESET, attachToCDP, launchCustom, launchWithPreset } from "./index.js";

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

const createWindow = (id: string, url: string): DriverWindow => {
  return {
    id,
    title: "Main",
    url,
    kind: "primary",
    focused: true,
    visible: true
  };
};

describe("launch public api", () => {
  it("launchCustom forwards config to driver.launch", async () => {
    const driver = createDriver();
    const launchResult: DriverSession = {
      id: "session-custom-1",
      launchMode: "custom"
    };

    vi.mocked(driver.launch).mockResolvedValue(launchResult);

    const result = await launchCustom({
      driver,
      config: {
        projectRoot: "/repo/project",
        args: ["--foo"],
        timeoutMs: 12_000
      }
    });

    expect(driver.launch).toHaveBeenCalledWith({
      projectRoot: "/repo/project",
      args: ["--foo"],
      timeoutMs: 12_000
    });
    expect(result).toEqual(launchResult);
  });

  it("attachToCDP uses driver.attach and annotates launchPath metadata", async () => {
    const driver = createDriver();
    vi.mocked(driver.attach).mockResolvedValue({
      id: "session-attached-1",
      launchMode: "attached",
      metadata: {
        attachTargets: [{ targetId: "renderer-1", type: "page", url: "http://localhost:5173" }],
        attachSelectionRationale: "selected first non-devtools page target",
        primaryRendererTargetId: "renderer-1",
        primaryRendererUrl: "http://localhost:5173"
      }
    });

    const result = await attachToCDP({
      driver,
      cdpUrl: "http://127.0.0.1:9222"
    });

    expect(driver.attach).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222"
    });
    expect(result.metadata).toEqual(
      expect.objectContaining({
        launchPath: "cdp_attach"
      })
    );
  });

  it("launchWithPreset supports pre-launched attach preset as first-class flow", async () => {
    const driver = createDriver();
    vi.mocked(driver.attach).mockResolvedValue({
      id: "session-attached-2",
      launchMode: "attached",
      metadata: {
        attachTargets: [{ targetId: "renderer-1", type: "page", url: "http://localhost:5173" }],
        attachSelectionRationale: "selected first non-devtools page target",
        primaryRendererTargetId: "renderer-1",
        primaryRendererUrl: "http://localhost:5173"
      }
    });
    vi.mocked(driver.getWindows).mockResolvedValue([createWindow("window-1", "http://localhost:5173")]);

    const result = await launchWithPreset(PRE_LAUNCHED_ATTACH_PRESET, "/repo/app", {
      driver,
      sessionId: "session-attached-2",
      electron: {
        args: ["--remote-debugging-port=9222"]
      }
    });

    expect(driver.attach).toHaveBeenCalledWith({
      sessionId: "session-attached-2",
      cdpUrl: "http://127.0.0.1:9222"
    });
    expect(result.launchMode).toBe("attached");
    expect(result.metadata).toEqual(
      expect.objectContaining({
        preset: "pre-launched-attach",
        presetVersion: 2,
        readinessCompletedSignals: []
      })
    );
  });
});
