import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmationStore, createConfirmation } from "../confirmation/index.js";
import type { ElectronDriver } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { EventLog } from "../utils/event-log.js";
import type { Logger } from "../utils/logger.js";
import { confirmTool } from "./confirm.js";

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

const createContext = (store: ConfirmationStore): AirlockToolContext => {
  return {
    mode: "standard",
    policy: {
      mode: "standard",
      allowedOrigins: ["http://localhost"],
      artifactRoot: "/tmp/airlock-tests",
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
    driver: createDriver(),
    sessions: new SessionManager({ ttlMs: 30_000 }),
    confirmationStore: store,
    eventLog: new EventLog(),
    logger: createLogger(),
    getEnabledTools: () => ["confirm"]
  };
};

describe("confirmTool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a pending confirmation as confirmed and returns original params", async () => {
    const store = new ConfirmationStore({ ttlMs: 10_000, nowMs: () => 1_000 });
    const pending = createConfirmation(
      "server_reset",
      "Reset active sessions.",
      { sessionId: "s-1" },
      {
        id: "confirm-1",
        nowMs: () => 1_000,
        ttlMs: 10_000
      }
    );
    store.add(pending);
    const context = createContext(store);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const result = await confirmTool.handler({ confirmationId: "confirm-1" }, context);

    expect(result.data.ok).toBe(true);
    expect(result.data.toolName).toBe("server_reset");
    expect(result.data.params).toEqual({ sessionId: "s-1" });
    expect(result.data.confirmedAt).toBe(new Date(2_000).toISOString());
    expect(store.get("confirm-1")?.confirmedAt).toBe(2_000);
  });

  it("throws INVALID_INPUT when confirmation id is missing or expired", async () => {
    const context = createContext(new ConfirmationStore({ ttlMs: 10_000, nowMs: () => 1_000 }));

    await expect(confirmTool.handler({ confirmationId: "missing" }, context)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });
});
