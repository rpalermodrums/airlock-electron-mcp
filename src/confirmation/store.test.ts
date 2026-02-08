import { describe, expect, it } from "vitest";

import { ConfirmationStore, type PendingConfirmation } from "./store.js";

const createPendingConfirmation = (id: string, nowMs: number, ttlMs: number): PendingConfirmation => {
  return {
    id,
    toolName: "dangerous_tool",
    description: "Run dangerous_tool",
    params: { value: 1 },
    createdAt: nowMs,
    expiresAt: nowMs + ttlMs
  };
};

describe("ConfirmationStore", () => {
  it("adds and gets pending confirmations", () => {
    const nowMs = 1_000;
    const store = new ConfirmationStore({ ttlMs: 10_000, nowMs: () => nowMs });
    const confirmation = createPendingConfirmation("c-1", nowMs, 10_000);

    store.add(confirmation);

    expect(store.get("c-1")).toEqual(confirmation);
  });

  it("consumes confirmations and removes them from the store", () => {
    const nowMs = 1_000;
    const store = new ConfirmationStore({ ttlMs: 10_000, nowMs: () => nowMs });
    const confirmation = createPendingConfirmation("c-2", nowMs, 10_000);
    store.add(confirmation);

    const consumed = store.consume("c-2");

    expect(consumed).toEqual(confirmation);
    expect(store.get("c-2")).toBeUndefined();
  });

  it("throws INVALID_INPUT when consuming a missing confirmation", () => {
    const store = new ConfirmationStore({ ttlMs: 10_000, nowMs: () => 1_000 });
    let thrown: unknown;

    try {
      store.consume("missing");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("expires confirmations based on TTL", () => {
    let nowMs = 1_000;
    const store = new ConfirmationStore({ ttlMs: 100, nowMs: () => nowMs });
    const confirmation = createPendingConfirmation("c-3", nowMs, 100);
    store.add(confirmation);

    nowMs = 1_101;
    store.cleanup();

    expect(store.get("c-3")).toBeUndefined();
  });
});
