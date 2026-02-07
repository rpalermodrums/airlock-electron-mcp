import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DEFAULT_ALLOWED_ORIGINS, SAFETY_CAPABILITIES, SAFETY_MODES, defaultPolicyForMode } from "./policy.js";

describe("policy types", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the default policy for safe mode", () => {
    const policy = defaultPolicyForMode("safe", "/tmp/artifacts");

    expect(policy).toEqual({
      mode: "safe",
      allowedOrigins: ["http://localhost", "http://127.0.0.1"],
      artifactRoot: "/tmp/artifacts",
      maxSessionTtlMs: 30 * 60 * 1000
    });
  });

  it("builds the default policy for standard mode", () => {
    const policy = defaultPolicyForMode("standard", "/tmp/artifacts");

    expect(policy).toEqual({
      mode: "standard",
      allowedOrigins: ["http://localhost", "http://127.0.0.1", "file://"],
      artifactRoot: "/tmp/artifacts",
      maxSessionTtlMs: 2 * 60 * 60 * 1000
    });
  });

  it("builds the default policy for trusted mode", () => {
    const policy = defaultPolicyForMode("trusted", "/tmp/artifacts");

    expect(policy).toEqual({
      mode: "trusted",
      allowedOrigins: ["*"],
      artifactRoot: "/tmp/artifacts",
      maxSessionTtlMs: 8 * 60 * 60 * 1000
    });
  });

  it("keeps safe mode capability restrictions", () => {
    expect(SAFETY_CAPABILITIES.safe).toEqual({
      allowAppKill: false,
      allowTrustedEval: false,
      allowOriginOverrides: false,
      allowRawSelectors: false
    });
  });

  it("enables all trusted mode capabilities", () => {
    expect(SAFETY_CAPABILITIES.trusted).toEqual({
      allowAppKill: true,
      allowTrustedEval: true,
      allowOriginOverrides: true,
      allowRawSelectors: true
    });
  });

  it("exports the default allowed origins", () => {
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual(["http://localhost", "http://127.0.0.1"]);
  });

  it("exports the available safety modes", () => {
    expect(SAFETY_MODES).toEqual(["safe", "standard", "trusted"]);
  });
});
