import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AppSnapshot, LibraryHealthReport } from "../lib/shared/types";
import { getEmbeddingStatus } from "../lib/modules/embed/localEmbedder";
import { redactAbsolutePath, summarizeDocumentForBundle, summarizeQueryLogsForBundle } from "../lib/modules/support/bundlePrivacy";
import { getRecentIpcErrors, getRecentTaskEvents } from "./diagnosticsBuffer";
import type { AppStore } from "./store";

export const SUPPORT_BUNDLE_FORMAT_VERSION = 1;

export interface ExportSupportBundleParams {
  store: AppStore;
  snapshot: AppSnapshot;
  health: LibraryHealthReport;
  anonymize: boolean;
  outputZipPath: string;
}

async function writeJson(dir: string, name: string, data: unknown): Promise<void> {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await fsPromises.writeFile(path.join(dir, name), text, "utf8");
}

function zipDirectoryContents(sourceDir: string, zipPath: string): void {
  const entries = fs.readdirSync(sourceDir);
  if (entries.length === 0) {
    throw new Error("Support bundle directory is empty.");
  }
  const result = spawnSync("zip", ["-r", "-y", zipPath, ...entries], {
    cwd: sourceDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const err = result.stderr?.toString() || result.stdout?.toString() || "unknown zip error";
    throw new Error(`zip failed: ${err}`);
  }
}

export async function exportSupportBundleZip(params: ExportSupportBundleParams): Promise<void> {
  const { store, snapshot, health, anonymize, outputZipPath } = params;
  const embeddingStatus = await getEmbeddingStatus();
  const pragmas = store.getDatabasePragmas();
  const recentLogs = store.listQueryLogs(24);
  const taskEvents = getRecentTaskEvents();
  const ipcFailures = getRecentIpcErrors();

  const userDataPath = app.getPath("userData");
  const lanceDbPath = path.join(userDataPath, "lancedb");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pk-rag-support-"));
  const bundleDir = path.join(tempRoot, "support-bundle");
  fs.mkdirSync(bundleDir, { recursive: true });

  try {
    await fsPromises.writeFile(
      path.join(bundleDir, "00-README.txt"),
      [
        "Personal Knowledge RAG — support bundle",
        "",
        "This archive contains JSON diagnostics only.",
        "It does not include raw document text, chunk bodies, embeddings, or full chat/query payloads.",
        "See docs/SUPPORT_RUNBOOK.md in the repository for field descriptions.",
        ""
      ].join("\n"),
      "utf8"
    );

    await writeJson(bundleDir, "manifest.json", {
      bundleFormatVersion: SUPPORT_BUNDLE_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      anonymize,
      appName: app.getName(),
      appVersion: app.getVersion(),
      note: "Excludes raw document text, chunk bodies, embeddings, and chat/query payloads by default."
    });

    await writeJson(bundleDir, "app_runtime.json", {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      locale: app.getLocale(),
      versions: process.versions
    });

    await writeJson(bundleDir, "paths.json", {
      userDataPath: redactAbsolutePath(userDataPath, anonymize),
      databasePath: redactAbsolutePath(store.getDatabasePath(), anonymize),
      lanceDbPath: redactAbsolutePath(lanceDbPath, anonymize),
      tempDirectory: redactAbsolutePath(os.tmpdir(), anonymize)
    });

    await writeJson(bundleDir, "sqlite.json", {
      ...pragmas,
      databaseFileName: path.basename(store.getDatabasePath())
    });

    await writeJson(bundleDir, "embedding.json", embeddingStatus);

    await writeJson(bundleDir, "system_status.json", {
      documentCount: snapshot.systemStatus.documentCount,
      chunkCount: snapshot.systemStatus.chunkCount,
      embeddingAvailable: snapshot.systemStatus.embeddingAvailable,
      embeddingReason: snapshot.systemStatus.embeddingReason
    });

    await writeJson(bundleDir, "settings_safe.json", {
      chunkSize: snapshot.settings.chunkSize,
      chunkOverlap: snapshot.settings.chunkOverlap,
      libraryPath: snapshot.settings.libraryPath ? redactAbsolutePath(snapshot.settings.libraryPath, anonymize) : null
    });

    await writeJson(bundleDir, "library_health.json", health);

    await writeJson(
      bundleDir,
      "documents_summary.json",
      snapshot.documents.map((document) => summarizeDocumentForBundle(document, anonymize))
    );

    await writeJson(bundleDir, "query_logs_meta.json", summarizeQueryLogsForBundle(recentLogs, anonymize));

    await writeJson(bundleDir, "library_tasks_recent.json", {
      count: taskEvents.length,
      events: taskEvents.map((item) => ({
        recordedAt: item.recordedAt,
        progress: {
          ...item.progress,
          currentFile: item.progress.currentFile ? redactAbsolutePath(item.progress.currentFile, anonymize) : null
        }
      }))
    });

    await writeJson(bundleDir, "ipc_errors_recent.json", {
      count: ipcFailures.length,
      errors: ipcFailures.map((item) => ({
        recordedAt: item.recordedAt,
        channel: item.channel,
        code: item.error.code,
        stage: item.error.stage,
        message: item.error.message,
        suggestion: item.error.suggestion,
        retryable: item.error.retryable,
        details: anonymize ? null : item.error.details ?? null
      }))
    });

    await writeJson(bundleDir, "chat_sessions_summary.json", {
      sessionCount: snapshot.chatSessions.length,
      sessions: snapshot.chatSessions.map((session) => ({
        id: session.id,
        title: anonymize ? "[REDACTED]" : session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        turnCount: session.turnCount
      }))
    });

    const targetZip = path.resolve(outputZipPath);
    fs.mkdirSync(path.dirname(targetZip), { recursive: true });
    zipDirectoryContents(bundleDir, targetZip);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
