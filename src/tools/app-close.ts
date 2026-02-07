import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError } from "../types/index.js";

const AppCloseInputSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();

const AppCloseOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    closed: z.boolean()
  })
  .strict();

export const appCloseTool = defineAirlockTool({
  name: "app_close",
  title: "Close Electron Session",
  description: [
    "Closes a previously launched or attached Electron session and removes it from the active SessionManager registry.",
    "What it does: runs session cleanup (driver close + launch-process teardown), marks the session closed, and removes it from memory.",
    "What it cannot do: this does not recover failed sessions; if cleanup fails, it returns an error with diagnostics.",
    "Defaults: idempotent behavior for missing sessions so repeated close calls do not fail workflows.",
    "Common error guidance: if cleanup fails, call `server_status()` and `doctor()` to inspect runtime health before relaunching.",
    "Safety notes: allowed in all modes; performs controlled session teardown only."
  ].join("\n"),
  inputSchema: AppCloseInputSchema,
  outputSchema: AppCloseOutputSchema,
  allowedModes: ["safe", "standard", "trusted"],
  handler: async (input, context) => {
    const managedSession = context.sessions.get(input.sessionId);
    if (managedSession === undefined) {
      return {
        data: {
          sessionId: input.sessionId,
          closed: true
        },
        meta: {
          warnings: [`Session \"${input.sessionId}\" was not active.`],
          suggestions: ["Use server_status() to inspect active sessions before attempting close."]
        }
      };
    }

    try {
      if (managedSession.cleanup !== undefined) {
        await managedSession.cleanup(managedSession);
      } else if (managedSession.driverSession !== undefined) {
        await context.driver.close(managedSession.driverSession);
      }

      context.sessions.remove(input.sessionId);

      return {
        data: {
          sessionId: input.sessionId,
          closed: true
        }
      };
    } catch (error: unknown) {
      throw createAirlockError("INTERNAL_ERROR", `Failed to close session \"${input.sessionId}\".`, true, {
        sessionId: input.sessionId,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
  }
});
