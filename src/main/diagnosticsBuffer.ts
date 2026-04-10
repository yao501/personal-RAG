import type { LibraryTaskProgress, RendererErrorInfo } from "../lib/shared/types";

const MAX_TASK_EVENTS = 120;
const MAX_IPC_ERRORS = 40;

const taskEvents: Array<{ recordedAt: string; progress: LibraryTaskProgress }> = [];
const ipcErrors: Array<{ recordedAt: string; channel: string; error: RendererErrorInfo }> = [];

export function recordTaskProgressSnapshot(progress: LibraryTaskProgress): void {
  taskEvents.push({ recordedAt: new Date().toISOString(), progress: { ...progress } });
  while (taskEvents.length > MAX_TASK_EVENTS) {
    taskEvents.shift();
  }
}

export function recordIpcFailure(channel: string, error: RendererErrorInfo): void {
  ipcErrors.push({ recordedAt: new Date().toISOString(), channel, error: { ...error } });
  while (ipcErrors.length > MAX_IPC_ERRORS) {
    ipcErrors.shift();
  }
}

export function getRecentTaskEvents(): Array<{ recordedAt: string; progress: LibraryTaskProgress }> {
  return taskEvents.map((item) => ({
    recordedAt: item.recordedAt,
    progress: { ...item.progress }
  }));
}

export function getRecentIpcErrors(): Array<{ recordedAt: string; channel: string; error: RendererErrorInfo }> {
  return ipcErrors.map((item) => ({
    recordedAt: item.recordedAt,
    channel: item.channel,
    error: { ...item.error }
  }));
}
