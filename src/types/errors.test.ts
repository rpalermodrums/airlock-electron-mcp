import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AIRLOCK_ERROR_CODES, createAirlockError, type AirlockError } from "./errors.js";

describe("error types", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an AirlockError for every known error code", () => {
    for (const code of AIRLOCK_ERROR_CODES) {
      const result = createAirlockError(code, `message for ${code}`);

      expect(result.code).toBe(code);
      expect(result.message).toBe(`message for ${code}`);
      expect(result.retriable).toBe(false);
    }
  });

  it("defaults retriable to false", () => {
    const error = createAirlockError("INTERNAL_ERROR", "unexpected");

    expect(error.retriable).toBe(false);
  });

  it("includes custom details when provided", () => {
    const details = { sessionId: "s-1", reason: "bad_input", retryAfterMs: 500 };
    const error = createAirlockError("INVALID_INPUT", "validation failed", true, details);

    expect(error).toEqual({
      code: "INVALID_INPUT",
      message: "validation failed",
      retriable: true,
      details
    });
  });

  it("matches the AirlockError structure", () => {
    const error: AirlockError = createAirlockError("WINDOW_NOT_FOUND", "missing window");

    expect(error).toHaveProperty("code", "WINDOW_NOT_FOUND");
    expect(error).toHaveProperty("message", "missing window");
    expect(error).toHaveProperty("retriable", false);
    expect("details" in error).toBe(false);
  });
});
