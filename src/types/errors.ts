export const AIRLOCK_ERROR_CODES = [
  "INVALID_INPUT",
  "MODE_RESTRICTED",
  "SESSION_NOT_FOUND",
  "WINDOW_NOT_FOUND",
  "REF_NOT_FOUND",
  "REF_STALE",
  "SNAPSHOT_NOT_FOUND",
  "STALE_SNAPSHOT",
  "POLICY_VIOLATION",
  "LAUNCH_FAILED",
  "NOT_IMPLEMENTED",
  "INTERNAL_ERROR"
] as const;

export type AirlockErrorCode = (typeof AIRLOCK_ERROR_CODES)[number];

export interface AirlockError {
  code: AirlockErrorCode;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

export const createAirlockError = (
  code: AirlockErrorCode,
  message: string,
  retriable: boolean = false,
  details?: Record<string, unknown>
): AirlockError => {
  const baseError: AirlockError = {
    code,
    message,
    retriable
  };

  if (details) {
    return {
      ...baseError,
      details
    };
  }

  return baseError;
};
