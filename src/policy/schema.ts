import { z } from "zod";

import { SAFETY_MODES } from "../types/policy.js";

const NonEmptyStringSchema = z.string().trim().min(1);

const RegexPatternSchema = NonEmptyStringSchema.superRefine((pattern, context) => {
  try {
    // Validate user-provided regex patterns up front so redaction never fails at runtime.
    void new RegExp(pattern, "g");
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

export const PolicyToolsSchema = z
  .object({
    disabled: z.array(NonEmptyStringSchema).optional(),
    requireConfirmation: z.array(NonEmptyStringSchema).optional()
  })
  .strict();

export const PolicyFileSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(SAFETY_MODES).optional(),
    roots: z.array(NonEmptyStringSchema).optional(),
    allowedEnvVars: z.array(NonEmptyStringSchema).optional(),
    allowedOrigins: z.array(NonEmptyStringSchema).optional(),
    tools: PolicyToolsSchema.optional(),
    maxSessionTTLMs: z.number().int().positive().optional(),
    maxSnapshotNodes: z.number().int().positive().optional(),
    redactionPatterns: z.array(RegexPatternSchema).optional()
  })
  .strict();
