import type { RawSnapshot, RawSnapshotNode, RawSnapshotRect } from "../driver/index.js";
import {
  refId,
  type SessionId,
  type Snapshot,
  type SnapshotNode,
  type SnapshotQuery,
  type WindowId
} from "../types/session.js";

const DEFAULT_MAX_NODES = 250;
const DEFAULT_MAX_TEXT_CHARS_PER_NODE = 80;
const VIEWPORT_DEPTH_LIMIT = 8;
const QUERY_ANCESTOR_DEPTH = 2;
const RANGE_SAFE_MIN = 1;
const INTERACTIVE_ROLE_SET = new Set([
  "button",
  "link",
  "textbox",
  "textfield",
  "checkbox",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "slider",
  "spinbutton",
  "switch"
]);

const snapshotVersionByWindow = new Map<string, number>();

export interface SnapshotOptions {
  sessionId: SessionId;
  windowId: WindowId;
  filter: "interactive" | "all";
  maxNodes?: number;
  maxTextCharsPerNode?: number;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NormalizedSnapshotOptions {
  sessionId: SessionId;
  windowId: WindowId;
  filter: "interactive" | "all";
  maxNodes: number;
  maxTextCharsPerNode: number;
}

interface FlattenedNode {
  id: string;
  depth: number;
  node: RawSnapshotNode;
  ancestorIds: readonly string[];
}

interface PreparedNode {
  node: Omit<SnapshotNode, "ref">;
  hasTextTruncation: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toNodeRecord = (node: RawSnapshotNode): Record<string, unknown> => {
  return node as unknown as Record<string, unknown>;
};

const sanitizeInteger = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  return Math.max(RANGE_SAFE_MIN, rounded);
};

const normalizeOptions = (options: SnapshotOptions): NormalizedSnapshotOptions => {
  return {
    sessionId: options.sessionId,
    windowId: options.windowId,
    filter: options.filter,
    maxNodes: sanitizeInteger(options.maxNodes, DEFAULT_MAX_NODES),
    maxTextCharsPerNode: sanitizeInteger(options.maxTextCharsPerNode, DEFAULT_MAX_TEXT_CHARS_PER_NODE)
  };
};

const normalizeRole = (role: string): string => {
  return role
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
};

const isInteractiveRole = (role: string): boolean => {
  return INTERACTIVE_ROLE_SET.has(normalizeRole(role));
};

const flattenNodes = (
  nodes: readonly RawSnapshotNode[],
  parentId: string = "",
  depth: number = 0,
  ancestorIds: readonly string[] = []
): readonly FlattenedNode[] => {
  return nodes.flatMap((node, index) => {
    const nodeId = parentId.length > 0 ? `${parentId}.${index}` : `${index}`;
    const flattenedNode: FlattenedNode = {
      id: nodeId,
      depth,
      node,
      ancestorIds
    };
    const children = Array.isArray(node.children) ? node.children : [];
    const childAncestors = [...ancestorIds, nodeId];
    return [flattenedNode, ...flattenNodes(children, nodeId, depth + 1, childAncestors)];
  });
};

const hasIntersection = (left: RawSnapshotRect, right: ViewportRect): boolean => {
  const leftRightEdge = left.x + left.width;
  const leftBottomEdge = left.y + left.height;
  const rightRightEdge = right.x + right.width;
  const rightBottomEdge = right.y + right.height;
  return left.x < rightRightEdge && leftRightEdge > right.x && left.y < rightBottomEdge && leftBottomEdge > right.y;
};

const toRect = (value: unknown): RawSnapshotRect | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  const isValid =
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    typeof height === "number" &&
    Number.isFinite(height);

  return isValid ? { x, y, width, height } : undefined;
};

const getNodeBounds = (node: RawSnapshotNode): RawSnapshotRect | undefined => {
  const directBounds = toRect(node.bounds);
  if (directBounds !== undefined) {
    return directBounds;
  }

  const directBoundingBox = toRect(node.boundingBox);
  if (directBoundingBox !== undefined) {
    return directBoundingBox;
  }

  const record = toNodeRecord(node);
  return toRect(record.rect);
};

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readAttributeValue = (node: RawSnapshotNode, keys: readonly string[]): string | undefined => {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const nodeRecord = toNodeRecord(node);
  const directMatch = Object.entries(nodeRecord).find(([key]) => normalizedKeys.has(key.toLowerCase()));
  const directValue = trimString(directMatch?.[1]);
  if (directValue !== undefined) {
    return directValue;
  }

  const attributes = node.attributes;
  if (attributes === undefined) {
    return undefined;
  }

  const attrMatch = Object.entries(attributes).find(([key]) => normalizedKeys.has(key.toLowerCase()));
  return trimString(attrMatch?.[1]);
};

const truncateText = (value: string, maxLength: number): { value: string; truncated: boolean } => {
  if (value.length <= maxLength) {
    return {
      value,
      truncated: false
    };
  }

  if (maxLength <= 3) {
    return {
      value: value.slice(0, maxLength),
      truncated: true
    };
  }

  return {
    value: `${value.slice(0, maxLength - 3)}...`,
    truncated: true
  };
};

