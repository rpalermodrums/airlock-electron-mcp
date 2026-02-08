import { describe, expect, it, vi } from "vitest";

import { runReadinessChain, type ReadinessSignal } from "./readiness.js";

const eventuallyReadySignal = (name: string, readyOnAttempt: number): ReadinessSignal => {
  const state = {
    attempts: 0
  };

  return {
    name,
    timeoutMs: 100,
    retryPolicy: {
      intervalMs: 10
    },
    check: async () => {
      state.attempts += 1;
      return {
        ready: state.attempts >= readyOnAttempt,
        detail: `attempt=${state.attempts}`
      };
    }
  };
};

describe("readiness chain", () => {
  it("executes ordered signals and completes when all become ready", async () => {
    vi.useFakeTimers();

    const promise = runReadinessChain([eventuallyReadySignal("first", 2), eventuallyReadySignal("second", 1)]);
    await vi.advanceTimersByTimeAsync(40);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.completedSignals).toEqual(["first", "second"]);
    expect(result.failedSignal).toBeUndefined();
    expect(result.diagnostics.timeline.length).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  });

  it("returns timeout diagnostics when a signal never becomes ready", async () => {
    vi.useFakeTimers();

    const promise = runReadinessChain([
      {
        name: "never-ready",
        timeoutMs: 25,
        retryPolicy: {
          intervalMs: 10
        },
        check: async () => {
          return {
            ready: false,
            detail: "still waiting"
          };
        }
      }
    ]);

    await vi.advanceTimersByTimeAsync(80);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.failedSignal?.name).toBe("never-ready");
    expect(result.failedSignal?.timedOut).toBe(true);
    expect(result.completedSignals).toEqual([]);
    expect(result.diagnostics.timeline.at(-1)?.timedOut).toBe(true);

    vi.useRealTimers();
  });

  it("captures partial success before a downstream signal fails", async () => {
    vi.useFakeTimers();

    const promise = runReadinessChain([
      {
        name: "ready-now",
        timeoutMs: 50,
        retryPolicy: {
          intervalMs: 5
        },
        check: async () => ({ ready: true })
      },
      {
        name: "fails-later",
        timeoutMs: 20,
        retryPolicy: {
          intervalMs: 10
        },
        check: async () => ({ ready: false, detail: "nope" })
      }
    ]);

    await vi.advanceTimersByTimeAsync(80);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.completedSignals).toEqual(["ready-now"]);
    expect(result.failedSignal?.name).toBe("fails-later");
    expect(result.failedSignal?.attempts).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});
