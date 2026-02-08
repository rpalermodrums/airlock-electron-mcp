import { randomUUID } from "node:crypto";

import type { ResolvedPolicy } from "../types/index.js";
import { DEFAULT_CONFIRMATION_TTL_MS, type PendingConfirmation } from "./store.js";

interface CreateConfirmationOptions {
  ttlMs?: number;
  nowMs?: () => number;
  id?: string;
}

const CONFIRM_TOOL_NAME = "confirm";

export const shouldRequireConfirmation = (toolName: string, policy: ResolvedPolicy | undefined): boolean => {
  if (toolName === CONFIRM_TOOL_NAME) {
    return false;
  }

  return policy?.tools?.requireConfirmation.includes(toolName) ?? false;
};

export const createConfirmation = (
  toolName: string,
  description: string,
  params: unknown,
  options: CreateConfirmationOptions = {}
): PendingConfirmation => {
  const nowMs = options.nowMs ?? (() => Date.now());
  const createdAt = nowMs();
  const ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;

  return {
    id: options.id ?? randomUUID(),
    toolName,
    description,
    params,
    createdAt,
    expiresAt: createdAt + ttlMs
  };
};

export * from "./store.js";
