import process from "node:process";

export interface SignalResult {
  ready: boolean;
  detail?: string;
}

export interface RetryPolicy {
  intervalMs?: number;
  maxAttempts?: number;
}

export type ReadinessSignalKind =
  | "processStable"
  | "devServerReady"
  | "windowCreated"
  | "rendererReady"
  | "appMarkerReady";

export interface ReadinessSignalPresetSpec {
  kind: ReadinessSignalKind;
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
  optional?: boolean;
}

export interface ReadinessSignal {
  name: string;
  check: () => Promise<SignalResult>;
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
  diagnosticPayload?: Record<string, unknown>;
}

export interface ReadinessTimelineEntry {
  signalName: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ready: boolean;
  timedOut: boolean;
  detail?: string;
  error?: string;
  diagnosticPayload?: Record<string, unknown>;
}

export interface ReadinessDiagnostics {
  startedAt: string;
  finishedAt: string;
  timeline: readonly ReadinessTimelineEntry[];
}

export interface FailedReadinessSignal {
  name: string;
  detail?: string;
  timedOut: boolean;
  attempts: number;
}

export interface ReadinessChainResult {
  ok: boolean;
  completedSignals: readonly string[];
  failedSignal?: FailedReadinessSignal;
  diagnostics: ReadinessDiagnostics;
}

export interface ReadinessWindow {
  id: string;
  kind: string;
  url: string;
}

export interface ProcessStableSignalOptions {
  timeoutMs: number;
  stableForMs: number;
  getPid: () => number | undefined;
  retryPolicy?: RetryPolicy;
  isAlive?: (pid: number) => boolean;
  name?: string;
}

export interface DevServerReadySignalOptions {
  timeoutMs: number;
  readyPattern?: RegExp;
  probeUrl?: string;
  getStdoutLines?: () => readonly string[];
  getStderrLines?: () => readonly string[];
  retryPolicy?: RetryPolicy;
  fetchImpl?: typeof fetch;
  name?: string;
}

export interface WindowCreatedSignalOptions {
  timeoutMs: number;
  getWindows: () => Promise<readonly ReadinessWindow[]>;
  retryPolicy?: RetryPolicy;
  name?: string;
}

export interface RendererReadySignalOptions {
  timeoutMs: number;
  getWindows: () => Promise<readonly ReadinessWindow[]>;
  checkDomContentLoaded?: (windowId: string) => Promise<boolean>;
  retryPolicy?: RetryPolicy;
  name?: string;
}

export interface AppMarkerReadySignalOptions {
  timeoutMs: number;
  marker: string;
  checkMarker: () => Promise<boolean>;
  retryPolicy?: RetryPolicy;
  name?: string;
}

const DEFAULT_SIGNAL_RETRY_INTERVAL_MS = 250;

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const asErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isDevtoolsWindow = (window: ReadinessWindow): boolean => {
  const normalizedKind = window.kind.trim().toLowerCase();
  const normalizedUrl = window.url.trim().toLowerCase();
  return (
    normalizedKind === "devtools" ||
    normalizedUrl.startsWith("devtools://") ||
    normalizedUrl.startsWith("chrome-devtools://")
  );
};

const isWindowUrlReady = (url: string): boolean => {
  const normalized = url.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  if (normalized === "about:blank") {
    return false;
  }

  return true;
};

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;

    return code === "EPERM";
  }
};

const withFinishedAt = (
  startedAt: string,
  timeline: readonly ReadinessTimelineEntry[],
  result: Omit<ReadinessChainResult, "diagnostics">
): ReadinessChainResult => {
  return {
    ...result,
    diagnostics: {
      startedAt,
      finishedAt: new Date().toISOString(),
      timeline
    }
  };
};

const toSignalCheckResult = async (
  signal: ReadinessSignal
): Promise<{ ready: boolean; detail?: string; error?: string }> => {
  try {
    const signalResult = await signal.check();
    return {
      ready: signalResult.ready,
      ...(signalResult.detail === undefined ? {} : { detail: signalResult.detail })
    };
  } catch (error: unknown) {
    const message = asErrorMessage(error);
    return {
      ready: false,
      detail: message,
      error: message
    };
  }
};

