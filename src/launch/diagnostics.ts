import process from "node:process";
import type { ChildProcess } from "node:child_process";

import type { ReadinessDiagnostics, ReadinessTimelineEntry } from "./readiness.js";

export interface LineCollector {
  push: (chunk: Buffer | string) => void;
  lines: () => readonly string[];
}

export interface ProcessOutputSnapshot {
  name: string;
  command?: string;
  pid?: number;
  stdout: readonly string[];
  stderr: readonly string[];
}

export interface ProcessOutputCollector {
  readonly name: string;
  readonly command?: string;
  readonly pid?: number;
  pushStdout: (chunk: Buffer | string) => void;
  pushStderr: (chunk: Buffer | string) => void;
  snapshot: () => ProcessOutputSnapshot;
}

export interface AttachTargetDiagnostic {
  targetId?: string;
  type?: string;
  url?: string;
  title?: string;
}

export interface AttachDiagnostics {
  discoveredTargets?: readonly AttachTargetDiagnostic[];
  selectionRationale?: string;
  selectedTargetId?: string;
  selectedTargetUrl?: string;
}

export type LaunchDiagnosticEventType = "launch" | "process" | "signal" | "window" | "target" | "attach";

export interface LaunchDiagnosticEvent {
  timestamp: string;
  type: LaunchDiagnosticEventType;
  message: string;
  data?: Record<string, unknown>;
}

export interface LaunchDiagnosticEventLog {
  add: (event: {
    type: LaunchDiagnosticEventType;
    message: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  }) => void;
  entries: () => readonly LaunchDiagnosticEvent[];
}

export interface SanitizedEnvironmentSummary {
  cwd: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  pid: number;
  env: Record<string, string>;
  redactedKeys: readonly string[];
}

export interface LaunchDiagnostics {
  capturedAt: string;
  processOutput: readonly ProcessOutputSnapshot[];
  signalTimeline: readonly ReadinessTimelineEntry[];
  eventLog: readonly LaunchDiagnosticEvent[];
  environment: SanitizedEnvironmentSummary;
  attach?: AttachDiagnostics;
}

export interface LaunchDiagnosticsConfig {
  processRingBufferLines: number;
  eventLogLimit: number;
  includeEnvPrefixes: readonly string[];
  includeEnvKeys: readonly string[];
}

export interface BuildLaunchDiagnosticsOptions {
  processCollectors?: readonly ProcessOutputCollector[];
  readiness?: ReadinessDiagnostics;
  eventLog?: readonly LaunchDiagnosticEvent[];
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
  attach?: AttachDiagnostics;
  config?: Partial<LaunchDiagnosticsConfig>;
}

const SENSITIVE_ENV_KEY_PATTERN = /(token|secret|password|passwd|key|auth|cookie|session|credential)/i;

export const DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG: LaunchDiagnosticsConfig = Object.freeze({
  processRingBufferLines: 160,
  eventLogLimit: 300,
  includeEnvPrefixes: ["AIRLOCK_", "ELECTRON_", "PLAYWRIGHT_", "NODE_", "NPM_", "CI"],
  includeEnvKeys: ["PATH", "HOME", "SHELL", "TERM", "PWD", "USER", "LANG", "TZ"]
});

const createLineCollector = (limit: number): LineCollector => {
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
      const completeLines = parts.slice(0, -1);
      state.carry = parts.at(-1) ?? "";

      for (const line of completeLines) {
        pushLine(line);
      }
    },
    lines: (): readonly string[] => {
      return [...state.lines, ...(state.carry.trim().length > 0 ? [state.carry.trim()] : [])];
    }
  };
};

const sanitizeEnvironment = (
  env: NodeJS.ProcessEnv,
  config: LaunchDiagnosticsConfig,
  cwd: string
): SanitizedEnvironmentSummary => {
  const includeKeySet = new Set(config.includeEnvKeys);
  const redactedKeys: string[] = [];

  const selectedEntries = Object.entries(env)
    .filter(([key, value]) => {
      if (typeof value !== "string") {
        return false;
      }

      if (includeKeySet.has(key)) {
        return true;
      }

      return config.includeEnvPrefixes.some((prefix) => key.startsWith(prefix));
    })
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  const sanitizedEnv = selectedEntries.reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      accumulator[key] = "[REDACTED]";
      redactedKeys.push(key);
      return accumulator;
    }

    if (typeof value === "string") {
      accumulator[key] = value;
    }

    return accumulator;
  }, {});

  return {
    cwd,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pid: process.pid,
    env: sanitizedEnv,
    redactedKeys
  };
};

