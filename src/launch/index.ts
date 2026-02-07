import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";

import type { DriverAttachConfig, DriverLaunchConfig, DriverSession, ElectronDriver } from "../driver/index.js";
import { createAirlockError } from "../types/index.js";

const DEFAULT_DEV_SERVER_TIMEOUT_MS = 60_000;
const DEFAULT_DEV_SERVER_READY_PATTERN = /ready in \d+ms/i;

export interface LaunchPreset {
  name: string;
  devServerCommand?: string;
  devServerReadyPattern?: RegExp;
  devServerUrl?: string;
  electronEntryPath?: string;
  defaultArgs?: string[];
  defaultEnv?: Record<string, string>;
}

export interface LaunchWithPresetOptions {
  driver: ElectronDriver;
  sessionId?: string;
  devServer?: {
    command?: string;
    url?: string;
    readyPattern?: RegExp;
    timeoutMs?: number;
  };
  electron?: {
    entryPath?: string;
    executablePath?: string;
    args?: string[];
    env?: Record<string, string>;
  };
  timeouts?: {
    launchMs?: number;
    firstWindowMs?: number;
  };
  attachFallback?: {
    enabled?: boolean;
    cdpUrl?: string;
    wsEndpoint?: string;
    timeoutMs?: number;
  };
}

export interface LaunchCustomConfig {
  driver: ElectronDriver;
  config: DriverLaunchConfig;
}

export const ELECTRON_VITE_PRESET: LaunchPreset = {
  name: "electron-vite",
  devServerCommand: "npx electron-vite dev",
  devServerReadyPattern: DEFAULT_DEV_SERVER_READY_PATTERN,
  electronEntryPath: "."
};

const PRESETS = new Map<string, LaunchPreset>([[ELECTRON_VITE_PRESET.name, ELECTRON_VITE_PRESET]]);

const withOptionalKey = <TValue>(
  key: string,
  value: TValue | undefined
): Record<string, TValue> | Record<string, never> => {
  return value === undefined ? {} : { [key]: value };
};

const parseRemoteDebuggingPort = (args: readonly string[]): number | undefined => {
  const explicitPortArg = args.find((arg) => arg.startsWith("--remote-debugging-port="));
  if (explicitPortArg === undefined) {
    return undefined;
  }

  const portText = explicitPortArg.slice("--remote-debugging-port=".length);
  const portNumber = Number(portText);
  return Number.isInteger(portNumber) && portNumber > 0 ? portNumber : undefined;
};

const parseAttachEndpointFromLaunchError = (error: unknown): { wsEndpoint?: string; cdpUrl?: string } => {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) {
    return {};
  }

  const readLines = (key: "stdout" | "stderr"): readonly string[] => {
    const value = (details as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((line): line is string => typeof line === "string");
  };

  const lines = [...readLines("stdout"), ...readLines("stderr")];
  const joined = lines.join("\n");
  const wsEndpoint = joined.match(/DevTools listening on (ws:\/\/[^\s]+)/i)?.[1];
  if (typeof wsEndpoint === "string" && wsEndpoint.length > 0) {
    return {
      wsEndpoint
    };
  }

  const cdpUrl = joined.match(/(https?:\/\/(127\.0\.0\.1|localhost):\d+)/i)?.[1];
  if (typeof cdpUrl === "string" && cdpUrl.length > 0) {
    return {
      cdpUrl
    };
  }

  return {};
};

