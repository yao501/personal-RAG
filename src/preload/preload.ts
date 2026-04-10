import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, DesktopApi, LibraryTaskProgress, QueryLogFeedbackStatus } from "../lib/shared/types";

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  importFiles: (filePaths?: string[]) => ipcRenderer.invoke("files:import", filePaths),
  createChatSession: () => ipcRenderer.invoke("chat:create-session"),
  getChatTurns: (sessionId: string) => ipcRenderer.invoke("chat:turns", sessionId),
  askQuestion: (sessionId: string, question: string) => ipcRenderer.invoke("chat:ask", sessionId, question),
  getDocument: (documentId: string) => ipcRenderer.invoke("document:get", documentId),
  getDocumentChunks: (documentId: string) => ipcRenderer.invoke("document:chunks", documentId),
  getDocumentQuestionMatches: (documentId: string, question: string, limit?: number) =>
    ipcRenderer.invoke("document:question-matches", documentId, question, limit),
  reindexLibrary: () => ipcRenderer.invoke("library:reindex"),
  deleteDocument: (documentId: string) => ipcRenderer.invoke("document:delete", documentId),
  clearLibrary: () => ipcRenderer.invoke("library:clear"),
  deleteChatSession: (sessionId: string) => ipcRenderer.invoke("chat:delete-session", sessionId),
  clearChatSessions: () => ipcRenderer.invoke("chat:clear-sessions"),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  openDocument: (filePath: string) => ipcRenderer.invoke("document:open", filePath),
  openDocumentAtLocation: (filePath: string, pageNumber?: number | null) =>
    ipcRenderer.invoke("document:open-at-location", filePath, pageNumber),
  getQueryLogs: (limit?: number) => ipcRenderer.invoke("query-logs:list", limit),
  updateQueryLogStatus: (logId: string, status: QueryLogFeedbackStatus, note?: string | null) =>
    ipcRenderer.invoke("query-logs:update-status", logId, status, note),
  getEvalCandidateDrafts: (limit?: number) => ipcRenderer.invoke("query-logs:eval-drafts", limit),
  getLibraryHealth: () => ipcRenderer.invoke("library:health"),
  reindexDocuments: (documentIds: string[]) => ipcRenderer.invoke("library:reindex-documents", documentIds),
  removeDocuments: (documentIds: string[]) => ipcRenderer.invoke("library:remove-documents", documentIds),
  onLibraryTaskProgress: (listener: (progress: LibraryTaskProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: LibraryTaskProgress) => listener(progress);
    ipcRenderer.on("library:task-progress", wrapped);
    return () => ipcRenderer.removeListener("library:task-progress", wrapped);
  }
};

contextBridge.exposeInMainWorld("desktopApi", api);
