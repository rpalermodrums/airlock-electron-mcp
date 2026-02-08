import { createAirlockError } from "../types/index.js";

export const DEFAULT_CONFIRMATION_TTL_MS = 60_000;

export interface PendingConfirmation {
  id: string;
  toolName: string;
  description: string;
  params: unknown;
  createdAt: number;
  expiresAt: number;
  confirmedAt?: number;
}

export interface ConfirmationStoreOptions {
  ttlMs?: number;
  nowMs?: () => number;
}

export class ConfirmationStore {
  private readonly confirmations = new Map<string, PendingConfirmation>();
  private readonly nowMs: () => number;
  private readonly ttlMs: number;

  public constructor(options: ConfirmationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  public getTtlMs(): number {
    return this.ttlMs;
  }

  public add(confirmation: PendingConfirmation): void {
    this.cleanup();
    this.confirmations.set(confirmation.id, confirmation);
  }

  public get(id: string): PendingConfirmation | undefined {
    this.cleanup();
    return this.confirmations.get(id);
  }

  public consume(id: string): PendingConfirmation {
    this.cleanup();
    const confirmation = this.confirmations.get(id);
    if (confirmation === undefined) {
      throw createAirlockError("INVALID_INPUT", `Confirmation "${id}" was not found or has expired.`, false, {
        confirmationId: id
      });
    }

    this.confirmations.delete(id);
    return confirmation;
  }

  public cleanup(): void {
    const nowMs = this.nowMs();
    for (const [id, confirmation] of this.confirmations) {
      if (confirmation.expiresAt <= nowMs) {
        this.confirmations.delete(id);
      }
    }
  }
}
