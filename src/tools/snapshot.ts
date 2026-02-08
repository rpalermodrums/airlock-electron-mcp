import { z } from "zod";

import type { RawSnapshot, RawSnapshotRect } from "../driver/index.js";
import {
  buildQuerySnapshot,
  buildRegionSnapshot,
  buildSnapshot,
  buildSnapshotDiff,
  buildViewportSnapshot,
  findSnapshotNodeBounds,
  type SnapshotOptions,
  type ViewportRect
} from "../snapshot/index.js";
import { RefMap } from "../snapshot/ref-map.js";
import { defineAirlockTool, type AirlockToolContext } from "../server.js";
import {
  createAirlockError,
  refId,
  SAFETY_MODES,
  sessionId as toSessionId,
  windowId as toWindowId,
  type Snapshot,
  type SnapshotQuery
} from "../types/index.js";
import {
  SnapshotDiffInputSchema,
  SnapshotDiffOutputSchema,
  SnapshotInteractiveInputSchema,
  SnapshotInteractiveOutputSchema,
  SnapshotQueryInputSchema,
  SnapshotQueryOutputSchema,
  SnapshotRegionInputSchema,
  SnapshotRegionOutputSchema,
  SnapshotViewportInputSchema,
  SnapshotViewportOutputSchema
} from "../types/schemas.js";
import { resolveManagedSession, resolveWindow, toDriverWindow } from "./helpers.js";

const DEFAULT_VIEWPORT_RECT: ViewportRect = {
  x: 0,
  y: 0,
  width: 1280,
  height: 720
};
const SNAPSHOT_HISTORY_LIMIT = 5;
const INTERACTIVE_DEFAULT_MAX_NODES = 200;
const DEFAULT_REGION_RADIUS_PX = 120;
const RESOLUTION_MAX_NODES = 2000;

const SnapshotInteractiveToolInputSchema = SnapshotInteractiveInputSchema.extend({
  maxNodes: z.number().int().positive().max(1000).optional(),
  maxTextCharsPerNode: z.number().int().positive().max(1000).optional()
});

type SnapshotMode = "interactive" | "viewport" | "query" | "region" | "diff";

interface SnapshotHistoryEntry {
  snapshot: Snapshot;
  mode: SnapshotMode;
}

const snapshotHistoryByWindow = new Map<string, readonly SnapshotHistoryEntry[]>();

const toHistoryKey = (sessionId: string, windowId: string): string => {
  return `${sessionId}:${windowId}`;
};

const cacheSnapshotHistory = (snapshot: Snapshot, mode: SnapshotMode): void => {
  const sessionId = String(snapshot.sessionId);
  const windowId = String(snapshot.windowId);
  const historyKey = toHistoryKey(sessionId, windowId);
  const currentEntries = snapshotHistoryByWindow.get(historyKey) ?? [];
  const dedupedEntries = [
    ...currentEntries.filter((entry) => entry.snapshot.version !== snapshot.version),
    {
      snapshot,
      mode
    }
  ];
  const nextEntries = dedupedEntries.slice(-SNAPSHOT_HISTORY_LIMIT);
  snapshotHistoryByWindow.set(historyKey, nextEntries);
};

const getSnapshotHistoryEntry = (
  sessionId: string,
  windowId: string,
  sinceEpoch: number
): SnapshotHistoryEntry | undefined => {
  const historyKey = toHistoryKey(sessionId, windowId);
  const entries = snapshotHistoryByWindow.get(historyKey) ?? [];
  return entries.find((entry) => entry.snapshot.version === sinceEpoch);
};

const getSnapshotHistoryEpochs = (sessionId: string, windowId: string): readonly number[] => {
  const historyKey = toHistoryKey(sessionId, windowId);
  const entries = snapshotHistoryByWindow.get(historyKey) ?? [];
  return entries.map((entry) => entry.snapshot.version);
};

