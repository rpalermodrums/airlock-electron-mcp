import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { ScreenshotInputSchema, ScreenshotOutputSchema } from "../types/schemas.js";
import { resolveManagedSession, resolveWindow, toDriverWindow } from "./helpers.js";

const ALL_MODES = ["safe", "standard", "trusted"] as const;

type ScreenshotInput = z.infer<typeof ScreenshotInputSchema>;

export const screenshotTool = defineAirlockTool({
  name: "screenshot",
  title: "Capture Screenshot",
  description: [
    "Take a screenshot of the current window. Saves to the artifact directory and returns the file path. Use for visual verification after actions.",
    "What it does: captures a PNG from the selected window (or provided `windowId`) and writes it to `artifactDir/screenshots` for the session.",
    "What it cannot do: this does not annotate screenshots or include hidden windows.",
    "Defaults: uses selected window if `windowId` is omitted and captures viewport-only unless `fullPage` is true.",
    "Common error guidance: `WINDOW_NOT_FOUND` means refresh window selection; if capture fails after actions, run `console_recent()` for renderer diagnostics.",
    "Safety notes: artifact paths are session-scoped and intended for debugging only."
  ].join("\n"),
  inputSchema: ScreenshotInputSchema,
  outputSchema: ScreenshotOutputSchema,
  allowedModes: ALL_MODES,
  handler: async (input: ScreenshotInput, context) => {
    const managedSession = resolveManagedSession(context, input.sessionId);
    const targetWindow = resolveWindow(managedSession, input.windowId);
    const driverWindow = toDriverWindow(targetWindow);
    const pngBuffer = await context.driver.screenshot(driverWindow, {
      fullPage: input.fullPage
    });

    const screenshotsDir = path.join(managedSession.session.artifactDir, "screenshots");
    await mkdir(screenshotsDir, {
      recursive: true
    });
    const outputPath = path.join(screenshotsDir, `screenshot-${Date.now()}-${randomUUID()}.png`);
    await writeFile(outputPath, pngBuffer);

    return {
      data: {
        path: outputPath
      },
      meta: {
        suggestions: ["Use snapshot_interactive() to pair visual output with structured refs."]
      }
    };
  }
});
