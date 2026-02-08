import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DriverSession, DriverWindow, ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { appLaunchTool } from "./app-launch.js";

const {
  ensureArtifactDirectoriesMock,
  createSessionArtifactDirMock,
  resolvePresetMock,
  launchWithPresetMock,
  launchCustomMock
} = vi.hoisted(() => {
  return {
    ensureArtifactDirectoriesMock: vi.fn(),
    createSessionArtifactDirMock: vi.fn(),
    resolvePresetMock: vi.fn(),
    launchWithPresetMock: vi.fn(),
    launchCustomMock: vi.fn()
  };
});

vi.mock("../artifacts/index.js", () => {
  return {
    ensureArtifactDirectories: ensureArtifactDirectoriesMock,
    createSessionArtifactDir: createSessionArtifactDirMock
  };
});

vi.mock("../launch/index.js", () => {
  return {
    resolvePreset: resolvePresetMock,
    launchWithPreset: launchWithPresetMock,
    launchCustom: launchCustomMock
  };
});

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

const createContext = (driver: ElectronDriver, sessions: SessionManager, preset?: string): AirlockToolContext => {
  return {
    mode: "standard",
    policy: {
      mode: "standard",
      allowedOrigins: ["http://localhost"],
      artifactRoot: "/tmp/airlock-tests",
      maxSessionTtlMs: 30_000
    },
    ...(preset === undefined ? {} : { preset }),
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
    getEnabledTools: () => ["app_launch"]
  };
};

const makeWindow = (window: Partial<DriverWindow> & { id: string }): DriverWindow => {
  return {
    id: window.id,
    title: window.title ?? "Main",
    url: window.url ?? "https://example.test",
    kind: window.kind ?? "primary",
    focused: window.focused ?? true,
    visible: window.visible ?? true
  };
};

const makeDriverSession = (
  launchMode: DriverSession["launchMode"],
  metadata?: DriverSession["metadata"]
): DriverSession => {
  return {
    id: `driver-${launchMode}-1`,
    launchMode,
    ...(metadata === undefined ? {} : { metadata })
  };
};

