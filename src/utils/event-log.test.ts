import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { EventLog } from "./event-log.js";

const baseResultSummary = {
  status: "ok" as const,
  message: "done"
};

describe("event log", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records events", () => {
    const log = new EventLog();
    const recorded = log.record({
      toolName: "snapshot",
      sessionId: "session-1",
      windowId: "window-1",
      params: { depth: 2 },
      resultSummary: baseResultSummary,
      durationMs: 15,
      timestamp: "2024-01-01T00:00:00.000Z"
    });

    expect(recorded).toEqual({
      timestamp: "2024-01-01T00:00:00.000Z",
      toolName: "snapshot",
      sessionId: "session-1",
      windowId: "window-1",
      params: { depth: 2 },
      resultSummary: baseResultSummary,
      durationMs: 15
    });
    expect(log.size()).toBe(1);
  });

  it("enforces ring-buffer capacity with maxEntries", () => {
    const log = new EventLog(2);

    log.record({
      toolName: "first",
      params: {},
      resultSummary: baseResultSummary,
      durationMs: 1,
      timestamp: "2024-01-01T00:00:00.000Z"
    });
    log.record({
      toolName: "second",
      params: {},
      resultSummary: baseResultSummary,
      durationMs: 2,
      timestamp: "2024-01-01T00:00:01.000Z"
    });
    log.record({
      toolName: "third",
      params: {},
      resultSummary: baseResultSummary,
      durationMs: 3,
      timestamp: "2024-01-01T00:00:02.000Z"
    });

    expect(log.size()).toBe(2);
    expect(log.getEntries().map((entry) => entry.toolName)).toEqual(["second", "third"]);
  });

  it("redacts sensitive keys like password/token/secret/cookie/auth", () => {
    const log = new EventLog();
    const recorded = log.record({
      toolName: "login",
      params: {
        username: "alice",
        password: "pw",
        token: "token-value",
        secret: "secret-value",
        cookie: "cookie-value",
        authHeader: "Bearer abc",
        nested: { api_key: "k", value: "hidden", keep: "ok" }
      },
      resultSummary: baseResultSummary,
      durationMs: 11,
      timestamp: "2024-01-01T00:00:00.000Z"
    });

    expect(recorded.params).toEqual({
      username: "alice",
      password: "[REDACTED]",
      token: "[REDACTED]",
      secret: "[REDACTED]",
      cookie: "[REDACTED]",
      authHeader: "[REDACTED]",
      nested: { api_key: "[REDACTED]", value: "[REDACTED]", keep: "ok" }
    });
  });

  it("returns all entries with getEntries()", () => {
    const log = new EventLog(10);
    const records = [
      { name: "a", timestamp: "2024-01-01T00:00:00.000Z" },
      { name: "b", timestamp: "2024-01-01T00:00:01.000Z" },
      { name: "c", timestamp: "2024-01-01T00:00:02.000Z" }
    ] as const;

    for (const [index, record] of records.entries()) {
      log.record({
        toolName: record.name,
        params: { index },
        resultSummary: baseResultSummary,
        durationMs: index + 1,
        timestamp: record.timestamp
      });
    }

    expect(log.getEntries().map((entry) => entry.toolName)).toEqual(["a", "b", "c"]);
  });

  it("supports additional regex-based redaction patterns", () => {
    const log = new EventLog();
    log.addRedactionPatterns(["sk-[a-zA-Z0-9]{10,}"]);

    const recorded = log.record({
      toolName: "token_test",
      params: {
        message: "token sk-abcDEF123456 should not be visible"
      },
      resultSummary: baseResultSummary,
      durationMs: 7,
      timestamp: "2024-01-01T00:00:00.000Z"
    });

    expect(recorded.params).toEqual({
      message: "token [REDACTED] should not be visible"
    });
  });

  it("clears entries", () => {
    const log = new EventLog();

    log.record({
      toolName: "tool",
      params: {},
      resultSummary: baseResultSummary,
      durationMs: 5
    });
    expect(log.size()).toBe(1);

    log.clear();

    expect(log.size()).toBe(0);
    expect(log.getEntries()).toEqual([]);
    expect(log.list()).toEqual([]);
  });
});
