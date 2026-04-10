import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import type { QueryLogFeedbackStatus } from "../lib/shared/types";
import { AppStore } from "./store";
import { KnowledgeService } from "./knowledgeService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const store = new AppStore();
const knowledgeService = new KnowledgeService(store);

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: "个人知识库 RAG",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  ipcMain.handle("snapshot:get", () => knowledgeService.getSnapshot());
  ipcMain.handle("files:import", async (_event, filePaths?: string[]) => {
    try {
      const requestedPaths = filePaths?.filter(Boolean) ?? [];
      if (requestedPaths.length > 0) {
        return knowledgeService.importFiles(requestedPaths, (progress) => {
          mainWindow?.webContents.send("library:task-progress", progress);
        });
      }

      const dialogOptions = {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Supported documents",
            extensions: ["pdf", "md", "txt", "docx"]
          }
        ]
      } satisfies Electron.OpenDialogOptions;
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return { imported: [], skipped: [], skippedDetails: [] };
      }

      return knowledgeService.importFiles(result.filePaths, (progress) => {
        mainWindow?.webContents.send("library:task-progress", progress);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file picker error";
      throw new Error(`Failed to import files: ${message}`);
    }
  });

  ipcMain.handle("chat:create-session", () => knowledgeService.createChatSession());
  ipcMain.handle("chat:turns", (_event, sessionId: string) => knowledgeService.getChatTurns(sessionId));
  ipcMain.handle("chat:ask", (_event, sessionId: string, question: string) => knowledgeService.askQuestion(sessionId, question));
  ipcMain.handle("chat:delete-session", (_event, sessionId: string) => knowledgeService.deleteChatSession(sessionId));
  ipcMain.handle("chat:clear-sessions", () => knowledgeService.clearChatSessions());
  ipcMain.handle("document:get", (_event, documentId: string) => knowledgeService.getDocument(documentId));
  ipcMain.handle("document:chunks", (_event, documentId: string) => knowledgeService.getDocumentChunks(documentId));
  ipcMain.handle("document:question-matches", (_event, documentId: string, question: string, limit?: number) =>
    knowledgeService.getDocumentQuestionMatches(documentId, question, limit)
  );
  ipcMain.handle("library:reindex", () =>
    knowledgeService.reindexLibrary((progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  ipcMain.handle("library:health", () => knowledgeService.getLibraryHealth());
  ipcMain.handle("library:reindex-documents", (_event, documentIds: string[]) =>
    knowledgeService.reindexDocuments(documentIds, (progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  ipcMain.handle("library:remove-documents", (_event, documentIds: string[]) => knowledgeService.removeDocuments(documentIds));
  ipcMain.handle("document:delete", (_event, documentId: string) => knowledgeService.deleteDocument(documentId));
  ipcMain.handle("library:clear", () => knowledgeService.clearLibrary());
  ipcMain.handle("settings:update", (_event, settings) => knowledgeService.updateSettings(settings));
  ipcMain.handle("document:open", (_event, filePath: string) => knowledgeService.openDocument(filePath));
  ipcMain.handle("document:open-at-location", (_event, filePath: string, pageNumber?: number | null) =>
    knowledgeService.openDocumentAtLocation(filePath, pageNumber)
  );
  ipcMain.handle("query-logs:list", (_event, limit?: number) => knowledgeService.getQueryLogs(limit));
  ipcMain.handle("query-logs:update-status", (_event, logId: string, status: QueryLogFeedbackStatus, note?: string | null) =>
    knowledgeService.updateQueryLogStatus(logId, status, note)
  );
  ipcMain.handle("query-logs:eval-drafts", (_event, limit?: number) => knowledgeService.getEvalCandidateDrafts(limit));

  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