export const runReadinessChain = async (signals: readonly ReadinessSignal[]): Promise<ReadinessChainResult> => {
  const startedAt = new Date().toISOString();
  const timeline: ReadinessTimelineEntry[] = [];
  const completedSignals: string[] = [];

  for (const signal of signals) {
    const intervalMs = Math.max(signal.retryPolicy?.intervalMs ?? DEFAULT_SIGNAL_RETRY_INTERVAL_MS, 10);
    const maxAttempts = signal.retryPolicy?.maxAttempts;
    const signalDeadline = Date.now() + signal.timeoutMs;
    let attempts = 0;
    let lastDetail: string | undefined;

    while (true) {
      attempts += 1;
      const attemptStartedAtMs = Date.now();
      const attemptStartedAt = new Date(attemptStartedAtMs).toISOString();
      const signalCheck = await toSignalCheckResult(signal);
      const finishedAtMs = Date.now();
      const finishedAt = new Date(finishedAtMs).toISOString();
      const timedOut = !signalCheck.ready && finishedAtMs >= signalDeadline;

      timeline.push({
        signalName: signal.name,
        attempt: attempts,
        startedAt: attemptStartedAt,
        finishedAt,
        durationMs: finishedAtMs - attemptStartedAtMs,
        ready: signalCheck.ready,
        timedOut,
        ...(signalCheck.detail === undefined ? {} : { detail: signalCheck.detail }),
        ...(signalCheck.error === undefined ? {} : { error: signalCheck.error }),
        ...(signal.diagnosticPayload === undefined ? {} : { diagnosticPayload: signal.diagnosticPayload })
      });

      if (signalCheck.ready) {
        completedSignals.push(signal.name);
        break;
      }

      if (signalCheck.detail !== undefined) {
        lastDetail = signalCheck.detail;
      }

      const exhaustedAttempts = maxAttempts !== undefined && attempts >= maxAttempts;
      if (timedOut || exhaustedAttempts) {
        return withFinishedAt(startedAt, timeline, {
          ok: false,
          completedSignals,
          failedSignal: {
            name: signal.name,
            ...(lastDetail === undefined ? {} : { detail: lastDetail }),
            timedOut,
            attempts
          }
        });
      }

      await delay(intervalMs);
    }
  }

  return withFinishedAt(startedAt, timeline, {
    ok: true,
    completedSignals
  });
};

export const createProcessStableSignal = (options: ProcessStableSignalOptions): ReadinessSignal => {
  const isAlive = options.isAlive ?? defaultIsPidAlive;
  const state = {
    aliveSinceMs: undefined as number | undefined
  };

  return {
    name: options.name ?? "processStable",
    timeoutMs: options.timeoutMs,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    diagnosticPayload: {
      stableForMs: options.stableForMs
    },
    check: async (): Promise<SignalResult> => {
      const pid = options.getPid();
      if (pid === undefined || pid <= 0) {
        state.aliveSinceMs = undefined;
        return {
          ready: false,
          detail: "No Electron process id is available yet."
        };
      }

      const alive = isAlive(pid);
      if (!alive) {
        state.aliveSinceMs = undefined;
        return {
          ready: false,
          detail: `Electron process ${pid} is not alive.`
        };
      }

      const nowMs = Date.now();
      const aliveSinceMs = state.aliveSinceMs ?? nowMs;
      state.aliveSinceMs = aliveSinceMs;
      const aliveForMs = nowMs - aliveSinceMs;

      if (aliveForMs >= options.stableForMs) {
        return {
          ready: true,
          detail: `Electron process ${pid} stayed alive for ${aliveForMs}ms.`
        };
      }

      return {
        ready: false,
        detail: `Electron process ${pid} alive for ${aliveForMs}ms (needs ${options.stableForMs}ms).`
      };
    }
  };
};