const toSnapshotOptions = (
  input: {
    sessionId: string;
    windowId: string;
    filter: "interactive" | "all";
    maxNodes?: number;
    maxTextCharsPerNode?: number;
  },
  context: AirlockToolContext,
  defaults?: {
    maxNodes?: number;
    maxTextCharsPerNode?: number;
  }
): SnapshotOptions => {
  const requestedMaxNodes = input.maxNodes ?? defaults?.maxNodes ?? context.limits.maxNodes;
  const requestedMaxText =
    input.maxTextCharsPerNode ?? defaults?.maxTextCharsPerNode ?? context.limits.maxTextCharsPerNode;

  return {
    sessionId: toSessionId(input.sessionId),
    windowId: toWindowId(input.windowId),
    filter: input.filter,
    maxNodes: Math.max(1, requestedMaxNodes),
    maxTextCharsPerNode: Math.max(1, requestedMaxText)
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toSnapshotQuery = (query: z.infer<typeof SnapshotQueryInputSchema>["query"]): SnapshotQuery => {
  return {
    ...(query.role === undefined ? {} : { role: query.role }),
    ...(query.nameContains === undefined ? {} : { nameContains: query.nameContains }),
    ...(query.testId === undefined ? {} : { testId: query.testId }),
    ...(query.textContains === undefined ? {} : { textContains: query.textContains })
  };
};

const toViewportRect = (rawSnapshot: RawSnapshot): ViewportRect => {
  const candidates = [
    rawSnapshot.viewportRect,
    isRecord(rawSnapshot.metadata) ? rawSnapshot.metadata.viewportRect : undefined,
    isRecord(rawSnapshot.metadata) ? rawSnapshot.metadata.viewport : undefined
  ];

  const firstValidCandidate = candidates.find((candidate) => {
    if (!isRecord(candidate)) {
      return false;
    }

    const x = candidate.x;
    const y = candidate.y;
    const width = candidate.width;
    const height = candidate.height;

    return (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y) &&
      typeof width === "number" &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === "number" &&
      Number.isFinite(height) &&
      height > 0
    );
  });

  if (!isRecord(firstValidCandidate)) {
    return DEFAULT_VIEWPORT_RECT;
  }

  return {
    x: firstValidCandidate.x as number,
    y: firstValidCandidate.y as number,
    width: firstValidCandidate.width as number,
    height: firstValidCandidate.height as number
  };
};

const cacheRefMap = (context: AirlockToolContext, snapshot: Snapshot): void => {
  const sessionId = String(snapshot.sessionId);
  const windowId = String(snapshot.windowId);
  const existingRefMap = context.sessions.getRefMap(sessionId, windowId) ?? new RefMap();
  existingRefMap.rebuildFromSnapshot(snapshot.nodes);
  context.sessions.setRefMap(sessionId, windowId, existingRefMap);
};

const persistSnapshot = (context: AirlockToolContext, snapshot: Snapshot, mode: SnapshotMode): void => {
  cacheRefMap(context, snapshot);
  cacheSnapshotHistory(snapshot, mode);
};

const toSnapshotResult = (
  snapshot: Snapshot,
  window: { title: string; url: string }
): z.infer<typeof SnapshotInteractiveOutputSchema> => {
  return {
    snapshotVersion: snapshot.version,
    window: {
      title: window.title,
      url: window.url
    },
    nodes: snapshot.nodes,
    truncated: snapshot.truncated,
    ...(snapshot.truncationReason === undefined ? {} : { truncationReason: snapshot.truncationReason })
  };
};

const toExpandedRect = (rect: RawSnapshotRect, radiusPx: number): ViewportRect => {
  return {
    x: rect.x - radiusPx,
    y: rect.y - radiusPx,
    width: Math.max(1, rect.width + radiusPx * 2),
    height: Math.max(1, rect.height + radiusPx * 2)
  };
};

const toRadiusPx = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_REGION_RADIUS_PX;
  }

  return Math.max(0, Math.floor(value));
};

const resolveRegionRectFromAnchor = (
  context: AirlockToolContext,
  params: {
    sessionId: string;
    windowId: string;
    anchorRef: string;
    rawSnapshot: RawSnapshot;
    radiusPx?: number;
    maxNodes?: number;
    maxTextCharsPerNode?: number;
  }
): ViewportRect => {
  const refMap = context.sessions.getRefMap(params.sessionId, params.windowId);
  if (refMap === undefined) {
    throw createAirlockError(
      "REF_NOT_FOUND",
      `Anchor ref "${params.anchorRef}" cannot be resolved because no snapshot ref map is cached for window "${params.windowId}".`,
      false,
      {
        sessionId: params.sessionId,
        windowId: params.windowId,
        ref: params.anchorRef
      }
    );
  }

  const resolutionSnapshot = buildSnapshot(
    params.rawSnapshot,
    toSnapshotOptions(
      {
        sessionId: params.sessionId,
        windowId: params.windowId,
        filter: "all",
        ...(params.maxTextCharsPerNode === undefined ? {} : { maxTextCharsPerNode: params.maxTextCharsPerNode })
      },
      context,
      {
        maxNodes: RESOLUTION_MAX_NODES
      }
    )
  );
  const resolvedRef = refMap.reResolveRef(refId(params.anchorRef), resolutionSnapshot);
  if (resolvedRef === null) {
    throw createAirlockError(
      "REF_NOT_FOUND",
      `Anchor ref "${params.anchorRef}" could not be resolved in the current snapshot.`,
      false,
      {
        sessionId: params.sessionId,
        windowId: params.windowId,
        ref: params.anchorRef
      }
    );
  }

  const anchorNode = resolutionSnapshot.nodes.find((node) => node.ref === resolvedRef);
  if (anchorNode === undefined) {
    throw createAirlockError(
      "REF_NOT_FOUND",
      `Resolved anchor ref "${resolvedRef}" is not available in the current snapshot.`,
      false,
      {
        sessionId: params.sessionId,
        windowId: params.windowId,
        ref: params.anchorRef,
        resolvedRef
      }
    );
  }

  const bounds = findSnapshotNodeBounds(params.rawSnapshot, anchorNode);
  if (bounds === undefined) {
    throw createAirlockError(
      "REF_NOT_FOUND",
      `Resolved anchor ref "${resolvedRef}" does not expose bounding-box data for region filtering.`,
      false,
      {
        sessionId: params.sessionId,
        windowId: params.windowId,
        ref: params.anchorRef,
        resolvedRef
      }
    );
  }

  return toExpandedRect(bounds, toRadiusPx(params.radiusPx));
};

