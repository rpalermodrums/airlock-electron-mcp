import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { ActionOutputSchema, HoverInputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow, toActionTarget, toActionToolResult } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type HoverInput = z.infer<typeof HoverInputSchema>;

export const hoverTool = defineAirlockTool({
  name: "hover",
  title: "Hover Element",
  description: [
    "Moves the pointer over an element identified by ref, role+name, testId, or css.",
    "What it does: resolves the target and performs a hover action on the resolved locator.",
    "What it cannot do: this does not click or activate elements; combine with click() when needed.",
    "Defaults: uses selected window when `windowId` is omitted.",
    "Common error guidance: if hover fails due stale refs, take a new snapshot and retry with a fresh target.",
    "Safety notes: prefer ref targets for resilience over css selectors."
  ].join("\n"),
  inputSchema: HoverInputSchema,
  outputSchema: ActionOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: HoverInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "hover",
      target: toActionTarget(input.target)
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify hover-driven UI state.");
  }
});
