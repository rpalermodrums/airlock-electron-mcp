import { appCloseTool } from "./app-close.js";
import { appLaunchTool } from "./app-launch.js";
import { capabilitiesTool } from "./capabilities.js";
import { clickTool } from "./click.js";
import { consoleRecentTool } from "./console-recent.js";
import { doctorTool } from "./doctor.js";
import { pressKeyTool } from "./press-key.js";
import { screenshotTool } from "./screenshot.js";
import { serverStatusTool } from "./server-status.js";
import { snapshotInteractiveTool, snapshotQueryTool, snapshotViewportTool } from "./snapshot.js";
import { typeTool } from "./type.js";
import { waitForIdleTool, waitForTextTool, waitForVisibleTool } from "./wait.js";
import { windowListTool } from "./window-list.js";

export { appCloseTool } from "./app-close.js";
export { appLaunchTool } from "./app-launch.js";
export { capabilitiesTool } from "./capabilities.js";
export { clickTool } from "./click.js";
export { consoleRecentTool } from "./console-recent.js";
export { doctorTool } from "./doctor.js";
export { pressKeyTool } from "./press-key.js";
export { screenshotTool } from "./screenshot.js";
export { serverStatusTool } from "./server-status.js";
export { snapshotInteractiveTool, snapshotQueryTool, snapshotViewportTool } from "./snapshot.js";
export { typeTool } from "./type.js";
export { waitForIdleTool, waitForTextTool, waitForVisibleTool } from "./wait.js";
export { windowListTool } from "./window-list.js";

export const coreTools = [
  appLaunchTool,
  appCloseTool,
  windowListTool,
  capabilitiesTool,
  serverStatusTool,
  doctorTool,
  clickTool,
  typeTool,
  pressKeyTool,
  screenshotTool,
  consoleRecentTool,
  waitForIdleTool,
  waitForVisibleTool,
  waitForTextTool,
  snapshotInteractiveTool,
  snapshotViewportTool,
  snapshotQueryTool
] as const;
