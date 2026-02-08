import {
  createAirlockError,
  defaultPolicyForMode,
  type PolicyFile,
  type ResolvedPolicy,
  type SafetyMode
} from "../types/index.js";

const MODE_ORDER: Record<SafetyMode, number> = {
  safe: 0,
  standard: 1,
  trusted: 2
};

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(?:\*|[1-9]\d{0,4}))?$/;

const dedupeStrings = (values: readonly string[]): readonly string[] => {
  return [...new Set(values)];
};

const resolveMode = (runtimeMode: SafetyMode, fileMode: SafetyMode | undefined): SafetyMode => {
  if (fileMode === undefined) {
    return runtimeMode;
  }

  return MODE_ORDER[fileMode] <= MODE_ORDER[runtimeMode] ? fileMode : runtimeMode;
};

const isOriginAllowedByMode = (mode: SafetyMode, origin: string): boolean => {
  if (mode === "trusted") {
    return true;
  }

  if (origin === "file://") {
    return mode === "standard";
  }

  return LOCAL_ORIGIN_PATTERN.test(origin);
};

const mergeAllowedOrigins = (
  mode: SafetyMode,
  defaultOrigins: readonly string[],
  fileOrigins: readonly string[] | undefined
): readonly string[] => {
  if (fileOrigins === undefined) {
    return defaultOrigins;
  }

  const disallowedOrigins = fileOrigins.filter((origin) => !isOriginAllowedByMode(mode, origin));
  if (disallowedOrigins.length > 0) {
    throw createAirlockError(
      "POLICY_VIOLATION",
      `Policy file attempts to allow origins that are not permitted in mode "${mode}".`,
      false,
      {
        mode,
        disallowedOrigins
      }
    );
  }

  return dedupeStrings(fileOrigins);
};

export const createResolvedPolicyForMode = (mode: SafetyMode, artifactRoot: string): ResolvedPolicy => {
  const basePolicy = defaultPolicyForMode(mode, artifactRoot);
  return {
    ...basePolicy,
    tools: {
      disabled: [],
      requireConfirmation: []
    },
    redactionPatterns: []
  };
};

export const mergePolicies = (
  filePolicy: PolicyFile,
  runtimeMode: SafetyMode,
  artifactRoot: string = "",
  sourcePath: string | undefined = undefined
): ResolvedPolicy => {
  const mode = resolveMode(runtimeMode, filePolicy.mode);
  const basePolicy = defaultPolicyForMode(mode, artifactRoot);
  const mergedTtlMs = filePolicy.maxSessionTTLMs ?? basePolicy.maxSessionTtlMs;

  if (mergedTtlMs > basePolicy.maxSessionTtlMs) {
    throw createAirlockError(
      "POLICY_VIOLATION",
      `Policy file cannot increase session TTL above the mode default for "${mode}".`,
      false,
      {
        mode,
        maxAllowedMs: basePolicy.maxSessionTtlMs,
        attemptedMs: mergedTtlMs
      }
    );
  }

  const tools = filePolicy.tools;
  const rootEntries = filePolicy.roots;
  const allowedEnvVars = filePolicy.allowedEnvVars;
  const maxSnapshotNodes = filePolicy.maxSnapshotNodes;
  const redactionPatterns = filePolicy.redactionPatterns;

  return {
    ...basePolicy,
    allowedOrigins: mergeAllowedOrigins(mode, basePolicy.allowedOrigins, filePolicy.allowedOrigins),
    maxSessionTtlMs: mergedTtlMs,
    ...(rootEntries === undefined ? {} : { roots: dedupeStrings(rootEntries) }),
    ...(allowedEnvVars === undefined ? {} : { allowedEnvVars: dedupeStrings(allowedEnvVars) }),
    ...(maxSnapshotNodes === undefined ? {} : { maxSnapshotNodes }),
    tools: {
      disabled: dedupeStrings(tools?.disabled ?? []),
      requireConfirmation: dedupeStrings(tools?.requireConfirmation ?? [])
    },
    redactionPatterns: dedupeStrings(redactionPatterns ?? []),
    ...(sourcePath === undefined ? {} : { sourcePath })
  };
};
