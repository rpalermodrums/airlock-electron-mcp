import path from "node:path";
import process from "node:process";

import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError } from "../types/index.js";
import { SessionInfoDetailedOutputSchema, SessionInfoInputSchema } from "../types/schemas.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type SessionInfoInput = z.infer<typeof SessionInfoInputSchema>;

export const sessionInfoTool = defineAirlockTool({
  name: "session_info",
  title: "Session Details",
  description: [
    "Returns detailed metadata for a session including launch mode, timestamps, mode, window count, platform, and artifact paths.",
    "What it does: reads current in-memory session state and enriches it with runtime/platform and artifact directory details.",
    "What it cannot do: this does not verify renderer responsiveness or recover stale/closed sessions.",
    "Defaults: returns the exact currently tracked session record plus computed summary details.",
    "Common error guidance: if session is missing, relaunch with app_launch() and then call session_info() again.",
    "Safety notes: read-only and available in all modes."
  ].join("\n"),
  inputSchema: SessionInfoInputSchema,
  outputSchema: SessionInfoDetailedOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: SessionInfoInput, context) => {
    const managedSession = context.sessions.get(input.sessionId);
    if (managedSession === undefined) {
      throw createAirlockError("SESSION_NOT_FOUND", `Session "${input.sessionId}" was not found.`, false, {
        sessionId: input.sessionId
      });
    }

    const session = managedSession.session;
    const details = {
      sessionId: session.sessionId,
      state: session.state,
      mode: session.mode,
      launchMode: session.launchMode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastActivityAt: session.lastActivityAt,
      windowCount: session.windows.length,
      ...(session.selectedWindowId === undefined ? {} : { selectedWindowId: session.selectedWindowId }),
      platform: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      },
      artifactPaths: {
        rootDir: context.policy.artifactRoot,
        sessionDir: session.artifactDir,
        screenshotsDir: path.join(session.artifactDir, "screenshots"),
        logsDir: path.join(context.policy.artifactRoot, "logs"),
        tracesDir: path.join(context.policy.artifactRoot, "traces")
      }
    };

    return {
      data: {
        session,
        details
      },
      ...(session.windows.length === 0
        ? {
            meta: {
              warnings: ["This session currently has no known windows."],
              suggestions: ["Call window_list() to refresh discovered windows before interaction."]
            }
          }
        : {})
    };
  }
});
