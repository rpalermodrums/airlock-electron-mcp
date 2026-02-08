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

type WindowBounds = {
  width: number;
  height: number;
};

export type WindowSelectionReason =
  | "explicit_window_id"
  | "default_window"
  | "modal_window"
  | "most_recently_interacted_window"
  | "most_recently_focused_primary_window"
  | "first_non_devtools_window"
  | "first_available_window";

export interface WindowSelectionDiagnostics {
  strategy: WindowSelectionReason;
  requestedWindowId?: string;
  selectedWindowId: string;
  selectedWindowTitle: string;
  selectedWindowKind: Window["kind"];
  availableWindowIds: readonly string[];
}

interface ResolveWindowOptions {
  diagnostics?: Record<string, unknown>;
  trackAsInteracted?: boolean;
}

const MODAL_TITLE_PATTERN = /\b(dialog|alert|confirm|prompt|save as|open|preferences|settings)\b/i;
const MODAL_URL_PATTERN = /^about:blank(?:[?#].*)?$/i;

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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toPositiveNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
};

const extractBounds = (window: Window): WindowBounds | undefined => {
  const unknownWindow = window as unknown;
  if (!isRecord(unknownWindow)) {
    return undefined;
  }

  const boundsCandidate = unknownWindow.bounds;
  if (isRecord(boundsCandidate)) {
    const width = toPositiveNumber(boundsCandidate.width);
    const height = toPositiveNumber(boundsCandidate.height);
    if (width !== undefined && height !== undefined) {
      return {
        width,
        height
      };
    }
  }

  const width = toPositiveNumber(unknownWindow.width);
  const height = toPositiveNumber(unknownWindow.height);
  if (width !== undefined && height !== undefined) {
    return {
      width,
      height
    };
  }

  return undefined;
};

const findMainWindowBounds = (windows: readonly Window[]): WindowBounds | undefined => {
  const primaryBounds = windows
    .filter((window) => window.kind === "primary")
    .map(extractBounds)
    .filter((bounds): bounds is WindowBounds => bounds !== undefined);

  if (primaryBounds.length > 0) {
    return primaryBounds.reduce((largest, current) => {
      return current.width * current.height > largest.width * largest.height ? current : largest;
    });
  }

  const fallbackBounds = windows.map(extractBounds).filter((bounds): bounds is WindowBounds => bounds !== undefined);
  if (fallbackBounds.length === 0) {
    return undefined;
  }

  return fallbackBounds.reduce((largest, current) => {
    return current.width * current.height > largest.width * largest.height ? current : largest;
  });
};

const isSignificantlySmallerThanMainWindow = (window: Window, windows: readonly Window[]): boolean => {
  const candidateBounds = extractBounds(window);
  const mainBounds = findMainWindowBounds(windows);
  if (candidateBounds === undefined || mainBounds === undefined) {
    return false;
  }

  const candidateArea = candidateBounds.width * candidateBounds.height;
  const mainArea = mainBounds.width * mainBounds.height;

  return (
    candidateArea <= mainArea * 0.65 ||
    (candidateBounds.width <= mainBounds.width * 0.82 && candidateBounds.height <= mainBounds.height * 0.82)
  );
};

const hasDialogOrAlertTypeHint = (window: Window): boolean => {
  const unknownWindow = window as unknown;
  if (!isRecord(unknownWindow)) {
    return false;
  }

  const typeCandidate = unknownWindow.type;
  return typeof typeCandidate === "string" && /\b(dialog|alert)\b/i.test(typeCandidate);
};

export const isLikelyModal = (window: Window, windows: readonly Window[]): boolean => {
  if (window.kind === "devtools") {
    return false;
  }

  if (window.kind === "modal") {
    return true;
  }

  if (hasDialogOrAlertTypeHint(window)) {
    return true;
  }

  if (MODAL_TITLE_PATTERN.test(window.title)) {
    return true;
  }

  if (MODAL_URL_PATTERN.test(window.url)) {
    return true;
  }

  return isSignificantlySmallerThanMainWindow(window, windows);
};

const setSelectionDiagnostics = (
  diagnosticsRecord: Record<string, unknown> | undefined,
  value: WindowSelectionDiagnostics
): void => {
  if (diagnosticsRecord === undefined) {
    return;
  }

  diagnosticsRecord.windowSelection = value;
};

const pruneStaleWindowTracking = (managedSession: ManagedSession, availableWindowIds: ReadonlySet<string>): void => {
  if (managedSession.defaultWindowId !== undefined && !availableWindowIds.has(managedSession.defaultWindowId)) {
    delete managedSession.defaultWindowId;
  }

  if (
    managedSession.lastInteractedWindowId !== undefined &&
    !availableWindowIds.has(managedSession.lastInteractedWindowId)
  ) {
    delete managedSession.lastInteractedWindowId;
  }

  if (
    managedSession.lastFocusedPrimaryWindowId !== undefined &&
    !availableWindowIds.has(managedSession.lastFocusedPrimaryWindowId)
  ) {
    delete managedSession.lastFocusedPrimaryWindowId;
  }

  if (
    managedSession.session.selectedWindowId !== undefined &&
    !availableWindowIds.has(managedSession.session.selectedWindowId)
  ) {
    managedSession.session.selectedWindowId = undefined;
  }
};

const finalizeResolvedWindow = (
  managedSession: ManagedSession,
  window: Window,
  strategy: WindowSelectionReason,
  requestedWindowId: string | undefined,
  availableWindowIds: readonly string[],
  options: ResolveWindowOptions
): Window => {
  const diagnostics: WindowSelectionDiagnostics = {
    strategy,
    ...(requestedWindowId === undefined ? {} : { requestedWindowId }),
    selectedWindowId: window.windowId,
    selectedWindowTitle: window.title,
    selectedWindowKind: window.kind,
    availableWindowIds
  };

  setSelectionDiagnostics(options.diagnostics, diagnostics);

  managedSession.session.selectedWindowId = window.windowId;

  if (window.kind === "primary" && window.focused) {
    managedSession.lastFocusedPrimaryWindowId = window.windowId;
  }

  if (options.trackAsInteracted ?? true) {
    managedSession.lastInteractedWindowId = window.windowId;
  }

  return window;
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

export const resolveWindow = (
  managedSession: ManagedSession,
  requestedWindowId?: string,
  options: ResolveWindowOptions = {}
): Window => {
  const windows = managedSession.session.windows;
  const availableWindowIds = windows.map((window) => window.windowId);
  const availableWindowIdSet = new Set<string>(availableWindowIds);

  pruneStaleWindowTracking(managedSession, availableWindowIdSet);

  if (windows.length === 0) {
    throw buildWindowNotFoundError(managedSession.session.sessionId, requestedWindowId, []);
  }

  const focusedPrimaryWindow = windows.find((window) => window.kind === "primary" && window.focused);
  if (focusedPrimaryWindow !== undefined) {
    managedSession.lastFocusedPrimaryWindowId = focusedPrimaryWindow.windowId;
  }

  if (requestedWindowId !== undefined) {
    const explicitWindow = windows.find((window) => window.windowId === requestedWindowId);
    if (explicitWindow === undefined) {
      throw buildWindowNotFoundError(managedSession.session.sessionId, requestedWindowId, availableWindowIds);
    }

    return finalizeResolvedWindow(
      managedSession,
      explicitWindow,
      "explicit_window_id",
      requestedWindowId,
      availableWindowIds,
      options
    );
  }

  if (managedSession.defaultWindowId !== undefined) {
    const defaultWindow = windows.find((window) => window.windowId === managedSession.defaultWindowId);
    if (defaultWindow !== undefined) {
      return finalizeResolvedWindow(
        managedSession,
        defaultWindow,
        "default_window",
        requestedWindowId,
        availableWindowIds,
        options
      );
    }
  }

  const modalWindow = windows.find((window) => isLikelyModal(window, windows));
  if (modalWindow !== undefined) {
    return finalizeResolvedWindow(
      managedSession,
      modalWindow,
      "modal_window",
      requestedWindowId,
      availableWindowIds,
      options
    );
  }

  if (managedSession.lastInteractedWindowId !== undefined) {
    const interactedWindow = windows.find((window) => window.windowId === managedSession.lastInteractedWindowId);
    if (interactedWindow !== undefined) {
      return finalizeResolvedWindow(
        managedSession,
        interactedWindow,
        "most_recently_interacted_window",
        requestedWindowId,
        availableWindowIds,
        options
      );
    }
  }

  if (focusedPrimaryWindow !== undefined) {
    return finalizeResolvedWindow(
      managedSession,
      focusedPrimaryWindow,
      "most_recently_focused_primary_window",
      requestedWindowId,
      availableWindowIds,
      options
    );
  }

  if (managedSession.lastFocusedPrimaryWindowId !== undefined) {
    const lastFocusedPrimaryWindow = windows.find(
      (window) => window.windowId === managedSession.lastFocusedPrimaryWindowId && window.kind === "primary"
    );
    if (lastFocusedPrimaryWindow !== undefined) {
      return finalizeResolvedWindow(
        managedSession,
        lastFocusedPrimaryWindow,
        "most_recently_focused_primary_window",
        requestedWindowId,
        availableWindowIds,
        options
      );
    }
  }

  if (managedSession.session.selectedWindowId !== undefined) {
    const selectedPrimaryWindow = windows.find(
      (window) => window.windowId === managedSession.session.selectedWindowId && window.kind === "primary"
    );
    if (selectedPrimaryWindow !== undefined) {
      return finalizeResolvedWindow(
        managedSession,
        selectedPrimaryWindow,
        "most_recently_focused_primary_window",
        requestedWindowId,
        availableWindowIds,
        options
      );
    }
  }

  const firstNonDevtoolsWindow = windows.find((window) => window.kind !== "devtools");
  if (firstNonDevtoolsWindow !== undefined) {
    return finalizeResolvedWindow(
      managedSession,
      firstNonDevtoolsWindow,
      "first_non_devtools_window",
      requestedWindowId,
      availableWindowIds,
      options
    );
  }

  const firstAvailableWindow = windows[0];
  if (firstAvailableWindow === undefined) {
    throw buildWindowNotFoundError(managedSession.session.sessionId, requestedWindowId, availableWindowIds);
  }

  return finalizeResolvedWindow(
    managedSession,
    firstAvailableWindow,
    "first_available_window",
    requestedWindowId,
    availableWindowIds,
    options
  );
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
