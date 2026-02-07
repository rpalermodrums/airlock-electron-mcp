import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SessionManager, type ManagedSession } from "./session-manager.js";
import type { Session } from "./types/index.js";
import { sessionId, windowId } from "./types/session.js";

const createManagedSession = (
  id: string,
  overrides: Partial<Session> = {},
  cleanup?: (managedSession: ManagedSession) => Promise<void>
): ManagedSession => {
  const baseSession: Session = {
    sessionId: sessionId(id),
    state: "running",
    mode: "safe",
    launchMode: "preset",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastActivityAt: "2024-01-01T00:00:00.000Z",
    artifactDir: `/tmp/${id}`,
    selectedWindowId: undefined,
    windows: []
  };
  const session = {
    ...baseSession,
    ...overrides
  };
  const cleanupPart = cleanup === undefined ? {} : { cleanup };

  return {
    session,
    ...cleanupPart
  };
};

describe("session manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds, gets, and removes sessions", () => {
    const manager = new SessionManager({ ttlMs: 60_000 });
    const managedSession = createManagedSession("s-1");

    manager.add(managedSession);

    expect(manager.count()).toBe(1);
    expect(manager.has("s-1")).toBe(true);
    const stored = manager.get("s-1");
    expect(stored).toBeDefined();
    expect(stored).toMatchObject(managedSession);
    expect(stored?.refMaps).toBeInstanceOf(Map);

    const removed = manager.remove("s-1");
    expect(removed).toMatchObject(managedSession);
    expect(removed?.refMaps).toBeInstanceOf(Map);
    expect(manager.has("s-1")).toBe(false);
    expect(manager.count()).toBe(0);
  });

  it("touch() updates lastActivityAt and updatedAt", () => {
    const manager = new SessionManager({ ttlMs: 60_000 });
    const managedSession = createManagedSession("s-touch", {
      updatedAt: "2024-01-01T00:00:00.000Z",
      lastActivityAt: "2024-01-01T00:00:00.000Z"
    });

    manager.add(managedSession);
    vi.setSystemTime(new Date("2024-01-01T00:00:10.000Z"));
    manager.touch("s-touch");

    expect(managedSession.session.updatedAt).toBe("2024-01-01T00:00:10.000Z");
    expect(managedSession.session.lastActivityAt).toBe("2024-01-01T00:00:10.000Z");
  });

  it("cleans up stale sessions based on TTL", async () => {
    const manager = new SessionManager({ ttlMs: 1_000 });
    vi.setSystemTime(new Date("2024-01-01T00:00:10.000Z"));

    const staleCleanup = vi.fn(async () => undefined);
    const freshCleanup = vi.fn(async () => undefined);
    const staleSession = createManagedSession(
      "stale",
      {
        lastActivityAt: "2024-01-01T00:00:00.000Z"
      },
      staleCleanup
    );
    const freshSession = createManagedSession(
      "fresh",
      {
        lastActivityAt: "2024-01-01T00:00:09.500Z"
      },
      freshCleanup
    );

    manager.add(staleSession);
    manager.add(freshSession);

    const failures = await manager.cleanupStale();

    expect(failures).toEqual([]);
    expect(staleCleanup).toHaveBeenCalledTimes(1);
    expect(freshCleanup).not.toHaveBeenCalled();
    expect(manager.has("stale")).toBe(false);
    expect(manager.has("fresh")).toBe(true);
  });

  it("lists managed sessions and summaries", () => {
    const manager = new SessionManager({ ttlMs: 60_000 });
    const first = createManagedSession("s-1", {
      selectedWindowId: windowId("w-1"),
      windows: [
        {
          windowId: windowId("w-1"),
          title: "Main",
          url: "http://localhost",
          kind: "primary",
          focused: true,
          visible: true,
          lastSeenAt: "2024-01-01T00:00:00.000Z"
        },
        {
          windowId: windowId("w-2"),
          title: "Dialog",
          url: "http://localhost/modal",
          kind: "modal",
          focused: false,
          visible: true,
          lastSeenAt: "2024-01-01T00:00:00.000Z"
        }
      ]
    });
    const second = createManagedSession("s-2");

    manager.add(first);
    manager.add(second);

    const listed = manager.list();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.session.sessionId).toBe(sessionId("s-1"));
    expect(listed[1]?.session.sessionId).toBe(sessionId("s-2"));

    const summaries = manager.listSummaries();
    expect(summaries).toHaveLength(2);

    const [summaryOne, summaryTwo] = summaries;
    if (summaryOne === undefined || summaryTwo === undefined) {
      throw new Error("Expected session summaries to include two entries.");
    }

    expect(summaryOne).toMatchObject({
      sessionId: sessionId("s-1"),
      state: "running",
      mode: "safe",
      selectedWindowId: windowId("w-1"),
      windowCount: 2
    });
    expect(summaryTwo).toMatchObject({
      sessionId: sessionId("s-2"),
      state: "running",
      mode: "safe",
      windowCount: 0
    });
    expect("selectedWindowId" in summaryTwo).toBe(false);
  });

  it("reset() runs cleanup and clears all sessions", async () => {
    const manager = new SessionManager({ ttlMs: 60_000 });
    const cleanupA = vi.fn(async () => undefined);
    const cleanupB = vi.fn(async () => undefined);

    manager.add(createManagedSession("a", {}, cleanupA));
    manager.add(createManagedSession("b", {}, cleanupB));

    const failures = await manager.reset("test-reset");

    expect(failures).toEqual([]);
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(manager.count()).toBe(0);
  });

  it("getOrThrow() throws for missing sessions", () => {
    const manager = new SessionManager({ ttlMs: 60_000 });

    expect(() => manager.getOrThrow("missing")).toThrow();

    try {
      manager.getOrThrow("missing");
      throw new Error("Expected getOrThrow to throw for missing session.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "SESSION_NOT_FOUND",
        message: 'Session "missing" was not found.',
        retriable: false,
        details: {
          sessionId: "missing"
        }
      });
    }
  });
});
