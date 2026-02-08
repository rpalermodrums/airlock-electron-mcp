import process from "node:process";

import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { createAirlockError, SAFETY_CAPABILITIES } from "../types/index.js";
import { AppKillInputSchema, AppKillOutputSchema } from "../types/schemas.js";
import { resolveManagedSession } from "./helpers.js";

const APP_KILL_MODES = ["standard", "trusted"] as const;

type AppKillInput = z.infer<typeof AppKillInputSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toErrorMessage = (value: unknown): string => {
  return value instanceof Error ? value.message : String(value);
};

const readElectronPid = (metadata: Record<string, unknown> | undefined): number | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  const candidate = metadata.processId;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : undefined;
};

const isMissingProcessError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === "ESRCH";
};

export const appKillTool = defineAirlockTool({
  name: "app_kill",
  title: "Force Kill Session",
  description: [
    "Forcefully terminates the Electron process for a session and removes the session from the active registry.",
    "What it does: attempts SIGKILL on the known Electron PID (when available), then runs cleanup and removes session state.",
    "What it cannot do: attached sessions without a known PID fall back to driver teardown rather than direct process kill.",
    "Defaults: best-effort force kill + cleanup in one call; intended for hung or unresponsive sessions.",
    "Common error guidance: if kill fails, inspect `server_status()` and `doctor()` before relaunching.",
    "Safety notes: restricted to standard/trusted modes and guarded by allowAppKill policy capability."
  ].join("\n"),
  inputSchema: AppKillInputSchema,
  outputSchema: AppKillOutputSchema,
  allowedModes: APP_KILL_MODES,
  handler: async (input: AppKillInput, context) => {
    if (!SAFETY_CAPABILITIES[context.mode].allowAppKill) {
      throw createAirlockError("POLICY_VIOLATION", `Mode "${context.mode}" does not allow app_kill.`, false, {
        mode: context.mode
      });
    }

    const managedSession = resolveManagedSession(context, input.sessionId);
    const metadata =
      managedSession.driverSession.metadata !== undefined && isRecord(managedSession.driverSession.metadata)
        ? managedSession.driverSession.metadata
        : undefined;

    const electronPid = readElectronPid(metadata);
    const cleanupErrors: string[] = [];
    let forceKilled = false;

    if (electronPid !== undefined) {
      try {
        process.kill(electronPid, "SIGKILL");
        forceKilled = true;
      } catch (error: unknown) {
        if (!isMissingProcessError(error)) {
          cleanupErrors.push(`Failed to SIGKILL process ${electronPid}: ${toErrorMessage(error)}`);
        }
      }
    }

    try {
      if (managedSession.cleanup !== undefined) {
        await managedSession.cleanup(managedSession);
      } else {
        await context.driver.close(managedSession.driverSession);
      }
    } catch (error: unknown) {
      cleanupErrors.push(`Cleanup failed: ${toErrorMessage(error)}`);
    }

    context.sessions.remove(input.sessionId);

    if (cleanupErrors.length > 0) {
      throw createAirlockError(
        "INTERNAL_ERROR",
        `Session "${input.sessionId}" was removed, but force-kill cleanup had errors.`,
        true,
        {
          sessionId: input.sessionId,
          ...(electronPid === undefined ? {} : { electronPid }),
          cleanupErrors
        }
      );
    }

    const message =
      electronPid === undefined
        ? `Session "${input.sessionId}" closed (no direct Electron PID was available to SIGKILL).`
        : forceKilled
          ? `Force-killed Electron process ${electronPid} and removed session "${input.sessionId}".`
          : `Electron process ${electronPid} was not running; session "${input.sessionId}" was removed.`;

    return {
      data: {
        ok: true,
        message
      }
    };
  }
});
