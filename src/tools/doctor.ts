import os from "node:os";
import process from "node:process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { z } from "zod";

import { defineAirlockTool } from "../server.js";

const require = createRequire(import.meta.url);

const DoctorInputSchema = z.object({}).strict();

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
    knownIssues: z.array(z.string().min(1))
  })
  .strict();

interface PlaywrightInfo {
  installed: boolean;
  version: string | null;
  source: "installed" | "peerDependency" | "missing";
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

const buildKnownIssues = (playwright: PlaywrightInfo): readonly string[] => {
  const issues: string[] = [
    "Electron launch can fail when nodeCliInspect fuse is disabled; use CDP attach fallback for restricted builds.",
    "First-window readiness can race on heavy startup; use session status checks and explicit waits before interaction."
  ];

  if (!playwright.installed) {
    issues.push(
      "Playwright package is not installed in this environment. Install it to enable active Electron automation."
    );
  }

  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    issues.push("No DISPLAY/WAYLAND_DISPLAY detected; headed Electron sessions may fail in Linux environments.");
  }

  return issues;
};

export const doctorTool = defineAirlockTool({
  name: "doctor",
  title: "Environment Doctor",
  description: [
    "Runs environment diagnostics. Returns Playwright version, Node version, platform info, and checks for known compatibility issues. Use this to debug launch failures.",
    "What it does: detects Playwright installation/version, Node runtime details, OS/platform metadata, Electron package availability, and known launch caveats.",
    "What it cannot do: this does not launch the app, verify UI selectors, or guarantee session-level correctness.",
    "Defaults: runs local process diagnostics only and inspects workspace package metadata when runtime modules are missing.",
    "Common error guidance: if Playwright or Electron is unavailable, install dependencies and retry; if launch still fails, compare known issue notes and run `server_status()` after each attempt.",
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
    const knownIssues = buildKnownIssues(playwright);

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
      knownIssues: [...knownIssues]
    };

    if (playwright.installed && electron.available) {
      return {
        data: output
      };
    }

    return {
      data: output,
      meta: {
        warnings: ["Environment checks found missing dependencies that can block launch/attach flows."],
        suggestions: [
          "Install Playwright/Electron dependencies and re-run doctor().",
          "Use capabilities() afterward to confirm mode/tool availability."
        ]
      }
    };
  }
});
