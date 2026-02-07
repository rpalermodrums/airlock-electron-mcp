import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

import type { ElectronDriver } from "./driver/index.js";
import { AirlockServer, defineAirlockTool } from "./server.js";
import type { SafetyMode, SafetyPolicy } from "./types/index.js";

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

const createPolicy = (mode: SafetyMode): SafetyPolicy => {
  return {
    mode,
    allowedOrigins: ["http://localhost"],
    artifactRoot: "/tmp/airlock-tests",
    maxSessionTtlMs: 30_000
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

const createServer = async (mode: SafetyMode = "standard"): Promise<AirlockServer> => {
  return AirlockServer.create({
    policy: createPolicy(mode),
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