export const createDevServerReadySignal = (options: DevServerReadySignalOptions): ReadinessSignal => {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: options.name ?? "devServerReady",
    timeoutMs: options.timeoutMs,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    diagnosticPayload: {
      ...(options.readyPattern === undefined ? {} : { readyPattern: options.readyPattern.source }),
      ...(options.probeUrl === undefined ? {} : { probeUrl: options.probeUrl })
    },
    check: async (): Promise<SignalResult> => {
      const readinessPattern = options.readyPattern;
      const probeUrl = options.probeUrl;
      if (readinessPattern === undefined && probeUrl === undefined) {
        return {
          ready: true,
          detail: "No dev server readiness checks were configured."
        };
      }

      const stdoutLines = options.getStdoutLines?.() ?? [];
      const stderrLines = options.getStderrLines?.() ?? [];
      const joinedOutput = [...stdoutLines, ...stderrLines].join("\n");

      let patternReady = false;
      if (readinessPattern !== undefined) {
        patternReady = readinessPattern.test(joinedOutput);
        readinessPattern.lastIndex = 0;
      }

      let probeReady = false;
      let probeDetail: string | undefined;
      if (probeUrl !== undefined) {
        try {
          const response = await fetchImpl(probeUrl, { method: "GET" });
          probeReady = response.ok;
          probeDetail = `HTTP ${response.status}`;
        } catch (error: unknown) {
          probeDetail = asErrorMessage(error);
        }
      }

      if (patternReady || probeReady) {
        return {
          ready: true,
          detail:
            patternReady && probeReady
              ? "Dev server matched readiness output and HTTP probe succeeded."
              : patternReady
                ? "Dev server output matched readiness pattern."
                : "Dev server HTTP probe succeeded."
        };
      }

      const outputDetail =
        readinessPattern === undefined ? undefined : "waiting for readiness pattern in process output";
      const probeStatusDetail =
        probeUrl === undefined ? undefined : `HTTP probe pending (${probeDetail ?? "no response"})`;

      return {
        ready: false,
        detail: [outputDetail, probeStatusDetail].filter((part): part is string => part !== undefined).join("; ")
      };
    }
  };
};

export const createWindowCreatedSignal = (options: WindowCreatedSignalOptions): ReadinessSignal => {
  return {
    name: options.name ?? "windowCreated",
    timeoutMs: options.timeoutMs,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    check: async (): Promise<SignalResult> => {
      const windows = await options.getWindows();
      const rendererWindows = windows.filter((window) => !isDevtoolsWindow(window));
      if (rendererWindows.length > 0) {
        return {
          ready: true,
          detail: `Discovered ${rendererWindows.length} renderer window(s).`
        };
      }

      return {
        ready: false,
        detail: `No renderer windows yet (saw ${windows.length} total windows).`
      };
    }
  };
};

export const createRendererReadySignal = (options: RendererReadySignalOptions): ReadinessSignal => {
  return {
    name: options.name ?? "rendererReady",
    timeoutMs: options.timeoutMs,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    check: async (): Promise<SignalResult> => {
      const windows = await options.getWindows();
      const rendererWindows = windows.filter((window) => !isDevtoolsWindow(window));
      if (rendererWindows.length === 0) {
        return {
          ready: false,
          detail: "No renderer windows available for readiness checks."
        };
      }

      const byUrl = rendererWindows.find((window) => isWindowUrlReady(window.url));
      if (byUrl !== undefined) {
        return {
          ready: true,
          detail: `Renderer URL became non-blank (${byUrl.url}).`
        };
      }

      if (options.checkDomContentLoaded === undefined) {
        return {
          ready: false,
          detail: "Renderer URLs are still blank/about:blank."
        };
      }

      for (const rendererWindow of rendererWindows) {
        const domReady = await options.checkDomContentLoaded(rendererWindow.id);
        if (domReady) {
          return {
            ready: true,
            detail: `Renderer DOM content loaded in window ${rendererWindow.id}.`
          };
        }
      }

      return {
        ready: false,
        detail: "Renderer DOM content is not ready yet."
      };
    }
  };
};

export const createAppMarkerReadySignal = (options: AppMarkerReadySignalOptions): ReadinessSignal => {
  return {
    name: options.name ?? "appMarkerReady",
    timeoutMs: options.timeoutMs,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    diagnosticPayload: {
      marker: options.marker
    },
    check: async (): Promise<SignalResult> => {
      const markerVisible = await options.checkMarker();
      return markerVisible
        ? {
            ready: true,
            detail: `App marker \"${options.marker}\" is visible.`
          }
        : {
            ready: false,
            detail: `Waiting for app marker \"${options.marker}\".`
          };
    }
  };
};
