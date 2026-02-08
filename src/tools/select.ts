import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { ActionOutputSchema, SelectInputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow, toActionTarget, toActionToolResult } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type SelectInput = z.infer<typeof SelectInputSchema>;

export const selectTool = defineAirlockTool({
  name: "select",
  title: "Select Option",
  description: [
    "Selects an option value from a target `<select>` element.",
    "What it does: resolves the target using ref/role+name/testId/css and performs a select action with the provided option value.",
    "What it cannot do: this does not choose custom non-native dropdown widgets unless they are wired as native selects.",
    "Defaults: uses selected window when `windowId` is omitted.",
    "Common error guidance: if refs are stale, capture a new snapshot and retry with a fresh ref.",
    "Safety notes: CSS targets are supported but less stable than snapshot refs."
  ].join("\n"),
  inputSchema: SelectInputSchema,
  outputSchema: ActionOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: SelectInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "select",
      target: toActionTarget(input.target),
      text: input.value
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify the selected option.");
  }
});
