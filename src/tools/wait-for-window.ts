import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError, windowId as toWindowId, type Window } from "../types/index.js";
import { WaitForWindowInputSchema, WaitForWindowOutputSchema } from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;
const POLL_INTERVAL_MS = 500;

type WaitForWindowInput = z.infer<typeof WaitForWindowInputSchema>;

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

const toFirstSeenMap = (windows: readonly Window[], fallbackMs: number): Map<string, number> => {
  const firstSeenByWindowId = new Map<string, number>();

  for (const window of windows) {
    const parsedLastSeen = Date.parse(window.lastSeenAt);
    firstSeenByWindowId.set(window.windowId, Number.isFinite(parsedLastSeen) ? parsedLastSeen : fallbackMs);
  }

  return firstSeenByWindowId;
};

const pruneMissingTrackedWindows = (managedSession: ReturnType<typeof resolveManagedSession>): void => {
  const availableWindowIds = new Set(managedSession.session.windows.map((window) => window.windowId));

  if (managedSession.defaultWindowId !== undefined && !availableWindowIds.has(managedSession.defaultWindowId)) {
    delete managedSession.defaultWindowId;
  }

  if (
    managedSession.lastInteractedWindowId !== undefined &&
    !availableWindowIds.has(managedSession.lastInteractedWindowId)
  ) {
    delete managedSession.lastInteractedWindowId;
  }

  if (
    managedSession.lastFocusedPrimaryWindowId !== undefined &&
    !availableWindowIds.has(managedSession.lastFocusedPrimaryWindowId)
  ) {
    delete managedSession.lastFocusedPrimaryWindowId;
  }

  if (
    managedSession.session.selectedWindowId !== undefined &&
    !availableWindowIds.has(managedSession.session.selectedWindowId)
  ) {
    managedSession.session.selectedWindowId = undefined;
  }
};

const matchesWindow = (
  window: Window,
  firstSeenByWindowId: Map<string, number>,
  input: WaitForWindowInput
): boolean => {
  const titleContains = input.titleContains?.toLowerCase();
  if (titleContains !== undefined && !window.title.toLowerCase().includes(titleContains)) {
    return false;
  }

  const urlContains = input.urlContains?.toLowerCase();
  if (urlContains !== undefined && !window.url.toLowerCase().includes(urlContains)) {
    return false;
  }

  if (input.createdAfter !== undefined) {
    const firstSeenAt = firstSeenByWindowId.get(window.windowId);
    if (firstSeenAt === undefined || firstSeenAt <= input.createdAfter) {
      return false;
    }
  }

  return true;
};

const hasWindowMatcher = (input: WaitForWindowInput): boolean => {
  return input.titleContains !== undefined || input.urlContains !== undefined || input.createdAfter !== undefined;
};

export const waitForWindowTool = defineAirlockTool({
  name: "wait_for_window",
  title: "Wait For Window",
  description: [
    "Waits for a renderer window matching title/url/time constraints.",
    "What it does: polls the driver window list every 500ms until a matching window appears or timeout is reached.",
    "What it cannot do: this does not force window creation and cannot detect native OS dialogs outside Electron renderer windows.",
    "Defaults: timeout is 10000ms when omitted.",
    "Common error guidance: on timeout, inspect returned window diagnostics and retry with broader match criteria."
  ].join("\n"),
  inputSchema: WaitForWindowInputSchema,
  outputSchema: WaitForWindowOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: WaitForWindowInput, context) => {
    if (!hasWindowMatcher(input)) {
      throw createAirlockError(
        "INVALID_INPUT",
        "At least one matcher is required: titleContains, urlContains, or createdAfter.",
        false
      );
    }

    const managedSession = resolveManagedSession(context, input.sessionId);
    const firstSeenByWindowId = toFirstSeenMap(managedSession.session.windows, Date.now());
    const timeoutAtMs = Date.now() + input.timeoutMs;

    while (Date.now() <= timeoutAtMs) {
      const nowMs = Date.now();
      const windows = (await context.driver.getWindows(managedSession.driverSession)).map((window) => {
        if (!firstSeenByWindowId.has(window.id)) {
          firstSeenByWindowId.set(window.id, nowMs);
        }

        return toSessionWindow(window);
      });

      managedSession.session.windows = windows;
      pruneMissingTrackedWindows(managedSession);

      const focusedPrimaryWindow = windows.find((window) => window.kind === "primary" && window.focused);
      if (focusedPrimaryWindow !== undefined) {
        managedSession.lastFocusedPrimaryWindowId = focusedPrimaryWindow.windowId;
      }

      const matchedWindow = windows.find((window) => matchesWindow(window, firstSeenByWindowId, input));
      if (matchedWindow !== undefined) {
        managedSession.session.selectedWindowId = matchedWindow.windowId;
        managedSession.lastInteractedWindowId = matchedWindow.windowId;

        const now = new Date().toISOString();
        managedSession.session.updatedAt = now;
        managedSession.session.lastActivityAt = now;

        return {
          data: {
            windowId: matchedWindow.windowId,
            title: matchedWindow.title,
            url: matchedWindow.url
          },
          meta: {
            diagnostics: {
              pollIntervalMs: POLL_INTERVAL_MS,
              matchedWindowId: matchedWindow.windowId
            }
          }
        };
      }

      const remainingMs = timeoutAtMs - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      await sleep(Math.min(POLL_INTERVAL_MS, remainingMs));
    }

    throw createAirlockError("WINDOW_NOT_FOUND", "Timed out waiting for a matching window.", false, {
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
      ...(input.titleContains === undefined ? {} : { titleContains: input.titleContains }),
      ...(input.urlContains === undefined ? {} : { urlContains: input.urlContains }),
      ...(input.createdAfter === undefined ? {} : { createdAfter: input.createdAfter }),
      currentWindows: managedSession.session.windows.map((window) => ({
        windowId: window.windowId,
        title: window.title,
        url: window.url,
        kind: window.kind,
        focused: window.focused,
        visible: window.visible
      }))
    });
  }
});
