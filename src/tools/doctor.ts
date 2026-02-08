import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { z } from "zod";

import { matchPlaybooks, resolvePreset, type FailurePlaybook, type LaunchPresetDefinition } from "../launch/index.js";
import { defineAirlockTool, type AirlockToolContext } from "../server.js";

const require = createRequire(import.meta.url);

const DoctorInputSchema = z.object({}).strict();

const PlaybookSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1)
  })
  .strict();

const DoctorOutputSchema = z
  .object({
    mode: z.enum(["safe", "standard", "trusted"]),
    playwright: z
      .object({
        installed: z.boolean(),
        version: z.string().nullable(),
        source: z.enum(["installed", "peerDependency", "missing"])
      })
      .strict(),
    node: z
      .object({
        version: z.string().min(1)
      })
      .strict(),
    platform: z
      .object({
        platform: z.string().min(1),
        arch: z.string().min(1),
        osVersion: z.string().min(1),
        release: z.string().min(1)
      })
      .strict(),
    electron: z
      .object({
        available: z.boolean(),
        version: z.string().nullable(),
        resolvedPath: z.string().nullable()
      })
      .strict(),
    preset: z
      .object({
        active: z.string().nullable(),
        mode: z.enum(["launch", "attach"]).nullable(),
        managesDevServer: z.boolean().nullable(),
        devServerCommand: z.string().nullable(),
        devServerCommandBinary: z.string().nullable(),
        devServerCommandAvailable: z.boolean().nullable(),
        devServerCommandPath: z.string().nullable(),
        diagnosticHints: z.array(z.string().min(1))
      })
      .strict(),
    preflight: z
      .object({
        nodeCliInspectFuseRisk: z.boolean(),
        linuxDisplayMissing: z.boolean(),
        playbookMatches: z.array(PlaybookSummarySchema)
      })
      .strict(),
    knownIssues: z.array(z.string().min(1))
  })
  .strict();

interface PlaywrightInfo {
  installed: boolean;
  version: string | null;
  source: "installed" | "peerDependency" | "missing";
}

interface PresetResolution {
  activePresetName: string | null;
  preset: LaunchPresetDefinition | null;
  resolutionIssue: string | null;
}

interface CommandAvailability {
  command: string | null;
  binary: string | null;
  available: boolean | null;
  resolvedPath: string | null;
  error: string | null;
}

const readProjectPeerPlaywrightVersion = async (): Promise<string | null> => {
  const packagePath = path.resolve(process.cwd(), "package.json");
  try {
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as {
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const dependencyVersion = parsed.dependencies?.playwright;
    if (typeof dependencyVersion === "string") {
      return dependencyVersion;
    }

    const peerVersion = parsed.peerDependencies?.playwright;
    return typeof peerVersion === "string" ? peerVersion : null;
  } catch {
    return null;
  }
};

const resolvePlaywrightInfo = async (): Promise<PlaywrightInfo> => {
  try {
    const pkg = require("playwright/package.json") as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      return {
        installed: true,
        version: pkg.version,
        source: "installed"
      };
    }
  } catch {
    // no-op
  }

  const peerVersion = await readProjectPeerPlaywrightVersion();
  if (peerVersion !== null) {
    return {
      installed: false,
      version: peerVersion,
      source: "peerDependency"
    };
  }

  return {
    installed: false,
    version: null,
    source: "missing"
  };
};

const resolveElectronAvailability = (): {
  available: boolean;
  version: string | null;
  resolvedPath: string | null;
} => {
  try {
    const resolvedPath = require.resolve("electron");
    const version = (() => {
      try {
        const pkg = require("electron/package.json") as { version?: string };
        return typeof pkg.version === "string" ? pkg.version : null;
      } catch {
        return null;
      }
    })();

    return {
      available: true,
      version,
      resolvedPath
    };
  } catch {
    return {
      available: false,
      version: null,
      resolvedPath: null
    };
  }
};

const resolveActivePreset = (context: AirlockToolContext): PresetResolution => {
  const activePresetName = context.preset ?? context.supportedPresets[0] ?? null;
  if (activePresetName === null) {
    return {
      activePresetName,
      preset: null,
      resolutionIssue: "No active preset is configured."
    };
  }

  try {
    return {
      activePresetName,
      preset: resolvePreset(activePresetName),
      resolutionIssue: null
    };
  } catch {
    return {
      activePresetName,
      preset: null,
      resolutionIssue: `Active preset \"${activePresetName}\" is not registered in the launch preset catalog.`
    };
  }
};

