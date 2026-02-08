import { z } from "zod";

import type { DriverWindow } from "../driver/index.js";
import { defineAirlockTool } from "../server.js";
import { windowId as toWindowId, type Window } from "../types/index.js";
import { WindowFocusInputSchema, WindowFocusOutputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type WindowFocusInput = z.infer<typeof WindowFocusInputSchema>;

const toSessionWindow = (window: DriverWindow): Window => {
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

export const windowFocusTool = defineAirlockTool({
  name: "window_focus",
  title: "Focus Window",
  description: [
    "Brings a specific session window to the front and marks it as the selected window.",
    "What it does: resolves the target window, calls the driver focus operation, refreshes window metadata, and updates selectedWindowId.",
    "What it cannot do: this is best-effort and cannot force OS-level focus in all desktop environments.",
    "Defaults: requires explicit `windowId` for deterministic multi-window control.",
    "Common error guidance: if the window cannot be found, call window_list() to refresh and retry with a current windowId.",
    "Safety notes: available in all modes; changes focus state only."
  ].join("\n"),
  inputSchema: WindowFocusInputSchema,
  outputSchema: WindowFocusOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: WindowFocusInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);

    await context.driver.focusWindow(managedSession.driverSession, targetWindow.windowId);
    const refreshedWindows = (await context.driver.getWindows(managedSession.driverSession)).map(toSessionWindow);
    const selectedWindowId =
      refreshedWindows.find((window) => window.windowId === targetWindow.windowId)?.windowId ??
      refreshedWindows.find((window) => window.focused)?.windowId ??
      refreshedWindows[0]?.windowId ??
      targetWindow.windowId;

    const now = new Date().toISOString();
    managedSession.session.windows = refreshedWindows;
    managedSession.session.selectedWindowId = selectedWindowId;
    managedSession.session.updatedAt = now;
    managedSession.session.lastActivityAt = now;

    return {
      data: {
        ok: true,
        message: `Focused window "${targetWindow.windowId}".`
      },
      meta: {
        suggestions: ["Continue actions on this window or pass explicit windowId for future tool calls."]
      }
    };
  }
});
