import { createAirlockError, type AirlockError, type Session, type SessionSummary } from "./types/index.js";
import type { DriverSession } from "./driver/index.js";
import type { RefMap } from "./snapshot/ref-map.js";
import { toTimestampMs } from "./utils/index.js";

const toErrorDetails = (error: unknown): Record<string, unknown> => {
  if (typeof error === "object" && error !== null) {
    return { ...(error as Record<string, unknown>) };
  }

  return {
    error: error instanceof Error ? error.message : String(error)
  };
};

export interface ManagedSession {
  session: Session;
  driverSession?: DriverSession;
  defaultWindowId?: Session["selectedWindowId"];
  lastInteractedWindowId?: Session["selectedWindowId"];
  lastFocusedPrimaryWindowId?: Session["selectedWindowId"];
  refMaps?: Map<string, RefMap>;
  cleanup?: (managedSession: ManagedSession) => Promise<void>;
  traceCleanupWrapped?: boolean;
}

export interface SessionManagerConfig {
  ttlMs: number;
}

export class SessionManager {
  private readonly ttlMsValue: number;
  private readonly sessions: Map<string, ManagedSession>;

  public constructor(config: SessionManagerConfig) {
    this.ttlMsValue = config.ttlMs;
    this.sessions = new Map<string, ManagedSession>();
  }

  public ttlMs(): number {
    return this.ttlMsValue;
  }

  public add(managedSession: ManagedSession): void {
    const normalizedSession =
      managedSession.refMaps === undefined
        ? {
            ...managedSession,
            refMaps: new Map<string, RefMap>()
          }
        : managedSession;
    this.sessions.set(normalizedSession.session.sessionId, normalizedSession);
  }

  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getOrThrow(sessionId: string): ManagedSession {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      throw createAirlockError("SESSION_NOT_FOUND", `Session "${sessionId}" was not found.`, false, {
        sessionId
      });
    }

    return managedSession;
  }

  public remove(sessionId: string): ManagedSession | undefined {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      this.sessions.delete(sessionId);
    }
    return existing;
  }

  public count(): number {
    return this.sessions.size;
  }

  public list(): readonly ManagedSession[] {
    return [...this.sessions.values()];
  }

  public listSessions(): readonly Session[] {
    return this.list().map((managedSession) => managedSession.session);
  }

  public listSummaries(): readonly SessionSummary[] {
    return this.listSessions().map((session) => {
      const baseSummary = {
        sessionId: session.sessionId,
        state: session.state,
        mode: session.mode,
        windowCount: session.windows.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastActivityAt: session.lastActivityAt
      };

      return session.selectedWindowId === undefined
        ? baseSummary
        : {
            ...baseSummary,
            selectedWindowId: session.selectedWindowId
          };
    });
  }

  public touch(sessionId: string): void {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      return;
    }

    const now = new Date().toISOString();
    managedSession.session.lastActivityAt = now;
    managedSession.session.updatedAt = now;
  }

  public setTraceState(sessionId: string, traceState: Session["traceState"]): void {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      return;
    }

    if (traceState === undefined) {
      delete managedSession.session.traceState;
    } else {
      managedSession.session.traceState = traceState;
    }

    const now = new Date().toISOString();
    managedSession.session.updatedAt = now;
    managedSession.session.lastActivityAt = now;
  }

  public setRefMap(sessionId: string, windowId: string, refMap: RefMap): void {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      return;
    }

    const refMaps = managedSession.refMaps ?? new Map<string, RefMap>();
    refMaps.set(windowId, refMap);
    managedSession.refMaps = refMaps;
  }

  public getRefMap(sessionId: string, windowId: string): RefMap | undefined {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      return undefined;
    }

    return managedSession.refMaps?.get(windowId);
  }

  public clearRefMaps(sessionId: string): void {
    const managedSession = this.sessions.get(sessionId);
    if (managedSession === undefined) {
      return;
    }

    managedSession.refMaps?.clear();
  }

  public async cleanupStale(): Promise<readonly AirlockError[]> {
    const staleSessionIds = this.findStaleSessionIds(Date.now());
    return this.cleanupSessionIds(staleSessionIds, "stale_cleanup");
  }

  public async reset(reason: string = "reset"): Promise<readonly AirlockError[]> {
    const allSessionIds = [...this.sessions.keys()];
    return this.cleanupSessionIds(allSessionIds, reason);
  }

  private findStaleSessionIds(nowMs: number): readonly string[] {
    return [...this.sessions.values()]
      .filter((managedSession) => {
        const lastActivityMs = toTimestampMs(managedSession.session.lastActivityAt);
        return nowMs - lastActivityMs > this.ttlMsValue;
      })
      .map((managedSession) => managedSession.session.sessionId);
  }

  private async cleanupSessionIds(sessionIds: readonly string[], reason: string): Promise<readonly AirlockError[]> {
    const failures: AirlockError[] = [];

    for (const sessionId of sessionIds) {
      const managedSession = this.sessions.get(sessionId);
      if (managedSession === undefined) {
        continue;
      }

      try {
        if (managedSession.cleanup !== undefined) {
          await managedSession.cleanup(managedSession);
        }
        this.sessions.delete(sessionId);
      } catch (error: unknown) {
        failures.push(
          createAirlockError("INTERNAL_ERROR", `Failed to cleanup session "${sessionId}" during ${reason}.`, true, {
            sessionId,
            reason,
            cause: toErrorDetails(error)
          })
        );
      }
    }

    return failures;
  }
}