const parseCommandBinary = (command: string): string | null => {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const tokenMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return tokenMatch?.[1] ?? tokenMatch?.[2] ?? tokenMatch?.[3] ?? null;
};

const checkCommandAvailability = (command: string | null): CommandAvailability => {
  if (command === null) {
    return {
      command: null,
      binary: null,
      available: null,
      resolvedPath: null,
      error: null
    };
  }

  const binary = parseCommandBinary(command);
  if (binary === null) {
    return {
      command,
      binary: null,
      available: false,
      resolvedPath: null,
      error: "Could not parse command binary."
    };
  }

  const detector = process.platform === "win32" ? "where" : "which";
  const commandResult = spawnSync(detector, [binary], { encoding: "utf8" });
  if (commandResult.status === 0) {
    const resolvedPath = commandResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return {
      command,
      binary,
      available: true,
      resolvedPath: resolvedPath ?? null,
      error: null
    };
  }

  const errorMessage =
    commandResult.error instanceof Error
      ? commandResult.error.message
      : commandResult.stderr.trim().length > 0
        ? commandResult.stderr.trim()
        : `${binary} was not found on PATH`;

  return {
    command,
    binary,
    available: false,
    resolvedPath: null,
    error: errorMessage
  };
};

const collectPlaybookMatches = (options: {
  preset: LaunchPresetDefinition | null;
  platform: NodeJS.Platform;
  nodeCliInspectFuseRisk: boolean;
  linuxDisplayMissing: boolean;
  commandAvailability: CommandAvailability;
}): FailurePlaybook[] => {
  const signals = new Set<string>();

  if (options.nodeCliInspectFuseRisk) {
    signals.add("first window timeout");
  }
  if (options.linuxDisplayMissing) {
    signals.add("first window timeout");
  }
  if (
    options.preset !== null &&
    (options.preset.id === "electron-forge-webpack" || options.preset.id === "electron-forge-vite")
  ) {
    signals.add("dev server not ready");
  }
  if (options.preset?.mode === "attach") {
    signals.add("attach failed");
  }
  if (options.commandAvailability.available === false) {
    signals.add("dev server not ready");
  }

  const matchedById = new Map<string, FailurePlaybook>();
  for (const signal of signals) {
    const matches = matchPlaybooks(signal, options.preset?.id, options.platform);
    for (const match of matches) {
      matchedById.set(match.id, match);
    }
  }

  return [...matchedById.values()];
};

const buildKnownIssues = (options: {
  playwright: PlaywrightInfo;
  presetResolution: PresetResolution;
  commandAvailability: CommandAvailability;
  nodeCliInspectFuseRisk: boolean;
  linuxDisplayMissing: boolean;
  playbookMatches: readonly FailurePlaybook[];
}): readonly string[] => {
  const issues: string[] = [
    "First-window readiness can race on heavy startup; use session status checks and explicit waits before interaction."
  ];

  if (!options.playwright.installed) {
    issues.push(
      "Playwright package is not installed in this environment. Install it to enable active Electron automation."
    );
  }

  if (options.presetResolution.resolutionIssue !== null) {
    issues.push(options.presetResolution.resolutionIssue);
  }

  if (options.commandAvailability.available === false && options.commandAvailability.command !== null) {
    issues.push(
      `Active preset dev command is not available: \"${options.commandAvailability.command}\" (${options.commandAvailability.error ?? "not found"}).`
    );
  }

  if (options.nodeCliInspectFuseRisk) {
    issues.push(
      "On macOS, Electron launch can fail when nodeCliInspect fuse is disabled; attach mode with remote debugging may be required."
    );
  }

  if (options.linuxDisplayMissing) {
    issues.push("No DISPLAY/WAYLAND_DISPLAY detected; headed Electron sessions may fail in Linux environments.");
  }

  for (const playbook of options.playbookMatches) {
    issues.push(`Playbook: ${playbook.title}`);
  }

  return issues;
};

