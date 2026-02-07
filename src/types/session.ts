import type { SafetyMode } from "./policy.js";

declare const SessionIdBrand: unique symbol;
declare const WindowIdBrand: unique symbol;
declare const RefIdBrand: unique symbol;

export type SessionId = string & { readonly [SessionIdBrand]: typeof SessionIdBrand };
export type WindowId = string & { readonly [WindowIdBrand]: typeof WindowIdBrand };
export type RefId = string & { readonly [RefIdBrand]: typeof RefIdBrand };

export const sessionId = (id: string): SessionId => id as SessionId;
export const windowId = (id: string): WindowId => id as WindowId;
export const refId = (id: string): RefId => id as RefId;

export const SESSION_STATES = ["launching", "running", "closed", "error"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const WINDOW_KINDS = ["primary", "modal", "devtools", "utility", "unknown"] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface Window {
  windowId: WindowId;
  title: string;
  url: string;
  kind: WindowKind;
  focused: boolean;
  visible: boolean;
  lastSeenAt: string;
}

export interface SnapshotNode {
  ref: RefId;
  role: string;
  name: string;
  value?: string | number | boolean | null;
  disabled?: boolean;
  checked?: boolean;
  locatorHints?: {
    readonly testId?: string;
    readonly roleAndName?: { readonly role: string; readonly name: string };
    readonly label?: string;
    readonly textContent?: string;
  };
}

export interface Snapshot {
  sessionId: SessionId;
  windowId: WindowId;
  version: number;
  createdAt: string;
  truncated: boolean;
  truncationReason?: string;
  metadata?: {
    readonly note?: string;
  };
  nodes: SnapshotNode[];
}

export interface SnapshotQuery {
  role?: string;
  nameContains?: string;
  testId?: string;
  textContains?: string;
}

export interface Session {
  sessionId: SessionId;
  state: SessionState;
  mode: SafetyMode;
  launchMode: "preset" | "custom" | "attached";
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  artifactDir: string;
  selectedWindowId: WindowId | undefined;
  traceState?: {
    readonly active: boolean;
    readonly tracePath?: string;
  };
  windows: Window[];
}

export interface SessionSummary {
  sessionId: SessionId;
  state: SessionState;
  mode: SafetyMode;
  selectedWindowId?: WindowId;
  windowCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}
