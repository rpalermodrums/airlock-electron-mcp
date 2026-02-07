import { z } from "zod";

import { defineAirlockTool } from "../server.js";
import { toTimestampMs } from "../utils/index.js";

const ServerStatusInputSchema = z.object({}).strict();

const ActiveSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    launchMode: z.enum(["preset", "custom", "attached"]),
    state: z.enum(["launching", "running", "closed", "error"]),
    windowCount: z.number().int().nonnegative(),
    ageMs: z.number().int().nonnegative(),
    lastActivityMs: z.number().int().nonnegative(),
    lastActivityAt: z.string().min(1)
  })
  .strict();

const ServerStatusOutputSchema = z
  .object({
    mode: z.enum(["safe", "standard", "trusted"]),
    startedAt: z.string().min(1),
    uptimeMs: z.number().int().nonnegative(),
    activeSessionCount: z.number().int().nonnegative(),
    activeSessions: z.array(ActiveSessionSchema)
  })
  .strict();

export const serverStatusTool = defineAirlockTool({
  name: "server_status",
  title: "Server Status",
  description: [
    "Returns the current server state including active Electron sessions, their ages, and health. Use this to check if sessions are still alive or if cleanup is needed.",
    "What it does: reports uptime, current mode, session count, and per-session lifecycle details including launch mode, window count, age, and last activity.",
    "What it cannot do: it does not validate renderer responsiveness or perform deep Electron health checks.",
    "Defaults: reads the in-memory SessionManager store and computes age metrics relative to current server time.",
    "Common error guidance: if a session is missing here, it may have been cleaned up by TTL; call launch/attach flow again and then check `doctor()` for environment causes.",
    "Safety notes: read-only and allowed in all modes; exposes status only, no destructive actions."
  ].join("\n"),
  inputSchema: ServerStatusInputSchema,
  outputSchema: ServerStatusOutputSchema,
  annotations: {
    readOnlyHint: true
  },
  handler: async (_input, context) => {
    const nowMs = Date.now();
    const sessions = context.sessions.listSessions();
    const activeSessions = sessions.map((session) => ({
      sessionId: session.sessionId,
      launchMode: session.launchMode,
      state: session.state,
      windowCount: session.windows.length,
      ageMs: Math.max(0, nowMs - toTimestampMs(session.createdAt)),
      lastActivityMs: Math.max(0, nowMs - toTimestampMs(session.lastActivityAt)),
      lastActivityAt: session.lastActivityAt
    }));

    const output = {
      mode: context.mode,
      startedAt: new Date(context.startedAtMs).toISOString(),
      uptimeMs: Math.max(0, nowMs - context.startedAtMs),
      activeSessionCount: activeSessions.length,
      activeSessions
    };

    if (activeSessions.length === 0) {
      return {
        data: output,
        meta: {
          suggestions: ["No sessions are active. Launch or attach before running interaction tools."]
        }
      };
    }

    return {
      data: output
    };
  }
});
