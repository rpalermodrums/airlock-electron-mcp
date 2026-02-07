import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createLogger, type Logger } from "./logger.js";

const parseLogLine = (value: unknown) => {
  const line = typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString("utf8");
  return JSON.parse(line.trim()) as {
    timestamp: string;
    level: string;
    scope: string;
    message: string;
    context?: Record<string, unknown>;
  };
};

describe("logger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns an object with debug/info/warn/error/child methods", () => {
    const logger = createLogger();

    const typedLogger: Logger = logger;

    expect(typeof typedLogger.debug).toBe("function");
    expect(typeof typedLogger.info).toBe("function");
    expect(typeof typedLogger.warn).toBe("function");
    expect(typeof typedLogger.error).toBe("function");
    expect(typeof typedLogger.child).toBe("function");
  });

  it("creates scoped child loggers", () => {
    const writes: string[] = [];
    const stream = {
      write: (chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as unknown as NodeJS.WritableStream;
    const logger = createLogger({
      scope: "root",
      level: "debug",
      context: { requestId: "req-1" },
      stream
    });

    const child = logger.child("worker", { sessionId: "s-1" });
    child.warn("something happened", { retry: false });

    expect(writes).toHaveLength(1);
    const entry = parseLogLine(writes[0]);

    expect(entry).toMatchObject({
      timestamp: "2024-02-01T12:00:00.000Z",
      level: "warn",
      scope: "root:worker",
      message: "something happened",
      context: {
        requestId: "req-1",
        sessionId: "s-1",
        retry: false
      }
    });
  });

  it("writes output to stderr by default", () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as unknown as typeof process.stderr.write);
    const logger = createLogger({ level: "debug" });

    logger.info("hello stderr", { sessionId: "s-2" });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [line] = writeSpy.mock.calls[0] ?? [];
    const entry = parseLogLine(line);
    expect(entry.message).toBe("hello stderr");
    expect(entry.level).toBe("info");
  });

  it("emits structured JSON log lines", () => {
    const writes: string[] = [];
    const stream = {
      write: (chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as unknown as NodeJS.WritableStream;
    const logger = createLogger({
      scope: "airlock",
      level: "debug",
      stream
    });

    logger.debug("json check", { attempt: 1 });

    expect(writes).toHaveLength(1);
    const parsed = parseLogLine(writes[0]);

    expect(parsed).toEqual({
      timestamp: "2024-02-01T12:00:00.000Z",
      level: "debug",
      scope: "airlock",
      message: "json check",
      context: { attempt: 1 }
    });
  });
});
