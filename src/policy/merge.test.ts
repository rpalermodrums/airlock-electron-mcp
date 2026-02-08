import { describe, expect, it } from "vitest";

import { createResolvedPolicyForMode, mergePolicies } from "./merge.js";

describe("policy merge", () => {
  it("uses the more restrictive mode between runtime and file policy", () => {
    const merged = mergePolicies(
      {
        version: 1,
        mode: "safe"
      },
      "trusted",
      "/tmp/airlock-tests"
    );

    expect(merged.mode).toBe("safe");

    const mergedFromTrustedFile = mergePolicies(
      {
        version: 1,
        mode: "trusted"
      },
      "safe",
      "/tmp/airlock-tests"
    );

    expect(mergedFromTrustedFile.mode).toBe("safe");
  });

  it("rejects origins that are not allowed by the resolved mode", () => {
    expect(() =>
      mergePolicies(
        {
          version: 1,
          mode: "safe",
          allowedOrigins: ["https://example.com"]
        },
        "trusted",
        "/tmp/airlock-tests"
      )
    ).toThrowError(
      expect.objectContaining({
        code: "POLICY_VIOLATION"
      })
    );
  });

  it("rejects TTL values that exceed the mode default", () => {
    expect(() =>
      mergePolicies(
        {
          version: 1,
          mode: "safe",
          maxSessionTTLMs: 60 * 60 * 1000
        },
        "safe",
        "/tmp/airlock-tests"
      )
    ).toThrowError(
      expect.objectContaining({
        code: "POLICY_VIOLATION"
      })
    );
  });

  it("allows additional tool restrictions and redaction patterns", () => {
    const merged = mergePolicies(
      {
        version: 1,
        tools: {
          disabled: ["app_kill", "server_reset", "app_kill"],
          requireConfirmation: ["screenshot", "type"]
        },
        redactionPatterns: ["token-[a-z0-9]+", "token-[a-z0-9]+"]
      },
      "standard",
      "/tmp/airlock-tests"
    );

    expect(merged.tools).toEqual({
      disabled: ["app_kill", "server_reset"],
      requireConfirmation: ["screenshot", "type"]
    });
    expect(merged.redactionPatterns).toEqual(["token-[a-z0-9]+"]);
  });

  it("builds a resolved default policy without a file policy", () => {
    const resolved = createResolvedPolicyForMode("standard", "/tmp/airlock-tests");

    expect(resolved).toMatchObject({
      mode: "standard",
      artifactRoot: "/tmp/airlock-tests",
      maxSessionTtlMs: 2 * 60 * 60 * 1000,
      tools: {
        disabled: [],
        requireConfirmation: []
      },
      redactionPatterns: []
    });
  });
});
