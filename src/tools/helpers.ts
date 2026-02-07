import type { ActionResult, ActionTarget, DriverSession, DriverWindow } from "../driver/index.js";
import type { AirlockToolContext } from "../server.js";
import type { ManagedSession } from "../session-manager.js";
import { createAirlockError, type ToolResult, type Window } from "../types/index.js";

type ManagedSessionWithDriver = ManagedSession & { driverSession: DriverSession };
type ActionTargetInput = {
  ref?: string | undefined;
  role?: string | undefined;
  name?: string | undefined;
  testId?: string | undefined;
  css?: string | undefined;
};

const buildWindowNotFoundError = (
  sessionId: string,
  requestedWindowId: string | undefined,
  availableWindowIds: readonly string[]
) => {
  return createAirlockError(
    "WINDOW_NOT_FOUND",
    requestedWindowId === undefined
      ? `No target window is available in session "${sessionId}".`
      : `Window "${requestedWindowId}" was not found in session "${sessionId}".`,
    false,
    {
      sessionId,
      requestedWindowId,
      availableWindowIds
    }
  );
};

export const resolveManagedSession = (context: AirlockToolContext, sessionId: string): ManagedSessionWithDriver => {
  const managedSession = context.sessions.get(sessionId);
  if (managedSession === undefined) {
    throw createAirlockError("SESSION_NOT_FOUND", `Session "${sessionId}" was not found.`, false, {
      sessionId
    });
  }

  if (managedSession.driverSession === undefined) {
    throw createAirlockError("SESSION_NOT_FOUND", `Driver session is not available for "${sessionId}".`, false, {
      sessionId
    });
  }

  return managedSession as ManagedSessionWithDriver;
};

export const resolveWindow = (managedSession: ManagedSession, requestedWindowId?: string): Window => {
  const resolvedWindowId =
    requestedWindowId ?? managedSession.session.selectedWindowId ?? managedSession.session.windows[0]?.windowId;

  if (resolvedWindowId === undefined) {
    throw buildWindowNotFoundError(managedSession.session.sessionId, requestedWindowId, []);
  }

  const targetWindow = managedSession.session.windows.find((window) => window.windowId === resolvedWindowId);
  if (targetWindow === undefined) {
    throw buildWindowNotFoundError(
      managedSession.session.sessionId,
      resolvedWindowId,
      managedSession.session.windows.map((window) => window.windowId)
    );
  }

  return targetWindow;
};

export const toDriverWindow = (window: Window): DriverWindow => {
  return {
    id: window.windowId,
    title: window.title,
    url: window.url,
    kind: window.kind,
    focused: window.focused,
    visible: window.visible
  };
};

export const toActionTarget = (target: ActionTargetInput): ActionTarget => {
  if (typeof target.ref === "string") {
    return { ref: target.ref };
  }

  if (typeof target.role === "string" && typeof target.name === "string") {
    return {
      role: target.role,
      name: target.name
    };
  }

  if (typeof target.testId === "string") {
    return { testId: target.testId };
  }

  if (typeof target.css === "string") {
    return { css: target.css };
  }

  throw createAirlockError("INVALID_INPUT", "Target must include ref, role+name, testId, or css.", false);
};

const toWarnings = (actionResult: ActionResult): readonly string[] | undefined => {
  const targetWarnings = actionResult.diagnostics?.targetWarnings;
  if (Array.isArray(targetWarnings)) {
    const warnings = targetWarnings.filter((value): value is string => typeof value === "string");
    return warnings.length > 0 ? warnings : undefined;
  }

  return undefined;
};

export const toActionToolResult = (
  actionResult: ActionResult,
  successSuggestion: string = "Take a snapshot to verify the result."
): ToolResult<ActionResult> => {
  if (actionResult.ok) {
    const warnings = toWarnings(actionResult);
    return warnings === undefined
      ? {
          data: actionResult,
          meta: {
            suggestions: [successSuggestion]
          }
        }
      : {
          data: actionResult,
          meta: {
            warnings,
            suggestions: [successSuggestion]
          }
        };
  }

  const warnings = toWarnings(actionResult);
  const diagnostics =
    actionResult.screenshotPath === undefined
      ? actionResult.diagnostics
      : {
          ...(actionResult.diagnostics ?? {}),
          screenshotPath: actionResult.screenshotPath
        };

  return {
    data: actionResult,
    meta: {
      ...(warnings === undefined ? {} : { warnings }),
      ...(diagnostics === undefined ? {} : { diagnostics }),
      suggestions: [
        "Take a fresh snapshot and retry the action with a current ref.",
        "Review the captured screenshot and console_recent() logs for diagnostics."
      ]
    }
  };
};