const resolveDiagnosticsConfig = (overrides: Partial<LaunchDiagnosticsConfig> | undefined): LaunchDiagnosticsConfig => {
  return {
    ...DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
    ...(overrides?.processRingBufferLines === undefined
      ? {}
      : {
          processRingBufferLines: overrides.processRingBufferLines
        }),
    ...(overrides?.eventLogLimit === undefined
      ? {}
      : {
          eventLogLimit: overrides.eventLogLimit
        }),
    ...(overrides?.includeEnvPrefixes === undefined
      ? {}
      : {
          includeEnvPrefixes: overrides.includeEnvPrefixes
        }),
    ...(overrides?.includeEnvKeys === undefined
      ? {}
      : {
          includeEnvKeys: overrides.includeEnvKeys
        })
  };
};

export const createProcessOutputCollector = (options: {
  name: string;
  command?: string;
  pid?: number;
  lineLimit?: number;
}): ProcessOutputCollector => {
  const lineLimit = Math.max(options.lineLimit ?? DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG.processRingBufferLines, 10);
  const stdoutCollector = createLineCollector(lineLimit);
  const stderrCollector = createLineCollector(lineLimit);

  return {
    name: options.name,
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.pid === undefined ? {} : { pid: options.pid }),
    pushStdout: (chunk: Buffer | string): void => {
      stdoutCollector.push(chunk);
    },
    pushStderr: (chunk: Buffer | string): void => {
      stderrCollector.push(chunk);
    },
    snapshot: (): ProcessOutputSnapshot => {
      return {
        name: options.name,
        ...(options.command === undefined ? {} : { command: options.command }),
        ...(options.pid === undefined ? {} : { pid: options.pid }),
        stdout: stdoutCollector.lines(),
        stderr: stderrCollector.lines()
      };
    }
  };
};

export const bindProcessOutputCollector = (
  processRef: ChildProcess,
  collector: ProcessOutputCollector
): (() => void) => {
  const onStdout = (chunk: Buffer | string): void => {
    collector.pushStdout(chunk);
  };

  const onStderr = (chunk: Buffer | string): void => {
    collector.pushStderr(chunk);
  };

  processRef.stdout?.on("data", onStdout);
  processRef.stderr?.on("data", onStderr);

  return (): void => {
    processRef.stdout?.off("data", onStdout);
    processRef.stderr?.off("data", onStderr);
  };
};

export const createLaunchDiagnosticEventLog = (limit?: number): LaunchDiagnosticEventLog => {
  const capacity = Math.max(limit ?? DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG.eventLogLimit, 10);
  const events: LaunchDiagnosticEvent[] = [];

  return {
    add: (event): void => {
      events.push({
        timestamp: event.timestamp ?? new Date().toISOString(),
        type: event.type,
        message: event.message,
        ...(event.data === undefined ? {} : { data: event.data })
      });

      if (events.length > capacity) {
        events.splice(0, events.length - capacity);
      }
    },
    entries: (): readonly LaunchDiagnosticEvent[] => {
      return [...events];
    }
  };
};

export const buildLaunchDiagnostics = (options: BuildLaunchDiagnosticsOptions): LaunchDiagnostics => {
  const config = resolveDiagnosticsConfig(options.config);
  const processOutput = (options.processCollectors ?? []).map((collector) => collector.snapshot());
  const readinessTimeline = options.readiness?.timeline ?? [];
  const environment = sanitizeEnvironment(options.environment ?? process.env, config, options.cwd ?? process.cwd());

  return {
    capturedAt: new Date().toISOString(),
    processOutput,
    signalTimeline: readinessTimeline,
    eventLog: options.eventLog ?? [],
    environment,
    ...(options.attach === undefined ? {} : { attach: options.attach })
  };
};
