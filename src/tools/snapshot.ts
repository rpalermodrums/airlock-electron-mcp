import { z } from "zod";

import type { RawSnapshot } from "../driver/index.js";
import {
  buildQuerySnapshot,
  buildSnapshot,
  buildViewportSnapshot,
  type SnapshotOptions,
  type ViewportRect
} from "../snapshot/index.js";
import { RefMap } from "../snapshot/ref-map.js";
import { defineAirlockTool, type AirlockToolContext } from "../server.js";
import {
  SAFETY_MODES,
  sessionId as toSessionId,
  windowId as toWindowId,
  type Snapshot,
  type SnapshotQuery
} from "../types/index.js";
import {
  SnapshotInteractiveInputSchema,
  SnapshotInteractiveOutputSchema,
  SnapshotQueryInputSchema,
  SnapshotQueryOutputSchema,
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

const toSnapshotOptions = (
  input: {
    sessionId: string;
    windowId: string;
    filter: "interactive" | "all";
    maxNodes?: number;
    maxTextCharsPerNode?: number;
  },
  context: AirlockToolContext
): SnapshotOptions => {
  const requestedMaxNodes = input.maxNodes ?? context.limits.maxNodes;
  const requestedMaxText = input.maxTextCharsPerNode ?? context.limits.maxTextCharsPerNode;

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

const takeInteractiveLikeSnapshot = async (
  input: z.infer<typeof SnapshotInteractiveInputSchema> | z.infer<typeof SnapshotViewportInputSchema>,
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
      maxNodes: input.maxNodes,
      maxTextCharsPerNode: input.maxTextCharsPerNode
    },
    context
  );
  const snapshot =
    mode === "interactive"
      ? buildSnapshot(rawSnapshot, snapshotOptions)
      : buildViewportSnapshot(rawSnapshot, toViewportRect(rawSnapshot), snapshotOptions);

  cacheRefMap(context, snapshot);
  return toSnapshotResult(snapshot, targetWindow);
};

export const snapshotInteractiveTool = defineAirlockTool({
  name: "snapshot_interactive",
  title: "Snapshot Interactive",
  description:
    "Take an accessibility snapshot of the current window, filtered to interactive elements (buttons, links, inputs, etc.). Returns element refs that can be used with click/type/press tools. Default: max 250 nodes, 80 chars per text value. Use snapshot_query for targeted element discovery.",
  inputSchema: SnapshotInteractiveInputSchema,
  outputSchema: SnapshotInteractiveOutputSchema,
  allowedModes: SAFETY_MODES,
  annotations: {
    readOnlyHint: true
  },
  handler: async (input, context) => {
    return {
      data: await takeInteractiveLikeSnapshot(input, context, "interactive")
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

    cacheRefMap(context, querySnapshot);
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
