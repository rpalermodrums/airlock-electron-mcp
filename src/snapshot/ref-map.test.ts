import { describe, expect, it } from "vitest";

import { refId, type SnapshotNode } from "../types/session.js";
import { RefMap, type SelectorDescriptor } from "./ref-map.js";

const createSnapshotNodes = (): readonly SnapshotNode[] => [
  {
    ref: refId("e1"),
    role: "button",
    name: "Save",
    locatorHints: {
      testId: "save-btn",
      roleAndName: {
        role: "button",
        name: "Save"
      },
      label: "Save label",
      textContent: "Save"
    }
  },
  {
    ref: refId("e2"),
    role: "link",
    name: "Docs",
    locatorHints: {
      roleAndName: {
        role: "link",
        name: "Docs"
      },
      label: "Read docs",
      textContent: "Docs"
    }
  },
  {
    ref: refId("e3"),
    role: "textbox",
    name: "Email",
    locatorHints: {
      label: "Email address",
      textContent: "Email"
    }
  },
  {
    ref: refId("e4"),
    role: "text",
    name: "Status",
    locatorHints: {
      textContent: "Ready"
    }
  },
  {
    ref: refId("e5"),
    role: "generic",
    name: "No locator hints"
  }
];

describe("snapshot/ref-map", () => {
  it("rebuildFromSnapshot() populates descriptors from snapshot nodes", () => {
    const refMap = new RefMap();
    const epoch = refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(epoch).toBe(1);
    expect(refMap.resolveRef("e1")).toEqual({
      type: "testId",
      value: "save-btn",
      priority: 100
    });
    expect(refMap.resolveRef("e2")).toEqual({
      type: "role",
      value: JSON.stringify({
        role: "link",
        name: "Docs"
      }),
      priority: 90
    });
    expect(refMap.resolveRef("e5")).toBeUndefined();
  });

  it("resolveRef() returns correct SelectorDescriptor for known refs", () => {
    const refMap = new RefMap();
    refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(refMap.resolveRef("e3")).toEqual({
      type: "label",
      value: "Email address",
      priority: 80
    });
  });

  it("resolveRef() returns undefined for unknown refs", () => {
    const refMap = new RefMap();
    refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(refMap.resolveRef("missing-ref")).toBeUndefined();
  });

  it("isStale() returns true for old epochs", () => {
    const refMap = new RefMap();
    refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(refMap.isStale(0)).toBe(true);
  });

  it("isStale() returns false for current epoch", () => {
    const refMap = new RefMap();
    const epoch = refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(refMap.isStale(epoch)).toBe(false);
  });

  it("toPlaywrightLocator() generates correct locators for each selector type", () => {
    const refMap = new RefMap();
    const testIdDescriptor: SelectorDescriptor = {
      type: "testId",
      value: "save-btn",
      priority: 100
    };
    const roleDescriptor: SelectorDescriptor = {
      type: "role",
      value: JSON.stringify({
        role: "button",
        name: "Save"
      }),
      priority: 90
    };
    const labelDescriptor: SelectorDescriptor = {
      type: "label",
      value: "Email address",
      priority: 80
    };
    const textDescriptor: SelectorDescriptor = {
      type: "text",
      value: "Ready",
      priority: 70
    };
    const cssDescriptor: SelectorDescriptor = {
      type: "css",
      value: ".primary-action",
      priority: 10
    };

    expect(refMap.toPlaywrightLocator(testIdDescriptor)).toBe('[data-testid="save-btn"]');
    expect(refMap.toPlaywrightLocator(roleDescriptor)).toBe('role=button[name="Save"]');
    expect(refMap.toPlaywrightLocator(labelDescriptor)).toBe('text="Email address"');
    expect(refMap.toPlaywrightLocator(textDescriptor)).toBe('text="Ready"');
    expect(refMap.toPlaywrightLocator(cssDescriptor)).toBe(".primary-action");
  });

  it("epoch increments on each rebuild", () => {
    const refMap = new RefMap();
    const firstEpoch = refMap.rebuildFromSnapshot(createSnapshotNodes());
    const secondEpoch = refMap.rebuildFromSnapshot(createSnapshotNodes());

    expect(firstEpoch).toBe(1);
    expect(secondEpoch).toBe(2);
    expect(refMap.currentEpoch).toBe(2);
  });

  it("Selector priority ordering is testId > role > label > text", () => {
    const refMap = new RefMap();
    refMap.rebuildFromSnapshot([
      {
        ref: refId("e1"),
        role: "button",
        name: "All hints",
        locatorHints: {
          testId: "all-hints-id",
          roleAndName: {
            role: "button",
            name: "All hints"
          },
          label: "All hints label",
          textContent: "All hints text"
        }
      },
      {
        ref: refId("e2"),
        role: "button",
        name: "No testId",
        locatorHints: {
          roleAndName: {
            role: "button",
            name: "No testId"
          },
          label: "No testId label",
          textContent: "No testId text"
        }
      },
      {
        ref: refId("e3"),
        role: "text",
        name: "No role",
        locatorHints: {
          label: "Only label",
          textContent: "Only text"
        }
      },
      {
        ref: refId("e4"),
        role: "text",
        name: "Only text",
        locatorHints: {
          textContent: "Text only"
        }
      }
    ]);

    expect(refMap.resolveRef("e1")?.type).toBe("testId");
    expect(refMap.resolveRef("e2")?.type).toBe("role");
    expect(refMap.resolveRef("e3")?.type).toBe("label");
    expect(refMap.resolveRef("e4")?.type).toBe("text");
  });
});
