import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { toTimestampMs } from "./time.js";

describe("time utils", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts an ISO timestamp string to epoch milliseconds", () => {
    expect(toTimestampMs("2024-01-01T00:00:00.000Z")).toBe(1704067200000);
    expect(toTimestampMs("2024-01-01T00:00:00.123Z")).toBe(1704067200123);
  });
});
