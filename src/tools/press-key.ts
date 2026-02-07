import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { ActionOutputSchema, PressKeyInputSchema } from "../types/schemas.js";
import { toActionToolResult, resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

const PressKeyOutputSchema = ActionOutputSchema;

type PressKeyInput = z.infer<typeof PressKeyInputSchema>;

const toKeyCombo = (key: string, modifiers: readonly string[]): string => {
  return [...modifiers, key].join("+");
};

export const pressKeyTool = defineAirlockTool({
  name: "press_key",
  title: "Press Keyboard Key",
  description: [
    "Press a keyboard key or key combination. Use for Enter, Tab, Escape, shortcuts like Control+S, etc. Does not require a target element.",
    "What it does: focuses the selected window (or provided window) and sends a keyboard action using `key` plus optional modifiers.",
    "What it cannot do: this does not synthesize OS-global shortcuts outside the app and does not click/focus elements for you.",
    "Defaults: uses selected window when `windowId` is omitted and uses a single key press when no modifiers are supplied.",
    "Common error guidance: if the app does not respond, ensure the expected window is selected and retry with explicit `windowId`; capture `screenshot()` for state verification.",
    "Safety notes: keyboard shortcuts can trigger destructive app actions, so verify focus and mode before use."
  ].join("\n"),
  inputSchema: PressKeyInputSchema,
  outputSchema: PressKeyOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: PressKeyInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const keyCombo = toKeyCombo(input.key, input.modifiers);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "press_key",
      key: keyCombo
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify keyboard side effects.");
  }
});
