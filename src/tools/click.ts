import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { ClickInputSchema, ActionOutputSchema } from "../types/schemas.js";
import { toActionTarget, toActionToolResult, resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

const ClickOutputSchema = ActionOutputSchema;

type ClickInput = z.infer<typeof ClickInputSchema>;

export const clickTool = defineAirlockTool({
  name: "click",
  title: "Click Element",
  description: [
    "Click on an element identified by ref (from snapshot), role+name, testId, or CSS selector. Prefer using ref from a recent snapshot. Returns success status. If the ref is stale, take a new snapshot first.",
    "What it does: resolves the target, chooses the selected window by default, and performs a renderer click with optional button and keyboard modifiers.",
    "What it cannot do: this does not interact with native OS dialogs/menus and cannot recover stale refs without a new snapshot.",
    "Defaults: uses the session selected window when `windowId` is omitted, defaults `button` to `left`, and uses no modifier keys.",
    "Common error guidance: `REF_NOT_FOUND` or `REF_STALE` means run `snapshot_interactive()` and retry with a fresh ref; `WINDOW_NOT_FOUND` means list windows and pass `windowId` explicitly.",
    "Safety notes: CSS selectors are allowed but discouraged because they are brittle; prefer ref-based targeting."
  ].join("\n"),
  inputSchema: ClickInputSchema,
  outputSchema: ClickOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: ClickInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "click",
      target: toActionTarget(input.target),
      button: input.button,
      modifiers: input.modifiers
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify the click result.");
  }
});
