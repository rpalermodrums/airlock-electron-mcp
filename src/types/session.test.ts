import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SESSION_STATES, WINDOW_KINDS, refId, sessionId, windowId } from "./session.js";

describe("session types", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates branded sessionId/windowId/refId values", () => {
    const sid = sessionId("session-1");
    const wid = windowId("window-1");
    const rid = refId("ref-1");

    expect(sid).toBe("session-1");
    expect(wid).toBe("window-1");
    expect(rid).toBe("ref-1");
  });

  it("allows branded ids to be used as strings", () => {
    const sid = sessionId("session-2");
    const wid = windowId("window-2");
    const rid = refId("ref-2");

    const sidAsString: string = sid;
    const widAsString: string = wid;
    const ridAsString: string = rid;

    expect(sidAsString).toBe("session-2");
    expect(widAsString).toBe("window-2");
    expect(ridAsString).toBe("ref-2");
  });

  it("exports expected session states", () => {
    expect(SESSION_STATES).toEqual(["launching", "running", "closed", "error"]);
  });

  it("exports expected window kinds", () => {
    expect(WINDOW_KINDS).toEqual(["primary", "modal", "devtools", "utility", "unknown"]);
  });
});
