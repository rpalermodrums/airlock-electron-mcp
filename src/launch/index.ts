import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";

import type {
  DriverAttachConfig,
  DriverAttachTargetSelection,
  DriverLaunchConfig,
  DriverSession,
  DriverWindow,
  ElectronDriver
} from "../driver/index.js";
import { createAirlockError } from "../types/index.js";
import {
  bindProcessOutputCollector,
  buildLaunchDiagnostics,
  createLaunchDiagnosticEventLog,
  createProcessOutputCollector,
  type AttachDiagnostics,
  type LaunchDiagnosticEventLog,
  type ProcessOutputCollector
} from "./diagnostics.js";
import type {
  ReadinessDiagnostics,
  ReadinessSignal,
  ReadinessSignalPresetSpec,
  ReadinessTimelineEntry
} from "./readiness.js";
import {
  createAppMarkerReadySignal,
  createDevServerReadySignal,
  createProcessStableSignal,
  createRendererReadySignal,
  createWindowCreatedSignal,
  runReadinessChain
} from "./readiness.js";
import { resolvePreset as resolvePresetFromRegistry, type LaunchPreset } from "./presets.js";

const DEFAULT_DEV_SERVER_TIMEOUT_MS = 60_000;
const DEFAULT_PROCESS_STABLE_MS = 750;
const DEFAULT_APP_MARKER_TIMEOUT_MS = 10_000;

type ProcessBinding = {
  processRef: ChildProcess;
  collector: ProcessOutputCollector;
  unbind: () => void;
};

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
  attach?: {
    cdpUrl?: string;
    wsEndpoint?: string;
    timeoutMs?: number;
    targetSelection?: DriverAttachTargetSelection;
  };
  readiness?: {
    appMarker?: string;
    appMarkerTimeoutMs?: number;
    processStableMs?: number;
  };
  attachFallback?: {
    enabled?: boolean;
    cdpUrl?: string;
    wsEndpoint?: string;
    timeoutMs?: number;
    targetSelection?: DriverAttachTargetSelection;
  };
}

