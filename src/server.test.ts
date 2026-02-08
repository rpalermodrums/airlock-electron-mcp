import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

import type { ElectronDriver } from "./driver/index.js";
import { AirlockServer, defineAirlockTool } from "./server.js";
import type { ResolvedPolicy, SafetyMode } from "./types/index.js";
import { confirmTool } from "./tools/confirm.js";

const {
  mcpConstructorMock,
  registerToolMock,
  connectMock,
  closeMock,
  stdioTransportConstructorMock,
  createLoggerMock,
  defaultLogger
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };
  logger.child.mockReturnValue(logger);

  return {
    mcpConstructorMock: vi.fn(),
    registerToolMock: vi.fn(),
    connectMock: vi.fn(),
    closeMock: vi.fn(),
    stdioTransportConstructorMock: vi.fn(),
    createLoggerMock: vi.fn(() => logger),
    defaultLogger: logger
  };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    public registerTool = registerToolMock;
    public connect = connectMock;
    public close = closeMock;

    public constructor(config: unknown) {
      mcpConstructorMock(config);
    }
  }

  return {
    McpServer: MockMcpServer
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class MockStdioServerTransport {
    public constructor() {
      stdioTransportConstructorMock();
    }
  }

  return {
    StdioServerTransport: MockStdioServerTransport
  };
});

vi.mock("./utils/logger.js", () => {
  return {
    createLogger: createLoggerMock
  };
});