const createLineCollector = (
  limit: number
): {
  push: (chunk: Buffer | string) => void;
  lines: () => readonly string[];
} => {
  const state = {
    carry: "",
    lines: [] as string[]
  };

  const pushLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    state.lines.push(trimmed);
    if (state.lines.length > limit) {
      state.lines.splice(0, state.lines.length - limit);
    }
  };

  return {
    push: (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const combined = `${state.carry}${text}`;
      const parts = combined.split(/\r?\n/);
      const complete = parts.slice(0, -1);
      state.carry = parts.at(-1) ?? "";
      for (const line of complete) {
        pushLine(line);
      }
    },
    lines: (): readonly string[] => {
      return [...state.lines, ...(state.carry.trim().length > 0 ? [state.carry.trim()] : [])];
    }
  };
};

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitForHttpReady = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (): Promise<void> => {
    try {
      const response = await fetch(url, {
        method: "GET"
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Continue polling until timeout.
    }

    if (Date.now() >= deadline) {
      throw createAirlockError("LAUNCH_FAILED", `Timed out waiting for dev server URL "${url}".`, true, {
        url,
        timeoutMs
      });
    }

    await delay(300);
    await attempt();
  };

  await attempt();
};

const waitForDevServerReady = async (config: {
  processRef: ChildProcess;
  readyPattern?: RegExp;
  timeoutMs: number;
}): Promise<{
  stdout: readonly string[];
  stderr: readonly string[];
}> => {
  const stdoutCollector = createLineCollector(120);
  const stderrCollector = createLineCollector(120);
  const readinessPattern = config.readyPattern;
  const patternMatches = (text: string): boolean => {
    if (readinessPattern === undefined) {
      return false;
    }

    const result = readinessPattern.test(text);
    readinessPattern.lastIndex = 0;
    return result;
  };

  await new Promise<void>((resolve, reject) => {
    const state = {
      settled: false
    };

    const settle = (fn: () => void): void => {
      if (state.settled) {
        return;
      }

      state.settled = true;
      cleanup();
      fn();
    };

    const onStdout = (chunk: Buffer | string): void => {
      stdoutCollector.push(chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (patternMatches(text)) {
        settle(resolve);
      }
    };

    const onStderr = (chunk: Buffer | string): void => {
      stderrCollector.push(chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (patternMatches(text)) {
        settle(resolve);
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle(() => {
        reject(
          createAirlockError("LAUNCH_FAILED", "Dev server exited before becoming ready.", true, {
            code,
            signal,
            stdout: stdoutCollector.lines(),
            stderr: stderrCollector.lines()
          })
        );
      });
    };

    const timeout = setTimeout(() => {
      settle(() => {
        reject(
          createAirlockError("LAUNCH_FAILED", "Timed out waiting for dev server readiness signal.", true, {
            timeoutMs: config.timeoutMs,
            readyPattern: readinessPattern?.source,
            stdout: stdoutCollector.lines(),
            stderr: stderrCollector.lines()
          })
        );
      });
    }, config.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      config.processRef.stdout?.off("data", onStdout);
      config.processRef.stderr?.off("data", onStderr);
      config.processRef.off("exit", onExit);
    };

    config.processRef.stdout?.on("data", onStdout);
    config.processRef.stderr?.on("data", onStderr);
    config.processRef.on("exit", onExit);

    if (readinessPattern === undefined) {
      settle(resolve);
    }
  });

  return {
    stdout: stdoutCollector.lines(),
    stderr: stderrCollector.lines()
  };
};

const terminateProcess = (processRef: ChildProcess | undefined): void => {
  if (processRef === undefined || processRef.killed) {
    return;
  }

  processRef.kill("SIGTERM");
};

const buildLaunchConfig = (
  preset: LaunchPreset,
  projectRoot: string,
  options: LaunchWithPresetOptions
): DriverLaunchConfig & { composedArgs: readonly string[] } => {
  const entryPath = options.electron?.entryPath ?? preset.electronEntryPath;
  const entryArg = entryPath === undefined ? [] : [path.resolve(projectRoot, entryPath)];
  const composedArgs = [...(preset.defaultArgs ?? []), ...entryArg, ...(options.electron?.args ?? [])];
  const env = {
    ...(preset.defaultEnv ?? {}),
    ...(options.electron?.env ?? {})
  };

  return {
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    projectRoot,
    preset: preset.name,
    ...(options.electron?.executablePath === undefined
      ? {}
      : {
          executablePath: options.electron.executablePath
        }),
    ...(composedArgs.length === 0 ? {} : { args: composedArgs }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(options.timeouts?.launchMs === undefined ? {} : { timeoutMs: options.timeouts.launchMs }),
    ...(options.timeouts?.firstWindowMs === undefined
      ? {}
      : {
          firstWindowTimeoutMs: options.timeouts.firstWindowMs
        }),
    composedArgs
  };
};

const tryAttachFallback = async (
  driver: ElectronDriver,
  launchConfig: DriverLaunchConfig & { composedArgs: readonly string[] },
  options: LaunchWithPresetOptions,
  launchError?: unknown
): Promise<DriverSession> => {
  const parsedPort = parseRemoteDebuggingPort(launchConfig.composedArgs);
  const cdpUrlFromArgs = parsedPort === undefined ? undefined : `http://127.0.0.1:${parsedPort}`;
  const parsedFromError = parseAttachEndpointFromLaunchError(launchError);
  const attachConfig: DriverAttachConfig = {
    ...(launchConfig.sessionId === undefined ? {} : { sessionId: launchConfig.sessionId }),
    ...withOptionalKey("wsEndpoint", options.attachFallback?.wsEndpoint ?? parsedFromError.wsEndpoint),
    ...withOptionalKey("cdpUrl", options.attachFallback?.cdpUrl ?? cdpUrlFromArgs ?? parsedFromError.cdpUrl),
    ...withOptionalKey("timeoutMs", options.attachFallback?.timeoutMs)
  };

  if (attachConfig.wsEndpoint === undefined && attachConfig.cdpUrl === undefined) {
    throw createAirlockError(
      "LAUNCH_FAILED",
      "Launch failed and CDP fallback was enabled, but no attach endpoint was available.",
      true,
      {
        args: launchConfig.composedArgs,
        expected: "Provide attachFallback.cdpUrl/wsEndpoint or set --remote-debugging-port=<port>."
      }
    );
  }

  const attachedSession = await driver.attach(attachConfig);
  return {
    ...attachedSession,
    metadata: {
      ...(attachedSession.metadata ?? {}),
      launchPath: "cdp_attach_fallback"
    }
  };
};

export const resolvePreset = (name: string): LaunchPreset => {
  const preset = PRESETS.get(name);
  if (preset === undefined) {
    throw createAirlockError("INVALID_INPUT", `Unknown launch preset "${name}".`, false, {
      name,
      supportedPresets: [...PRESETS.keys()]
    });
  }

  return preset;
};

export const launchWithPreset = async (
  preset: LaunchPreset,
  projectRoot: string,
  options: LaunchWithPresetOptions
): Promise<DriverSession> => {
  const devServerCommand = options.devServer?.command ?? preset.devServerCommand;
  const devServerReadyPattern = options.devServer?.readyPattern ?? preset.devServerReadyPattern;
  const devServerUrl = options.devServer?.url ?? preset.devServerUrl;
  const devServerTimeoutMs = options.devServer?.timeoutMs ?? DEFAULT_DEV_SERVER_TIMEOUT_MS;
  const launchConfig = buildLaunchConfig(preset, projectRoot, options);

  const devServerProcess =
    devServerCommand === undefined
      ? undefined
      : spawn(devServerCommand, {
          cwd: projectRoot,
          env: process.env,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"]
        });

  try {
    if (devServerProcess !== undefined) {
      const devServerWaitConfig = {
        processRef: devServerProcess,
        ...(devServerReadyPattern === undefined ? {} : { readyPattern: devServerReadyPattern }),
        timeoutMs: devServerTimeoutMs
      };
      await waitForDevServerReady(devServerWaitConfig);
    }

    if (devServerUrl !== undefined) {
      await waitForHttpReady(devServerUrl, devServerTimeoutMs);
    }

    const launchedSession = await options.driver.launch(launchConfig);
    return {
      ...launchedSession,
      metadata: {
        ...(launchedSession.metadata ?? {}),
        ...(devServerProcess === undefined
          ? {}
          : {
              devServerPid: devServerProcess.pid,
              devServerProcess
            }),
        launchPath: "playwright_launch"
      }
    };
  } catch (error: unknown) {
    const fallbackEnabled = options.attachFallback?.enabled ?? false;
    if (!fallbackEnabled) {
      terminateProcess(devServerProcess);
      throw error;
    }

    try {
      const attachedSession = await tryAttachFallback(options.driver, launchConfig, options, error);
      return {
        ...attachedSession,
        metadata: {
          ...(attachedSession.metadata ?? {}),
          ...(devServerProcess === undefined
            ? {}
            : {
                devServerPid: devServerProcess.pid,
                devServerProcess
              }),
          launchFallbackReason: error instanceof Error ? error.message : String(error)
        }
      };
    } catch (attachError: unknown) {
      terminateProcess(devServerProcess);
      throw createAirlockError("LAUNCH_FAILED", "Preset launch failed and CDP fallback attach also failed.", true, {
        preset: preset.name,
        launchError: error instanceof Error ? error.message : String(error),
        attachError: attachError instanceof Error ? attachError.message : String(attachError)
      });
    }
  }
};

export const launchCustom = async (config: LaunchCustomConfig): Promise<DriverSession> => {
  return config.driver.launch(config.config);
};
