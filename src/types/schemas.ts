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

export const SnapshotDiffValueSchema = z
  .object({
    before: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    after: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
  })
  .strict();

export const SnapshotDiffChangesSchema = z
  .object({
    name: SnapshotDiffValueSchema.optional(),
    value: SnapshotDiffValueSchema.optional(),
    checked: SnapshotDiffValueSchema.optional(),
    disabled: SnapshotDiffValueSchema.optional()
  })
  .strict();

export const SnapshotDiffInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  sinceEpoch: z.number().int().positive()
});

export const SnapshotDiffOutputSchema = z
  .object({
    window: SnapshotWindowResultSchema,
    sinceEpoch: z.number().int().positive(),
    currentEpoch: z.number().int().positive(),
    added: z.array(SnapshotNodeSchema),
    removed: z.array(SnapshotNodeSchema),
    changed: z.array(
      z
        .object({
          ref: z.string().min(1),
          changes: SnapshotDiffChangesSchema
        })
        .strict()
    ),
    context: z.array(SnapshotNodeSchema)
  })
  .strict();

export const SnapshotRegionRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive()
  })
  .strict();

export const SnapshotRegionInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  anchorRef: z.string().min(1).optional(),
  rect: SnapshotRegionRectSchema.optional(),
  radiusPx: z.number().int().nonnegative().max(5000).default(120),
  maxNodes: z.number().int().positive().max(2000).default(200),
  maxTextCharsPerNode: z.number().int().positive().max(1000).default(80)
});

export const SnapshotRegionOutputSchema = SnapshotResultSchema.extend({
  regionRect: SnapshotRegionRectSchema
}).strict();

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

export const AppKillInputSchema = z.object({
  sessionId: z.string().min(1)
});

export const AppKillOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string()
});

export const TraceStartOptionsSchema = z
  .object({
    screenshots: z.boolean().optional(),
    snapshots: z.boolean().optional()
  })
  .strict();

export const TraceStartInputSchema = z
  .object({
    sessionId: z.string().min(1),
    options: TraceStartOptionsSchema.optional()
  })
  .strict();

export const TraceStartOutputSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().min(1)
  })
  .strict();

export const TraceStopInputSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();

export const TraceStopOutputSchema = z
  .object({
    ok: z.boolean(),
    tracePath: z.string().min(1)
  })
  .strict();

export const ExportArtifactsInputSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();

export const ExportArtifactsOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    exportedAt: z.string().min(1),
    artifactPaths: z.array(z.string().min(1))
  })
  .strict();

export const DiagnoseSessionInputSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();

export const DiagnoseSessionOutputSchema = z
  .object({
    healthy: z.boolean(),
    issues: z.array(z.string().min(1)),
    lastActivity: z
      .object({
        sessionLastActivityAt: z.string().min(1),
        lastSuccessfulActionAt: z.string().min(1).optional(),
        secondsSinceSessionActivity: z.number().nonnegative(),
        secondsSinceLastSuccessfulAction: z.number().nonnegative().optional()
      })
      .strict(),
    recommendations: z.array(z.string().min(1))
  })
  .strict();

export const SessionInfoDetailedSchema = z
  .object({
    sessionId: z.string().min(1),
    state: SessionStateSchema,
    mode: SafetyModeSchema,
    launchMode: z.enum(["preset", "custom", "attached"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    lastActivityAt: z.string().min(1),
    windowCount: z.number().int().nonnegative(),
    selectedWindowId: z.string().min(1).optional(),
    platform: z
      .object({
        platform: z.string().min(1),
        arch: z.string().min(1),
        nodeVersion: z.string().min(1)
      })
      .strict(),
    artifactPaths: z
      .object({
        rootDir: z.string().min(1),
        sessionDir: z.string().min(1),
        screenshotsDir: z.string().min(1),
        logsDir: z.string().min(1),
        tracesDir: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const SessionInfoDetailedOutputSchema = z
  .object({
    session: SessionSchema,
    details: SessionInfoDetailedSchema
  })
  .strict();

export const WindowFocusInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1)
});

export const WindowFocusOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string()
});

export const WaitForWindowInputSchema = z.object({
  sessionId: z.string().min(1),
  titleContains: z.string().min(1).optional(),
  urlContains: z.string().min(1).optional(),
  createdAfter: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().max(120000).default(10000)
});

export const WaitForWindowOutputSchema = z.object({
  windowId: z.string().min(1),
  title: z.string(),
  url: z.string()
});

export const WindowDefaultGetInputSchema = z.object({
  sessionId: z.string().min(1)
});

export const WindowDefaultGetOutputSchema = z.object({
  defaultWindowId: z.string().min(1).nullable(),
  currentWindows: z.array(WindowSchema)
});

export const WindowDefaultSetInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1)
});

export const WindowDefaultSetOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  previousDefault: z.string().min(1).optional()
});

export const SelectInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema,
  value: z.string().min(1)
});

export const HoverInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema
});

