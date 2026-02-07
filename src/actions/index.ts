import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ActionResult, ActionTarget, DriverAction, DriverWindow, ElectronDriver } from "../driver/index.js";
import type { ManagedSession } from "../session-manager.js";
import { createAirlockError } from "../types/index.js";
import type { RefMap } from "../snapshot/ref-map.js";

type SelectorDescriptor = ReturnType<RefMap["resolveRef"]>;

export interface ResolvedTarget {
  readonly locator: string;
  readonly descriptor?: SelectorDescriptor;
  readonly warnings?: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const inferIsStale = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }

  const staleValue = value.stale;
  if (typeof staleValue === "boolean") {
    return staleValue;
  }

  const statusValue = value.status;
  return statusValue === "stale";
};

const inferLocatorString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const selectorValue = value.selector;
  if (typeof selectorValue === "string" && selectorValue.length > 0) {
    return selectorValue;
  }

  const locatorValue = value.locator;
  if (typeof locatorValue === "string" && locatorValue.length > 0) {
    return locatorValue;
  }

  return undefined;
};

const escapeForCssAttribute = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const buildRoleLocator = (role: string, name: string): string => {
  return `role=${role}[name=${JSON.stringify(name)}]`;
};

const buildTestIdLocator = (testId: string): string => {
  return `[data-testid="${escapeForCssAttribute(testId)}"]`;
};

const buildTextLocator = (text: string): string => {
  return `text=${JSON.stringify(text)}`;
};

const buildLabelLocator = (label: string): string => {
  return `label=${JSON.stringify(label)}`;
};

