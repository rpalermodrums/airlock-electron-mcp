import process from "node:process";

import { describe, it, expect, vi } from "vitest";

import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import type { SafetyPolicy } from "../types/index.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { capabilitiesTool } from "./capabilities.js";

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
    preset: "electron-vite",
    supportedPresets: ["electron-vite", "custom"],
    limits: {
      maxNodes: 250,
      maxTextCharsPerNode: 80
    },
    metadata: {
      name: "airlock-electron",
      version: "0.1.0"
    },
    startedAtMs: 1_700_000_000_000,
    driver: createDriver(),
    sessions: new SessionManager({ ttlMs: 30_000 }),
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["capabilities", "doctor"]
  };

  return {
    ...baseContext,
    ...overrides
  };
};

describe("capabilitiesTool", () => {
  it("returns correct mode from context", async () => {
    const context = createContext({ mode: "trusted" });
    const result = await capabilitiesTool.handler({}, context);

    expect(result.data.mode).toBe("trusted");
  });

  it("returns enabledTools list", async () => {
    const context = createContext({
      getEnabledTools: () => ["snapshot_interactive", "snapshot_query", "wait_for_text"]
    });
    const result = await capabilitiesTool.handler({}, context);

    expect(result.data.enabledTools).toEqual(["snapshot_interactive", "snapshot_query", "wait_for_text"]);
  });

  it("returns preset support info", async () => {
    const context = createContext({
      preset: "electron-vite",
      supportedPresets: ["electron-vite", "my-preset"]
    });
    const result = await capabilitiesTool.handler({}, context);

    expect(result.data.presetSupport).toEqual({
      activePreset: "electron-vite",
      supportedPresets: ["electron-vite", "my-preset"]
    });
  });

  it("returns limits (maxNodes, maxTextCharsPerNode)", async () => {
    const context = createContext({
      limits: {
        maxNodes: 512,
        maxTextCharsPerNode: 160
      }
    });
    const result = await capabilitiesTool.handler({}, context);

    expect(result.data.limits).toEqual({
      maxNodes: 512,
      maxTextCharsPerNode: 160
    });
  });

  it("returns version info with server name and node version", async () => {
    const context = createContext({
      metadata: {
        name: "airlock-electron",
        version: "9.9.9"
      }
    });
    const result = await capabilitiesTool.handler({}, context);

    expect(result.data.version).toEqual({
      name: "airlock-electron",
      version: "9.9.9",
      node: process.version,
      transport: "stdio"
    });
  });
});
