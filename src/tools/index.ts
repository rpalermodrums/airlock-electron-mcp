import { appCloseTool } from "./app-close.js";
import { appKillTool } from "./app-kill.js";
import { appLaunchTool } from "./app-launch.js";
import { capabilitiesTool } from "./capabilities.js";
import { confirmTool } from "./confirm.js";
import { diagnoseSessionTool } from "./crash-diagnostics.js";
import { clickTool } from "./click.js";
import { consoleRecentTool } from "./console-recent.js";
import { doctorTool } from "./doctor.js";
import { exportArtifactsTool } from "./export-artifacts.js";
import { hoverTool } from "./hover.js";
import { networkRecentTool } from "./network-recent.js";
import { pressKeyTool } from "./press-key.js";
import { screenshotTool } from "./screenshot.js";
import { scrollToTool } from "./scroll-to.js";
import { selectTool } from "./select.js";
import { serverResetTool } from "./server-reset.js";
import { serverStatusTool } from "./server-status.js";
import { sessionInfoTool } from "./session-info.js";
import {
  snapshotDiffTool,
  snapshotInteractiveTool,
  snapshotQueryTool,
  snapshotRegionTool,
  snapshotViewportTool
} from "./snapshot.js";
import { traceStartTool, traceStopTool } from "./trace.js";
import { typeTool } from "./type.js";
import { waitForIdleTool, waitForTextTool, waitForVisibleTool } from "./wait.js";
import { waitForWindowTool } from "./wait-for-window.js";
import { windowDefaultGetTool, windowDefaultSetTool } from "./window-default.js";
import { windowFocusTool } from "./window-focus.js";
import { windowListTool } from "./window-list.js";

export { appCloseTool } from "./app-close.js";
export { appKillTool } from "./app-kill.js";
export { appLaunchTool } from "./app-launch.js";
export { capabilitiesTool } from "./capabilities.js";
export { confirmTool } from "./confirm.js";
export { diagnoseSessionTool } from "./crash-diagnostics.js";
export { clickTool } from "./click.js";
export { consoleRecentTool } from "./console-recent.js";
export { doctorTool } from "./doctor.js";
export { exportArtifactsTool } from "./export-artifacts.js";
export { hoverTool } from "./hover.js";
export { networkRecentTool } from "./network-recent.js";
export { pressKeyTool } from "./press-key.js";
export { screenshotTool } from "./screenshot.js";
export { scrollToTool } from "./scroll-to.js";
export { selectTool } from "./select.js";
export { serverResetTool } from "./server-reset.js";
export { serverStatusTool } from "./server-status.js";
export { sessionInfoTool } from "./session-info.js";
export {
  snapshotDiffTool,
  snapshotInteractiveTool,
  snapshotQueryTool,
  snapshotRegionTool,
  snapshotViewportTool
} from "./snapshot.js";
export { traceStartTool, traceStopTool } from "./trace.js";
export { typeTool } from "./type.js";
export { waitForIdleTool, waitForTextTool, waitForVisibleTool } from "./wait.js";
export { waitForWindowTool } from "./wait-for-window.js";
export { windowDefaultGetTool, windowDefaultSetTool } from "./window-default.js";
export { windowFocusTool } from "./window-focus.js";
export { windowListTool } from "./window-list.js";

export const coreTools = [
  appLaunchTool,
  appCloseTool,
  appKillTool,
  sessionInfoTool,
  windowListTool,
  windowFocusTool,
  windowDefaultGetTool,
  windowDefaultSetTool,
  waitForWindowTool,
  capabilitiesTool,
  confirmTool,
  serverStatusTool,
  serverResetTool,
  doctorTool,
  clickTool,
  typeTool,
  pressKeyTool,
  selectTool,
  hoverTool,
  screenshotTool,
  scrollToTool,
  consoleRecentTool,
  networkRecentTool,
  traceStartTool,
  traceStopTool,
  exportArtifactsTool,
  diagnoseSessionTool,
  waitForIdleTool,
  waitForVisibleTool,
  waitForTextTool,
  snapshotInteractiveTool,
  snapshotViewportTool,
  snapshotQueryTool,
  snapshotDiffTool,
  snapshotRegionTool
] as const;