export interface AttachToCDPOptions {
  driver: ElectronDriver;
  sessionId?: string;
  cdpUrl?: string;
  wsEndpoint?: string;
  timeoutMs?: number;
  targetSelection?: DriverAttachTargetSelection;
  eventLog?: LaunchDiagnosticEventLog;
  processCollectors?: readonly ProcessOutputCollector[];
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LaunchCustomConfig {
  driver: ElectronDriver;
  config: DriverLaunchConfig;
}

interface LaunchReadinessState {
  completedSignals: string[];
  diagnosticsRuns: ReadinessDiagnostics[];
}

const withOptionalKey = <TValue>(
  key: string,
  value: TValue | undefined
): Record<string, TValue> | Record<string, never> => {
  return value === undefined ? {} : { [key]: value };
};

const asMessage = (value: unknown): string => {
  return value instanceof Error ? value.message : String(value);
};

const terminateProcess = (processRef: ChildProcess | undefined): void => {
  if (processRef === undefined || processRef.killed) {
    return;
  }

  processRef.kill("SIGTERM");
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

  const joined = [...readLines("stdout"), ...readLines("stderr")].join("\n");
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

const buildLaunchConfig = (
  preset: LaunchPreset,
  projectRoot: string,
  options: LaunchWithPresetOptions
): DriverLaunchConfig & { composedArgs: readonly string[] } => {
  const entryPath = options.electron?.entryPath ?? preset.electronLaunch.entryPath;
  const entryArg = entryPath === undefined ? [] : [path.resolve(projectRoot, entryPath)];
  const composedArgs = [...(preset.electronLaunch.defaultArgs ?? []), ...entryArg, ...(options.electron?.args ?? [])];
  const env = {
    ...(preset.electronLaunch.defaultEnv ?? {}),
    ...(options.electron?.env ?? {})
  };

  return {
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    projectRoot,
    preset: preset.id,
    ...(options.electron?.executablePath === undefined
      ? {}
      : {
          executablePath: options.electron.executablePath
        }),
    ...(preset.electronLaunch.executablePath === undefined
      ? {}
      : {
          executablePath: options.electron?.executablePath ?? preset.electronLaunch.executablePath
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

const findSignalSpec = (
  signalSpecs: readonly ReadinessSignalPresetSpec[],
  kind: ReadinessSignalPresetSpec["kind"]
): ReadinessSignalPresetSpec | undefined => {
  return signalSpecs.find((spec) => spec.kind === kind);
};

const runChainAndTrack = async (
  signals: readonly ReadinessSignal[],
  state: LaunchReadinessState,
  eventLog: LaunchDiagnosticEventLog
): Promise<void> => {
  if (signals.length === 0) {
    return;
  }

  const chainResult = await runReadinessChain(signals);
  state.completedSignals.push(...chainResult.completedSignals);
  state.diagnosticsRuns.push(chainResult.diagnostics);

  for (const entry of chainResult.diagnostics.timeline) {
    eventLog.add({
      type: "signal",
      message: `${entry.signalName} attempt ${entry.attempt}: ${entry.ready ? "ready" : "pending"}`,
      timestamp: entry.finishedAt,
      data: {
        timedOut: entry.timedOut,
        durationMs: entry.durationMs,
        ...(entry.detail === undefined ? {} : { detail: entry.detail })
      }
    });
  }

  if (!chainResult.ok) {
    throw createAirlockError(
      "LAUNCH_FAILED",
      `Readiness signal \"${chainResult.failedSignal?.name}\" did not complete.`,
      true,
      {
        failedSignal: chainResult.failedSignal,
        completedSignals: chainResult.completedSignals,
        timeline: chainResult.diagnostics.timeline
      }
    );
  }
};

const combineReadinessDiagnostics = (runs: readonly ReadinessDiagnostics[]): ReadinessDiagnostics | undefined => {
  if (runs.length === 0) {
    return undefined;
  }

  const timeline = runs.flatMap((run) => run.timeline);
  const startedAt = runs[0]?.startedAt ?? new Date().toISOString();
  const finishedAt = runs.at(-1)?.finishedAt ?? new Date().toISOString();
  return {
    startedAt,
    finishedAt,
    timeline
  };
};

const collectTimeline = (diagnostics: ReadinessDiagnostics | undefined): readonly ReadinessTimelineEntry[] => {
  return diagnostics?.timeline ?? [];
};

const startDevServer = (
  command: string | undefined,
  projectRoot: string,
  lineLimit: number,
  eventLog: LaunchDiagnosticEventLog
): ProcessBinding | undefined => {
  if (command === undefined) {
    return undefined;
  }

  const processRef = spawn(command, {
    cwd: projectRoot,
    env: process.env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const collector = createProcessOutputCollector({
    name: "devServer",
    command,
    ...(processRef.pid === undefined ? {} : { pid: processRef.pid }),
    lineLimit
  });
  const unbind = bindProcessOutputCollector(processRef, collector);

  eventLog.add({
    type: "process",
    message: `Spawned dev server: ${command}`,
    data: {
      ...(processRef.pid === undefined ? {} : { pid: processRef.pid })
    }
  });

  processRef.on("exit", (code, signal) => {
    eventLog.add({
      type: "process",
      message: "Dev server process exited.",
      data: {
        code,
        signal
      }
    });
  });

  return {
    processRef,
    collector,
    unbind
  };
};

const createDomContentLoadedProbe = (
  driver: ElectronDriver,
  session: DriverSession
): ((windowId: string) => Promise<boolean>) => {
  const evaluate = driver.evaluate;
  if (evaluate === undefined) {
    return async (): Promise<boolean> => {
      return false;
    };
  }

  return async (windowId: string): Promise<boolean> => {
    const windows = await driver.getWindows(session);
    const selected = windows.find((window) => window.id === windowId);
    if (selected === undefined) {
      return false;
    }

    const result = await evaluate(
      selected,
      '() => document.readyState === "interactive" || document.readyState === "complete"'
    );
    return result === true;
  };
};

const createAppMarkerProbe = (
  marker: string,
  driver: ElectronDriver,
  session: DriverSession
): (() => Promise<boolean>) => {
  const evaluate = driver.evaluate;
  if (evaluate === undefined) {
    return async (): Promise<boolean> => {
      return false;
    };
  }

  const markerLiteral = JSON.stringify(marker);
  const script = `() => {
    const selector = ${markerLiteral};
    const element = document.querySelector(selector);
    if (element === null) {
      return false;
    }

    const style = globalThis.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }`;

  return async (): Promise<boolean> => {
    const windows = await driver.getWindows(session);
    const rendererWindow = windows.find((window) => window.kind !== "devtools");
    if (rendererWindow === undefined) {
      return false;
    }

    const visible = await evaluate(rendererWindow, script);
    return visible === true;
  };
};

const attachDiagnosticsFromSession = (session: DriverSession): AttachDiagnostics | undefined => {
  const metadata = session.metadata;
  if (metadata === undefined || typeof metadata !== "object" || metadata === null) {
    return undefined;
  }

  const bag = metadata as Record<string, unknown>;
  const targets = Array.isArray(bag.attachTargets)
    ? bag.attachTargets.filter((candidate): candidate is Record<string, unknown> => {
        return typeof candidate === "object" && candidate !== null;
      })
    : [];
  const discoveredTargets =
    targets.length === 0
      ? undefined
      : targets.map((target) => {
          const toString = (value: unknown): string | undefined => {
            return typeof value === "string" && value.length > 0 ? value : undefined;
          };
          const targetId = toString(target.targetId);
          const type = toString(target.type);
          const url = toString(target.url);
          const title = toString(target.title);

          return {
            ...(targetId === undefined ? {} : { targetId }),
            ...(type === undefined ? {} : { type }),
            ...(url === undefined ? {} : { url }),
            ...(title === undefined ? {} : { title })
          };
        });

  const selectionRationale =
    typeof bag.attachSelectionRationale === "string" && bag.attachSelectionRationale.length > 0
      ? bag.attachSelectionRationale
      : undefined;
  const selectedTargetId =
    typeof bag.primaryRendererTargetId === "string" && bag.primaryRendererTargetId.length > 0
      ? bag.primaryRendererTargetId
      : undefined;
  const selectedTargetUrl =
    typeof bag.primaryRendererUrl === "string" && bag.primaryRendererUrl.length > 0
      ? bag.primaryRendererUrl
      : undefined;

  if (
    discoveredTargets === undefined &&
    selectionRationale === undefined &&
    selectedTargetId === undefined &&
    selectedTargetUrl === undefined
  ) {
    return undefined;
  }

  return {
    ...(discoveredTargets === undefined ? {} : { discoveredTargets }),
    ...(selectionRationale === undefined ? {} : { selectionRationale }),
    ...(selectedTargetId === undefined ? {} : { selectedTargetId }),
    ...(selectedTargetUrl === undefined ? {} : { selectedTargetUrl })
  };
};

const maybeAddWindowEvents = async (
  driver: ElectronDriver,
  session: DriverSession,
  eventLog: LaunchDiagnosticEventLog
): Promise<void> => {
  const windows = await driver.getWindows(session);
  for (const window of windows) {
    eventLog.add({
      type: "window",
      message: `Discovered window ${window.id}`,
      data: {
        title: window.title,
        url: window.url,
        kind: window.kind,
        focused: window.focused
      }
    });
  }
};

const createLaunchFailure = (options: {
  message: string;
  preset: LaunchPreset;
  cause: unknown;
  processCollectors: readonly ProcessOutputCollector[];
  readinessDiagnostics: ReadinessDiagnostics | undefined;
  eventLog: LaunchDiagnosticEventLog;
  attachDiagnostics?: AttachDiagnostics;
  cwd: string;
}): ReturnType<typeof createAirlockError> => {
  const diagnostics = buildLaunchDiagnostics({
    processCollectors: options.processCollectors,
    eventLog: options.eventLog.entries(),
    cwd: options.cwd,
    ...(options.readinessDiagnostics === undefined ? {} : { readiness: options.readinessDiagnostics }),
    ...(options.attachDiagnostics === undefined ? {} : { attach: options.attachDiagnostics })
  });

  return createAirlockError("LAUNCH_FAILED", options.message, true, {
    preset: options.preset.id,
    presetVersion: options.preset.version,
    diagnosticHints: [...options.preset.diagnosticHints],
    cause: asMessage(options.cause),
    diagnostics
  });
};

const resolveAttachConfig = (options: AttachToCDPOptions): DriverAttachConfig => {
  const attachConfig: DriverAttachConfig = {
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...withOptionalKey("wsEndpoint", options.wsEndpoint),
    ...withOptionalKey("cdpUrl", options.cdpUrl),
    ...withOptionalKey("timeoutMs", options.timeoutMs),
    ...withOptionalKey("targetSelection", options.targetSelection)
  };

  return attachConfig;
};

export const attachToCDP = async (options: AttachToCDPOptions): Promise<DriverSession> => {
  const attachConfig = resolveAttachConfig(options);
  if (attachConfig.wsEndpoint === undefined && attachConfig.cdpUrl === undefined) {
    throw createAirlockError("INVALID_INPUT", "Attach requires either cdpUrl or wsEndpoint.", false);
  }

  const eventLog = options.eventLog ?? createLaunchDiagnosticEventLog();
  eventLog.add({
    type: "attach",
    message: "Attempting CDP attach.",
    data: {
      ...(attachConfig.cdpUrl === undefined ? {} : { cdpUrl: attachConfig.cdpUrl }),
      ...(attachConfig.wsEndpoint === undefined ? {} : { wsEndpoint: attachConfig.wsEndpoint })
    }
  });

  try {
    const attachedSession = await options.driver.attach(attachConfig);
    const attachDiagnostics = attachDiagnosticsFromSession(attachedSession);

    if (attachDiagnostics?.discoveredTargets !== undefined) {
      for (const target of attachDiagnostics.discoveredTargets) {
        eventLog.add({
          type: "target",
          message: "Discovered attach target.",
          data: {
            ...(target.targetId === undefined ? {} : { targetId: target.targetId }),
            ...(target.type === undefined ? {} : { type: target.type }),
            ...(target.url === undefined ? {} : { url: target.url })
          }
        });
      }
    }

    if (attachDiagnostics?.selectionRationale !== undefined) {
      eventLog.add({
        type: "target",
        message: "Attach target selection rationale.",
        data: {
          rationale: attachDiagnostics.selectionRationale,
          ...(attachDiagnostics.selectedTargetId === undefined
            ? {}
            : {
                selectedTargetId: attachDiagnostics.selectedTargetId
              }),
          ...(attachDiagnostics.selectedTargetUrl === undefined
            ? {}
            : {
                selectedTargetUrl: attachDiagnostics.selectedTargetUrl
              })
        }
      });
    }

    return {
      ...attachedSession,
      metadata: {
        ...(attachedSession.metadata ?? {}),
        launchPath: "cdp_attach",
        ...(attachDiagnostics === undefined ? {} : { attachDiagnostics })
      }
    };
  } catch (error: unknown) {
    const diagnostics = buildLaunchDiagnostics({
      eventLog: eventLog.entries(),
      ...(options.processCollectors === undefined ? {} : { processCollectors: options.processCollectors }),
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    });
    throw createAirlockError("LAUNCH_FAILED", "Failed to attach to Electron via CDP.", true, {
      cause: asMessage(error),
      attachConfig: {
        ...(attachConfig.cdpUrl === undefined ? {} : { cdpUrl: attachConfig.cdpUrl }),
        ...(attachConfig.wsEndpoint === undefined ? {} : { wsEndpoint: attachConfig.wsEndpoint }),
        ...(attachConfig.timeoutMs === undefined ? {} : { timeoutMs: attachConfig.timeoutMs })
      },
      diagnostics
    });
  }
};

const buildPostLaunchSignals = (options: {
  preset: LaunchPreset;
  launchState: LaunchReadinessState;
  driver: ElectronDriver;
  driverSession: DriverSession;
  processId: number | undefined;
  readiness: LaunchWithPresetOptions["readiness"];
}): ReadinessSignal[] => {
  const signals: ReadinessSignal[] = [];
  const processStableSpec = findSignalSpec(options.preset.readinessSignals, "processStable");
  if (processStableSpec !== undefined && options.processId !== undefined) {
    signals.push(
      createProcessStableSignal({
        timeoutMs: processStableSpec.timeoutMs,
        stableForMs: options.readiness?.processStableMs ?? DEFAULT_PROCESS_STABLE_MS,
        getPid: () => options.processId,
        ...(processStableSpec.retryPolicy === undefined ? {} : { retryPolicy: processStableSpec.retryPolicy })
      })
    );
  }

  const windowCreatedSpec = findSignalSpec(options.preset.readinessSignals, "windowCreated");
  if (windowCreatedSpec !== undefined) {
    signals.push(
      createWindowCreatedSignal({
        timeoutMs: windowCreatedSpec.timeoutMs,
        getWindows: async () => {
          const windows = await options.driver.getWindows(options.driverSession);
          return windows.map((window) => ({
            id: window.id,
            kind: window.kind,
            url: window.url
          }));
        },
        ...(windowCreatedSpec.retryPolicy === undefined ? {} : { retryPolicy: windowCreatedSpec.retryPolicy })
      })
    );
  }

  const rendererReadySpec = findSignalSpec(options.preset.readinessSignals, "rendererReady");
  if (rendererReadySpec !== undefined) {
    signals.push(
      createRendererReadySignal({
        timeoutMs: rendererReadySpec.timeoutMs,
        getWindows: async () => {
          const windows = await options.driver.getWindows(options.driverSession);
          return windows.map((window) => ({
            id: window.id,
            kind: window.kind,
            url: window.url
          }));
        },
        checkDomContentLoaded: createDomContentLoadedProbe(options.driver, options.driverSession),
        ...(rendererReadySpec.retryPolicy === undefined ? {} : { retryPolicy: rendererReadySpec.retryPolicy })
      })
    );
  }

  const marker = options.readiness?.appMarker;
  const appMarkerSpec = findSignalSpec(options.preset.readinessSignals, "appMarkerReady");
  if (appMarkerSpec !== undefined && marker !== undefined && marker.length > 0) {
    signals.push(
      createAppMarkerReadySignal({
        timeoutMs: options.readiness?.appMarkerTimeoutMs ?? appMarkerSpec.timeoutMs ?? DEFAULT_APP_MARKER_TIMEOUT_MS,
        marker,
        checkMarker: createAppMarkerProbe(marker, options.driver, options.driverSession),
        ...(appMarkerSpec.retryPolicy === undefined ? {} : { retryPolicy: appMarkerSpec.retryPolicy })
      })
    );
  }

  return signals;
};

const runDevServerReadiness = async (options: {
  preset: LaunchPreset;
  devServerBinding: ProcessBinding | undefined;
  devServerReadyPattern: RegExp | undefined;
  devServerUrl: string | undefined;
  devServerTimeoutMs: number;
  launchState: LaunchReadinessState;
  eventLog: LaunchDiagnosticEventLog;
}): Promise<void> => {
  const spec = findSignalSpec(options.preset.readinessSignals, "devServerReady");
  if (spec === undefined) {
    return;
  }

  const timeoutMs = options.devServerTimeoutMs > 0 ? options.devServerTimeoutMs : spec.timeoutMs;
  const signal = createDevServerReadySignal({
    timeoutMs,
    ...(options.devServerReadyPattern === undefined ? {} : { readyPattern: options.devServerReadyPattern }),
    ...(options.devServerUrl === undefined ? {} : { probeUrl: options.devServerUrl }),
    getStdoutLines: () => options.devServerBinding?.collector.snapshot().stdout ?? [],
    getStderrLines: () => options.devServerBinding?.collector.snapshot().stderr ?? [],
    ...(spec.retryPolicy === undefined ? {} : { retryPolicy: spec.retryPolicy })
  });

  await runChainAndTrack([signal], options.launchState, options.eventLog);
};

const executeAttachPresetFlow = async (options: {
  preset: LaunchPreset;
  projectRoot: string;
  launchOptions: LaunchWithPresetOptions;
  launchState: LaunchReadinessState;
  devServerBinding: ProcessBinding | undefined;
  eventLog: LaunchDiagnosticEventLog;
}): Promise<DriverSession> => {
  const attachEndpointsFromArgs = parseRemoteDebuggingPort(options.launchOptions.electron?.args ?? []);
  const attachCdpUrl =
    options.launchOptions.attach?.cdpUrl ??
    options.preset.electronLaunch.attach?.cdpUrl ??
    (attachEndpointsFromArgs === undefined ? undefined : `http://127.0.0.1:${attachEndpointsFromArgs}`);
  const attachWsEndpoint = options.launchOptions.attach?.wsEndpoint ?? options.preset.electronLaunch.attach?.wsEndpoint;
  const attachSession = await attachToCDP({
    driver: options.launchOptions.driver,
    ...(options.launchOptions.sessionId === undefined ? {} : { sessionId: options.launchOptions.sessionId }),
    ...(attachCdpUrl === undefined ? {} : { cdpUrl: attachCdpUrl }),
    ...(attachWsEndpoint === undefined ? {} : { wsEndpoint: attachWsEndpoint }),
    ...(options.launchOptions.attach?.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.launchOptions.attach.timeoutMs }),
    ...(options.launchOptions.attach?.targetSelection === undefined
      ? {}
      : { targetSelection: options.launchOptions.attach.targetSelection }),
    eventLog: options.eventLog,
    processCollectors: options.devServerBinding === undefined ? [] : [options.devServerBinding.collector],
    cwd: options.projectRoot
  });

  await maybeAddWindowEvents(options.launchOptions.driver, attachSession, options.eventLog);

  const processId =
    typeof attachSession.metadata?.processId === "number" && Number.isInteger(attachSession.metadata.processId)
      ? attachSession.metadata.processId
      : undefined;
  const postLaunchSignals = buildPostLaunchSignals({
    preset: options.preset,
    launchState: options.launchState,
    driver: options.launchOptions.driver,
    driverSession: attachSession,
    processId,
    readiness: options.launchOptions.readiness
  });

  await runChainAndTrack(postLaunchSignals, options.launchState, options.eventLog);
  const attachReadiness = combineReadinessDiagnostics(options.launchState.diagnosticsRuns);

  return {
    ...attachSession,
    metadata: {
      ...(attachSession.metadata ?? {}),
      preset: options.preset.id,
      presetVersion: options.preset.version,
      readinessCompletedSignals: options.launchState.completedSignals,
      readinessTimeline: collectTimeline(attachReadiness),
      ...(options.devServerBinding === undefined
        ? {}
        : {
            devServerPid: options.devServerBinding.processRef.pid,
            devServerProcess: options.devServerBinding.processRef
          })
    }
  };
};

const resolvePresetAttachConfig = (
  launchConfig: DriverLaunchConfig & { composedArgs: readonly string[] },
  options: LaunchWithPresetOptions,
  launchError: unknown
): {
  cdpUrl?: string;
  wsEndpoint?: string;
  timeoutMs?: number;
  targetSelection?: DriverAttachTargetSelection;
} => {
  const parsedPort = parseRemoteDebuggingPort(launchConfig.composedArgs);
  const cdpUrlFromArgs = parsedPort === undefined ? undefined : `http://127.0.0.1:${parsedPort}`;
  const parsedFromError = parseAttachEndpointFromLaunchError(launchError);
  const cdpUrl = options.attachFallback?.cdpUrl ?? options.attach?.cdpUrl ?? cdpUrlFromArgs ?? parsedFromError.cdpUrl;
  const wsEndpoint = options.attachFallback?.wsEndpoint ?? options.attach?.wsEndpoint ?? parsedFromError.wsEndpoint;
  const timeoutMs = options.attachFallback?.timeoutMs ?? options.attach?.timeoutMs;
  const targetSelection = options.attachFallback?.targetSelection ?? options.attach?.targetSelection;

  return {
    ...(cdpUrl === undefined ? {} : { cdpUrl }),
    ...(wsEndpoint === undefined ? {} : { wsEndpoint }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(targetSelection === undefined ? {} : { targetSelection })
  };
};

export const resolvePreset = (name: string): LaunchPreset => {
  return resolvePresetFromRegistry(name);
};

export const launchWithPreset = async (
  preset: LaunchPreset,
  projectRoot: string,
  options: LaunchWithPresetOptions
): Promise<DriverSession> => {
  const eventLog = createLaunchDiagnosticEventLog(preset.diagnostics.eventLogLimit);
  const launchState: LaunchReadinessState = {
    completedSignals: [],
    diagnosticsRuns: []
  };
  const launchConfig = buildLaunchConfig(preset, projectRoot, options);

  const presetManagesDevServer = preset.devServer.managed;
  const devServerCommand =
    options.devServer?.command ?? (presetManagesDevServer ? preset.devServer.command : undefined);
  const devServerReadyPattern =
    options.devServer?.readyPattern ?? (presetManagesDevServer ? preset.devServer.readyPattern : undefined);
  const devServerUrl = options.devServer?.url ?? (presetManagesDevServer ? preset.devServer.readyUrl : undefined);
  const devServerTimeoutMs =
    options.devServer?.timeoutMs ??
    (presetManagesDevServer ? preset.devServer.timeoutMs : undefined) ??
    findSignalSpec(preset.readinessSignals, "devServerReady")?.timeoutMs ??
    DEFAULT_DEV_SERVER_TIMEOUT_MS;

  const devServerBinding = startDevServer(
    devServerCommand,
    projectRoot,
    preset.diagnostics.processRingBufferLines,
    eventLog
  );

  const processCollectors = devServerBinding === undefined ? [] : [devServerBinding.collector];

  try {
    await runDevServerReadiness({
      preset,
      devServerBinding,
      devServerReadyPattern,
      devServerUrl,
      devServerTimeoutMs,
      launchState,
      eventLog
    });

    if (preset.mode === "attach") {
      return await executeAttachPresetFlow({
        preset,
        projectRoot,
        launchOptions: options,
        launchState,
        devServerBinding,
        eventLog
      });
    }

    const launchedSession = await options.driver.launch(launchConfig);
    eventLog.add({
      type: "launch",
      message: `Electron launch completed for preset ${preset.id}.`,
      data: {
        sessionId: launchedSession.id,
        launchMode: launchedSession.launchMode
      }
    });

    await maybeAddWindowEvents(options.driver, launchedSession, eventLog);

    const processId =
      typeof launchedSession.metadata?.processId === "number" && Number.isInteger(launchedSession.metadata.processId)
        ? launchedSession.metadata.processId
        : undefined;
    const postLaunchSignals = buildPostLaunchSignals({
      preset,
      launchState,
      driver: options.driver,
      driverSession: launchedSession,
      processId,
      readiness: options.readiness
    });

    await runChainAndTrack(postLaunchSignals, launchState, eventLog);
    const readinessDiagnostics = combineReadinessDiagnostics(launchState.diagnosticsRuns);

    return {
      ...launchedSession,
      metadata: {
        ...(launchedSession.metadata ?? {}),
        ...(devServerBinding === undefined
          ? {}
          : {
              devServerPid: devServerBinding.processRef.pid,
              devServerProcess: devServerBinding.processRef
            }),
        launchPath: "playwright_launch",
        readinessCompletedSignals: launchState.completedSignals,
        readinessTimeline: collectTimeline(readinessDiagnostics)
      }
    };
  } catch (error: unknown) {
    const readinessDiagnostics = combineReadinessDiagnostics(launchState.diagnosticsRuns);
    const fallbackEnabled = options.attachFallback?.enabled ?? false;
    if (!fallbackEnabled || preset.mode === "attach") {
      if (devServerBinding !== undefined) {
        devServerBinding.unbind();
        terminateProcess(devServerBinding.processRef);
      }

      throw createLaunchFailure({
        message: `Preset launch failed for \"${preset.id}\".`,
        preset,
        cause: error,
        processCollectors,
        readinessDiagnostics,
        eventLog,
        cwd: projectRoot
      });
    }

    try {
      const attachConfig = resolvePresetAttachConfig(launchConfig, options, error);
      const attachedSession = await attachToCDP({
        driver: options.driver,
        ...(launchConfig.sessionId === undefined ? {} : { sessionId: launchConfig.sessionId }),
        ...withOptionalKey("cdpUrl", attachConfig.cdpUrl),
        ...withOptionalKey("wsEndpoint", attachConfig.wsEndpoint),
        ...withOptionalKey("timeoutMs", attachConfig.timeoutMs),
        ...withOptionalKey("targetSelection", attachConfig.targetSelection),
        eventLog,
        processCollectors,
        cwd: projectRoot
      });

      await maybeAddWindowEvents(options.driver, attachedSession, eventLog);

      const processId =
        typeof attachedSession.metadata?.processId === "number" && Number.isInteger(attachedSession.metadata.processId)
          ? attachedSession.metadata.processId
          : undefined;
      const postLaunchSignals = buildPostLaunchSignals({
        preset,
        launchState,
        driver: options.driver,
        driverSession: attachedSession,
        processId,
        readiness: options.readiness
      });
      await runChainAndTrack(postLaunchSignals, launchState, eventLog);
      const fallbackReadiness = combineReadinessDiagnostics(launchState.diagnosticsRuns);

      return {
        ...attachedSession,
        metadata: {
          ...(attachedSession.metadata ?? {}),
          ...(devServerBinding === undefined
            ? {}
            : {
                devServerPid: devServerBinding.processRef.pid,
                devServerProcess: devServerBinding.processRef
              }),
          launchFallbackReason: asMessage(error),
          readinessCompletedSignals: launchState.completedSignals,
          readinessTimeline: collectTimeline(fallbackReadiness)
        }
      };
    } catch (attachError: unknown) {
      if (devServerBinding !== undefined) {
        devServerBinding.unbind();
        terminateProcess(devServerBinding.processRef);
      }

      throw createLaunchFailure({
        message: "Preset launch failed and CDP attach fallback also failed.",
        preset,
        cause: `launchError=${asMessage(error)}; attachError=${asMessage(attachError)}`,
        processCollectors,
        readinessDiagnostics,
        eventLog,
        cwd: projectRoot
      });
    }
  }
};

export const launchCustom = async (config: LaunchCustomConfig): Promise<DriverSession> => {
  return config.driver.launch(config.config);
};

export * from "./presets.js";
export * from "./playbooks.js";
export * from "./readiness.js";
export * from "./diagnostics.js";
