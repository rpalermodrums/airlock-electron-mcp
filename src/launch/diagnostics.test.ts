import { describe, expect, it } from "vitest";

import {
  buildLaunchDiagnostics,
  createLaunchDiagnosticEventLog,
  createProcessOutputCollector,
  type BuildLaunchDiagnosticsOptions
} from "./diagnostics.js";

describe("launch diagnostics", () => {
  it("collects ring-buffered process output and readiness timeline", () => {
    const collector = createProcessOutputCollector({
      name: "devServer",
      command: "npm run dev",
      pid: 4242,
      lineLimit: 2
    });

    collector.pushStdout("line-1\nline-2\n");
    collector.pushStdout("line-3\n");
    collector.pushStderr("err-1\nerr-2\n");

    const eventLog = createLaunchDiagnosticEventLog(2);
    eventLog.add({ type: "launch", message: "started" });
    eventLog.add({ type: "signal", message: "waiting" });
    eventLog.add({ type: "signal", message: "ready" });

    const options: BuildLaunchDiagnosticsOptions = {
      processCollectors: [collector],
      readiness: {
        startedAt: "2026-02-08T00:00:00.000Z",
        finishedAt: "2026-02-08T00:00:01.000Z",
        timeline: [
          {
            signalName: "devServerReady",
            attempt: 1,
            startedAt: "2026-02-08T00:00:00.000Z",
            finishedAt: "2026-02-08T00:00:00.500Z",
            durationMs: 500,
            ready: true,
            timedOut: false,
            detail: "matched regex"
          }
        ]
      },
      eventLog: eventLog.entries(),
      environment: {
        AIRLOCK_MODE: "standard",
        AIRLOCK_SECRET: "top-secret",
        PATH: "/usr/bin"
      },
      cwd: "/tmp/project"
    };

    const diagnostics = buildLaunchDiagnostics(options);

    expect(diagnostics.processOutput).toHaveLength(1);
    expect(diagnostics.processOutput[0]?.stdout).toEqual(["line-1", "line-2", "line-3"]);
    expect(diagnostics.processOutput[0]?.stderr).toEqual(["err-1", "err-2"]);
    expect(diagnostics.signalTimeline).toHaveLength(1);
    expect(diagnostics.eventLog).toHaveLength(3);
  });

  it("sanitizes sensitive environment keys", () => {
    const diagnostics = buildLaunchDiagnostics({
      processCollectors: [],
      eventLog: [],
      environment: {
        AIRLOCK_MODE: "safe",
        AIRLOCK_ACCESS_TOKEN: "abc123",
        NODE_ENV: "test"
      },
      cwd: "/repo"
    });

    expect(diagnostics.environment.env.AIRLOCK_MODE).toBe("safe");
    expect(diagnostics.environment.env.AIRLOCK_ACCESS_TOKEN).toBe("[REDACTED]");
    expect(diagnostics.environment.redactedKeys).toContain("AIRLOCK_ACCESS_TOKEN");
  });
});
