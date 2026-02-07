import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";

import type { ElectronDriver } from "./driver/index.js";
import { SessionManager } from "./session-manager.js";
import {
  AIRLOCK_ERROR_CODES,
  SAFETY_MODES,
  createAirlockError,
  type AirlockError,
  type AirlockErrorCode,
  type SafetyMode,
  type SafetyPolicy,
  type ToolMeta,
  type ToolResult
} from "./types/index.js";
import { EventLog } from "./utils/event-log.js";
import { createLogger, type Logger } from "./utils/logger.js";

const FALLBACK_VERSION = "0.0.0-dev";
const SERVER_NAME = "airlock-electron";
const MODE_SET = new Set<SafetyMode>(SAFETY_MODES);
const ERROR_CODE_SET = new Set<AirlockErrorCode>(AIRLOCK_ERROR_CODES);

const PackageJsonSchema = z.object({
  version: z.string().min(1)
});

const ToolMetaSchema = z
  .object({
    suggestions: z.array(z.string().min(1)).readonly().optional(),
    warnings: z.array(z.string().min(1)).readonly().optional(),
    diagnostics: z.record(z.unknown()).optional()
  })
  .strict()
  .optional();

const toToolMeta = (value: z.infer<typeof ToolMetaSchema>): ToolMeta | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return {
    ...(value.suggestions === undefined ? {} : { suggestions: value.suggestions }),
    ...(value.warnings === undefined ? {} : { warnings: value.warnings }),
    ...(value.diagnostics === undefined ? {} : { diagnostics: value.diagnostics })
  };
};

export interface AirlockServerLimits {
  maxNodes: number;
  maxTextCharsPerNode: number;
}

export interface AirlockServerMetadata {
  name: string;
  version: string;
}

export interface AirlockToolContext {
  mode: SafetyMode;
  policy: SafetyPolicy;
  preset?: string;
  supportedPresets: readonly string[];
  limits: AirlockServerLimits;
  metadata: AirlockServerMetadata;
  startedAtMs: number;
  driver: ElectronDriver;
  sessions: SessionManager;
  eventLog: EventLog;
  logger: Logger;
  getEnabledTools: () => readonly string[];
}

export interface AirlockToolDefinition<TInputSchema extends AnyZodObject, TOutputSchema extends ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  allowedModes?: readonly SafetyMode[];
  annotations?: {
    readOnlyHint?: boolean;
  };
  handler: (
    input: z.infer<TInputSchema>,
    context: AirlockToolContext
  ) => Promise<ToolResult<z.infer<TOutputSchema>>> | ToolResult<z.infer<TOutputSchema>>;
}

export interface AirlockServerConfig {
  policy: SafetyPolicy;
  preset?: string;
  supportedPresets: readonly string[];
  limits: AirlockServerLimits;
  driver: ElectronDriver;
  logger?: Logger;
  eventLogMaxEntries?: number;
}

interface ToolSuccessEnvelope<TData> {
  [key: string]: unknown;
  ok: true;
  tool: string;
  result: ToolResult<TData>;
}

interface ToolErrorEnvelope {
  [key: string]: unknown;
  ok: false;
  tool: string;
  error: AirlockError;
}

type ToolEnvelope<TData> = ToolSuccessEnvelope<TData> | ToolErrorEnvelope;

const readPackageVersion = async (packagePath: string): Promise<string | null> => {
  try {
    const raw = await readFile(packagePath, "utf8");
    const parsed = PackageJsonSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    return parsed.data.version;
  } catch {
    return null;
  }
};

const resolveServerVersion = async (): Promise<string> => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(moduleDir, "..", "package.json"),
    path.resolve(moduleDir, "..", "..", "package.json")
  ];

  for (const candidate of candidates) {
    const version = await readPackageVersion(candidate);
    if (version !== null) {
      return version;
    }
  }

  return FALLBACK_VERSION;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const normalizeError = (error: unknown): AirlockError => {
  if (error instanceof z.ZodError) {
    return createAirlockError("INVALID_INPUT", "Input validation failed.", false, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message
      }))
    });
  }

  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    const candidateCode = error.code as AirlockErrorCode;
    const normalizedCode = ERROR_CODE_SET.has(candidateCode) ? candidateCode : "INTERNAL_ERROR";
    return createAirlockError(
      normalizedCode,
      error.message,
      typeof error.retriable === "boolean" ? error.retriable : false,
      isRecord(error.details) ? error.details : undefined
    );
  }

  if (error instanceof Error) {
    return createAirlockError("INTERNAL_ERROR", error.message, false);
  }

  return createAirlockError("INTERNAL_ERROR", "Unexpected server error.", false, {
    value: String(error)
  });
};

const envelopeText = (envelope: ToolEnvelope<unknown>): string => {
  return JSON.stringify(envelope, null, 2);
};