const toPlaybookSummary = (playbooks: readonly FailurePlaybook[]): Array<{ id: string; title: string }> => {
  return playbooks.map((playbook) => ({
    id: playbook.id,
    title: playbook.title
  }));
};

export const doctorTool = defineAirlockTool({
  name: "doctor",
  title: "Environment Doctor",
  description: [
    "Runs environment diagnostics. Returns Playwright and Electron availability, platform metadata, active preset preflight checks, and known launch caveats.",
    "What it does: detects runtime dependencies, validates active preset command availability, checks common launch blockers, and maps failures to known remediation playbooks.",
    "What it cannot do: this does not launch the app, verify selectors, or guarantee app-specific runtime correctness.",
    "Defaults: runs read-only local diagnostics and inspects workspace metadata when runtime modules are missing.",
    "Common error guidance: resolve missing dependencies first, then use the matched playbook steps for preset/platform-specific failures.",
    "Safety notes: read-only diagnostics; no filesystem writes and no privileged actions in any mode."
  ].join("\n"),
  inputSchema: DoctorInputSchema,
  outputSchema: DoctorOutputSchema,
  annotations: {
    readOnlyHint: true
  },
  handler: async (_input, context) => {
    const playwright = await resolvePlaywrightInfo();
    const electron = resolveElectronAvailability();
    const presetResolution = resolveActivePreset(context);
    const presetDevCommand =
      presetResolution.preset?.devServer.managed === false
        ? null
        : (presetResolution.preset?.devServer.command ?? null);
    const commandAvailability = checkCommandAvailability(presetDevCommand);
    const nodeCliInspectFuseRisk = process.platform === "darwin" && presetResolution.preset?.mode === "launch";
    const linuxDisplayMissing = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

    const playbookMatches = collectPlaybookMatches({
      preset: presetResolution.preset,
      platform: process.platform,
      nodeCliInspectFuseRisk,
      linuxDisplayMissing,
      commandAvailability
    });
    const knownIssues = buildKnownIssues({
      playwright,
      presetResolution,
      commandAvailability,
      nodeCliInspectFuseRisk,
      linuxDisplayMissing,
      playbookMatches
    });

    const output = {
      mode: context.mode,
      playwright,
      node: {
        version: process.version
      },
      platform: {
        platform: process.platform,
        arch: process.arch,
        osVersion: os.version(),
        release: os.release()
      },
      electron,
      preset: {
        active: presetResolution.activePresetName,
        mode: presetResolution.preset?.mode ?? null,
        managesDevServer: presetResolution.preset?.devServer.managed ?? null,
        devServerCommand: commandAvailability.command,
        devServerCommandBinary: commandAvailability.binary,
        devServerCommandAvailable: commandAvailability.available,
        devServerCommandPath: commandAvailability.resolvedPath,
        diagnosticHints: [...(presetResolution.preset?.diagnosticHints ?? [])]
      },
      preflight: {
        nodeCliInspectFuseRisk,
        linuxDisplayMissing,
        playbookMatches: toPlaybookSummary(playbookMatches)
      },
      knownIssues: [...knownIssues]
    };

    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!playwright.installed || !electron.available) {
      warnings.push("Environment checks found missing dependencies that can block launch/attach flows.");
      suggestions.push("Install Playwright/Electron dependencies and re-run doctor().");
    }

    if (commandAvailability.available === false && commandAvailability.command !== null) {
      warnings.push(`Dev server command is not executable for active preset: \"${commandAvailability.command}\".`);
      suggestions.push(
        "Install missing CLI tooling (for example electron-vite or electron-forge) or override devServer.command in app_launch()."
      );
    }

    for (const playbook of playbookMatches) {
      suggestions.push(`${playbook.title}: ${playbook.steps[0]}`);
    }

    suggestions.push("Use capabilities() afterward to confirm mode/tool availability.");

    if (warnings.length === 0 && suggestions.length === 0) {
      return {
        data: output
      };
    }

    return {
      data: output,
      meta: {
        ...(warnings.length === 0 ? {} : { warnings }),
        suggestions,
        diagnostics: {
          matchedPlaybooks: playbookMatches.map((playbook) => ({
            id: playbook.id,
            title: playbook.title,
            explanation: playbook.explanation,
            steps: [...playbook.steps],
            ...(playbook.link === undefined ? {} : { link: playbook.link })
          }))
        }
      }
    };
  }
});
