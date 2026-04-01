import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, DesktopApi } from "../lib/shared/types";

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  importFiles: () => ipcRenderer.invoke("files:import"),
  askQuestion: (question: string) => ipcRenderer.invoke("chat:ask", question),
  getDocument: (documentId: string) => ipcRenderer.invoke("document:get", documentId),
  getDocumentChunks: (documentId: string) => ipcRenderer.invoke("document:chunks", documentId),
  reindexLibrary: () => ipcRenderer.invoke("library:reindex"),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  openDocument: (filePath: string) => ipcRenderer.invoke("document:open", filePath)
};

contextBridge.exposeInMainWorld("desktopApi", api);

