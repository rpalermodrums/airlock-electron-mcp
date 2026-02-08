import { createAirlockError } from "../types/errors.js";
import type { RefId, Snapshot, SnapshotNode } from "../types/session.js";

export interface SelectorDescriptor {
  type: "testId" | "role" | "label" | "text" | "css";
  value: string;
  priority: number;
}

interface RoleAndNameValue {
  role: string;
  name: string;
}

const PRIORITY = {
  testId: 100,
  role: 90,
  label: 80,
  text: 70,
  css: 10
} as const;

const STALE_DESCRIPTOR_HISTORY_LIMIT = 5;

const asRefId = (ref: string): RefId => {
  return ref as RefId;
};

const isDefined = <T>(value: T | undefined): value is T => {
  return value !== undefined;
};

const encodeRoleAndName = (value: RoleAndNameValue): string => {
  return JSON.stringify(value);
};

const decodeRoleAndName = (value: string): RoleAndNameValue | undefined => {
  try {
    const parsed = JSON.parse(value) as Partial<RoleAndNameValue>;
    if (typeof parsed.role === "string" && parsed.role.length > 0 && typeof parsed.name === "string") {
      return {
        role: parsed.role,
        name: parsed.name
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const escapeForCssAttribute = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const descriptorForNode = (node: SnapshotNode): SelectorDescriptor | undefined => {
  const hints = node.locatorHints;
  const candidates: readonly (SelectorDescriptor | undefined)[] = [
    hints?.testId === undefined
      ? undefined
      : {
          type: "testId",
          value: hints.testId,
          priority: PRIORITY.testId
        },
    hints?.roleAndName === undefined
      ? undefined
      : {
          type: "role",
          value: encodeRoleAndName({
            role: hints.roleAndName.role,
            name: hints.roleAndName.name
          }),
          priority: PRIORITY.role
        },
    hints?.label === undefined
      ? undefined
      : {
          type: "label",
          value: hints.label,
          priority: PRIORITY.label
        },
    hints?.textContent === undefined
      ? undefined
      : {
          type: "text",
          value: hints.textContent,
          priority: PRIORITY.text
        }
  ];

  return candidates.filter(isDefined).sort((left, right) => right.priority - left.priority)[0];
};

const descriptorMatchesNode = (descriptor: SelectorDescriptor, node: SnapshotNode): boolean => {
  if (descriptor.type === "testId") {
    return node.locatorHints?.testId === descriptor.value;
  }

  if (descriptor.type === "role") {
    if (node.locatorHints?.roleAndName === undefined) {
      return false;
    }

    const parsed = decodeRoleAndName(descriptor.value);
    if (parsed === undefined) {
      return false;
    }

    return node.locatorHints.roleAndName.role === parsed.role && node.locatorHints.roleAndName.name === parsed.name;
  }

  if (descriptor.type === "label") {
    return node.locatorHints?.label === descriptor.value;
  }

  if (descriptor.type === "text") {
    return node.locatorHints?.textContent === descriptor.value;
  }

  return false;
};

const descriptorsEqual = (left: SelectorDescriptor, right: SelectorDescriptor): boolean => {
  return left.type === right.type && left.value === right.value && left.priority === right.priority;
};

const trimDescriptorHistory = (descriptors: readonly SelectorDescriptor[]): readonly SelectorDescriptor[] => {
  return descriptors.slice(0, STALE_DESCRIPTOR_HISTORY_LIMIT);
};

export class RefMap {
  private descriptors = new Map<RefId, SelectorDescriptor>();
  private staleDescriptorHistory = new Map<RefId, readonly SelectorDescriptor[]>();
  private currentSnapshotNodes: readonly SnapshotNode[] = [];
  private epoch = 0;

  private lookupDescriptor(ref: RefId): SelectorDescriptor | undefined {
    const currentDescriptor = this.descriptors.get(ref);
    if (currentDescriptor !== undefined) {
      return currentDescriptor;
    }

    return this.staleDescriptorHistory.get(ref)?.[0];
  }

  public get currentEpoch(): number {
    return this.epoch;
  }

  public resolveRef(ref: string): SelectorDescriptor | undefined {
    const normalizedRef = asRefId(ref);
    const descriptor = this.lookupDescriptor(normalizedRef);
    if (descriptor === undefined) {
      return undefined;
    }

    if (this.descriptors.has(normalizedRef)) {
      return descriptor;
    }

    if (this.currentSnapshotNodes.length === 0) {
      return descriptor;
    }

    const resolvedRef = this.reResolveRef(normalizedRef, this.getCurrentSnapshot());
    if (resolvedRef === null) {
      return descriptor;
    }

    return this.descriptors.get(resolvedRef) ?? descriptor;
  }

  public rebuildFromSnapshot(nodes: readonly SnapshotNode[]): number {
    for (const [ref, descriptor] of this.descriptors.entries()) {
      const existingHistory = this.staleDescriptorHistory.get(ref) ?? [];
      const firstHistoryDescriptor = existingHistory[0];
      const nextHistory =
        firstHistoryDescriptor !== undefined && descriptorsEqual(firstHistoryDescriptor, descriptor)
          ? existingHistory
          : trimDescriptorHistory([descriptor, ...existingHistory]);
      this.staleDescriptorHistory.set(ref, nextHistory);
    }

    const descriptors = nodes.reduce((accumulator, node) => {
      const descriptor = descriptorForNode(node);
      if (descriptor !== undefined) {
        accumulator.set(node.ref, descriptor);
      }
      return accumulator;
    }, new Map<RefId, SelectorDescriptor>());

    this.descriptors = descriptors;
    this.currentSnapshotNodes = [...nodes];
    this.epoch += 1;
    return this.epoch;
  }

  public isStale(epoch: number): boolean {
    return epoch !== this.epoch;
  }

  public getCurrentSnapshot(): Snapshot {
    return {
      sessionId: "ref-map" as Snapshot["sessionId"],
      windowId: "ref-map" as Snapshot["windowId"],
      version: this.epoch,
      createdAt: new Date(0).toISOString(),
      truncated: false,
      nodes: [...this.currentSnapshotNodes]
    };
  }

  public reResolveRef(staleRef: RefId, currentSnapshot: Snapshot): RefId | null {
    const staleDescriptor = this.lookupDescriptor(staleRef);
    if (staleDescriptor === undefined) {
      return null;
    }

    const matches = currentSnapshot.nodes.filter((node) => descriptorMatchesNode(staleDescriptor, node));

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      throw createAirlockError(
        "REF_STALE",
        `Stale ref "${staleRef}" matched multiple nodes during cross-epoch re-resolution.`,
        false,
        {
          ref: staleRef,
          descriptor: staleDescriptor,
          matches: matches.map((node) => ({
            ref: node.ref,
            role: node.role,
            name: node.name
          }))
        }
      );
    }

    const resolvedRef = matches[0]?.ref;
    return resolvedRef ?? null;
  }

  public toPlaywrightLocator(descriptor: SelectorDescriptor): string {
    if (descriptor.type === "testId") {
      return `[data-testid="${escapeForCssAttribute(descriptor.value)}"]`;
    }

    if (descriptor.type === "role") {
      const parsed = decodeRoleAndName(descriptor.value);
      if (parsed === undefined) {
        return `role=${descriptor.value}`;
      }

      return `role=${parsed.role}[name=${JSON.stringify(parsed.name)}]`;
    }

    if (descriptor.type === "label") {
      return `text=${JSON.stringify(descriptor.value)}`;
    }

    if (descriptor.type === "text") {
      return `text=${JSON.stringify(descriptor.value)}`;
    }

    return descriptor.value;
  }
}
