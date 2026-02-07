import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionArtifactDir, ensureArtifactRoot } from "./index.js";

const createdRoots = new Set<string>();

const createTempRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airlock-artifacts-test-"));
  createdRoots.add(dir);
  return dir;
};

describe("artifact helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([...createdRoots].map((dir) => rm(dir, { recursive: true, force: true })));
    createdRoots.clear();
  });

  it("ensureArtifactRoot() creates root/artifacts/logs/traces directories", async () => {
    const tempRoot = await createTempRoot();
    const rootDir = path.join(tempRoot, "nested", "airlock");

    const paths = await ensureArtifactRoot(rootDir);

    expect(paths.rootDir).toBe(rootDir);
    expect(paths.artifactsDir).toBe(path.join(rootDir, "artifacts"));
    expect(paths.logsDir).toBe(path.join(rootDir, "logs"));
    expect(paths.tracesDir).toBe(path.join(rootDir, "traces"));

    await expect(access(paths.rootDir)).resolves.toBeUndefined();
    await expect(access(paths.artifactsDir)).resolves.toBeUndefined();
    await expect(access(paths.logsDir)).resolves.toBeUndefined();
    await expect(access(paths.tracesDir)).resolves.toBeUndefined();
  });

  it("createSessionArtifactDir() creates session subdirectories", async () => {
    const tempRoot = await createTempRoot();
    const rootDir = path.join(tempRoot, "artifacts-root");
    const artifactPaths = await ensureArtifactRoot(rootDir);

    const result = await createSessionArtifactDir(artifactPaths, "session-123");

    expect(result).toEqual({
      sessionId: "session-123",
      sessionDir: path.join(artifactPaths.artifactsDir, "session-123")
    });
    await expect(access(result.sessionDir)).resolves.toBeUndefined();
  });
});
