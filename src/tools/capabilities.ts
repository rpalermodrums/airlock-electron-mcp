import process from "node:process";

import { z } from "zod";

import { defineAirlockTool } from "../server.js";

const CapabilitiesInputSchema = z.object({}).strict();

const CapabilitiesOutputSchema = z
  .object({
    mode: z.enum(["safe", "standard", "trusted"]),
    enabledTools: z.array(z.string().min(1)),
    presetSupport: z.object({
      activePreset: z.string().optional(),
      supportedPresets: z.array(z.string().min(1))
    }),
    limits: z.object({
      maxNodes: z.number().int().positive(),
      maxTextCharsPerNode: z.number().int().positive()
    }),
    version: z.object({
      name: z.literal("airlock-electron"),
      version: z.string().min(1),
      node: z.string().min(1),
      transport: z.literal("stdio")
    })
  })
  .strict();

export const capabilitiesTool = defineAirlockTool({
  name: "capabilities",
  title: "Server Capabilities",
  description: [
    "Returns the server capabilities, safety mode, enabled tools, and configuration limits. Call this first to understand what the server can do in its current mode.",
    "What it does: reports active safety mode, mode-filtered enabled tools, current preset support, configured snapshot limits, and server/version transport metadata.",
    "What it cannot do: this does not launch Electron, inspect window state, or prove sessions are healthy.",
    "Defaults: uses current runtime mode and startup configuration (`AIRLOCK_MODE`, `AIRLOCK_PRESET`) with default token limits when not overridden.",
    "Common error guidance: if output is missing expected tools, verify mode gating and then call `server_status()` and `doctor()` for runtime diagnostics.",
    "Safety notes: read-only tool; in safe mode it only reports restricted capabilities and never bypasses policy."
  ].join("\n"),
  inputSchema: CapabilitiesInputSchema,
  outputSchema: CapabilitiesOutputSchema,
  annotations: {
    readOnlyHint: true
  },
  handler: async (_input, context) => {
    const enabledTools = context.getEnabledTools();
    const presetSupport = {
      supportedPresets: [...context.supportedPresets],
      ...(context.preset === undefined ? {} : { activePreset: context.preset })
    };
    const output = {
      mode: context.mode,
      enabledTools: [...enabledTools],
      presetSupport,
      limits: {
        maxNodes: context.limits.maxNodes,
        maxTextCharsPerNode: context.limits.maxTextCharsPerNode
      },
      version: {
        name: "airlock-electron" as const,
        version: context.metadata.version,
        node: process.version,
        transport: "stdio" as const
      }
    };

    if (enabledTools.length === 0) {
      return {
        data: output,
        meta: {
          warnings: ["No enabled tools are currently available in this mode."],
          suggestions: ["Restart with a different AIRLOCK_MODE if you expected more tools."]
        }
      };
    }

    return {
      data: output
    };
  }
});
