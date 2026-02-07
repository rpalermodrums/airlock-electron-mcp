import { z } from "zod";

import type { ConsoleEntry } from "../driver/index.js";
import { defineAirlockTool } from "../server.js";
import { ConsoleRecentInputSchema, ConsoleRecentOutputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type ConsoleRecentInput = z.infer<typeof ConsoleRecentInputSchema>;
type ConsoleOutputLevel = "error" | "warning" | "info" | "log" | "debug";

const LEVEL_ORDER: Record<ConsoleOutputLevel, number> = {
  debug: 0,
  log: 1,
  info: 2,
  warning: 3,
  error: 4
};

const toOutputLevel = (entryLevel: ConsoleEntry["level"]): ConsoleOutputLevel => {
  if (entryLevel === "error") {
    return "error";
  }

  if (entryLevel === "warn") {
    return "warning";
  }

  if (entryLevel === "trace" || entryLevel === "debug") {
    return "debug";
  }

  return "info";
};

const meetsLevelFilter = (entryLevel: ConsoleOutputLevel, filterLevel: ConsoleOutputLevel): boolean => {
  return LEVEL_ORDER[entryLevel] >= LEVEL_ORDER[filterLevel];
};

const toSortedRecent = (entries: readonly { level: ConsoleOutputLevel; message: string; timestamp: string }[]) => {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    return Number.isFinite(rightTime) && Number.isFinite(leftTime) ? rightTime - leftTime : 0;
  });
};

export const consoleRecentTool = defineAirlockTool({
  name: "console_recent",
  title: "Recent Console Messages",
  description: [
    "Get recent console messages from the Electron renderer. Useful for debugging errors or verifying application behavior. Returns the most recent messages filtered by level.",
    "What it does: reads renderer console logs for the session, normalizes levels, filters by requested level, and returns up to `limit` entries.",
    "What it cannot do: this does not include native process stdout/stderr and may miss logs emitted before session attach.",
    "Defaults: uses selected window context when `windowId` is omitted, `level=log`, and `limit=50`.",
    "Common error guidance: if logs are empty after a failing action, capture `screenshot()` and retry the action with explicit waits before checking logs again.",
    "Safety notes: read-only diagnostics tool; safe in all modes."
  ].join("\n"),
  inputSchema: ConsoleRecentInputSchema,
  outputSchema: ConsoleRecentOutputSchema,
  allowedModes: ALL_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input: ConsoleRecentInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    if (input.windowId !== undefined) {
      resolveWindow(managedSession, input.windowId);
    }

    const rawEntries = await context.driver.getConsoleLogs(managedSession.driverSession, {
      limit: Math.max(input.limit * 3, input.limit)
    });
    const normalizedEntries = rawEntries.map((entry) => ({
      level: toOutputLevel(entry.level),
      message: entry.message,
      timestamp: entry.timestamp
    }));
    const filteredEntries = normalizedEntries.filter((entry) => meetsLevelFilter(entry.level, input.level));
    const recentEntries = toSortedRecent(filteredEntries).slice(0, input.limit);

    return {
      data: {
        entries: recentEntries
      },
      meta: {
        suggestions: ["Use this output with screenshot() and event history to diagnose failures quickly."]
      }
    };
  }
});
