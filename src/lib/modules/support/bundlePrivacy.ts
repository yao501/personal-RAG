import os from "node:os";
import type { DocumentRecord, QueryLogRecord } from "../../shared/types";

export function redactAbsolutePath(filePath: string, anonymize: boolean): string {
  if (!anonymize) {
    return filePath;
  }
  const home = os.homedir();
  let s = filePath;
  if (s.startsWith(home)) {
    s = `~${s.slice(home.length)}`;
  }
  return s.replace(/\/Users\/[^/]+/g, "/Users/[USER]");
}

export function summarizeDocumentForBundle(document: DocumentRecord, anonymize: boolean): Record<string, unknown> {
  return {
    id: document.id,
    fileName: document.fileName,
    title: document.title,
    fileType: document.fileType,
    chunkCount: document.chunkCount,
    importedAt: document.importedAt,
    updatedAt: document.updatedAt,
    sourceUpdatedAt: document.sourceUpdatedAt,
    indexConfigSignature: document.indexConfigSignature ?? null,
    filePath: redactAbsolutePath(document.filePath, anonymize)
  };
}

export function summarizeQueryLogsForBundle(logs: QueryLogRecord[], anonymize: boolean): unknown[] {
  return logs.map((log) => ({
    id: log.id,
    sessionId: anonymize ? "[REDACTED]" : log.sessionId,
    createdAt: log.createdAt,
    feedbackStatus: log.feedbackStatus,
    questionCharCount: log.question.length,
    questionPreview: anonymize ? "[REDACTED]" : log.question.slice(0, 200),
    citationCount: log.citations.length,
    topResultCount: log.topResults.length
  }));
}
