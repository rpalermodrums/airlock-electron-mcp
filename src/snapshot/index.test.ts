import { describe, expect, it } from "vitest";

import type { RawSnapshot, RawSnapshotNode, RawSnapshotRect } from "../driver/index.js";
import { refId, sessionId, windowId, type Snapshot } from "../types/session.js";
import {
  buildQuerySnapshot,
  buildRegionSnapshot,
  buildSnapshot,
  buildSnapshotDiff,
  buildViewportSnapshot,
  findSnapshotNodeBounds,
  type SnapshotOptions,
  type ViewportRect
} from "./index.js";

const INTERACTIVE_ROLES = new Set([
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

const toRect = (x: number, y: number, width: number, height: number): RawSnapshotRect => ({
  x,
  y,
  width,
  height
});

const normalizeRole = (role: string): string =>
  role
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");

const flattenRawNodes = (nodes: readonly RawSnapshotNode[]): readonly RawSnapshotNode[] =>
  nodes.flatMap((node) => [node, ...flattenRawNodes(node.children ?? [])]);

const createSnapshotOptions = (suffix: string, filter: "interactive" | "all"): SnapshotOptions => ({
  sessionId: sessionId(`session-${suffix}`),
  windowId: windowId(`window-${suffix}`),
  filter
});

const createRawSnapshot = (): RawSnapshot => ({
  version: 1,
  createdAt: "2026-02-07T00:00:00.000Z",
  truncated: false,
  nodes: [
    {
      ref: "raw-0",
      role: "application",
      name: "Airlock Main",
      bounds: toRect(0, 0, 1200, 900),
      children: [
        {
          ref: "raw-0-0",
          role: "heading",
          name: "Dashboard",
          text: "Dashboard",
          bounds: toRect(20, 20, 200, 40)
        },
        {
          ref: "raw-0-1",
          role: "generic",
          name: "Toolbar",
          bounds: toRect(0, 80, 1200, 80),
          children: [
            {
              ref: "raw-0-1-0",
              role: "button",
              name: "Save",
              text: "Save",
              label: "Save changes",
              attributes: {
                "data-testid": "save-btn"
              },
              bounds: toRect(20, 90, 100, 30)
            },
            {
              ref: "raw-0-1-1",
              role: "button",
              name: "Delete",
              text: "Delete",
              attributes: {
                testid: "delete-btn"
              },
              bounds: toRect(140, 90, 100, 30)
            },
            {
              ref: "raw-0-1-2",
              role: "link",
              name: "Learn more",
              text: "Learn more",
              bounds: toRect(260, 90, 120, 30)
            },
            {
              ref: "raw-0-1-3",
              role: "checkbox",
              name: "Enable sync",
              checked: true,
              attributes: {
                "aria-label": "Enable sync"
              },
              bounds: toRect(400, 90, 30, 30)
            },
            {
              ref: "raw-0-1-4",
              role: "generic",
              name: "Toolbar helper text",
              text: "Use buttons to manage items",
              bounds: toRect(460, 90, 260, 30)
            }
          ]
        },
        {
          ref: "raw-0-2",
          role: "generic",
          name: "Search Section",
          bounds: toRect(0, 170, 1200, 120),
          children: [
            {
              ref: "raw-0-2-0",
              role: "textbox",
              name: "Search query",
              value: "report",
              label: "Search",
              attributes: {
                "data-testid": "search-box"
              },
              bounds: toRect(20, 180, 300, 40)
            },
            {
              ref: "raw-0-2-1",
              role: "text",
              name: "Search hint",
              text: "Type at least 3 characters",
              bounds: toRect(20, 225, 300, 20)
            },
            {
              ref: "raw-0-2-2",
              role: "combobox",
              name: "Category",
              value: "All",
              bounds: toRect(340, 180, 160, 40)
            }
          ]
        },
        {
          ref: "raw-0-3",
          role: "generic",
          name: "Content Region",
          bounds: toRect(0, 300, 1200, 500),
          children: [
            {
              ref: "raw-0-3-0",
              role: "heading",
              name: "Recent Items",
              bounds: toRect(20, 320, 200, 30)
            },
            {
              ref: "raw-0-3-1",
              role: "generic",
              name: "Row 1",
              bounds: toRect(20, 360, 1000, 40),
              children: [
                {
                  ref: "raw-0-3-1-0",
                  role: "link",
                  name: "Open Report",
                  text: "Open Report",
                  bounds: toRect(30, 365, 120, 30)
                },
                {
                  ref: "raw-0-3-1-1",
                  role: "button",
                  name: "Archive",
                  text: "Archive",
                  bounds: toRect(170, 365, 90, 30)
                }
              ]
            },
            {
              ref: "raw-0-3-2",
              role: "generic",
              name: "Row 2",
              bounds: toRect(20, 410, 1000, 40),
              children: [
                {
                  ref: "raw-0-3-2-0",
                  role: "link",
                  name: "Open Analytics",
                  text: "Open Analytics",
                  bounds: toRect(30, 415, 140, 30)
                },
                {
                  ref: "raw-0-3-2-1",
                  role: "switch",
                  name: "Pin Item",
                  checked: false,
                  attributes: {
                    "data-testid": "pin-toggle"
                  },
                  bounds: toRect(190, 415, 60, 30)
                }
              ]
            },
            {
              ref: "raw-0-3-3",
              role: "generic",
              name: "Offscreen Panel",
              bounds: toRect(10, 1400, 800, 200),
              children: [
                {
                  ref: "raw-0-3-3-0",
                  role: "button",
                  name: "Hidden CTA",
                  text: "Hidden CTA",
                  bounds: toRect(20, 1450, 120, 30)
                },
                {
                  ref: "raw-0-3-3-1",
                  role: "text",
                  name: "Hidden text",
                  text: "Not visible",
                  bounds: toRect(150, 1450, 200, 20)
                }
              ]
            }
          ]
        }
      ]
    },
    {
      ref: "raw-1",
      role: "dialog",
      name: "Help modal",
      bounds: toRect(1200, 100, 400, 300),
      children: [
        {
          ref: "raw-1-0",
          role: "heading",
          name: "Keyboard shortcuts",
          bounds: toRect(1210, 110, 200, 30)
        },
        {
          ref: "raw-1-1",
          role: "button",
          name: "Close",
          attributes: {
            "data-testid": "close-help"
          },
          bounds: toRect(1500, 110, 80, 30)
        },
        {
          ref: "raw-1-2",
          role: "text",
          name: "Help body",
          text: "Press slash to search quickly",
          bounds: toRect(1210, 150, 320, 60)
        }
      ]
    }
  ]
});

describe("snapshot/index", () => {
  it("buildSnapshot() with filter='interactive' only keeps interactive roles", () => {
    const snapshot = buildSnapshot(createRawSnapshot(), createSnapshotOptions("interactive-only", "interactive"));

    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.nodes.every((node) => INTERACTIVE_ROLES.has(normalizeRole(node.role)))).toBe(true);
    expect(snapshot.nodes.map((node) => node.role)).toEqual([
      "button",
      "button",
      "link",
      "checkbox",
      "textbox",
      "combobox",
      "link",
      "button",
      "link",
      "switch",
      "button",
      "button"
    ]);
  });

  it("buildSnapshot() with filter='all' keeps all nodes", () => {
    const rawSnapshot = createRawSnapshot();
    const snapshot = buildSnapshot(rawSnapshot, createSnapshotOptions("all-nodes", "all"));

    expect(snapshot.nodes).toHaveLength(flattenRawNodes(rawSnapshot.nodes).length);
  });

  it("buildSnapshot() assigns deterministic ref IDs in traversal order", () => {
    const snapshot = buildSnapshot(createRawSnapshot(), createSnapshotOptions("deterministic-refs", "all"));

    expect(snapshot.nodes.map((node) => String(node.ref))).toEqual(
      Array.from({ length: snapshot.nodes.length }, (_, index) => `e${index + 1}`)
    );
    expect(snapshot.nodes.map((node) => node.name)).toEqual([
      "Airlock Main",
      "Dashboard",
      "Toolbar",
      "Save",
      "Delete",
      "Learn more",
      "Enable sync",
      "Toolbar helper text",
      "Search Section",
      "Search query",
      "Search hint",
      "Category",
      "Content Region",
      "Recent Items",
      "Row 1",
      "Open Report",
      "Archive",
      "Row 2",
      "Open Analytics",
      "Pin Item",
      "Offscreen Panel",
      "Hidden CTA",
      "Hidden text",
      "Help modal",
      "Keyboard shortcuts",
      "Close",
      "Help body"
    ]);
  });

  it("buildSnapshot() truncates text values at maxTextCharsPerNode (default 80)", () => {
    const longText = "x".repeat(120);
    const rawSnapshot: RawSnapshot = {
      version: 1,
      createdAt: "2026-02-07T00:00:00.000Z",
      truncated: false,
      nodes: [
        {
          ref: "raw-0",
          role: "button",
          name: longText,
          value: longText,
          text: longText,
          label: longText,
          attributes: {
            "data-testid": `id-${longText}`
          }
        }
      ]
    };

    const snapshot = buildSnapshot(rawSnapshot, createSnapshotOptions("truncate-text", "all"));
    const node = snapshot.nodes[0];

    expect(node).toBeDefined();
    expect(node?.name).toHaveLength(80);
    expect(node?.name.endsWith("...")).toBe(true);
    expect(typeof node?.value).toBe("string");
    expect(String(node?.value)).toHaveLength(80);
    expect(node?.locatorHints?.testId).toHaveLength(80);
    expect(node?.locatorHints?.label).toHaveLength(80);
    expect(node?.locatorHints?.textContent).toHaveLength(80);
  });

  it("buildSnapshot() enforces maxNodes cap (default 250)", () => {
    const rawSnapshot: RawSnapshot = {
      version: 1,
      createdAt: "2026-02-07T00:00:00.000Z",
      truncated: false,
      nodes: Array.from({ length: 260 }, (_, index) => ({
        ref: `raw-${index}`,
        role: "button",
        name: `Button ${index}`
      }))
    };

    const snapshot = buildSnapshot(rawSnapshot, createSnapshotOptions("max-nodes-default", "all"));

    expect(snapshot.nodes).toHaveLength(250);
    expect(snapshot.nodes[0]?.name).toBe("Button 0");
    expect(snapshot.nodes[249]?.name).toBe("Button 249");
  });

  it("buildSnapshot() sets truncated=true with reason when truncated", () => {
    const rawSnapshot: RawSnapshot = {
      version: 1,
      createdAt: "2026-02-07T00:00:00.000Z",
      truncated: true,
      truncationReason: "Driver-side truncation",
      nodes: [
        {
          ref: "raw-0",
          role: "button",
          name: "Save"
        }
      ]
    };

    const snapshot = buildSnapshot(rawSnapshot, createSnapshotOptions("truncated-reason", "all"));

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.truncationReason).toContain("Driver-side truncation");
  });

  it("buildSnapshot() generates locatorHints (testId, roleAndName, label, textContent)", () => {
    const snapshot = buildSnapshot(createRawSnapshot(), createSnapshotOptions("locator-hints", "all"));
    const saveNode = snapshot.nodes.find((node) => node.name === "Save");

    expect(saveNode?.locatorHints).toEqual({
      testId: "save-btn",
      roleAndName: {
        role: "button",
        name: "Save"
      },
      label: "Save changes",
      textContent: "Save"
    });
  });

  it("buildSnapshot() version increments monotonically per window", () => {
    const rawSnapshot = createRawSnapshot();
    const options = createSnapshotOptions("version-sequence", "all");
    const first = buildSnapshot(rawSnapshot, options);
    const second = buildSnapshot(rawSnapshot, options);
    const thirdDifferentWindow = buildSnapshot(
      rawSnapshot,
      createSnapshotOptions("version-sequence-other-window", "all")
    );

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(thirdDifferentWindow.version).toBe(1);
  });

  it("buildViewportSnapshot() filters to viewport-visible nodes", () => {
    const viewportRect: ViewportRect = {
      x: 0,
      y: 0,
      width: 1100,
      height: 900
    };
    const snapshot = buildViewportSnapshot(createRawSnapshot(), viewportRect, createSnapshotOptions("viewport", "all"));
    const names = snapshot.nodes.map((node) => node.name);

    expect(names).toContain("Save");
    expect(names).toContain("Archive");
    expect(names).not.toContain("Hidden CTA");
    expect(names).not.toContain("Close");
    expect(snapshot.metadata?.note).toBe("viewport");
  });

  it("buildQuerySnapshot() filters by role, nameContains, testId, textContains", () => {
    const snapshot = buildQuerySnapshot(
      createRawSnapshot(),
      {
        role: "button",
        nameContains: "sav",
        testId: "save-btn",
        textContains: "save"
      },
      createSnapshotOptions("query-filter", "all")
    );

    expect(snapshot.nodes.map((node) => node.name)).toEqual(["Airlock Main", "Toolbar", "Save"]);
    expect(snapshot.metadata?.note).toBe("query");
  });

  it("buildQuerySnapshot() includes ancestor context", () => {
    const snapshot = buildQuerySnapshot(
      createRawSnapshot(),
      {
        role: "link",
        nameContains: "report"
      },
      createSnapshotOptions("query-ancestors", "all")
    );

    expect(snapshot.nodes.map((node) => node.name)).toEqual(["Content Region", "Row 1", "Open Report"]);
    expect(snapshot.nodes.map((node) => node.role)).toEqual(["generic", "generic", "link"]);
    expect(snapshot.nodes.map((node) => node.name)).not.toContain("Airlock Main");
  });

  it("buildRegionSnapshot() returns nodes intersecting the given region with ancestor context", () => {
    const snapshot = buildRegionSnapshot(
      createRawSnapshot(),
      {
        x: 0,
        y: 80,
        width: 320,
        height: 80
      },
      createSnapshotOptions("region", "all")
    );

    const names = snapshot.nodes.map((node) => node.name);
    expect(names).toContain("Airlock Main");
    expect(names).toContain("Toolbar");
    expect(names).toContain("Save");
    expect(names).toContain("Delete");
    expect(names).not.toContain("Open Analytics");
    expect(snapshot.metadata?.note).toBe("region");
  });

  it("buildRegionSnapshot() can return an empty node set when region has no intersections", () => {
    const snapshot = buildRegionSnapshot(
      createRawSnapshot(),
      {
        x: 5000,
        y: 5000,
        width: 50,
        height: 50
      },
      createSnapshotOptions("region-empty", "all")
    );

    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.metadata?.note).toBe("region");
  });

  it("findSnapshotNodeBounds() resolves raw node bounds from snapshot identity hints", () => {
    const snapshot = buildSnapshot(createRawSnapshot(), createSnapshotOptions("bounds", "all"));
    const saveNode = snapshot.nodes.find((node) => node.name === "Save");

    expect(saveNode).toBeDefined();
    expect(findSnapshotNodeBounds(createRawSnapshot(), saveNode!)).toEqual({
      x: 20,
      y: 90,
      width: 100,
      height: 30
    });
  });

  it("findSnapshotNodeBounds() returns undefined when no identity match exists", () => {
    const missingNode: Snapshot["nodes"][number] = {
      ref: refId("e404"),
      role: "button",
      name: "Missing",
      locatorHints: {
        testId: "does-not-exist"
      }
    };

    expect(findSnapshotNodeBounds(createRawSnapshot(), missingNode)).toBeUndefined();
  });

  it("buildSnapshotDiff() reports added/removed/changed nodes and context", () => {
    const previous: Snapshot = {
      sessionId: sessionId("diff-s1"),
      windowId: windowId("diff-w1"),
      version: 1,
      createdAt: "2026-02-07T00:00:00.000Z",
      truncated: false,
      nodes: [
        {
          ref: refId("e1"),
          role: "button",
          name: "Save",
          locatorHints: {
            testId: "save-btn"
          }
        },
        {
          ref: refId("e2"),
          role: "checkbox",
          name: "Enable sync",
          checked: true,
          locatorHints: {
            testId: "sync-toggle"
          }
        },
        {
          ref: refId("e3"),
          role: "link",
          name: "Docs",
          locatorHints: {
            roleAndName: {
              role: "link",
              name: "Docs"
            }
          }
        }
      ]
    };
    const current: Snapshot = {
      sessionId: sessionId("diff-s1"),
      windowId: windowId("diff-w1"),
      version: 2,
      createdAt: "2026-02-07T00:00:01.000Z",
      truncated: false,
      nodes: [
        {
          ref: refId("e1"),
          role: "button",
          name: "Save Now",
          disabled: true,
          locatorHints: {
            testId: "save-btn"
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
            }
          }
        },
        {
          ref: refId("e3"),
          role: "button",
          name: "Delete",
          locatorHints: {
            testId: "delete-btn"
          }
        }
      ]
    };

    const diff = buildSnapshotDiff(current, previous);

    expect(diff.added.map((node) => node.name)).toEqual(["Delete"]);
    expect(diff.removed.map((node) => node.name)).toEqual(["Enable sync"]);
    expect(diff.changed).toEqual([
      {
        ref: "e1",
        changes: {
          name: {
            before: "Save",
            after: "Save Now"
          },
          disabled: {
            before: undefined,
            after: true
          }
        }
      }
    ]);
    expect(diff.context.map((node) => node.name)).toEqual(["Docs"]);
  });

  it("buildSnapshotDiff() returns empty sections for identical snapshots", () => {
    const baseline: Snapshot = {
      sessionId: sessionId("diff-identical-s1"),
      windowId: windowId("diff-identical-w1"),
      version: 1,
      createdAt: "2026-02-07T00:00:00.000Z",
      truncated: false,
      nodes: [
        {
          ref: refId("e1"),
          role: "button",
          name: "Save",
          locatorHints: {
            testId: "save-btn"
          }
        }
      ]
    };

    const diff = buildSnapshotDiff(baseline, baseline);

    expect(diff).toEqual({
      added: [],
      removed: [],
      changed: [],
      context: []
    });
  });
});
