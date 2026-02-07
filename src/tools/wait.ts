import { z } from "zod";

import { executeAction } from "../actions/index.js";
import { defineAirlockTool } from "../server.js";
import {
  ActionOutputSchema,
  WaitForIdleInputSchema,
  WaitForTextInputSchema,
  WaitForVisibleInputSchema
} from "../types/schemas.js";
import { toActionTarget, toActionToolResult, resolveManagedSession, resolveWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

const WaitOutputSchema = ActionOutputSchema;

type WaitForIdleInput = z.infer<typeof WaitForIdleInputSchema>;
type WaitForVisibleInput = z.infer<typeof WaitForVisibleInputSchema>;
type WaitForTextInput = z.infer<typeof WaitForTextInputSchema>;

export const waitForIdleTool = defineAirlockTool({
  name: "wait_for_idle",
  title: "Wait For Idle",
  description: [
    "Wait for the page to reach a stable state (network idle + no pending animations). Use after navigation or actions that trigger async updates.",
    "What it does: blocks until the renderer reports idle or timeout is reached.",
    "What it cannot do: this does not guarantee business-level completion for background jobs beyond renderer idleness.",
    "Defaults: uses selected window when `windowId` is omitted and `timeoutMs=10000` when not provided.",
    "Common error guidance: on timeout, inspect `console_recent()` and rerun with a longer timeout after confirming the correct window.",
    "Safety notes: deterministic wait primitive; preferred over arbitrary sleeps."
  ].join("\n"),
  inputSchema: WaitForIdleInputSchema,
  outputSchema: WaitOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: WaitForIdleInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "wait_for_idle",
      timeoutMs: input.timeoutMs
    });

    return toActionToolResult(actionResult, "Take a snapshot to confirm the page state after idle.");
  }
});

export const waitForVisibleTool = defineAirlockTool({
  name: "wait_for_visible",
  title: "Wait For Visible",
  description: [
    "Wait for a specific element to become visible. Use when expecting UI changes after an action.",
    "What it does: resolves the target using ref/locator strategy and waits until it is visible or timeout occurs.",
    "What it cannot do: this does not wait for non-DOM native UI surfaces.",
    "Defaults: uses selected window when `windowId` is omitted and `timeoutMs=10000`.",
    "Common error guidance: `REF_STALE` means refresh with `snapshot_interactive()` first; timeout usually means wrong window or unmet UI state.",
    "Safety notes: prefer ref targets from a recent snapshot for deterministic waits."
  ].join("\n"),
  inputSchema: WaitForVisibleInputSchema,
  outputSchema: WaitOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: WaitForVisibleInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "wait_for_visible",
      target: toActionTarget(input.target),
      timeoutMs: input.timeoutMs
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify the visible element state.");
  }
});

export const waitForTextTool = defineAirlockTool({
  name: "wait_for_text",
  title: "Wait For Text",
  description: [
    "Wait for specific text to appear on the page. Use for verifying content changes.",
    "What it does: waits until the provided text is detected in the current window or timeout is reached.",
    "What it cannot do: this does not validate semantic meaning of text, only presence in renderer content.",
    "Defaults: uses selected window when `windowId` is omitted and `timeoutMs=10000`.",
    "Common error guidance: if this times out, capture `screenshot()` and inspect `console_recent()` to determine whether the app reached the expected state.",
    "Safety notes: deterministic condition wait; prefer over fixed-delay sleeps."
  ].join("\n"),
  inputSchema: WaitForTextInputSchema,
  outputSchema: WaitOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: WaitForTextInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const actionResult = await executeAction(context.driver, managedSession, targetWindow.windowId, {
      action: "wait_for_text",
      text: input.text,
      timeoutMs: input.timeoutMs
    });

    return toActionToolResult(actionResult, "Take a snapshot to verify text content after wait.");
  }
});