export const ScrollToInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  target: ActionTargetSchema
});

export const ScrollToOutputSchema = z
  .object({
    ok: z.boolean(),
    scrolled: z.boolean(),
    message: z.string().optional()
  })
  .strict();

export const NetworkEntrySchema = z
  .object({
    url: z.string().min(1),
    method: z.string().min(1),
    status: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    timestamp: z.string().min(1)
  })
  .strict();

export const NetworkRecentInputSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(1000).default(50)
});

export const NetworkRecentOutputSchema = z.object({
  entries: z.array(NetworkEntrySchema)
});

export const ServerResetInputSchema = z.object({}).strict();

export const ServerResetOutputSchema = z.object({
  ok: z.boolean(),
  closedCount: z.number().int().nonnegative()
});

export const ConfirmInputSchema = z
  .object({
    confirmationId: z.string().min(1)
  })
  .strict();

export const ConfirmOutputSchema = z
  .object({
    ok: z.boolean(),
    toolName: z.string().min(1),
    params: z.unknown(),
    confirmedAt: z.string().min(1)
  })
  .strict();

export const ReadinessSignalKindSchema = z.enum([
  "processStable",
  "devServerReady",
  "windowCreated",
  "rendererReady",
  "appMarkerReady"
]);

export const ReadinessRetryPolicySchema = z
  .object({
    intervalMs: z.number().int().positive().optional(),
    maxAttempts: z.number().int().positive().optional()
  })
  .strict();

export const ReadinessSignalPresetSchema = z
  .object({
    kind: ReadinessSignalKindSchema,
    timeoutMs: z.number().int().positive(),
    retryPolicy: ReadinessRetryPolicySchema.optional(),
    optional: z.boolean().optional()
  })
  .strict();

export const LaunchPresetSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    mode: z.enum(["launch", "attach"]),
    devServer: z
      .object({
        command: z.string().min(1).optional(),
        readyPattern: z.instanceof(RegExp).optional(),
        readyUrl: z.string().min(1).optional(),
        timeoutMs: z.number().int().positive().optional()
      })
      .strict(),
    electronLaunch: z
      .object({
        entryPath: z.string().min(1).optional(),
        executablePath: z.string().min(1).optional(),
        defaultArgs: z.array(z.string().min(1)).optional(),
        defaultEnv: z.record(z.string()).optional(),
        attach: z
          .object({
            cdpUrl: z.string().min(1).optional(),
            wsEndpoint: z.string().min(1).optional()
          })
          .strict()
          .optional()
      })
      .strict(),
    readinessSignals: z.array(ReadinessSignalPresetSchema),
    diagnostics: z
      .object({
        processRingBufferLines: z.number().int().positive(),
        eventLogLimit: z.number().int().positive(),
        includeEnvPrefixes: z.array(z.string().min(1)),
        includeEnvKeys: z.array(z.string().min(1))
      })
      .strict()
  })
  .strict();

export const ReadinessTimelineEntrySchema = z
  .object({
    signalName: z.string().min(1),
    attempt: z.number().int().positive(),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    ready: z.boolean(),
    timedOut: z.boolean(),
    detail: z.string().optional(),
    error: z.string().optional(),
    diagnosticPayload: z.record(z.unknown()).optional()
  })
  .strict();

export const ProcessOutputSnapshotSchema = z
  .object({
    name: z.string().min(1),
    command: z.string().min(1).optional(),
    pid: z.number().int().positive().optional(),
    stdout: z.array(z.string()),
    stderr: z.array(z.string())
  })
  .strict();

export const LaunchDiagnosticEventSchema = z
  .object({
    timestamp: z.string().min(1),
    type: z.enum(["launch", "process", "signal", "window", "target", "attach"]),
    message: z.string().min(1),
    data: z.record(z.unknown()).optional()
  })
  .strict();

export const AttachDiagnosticsSchema = z
  .object({
    discoveredTargets: z
      .array(
        z
          .object({
            targetId: z.string().optional(),
            type: z.string().optional(),
            url: z.string().optional(),
            title: z.string().optional()
          })
          .strict()
      )
      .optional(),
    selectionRationale: z.string().optional(),
    selectedTargetId: z.string().optional(),
    selectedTargetUrl: z.string().optional()
  })
  .strict();

export const SanitizedEnvironmentSummarySchema = z
  .object({
    cwd: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    nodeVersion: z.string().min(1),
    pid: z.number().int().positive(),
    env: z.record(z.string()),
    redactedKeys: z.array(z.string())
  })
  .strict();

export const LaunchDiagnosticsSchema = z
  .object({
    capturedAt: z.string().min(1),
    processOutput: z.array(ProcessOutputSnapshotSchema),
    signalTimeline: z.array(ReadinessTimelineEntrySchema),
    eventLog: z.array(LaunchDiagnosticEventSchema),
    environment: SanitizedEnvironmentSummarySchema,
    attach: AttachDiagnosticsSchema.optional()
  })
  .strict();