const truncateOptionalString = (
  value: string | undefined,
  maxLength: number
): { value?: string; truncated: boolean } => {
  if (value === undefined) {
    return {
      truncated: false
    };
  }

  const truncated = truncateText(value, maxLength);
  return {
    value: truncated.value,
    truncated: truncated.truncated
  };
};

const truncateOptionalStringValue = (
  value: string | number | boolean | null | undefined,
  maxLength: number
): { value?: string | number | boolean | null; truncated: boolean } => {
  if (typeof value !== "string") {
    return value === undefined
      ? {
          truncated: false
        }
      : {
          value,
          truncated: false
        };
  }

  const truncated = truncateText(value, maxLength);
  return {
    value: truncated.value,
    truncated: truncated.truncated
  };
};

const buildLocatorHints = (
  node: RawSnapshotNode,
  maxTextCharsPerNode: number
): { locatorHints?: SnapshotNode["locatorHints"]; truncated: boolean } => {
  const testIdRaw = readAttributeValue(node, ["data-testid", "testid", "test-id", "test_id"]);
  const labelRaw = trimString(node.label) ?? readAttributeValue(node, ["aria-label", "label"]);
  const textRaw = trimString(node.text) ?? trimString(node.name) ?? trimString(node.value);
  const roleValue = trimString(node.role);
  const nameValue = trimString(node.name);

  const testIdResult = truncateOptionalString(testIdRaw, maxTextCharsPerNode);
  const labelResult = truncateOptionalString(labelRaw, maxTextCharsPerNode);
  const textResult = truncateOptionalString(textRaw, maxTextCharsPerNode);
  const roleNameResult = truncateOptionalString(
    roleValue === undefined ? undefined : (nameValue ?? textRaw),
    maxTextCharsPerNode
  );
  const roleAndName =
    roleValue !== undefined && roleNameResult.value !== undefined
      ? {
          role: roleValue,
          name: roleNameResult.value
        }
      : undefined;

  const locatorHints = {
    ...(testIdResult.value === undefined ? {} : { testId: testIdResult.value }),
    ...(roleAndName === undefined ? {} : { roleAndName }),
    ...(labelResult.value === undefined ? {} : { label: labelResult.value }),
    ...(textResult.value === undefined ? {} : { textContent: textResult.value })
  };

  const hasHints = Object.keys(locatorHints).length > 0;
  return {
    ...(hasHints ? { locatorHints } : {}),
    truncated: testIdResult.truncated || labelResult.truncated || textResult.truncated || roleNameResult.truncated
  };
};

const prepareNode = (node: RawSnapshotNode, maxTextCharsPerNode: number): PreparedNode => {
  const roleSource = node.role.trim().length > 0 ? node.role : "unknown";
  const nameSource = node.name.trim().length > 0 ? node.name : "(unnamed)";
  const roleResult = truncateText(roleSource, maxTextCharsPerNode);
  const nameResult = truncateText(nameSource, maxTextCharsPerNode);
  const valueResult = truncateOptionalStringValue(node.value, maxTextCharsPerNode);
  const locatorHintResult = buildLocatorHints(node, maxTextCharsPerNode);

  const baseNode: Omit<SnapshotNode, "ref"> = {
    role: roleResult.value,
    name: nameResult.value,
    ...(valueResult.value === undefined ? {} : { value: valueResult.value }),
    ...(node.disabled === undefined ? {} : { disabled: node.disabled }),
    ...(node.checked === undefined ? {} : { checked: node.checked }),
    ...(locatorHintResult.locatorHints === undefined ? {} : { locatorHints: locatorHintResult.locatorHints })
  };

  return {
    node: baseNode,
    hasTextTruncation:
      roleResult.truncated || nameResult.truncated || valueResult.truncated || locatorHintResult.truncated
  };
};

const nextSnapshotVersion = (sessionIdValue: SessionId, windowIdValue: WindowId): number => {
  const versionKey = `${sessionIdValue}:${windowIdValue}`;
  const nextVersion = (snapshotVersionByWindow.get(versionKey) ?? 0) + 1;
  snapshotVersionByWindow.set(versionKey, nextVersion);
  return nextVersion;
};

const buildTruncationReason = (reasons: readonly string[]): string | undefined => {
  const uniqueReasons = Array.from(new Set(reasons));
  return uniqueReasons.length > 0 ? uniqueReasons.join("; ") : undefined;
};

const nodeMatchesFilter = (node: RawSnapshotNode, filter: "interactive" | "all"): boolean => {
  if (filter === "all") {
    return true;
  }

  return isInteractiveRole(node.role);
};