const extractSessionId = (input: unknown): string | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const candidate = input.sessionId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
};

const extractWindowId = (input: unknown): string | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const candidate = input.windowId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
};

const toMcpSuccess = <TData>(toolName: string, result: ToolResult<TData>) => {
  const envelope: ToolSuccessEnvelope<TData> = {
    ok: true,
    tool: toolName,
    result
  };

  return {
    content: [
      {
        type: "text" as const,
        text: envelopeText(envelope)
      }
    ],
    structuredContent: envelope
  };
};

const toMcpError = (toolName: string, error: AirlockError) => {
  const envelope: ToolErrorEnvelope = {
    ok: false,
    tool: toolName,
    error
  };

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: envelopeText(envelope)
      }
    ],
    structuredContent: envelope
  };
};

export const defineAirlockTool = <TInputSchema extends AnyZodObject, TOutputSchema extends ZodTypeAny>(
  definition: AirlockToolDefinition<TInputSchema, TOutputSchema>
): AirlockToolDefinition<TInputSchema, TOutputSchema> => {
  return definition;
};

export class AirlockServer {
  private readonly mcp: McpServer;
  private readonly logger: Logger;
  private readonly sessionManager: SessionManager;
  private readonly eventLog: EventLog;
  private readonly policy: SafetyPolicy;
  private readonly preset: string | undefined;
  private readonly supportedPresets: readonly string[];
  private readonly limits: AirlockServerLimits;
  private readonly driver: ElectronDriver;
  private readonly startedAtMs: number;
  private readonly metadata: AirlockServerMetadata;
  private readonly toolDefinitions: Map<string, AirlockToolDefinition<any, any>>;

  private constructor(config: AirlockServerConfig, version: string) {
    this.policy = config.policy;
    this.preset = config.preset;
    this.supportedPresets = [...config.supportedPresets];
    this.limits = config.limits;
    this.driver = config.driver;
    this.logger = config.logger ?? createLogger({ scope: "airlock-server" });
    this.startedAtMs = Date.now();
    this.metadata = {
      name: SERVER_NAME,
      version
    };
    this.toolDefinitions = new Map<string, AirlockToolDefinition<any, any>>();
    this.sessionManager = new SessionManager({
      ttlMs: config.policy.maxSessionTtlMs
    });
    this.eventLog = new EventLog(config.eventLogMaxEntries);
    this.mcp = new McpServer({
      name: this.metadata.name,
      version: this.metadata.version
    });
  }

  public static async create(config: AirlockServerConfig): Promise<AirlockServer> {
    const version = await resolveServerVersion();
    return new AirlockServer(config, version);
  }

