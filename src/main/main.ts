import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
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
    title: "Personal Knowledge RAG",
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
  ipcMain.handle("files:import", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Supported documents",
            extensions: ["pdf", "md", "txt", "docx"]
          }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { imported: [], skipped: [] };
      }

      return knowledgeService.importFiles(result.filePaths);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file picker error";
      throw new Error(`Failed to import files: ${message}`);
    }
  });

  ipcMain.handle("chat:ask", (_event, question: string) => knowledgeService.askQuestion(question));
  ipcMain.handle("document:get", (_event, documentId: string) => knowledgeService.getDocument(documentId));
  ipcMain.handle("document:chunks", (_event, documentId: string) => knowledgeService.getDocumentChunks(documentId));
  ipcMain.handle("library:reindex", () => knowledgeService.reindexLibrary());
  ipcMain.handle("settings:update", (_event, settings) => knowledgeService.updateSettings(settings));
  ipcMain.handle("document:open", (_event, filePath: string) => knowledgeService.openDocument(filePath));

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
