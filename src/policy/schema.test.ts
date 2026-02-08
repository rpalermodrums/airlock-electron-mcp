import { describe, expect, it } from "vitest";

import { PolicyFileSchema } from "./schema.js";

describe("policy schema", () => {
  it("accepts a valid policy file", () => {
    const parsed = PolicyFileSchema.safeParse({
      version: 1,
      mode: "safe",
      roots: ["./src", "./test"],
      allowedEnvVars: ["NODE_ENV", "AIRLOCK_*"],
      allowedOrigins: ["http://localhost:*", "https://localhost:*"],
      tools: {
        disabled: ["app_kill", "server_reset"],
        requireConfirmation: ["screenshot", "type"]
      },
      maxSessionTTLMs: 3_600_000,
      maxSnapshotNodes: 500,
      redactionPatterns: ["sk-[a-zA-Z0-9]{20,}", "ghp_[a-zA-Z0-9]{36}"]
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects unsupported policy versions", () => {
    const parsed = PolicyFileSchema.safeParse({
      version: 2
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid regex redaction patterns", () => {
    const parsed = PolicyFileSchema.safeParse({
      version: 1,
      redactionPatterns: ["[unterminated"]
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const parsed = PolicyFileSchema.safeParse({
      version: 1,
      unknownField: true
    });

    expect(parsed.success).toBe(false);
  });
});
