import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { z } from "zod";

import { createSessionArtifactDir, ensureArtifactDirectories } from "../artifacts/index.js";
import type { DriverSession, DriverWindow } from "../driver/index.js";
import { launchCustom, launchWithPreset, resolvePreset } from "../launch/index.js";
import { defineAirlockTool } from "../server.js";
import {
  createAirlockError,
  sessionId as toSessionId,
  windowId as toWindowId,
  type Session,
  type Window
} from "../types/index.js";

const DevServerInputSchema = z
  .object({
    command: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    readyPattern: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional()
  })
  .strict();

const ElectronInputSchema = z
  .object({
    entryPath: z.string().min(1).optional(),
    executablePath: z.string().min(1).optional(),
    args: z.array(z.string().min(1)).optional(),
    env: z.record(z.string()).optional()
  })
  .strict();

const TimeoutsInputSchema = z
  .object({
    launchMs: z.number().int().positive().max(300_000).optional(),
    firstWindowMs: z.number().int().positive().max(300_000).optional()
  })
  .strict();

const AppLaunchInputSchema = z
  .object({
    preset: z.string().min(1).optional(),
    projectRoot: z.string().min(1),
    devServer: DevServerInputSchema.optional(),
    electron: ElectronInputSchema.optional(),
    timeouts: TimeoutsInputSchema.optional()
  })
  .strict();

const WindowOutputSchema = z
  .object({
    windowId: z.string().min(1),
    title: z.string(),
    url: z.string(),
    kind: z.enum(["primary", "modal", "devtools", "utility", "unknown"]),
    focused: z.boolean(),
    visible: z.boolean(),
    lastSeenAt: z.string().min(1)
  })
  .strict();

const AppLaunchOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    launchMode: z.enum(["preset", "custom", "attached"]),
    state: z.enum(["launching", "running", "closed", "error"]),
    selectedWindowId: z.string().min(1).optional(),
    artifactDir: z.string().min(1),
    windows: z.array(WindowOutputSchema)
  })
  .strict();

const DEFAULT_PRESET = "electron-vite";

const parseReadyPattern = (pattern: string | undefined): RegExp | undefined => {
  if (pattern === undefined) {
    return undefined;
  }

  try {
    return new RegExp(pattern, "i");
  } catch {
    throw createAirlockError("INVALID_INPUT", `Invalid devServer.readyPattern regex: "${pattern}".`, false, {
      pattern
    });
  }
};

const maybeRemoteDebugPortEnabled = (args: readonly string[] | undefined): boolean => {
  if (args === undefined) {
    return false;
  }

  return args.some((arg) => arg.startsWith("--remote-debugging-port="));
};

const toSessionWindow = (window: DriverWindow): Window => {
  return {
    windowId: toWindowId(window.id),
    title: window.title,
    url: window.url,
    kind: window.kind,
    focused: window.focused,
    visible: window.visible,
    lastSeenAt: new Date().toISOString()
  };
};

const pickSelectedWindowId = (windows: readonly Window[]): Window["windowId"] | undefined => {
  const primary = windows.find((window) => window.kind === "primary");
  return primary?.windowId ?? windows[0]?.windowId;
};

const extractDevServerProcess = (driverSession: DriverSession): ChildProcess | undefined => {
  const metadata = driverSession.metadata;
  if (metadata === undefined || typeof metadata !== "object" || metadata === null) {
    return undefined;
  }

  const candidate = (metadata as Record<string, unknown>).devServerProcess;
  if (candidate === undefined || typeof candidate !== "object" || candidate === null) {
    return undefined;
  }

  return candidate as ChildProcess;
};

const terminateProcess = (processRef: ChildProcess | undefined): void => {
  if (processRef === undefined || processRef.killed) {
    return;
  }

  processRef.kill("SIGTERM");
};

const composeCustomArgs = (
  projectRoot: string,
  electron: z.infer<typeof ElectronInputSchema> | undefined
): readonly string[] | undefined => {
  if (electron === undefined) {
    return undefined;
  }

  const entryArg = electron.entryPath === undefined ? [] : [path.resolve(projectRoot, electron.entryPath)];
  const args = [...entryArg, ...(electron.args ?? [])];
  return args.length === 0 ? undefined : args;
};

