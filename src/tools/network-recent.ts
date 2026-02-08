import { z } from "zod";

import type { NetworkEntry } from "../driver/index.js";
import { defineAirlockTool } from "../server.js";
import { NetworkRecentInputSchema, NetworkRecentOutputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type NetworkRecentInput = z.infer<typeof NetworkRecentInputSchema>;

const toSortedRecent = (entries: readonly NetworkEntry[]): NetworkEntry[] => {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    return Number.isFinite(rightTime) && Number.isFinite(leftTime) ? rightTime - leftTime : 0;
  });
};

export const networkRecentTool = defineAirlockTool({
  name: "network_recent",
  title: "Recent Network Activity",
  description: [
    "Returns recent network requests/responses captured for a session window.",
    "What it does: reads the driver's in-memory network ring buffer and returns the most recent entries for the target window.",
    "What it cannot do: this does not include traffic emitted before listeners were attached and cannot recover historical logs after session close.",
    "Defaults: uses selected window when `windowId` is omitted and returns up to `limit` recent entries.",
    "Common error guidance: if results are empty, perform the app action first, then call network_recent() again.",
    "Safety notes: read-only diagnostics tool available in all modes."
  ].join("\n"),
  inputSchema: NetworkRecentInputSchema,
  outputSchema: NetworkRecentOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: NetworkRecentInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const entries = await context.driver.getNetworkLogs(managedSession.driverSession, {
      windowId: targetWindow.windowId,
      limit: input.limit
    });
    const recentEntries = toSortedRecent(entries).slice(0, input.limit);

    return {
      data: {
        entries: recentEntries
      },
      ...(recentEntries.length === 0
        ? {
            meta: {
              warnings: ["No recent network activity was captured for this window."],
              suggestions: ["Trigger the network action in-app, then call network_recent() again."]
            }
          }
        : {})
    };
  }
});
