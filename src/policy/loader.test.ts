import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { loadPolicyFile } from "./loader.js";

const require = createRequire(import.meta.url);
const hasYamlDependency = (() => {
  try {
    void require("yaml");
    return true;
  } catch {
    return false;
  }
})();

describe("policy loader", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads and validates JSON policy files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "airlock-policy-loader-"));
    const filePath = path.join(tempDir, "policy.json");
    await writeFile(
      filePath,
      JSON.stringify(
        {
          version: 1,
          mode: "standard",
          tools: {
            disabled: ["app_kill"]
          }
        },
        null,
        2
      )
    );

    const policy = await loadPolicyFile(filePath);
    expect(policy).toMatchObject({
      version: 1,
      mode: "standard",
      tools: {
        disabled: ["app_kill"]
      }
    });
  });

  const yamlTest = hasYamlDependency ? it : it.skip;

  yamlTest("loads and validates YAML policy files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "airlock-policy-loader-"));
    const filePath = path.join(tempDir, "policy.yml");
    await writeFile(
      filePath,
      ["version: 1", "mode: safe", "tools:", "  requireConfirmation:", "    - screenshot"].join("\n")
    );

    const policy = await loadPolicyFile(filePath);
    expect(policy).toMatchObject({
      version: 1,
      mode: "safe",
      tools: {
        requireConfirmation: ["screenshot"]
      }
    });
  });

  it("returns INVALID_INPUT for unsupported extensions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "airlock-policy-loader-"));
    const filePath = path.join(tempDir, "policy.txt");
    await writeFile(filePath, "version: 1");

    await expect(loadPolicyFile(filePath)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("returns INVALID_INPUT for schema validation failures", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "airlock-policy-loader-"));
    const filePath = path.join(tempDir, "policy.yaml");
    await writeFile(filePath, "version: 2");

    await expect(loadPolicyFile(filePath)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });
});
