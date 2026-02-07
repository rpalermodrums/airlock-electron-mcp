import type { AirlockErrorCode } from "../types/index.js";

const REDACTED = "[REDACTED]";
const DEFAULT_MAX_ENTRIES = 2000;
const REDACT_KEYS = [
  "password",
  "passphrase",
  "auth",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
  "text",
  "value"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const shouldRedactKey = (key: string): boolean => {
  const loweredKey = key.toLowerCase();
  return REDACT_KEYS.some((candidate) => loweredKey.includes(candidate));
};

const redactValue = (value: unknown, depth: number): unknown => {
  if (depth > 6) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redactedEntries = Object.entries(value).map(([key, entryValue]) => {
    if (shouldRedactKey(key)) {
      return [key, REDACTED] as const;
    }

    return [key, redactValue(entryValue, depth + 1)] as const;
  });

  return Object.fromEntries(redactedEntries);
};

export interface EventResultSummary {
  status: "ok" | "error";
  message: string;
  errorCode?: AirlockErrorCode;
}

export interface ToolInvocationEvent {
  timestamp: string;
  toolName: string;
  sessionId?: string;
  windowId?: string;
  params: unknown;
  resultSummary: EventResultSummary;
  durationMs: number;
}

export interface EventLogRecordInput {
  toolName: string;
  sessionId?: string;
  windowId?: string;
  params: unknown;
  resultSummary: EventResultSummary;
  durationMs: number;
  timestamp?: string;
}

export class EventLog {
  private readonly maxEntries: number;
  private readonly events: ToolInvocationEvent[];

  public constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.events = [];
  }

  public record(input: EventLogRecordInput): ToolInvocationEvent {
    const baseEvent = {
      timestamp: input.timestamp ?? new Date().toISOString(),
      toolName: input.toolName,
      params: redactValue(input.params, 0),
      resultSummary: input.resultSummary,
      durationMs: input.durationMs
    };
    const sessionPart = input.sessionId === undefined ? {} : { sessionId: input.sessionId };
    const windowPart = input.windowId === undefined ? {} : { windowId: input.windowId };
    const event: ToolInvocationEvent = {
      ...baseEvent,
      ...sessionPart,
      ...windowPart
    };

    this.events.push(event);
    if (this.events.length > this.maxEntries) {
      this.events.splice(0, this.events.length - this.maxEntries);
    }

    return event;
  }

  public list(limit: number = 100): readonly ToolInvocationEvent[] {
    const boundedLimit = Math.max(1, limit);
    return this.events.slice(-boundedLimit);
  }

  public getEntries(): readonly ToolInvocationEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events.length = 0;
  }

  public size(): number {
    return this.events.length;
  }
}