describe("appLaunchTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    ensureArtifactDirectoriesMock.mockResolvedValue({
      rootDir: "/tmp/airlock-tests",
      artifactsDir: "/tmp/airlock-tests/artifacts",
      logsDir: "/tmp/airlock-tests/logs",
      tracesDir: "/tmp/airlock-tests/traces"
    });
    createSessionArtifactDirMock.mockResolvedValue({
      sessionId: "session-generated-1",
      sessionDir: "/tmp/airlock-tests/artifacts/session-generated-1"
    });
    resolvePresetMock.mockImplementation((preset: string) => ({ id: preset }));
    launchWithPresetMock.mockResolvedValue(makeDriverSession("preset"));
    launchCustomMock.mockResolvedValue(makeDriverSession("custom"));
  });

  it("launches with preset flow, stores session state, and selects a primary window", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions);

    vi.mocked(driver.getWindows).mockResolvedValue([
      makeWindow({
        id: "w-devtools",
        title: "DevTools",
        kind: "devtools",
        focused: false
      }),
      makeWindow({
        id: "w-primary",
        title: "App",
        kind: "primary",
        focused: true
      })
    ]);

    const result = await appLaunchTool.handler(
      {
        projectRoot: "/repo/app"
      },
      context
    );

    expect(resolvePresetMock).toHaveBeenCalledWith("electron-vite");
    expect(launchWithPresetMock).toHaveBeenCalledWith(
      {
        id: "electron-vite"
      },
      "/repo/app",
      expect.objectContaining({
        driver,
        sessionId: "session-generated-1",
        attachFallback: {
          enabled: false
        }
      })
    );
    expect(result.data).toMatchObject({
      sessionId: "session-generated-1",
      launchMode: "preset",
      state: "running",
      selectedWindowId: "w-primary",
      artifactDir: "/tmp/airlock-tests/artifacts/session-generated-1"
    });
    expect(result.data.windows).toHaveLength(2);

    const managed = sessions.get("session-generated-1");
    expect(managed?.session.selectedWindowId).toBe("w-primary");
    expect(managed?.session.windows.map((window) => window.windowId)).toEqual(["w-devtools", "w-primary"]);
  });

  it("uses context preset fallback and enables attach fallback when remote debugging port is configured", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions, "my-preset");
    vi.mocked(driver.getWindows).mockResolvedValue([makeWindow({ id: "w1" })]);

    await appLaunchTool.handler(
      {
        projectRoot: "/repo/app",
        electron: {
          args: ["--remote-debugging-port=9222"]
        },
        devServer: {
          readyPattern: "renderer ready",
          timeoutMs: 10_000
        }
      },
      context
    );

    expect(resolvePresetMock).toHaveBeenCalledWith("my-preset");
    expect(launchWithPresetMock).toHaveBeenCalledWith(
      {
        id: "my-preset"
      },
      "/repo/app",
      expect.objectContaining({
        attachFallback: {
          enabled: true
        },
        devServer: expect.objectContaining({
          timeoutMs: 10_000,
          readyPattern: expect.any(RegExp)
        })
      })
    );

    const launchOptions = launchWithPresetMock.mock.calls[0]?.[2];
    expect(launchOptions?.devServer?.readyPattern?.test("RENDERER READY")).toBe(true);
  });

  it("launches with custom flow and composes entryPath + args", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions);
    vi.mocked(driver.getWindows).mockResolvedValue([]);

    const result = await appLaunchTool.handler(
      {
        projectRoot: "/repo/app",
        preset: "custom",
        electron: {
          entryPath: "src/main.ts",
          executablePath: "/usr/local/bin/electron",
          args: ["--inspect"],
          env: {
            FOO: "bar"
          }
        },
        timeouts: {
          launchMs: 12_000,
          firstWindowMs: 4_000
        }
      },
      context
    );

    expect(launchCustomMock).toHaveBeenCalledWith({
      driver,
      config: {
        sessionId: "session-generated-1",
        projectRoot: "/repo/app",
        executablePath: "/usr/local/bin/electron",
        args: [path.resolve("/repo/app", "src/main.ts"), "--inspect"],
        env: {
          FOO: "bar"
        },
        timeoutMs: 12_000,
        firstWindowTimeoutMs: 4_000
      }
    });
    expect(launchWithPresetMock).not.toHaveBeenCalled();
    expect(result.meta?.warnings).toEqual(["Session launched but no renderer windows were discovered yet."]);
    expect(result.meta?.suggestions).toEqual(["Call window_list() after a short wait to refresh available windows."]);
  });

  it("throws INVALID_INPUT when devServer.readyPattern is not a valid regex", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions);

    await expect(
      appLaunchTool.handler(
        {
          projectRoot: "/repo/app",
          devServer: {
            readyPattern: "["
          }
        },
        context
      )
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("cleanup callback closes driver session and terminates dev server process", async () => {
    const driver = createDriver();
    const sessions = new SessionManager({ ttlMs: 30_000 });
    const context = createContext(driver, sessions);
    vi.mocked(driver.getWindows).mockResolvedValue([makeWindow({ id: "w1" })]);

    const kill = vi.fn();
    const devServerProcess = {
      killed: false,
      kill
    };
    launchWithPresetMock.mockResolvedValue(
      makeDriverSession("preset", {
        devServerProcess
      })
    );

    await appLaunchTool.handler(
      {
        projectRoot: "/repo/app"
      },
      context
    );

    const managed = sessions.get("session-generated-1");
    expect(managed?.cleanup).toBeDefined();
    if (managed?.cleanup === undefined) {
      throw new Error("Expected cleanup callback");
    }

    await managed.cleanup(managed);

    expect(driver.close).toHaveBeenCalledWith({
      id: "driver-preset-1",
      launchMode: "preset",
      metadata: {
        devServerProcess
      }
    });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(managed.session.state).toBe("closed");
  });
});
