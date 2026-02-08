#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { ensureArtifactDirectories, resolveArtifactRoot } from "./artifacts/index.js";
import { createPlaywrightElectronDriver } from "./driver/playwright.js";
import { createResolvedPolicyForMode, loadPolicyFile, mergePolicies } from "./policy/index.js";
import { AirlockServer } from "./server.js";
import { coreTools } from "./tools/index.js";
import { DEFAULT_MODE, SAFETY_MODES, type SafetyMode } from "./types/index.js";
import { createLogger } from "./utils/logger.js";

const SUPPORTED_PRESETS = ["electron-vite"] as const;
const DEFAULT_LIMITS = {
  maxNodes: 250,
  maxTextCharsPerNode: 80
} as const;

const USAGE = `Usage:
  airlock-electron-mcp serve [--policy <path>]
  airlock-electron-mcp --policy <path>
  airlock-electron-mcp help
`;

const isSafetyMode = (value: string): value is SafetyMode => {
  return SAFETY_MODES.includes(value as SafetyMode);
};

const parseMode = (rawMode: string | undefined): SafetyMode => {
  if (rawMode === undefined || rawMode.length === 0) {
    return DEFAULT_MODE;
  }

  if (!isSafetyMode(rawMode)) {
    throw new Error(`Invalid AIRLOCK_MODE value "${rawMode}". Expected one of: ${SAFETY_MODES.join(", ")}.`);
  }

  return rawMode;
};

interface ServeOptions {
  policyPath?: string;
}

interface ParsedCliArgs {
  command: "serve" | "help";
  options: ServeOptions;
}

interface ParsedServeOptions {
  options: ServeOptions;
  helpRequested: boolean;
}

const parseServeOptions = (args: readonly string[]): ParsedServeOptions => {
  let policyPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--policy") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error(`Missing value for "--policy".\n\n${USAGE}`);
      }
      policyPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--policy=")) {
      const value = argument.slice("--policy=".length);
      if (value.length === 0) {
        throw new Error(`Missing value for "--policy".\n\n${USAGE}`);
      }
      policyPath = value;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      return {
        options: policyPath === undefined ? {} : { policyPath },
        helpRequested: true
      };
    }

    throw new Error(`Unknown option "${argument}".\n\n${USAGE}`);
  }

  return {
    options: policyPath === undefined ? {} : { policyPath },
    helpRequested: false
  };
};

const parseCliArgs = (args: readonly string[]): ParsedCliArgs => {
  const firstArg = args[0];
  const rest = args.slice(1);

  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    return {
      command: "help",
      options: {}
    };
  }

  if (firstArg === "serve") {
    const parsedOptions = parseServeOptions(rest);
    if (parsedOptions.helpRequested) {
      return {
        command: "help",
        options: {}
      };
    }

    return {
      command: "serve",
      options: parsedOptions.options
    };
  }

  if (firstArg === undefined || firstArg.startsWith("-")) {
    const parsedOptions = parseServeOptions(args);
    if (parsedOptions.helpRequested) {
      return {
        command: "help",
        options: {}
      };
    }

    return {
      command: "serve",
      options: parsedOptions.options
    };
  }

  throw new Error(`Unknown command "${firstArg}".\n\n${USAGE}`);
};

const runServe = async (policyPathOverride: string | undefined): Promise<void> => {
  const logger = createLogger({ scope: "cli" });
  const runtimeMode = parseMode(process.env.AIRLOCK_MODE);
  const preset = process.env.AIRLOCK_PRESET;
  const projectRoot = process.cwd();
  const artifactRoot = resolveArtifactRoot(projectRoot, process.env.AIRLOCK_ARTIFACT_ROOT);
  const artifactPaths = await ensureArtifactDirectories(artifactRoot);
  const policyFileFromEnv = process.env.AIRLOCK_POLICY;
  const rawPolicyPath = policyPathOverride ?? policyFileFromEnv;
  const resolvedPolicyPath =
    rawPolicyPath === undefined
      ? undefined
      : path.isAbsolute(rawPolicyPath)
        ? rawPolicyPath
        : path.resolve(projectRoot, rawPolicyPath);
  const policy =
    resolvedPolicyPath === undefined
      ? createResolvedPolicyForMode(runtimeMode, artifactPaths.rootDir)
      : mergePolicies(await loadPolicyFile(resolvedPolicyPath), runtimeMode, artifactPaths.rootDir, resolvedPolicyPath);
  const driver = createPlaywrightElectronDriver();
  const baseServerConfig = {
    policy,
    supportedPresets: [...SUPPORTED_PRESETS],
    limits: {
      maxNodes: policy.maxSnapshotNodes ?? DEFAULT_LIMITS.maxNodes,
      maxTextCharsPerNode: DEFAULT_LIMITS.maxTextCharsPerNode
    },
    driver,
    logger: logger.child("server")
  };
  const serverConfig =
    preset === undefined
      ? baseServerConfig
      : {
          ...baseServerConfig,
          preset
        };
  const server = await AirlockServer.create(serverConfig);

  server.registerTools(coreTools);

  const shutdownState = {
    started: false
  };
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownState.started) {
      return;
    }

    shutdownState.started = true;
    logger.info("Received shutdown signal.", {
      signal
    });

    await server.close();
    logger.info("Airlock server shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logger.info("Starting Airlock MCP server.", {
    mode: policy.mode,
    runtimeMode,
    preset,
    artifactRoot: artifactPaths.rootDir,
    policyPath: resolvedPolicyPath
  });
  await server.startStdio();
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);

  if (parsed.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  await runServe(parsed.options.policyPath);
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const candidateMessage = (error as { message?: unknown }).message;
    if (typeof candidateMessage === "string") {
      return candidateMessage;
    }
  }

  return String(error);
};

void main().catch((error: unknown) => {
  const logger = createLogger({ scope: "cli" });
  const message = toErrorMessage(error);
  logger.error("Failed to run Airlock CLI.", {
    error: message
  });
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
