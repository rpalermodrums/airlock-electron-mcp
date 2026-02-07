import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ArtifactPaths {
  rootDir: string;
  artifactsDir: string;
  logsDir: string;
  tracesDir: string;
}

const DEFAULT_ARTIFACT_ROOT = ".airlock/electron";

export const resolveArtifactRoot = (projectRoot: string, configuredRoot?: string): string => {
  return path.resolve(projectRoot, configuredRoot ?? DEFAULT_ARTIFACT_ROOT);
};

export const ensureArtifactDirectories = async (rootDir: string): Promise<ArtifactPaths> => {
  const artifactsDir = path.join(rootDir, "artifacts");
  const logsDir = path.join(rootDir, "logs");
  const tracesDir = path.join(rootDir, "traces");

  await Promise.all([
    mkdir(rootDir, { recursive: true }),
    mkdir(artifactsDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(tracesDir, { recursive: true })
  ]);

  return {
    rootDir,
    artifactsDir,
    logsDir,
    tracesDir
  };
};

export const ensureArtifactRoot = ensureArtifactDirectories;

export const createSessionArtifactDir = async (
  artifactPaths: ArtifactPaths,
  sessionId: string = randomUUID()
): Promise<{ sessionId: string; sessionDir: string }> => {
  const sessionDir = path.join(artifactPaths.artifactsDir, sessionId);
  await mkdir(sessionDir, { recursive: true });

  return {
    sessionId,
    sessionDir
  };
};

export const cleanupSessionArtifactDir = async (sessionDir: string): Promise<void> => {
  await rm(sessionDir, { recursive: true, force: true });
};
