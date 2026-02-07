import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError, windowId as toWindowId, type Window } from "../types/index.js";

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

const resolveSelectedWindowId = (
  windows: readonly Window[],
  previous: Window["windowId"] | undefined
): Window["windowId"] | undefined => {
  if (previous !== undefined && windows.some((window) => window.windowId === previous)) {
    return previous;
  }

  const primary = windows.find((window) => window.kind === "primary");
  return primary?.windowId ?? windows[0]?.windowId;
};

export const windowListTool = defineAirlockTool({
  name: "window_list",
  title: "List Session Windows",
  description: [
    "Lists current windows for an active session and refreshes in-memory window metadata.",
    "What it does: queries the driver for renderer/devtools windows, updates session window state, and returns stable window IDs for follow-up tools.",
    "What it cannot do: this does not force-focus windows or guarantee renderer responsiveness.",
    "Defaults: preserves the current selected window if still present; otherwise picks primary then first available.",
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
    const selectedWindowId = resolveSelectedWindowId(windows, managedSession.session.selectedWindowId);
    const now = new Date().toISOString();

    managedSession.session.windows = windows;
    managedSession.session.selectedWindowId = selectedWindowId;
    managedSession.session.updatedAt = now;
    managedSession.session.lastActivityAt = now;

    return {
      data: {
        sessionId: input.sessionId,
        ...(selectedWindowId === undefined ? {} : { selectedWindowId }),
        windows
      },
      ...(windows.length === 0
        ? {
            meta: {
              warnings: ["No windows are currently available for this session."],
              suggestions: ["Retry window_list() after the renderer finishes opening a window."]
            }
          }
        : {})
    };
  }
});
