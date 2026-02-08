import { describe, expect, it } from "vitest";

import {
  ELECTRON_BUILDER_PRESET,
  ELECTRON_FORGE_VITE_PRESET,
  ELECTRON_FORGE_WEBPACK_PRESET,
  ELECTRON_VITE_PRESET,
  LAUNCH_PRESETS,
  PRE_LAUNCHED_ATTACH_PRESET,
  resolvePreset
} from "./presets.js";

const captureSyncError = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw.");
};

describe("launch preset DSL", () => {
  it("resolves every shipped preset id", () => {
    expect(resolvePreset("electron-vite")).toBe(ELECTRON_VITE_PRESET);
    expect(resolvePreset("electron-forge-webpack")).toBe(ELECTRON_FORGE_WEBPACK_PRESET);
    expect(resolvePreset("electron-forge-vite")).toBe(ELECTRON_FORGE_VITE_PRESET);
    expect(resolvePreset("electron-builder")).toBe(ELECTRON_BUILDER_PRESET);
    expect(resolvePreset("pre-launched-attach")).toBe(PRE_LAUNCHED_ATTACH_PRESET);
  });

  it("throws for unknown preset id", () => {
    const error = captureSyncError(() => {
      resolvePreset("unknown-preset");
    }) as { code?: string; details?: { supportedPresets?: string[] } };

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.details?.supportedPresets).toEqual(LAUNCH_PRESETS.map((preset) => preset.id));
  });

  it("enforces required fields across presets", () => {
    for (const preset of LAUNCH_PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.version).toBeGreaterThan(0);
      expect(["launch", "attach"]).toContain(preset.mode);
      expect(Object.isFrozen(preset)).toBe(true);
      expect(typeof preset.devServer.managed).toBe("boolean");
      if (preset.mode === "launch") {
        expect(preset.readinessSignals.length).toBeGreaterThan(0);
      }
      expect(preset.diagnosticHints.length).toBeGreaterThan(0);
      expect(preset.diagnostics.processRingBufferLines).toBeGreaterThan(0);
      expect(preset.diagnostics.eventLogLimit).toBeGreaterThan(0);
      expect(preset.diagnostics.includeEnvPrefixes.length).toBeGreaterThan(0);
      expect(preset.diagnostics.includeEnvKeys.length).toBeGreaterThan(0);
    }
  });
});
