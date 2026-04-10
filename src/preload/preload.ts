import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  DesktopApi,
  IpcResult,
  LibraryTaskProgress,
  QueryLogFeedbackStatus,
  RendererErrorInfo,
  SupportBundleExportResult
} from "../lib/shared/types";

function isIpcResult<T>(value: unknown): value is IpcResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

async function invokeDesktop<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (isIpcResult<T>(result)) {
    if (result.ok) {
      return result.data;
    }

    const info: RendererErrorInfo = result.error;
    const error = new Error(info.message);
    (error as unknown as { errorInfo: RendererErrorInfo }).errorInfo = info;
    throw error;
  }

  return result as T;
}

const api: DesktopApi = {
  getSnapshot: () => invokeDesktop("snapshot:get"),
  importFiles: (filePaths?: string[]) => invokeDesktop("files:import", filePaths),
  createChatSession: () => invokeDesktop("chat:create-session"),
  getChatTurns: (sessionId: string) => invokeDesktop("chat:turns", sessionId),
  askQuestion: (sessionId: string, question: string) => invokeDesktop("chat:ask", sessionId, question),
  getDocument: (documentId: string) => invokeDesktop("document:get", documentId),
  getDocumentChunks: (documentId: string) => invokeDesktop("document:chunks", documentId),
  getDocumentQuestionMatches: (documentId: string, question: string, limit?: number) =>
    invokeDesktop("document:question-matches", documentId, question, limit),
  reindexLibrary: () => invokeDesktop("library:reindex"),
  deleteDocument: (documentId: string) => invokeDesktop("document:delete", documentId),
  clearLibrary: () => invokeDesktop("library:clear"),
  deleteChatSession: (sessionId: string) => invokeDesktop("chat:delete-session", sessionId),
  clearChatSessions: () => invokeDesktop("chat:clear-sessions"),
  updateSettings: (settings: Partial<AppSettings>) => invokeDesktop("settings:update", settings),
  openDocument: (filePath: string) => invokeDesktop("document:open", filePath),
  openDocumentAtLocation: (filePath: string, pageNumber?: number | null) =>
    invokeDesktop("document:open-at-location", filePath, pageNumber),
  getQueryLogs: (limit?: number) => invokeDesktop("query-logs:list", limit),
  updateQueryLogStatus: (logId: string, status: QueryLogFeedbackStatus, note?: string | null) =>
    invokeDesktop("query-logs:update-status", logId, status, note),
  getEvalCandidateDrafts: (limit?: number) => invokeDesktop("query-logs:eval-drafts", limit),
  getLibraryHealth: () => invokeDesktop("library:health"),
  reindexDocuments: (documentIds: string[]) => invokeDesktop("library:reindex-documents", documentIds),
  removeDocuments: (documentIds: string[]) => invokeDesktop("library:remove-documents", documentIds),
  exportSupportBundle: (options?: { anonymize?: boolean }) =>
    invokeDesktop<SupportBundleExportResult>("support:export-bundle", options ?? {}),
  onLibraryTaskProgress: (listener: (progress: LibraryTaskProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: LibraryTaskProgress) => listener(progress);
    ipcRenderer.on("library:task-progress", wrapped);
    return () => ipcRenderer.removeListener("library:task-progress", wrapped);
  }
};

contextBridge.exposeInMainWorld("desktopApi", api);
