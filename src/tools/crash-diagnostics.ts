import process from "node:process";

import { z } from "zod";

import type { ConsoleEntry, DriverWindow } from "../driver/index.js";
import { defineAirlockTool } from "../server.js";
import { DiagnoseSessionInputSchema, DiagnoseSessionOutputSchema } from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;
const SNAPSHOT_TIMEOUT_MS = 3_000;
const RECENT_ERROR_WINDOW_MS = 30_000;
const STALE_ACTION_THRESHOLD_SECONDS = 300;
const ACTION_TOOL_NAMES = new Set([
  "click",
  "type",
  "press_key",
  "select",
  "hover",
  "wait_for_idle",
  "wait_for_visible",
  "wait_for_text"
]);

type DiagnoseSessionInput = z.infer<typeof DiagnoseSessionInputSchema>;

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => {
  return typeof value === "object" && value !== null && "code" in value;
};

const asErrorMessage = (value: unknown): string => {
  return value instanceof Error ? value.message : String(value);
};

const parseTimestampMs = (timestamp: string): number | null => {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
};

const elapsedSeconds = (timestamp: string, nowMs: number): number => {
  const parsed = parseTimestampMs(timestamp);
  if (parsed === null) {
    return 0;
  }

  const elapsed = Math.max(0, nowMs - parsed);
  return Math.round(elapsed / 1000);
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms.`);

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
};

const readProcessId = (metadata: Record<string, unknown> | undefined): number | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  const candidate = metadata.processId;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : undefined;
};

const checkProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "EPERM") {
      return true;
    }

    return false;
  }
};

const selectSnapshotWindow = (windows: readonly DriverWindow[]): DriverWindow | undefined => {
  const primary = windows.find((window) => window.kind === "primary");
  if (primary !== undefined) {
    return primary;
  }

  const nonDevtools = windows.find((window) => window.kind !== "devtools");
  if (nonDevtools !== undefined) {
    return nonDevtools;
  }

  return windows[0];
};

const recentConsoleErrors = (entries: readonly ConsoleEntry[], nowMs: number): readonly ConsoleEntry[] => {
  return entries.filter((entry) => {
    if (entry.level !== "error") {
      return false;
    }

    const parsed = parseTimestampMs(entry.timestamp);
    if (parsed === null) {
      return false;
    }

    return nowMs - parsed <= RECENT_ERROR_WINDOW_MS;
  });
};

export const diagnoseSessionTool = defineAirlockTool({
  name: "diagnose_session",
  title: "Diagnose Session Health",
  description: [
    "Runs best-effort health diagnostics for an active session to detect hangs or crash symptoms.",
    "What it does: checks process liveness, snapshot responsiveness, recent renderer errors, action recency, and window-count drift.",
    "What it cannot do: this does not recover sessions automatically or guarantee root-cause classification.",
    "Defaults: snapshot responsiveness check uses a 3-second timeout and console error scan uses a 30-second lookback.",
    "Common error guidance: if unhealthy, export_artifacts() immediately after reproduction and relaunch if process is dead.",
    "Safety notes: diagnostic read-only tool available in all modes."
  ].join("\n"),
  inputSchema: DiagnoseSessionInputSchema,
  outputSchema: DiagnoseSessionOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: DiagnoseSessionInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const nowMs = Date.now();

    const issues: string[] = [];
    const recommendations: string[] = [];

    const metadata =
      managedSession.driverSession.metadata !== undefined &&
      typeof managedSession.driverSession.metadata === "object" &&
      managedSession.driverSession.metadata !== null
        ? (managedSession.driverSession.metadata as Record<string, unknown>)
        : undefined;

    const processId = readProcessId(metadata);
    if (processId === undefined) {
      issues.push("Electron process ID is unavailable for this session.");
      recommendations.push("Relaunch with app_launch() if process-level diagnostics are required.");
    } else if (!checkProcessAlive(processId)) {
      issues.push(`Electron process ${processId} is not alive.`);
      recommendations.push("Close and relaunch the session using app_close() then app_launch().");
    }

    const liveWindows = await context.driver.getWindows(managedSession.driverSession);
    const expectedWindowCount = managedSession.session.windows.length;
    if (liveWindows.length === 0) {
      issues.push("No renderer windows are currently discoverable.");
      recommendations.push("Run window_list() after relaunch to verify renderer window creation.");
    }

    if (liveWindows.length !== expectedWindowCount) {
      issues.push(`Window count drift detected (expected ${expectedWindowCount}, observed ${liveWindows.length}).`);
      recommendations.push("Run window_list() to refresh tracked windows before continuing interactions.");
    }

    const snapshotWindow = selectSnapshotWindow(liveWindows);
    if (snapshotWindow === undefined) {
      issues.push("No window is available for snapshot responsiveness checks.");
    } else {
      try {
        await withTimeout(
          context.driver.getSnapshot(snapshotWindow, {
            maxNodes: 40,
            maxTextCharsPerNode: 40
          }),
          SNAPSHOT_TIMEOUT_MS,
          "Snapshot capture"
        );
      } catch (error: unknown) {
        issues.push(`Snapshot responsiveness check failed: ${asErrorMessage(error)}`);
        recommendations.push("Capture screenshot() and consider app_kill() if the renderer remains unresponsive.");
      }
    }

    try {
      const consoleEntries = await context.driver.getConsoleLogs(managedSession.driverSession, {
        level: "error",
        limit: 200
      });
      const recentErrors = recentConsoleErrors(consoleEntries, nowMs);
      if (recentErrors.length > 0) {
        issues.push(`${recentErrors.length} console error(s) were emitted in the last 30 seconds.`);
        recommendations.push("Inspect console_recent(level=error) and enable trace_start() before reproducing again.");
      }
    } catch (error: unknown) {
      issues.push(`Console diagnostics unavailable: ${asErrorMessage(error)}`);
    }

    const lastSuccessfulActionAt = context.eventLog
      .getEntries()
      .filter((entry) => {
        return (
          entry.sessionId === input.sessionId &&
          entry.resultSummary.status === "ok" &&
          ACTION_TOOL_NAMES.has(entry.toolName)
        );
      })
      .at(-1)?.timestamp;

    const secondsSinceLastAction =
      lastSuccessfulActionAt === undefined ? undefined : elapsedSeconds(lastSuccessfulActionAt, nowMs);

    if (secondsSinceLastAction !== undefined && secondsSinceLastAction > STALE_ACTION_THRESHOLD_SECONDS) {
      issues.push(`No successful action has completed for ${secondsSinceLastAction} seconds.`);
      recommendations.push(
        "Re-run a lightweight probe action (for example, wait_for_idle()) to confirm responsiveness."
      );
    }

    if (issues.length === 0) {
      recommendations.push("Session appears healthy based on current diagnostics.");
    }

    return {
      data: {
        healthy: issues.length === 0,
        issues,
        lastActivity: {
          sessionLastActivityAt: managedSession.session.lastActivityAt,
          ...(lastSuccessfulActionAt === undefined ? {} : { lastSuccessfulActionAt }),
          secondsSinceSessionActivity: elapsedSeconds(managedSession.session.lastActivityAt, nowMs),
          ...(secondsSinceLastAction === undefined ? {} : { secondsSinceLastSuccessfulAction: secondsSinceLastAction })
        },
        recommendations
      }
    };
  }
});
