import { defineAirlockTool } from "../server.js";
import { createAirlockError } from "../types/index.js";
import { ConfirmInputSchema, ConfirmOutputSchema } from "../types/schemas.js";

export const confirmTool = defineAirlockTool({
  name: "confirm",
  title: "Confirm Pending Action",
  description: [
    "Marks a pending confirmation as approved and returns the original tool parameters.",
    "What it does: validates a confirmation id, marks it confirmed, and returns the tool name/params for a follow-up call.",
    "What it cannot do: it does not execute the original tool action.",
    "Defaults: confirmations expire after a short TTL and become invalid automatically.",
    "Common error guidance: INVALID_INPUT usually means the confirmation id is missing, expired, or already consumed."
  ].join("\n"),
  inputSchema: ConfirmInputSchema,
  outputSchema: ConfirmOutputSchema,
  handler: async (input, context) => {
    const confirmationStore = context.confirmationStore;
    if (confirmationStore === undefined) {
      throw createAirlockError("INTERNAL_ERROR", "Confirmation store is not configured.", false);
    }

    const pending = confirmationStore.get(input.confirmationId);
    if (pending === undefined) {
      throw createAirlockError(
        "INVALID_INPUT",
        `Confirmation "${input.confirmationId}" was not found or has expired.`,
        false,
        {
          confirmationId: input.confirmationId
        }
      );
    }

    const confirmedAtMs = Date.now();
    pending.confirmedAt = confirmedAtMs;

    return {
      data: {
        ok: true,
        toolName: pending.toolName,
        params: pending.params,
        confirmedAt: new Date(confirmedAtMs).toISOString()
      },
      meta: {
        suggestions: [
          `Re-run "${pending.toolName}" with the same parameters and include confirmationId="${input.confirmationId}".`
        ]
      }
    };
  }
});
