import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError } from "../types/index.js";
import {
  WindowDefaultGetInputSchema,
  WindowDefaultGetOutputSchema,
  WindowDefaultSetInputSchema,
  WindowDefaultSetOutputSchema
} from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type WindowDefaultGetInput = z.infer<typeof WindowDefaultGetInputSchema>;
type WindowDefaultSetInput = z.infer<typeof WindowDefaultSetInputSchema>;

export const windowDefaultGetTool = defineAirlockTool({
  name: "window_default_get",
  title: "Get Default Window",
  description: [
    "Returns the current default window used for implicit window targeting.",
    "What it does: reads the session-scoped default window and lists currently known windows.",
    "What it cannot do: this does not discover new windows from the driver; call window_list() first if you need fresh data.",
    "Defaults: reports null when no default window is configured.",
    "Safety notes: read-only and available in all modes."
  ].join("\n"),
  inputSchema: WindowDefaultGetInputSchema,
  outputSchema: WindowDefaultGetOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: WindowDefaultGetInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const windows = managedSession.session.windows;

    if (
      managedSession.defaultWindowId !== undefined &&
      !windows.some((window) => window.windowId === managedSession.defaultWindowId)
    ) {
      delete managedSession.defaultWindowId;
    }

    return {
      data: {
        defaultWindowId: managedSession.defaultWindowId ?? null,
        currentWindows: windows
      },
      meta: {
        suggestions: ["Use window_default_set() to pin a deterministic default window for implicit tool targeting."]
      }
    };
  }
});

export const windowDefaultSetTool = defineAirlockTool({
  name: "window_default_set",
  title: "Set Default Window",
  description: [
    "Sets the session-scoped default window for implicit window targeting.",
    "What it does: validates the requested window exists in current session metadata and records it as the default.",
    "What it cannot do: this does not focus the window; use window_focus() when focus is required.",
    "Common error guidance: if a window is missing, run window_list() and retry using one of the returned window IDs.",
    "Safety notes: available in all modes; updates session memory only."
  ].join("\n"),
  inputSchema: WindowDefaultSetInputSchema,
  outputSchema: WindowDefaultSetOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: WindowDefaultSetInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = managedSession.session.windows.find((window) => window.windowId === input.windowId);

    if (targetWindow === undefined) {
      throw createAirlockError(
        "WINDOW_NOT_FOUND",
        `Window "${input.windowId}" was not found in session "${input.sessionId}".`,
        false,
        {
          sessionId: input.sessionId,
          requestedWindowId: input.windowId,
          availableWindowIds: managedSession.session.windows.map((window) => window.windowId)
        }
      );
    }

    const previousDefault = managedSession.defaultWindowId;
    managedSession.defaultWindowId = targetWindow.windowId;

    const now = new Date().toISOString();
    managedSession.session.updatedAt = now;
    managedSession.session.lastActivityAt = now;

    return {
      data: {
        ok: true,
        message: `Default window set to "${targetWindow.windowId}" (${targetWindow.title || "untitled"}).`,
        ...(previousDefault === undefined ? {} : { previousDefault })
      },
      meta: {
        suggestions: ["Run actions without windowId to target this default window implicitly."]
      }
    };
  }
});
