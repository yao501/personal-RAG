import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import type { AppSettings, IpcResult } from "../lib/shared/types";
import { AppStore } from "./store";
import { KnowledgeService } from "./knowledgeService";
import {
  expectAbsolutePath,
  expectFeedbackStatus,
  expectNoArgs,
  expectOptionalNullableString,
  expectOptionalPositiveInt,
  expectOptionalStringArray,
  expectSettingsPatch,
  expectString,
  expectStringArray
} from "./ipcValidation";
import { isAllowedAppNavigation } from "./security";
import { IpcForbiddenError, toRendererErrorInfo } from "./ipcErrors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
const store = new AppStore();
const knowledgeService = new KnowledgeService(store);

function ensureTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isAllowedAppNavigation(senderUrl, rendererUrl)) {
    throw new IpcForbiddenError(`Untrusted sender for ${senderUrl || "unknown-url"}.`);
  }
}

function registerIpc<Args extends unknown[], Result>(
  channel: string,
  validateArgs: (args: unknown[]) => Args,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      ensureTrustedSender(event);
      const validatedArgs = validateArgs(args);
      const data = await handler(event, ...validatedArgs);
      return { ok: true, data } satisfies IpcResult<Result>;
    } catch (error) {
      // Preserve a renderer-consumable structured error object.
      // Note: we avoid throwing here because Electron invoke() will otherwise drop structured fields.
      return { ok: false, error: toRendererErrorInfo(channel, error) } satisfies IpcResult<Result>;
    }
  });
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedAppNavigation(targetUrl, rendererUrl)) {
      event.preventDefault();
    }
  });
}

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
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  configureWindowSecurity(mainWindow);

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }
}

function registerIpcHandlers(): void {
  registerIpc("snapshot:get", expectNoArgs, () => knowledgeService.getSnapshot());

  registerIpc("files:import", (args) => [expectOptionalStringArray(args[0], "filePaths")] as const, async (_event, filePaths) => {
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

  registerIpc("chat:create-session", expectNoArgs, () => knowledgeService.createChatSession());
  registerIpc("chat:turns", (args) => [expectString(args[0], "sessionId")] as const, (_event, sessionId) =>
    knowledgeService.getChatTurns(sessionId)
  );
  registerIpc("chat:ask", (args) => [expectString(args[0], "sessionId"), expectString(args[1], "question")] as const, (_event, sessionId, question) =>
    knowledgeService.askQuestion(sessionId, question)
  );
  registerIpc("chat:delete-session", (args) => [expectString(args[0], "sessionId")] as const, (_event, sessionId) =>
    knowledgeService.deleteChatSession(sessionId)
  );
  registerIpc("chat:clear-sessions", expectNoArgs, () => knowledgeService.clearChatSessions());

  registerIpc("document:get", (args) => [expectString(args[0], "documentId")] as const, (_event, documentId) =>
    knowledgeService.getDocument(documentId)
  );
  registerIpc("document:chunks", (args) => [expectString(args[0], "documentId")] as const, (_event, documentId) =>
    knowledgeService.getDocumentChunks(documentId)
  );
  registerIpc(
    "document:question-matches",
    (args) => [
      expectString(args[0], "documentId"),
      expectString(args[1], "question"),
      expectOptionalPositiveInt(args[2], "limit")
    ] as const,
    (_event, documentId, question, limit) => knowledgeService.getDocumentQuestionMatches(documentId, question, limit)
  );

  registerIpc("library:reindex", expectNoArgs, () =>
    knowledgeService.reindexLibrary((progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  registerIpc("library:health", expectNoArgs, () => knowledgeService.getLibraryHealth());
  registerIpc("library:reindex-documents", (args) => [expectStringArray(args[0], "documentIds")] as const, (_event, documentIds) =>
    knowledgeService.reindexDocuments(documentIds, (progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  registerIpc("library:remove-documents", (args) => [expectStringArray(args[0], "documentIds")] as const, (_event, documentIds) =>
    knowledgeService.removeDocuments(documentIds)
  );
  registerIpc("document:delete", (args) => [expectString(args[0], "documentId")] as const, (_event, documentId) =>
    knowledgeService.deleteDocument(documentId)
  );
  registerIpc("library:clear", expectNoArgs, () => knowledgeService.clearLibrary());
  registerIpc("settings:update", (args) => [expectSettingsPatch(args[0])] as const, (_event, settings: Partial<AppSettings>) =>
    knowledgeService.updateSettings(settings)
  );
  registerIpc("document:open", (args) => [expectAbsolutePath(args[0], "filePath")] as const, (_event, filePath) =>
    knowledgeService.openDocument(filePath)
  );
  registerIpc(
    "document:open-at-location",
    (args) => [
      expectAbsolutePath(args[0], "filePath"),
      expectOptionalPositiveInt(args[1], "pageNumber")
    ] as const,
    (_event, filePath, pageNumber) => knowledgeService.openDocumentAtLocation(filePath, pageNumber)
  );

  registerIpc("query-logs:list", (args) => [expectOptionalPositiveInt(args[0], "limit")] as const, (_event, limit) =>
    knowledgeService.getQueryLogs(limit)
  );
  registerIpc(
    "query-logs:update-status",
    (args) => [
      expectString(args[0], "logId"),
      expectFeedbackStatus(args[1]),
      expectOptionalNullableString(args[2], "note")
    ] as const,
    (_event, logId, status, note) => knowledgeService.updateQueryLogStatus(logId, status, note ?? null)
  );
  registerIpc("query-logs:eval-drafts", (args) => [expectOptionalPositiveInt(args[0], "limit")] as const, (_event, limit) =>
    knowledgeService.getEvalCandidateDrafts(limit)
  );
}

app.whenReady().then(async () => {
  registerIpcHandlers();
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