export const appLaunchTool = defineAirlockTool({
  name: "app_launch",
  title: "Launch Electron App",
  description: [
    "Launches or attaches to an Electron app session using a preset orchestration flow (default: electron-vite) or an explicit custom launch path.",
    "What it does: resolves a preset, optionally starts a dev server and waits for readiness, launches Electron, falls back to CDP attach when remote debugging is configured, and creates a tracked Airlock session.",
    "What it cannot do: this does not bypass OS-native dialogs and does not guarantee your renderer is fully interactive beyond first-window readiness.",
    "Defaults: preset defaults to `electron-vite`; launch + first-window timeouts come from server defaults unless overridden in `timeouts`.",
    "Common error guidance: run `doctor()` first for dependency/runtime issues, then verify your `projectRoot`, `devServer.readyPattern`, and Electron args.",
    "Safety notes: allowed in all modes; launch configuration still follows mode-restricted tools and policy boundaries for subsequent actions."
  ].join("\n"),
  inputSchema: AppLaunchInputSchema,
  outputSchema: AppLaunchOutputSchema,
  allowedModes: ["safe", "standard", "trusted"],
  handler: async (input, context) => {
    const artifactPaths = await ensureArtifactDirectories(context.policy.artifactRoot);
    const artifactAllocation = await createSessionArtifactDir(artifactPaths);
    const sessionId = toSessionId(artifactAllocation.sessionId);
    const now = new Date().toISOString();

    const launchPresetName = input.preset ?? context.preset ?? DEFAULT_PRESET;
    const runAsCustom = launchPresetName === "custom";
    const devReadyPattern = parseReadyPattern(input.devServer?.readyPattern);
    const customArgs = composeCustomArgs(input.projectRoot, input.electron);

    const driverSession = runAsCustom
      ? await launchCustom({
          driver: context.driver,
          config: {
            sessionId,
            projectRoot: input.projectRoot,
            ...(input.electron?.executablePath === undefined
              ? {}
              : {
                  executablePath: input.electron.executablePath
                }),
            ...(customArgs === undefined
              ? {}
              : {
                  args: customArgs
                }),
            ...(input.electron?.env === undefined
              ? {}
              : {
                  env: input.electron.env
                }),
            ...(input.timeouts?.launchMs === undefined ? {} : { timeoutMs: input.timeouts.launchMs }),
            ...(input.timeouts?.firstWindowMs === undefined
              ? {}
              : {
                  firstWindowTimeoutMs: input.timeouts.firstWindowMs
                })
          }
        })
      : await launchWithPreset(resolvePreset(launchPresetName), input.projectRoot, {
          driver: context.driver,
          sessionId,
          ...(input.devServer === undefined
            ? {}
            : {
                devServer: {
                  ...(input.devServer.command === undefined ? {} : { command: input.devServer.command }),
                  ...(input.devServer.url === undefined ? {} : { url: input.devServer.url }),
                  ...(devReadyPattern === undefined ? {} : { readyPattern: devReadyPattern }),
                  ...(input.devServer.timeoutMs === undefined ? {} : { timeoutMs: input.devServer.timeoutMs })
                }
              }),
          ...(input.electron === undefined
            ? {}
            : {
                electron: {
                  ...(input.electron.entryPath === undefined ? {} : { entryPath: input.electron.entryPath }),
                  ...(input.electron.executablePath === undefined
                    ? {}
                    : {
                        executablePath: input.electron.executablePath
                      }),
                  ...(input.electron.args === undefined ? {} : { args: input.electron.args }),
                  ...(input.electron.env === undefined ? {} : { env: input.electron.env })
                }
              }),
          ...(input.timeouts === undefined
            ? {}
            : {
                timeouts: {
                  ...(input.timeouts.launchMs === undefined ? {} : { launchMs: input.timeouts.launchMs }),
                  ...(input.timeouts.firstWindowMs === undefined
                    ? {}
                    : {
                        firstWindowMs: input.timeouts.firstWindowMs
                      })
                }
              }),
          attachFallback: {
            enabled: maybeRemoteDebugPortEnabled(input.electron?.args)
          }
        });

    const driverWindows = await context.driver.getWindows(driverSession);
    const windows = driverWindows.map(toSessionWindow);
    const selectedWindowId = pickSelectedWindowId(windows);

    const session: Session = {
      sessionId,
      state: "running",
      mode: context.mode,
      launchMode: driverSession.launchMode,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      artifactDir: artifactAllocation.sessionDir,
      selectedWindowId,
      windows
    };

    const devServerProcess = extractDevServerProcess(driverSession);

    context.sessions.add({
      session,
      driverSession,
      cleanup: async (managedSession) => {
        const cleanupNow = new Date().toISOString();
        managedSession.session.state = "closed";
        managedSession.session.updatedAt = cleanupNow;
        managedSession.session.lastActivityAt = cleanupNow;

        if (managedSession.driverSession === undefined) {
          terminateProcess(devServerProcess);
          return;
        }

        try {
          await context.driver.close(managedSession.driverSession);
        } finally {
          terminateProcess(devServerProcess);
        }
      }
    });

    return {
      data: {
        sessionId: session.sessionId,
        launchMode: session.launchMode,
        state: session.state,
        ...(selectedWindowId === undefined ? {} : { selectedWindowId }),
        artifactDir: session.artifactDir,
        windows
      },
      ...(windows.length === 0
        ? {
            meta: {
              warnings: ["Session launched but no renderer windows were discovered yet."],
              suggestions: ["Call window_list() after a short wait to refresh available windows."]
            }
          }
        : {})
    };
  }
});
