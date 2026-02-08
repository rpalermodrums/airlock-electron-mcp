import path from "node:path";

import { z } from "zod";

import { ensureArtifactDirectories } from "../artifacts/index.js";
import { defineAirlockTool } from "../server.js";
import type { AirlockToolContext } from "../server.js";
import type { ManagedSession } from "../session-manager.js";
import { createAirlockError } from "../types/index.js";
import {
  TraceStartInputSchema,
  TraceStartOutputSchema,
  TraceStopInputSchema,
  TraceStopOutputSchema
} from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const TRACE_ALLOWED_MODES = ["standard", "trusted"] as const;

type TraceStartInput = z.infer<typeof TraceStartInputSchema>;
type TraceStopInput = z.infer<typeof TraceStopInputSchema>;

const assertTracingMode = (mode: string): void => {
  if (mode === "safe") {
    throw createAirlockError("POLICY_VIOLATION", "Tracing is disabled in safe mode.", false, {
      mode
    });
  }
};

const defaultTracePath = (artifactRoot: string, sessionId: string): string => {
  return path.join(artifactRoot, "traces", `${sessionId}.zip`);
};

const stopActiveTraceIfNeeded = async (managedSession: ManagedSession, context: AirlockToolContext): Promise<void> => {
  if (managedSession.driverSession === undefined) {
    return;
  }

  const traceState = managedSession.session.traceState;
  if (traceState?.active !== true) {
    return;
  }

  const artifactPaths = await ensureArtifactDirectories(context.policy.artifactRoot);
  const tracePath = traceState.tracePath ?? defaultTracePath(artifactPaths.rootDir, managedSession.session.sessionId);

  await context.driver.stopTracing(managedSession.driverSession, tracePath);
  context.sessions.setTraceState(managedSession.session.sessionId, {
    active: false,
    tracePath
  });
};

const ensureTraceCleanupWrapper = (managedSession: ManagedSession, context: AirlockToolContext): void => {
  if (managedSession.traceCleanupWrapped) {
    return;
  }

  const previousCleanup = managedSession.cleanup;
  managedSession.cleanup = async (sessionToCleanup): Promise<void> => {
    await stopActiveTraceIfNeeded(sessionToCleanup, context);

    if (previousCleanup !== undefined) {
      await previousCleanup(sessionToCleanup);
      return;
    }

    if (sessionToCleanup.driverSession !== undefined) {
      await context.driver.close(sessionToCleanup.driverSession);
    }
  };
  managedSession.traceCleanupWrapped = true;
};

export const traceStartTool = defineAirlockTool({
  name: "trace_start",
  title: "Start Playwright Trace",
  description: [
    "Starts Playwright tracing for the current session browser context.",
    "What it does: enables trace capture with configurable screenshots/snapshots and marks trace state active for the session.",
    "What it cannot do: this does not persist a trace file until trace_stop() or session cleanup runs.",
    "Defaults: screenshots and snapshots default to true when options are omitted.",
    "Common error guidance: if tracing is already active, call trace_stop() before restarting.",
    "Safety notes: disabled in safe mode; available only in standard/trusted modes."
  ].join("\n"),
  inputSchema: TraceStartInputSchema,
  outputSchema: TraceStartOutputSchema,
  allowedModes: TRACE_ALLOWED_MODES,
  handler: async (input: TraceStartInput, context) => {
    assertTracingMode(context.mode);

    const managedSession = resolveManagedSession(context, input.sessionId);
    ensureTraceCleanupWrapper(managedSession, context);

    if (managedSession.session.traceState?.active === true) {
      throw createAirlockError(
        "INVALID_INPUT",
        `Tracing is already active for session \"${input.sessionId}\".`,
        false,
        {
          sessionId: input.sessionId
        }
      );
    }

    const traceOptions =
      input.options === undefined
        ? undefined
        : {
            ...(input.options.screenshots === undefined ? {} : { screenshots: input.options.screenshots }),
            ...(input.options.snapshots === undefined ? {} : { snapshots: input.options.snapshots })
          };

    await context.driver.startTracing(managedSession.driverSession, traceOptions);
    context.sessions.setTraceState(input.sessionId, {
      active: true
    });

    return {
      data: {
        ok: true,
        message: `Tracing started for session \"${input.sessionId}\".`
      },
      meta: {
        suggestions: ["Run trace_stop() after reproducing the issue to persist the trace archive."]
      }
    };
  }
});

export const traceStopTool = defineAirlockTool({
  name: "trace_stop",
  title: "Stop Playwright Trace",
  description: [
    "Stops an active Playwright trace and saves it under the Airlock traces directory.",
    "What it does: writes a trace zip to `.airlock/electron/traces/<sessionId>.zip` and updates session trace state.",
    "What it cannot do: this does not merge multiple trace runs into one archive.",
    "Defaults: trace output path is deterministic per session ID.",
    "Common error guidance: call trace_start() first if tracing is not active.",
    "Safety notes: disabled in safe mode; available only in standard/trusted modes."
  ].join("\n"),
  inputSchema: TraceStopInputSchema,
  outputSchema: TraceStopOutputSchema,
  allowedModes: TRACE_ALLOWED_MODES,
  handler: async (input: TraceStopInput, context) => {
    assertTracingMode(context.mode);

    const managedSession = resolveManagedSession(context, input.sessionId);
    const traceState = managedSession.session.traceState;

    if (traceState?.active !== true) {
      if (traceState?.tracePath !== undefined) {
        return {
          data: {
            ok: true,
            tracePath: traceState.tracePath
          },
          meta: {
            warnings: ["Tracing was already stopped for this session."],
            suggestions: ["Use export_artifacts() to gather the saved trace with related diagnostics."]
          }
        };
      }

      throw createAirlockError("INVALID_INPUT", `Tracing is not active for session \"${input.sessionId}\".`, false, {
        sessionId: input.sessionId
      });
    }

    const artifactPaths = await ensureArtifactDirectories(context.policy.artifactRoot);
    const tracePath = defaultTracePath(artifactPaths.rootDir, input.sessionId);

    await context.driver.stopTracing(managedSession.driverSession, tracePath);
    context.sessions.setTraceState(input.sessionId, {
      active: false,
      tracePath
    });

    return {
      data: {
        ok: true,
        tracePath
      },
      meta: {
        suggestions: ["Open the trace in Playwright Trace Viewer for timeline-level debugging."]
      }
    };
  }
});
