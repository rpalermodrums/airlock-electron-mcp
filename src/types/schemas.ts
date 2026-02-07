import { z } from "zod";
import { SAFETY_MODES } from "./policy.js";
import { SESSION_STATES, WINDOW_KINDS } from "./session.js";

export const SafetyModeSchema = z.enum(SAFETY_MODES);
export const SessionStateSchema = z.enum(SESSION_STATES);
export const WindowKindSchema = z.enum(WINDOW_KINDS);

export const WindowSchema = z.object({
  windowId: z.string().min(1),
  title: z.string(),
  url: z.string(),
  kind: WindowKindSchema,
  focused: z.boolean(),
  visible: z.boolean(),
  lastSeenAt: z.string().min(1)
});

export const SnapshotNodeSchema = z.object({
  ref: z.string().min(1),
  role: z.string().min(1),
  name: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  locatorHints: z
    .object({
      testId: z.string().optional(),
      roleAndName: z
        .object({
          role: z.string(),
          name: z.string()
        })
        .optional(),
      label: z.string().optional(),
      textContent: z.string().optional()
    })
    .optional()
});

export const SnapshotSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  truncated: z.boolean(),
  truncationReason: z.string().optional(),
  metadata: z
    .object({
      note: z.string().optional()
    })
    .optional(),
  nodes: z.array(SnapshotNodeSchema)
});

export const SessionSchema = z.object({
  sessionId: z.string().min(1),
  state: SessionStateSchema,
  mode: SafetyModeSchema,
  launchMode: z.enum(["preset", "custom", "attached"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastActivityAt: z.string().min(1),
  artifactDir: z.string().min(1),
  selectedWindowId: z.string().min(1).optional(),
  windows: z.array(WindowSchema)
});

export const SessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  state: SessionStateSchema,
  mode: SafetyModeSchema,
  selectedWindowId: z.string().min(1).optional(),
  windowCount: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastActivityAt: z.string().min(1)
});

export const AppLaunchInputSchema = z.object({
  projectRoot: z.string().min(1),
  preset: z.string().min(1).default("electron-vite"),
  mode: SafetyModeSchema.optional()
});
export const AppLaunchOutputSchema = z.object({
  sessionId: z.string().min(1),
  state: SessionStateSchema,
  selectedWindowId: z.string().min(1).optional(),
  windows: z.array(WindowSchema),
  artifactDir: z.string().min(1)
});

export const AppCloseInputSchema = z.object({
  sessionId: z.string().min(1)
});
export const AppCloseOutputSchema = z.object({
  sessionId: z.string().min(1),
  closed: z.boolean()
});

export const SessionInfoInputSchema = z.object({
  sessionId: z.string().min(1)
});
export const SessionInfoOutputSchema = z.object({
  session: SessionSchema
});

export const WindowListInputSchema = z.object({
  sessionId: z.string().min(1)
});
export const WindowListOutputSchema = z.object({
  windows: z.array(WindowSchema)
});

export const SnapshotInteractiveInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  maxNodes: z.number().int().positive().max(1000).default(250),
  maxTextCharsPerNode: z.number().int().positive().max(1000).default(80)
});

export const SnapshotQuerySchema = z
  .object({
    role: z.string().min(1).optional(),
    nameContains: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    textContains: z.string().min(1).optional()
  })
  .refine(
    (value) =>
      (value.role !== undefined && value.role.trim().length > 0) ||
      (value.nameContains !== undefined && value.nameContains.trim().length > 0) ||
      (value.testId !== undefined && value.testId.trim().length > 0) ||
      (value.textContains !== undefined && value.textContains.trim().length > 0),
    {
      message: "At least one query field is required."
    }
  );

export const SnapshotWindowResultSchema = z.object({
  title: z.string(),
  url: z.string()
});

export const SnapshotResultSchema = z.object({
  snapshotVersion: z.number().int().nonnegative(),
  window: SnapshotWindowResultSchema,
  nodes: z.array(SnapshotNodeSchema),
  truncated: z.boolean(),
  truncationReason: z.string().optional()
});

export const SnapshotInteractiveOutputSchema = SnapshotResultSchema;

export const SnapshotViewportInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  maxNodes: z.number().int().positive().max(1000).default(250),
  maxTextCharsPerNode: z.number().int().positive().max(1000).default(80)
});

export const SnapshotViewportOutputSchema = SnapshotResultSchema;

export const SnapshotQueryInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  query: SnapshotQuerySchema
});

export const SnapshotQueryOutputSchema = SnapshotResultSchema;

export const ActionTargetSchema = z
  .object({
    ref: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    css: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const usesRef = value.ref !== undefined;
    const usesRoleName = value.role !== undefined || value.name !== undefined;
    const usesTestId = value.testId !== undefined;
    const usesCss = value.css !== undefined;
    const strategyCount = [usesRef, usesRoleName, usesTestId, usesCss].filter(Boolean).length;

    if (strategyCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target must include one strategy: ref, role+name, testId, or css."
      });
      return;
    }

    if (strategyCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target must include only one strategy."
      });
      return;
    }

    if (usesRoleName && (value.role === undefined || value.name === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target with role requires both role and name."
      });
    }
  });

export const ClickInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema,
  button: z.enum(["left", "right"]).default("left"),
  modifiers: z.array(z.string().min(1)).default([])
});

export const TypeInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema,
  text: z.string(),
  replace: z.boolean().default(false)
});

export const PressKeyInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  key: z.string().min(1),
  modifiers: z.array(z.string().min(1)).default([])
});

export const ActionOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  screenshotPath: z.string().min(1).optional(),
  diagnostics: z.record(z.unknown()).optional()
});

export const ScreenshotInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  fullPage: z.boolean().default(false)
});
export const ScreenshotOutputSchema = z.object({
  path: z.string().min(1)
});

export const ConsoleRecentInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  level: z.enum(["error", "warning", "info", "log", "debug"]).default("log"),
  limit: z.number().int().positive().max(500).default(50)
});

export const ConsoleRecentOutputSchema = z.object({
  entries: z.array(
    z
      .object({
        level: z.enum(["error", "warning", "info", "log", "debug"]),
        message: z.string(),
        timestamp: z.string().min(1)
      })
      .strict()
  )
});

export const WaitForIdleInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(120000).default(10000)
});

export const WaitForVisibleInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema,
  timeoutMs: z.number().int().positive().max(120000).default(10000)
});

export const WaitForTextInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  text: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120000).default(10000)
});
