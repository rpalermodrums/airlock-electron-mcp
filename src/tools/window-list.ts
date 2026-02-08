import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError, windowId as toWindowId, type Window } from "../types/index.js";
import { resolveWindow } from "./helpers.js";

const WindowListInputSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();

const WindowOutputSchema = z
  .object({
    windowId: z.string().min(1),
    title: z.string(),
    url: z.string(),
    kind: z.enum(["primary", "modal", "devtools", "utility", "unknown"]),
    focused: z.boolean(),
    visible: z.boolean(),
    lastSeenAt: z.string().min(1)
  })
  .strict();

const WindowListOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    selectedWindowId: z.string().min(1).optional(),
    windows: z.array(WindowOutputSchema)
  })
  .strict();

const toSessionWindow = (window: {
  id: string;
  title: string;
  url: string;
  kind: Window["kind"];
  focused: boolean;
  visible: boolean;
}): Window => {
  return {
    windowId: toWindowId(window.id),
    title: window.title,
    url: window.url,
    kind: window.kind,
    focused: window.focused,
    visible: window.visible,
    lastSeenAt: new Date().toISOString()
  };
};

export const windowListTool = defineAirlockTool({
  name: "window_list",
  title: "List Session Windows",
  description: [
    "Lists current windows for an active session and refreshes in-memory window metadata.",
    "What it does: queries the driver for renderer/devtools windows, updates session window state, and returns stable window IDs for follow-up tools.",
    "What it cannot do: this does not force-focus windows or guarantee renderer responsiveness.",
    "Defaults: implicit targeting preference is explicit windowId, user default window, modal/dialog windows, most recently interacted window, most recently focused primary window, then first non-devtools window.",
    "Common error guidance: if the session is missing, relaunch via app_launch(); if no windows are returned, wait for renderer startup and retry.",
    "Safety notes: read-only against app state; no destructive actions."
  ].join("\n"),
  inputSchema: WindowListInputSchema,
  outputSchema: WindowListOutputSchema,
  allowedModes: ["safe", "standard", "trusted"],
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    const managedSession = context.sessions.get(input.sessionId);
    if (managedSession === undefined) {
      throw createAirlockError("SESSION_NOT_FOUND", `Session \"${input.sessionId}\" was not found.`, false, {
        sessionId: input.sessionId
      });
    }

    if (managedSession.driverSession === undefined) {
      throw createAirlockError(
        "SESSION_NOT_FOUND",
        `Session \"${input.sessionId}\" has no bound driver session.`,
        false,
        {
          sessionId: input.sessionId
        }
      );
    }

    const windows = (await context.driver.getWindows(managedSession.driverSession)).map(toSessionWindow);
    managedSession.session.windows = windows;

    const diagnostics: Record<string, unknown> = {};
    const selectedWindowId =
      windows.length === 0
        ? undefined
        : resolveWindow(managedSession, undefined, {
            diagnostics,
            trackAsInteracted: false
          }).windowId;
    const now = new Date().toISOString();

    managedSession.session.selectedWindowId = selectedWindowId;
    managedSession.session.updatedAt = now;
    managedSession.session.lastActivityAt = now;

    if (windows.length === 0) {
      delete managedSession.lastInteractedWindowId;
      delete managedSession.lastFocusedPrimaryWindowId;
    }

    return {
      data: {
        sessionId: input.sessionId,
        ...(selectedWindowId === undefined ? {} : { selectedWindowId }),
        windows
      },
      meta: {
        ...(windows.length === 0
          ? {
              warnings: ["No windows are currently available for this session."],
              suggestions: ["Retry window_list() after the renderer finishes opening a window."]
            }
          : {
              suggestions: ["Use selectedWindowId for deterministic multi-window operations when needed."],
              diagnostics
            })
      }
    };
  }
});
