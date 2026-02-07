import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { ActionOutputSchema, TypeInputSchema } from "../types/schemas.js";
import { toActionTarget, toActionToolResult, resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

const TypeOutputSchema = ActionOutputSchema;

type TypeInput = z.infer<typeof TypeInputSchema>;

export const typeTool = defineAirlockTool({
  name: "type",
  title: "Type Text",
  description: [
    "Type text into an input element. Appends text by default. Use this for text fields, search boxes, and other text inputs. Target the element using ref from a snapshot.",
    "What it does: resolves the target and sends either a `type` action (append) or `fill` action (replace existing content).",
    "What it cannot do: this does not target non-text native controls and cannot infer a missing target from context.",
    "Defaults: uses selected window when `windowId` is omitted and appends text unless `replace` is set to true.",
    "Common error guidance: if `REF_STALE` occurs, refresh with `snapshot_interactive()` and retry; if typing fails, take `screenshot()` then inspect `console_recent()`.",
    "Safety notes: ref-based targeting is most stable; CSS fallback is available but fragile."
  ].join("\n"),
  inputSchema: TypeInputSchema,
  outputSchema: TypeOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: TypeInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: input.replace ? "fill" : "type",
      target: toActionTarget(input.target),
      text: input.text
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify the typed value.");
  }
});
