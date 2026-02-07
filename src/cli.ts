#!/usr/bin/env node

import process from "node:process";

import { ensureArtifactDirectories, resolveArtifactRoot } from "./artifacts/index.js";
import { createPlaywrightElectronDriver } from "./driver/playwright.js";
import { AirlockServer } from "./server.js";
import { coreTools } from "./tools/index.js";
import { DEFAULT_MODE, SAFETY_MODES, defaultPolicyForMode, type SafetyMode } from "./types/index.js";
import { createLogger } from "./utils/logger.js";

const SUPPORTED_PRESETS = ["electron-vite"] as const;
const DEFAULT_LIMITS = {
  maxNodes: 250,
  maxTextCharsPerNode: 80
} as const;

const USAGE = `Usage:
  airlock-electron-mcp serve
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

const parseCommand = (args: readonly string[]): "serve" | "help" => {
  const command = args[0] ?? "serve";
  if (command === "serve" || command === "help" || command === "--help" || command === "-h") {
    return command === "serve" ? "serve" : "help";
  }

  throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
};

const runServe = async (): Promise<void> => {
  const logger = createLogger({ scope: "cli" });
  const mode = parseMode(process.env.AIRLOCK_MODE);
  const preset = process.env.AIRLOCK_PRESET;
  const projectRoot = process.cwd();
  const artifactRoot = resolveArtifactRoot(projectRoot, process.env.AIRLOCK_ARTIFACT_ROOT);
  const artifactPaths = await ensureArtifactDirectories(artifactRoot);
  const policy = defaultPolicyForMode(mode, artifactPaths.rootDir);
  const driver = createPlaywrightElectronDriver();
  const baseServerConfig = {
    policy,
    supportedPresets: [...SUPPORTED_PRESETS],
    limits: {
      maxNodes: DEFAULT_LIMITS.maxNodes,
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
    mode,
    preset,
    artifactRoot: artifactPaths.rootDir
  });
  await server.startStdio();
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = parseCommand(args);

  if (command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  await runServe();
};

void main().catch((error: unknown) => {
  const logger = createLogger({ scope: "cli" });
  logger.error("Failed to run Airlock CLI.", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
