import { describe, expect, it } from "vitest";

import { FAILURE_PLAYBOOKS, matchPlaybooks } from "./playbooks.js";

describe("launch failure playbooks", () => {
  it("matches preset/platform scoped playbooks", () => {
    const matches = matchPlaybooks(
      'Readiness signal "windowCreated" did not complete after first window timeout.',
      "electron-vite",
      "darwin"
    );

    expect(matches.some((playbook) => playbook.id === "electron-vite-macos-first-window-timeout")).toBe(true);
  });

  it("does not match preset-scoped playbooks for other presets", () => {
    const matches = matchPlaybooks(
      'Readiness signal "windowCreated" did not complete after first window timeout.',
      "electron-forge-webpack",
      "darwin"
    );

    expect(matches.some((playbook) => playbook.id === "electron-vite-macos-first-window-timeout")).toBe(false);
  });

  it("matches generic CDP attach failures across presets/platforms", () => {
    const matches = matchPlaybooks("Failed to attach to Electron via CDP.", "pre-launched-attach", "linux");

    expect(matches.some((playbook) => playbook.id === "cdp-attach-remote-debugging-not-enabled")).toBe(true);
  });

  it("freezes playbook definitions", () => {
    expect(Object.isFrozen(FAILURE_PLAYBOOKS)).toBe(true);
    for (const playbook of FAILURE_PLAYBOOKS) {
      expect(Object.isFrozen(playbook)).toBe(true);
      expect(Object.isFrozen(playbook.presets)).toBe(true);
      expect(Object.isFrozen(playbook.platforms)).toBe(true);
      expect(Object.isFrozen(playbook.symptoms)).toBe(true);
      expect(Object.isFrozen(playbook.steps)).toBe(true);
    }
  });
});
