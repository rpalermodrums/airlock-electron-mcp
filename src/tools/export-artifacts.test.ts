import { access, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionArtifactDir, ensureArtifactRoot } from "../artifacts/index.js";
import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { sessionId, windowId } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { exportArtifactsTool } from "./export-artifacts.js";

const createdRoots = new Set<string>();

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "airlock-export-tool-test-"));
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

const createContext = (driver: ElectronDriver, sessions: SessionManager, artifactRoot: string): AirlockToolContext => {
  return {
    mode: "standard",
    policy: {
      mode: "standard",
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
    getEnabledTools: () => ["export_artifacts"]
  };
};

const addManagedSession = (
  sessions: SessionManager,
  options: {
    artifactDir: string;
    tracePath?: string;
    metadata?: Record<string, unknown>;
  }
): void => {
  sessions.add({
    session: {
      sessionId: sessionId("s1"),
      state: "running",
      mode: "standard",
      launchMode: "preset",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      artifactDir: options.artifactDir,
      selectedWindowId: windowId("w1"),
      ...(options.tracePath === undefined
        ? {}
        : {
            traceState: {
              active: false,
              tracePath: options.tracePath
            }
          }),
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
      launchMode: "preset",
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    }
  });
};

describe("exportArtifactsTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([...createdRoots].map((root) => rm(root, { recursive: true, force: true })));
    createdRoots.clear();
  });

  it("builds an artifact manifest with session diagnostics paths", async () => {
    const tempRoot = await createTempRoot();
    const artifactRoot = path.join(tempRoot, "airlock");
    const artifactPaths = await ensureArtifactRoot(artifactRoot);
    const allocation = await createSessionArtifactDir(artifactPaths, "s1");

    const screenshotsDir = path.join(allocation.sessionDir, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });
    const screenshotPath = path.join(screenshotsDir, "screen-1.png");
    await writeFile(screenshotPath, "png", "utf8");

    const tracePath = path.join(artifactPaths.tracesDir, "s1.zip");
    await writeFile(tracePath, "trace", "utf8");

    const sessionLogPath = path.join(artifactPaths.logsDir, "s1.log");
    await writeFile(sessionLogPath, "log", "utf8");

    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      artifactDir: allocation.sessionDir,
      tracePath,
      metadata: {
        launchPath: "playwright_launch",
        readinessCompletedSignals: ["windowCreated"]
      }
    });

    const driver = createDriver();
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([
      {
        level: "error",
        message: "boom",
        timestamp: "2026-01-01T00:00:01.000Z"
      }
    ]);

    const context = createContext(driver, sessions, artifactRoot);
    context.eventLog.record({
      toolName: "click",
      sessionId: "s1",
      params: { target: { ref: "e1" } },
      resultSummary: {
        status: "ok",
        message: "ok"
      },
      durationMs: 12,
      timestamp: "2026-01-01T00:00:02.000Z"
    });
    context.eventLog.record({
      toolName: "click",
      sessionId: "s2",
      params: { target: { ref: "e1" } },
      resultSummary: {
        status: "ok",
        message: "ok"
      },
      durationMs: 12,
      timestamp: "2026-01-01T00:00:03.000Z"
    });

    const result = await exportArtifactsTool.handler({ sessionId: "s1" }, context);

    expect(result.data.sessionId).toBe("s1");
    expect(result.data.exportedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(result.data.artifactPaths).toContain(screenshotPath);
    expect(result.data.artifactPaths).toContain(tracePath);
    expect(result.data.artifactPaths).toContain(sessionLogPath);
    expect(result.data.artifactPaths.every((candidate) => candidate.startsWith(artifactRoot))).toBe(true);

    const manifestPath = result.data.artifactPaths.find((candidate) => candidate.endsWith("manifest.json"));
    const eventLogExportPath = result.data.artifactPaths.find((candidate) => candidate.endsWith("event-log.json"));

    if (manifestPath === undefined || eventLogExportPath === undefined) {
      throw new Error("Expected export output files to be present.");
    }

    await expect(access(manifestPath)).resolves.toBeUndefined();

    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as { sessionId: string; artifactPaths: string[] };
    expect(manifest.sessionId).toBe("s1");
    expect(manifest.artifactPaths).toContain(screenshotPath);

    const exportedEventsRaw = await readFile(eventLogExportPath, "utf8");
    const exportedEvents = JSON.parse(exportedEventsRaw) as Array<{ sessionId?: string }>;
    expect(exportedEvents).toHaveLength(1);
    expect(exportedEvents[0]?.sessionId).toBe("s1");
  });

  it("continues export when console snapshot collection fails", async () => {
    const tempRoot = await createTempRoot();
    const artifactRoot = path.join(tempRoot, "airlock");
    const artifactPaths = await ensureArtifactRoot(artifactRoot);
    const allocation = await createSessionArtifactDir(artifactPaths, "s1");

    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      artifactDir: allocation.sessionDir
    });

    const driver = createDriver();
    vi.mocked(driver.getConsoleLogs).mockRejectedValue(new Error("console unavailable"));
    const context = createContext(driver, sessions, artifactRoot);

    const result = await exportArtifactsTool.handler({ sessionId: "s1" }, context);
    const consoleExportPath = result.data.artifactPaths.find((candidate) => candidate.endsWith("console-recent.json"));

    expect(result.meta?.warnings).toEqual(["Console snapshot unavailable: console unavailable"]);
    expect(result.meta?.suggestions).toEqual(["Re-run export_artifacts() after collecting missing diagnostics."]);
    expect(consoleExportPath).toBeDefined();
    if (consoleExportPath === undefined) {
      throw new Error("Expected console export path");
    }

    const exportedConsole = JSON.parse(await readFile(consoleExportPath, "utf8")) as unknown[];
    expect(exportedConsole).toEqual([]);
  });

  it("prefers explicit metadata.diagnostics payload for launch diagnostics export", async () => {
    const tempRoot = await createTempRoot();
    const artifactRoot = path.join(tempRoot, "airlock");
    const artifactPaths = await ensureArtifactRoot(artifactRoot);
    const allocation = await createSessionArtifactDir(artifactPaths, "s1");

    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      artifactDir: allocation.sessionDir,
      metadata: {
        diagnostics: {
          launchPath: "playwright_launch",
          marker: "preferred"
        },
        launchPath: "should-not-win"
      }
    });

    const driver = createDriver();
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([]);
    const context = createContext(driver, sessions, artifactRoot);

    const result = await exportArtifactsTool.handler({ sessionId: "s1" }, context);
    const launchDiagnosticsPath = result.data.artifactPaths.find((candidate) =>
      candidate.endsWith("launch-diagnostics.json")
    );

    expect(launchDiagnosticsPath).toBeDefined();
    if (launchDiagnosticsPath === undefined) {
      throw new Error("Expected launch diagnostics export");
    }

    const exportedDiagnostics = JSON.parse(await readFile(launchDiagnosticsPath, "utf8")) as Record<string, unknown>;
    expect(exportedDiagnostics).toEqual({
      launchPath: "playwright_launch",
      marker: "preferred"
    });
  });

  it("uses canonical trace path fallback when traceState is missing", async () => {
    const tempRoot = await createTempRoot();
    const artifactRoot = path.join(tempRoot, "airlock");
    const artifactPaths = await ensureArtifactRoot(artifactRoot);
    const allocation = await createSessionArtifactDir(artifactPaths, "s1");
    const canonicalTracePath = path.join(artifactPaths.tracesDir, "s1.zip");
    await writeFile(canonicalTracePath, "trace", "utf8");

    const sessions = new SessionManager({ ttlMs: 30_000 });
    addManagedSession(sessions, {
      artifactDir: allocation.sessionDir
    });

    const driver = createDriver();
    vi.mocked(driver.getConsoleLogs).mockResolvedValue([]);
    const context = createContext(driver, sessions, artifactRoot);

    const result = await exportArtifactsTool.handler({ sessionId: "s1" }, context);

    expect(result.data.artifactPaths).toContain(canonicalTracePath);
  });
});