const buildSnapshotFromNodes = (
  rawSnapshot: RawSnapshot,
  flattenedNodes: readonly FlattenedNode[],
  options: NormalizedSnapshotOptions,
  metadataNote?: string
): Snapshot => {
  const filteredNodes = flattenedNodes.filter((entry) => nodeMatchesFilter(entry.node, options.filter));
  const preparedNodes = filteredNodes.map((entry) => prepareNode(entry.node, options.maxTextCharsPerNode));
  const cappedNodes = preparedNodes.slice(0, options.maxNodes);
  const snapshotNodes = cappedNodes.map((preparedNode, index) => ({
    ref: refId(`e${index + 1}`),
    ...preparedNode.node
  }));

  const reasons = [
    ...(rawSnapshot.truncated ? [rawSnapshot.truncationReason ?? "Driver-side snapshot truncation."] : []),
    ...(preparedNodes.length > options.maxNodes ? [`Node limit reached at ${options.maxNodes}.`] : []),
    ...(preparedNodes.some((preparedNode) => preparedNode.hasTextTruncation)
      ? [`Text fields truncated to ${options.maxTextCharsPerNode} characters per node.`]
      : [])
  ];
  const truncationReason = buildTruncationReason(reasons);

  return {
    sessionId: options.sessionId,
    windowId: options.windowId,
    version: nextSnapshotVersion(options.sessionId, options.windowId),
    createdAt: rawSnapshot.createdAt,
    truncated: truncationReason !== undefined,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(metadataNote === undefined ? {} : { metadata: { note: metadataNote } }),
    nodes: snapshotNodes
  };
};

const nodeTextForQuery = (node: RawSnapshotNode): string => {
  const valueText = typeof node.value === "string" ? node.value : "";
  return [node.name, node.text ?? "", valueText].join(" ").toLowerCase();
};

const normalizeQueryToken = (token: string | undefined): string | undefined => {
  if (token === undefined) {
    return undefined;
  }

  const normalized = token.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const matchesQuery = (node: RawSnapshotNode, query: SnapshotQuery): boolean => {
  const roleToken = normalizeQueryToken(query.role);
  const nameToken = normalizeQueryToken(query.nameContains);
  const testIdToken = normalizeQueryToken(query.testId);
  const textToken = normalizeQueryToken(query.textContains);
  const nodeRole = normalizeRole(node.role);
  const nodeName = node.name.toLowerCase();
  const nodeTestId = (readAttributeValue(node, ["data-testid", "testid", "test-id", "test_id"]) ?? "").toLowerCase();
  const nodeText = nodeTextForQuery(node);

  return (
    (roleToken === undefined || nodeRole === normalizeRole(roleToken)) &&
    (nameToken === undefined || nodeName.includes(nameToken)) &&
    (testIdToken === undefined || nodeTestId.includes(testIdToken)) &&
    (textToken === undefined || nodeText.includes(textToken))
  );
};

const queryContextNodeIds = (flattenedNodes: readonly FlattenedNode[], query: SnapshotQuery): ReadonlySet<string> => {
  const selectedNodeIds = flattenedNodes
    .filter((entry) => matchesQuery(entry.node, query))
    .flatMap((entry) => {
      const nearestAncestors = entry.ancestorIds.slice(-QUERY_ANCESTOR_DEPTH);
      return [...nearestAncestors, entry.id];
    });

  return new Set(selectedNodeIds);
};

const likelyInViewport = (entry: FlattenedNode, viewportRect: ViewportRect): boolean => {
  const bounds = getNodeBounds(entry.node);
  if (bounds !== undefined) {
    return hasIntersection(bounds, viewportRect);
  }

  return entry.depth <= 3;
};

export const buildSnapshot = (rawSnapshot: RawSnapshot, options: SnapshotOptions): Snapshot => {
  const normalizedOptions = normalizeOptions(options);
  const flattenedNodes = flattenNodes(rawSnapshot.nodes);
  return buildSnapshotFromNodes(rawSnapshot, flattenedNodes, normalizedOptions);
};

export const buildViewportSnapshot = (
  rawSnapshot: RawSnapshot,
  viewportRect: ViewportRect,
  options: SnapshotOptions
): Snapshot => {
  const normalizedOptions = normalizeOptions(options);
  const flattenedNodes = flattenNodes(rawSnapshot.nodes)
    .filter((entry) => entry.depth <= VIEWPORT_DEPTH_LIMIT)
    .filter((entry) => likelyInViewport(entry, viewportRect));
  return buildSnapshotFromNodes(rawSnapshot, flattenedNodes, normalizedOptions, "viewport");
};

export const buildQuerySnapshot = (
  rawSnapshot: RawSnapshot,
  query: SnapshotQuery,
  options: SnapshotOptions
): Snapshot => {
  const normalizedOptions = normalizeOptions(options);
  const flattenedNodes = flattenNodes(rawSnapshot.nodes);
  const selectedNodeIds = queryContextNodeIds(flattenedNodes, query);
  const queryNodes = flattenedNodes.filter((entry) => selectedNodeIds.has(entry.id));
  return buildSnapshotFromNodes(rawSnapshot, queryNodes, normalizedOptions, "query");
};
