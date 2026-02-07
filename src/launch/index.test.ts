import { EventEmitter } from "node:events";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DriverSession, ElectronDriver } from "../driver/index.js";
import { launchCustom, launchWithPreset, resolvePreset, ELECTRON_VITE_PRESET, type LaunchPreset } from "./index.js";

const { spawnMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn()
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock
  };
});

type FakeChildProcess = ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

const createFakeChildProcess = (pid: number = 4321): FakeChildProcess => {
  const processRef = new EventEmitter() as FakeChildProcess;
  const mutableProcess = processRef as unknown as {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };

  mutableProcess.stdout = new PassThrough();
  mutableProcess.stderr = new PassThrough();
  mutableProcess.pid = pid;
  mutableProcess.killed = false;
  mutableProcess.kill = vi.fn(() => {
    mutableProcess.killed = true;
    return true;
  });
  return processRef;
};

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

const captureSyncError = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw.");
};

describe("launch orchestration", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.useRealTimers();
  });

  it("resolvePreset('electron-vite') returns ELECTRON_VITE_PRESET", () => {
    expect(resolvePreset("electron-vite")).toBe(ELECTRON_VITE_PRESET);
  });

  it("resolvePreset() throws for unknown preset name", () => {
    const error = captureSyncError(() => {
      resolvePreset("unknown-preset");
    }) as { code: string; details?: { name?: string } };

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.details?.name).toBe("unknown-preset");
  });

  it("launchCustom() calls driver.launch() with correct config", async () => {
    const driver = createDriver();
    const launchResult: DriverSession = {
      id: "session-custom-1",
      launchMode: "custom"
    };
    const config = {
      projectRoot: "/repo/project",
      args: ["--foo", "bar"],
      timeoutMs: 12_000
    };

    vi.mocked(driver.launch).mockResolvedValue(launchResult);
    const result = await launchCustom({ driver, config });

    expect(driver.launch).toHaveBeenCalledWith(config);
    expect(result).toEqual(launchResult);
  });

  it("resolves when dev server stdout matches readyPattern", async () => {
    const driver = createDriver();
    const fakeProcess = createFakeChildProcess(9876);
    const launchedSession: DriverSession = {
      id: "session-1",
      launchMode: "preset"
    };

    spawnMock.mockReturnValue(fakeProcess as ChildProcess);
    vi.mocked(driver.launch).mockResolvedValue(launchedSession);

    const promise = launchWithPreset(ELECTRON_VITE_PRESET, "/repo/app", {
      driver,
      devServer: {
        command: "npm run dev",
        readyPattern: /server started/i,
        timeoutMs: 1_000
      }
    });

    setTimeout(() => {
      fakeProcess.stdout.write("server started on http://localhost:3000\n");
    }, 0);

    const result = await promise;

    expect(driver.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/repo/app",
        preset: "electron-vite",
        args: [path.resolve("/repo/app", ".")]
      })
    );
    expect(result.metadata).toEqual(
      expect.objectContaining({
        devServerPid: 9876,
        launchPath: "playwright_launch"
      })
    );
  });

  it("rejects when dev server readiness times out", async () => {
    vi.useFakeTimers();
    const driver = createDriver();
    const fakeProcess = createFakeChildProcess(1111);

    spawnMock.mockReturnValue(fakeProcess as ChildProcess);
    vi.mocked(driver.launch).mockResolvedValue({
      id: "should-not-launch",
      launchMode: "preset"
    });

    const promise = launchWithPreset(ELECTRON_VITE_PRESET, "/repo/app", {
      driver,
      devServer: {
        command: "npm run dev",
        readyPattern: /ready/i,
        timeoutMs: 25
      }
    });
    const capturedError = promise.then(
      () => {
        throw new Error("Expected launchWithPreset() to reject.");
      },
      (error: unknown) => error
    );

    await vi.advanceTimersByTimeAsync(30);

    await expect(capturedError).resolves.toMatchObject({
      code: "LAUNCH_FAILED",
      message: "Timed out waiting for dev server readiness signal."
    });
    expect(driver.launch).not.toHaveBeenCalled();
    expect(fakeProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses CDP attach fallback chain when launch fails", async () => {
    const driver = createDriver();
    const preset: LaunchPreset = {
      name: "fallback-preset",
      electronEntryPath: "."
    };
    const launchError = Object.assign(new Error("launch blocked"), {
      details: {
        stdout: ["debug output"],
        stderr: ["DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc"]
      }
    });

    vi.mocked(driver.launch).mockRejectedValue(launchError);
    vi.mocked(driver.attach).mockResolvedValue({
      id: "attached-1",
      launchMode: "attached",
      metadata: {
        source: "attach"
      }
    });

    const result = await launchWithPreset(preset, "/repo/app", {
      driver,
      electron: {
        args: ["--remote-debugging-port=9222"]
      },
      attachFallback: {
        enabled: true
      }
    });

    expect(driver.attach).toHaveBeenCalledWith({
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
      cdpUrl: "http://127.0.0.1:9222"
    });
    expect(result.metadata).toEqual(
      expect.objectContaining({
        launchPath: "cdp_attach_fallback",
        launchFallbackReason: "launch blocked"
      })
    );
  });
});