const createPolicy = (mode: SafetyMode, overrides: Partial<ResolvedPolicy> = {}): ResolvedPolicy => {
  return {
    mode,
    allowedOrigins: ["http://localhost"],
    artifactRoot: "/tmp/airlock-tests",
    maxSessionTtlMs: 30_000,
    ...overrides
  };
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

const createServer = async (
  mode: SafetyMode = "standard",
  policyOverrides: Partial<ResolvedPolicy> = {}
): Promise<AirlockServer> => {
  return AirlockServer.create({
    policy: createPolicy(mode, policyOverrides),
    supportedPresets: ["electron-vite"],
    limits: {
      maxNodes: 250,
      maxTextCharsPerNode: 80
    },
    driver: createDriver()
  });
};

const getRegisteredHandler = (toolName: string): ((rawInput: unknown) => Promise<unknown>) => {
  const matchedCall = registerToolMock.mock.calls.find((call) => call[0] === toolName);
  if (matchedCall === undefined) {
    throw new Error(`Tool "${toolName}" was not registered.`);
  }

  return matchedCall[2] as (rawInput: unknown) => Promise<unknown>;
};

describe("server", () => {
  beforeEach(() => {
    mcpConstructorMock.mockClear();
    registerToolMock.mockClear();
    connectMock.mockClear();
    closeMock.mockClear();
    stdioTransportConstructorMock.mockClear();
    createLoggerMock.mockClear();
    defaultLogger.debug.mockClear();
    defaultLogger.info.mockClear();
    defaultLogger.warn.mockClear();
    defaultLogger.error.mockClear();
    defaultLogger.child.mockClear();
    defaultLogger.child.mockReturnValue(defaultLogger);
  });

  it("defineAirlockTool() creates a valid tool definition", () => {
    const toolDefinition = defineAirlockTool({
      name: "unit_test_tool",
      title: "Unit Test Tool",
      description: "A unit test tool.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handler: () => ({
        data: { ok: true as const }
      })
    });

    expect(toolDefinition.name).toBe("unit_test_tool");
    expect(toolDefinition.title).toBe("Unit Test Tool");
    expect(toolDefinition.inputSchema.safeParse({}).success).toBe(true);
    expect(toolDefinition.outputSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it("rejects trusted-only tools when running in safe mode", async () => {
    const server = await createServer("safe");
    const gatedTool = defineAirlockTool({
      name: "trusted_only_tool",
      title: "Trusted Only",
      description: "Only available in trusted mode.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      allowedModes: ["trusted"] as const,
      handler: async () => ({
        data: { ok: true }
      })
    });

    server.registerTools([gatedTool]);
    const toolHandler = getRegisteredHandler("trusted_only_tool");
    const result = (await toolHandler({})) as {
      isError: boolean;
      structuredContent: {
        ok: boolean;
        error: { code: string };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error.code).toBe("MODE_RESTRICTED");
  });

  it("rejects tools disabled by policy", async () => {
    const server = await createServer("standard", {
      tools: {
        disabled: ["disabled_tool"],
        requireConfirmation: []
      }
    });
    const disabledTool = defineAirlockTool({
      name: "disabled_tool",
      title: "Disabled Tool",
      description: "Blocked by policy.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({
        data: { ok: true }
      })
    });

    server.registerTools([disabledTool]);
    const handler = getRegisteredHandler("disabled_tool");
    const result = (await handler({})) as {
      isError: boolean;
      structuredContent: {
        ok: boolean;
        error: { code: string };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error.code).toBe("POLICY_VIOLATION");
  });

  it("returns a confirmation gate for tools that require confirmation by policy", async () => {
    const server = await createServer("standard", {
      tools: {
        disabled: [],
        requireConfirmation: ["confirm_tool"]
      }
    });
    const confirmTool = defineAirlockTool({
      name: "confirm_tool",
      title: "Confirm Tool",
      description: "Requires confirmation.",
      inputSchema: z
        .object({
          value: z.string().min(1)
        })
        .strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({
        data: { ok: true }
      })
    });

    server.registerTools([confirmTool]);
    const handler = getRegisteredHandler("confirm_tool");
    const result = (await handler({ value: "run" })) as {
      structuredContent: {
        ok: boolean;
        requiresConfirmation?: boolean;
        confirmationId?: string;
        description?: string;
      };
    };

    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.requiresConfirmation).toBe(true);
    expect(result.structuredContent.confirmationId).toEqual(expect.any(String));
    expect(result.structuredContent.description).toContain("requires confirmation");
  });

  it("supports full confirmation flow: gate -> confirm -> re-invoke", async () => {
    const server = await createServer("standard", {
      tools: {
        disabled: [],
        requireConfirmation: ["dangerous_tool"]
      }
    });
    const dangerousTool = defineAirlockTool({
      name: "dangerous_tool",
      title: "Dangerous Tool",
      description: "A gated tool.",
      inputSchema: z
        .object({
          value: z.string().min(1)
        })
        .strict(),
      outputSchema: z
        .object({
          ok: z.boolean(),
          value: z.string()
        })
        .strict(),
      handler: async (input) => ({
        data: { ok: true, value: input.value }
      })
    });

    server.registerTools([dangerousTool, confirmTool]);

    const dangerousHandler = getRegisteredHandler("dangerous_tool");
    const confirmHandler = getRegisteredHandler("confirm");
    const firstResponse = (await dangerousHandler({ value: "run" })) as {
      structuredContent: {
        ok: boolean;
        requiresConfirmation?: boolean;
        confirmationId?: string;
      };
    };
    const confirmationId = firstResponse.structuredContent.confirmationId;

    expect(firstResponse.structuredContent.ok).toBe(false);
    expect(firstResponse.structuredContent.requiresConfirmation).toBe(true);
    expect(confirmationId).toEqual(expect.any(String));

    const confirmResponse = (await confirmHandler({ confirmationId })) as {
      structuredContent: {
        ok: boolean;
        result: {
          data: {
            ok: boolean;
            toolName: string;
            params: unknown;
          };
        };
      };
    };

    expect(confirmResponse.structuredContent.ok).toBe(true);
    expect(confirmResponse.structuredContent.result.data.ok).toBe(true);
    expect(confirmResponse.structuredContent.result.data.toolName).toBe("dangerous_tool");
    expect(confirmResponse.structuredContent.result.data.params).toEqual({ value: "run" });

    const finalResponse = (await dangerousHandler({ value: "run", confirmationId })) as {
      structuredContent: {
        ok: boolean;
        result: {
          data: { ok: boolean; value: string };
        };
      };
    };

    expect(finalResponse.structuredContent.ok).toBe(true);
    expect(finalResponse.structuredContent.result.data).toEqual({
      ok: true,
      value: "run"
    });
  });

  it("applies policy redaction patterns to server event logs", async () => {
    const server = await createServer("standard", {
      redactionPatterns: ["ghp_[a-zA-Z0-9]{36}"]
    });
    const redactTool = defineAirlockTool({
      name: "redact_tool",
      title: "Redact Tool",
      description: "Records input parameters.",
      inputSchema: z
        .object({
          message: z.string().min(1)
        })
        .strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({
        data: { ok: true }
      })
    });

    server.registerTools([redactTool]);
    const handler = getRegisteredHandler("redact_tool");
    await handler({ message: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 secret" });

    const [event] = server.getEventLog().list(1);
    expect(event?.params).toEqual({
      message: "token [REDACTED] secret"
    });
  });

  it("rejects invalid tool input with INVALID_INPUT", async () => {
    const server = await createServer("standard");
    const validationTool = defineAirlockTool({
      name: "validation_tool",
      title: "Validation Tool",
      description: "Input validation test.",
      inputSchema: z
        .object({
          requiredField: z.string().min(1)
        })
        .strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      handler: async () => ({
        data: { accepted: true }
      })
    });

    server.registerTools([validationTool]);
    const toolHandler = getRegisteredHandler("validation_tool");
    const result = (await toolHandler({})) as {
      isError: boolean;
      structuredContent: {
        ok: boolean;
        error: { code: string; details?: { issues?: readonly unknown[] } };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(result.structuredContent.error.details?.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it("wraps tool output in ToolResult<T> with data and meta", async () => {
    const server = await createServer("standard");
    const resultTool = defineAirlockTool({
      name: "result_tool",
      title: "Result Tool",
      description: "Result envelope test.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ value: z.number().int() }).strict(),
      handler: async () => ({
        data: { value: 42 },
        meta: {
          suggestions: ["Use another tool next."]
        }
      })
    });

    server.registerTools([resultTool]);
    const toolHandler = getRegisteredHandler("result_tool");
    const result = (await toolHandler({})) as {
      structuredContent: {
        ok: boolean;
        result: {
          data: { value: number };
          meta?: { suggestions?: readonly string[] };
        };
      };
    };

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.result.data).toEqual({ value: 42 });
    expect(result.structuredContent.result.meta?.suggestions).toEqual(["Use another tool next."]);
  });

  it("normalizes unknown errors as AirlockError", async () => {
    const server = await createServer("standard");
    const throwingTool = defineAirlockTool({
      name: "throwing_tool",
      title: "Throwing Tool",
      description: "Throws unknown values.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => {
        throw 42;
      }
    });

    server.registerTools([throwingTool]);
    const toolHandler = getRegisteredHandler("throwing_tool");
    const result = (await toolHandler({})) as {
      isError: boolean;
      structuredContent: {
        ok: boolean;
        error: {
          code: string;
          message: string;
          details?: { value?: string };
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error.code).toBe("INTERNAL_ERROR");
    expect(result.structuredContent.error.message).toBe("Unexpected server error.");
    expect(result.structuredContent.error.details?.value).toBe("42");
  });

  it("loads package version for server metadata", async () => {
    const server = await createServer("standard");
    const packagePath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };

    expect(server.getMetadata().name).toBe("airlock-electron");
    expect(server.getMetadata().version).toBe(packageJson.version);
  });

  it("creates logger and event log instances", async () => {
    const server = await createServer("standard");
    const pingTool = defineAirlockTool({
      name: "ping_tool",
      title: "Ping Tool",
      description: "Records an event.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ pong: z.literal(true) }).strict(),
      handler: async () => ({
        data: { pong: true as const }
      })
    });

    server.registerTools([pingTool]);
    const handler = getRegisteredHandler("ping_tool");

    expect(createLoggerMock).toHaveBeenCalledTimes(1);
    expect(server.getEventLog().size()).toBe(0);

    await handler({});
    expect(server.getEventLog().size()).toBe(1);

    await server.startStdio();
    expect(stdioTransportConstructorMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(defaultLogger.info).toHaveBeenCalledTimes(1);

    await server.close();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("defines tools without throwing for valid inputs", () => {
    const definition = defineAirlockTool({
      name: "noop_tool",
      title: "Noop",
      description: "Noop.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({
        data: { ok: true }
      })
    });

    expect(definition.name).toBe("noop_tool");
  });
});
