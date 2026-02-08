export interface FailurePlaybook {
  readonly id: string;
  readonly title: string;
  readonly presets: readonly string[];
  readonly platforms: readonly string[];
  readonly symptoms: readonly string[];
  readonly explanation: string;
  readonly steps: readonly string[];
  readonly link?: string;
}

const freezePlaybook = (playbook: FailurePlaybook): FailurePlaybook => {
  return Object.freeze({
    ...playbook,
    presets: Object.freeze([...playbook.presets]),
    platforms: Object.freeze([...playbook.platforms]),
    symptoms: Object.freeze([...playbook.symptoms]),
    steps: Object.freeze([...playbook.steps])
  });
};

export const FAILURE_PLAYBOOKS: readonly FailurePlaybook[] = Object.freeze([
  freezePlaybook({
    id: "electron-vite-macos-first-window-timeout",
    title: "electron-vite first-window timeout on macOS",
    presets: ["electron-vite"],
    platforms: ["darwin"],
    symptoms: [
      "first\\s*window",
      "windowcreated",
      'readiness signal\\s+"windowCreated"\\s+did not complete',
      "Electron launched but no first window became ready within timeout"
    ],
    explanation:
      "Some Electron builds disable the nodeCliInspect fuse, which breaks Playwright's Electron launch path and can present as a first-window timeout.",
    steps: [
      "Confirm whether your build disables nodeCliInspect fuses.",
      "If fuses are disabled, launch the app manually with --remote-debugging-port=<port> and use the pre-launched attach preset.",
      "Increase first window timeout only after validating fuse/debug-port configuration."
    ],
    link: "https://playwright.dev/docs/api/class-electron"
  }),
  freezePlaybook({
    id: "linux-first-window-timeout-ci-headless",
    title: "First-window timeout on Linux CI (headed requirement)",
    presets: ["*"],
    platforms: ["linux"],
    symptoms: ["first\\s*window", "windowcreated", "rendererready", "no\\s+display", "WAYLAND_DISPLAY", "DISPLAY"],
    explanation:
      "Linux CI often lacks a display server. Headed Electron launch can fail or stall before a renderer window is reported.",
    steps: [
      "Run tests with a virtual display (for example Xvfb) or switch to a headless-compatible strategy.",
      "Set DISPLAY/WAYLAND_DISPLAY explicitly in CI before launch.",
      "Verify sandbox and GPU-related Electron flags for your CI image."
    ]
  }),
  freezePlaybook({
    id: "electron-forge-dev-server-readiness",
    title: "Electron Forge dev server readiness mismatch",
    presets: ["electron-forge-webpack", "electron-forge-vite"],
    platforms: ["*"],
    symptoms: ["devserverready", "dev server not ready", 'readiness signal\\s+"devServerReady"\\s+did not complete'],
    explanation:
      "Electron Forge controls both the bundler lifecycle and Electron startup. Generic readiness checks can misclassify startup state.",
    steps: [
      "Use Forge-specific output patterns and increase readiness timeout where necessary.",
      "Prefer URL probes for deterministic readiness where your app exposes one.",
      "Avoid layering duplicate process management outside Forge unless needed."
    ]
  }),
  freezePlaybook({
    id: "cdp-attach-remote-debugging-not-enabled",
    title: "CDP attach failed because remote debugging endpoint is unavailable",
    presets: ["*"],
    platforms: ["*"],
    symptoms: [
      "attach",
      "cdp",
      "wsEndpoint",
      "remote-debugging-port",
      "Failed to attach to Electron via CDP",
      "Attach requires either cdpUrl or wsEndpoint"
    ],
    explanation:
      "Attach mode requires an active DevTools protocol endpoint. Without --remote-debugging-port (or an explicit ws endpoint), attach will fail.",
    steps: [
      "Start Electron with --remote-debugging-port=<port>.",
      "Provide cdpUrl (for example http://127.0.0.1:9222) or wsEndpoint explicitly.",
      "If multiple targets exist, set target selection constraints."
    ],
    link: "https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport"
  }),
  freezePlaybook({
    id: "dev-server-port-conflict",
    title: "Dev server port conflict",
    presets: ["*"],
    platforms: ["*"],
    symptoms: ["EADDRINUSE", "address already in use", "port\\s+\\d+\\s+already in use", "listen\\s+EADDRINUSE"],
    explanation:
      "Another process is already bound to the configured dev server port, so readiness never completes for the intended instance.",
    steps: [
      "Stop the conflicting process or change the dev server port.",
      "Re-run launch and confirm the startup logs reflect the expected port.",
      "When using shared CI hosts, randomize ports or reserve them per job."
    ]
  }),
  freezePlaybook({
    id: "macos-gatekeeper-quarantine-crash",
    title: "Electron crashes on macOS due to Gatekeeper quarantine",
    presets: ["*"],
    platforms: ["darwin"],
    symptoms: ["quarantine", "app translocation", "code signature", "killed:\\s*9", "crash", "launch failed"],
    explanation:
      "Freshly downloaded binaries can be quarantined by Gatekeeper, causing immediate launch crashes or termination on first run.",
    steps: [
      "Validate notarization/signing for the binary under test.",
      "Clear quarantine attributes in trusted local/dev environments before automation.",
      "Run the app once manually to confirm Gatekeeper prompts are resolved."
    ]
  })
]);

const normalize = (value: string): string => {
  return value.trim().toLowerCase();
};

const matchesScope = (targets: readonly string[], candidate: string | undefined): boolean => {
  if (targets.includes("*")) {
    return true;
  }

  if (candidate === undefined) {
    return true;
  }

  const normalizedCandidate = normalize(candidate);
  return targets.some((target) => normalize(target) === normalizedCandidate);
};

const matchesSymptoms = (patterns: readonly string[], message: string): boolean => {
  if (message.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(message);
    } catch {
      return false;
    }
  });
};

export const matchPlaybooks = (error: string, preset?: string, platform?: string): FailurePlaybook[] => {
  const message = error.trim();

  return FAILURE_PLAYBOOKS.filter((playbook) => {
    if (!matchesScope(playbook.presets, preset)) {
      return false;
    }

    if (!matchesScope(playbook.platforms, platform)) {
      return false;
    }

    return matchesSymptoms(playbook.symptoms, message);
  });
};
