import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { loadPolicyFile, mergePolicies } from "./index.js";

describe("policy module integration", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads and merges a policy file with runtime defaults", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "airlock-policy-index-"));
    const policyPath = path.join(tempDir, ".airlock-policy.json");
    await writeFile(
      policyPath,
      JSON.stringify(
        {
          version: 1,
          mode: "safe",
          allowedOrigins: ["http://localhost:*"],
          tools: {
            disabled: ["app_kill"],
            requireConfirmation: ["screenshot"]
          },
          maxSnapshotNodes: 450,
          redactionPatterns: ["sk-[a-zA-Z0-9]{20,}"]
        },
        null,
        2
      )
    );

    const filePolicy = await loadPolicyFile(policyPath);
    const merged = mergePolicies(filePolicy, "trusted", "/tmp/airlock-tests", policyPath);

    expect(merged.mode).toBe("safe");
    expect(merged.allowedOrigins).toEqual(["http://localhost:*"]);
    expect(merged.tools).toEqual({
      disabled: ["app_kill"],
      requireConfirmation: ["screenshot"]
    });
    expect(merged.maxSnapshotNodes).toBe(450);
    expect(merged.sourcePath).toBe(policyPath);
  });
});
