import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError } from "../types/index.js";
import { ServerResetInputSchema, ServerResetOutputSchema } from "../types/schemas.js";

const RESET_MODES = ["standard", "trusted"] as const;

type ServerResetInput = z.infer<typeof ServerResetInputSchema>;

export const serverResetTool = defineAirlockTool({
  name: "server_reset",
  title: "Reset Server Sessions",
  description: [
    "Closes all active sessions and resets server session state.",
    "What it does: runs SessionManager.reset(), executing each session cleanup callback and clearing in-memory session registry entries.",
    "What it cannot do: this does not restart the MCP process itself.",
    "Defaults: best-effort cleanup across all sessions with aggregate failure reporting.",
    "Common error guidance: if reset reports failures, inspect server_status() and doctor() for stuck runtimes, then relaunch clean sessions.",
    "Safety notes: restricted to standard/trusted modes because it tears down all active sessions."
  ].join("\n"),
  inputSchema: ServerResetInputSchema,
  outputSchema: ServerResetOutputSchema,
  allowedModes: RESET_MODES,
  handler: async (_input: ServerResetInput, context) => {
    const beforeCount = context.sessions.count();
    const failures = await context.sessions.reset("server_reset");
    const closedCount = Math.max(0, beforeCount - context.sessions.count());

    if (failures.length > 0) {
      throw createAirlockError("INTERNAL_ERROR", "Failed to reset one or more sessions.", true, {
        closedCount,
        failures
      });
    }

    return {
      data: {
        ok: true,
        closedCount
      },
      ...(closedCount === 0
        ? {
            meta: {
              suggestions: ["No sessions were active. Use app_launch() to create a new session."]
            }
          }
        : {})
    };
  }
});