const toInteractiveTruncationMeta = (output: z.infer<typeof SnapshotInteractiveOutputSchema>) => {
  if (!output.truncated) {
    return undefined;
  }

  return {
    suggestions: ["Consider using snapshot_query for focused results."],
    diagnostics: {
      snapshotTruncated: true,
      truncationReason: output.truncationReason ?? "Snapshot exceeded configured limits.",
      returnedNodeCount: output.nodes.length
    }
  };
};

const takeInteractiveLikeSnapshot = async (
  input: z.infer<typeof SnapshotInteractiveToolInputSchema> | z.infer<typeof SnapshotViewportInputSchema>,
  context: AirlockToolContext,
  mode: "interactive" | "viewport"
): Promise<z.infer<typeof SnapshotInteractiveOutputSchema>> => {
  const managedSession = resolveManagedSession(context, input.sessionId);
  const targetWindow = resolveWindow(managedSession, input.windowId);
  const rawSnapshot = await context.driver.getSnapshot(toDriverWindow(targetWindow));
  const snapshotOptions = toSnapshotOptions(
    {
      sessionId: input.sessionId,
      windowId: targetWindow.windowId,
      filter: "interactive",
      ...(input.maxNodes === undefined ? {} : { maxNodes: input.maxNodes }),
      ...(input.maxTextCharsPerNode === undefined ? {} : { maxTextCharsPerNode: input.maxTextCharsPerNode })
    },
    context,
    mode === "interactive"
      ? {
          maxNodes: INTERACTIVE_DEFAULT_MAX_NODES
        }
      : undefined
  );
  const snapshot =
    mode === "interactive"
      ? buildSnapshot(rawSnapshot, snapshotOptions)
      : buildViewportSnapshot(rawSnapshot, toViewportRect(rawSnapshot), snapshotOptions);

  persistSnapshot(context, snapshot, mode);
  return toSnapshotResult(snapshot, targetWindow);
};

export const snapshotInteractiveTool = defineAirlockTool({
  name: "snapshot_interactive",
  title: "Snapshot Interactive",
  description:
    "Take an accessibility snapshot of the current window, filtered to interactive elements (buttons, links, inputs, etc.). Returns element refs that can be used with click/type/press tools. Default: max 200 nodes, 80 chars per text value. Use snapshot_query for targeted element discovery.",
  inputSchema: SnapshotInteractiveToolInputSchema,
  outputSchema: SnapshotInteractiveOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    const output = await takeInteractiveLikeSnapshot(input, context, "interactive");
    const truncationMeta = toInteractiveTruncationMeta(output);

    return truncationMeta === undefined
      ? {
          data: output
        }
      : {
          data: output,
          meta: truncationMeta
        };
  }
});

export const snapshotViewportTool = defineAirlockTool({
  name: "snapshot_viewport",
  title: "Snapshot Viewport",
  description:
    "Take a viewport-scoped snapshot, showing only elements likely visible on screen. Smaller than full snapshots. Use when the UI is complex and you need to reduce noise.",
  inputSchema: SnapshotViewportInputSchema,
  outputSchema: SnapshotViewportOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    return {
      data: await takeInteractiveLikeSnapshot(input, context, "viewport")
    };
  }
});

export const snapshotQueryTool = defineAirlockTool({
  name: "snapshot_query",
  title: "Snapshot Query",
  description:
    "Search for specific elements by role, name, test ID, or text content. Returns matching elements with ancestor context. This is the most token-efficient snapshot mode — use it when you know what you are looking for.",
  inputSchema: SnapshotQueryInputSchema,
  outputSchema: SnapshotQueryOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const rawSnapshot = await context.driver.getSnapshot(toDriverWindow(targetWindow));
    const querySnapshot = buildQuerySnapshot(
      rawSnapshot,
      toSnapshotQuery(input.query),
      toSnapshotOptions(
        {
          sessionId: input.sessionId,
          windowId: targetWindow.windowId,
          filter: "all",
          maxNodes: context.limits.maxNodes,
          maxTextCharsPerNode: context.limits.maxTextCharsPerNode
        },
        context
      )
    );

    persistSnapshot(context, querySnapshot, "query");
    const output = toSnapshotResult(querySnapshot, targetWindow);

    return output.nodes.length > 0
      ? {
          data: output
        }
      : {
          data: output,
          meta: {
            suggestions: [
              "No matches found. Broaden `nameContains`/`textContains` or run snapshot_interactive() for discovery."
            ]
          }
        };
  }
});

