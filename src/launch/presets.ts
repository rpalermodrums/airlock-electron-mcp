import { createAirlockError } from "../types/index.js";
import type { LaunchDiagnosticsConfig } from "./diagnostics.js";
import { DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG } from "./diagnostics.js";
import type { ReadinessSignalPresetSpec } from "./readiness.js";

export type LaunchPresetMode = "launch" | "attach";

export interface PresetDevServerConfig {
  managed: boolean;
  command?: string;
  readyPattern?: RegExp;
  readyUrl?: string;
  timeoutMs?: number;
}

export interface PresetAttachConfig {
  cdpUrl?: string;
  wsEndpoint?: string;
}

export interface PresetElectronLaunchConfig {
  entryPath?: string;
  executablePath?: string;
  defaultArgs?: readonly string[];
  defaultEnv?: Readonly<Record<string, string>>;
  attach?: PresetAttachConfig;
}

export interface LaunchPresetDefinition {
  id: string;
  version: number;
  mode: LaunchPresetMode;
  devServer: PresetDevServerConfig;
  electronLaunch: PresetElectronLaunchConfig;
  readinessSignals: readonly ReadinessSignalPresetSpec[];
  diagnostics: LaunchDiagnosticsConfig;
  diagnosticHints: readonly string[];
}

export type LaunchPreset = LaunchPresetDefinition;

const DEFAULT_DEV_SERVER_TIMEOUT_MS = 60_000;

const freezePreset = <TPreset extends LaunchPresetDefinition>(preset: TPreset): Readonly<TPreset> => {
  const withFrozenReadiness = {
    ...preset,
    readinessSignals: Object.freeze([...preset.readinessSignals]),
    diagnosticHints: Object.freeze([...preset.diagnosticHints]),
    diagnostics: Object.freeze({
      ...preset.diagnostics,
      includeEnvPrefixes: Object.freeze([...preset.diagnostics.includeEnvPrefixes]),
      includeEnvKeys: Object.freeze([...preset.diagnostics.includeEnvKeys])
    }),
    devServer: Object.freeze({
      ...preset.devServer
    }),
    electronLaunch: Object.freeze({
      ...preset.electronLaunch,
      ...(preset.electronLaunch.defaultArgs === undefined
        ? {}
        : {
            defaultArgs: Object.freeze([...preset.electronLaunch.defaultArgs])
          }),
      ...(preset.electronLaunch.defaultEnv === undefined
        ? {}
        : {
            defaultEnv: Object.freeze({ ...preset.electronLaunch.defaultEnv })
          }),
      ...(preset.electronLaunch.attach === undefined
        ? {}
        : {
            attach: Object.freeze({ ...preset.electronLaunch.attach })
          })
    })
  };

  return Object.freeze(withFrozenReadiness);
};

const LAUNCH_SIGNAL_CHAIN: readonly ReadinessSignalPresetSpec[] = Object.freeze([
  {
    kind: "processStable",
    timeoutMs: 15_000,
    retryPolicy: {
      intervalMs: 150
    }
  },
  {
    kind: "devServerReady",
    timeoutMs: DEFAULT_DEV_SERVER_TIMEOUT_MS,
    retryPolicy: {
      intervalMs: 250
    }
  },
  {
    kind: "windowCreated",
    timeoutMs: 20_000,
    retryPolicy: {
      intervalMs: 200
    }
  },
  {
    kind: "rendererReady",
    timeoutMs: 20_000,
    retryPolicy: {
      intervalMs: 200
    }
  },
  {
    kind: "appMarkerReady",
    timeoutMs: 10_000,
    optional: true,
    retryPolicy: {
      intervalMs: 200
    }
  }
]);

const ATTACH_CONNECTIVITY_SIGNAL_CHAIN: readonly ReadinessSignalPresetSpec[] = Object.freeze([]);

