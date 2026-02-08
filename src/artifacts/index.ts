import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ArtifactPaths {
  rootDir: string;
  artifactsDir: string;
  logsDir: string;
  tracesDir: string;
}

export interface SessionArtifactExportInput {
  sessionId: string;
  sessionDir: string;
  screenshotPaths: readonly string[];
  tracePath?: string;
  consoleEntries: readonly unknown[];
  eventLogEntries: readonly unknown[];
  launchDiagnostics?: unknown;
  additionalPaths?: readonly string[];
}

export interface SessionArtifactExportResult {
  sessionId: string;
  exportedAt: string;
  exportDir: string;
  artifactPaths: string[];
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

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => {
  return typeof value === "object" && value !== null && "code" in value;
};

export const listFilesIfExists = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2) ?? "null";
  } catch (error: unknown) {
    serialized =
      JSON.stringify(
        {
          serializationError: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      ) ?? "null";
  }

  await writeFile(filePath, `${serialized}\n`, "utf8");
};

const toExportDirectoryName = (timestampIso: string): string => {
  return timestampIso.replace(/[:.]/g, "-");
};

const dedupePaths = (paths: readonly string[]): string[] => {
  return [...new Set(paths)];
};

export const writeSessionArtifactExport = async (
  input: SessionArtifactExportInput
): Promise<SessionArtifactExportResult> => {
  const exportedAt = new Date().toISOString();
  const exportDir = path.join(input.sessionDir, "exports", toExportDirectoryName(exportedAt));
  await mkdir(exportDir, { recursive: true });

  const consolePath = path.join(exportDir, "console-recent.json");
  const eventLogPath = path.join(exportDir, "event-log.json");
  const launchDiagnosticsPath = path.join(exportDir, "launch-diagnostics.json");

  await writeJsonFile(consolePath, input.consoleEntries);
  await writeJsonFile(eventLogPath, input.eventLogEntries);
  if (input.launchDiagnostics !== undefined) {
    await writeJsonFile(launchDiagnosticsPath, input.launchDiagnostics);
  }

  const artifactPaths = dedupePaths(
    [
      ...input.screenshotPaths,
      ...(input.tracePath === undefined ? [] : [input.tracePath]),
      ...(input.additionalPaths ?? []),
      consolePath,
      eventLogPath,
      ...(input.launchDiagnostics === undefined ? [] : [launchDiagnosticsPath])
    ].filter((candidate) => candidate.trim().length > 0)
  );

  const manifestPath = path.join(exportDir, "manifest.json");
  const manifest = {
    sessionId: input.sessionId,
    exportedAt,
    artifactPaths
  };
  await writeJsonFile(manifestPath, manifest);

  return {
    sessionId: input.sessionId,
    exportedAt,
    exportDir,
    artifactPaths: dedupePaths([...artifactPaths, manifestPath])
  };
};
