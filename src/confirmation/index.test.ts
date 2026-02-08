import { describe, expect, it } from "vitest";

import { createConfirmation, shouldRequireConfirmation } from "./index.js";

describe("confirmation helpers", () => {
  it("returns false when policy is undefined", () => {
    expect(shouldRequireConfirmation("click", undefined)).toBe(false);
  });

  it("returns true when the tool is listed in requireConfirmation", () => {
    expect(
      shouldRequireConfirmation("click", {
        mode: "standard",
        allowedOrigins: ["http://localhost"],
        artifactRoot: "/tmp/airlock-tests",
        maxSessionTtlMs: 30_000,
        tools: {
          disabled: [],
          requireConfirmation: ["click", "server_reset"]
        }
      })
    ).toBe(true);
  });

  it("never requires confirmation for the confirm tool itself", () => {
    expect(
      shouldRequireConfirmation("confirm", {
        mode: "standard",
        allowedOrigins: ["http://localhost"],
        artifactRoot: "/tmp/airlock-tests",
        maxSessionTtlMs: 30_000,
        tools: {
          disabled: [],
          requireConfirmation: ["confirm"]
        }
      })
    ).toBe(false);
  });

  it("creates a confirmation payload with deterministic timestamps when injected", () => {
    const created = createConfirmation(
      "dangerous_tool",
      "Run dangerous_tool",
      { foo: "bar" },
      {
        id: "confirm-1",
        nowMs: () => 2_000,
        ttlMs: 500
      }
    );

    expect(created).toEqual({
      id: "confirm-1",
      toolName: "dangerous_tool",
      description: "Run dangerous_tool",
      params: { foo: "bar" },
      createdAt: 2_000,
      expiresAt: 2_500
    });
  });
});