  public registerTools(definitions: readonly AirlockToolDefinition<any, any>[]): void {
    for (const definition of definitions) {
      this.registerTool(definition);
    }
  }

  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    this.logger.info("Airlock server connected on stdio transport.", {
      mode: this.policy.mode,
      preset: this.preset,
      toolCount: this.toolDefinitions.size
    });
  }

  public async close(): Promise<void> {
    const resetErrors = await this.sessionManager.reset("server_shutdown");
    if (resetErrors.length > 0) {
      this.logger.warn("Session cleanup had failures during shutdown.", {
        failures: resetErrors
      });
    }

    const closableServer = this.mcp as McpServer & {
      close?: () => Promise<void> | void;
    };
    if (typeof closableServer.close === "function") {
      await closableServer.close();
    }
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getEventLog(): EventLog {
    return this.eventLog;
  }

  public getMetadata(): AirlockServerMetadata {
    return this.metadata;
  }

  public getMode(): SafetyMode {
    return this.policy.mode;
  }

  public getStartedAtMs(): number {
    return this.startedAtMs;
  }

  public getEnabledToolNames(): readonly string[] {
    return [...this.toolDefinitions.values()]
      .filter((definition) => this.isToolAllowedInMode(definition, this.policy.mode))
      .map((definition) => definition.name)
      .sort((left, right) => left.localeCompare(right));
  }

  private registerTool(definition: AirlockToolDefinition<any, any>): void {
    this.toolDefinitions.set(definition.name, definition);

    this.mcp.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema.shape,
        annotations: {
          readOnlyHint: definition.annotations?.readOnlyHint ?? false
        }
      },
      async (rawInput: unknown) => {
        const startedAt = Date.now();
        const inputSessionId = extractSessionId(rawInput);
        const inputWindowId = extractWindowId(rawInput);

        try {
          await this.cleanupStaleSessions();

          if (!this.isToolAllowedInMode(definition, this.policy.mode)) {
            const modeError = createAirlockError(
              "MODE_RESTRICTED",
              `Tool "${definition.name}" is not available in mode "${this.policy.mode}".`,
              false,
              {
                mode: this.policy.mode,
                allowedModes: definition.allowedModes ?? SAFETY_MODES
              }
            );
            this.recordToolEvent(definition.name, rawInput, inputSessionId, inputWindowId, startedAt, {
              status: "error",
              message: modeError.message,
              errorCode: modeError.code
            });
            return toMcpError(definition.name, modeError);
          }

          const parsedInput = definition.inputSchema.safeParse(rawInput);
          if (!parsedInput.success) {
            const inputError = createAirlockError("INVALID_INPUT", "Input validation failed.", false, {
              issues: parsedInput.error.issues.map((issue: z.ZodIssue) => ({
                path: issue.path.join("."),
                code: issue.code,
                message: issue.message
              }))
            });
            this.recordToolEvent(definition.name, rawInput, inputSessionId, inputWindowId, startedAt, {
              status: "error",
              message: inputError.message,
              errorCode: inputError.code
            });
            return toMcpError(definition.name, inputError);
          }

          if (inputSessionId !== undefined) {
            this.sessionManager.touch(inputSessionId);
          }

          const context = this.buildToolContext();
          const handlerResult = await definition.handler(parsedInput.data, context);
          const parsedOutput = definition.outputSchema.safeParse(handlerResult.data);
          if (!parsedOutput.success) {
            const outputError = createAirlockError(
              "INTERNAL_ERROR",
              `Tool "${definition.name}" produced invalid output.`,
              false,
              {
                issues: parsedOutput.error.issues.map((issue: z.ZodIssue) => ({
                  path: issue.path.join("."),
                  code: issue.code,
                  message: issue.message
                }))
              }
            );
            this.recordToolEvent(definition.name, rawInput, inputSessionId, inputWindowId, startedAt, {
              status: "error",
              message: outputError.message,
              errorCode: outputError.code
            });
            return toMcpError(definition.name, outputError);
          }

          const parsedMeta = ToolMetaSchema.safeParse(handlerResult.meta);
          const normalizedMeta = parsedMeta.success ? toToolMeta(parsedMeta.data) : undefined;
          const result =
            normalizedMeta !== undefined
              ? {
                  data: parsedOutput.data,
                  meta: normalizedMeta
                }
              : {
                  data: parsedOutput.data
                };

          this.recordToolEvent(definition.name, rawInput, inputSessionId, inputWindowId, startedAt, {
            status: "ok",
            message: "ok"
          });
          return toMcpSuccess(definition.name, result);
        } catch (error: unknown) {
          const normalizedError = normalizeError(error);
          this.recordToolEvent(definition.name, rawInput, inputSessionId, inputWindowId, startedAt, {
            status: "error",
            message: normalizedError.message,
            errorCode: normalizedError.code
          });
          return toMcpError(definition.name, normalizedError);
        }
      }
    );
  }

  private buildToolContext(): AirlockToolContext {
    const baseContext = {
      mode: this.policy.mode,
      policy: this.policy,
      supportedPresets: this.supportedPresets,
      limits: this.limits,
      metadata: this.metadata,
      startedAtMs: this.startedAtMs,
      driver: this.driver,
      sessions: this.sessionManager,
      eventLog: this.eventLog,
      logger: this.logger,
      getEnabledTools: () => this.getEnabledToolNames()
    };
    return this.preset === undefined
      ? baseContext
      : {
          ...baseContext,
          preset: this.preset
        };
  }

  private isToolAllowedInMode(definition: AirlockToolDefinition<AnyZodObject, ZodTypeAny>, mode: SafetyMode): boolean {
    if (!MODE_SET.has(mode)) {
      return false;
    }

    if (definition.allowedModes === undefined) {
      return true;
    }

    return definition.allowedModes.includes(mode);
  }

  private async cleanupStaleSessions(): Promise<void> {
    const cleanupErrors = await this.sessionManager.cleanupStale();
    if (cleanupErrors.length === 0) {
      return;
    }

    throw createAirlockError("INTERNAL_ERROR", "Stale session cleanup failed for one or more sessions.", true, {
      failures: cleanupErrors
    });
  }

  private recordToolEvent(
    toolName: string,
    params: unknown,
    sessionId: string | undefined,
    windowId: string | undefined,
    startedAtMs: number,
    summary: { status: "ok" | "error"; message: string; errorCode?: AirlockErrorCode }
  ): void {
    const durationMs = Date.now() - startedAtMs;
    const baseRecord = {
      toolName,
      params,
      durationMs,
      resultSummary:
        summary.errorCode === undefined
          ? {
              status: summary.status,
              message: summary.message
            }
          : {
              status: summary.status,
              message: summary.message,
              errorCode: summary.errorCode
            }
    };
    const sessionPart = sessionId === undefined ? {} : { sessionId };
    const windowPart = windowId === undefined ? {} : { windowId };
    this.eventLog.record({
      ...baseRecord,
      ...sessionPart,
      ...windowPart
    });
  }
}
