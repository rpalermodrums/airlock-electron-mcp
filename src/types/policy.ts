export const SAFETY_MODES = ["safe", "standard", "trusted"] as const;

export type SafetyMode = (typeof SAFETY_MODES)[number];

export interface SafetyPolicy {
  mode: SafetyMode;
  allowedOrigins: readonly string[];
  artifactRoot: string;
  maxSessionTtlMs: number;
}

export interface ModeCapabilities {
  allowAppKill: boolean;
  allowTrustedEval: boolean;
  allowOriginOverrides: boolean;
  allowRawSelectors: boolean;
}

export type SafetyCapabilities = Record<SafetyMode, ModeCapabilities>;

export const DEFAULT_MODE: SafetyMode = "safe";

export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost", "http://127.0.0.1"] as const;

export const SAFETY_CAPABILITIES: SafetyCapabilities = {
  safe: {
    allowAppKill: false,
    allowTrustedEval: false,
    allowOriginOverrides: false,
    allowRawSelectors: false
  },
  standard: {
    allowAppKill: true,
    allowTrustedEval: false,
    allowOriginOverrides: true,
    allowRawSelectors: true
  },
  trusted: {
    allowAppKill: true,
    allowTrustedEval: true,
    allowOriginOverrides: true,
    allowRawSelectors: true
  }
};

export const defaultPolicyForMode = (mode: SafetyMode, artifactRoot: string): SafetyPolicy => {
  if (mode === "safe") {
    return {
      mode,
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
      artifactRoot,
      maxSessionTtlMs: 30 * 60 * 1000
    };
  }

  if (mode === "standard") {
    return {
      mode,
      allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, "file://"],
      artifactRoot,
      maxSessionTtlMs: 2 * 60 * 60 * 1000
    };
  }

  return {
    mode,
    allowedOrigins: ["*"],
    artifactRoot,
    maxSessionTtlMs: 8 * 60 * 60 * 1000
  };
};
