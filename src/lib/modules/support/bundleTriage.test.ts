import { describe, expect, it } from "vitest";
import { buildSupportTriageSummary } from "./bundleTriage";
import type { DatabaseMigrationReport, LibraryHealthReport, LibraryTaskProgress, SystemStatus } from "../../shared/types";

const OK_SYSTEM: Pick<SystemStatus, "documentCount" | "chunkCount" | "embeddingAvailable" | "embeddingReason" | "vectorIndexAvailable" | "vectorIndexReason"> = {
  documentCount: 2,
  chunkCount: 12,
  embeddingAvailable: true,
  embeddingReason: null,
  vectorIndexAvailable: true,
  vectorIndexReason: null
};

const OK_HEALTH: LibraryHealthReport = {
  generatedAt: "2026-05-25T00:00:00.000Z",
  summary: {
    totalDocuments: 2,
    issueCount: 0,
    missingSourceCount: 0,
    reindexNeededCount: 0
  },
  issues: []
};

const OK_MIGRATION: DatabaseMigrationReport = {
  currentSchemaVersion: 3,
  databaseUserVersionBefore: 3,
  databaseUserVersionAfter: 3,
  migrationNeeded: false,
  migrationApplied: false,
  backupCreated: false,
  backupPath: null,
  startedAt: "2026-05-25T00:00:00.000Z",
  completedAt: "2026-05-25T00:00:01.000Z",
  error: null
};

describe("bundleTriage", () => {
  it("builds an all-ok support triage summary without content payload flags", () => {
    const summary = buildSupportTriageSummary({
      anonymize: true,
      systemStatus: OK_SYSTEM,
      health: OK_HEALTH,
      migration: OK_MIGRATION,
      recentTasks: [],
      recentIpcErrorCount: 0,
      ocrRecommendedDocumentCount: 0
    });

    expect(summary.privacy).toEqual({
      anonymize: true,
      rawDocumentContentIncluded: false,
      rawChunkTextIncluded: false,
      fullQueryPayloadIncluded: false
    });
    expect(summary.counts).toMatchObject({
      documents: 2,
      chunks: 12,
      healthIssues: 0,
      recentTaskFailures: 0
    });
    expect(summary.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("surfaces health, task, vector, OCR, migration, and IPC warnings as triage checks", () => {
    const failedTask: LibraryTaskProgress = {
      taskId: "task-1",
      kind: "import",
      phase: "failed",
      message: "导入失败",
      current: 1,
      total: 1,
      currentFile: null,
      processed: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      done: true
    };

    const summary = buildSupportTriageSummary({
      anonymize: false,
      systemStatus: {
        ...OK_SYSTEM,
        vectorIndexAvailable: false,
        vectorIndexReason: "lance index unavailable"
      },
      health: {
        ...OK_HEALTH,
        summary: {
          totalDocuments: 2,
          issueCount: 2,
          missingSourceCount: 1,
          reindexNeededCount: 1
        }
      },
      migration: {
        ...OK_MIGRATION,
        error: "Database schema version 99 is newer than this app supports (3)."
      },
      recentTasks: [failedTask],
      recentIpcErrorCount: 1,
      ocrRecommendedDocumentCount: 2
    });

    expect(summary.counts).toMatchObject({
      healthIssues: 2,
      missingSources: 1,
      reindexNeeded: 1,
      ocrRecommendedDocuments: 2,
      recentTaskFailures: 1,
      recentIpcErrors: 1
    });
    expect(Object.fromEntries(summary.checks.map((check) => [check.id, check.status]))).toMatchObject({
      migration: "error",
      vector_index: "warning",
      library_health: "error",
      recent_tasks: "error",
      ocr: "warning",
      ipc: "warning"
    });
  });
});
