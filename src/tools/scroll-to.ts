import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import { SAFETY_MODES } from "../types/index.js";
import { ScrollToInputSchema, ScrollToOutputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow, toActionTarget } from "./helpers.js";

type ScrollToInput = z.infer<typeof ScrollToInputSchema>;

export const scrollToTool = defineAirlockTool({
  name: "scroll_to",
  title: "Scroll To Element",
  description: [
    "Best-effort scroll that brings a target element into view using Playwright locator scrolling behavior.",
    "What it does: resolves target by ref/role+name/testId/css and runs a non-click hover action to trigger scrollIntoViewIfNeeded.",
    "What it cannot do: it does not click, focus, or guarantee the element is interactable after scrolling.",
    "Defaults: uses selected window when `windowId` is omitted.",
    "Common error guidance: stale refs require a fresh snapshot before retry.",
    "Safety notes: use snapshot refs when possible; raw CSS selectors are brittle."
  ].join("\n"),
  inputSchema: ScrollToInputSchema,
  outputSchema: ScrollToOutputSchema,
  allowedModes: SAFETY_MODES,
  handler: async (input: ScrollToInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "hover",
      target: toActionTarget(input.target)
    });

    const output: z.infer<typeof ScrollToOutputSchema> = {
      ok: actionResult.ok,
      scrolled: actionResult.ok,
      ...(actionResult.message === undefined
        ? {
            message: actionResult.ok ? "Target was scrolled into view." : "Failed to scroll target into view."
          }
        : { message: actionResult.message })
    };

    return actionResult.ok
      ? {
          data: output,
          meta: {
            suggestions: ["Run snapshot_region() or snapshot_viewport() to confirm the current on-screen context."]
          }
        }
      : {
          data: output,
          meta: {
            ...(actionResult.diagnostics === undefined ? {} : { diagnostics: actionResult.diagnostics }),
            suggestions: [
              "Take a fresh snapshot and retry with a current ref.",
              "Use snapshot_region() with a larger radius around a nearby anchor."
            ]
          }
        };
  }
});
