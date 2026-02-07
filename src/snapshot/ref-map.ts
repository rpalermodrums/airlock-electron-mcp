import type { RefId, SnapshotNode } from "../types/session.js";

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

export class RefMap {
  private descriptors = new Map<RefId, SelectorDescriptor>();
  private epoch = 0;

  public get currentEpoch(): number {
    return this.epoch;
  }

  public resolveRef(ref: string): SelectorDescriptor | undefined {
    return this.descriptors.get(asRefId(ref));
  }

  public rebuildFromSnapshot(nodes: readonly SnapshotNode[]): number {
    const descriptors = nodes.reduce((accumulator, node) => {
      const descriptor = descriptorForNode(node);
      if (descriptor !== undefined) {
        accumulator.set(node.ref, descriptor);
      }
      return accumulator;
    }, new Map<RefId, SelectorDescriptor>());

    this.descriptors = descriptors;
    this.epoch += 1;
    return this.epoch;
  }

  public isStale(epoch: number): boolean {
    return epoch !== this.epoch;
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
