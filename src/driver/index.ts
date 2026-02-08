import type { WindowKind } from "../types/session.js";

export interface DriverLaunchConfig {
  sessionId?: string;
  projectRoot: string;
  preset?: string;
  executablePath?: string;
  args?: readonly string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  firstWindowTimeoutMs?: number;
}

export interface DriverAttachTargetSelection {
  targetUrlIncludes?: string;
  targetType?: string;
  preferNonDevtools?: boolean;
}

export interface DriverAttachConfig {
  sessionId?: string;
  cdpUrl?: string;
  wsEndpoint?: string;
  timeoutMs?: number;
  targetSelection?: DriverAttachTargetSelection;
}

export interface DriverSession {
  id: string;
  launchMode: "preset" | "custom" | "attached";
  metadata?: Record<string, unknown>;
}

export interface DriverWindow {
  id: string;
  title: string;
  url: string;
  kind: WindowKind;
  focused: boolean;
  visible: boolean;
}

export interface RawSnapshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawSnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string | number | boolean | null;
  disabled?: boolean;
  checked?: boolean;
  label?: string;
  text?: string;
  testId?: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
  bounds?: RawSnapshotRect;
  boundingBox?: RawSnapshotRect;
  children?: RawSnapshotNode[];
}

export interface RawSnapshot {
  version: number;
  createdAt: string;
  truncated: boolean;
  truncationReason?: string;
  nodes: RawSnapshotNode[];
  viewportRect?: RawSnapshotRect;
  metadata?: Record<string, unknown>;
}

export type ActionTarget =
  | { ref: string }
  | { role: string; name: string }
  | { testId: string }
  | { css: string }
  | { selector: string };

export interface DriverAction {
  action:
    | "click"
    | "type"
    | "fill"
    | "press_key"
    | "press"
    | "hover"
    | "select"
    | "wait_for_idle"
    | "wait_for_visible"
    | "wait_for_text";
  target?: ActionTarget;
  text?: string;
  key?: string;
  button?: "left" | "right" | "middle";
  modifiers?: readonly string[];
  timeoutMs?: number;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  diagnostics?: Record<string, unknown>;
  screenshotPath?: string;
}

export interface ScreenshotOptions {
  outputPath?: string;
  fullPage?: boolean;
}

export interface ConsoleLogOptions {
  level?: "trace" | "debug" | "info" | "warn" | "error";
  limit?: number;
}

export interface ConsoleEntry {
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  mimeType: string;
  timestamp: string;
}

export interface NetworkLogOptions {
  windowId?: string;
  limit?: number;
}

export interface DriverTraceOptions {
  screenshots?: boolean;
  snapshots?: boolean;
}

export interface ElectronDriver {
  launch(config: DriverLaunchConfig): Promise<DriverSession>;
  attach(config: DriverAttachConfig): Promise<DriverSession>;
  getWindows(session: DriverSession): Promise<DriverWindow[]>;
  startTracing(session: DriverSession, options?: DriverTraceOptions): Promise<void>;
  stopTracing(session: DriverSession, savePath: string): Promise<void>;
  getSnapshot(window: DriverWindow, options?: Record<string, unknown>): Promise<RawSnapshot>;
  performAction(window: DriverWindow, action: DriverAction): Promise<ActionResult>;
  screenshot(window: DriverWindow, options?: ScreenshotOptions): Promise<Buffer>;
  focusWindow(session: DriverSession, windowId: string): Promise<void>;
  getConsoleLogs(session: DriverSession, options?: ConsoleLogOptions): Promise<ConsoleEntry[]>;
  getNetworkLogs(session: DriverSession, options?: NetworkLogOptions): Promise<NetworkEntry[]>;
  close(session: DriverSession): Promise<void>;
  evaluate?(window: DriverWindow, fn: string): Promise<unknown>;
}
