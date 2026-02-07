import os from "node:os";
import process from "node:process";

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import type { SafetyPolicy } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";

const { createRequireMock } = vi.hoisted(() => {
  return {
    createRequireMock: vi.fn()
  };
});

vi.mock("node:module", () => {
  return {
    createRequire: createRequireMock
  };
});

type MockRequire = {
  (id: string): unknown;
  resolve: (id: string) => string;
};

const createMockRequire = (options: { playwrightVersion?: string; electronVersion?: string }): MockRequire => {
  const requireFn = ((id: string): unknown => {
    if (id === "playwright/package.json") {
      if (options.playwrightVersion === undefined) {
        throw new Error("playwright not found");
      }
      return { version: options.playwrightVersion };
    }

    if (id === "electron/package.json") {
      if (options.electronVersion === undefined) {
        throw new Error("electron not found");
      }
      return { version: options.electronVersion };
    }

    throw new Error(`Module not found: ${id}`);
  }) as MockRequire;

  requireFn.resolve = (id: string): string => {
    if (id === "electron") {
      if (options.electronVersion === undefined) {
        throw new Error("electron not found");
      }
      return "/tmp/node_modules/electron/index.js";
    }
    throw new Error(`Module not found: ${id}`);
  };

  return requireFn;
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

const createContext = (overrides: Partial<AirlockToolContext> = {}): AirlockToolContext => {
  const baseContext: AirlockToolContext = {
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
    driver: createDriver(),
    sessions: new SessionManager({ ttlMs: 30_000 }),
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["doctor", "capabilities"]
  };

  return {
    ...baseContext,
    ...overrides
  };
};

describe("doctorTool", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequireMock.mockReset();
  });

  it("returns node version", async () => {
    createRequireMock.mockReturnValue(createMockRequire({}) as unknown);
    const { doctorTool } = await import("./doctor.js");
    const result = await doctorTool.handler({}, createContext());

    expect(result.data.node.version).toBe(process.version);
  });

  it("returns platform info", async () => {
    createRequireMock.mockReturnValue(createMockRequire({}) as unknown);
    const { doctorTool } = await import("./doctor.js");
    const result = await doctorTool.handler({}, createContext());

    expect(result.data.platform).toEqual({
      platform: process.platform,
      arch: process.arch,
      osVersion: os.version(),
      release: os.release()
    });
  });

  it("detects Playwright installation via createRequire", async () => {
    createRequireMock.mockReturnValue(createMockRequire({ playwrightVersion: "1.99.0" }) as unknown);
    const { doctorTool } = await import("./doctor.js");
    const result = await doctorTool.handler({}, createContext());

    expect(result.data.playwright).toEqual({
      installed: true,
      version: "1.99.0",
      source: "installed"
    });
  });

  it("reports known issues when found", async () => {
    createRequireMock.mockReturnValue(createMockRequire({}) as unknown);
    const { doctorTool } = await import("./doctor.js");
    const result = await doctorTool.handler({}, createContext());

    expect(result.data.playwright.installed).toBe(false);
    expect(result.data.knownIssues.some((issue) => issue.includes("Playwright package is not installed"))).toBe(true);
  });

  it("returns mode from context", async () => {
    createRequireMock.mockReturnValue(createMockRequire({}) as unknown);
    const { doctorTool } = await import("./doctor.js");
    const result = await doctorTool.handler({}, createContext({ mode: "safe" }));

    expect(result.data.mode).toBe("safe");
  });
});