export const snapshotDiffTool = defineAirlockTool({
  name: "snapshot_diff",
  title: "Snapshot Diff",
  description:
    "Compare the current interactive snapshot to a previous snapshot epoch and return only added/removed/changed nodes with concise context.",
  inputSchema: SnapshotDiffInputSchema,
  outputSchema: SnapshotDiffOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const historyEntry = getSnapshotHistoryEntry(input.sessionId, targetWindow.windowId, input.sinceEpoch);

    if (historyEntry === undefined) {
      throw createAirlockError(
        "INVALID_INPUT",
        `No snapshot history entry was found for sinceEpoch=${input.sinceEpoch} in window "${targetWindow.windowId}".`,
        false,
        {
          sessionId: input.sessionId,
          windowId: targetWindow.windowId,
          sinceEpoch: input.sinceEpoch,
          availableEpochs: getSnapshotHistoryEpochs(input.sessionId, targetWindow.windowId)
        }
      );
    }

    const rawSnapshot = await context.driver.getSnapshot(toDriverWindow(targetWindow));
    const currentSnapshot = buildSnapshot(
      rawSnapshot,
      toSnapshotOptions(
        {
          sessionId: input.sessionId,
          windowId: targetWindow.windowId,
          filter: "interactive"
        },
        context,
        {
          maxNodes: INTERACTIVE_DEFAULT_MAX_NODES
        }
      )
    );

    persistSnapshot(context, currentSnapshot, "diff");
    const diff = buildSnapshotDiff(currentSnapshot, historyEntry.snapshot);
    const output: z.infer<typeof SnapshotDiffOutputSchema> = {
      window: {
        title: targetWindow.title,
        url: targetWindow.url
      },
      sinceEpoch: input.sinceEpoch,
      currentEpoch: currentSnapshot.version,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      context: diff.context
    };

    const hasChanges = output.added.length > 0 || output.removed.length > 0 || output.changed.length > 0;
    return hasChanges
      ? {
          data: output
        }
      : {
          data: output,
          meta: {
            suggestions: [
              "No changes detected for this epoch pair. Run another interaction and capture a fresh snapshot before diffing."
            ]
          }
        };
  }
});

export const snapshotRegionTool = defineAirlockTool({
  name: "snapshot_region",
  title: "Snapshot Region",
  description:
    "Capture a region-scoped snapshot around a bounding rect or an anchor ref (+radius). Returns nodes intersecting the region plus nearby context ancestors.",
  inputSchema: SnapshotRegionInputSchema,
  outputSchema: SnapshotRegionOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const rawSnapshot = await context.driver.getSnapshot(toDriverWindow(targetWindow));
    if (input.rect !== undefined && input.anchorRef !== undefined) {
      throw createAirlockError(
        "INVALID_INPUT",
        "Provide exactly one of `rect` or `anchorRef` for snapshot_region.",
        false
      );
    }

    const regionRect = (() => {
      if (input.rect !== undefined) {
        return input.rect;
      }

      if (input.anchorRef === undefined) {
        throw createAirlockError("INVALID_INPUT", "Provide either `rect` or `anchorRef` for snapshot_region.", false);
      }

      return resolveRegionRectFromAnchor(context, {
        sessionId: input.sessionId,
        windowId: targetWindow.windowId,
        anchorRef: input.anchorRef,
        rawSnapshot,
        radiusPx: input.radiusPx,
        maxNodes: input.maxNodes,
        maxTextCharsPerNode: input.maxTextCharsPerNode
      });
    })();
    const regionSnapshot = buildRegionSnapshot(
      rawSnapshot,
      regionRect,
      toSnapshotOptions(
        {
          sessionId: input.sessionId,
          windowId: targetWindow.windowId,
          filter: "all",
          maxNodes: input.maxNodes,
          maxTextCharsPerNode: input.maxTextCharsPerNode
        },
        context
      )
    );

    persistSnapshot(context, regionSnapshot, "region");
    const output: z.infer<typeof SnapshotRegionOutputSchema> = {
      ...toSnapshotResult(regionSnapshot, targetWindow),
      regionRect
    };

    return output.nodes.length > 0
      ? {
          data: output
        }
      : {
          data: output,
          meta: {
            suggestions: ["No nodes intersected this region. Increase `radiusPx` or use a larger `rect` and retry."]
          }
        };
  }
});