const parseRoleValue = (value: string): { role: string; name: string } | undefined => {
  try {
    const parsed = JSON.parse(value) as Partial<{ role: string; name: string }>;
    if (typeof parsed.role === "string" && parsed.role.length > 0 && typeof parsed.name === "string") {
      return {
        role: parsed.role,
        name: parsed.name
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const inferDescriptorLocator = (value: unknown): string | undefined => {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.value !== "string") {
    return undefined;
  }

  if (value.type === "testId") {
    return buildTestIdLocator(value.value);
  }

  if (value.type === "role") {
    const parsed = parseRoleValue(value.value);
    return parsed === undefined ? undefined : buildRoleLocator(parsed.role, parsed.name);
  }

  if (value.type === "label") {
    return buildLabelLocator(value.value);
  }

  if (value.type === "text") {
    return buildTextLocator(value.value);
  }

  if (value.type === "css") {
    return value.value;
  }

  return undefined;
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

const toDriverWindow = (window: {
  windowId: string;
  title: string;
  url: string;
  kind: DriverWindow["kind"];
  focused: boolean;
  visible: boolean;
}): DriverWindow => {
  return {
    id: window.windowId,
    title: window.title,
    url: window.url,
    kind: window.kind,
    focused: window.focused,
    visible: window.visible
  };
};

const captureFailureScreenshot = async (
  driver: ElectronDriver,
  window: DriverWindow,
  session: ManagedSession
): Promise<string | undefined> => {
  try {
    const screenshotsDir = path.join(session.session.artifactDir, "screenshots");
    await mkdir(screenshotsDir, {
      recursive: true
    });
    const outputPath = path.join(screenshotsDir, `action-failure-${Date.now()}-${randomUUID()}.png`);
    const pngBuffer = await driver.screenshot(window, {
      fullPage: true
    });
    await writeFile(outputPath, pngBuffer);
    return outputPath;
  } catch {
    return undefined;
  }
};

const normalizeRefResolutionError = (error: unknown, ref: string): never => {
  const message = toErrorMessage(error);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("stale")) {
    throw createAirlockError("REF_STALE", `Ref "${ref}" is stale.`, false, {
      ref,
      cause: message
    });
  }

  throw createAirlockError("REF_NOT_FOUND", `Ref "${ref}" was not found in the current ref map.`, false, {
    ref,
    cause: message
  });
};

export const resolveTarget = (target: ActionTarget, refMap: RefMap): ResolvedTarget => {
  if ("selector" in target) {
    if (target.selector.length === 0) {
      throw createAirlockError("INVALID_INPUT", "Target selector cannot be empty.", false);
    }

    return {
      locator: target.selector
    };
  }

  if ("ref" in target) {
    const descriptor = (() => {
      try {
        return refMap.resolveRef(target.ref);
      } catch (error: unknown) {
        normalizeRefResolutionError(error, target.ref);
      }
    })();

    if (descriptor === undefined || descriptor === null) {
      throw createAirlockError("REF_NOT_FOUND", `Ref "${target.ref}" was not found in the current ref map.`, false, {
        ref: target.ref
      });
    }

    if (inferIsStale(descriptor)) {
      throw createAirlockError("REF_STALE", `Ref "${target.ref}" is stale.`, false, {
        ref: target.ref
      });
    }

    const descriptorLocator = inferDescriptorLocator(descriptor);
    const locatorValue =
      descriptorLocator === undefined
        ? (() => {
            try {
              return refMap.toPlaywrightLocator(descriptor);
            } catch (error: unknown) {
              normalizeRefResolutionError(error, target.ref);
            }
          })()
        : descriptorLocator;

    const locator = inferLocatorString(locatorValue);
    if (locator === undefined) {
      throw createAirlockError(
        "INTERNAL_ERROR",
        `Failed to convert ref "${target.ref}" into a Playwright locator.`,
        false
      );
    }

    return {
      locator,
      descriptor
    };
  }

  if ("role" in target && "name" in target) {
    return {
      locator: buildRoleLocator(target.role, target.name)
    };
  }

  if ("testId" in target) {
    return {
      locator: buildTestIdLocator(target.testId)
    };
  }

  if ("css" in target) {
    return {
      locator: target.css,
      warnings: ["Raw CSS targets are discouraged because they are brittle. Prefer snapshot refs when possible."]
    };
  }

  throw createAirlockError("INVALID_INPUT", "Target must include ref, role+name, testId, or css.", false);
};

export const executeAction = async (
  driver: ElectronDriver,
  session: ManagedSession | undefined,
  windowId: string | undefined,
  action: DriverAction
): Promise<ActionResult> => {
  if (session === undefined) {
    throw createAirlockError("SESSION_NOT_FOUND", "Session was not found.", false);
  }

  if (session.driverSession === undefined) {
    throw createAirlockError(
      "SESSION_NOT_FOUND",
      `Driver session is not available for "${session.session.sessionId}".`,
      false,
      {
        sessionId: session.session.sessionId
      }
    );
  }

  const selectedWindowId = windowId ?? session.session.selectedWindowId ?? session.session.windows[0]?.windowId;
  if (selectedWindowId === undefined) {
    throw buildWindowNotFoundError(session.session.sessionId, windowId, []);
  }

  const targetWindow = session.session.windows.find((candidate) => candidate.windowId === selectedWindowId);
  if (targetWindow === undefined) {
    throw buildWindowNotFoundError(
      session.session.sessionId,
      selectedWindowId,
      session.session.windows.map((candidate) => candidate.windowId)
    );
  }

  const driverWindow = toDriverWindow(targetWindow);
  const defaultDiagnostics: Record<string, unknown> = {
    sessionId: session.session.sessionId,
    windowId: targetWindow.windowId,
    action: action.action
  };
  const resolvedTarget = (() => {
    if (action.target === undefined) {
      return undefined;
    }

    const targetRefMap = session.refMaps?.get(targetWindow.windowId);
    if ("ref" in action.target && targetRefMap === undefined) {
      throw createAirlockError(
        "REF_NOT_FOUND",
        `Ref "${action.target.ref}" cannot be resolved because no snapshot ref map is cached for window "${targetWindow.windowId}".`,
        false,
        {
          sessionId: session.session.sessionId,
          windowId: targetWindow.windowId,
          ref: action.target.ref
        }
      );
    }

    return resolveTarget(action.target, targetRefMap as RefMap);
  })();

  const actionPayload: DriverAction = {
    ...action,
    ...(resolvedTarget === undefined ? {} : { target: { selector: resolvedTarget.locator } })
  };

  try {
    const actionResult = await driver.performAction(driverWindow, actionPayload);
    if (actionResult.ok) {
      return resolvedTarget?.warnings === undefined
        ? actionResult
        : {
            ...actionResult,
            diagnostics: {
              ...(actionResult.diagnostics ?? {}),
              targetWarnings: resolvedTarget.warnings
            }
          };
    }

    const screenshotPath = await captureFailureScreenshot(driver, driverWindow, session);
    return {
      ok: false,
      message: actionResult.message ?? "Action failed.",
      ...(screenshotPath === undefined ? {} : { screenshotPath }),
      diagnostics: {
        ...defaultDiagnostics,
        ...(resolvedTarget?.warnings === undefined ? {} : { targetWarnings: resolvedTarget.warnings }),
        ...(actionResult.diagnostics ?? {})
      }
    };
  } catch (error: unknown) {
    const screenshotPath = await captureFailureScreenshot(driver, driverWindow, session);
    return {
      ok: false,
      message: toErrorMessage(error),
      ...(screenshotPath === undefined ? {} : { screenshotPath }),
      diagnostics: {
        ...defaultDiagnostics,
        ...(resolvedTarget?.warnings === undefined ? {} : { targetWarnings: resolvedTarget.warnings }),
        error: toErrorMessage(error)
      }
    };
  }
};