export const ELECTRON_VITE_PRESET = freezePreset({
  id: "electron-vite",
  version: 2,
  mode: "launch",
  devServer: {
    managed: true,
    command: "npx electron-vite dev",
    readyPattern: /ready in \d+ms/i,
    timeoutMs: DEFAULT_DEV_SERVER_TIMEOUT_MS
  },
  electronLaunch: {
    entryPath: "."
  },
  readinessSignals: LAUNCH_SIGNAL_CHAIN,
  diagnostics: DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
  diagnosticHints: [
    "If first window readiness times out on macOS, verify nodeCliInspect fuse support or use CDP attach fallback.",
    "Ensure the renderer dev server prints a ready signal before expecting window creation."
  ]
});

export const ELECTRON_FORGE_WEBPACK_PRESET = freezePreset({
  id: "electron-forge-webpack",
  version: 2,
  mode: "launch",
  devServer: {
    managed: true,
    command: "npx electron-forge start",
    readyPattern: /webpack compilation complete|compiled successfully/i,
    timeoutMs: 90_000
  },
  electronLaunch: {},
  readinessSignals: LAUNCH_SIGNAL_CHAIN,
  diagnostics: DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
  diagnosticHints: [
    "Electron Forge manages the webpack dev server lifecycle and Electron startup together.",
    "If dev server readiness fails, consider loosening the ready regex or relying on URL probes."
  ]
});

export const ELECTRON_FORGE_VITE_PRESET = freezePreset({
  id: "electron-forge-vite",
  version: 2,
  mode: "launch",
  devServer: {
    managed: true,
    command: "npx electron-forge start",
    readyPattern: /vite.*ready|built in/i,
    timeoutMs: 90_000
  },
  electronLaunch: {},
  readinessSignals: LAUNCH_SIGNAL_CHAIN,
  diagnostics: DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
  diagnosticHints: [
    "Electron Forge manages the Vite lifecycle and Electron startup together.",
    "If readiness is flaky, add an explicit probe URL or extend the dev server timeout."
  ]
});

export const ELECTRON_BUILDER_PRESET = freezePreset({
  id: "electron-builder",
  version: 2,
  mode: "launch",
  devServer: {
    managed: true,
    command: "npm run dev",
    readyPattern: /ready|listening|started/i,
    timeoutMs: 90_000
  },
  electronLaunch: {
    entryPath: "."
  },
  readinessSignals: LAUNCH_SIGNAL_CHAIN,
  diagnostics: DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
  diagnosticHints: [
    "electron-builder dev setups vary across repos; override devServer.command when needed.",
    "If main entry resolution fails, set electron.entryPath to your compiled main.js/main.ts output."
  ]
});

export const PRE_LAUNCHED_ATTACH_PRESET = freezePreset({
  id: "pre-launched-attach",
  version: 2,
  mode: "attach",
  devServer: {
    managed: false
  },
  electronLaunch: {
    attach: {}
  },
  readinessSignals: ATTACH_CONNECTIVITY_SIGNAL_CHAIN,
  diagnostics: DEFAULT_LAUNCH_DIAGNOSTICS_CONFIG,
  diagnosticHints: [
    "Start Electron manually with --remote-debugging-port=<port> before calling app_launch with this preset.",
    "Provide a CDP URL or ws endpoint; this preset does not manage a dev server process."
  ]
});

export const LAUNCH_PRESETS: readonly LaunchPresetDefinition[] = Object.freeze([
  ELECTRON_VITE_PRESET,
  ELECTRON_FORGE_WEBPACK_PRESET,
  ELECTRON_FORGE_VITE_PRESET,
  ELECTRON_BUILDER_PRESET,
  PRE_LAUNCHED_ATTACH_PRESET
]);

const PRESET_MAP = new Map<string, LaunchPresetDefinition>(LAUNCH_PRESETS.map((preset) => [preset.id, preset]));

export const resolvePreset = (name: string): LaunchPresetDefinition => {
  const preset = PRESET_MAP.get(name);
  if (preset === undefined) {
    throw createAirlockError("INVALID_INPUT", `Unknown launch preset \"${name}\".`, false, {
      name,
      supportedPresets: [...PRESET_MAP.keys()]
    });
  }

  return preset;
};
