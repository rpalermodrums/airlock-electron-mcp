import { access } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { listFilesIfExists, writeSessionArtifactExport } from "../artifacts/index.js";
import { defineAirlockTool } from "../server.js";
import { ExportArtifactsInputSchema, ExportArtifactsOutputSchema } from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type ExportArtifactsInput = z.infer<typeof ExportArtifactsInputSchema>;

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => {
  return typeof value === "object" && value !== null && "code" in value;
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const asErrorMessage = (value: unknown): string => {
  return value instanceof Error ? value.message : String(value);
};

const extractLaunchDiagnostics = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  const directDiagnostics = metadata.diagnostics;
  if (isRecord(directDiagnostics)) {
    return directDiagnostics;
  }

  const summary: Record<string, unknown> = {};
  const keys: readonly string[] = [
    "launchPath",
    "launchFallbackReason",
    "readinessCompletedSignals",
    "readinessTimeline",
    "attachDiagnostics"
  ];

  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  return Object.keys(summary).length === 0 ? undefined : summary;
};

export const exportArtifactsTool = defineAirlockTool({
  name: "export_artifacts",
  title: "Export Session Artifacts",
  description: [
    "Collects available debugging artifacts for a session and writes a manifest export bundle under the session artifact directory.",
    "What it does: gathers screenshots, saved traces, console snapshot, filtered event-log entries, and launch diagnostics (when available).",
    "What it cannot do: this does not compress data into a zip file; it writes structured JSON plus a manifest of artifact paths.",
    "Defaults: includes all screenshots for the session and the canonical trace path when present.",
    "Common error guidance: if expected files are missing, run trace_stop() and screenshot() before exporting again.",
    "Safety notes: read-only against app state; writes only under configured artifact root."
  ].join("\n"),
  inputSchema: ExportArtifactsInputSchema,
  outputSchema: ExportArtifactsOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: ExportArtifactsInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const warnings: string[] = [];

    const screenshotsDir = path.join(managedSession.session.artifactDir, "screenshots");
    const screenshotPaths = await listFilesIfExists(screenshotsDir);

    const traceCandidates = [
      managedSession.session.traceState?.tracePath,
      path.join(context.policy.artifactRoot, "traces", `${input.sessionId}.zip`)
    ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

    const tracePath = (
      await Promise.all(
        traceCandidates.map(async (candidate) => {
          return (await pathExists(candidate)) ? candidate : null;
        })
      )
    ).find((candidate): candidate is string => candidate !== null);

    const logDir = path.join(context.policy.artifactRoot, "logs");
    const sessionLogPaths = (await listFilesIfExists(logDir)).filter((candidate) => {
      return path.basename(candidate).includes(input.sessionId);
    });

    const consoleEntries = await (async (): Promise<readonly unknown[]> => {
      try {
        return await context.driver.getConsoleLogs(managedSession.driverSession, { limit: 500 });
      } catch (error: unknown) {
        warnings.push(`Console snapshot unavailable: ${asErrorMessage(error)}`);
        return [];
      }
    })();

    const eventEntries = context.eventLog.getEntries().filter((entry) => entry.sessionId === input.sessionId);

    const metadata = isRecord(managedSession.driverSession.metadata)
      ? (managedSession.driverSession.metadata as Record<string, unknown>)
      : undefined;
    const launchDiagnostics = extractLaunchDiagnostics(metadata);

    const exported = await writeSessionArtifactExport({
      sessionId: input.sessionId,
      sessionDir: managedSession.session.artifactDir,
      screenshotPaths,
      ...(tracePath === undefined ? {} : { tracePath }),
      consoleEntries,
      eventLogEntries: eventEntries,
      ...(launchDiagnostics === undefined ? {} : { launchDiagnostics }),
      additionalPaths: sessionLogPaths
    });

    return {
      data: {
        sessionId: input.sessionId,
        exportedAt: exported.exportedAt,
        artifactPaths: exported.artifactPaths
      },
      ...(warnings.length === 0
        ? {
            meta: {
              suggestions: [
                "Share the generated manifest and trace with the failing reproduction steps for faster debugging."
              ],
              diagnostics: {
                exportDir: exported.exportDir
              }
            }
          }
        : {
            meta: {
              warnings,
              suggestions: ["Re-run export_artifacts() after collecting missing diagnostics."],
              diagnostics: {
                exportDir: exported.exportDir
              }
            }
          })
    };
  }
});
