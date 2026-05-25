import type { DatabaseMigrationReport, LibraryHealthReport, LibraryTaskProgress, SystemStatus } from "../../shared/types";

export type SupportTriageStatus = "ok" | "warning" | "error";

export interface SupportTriageCheck {
  id: string;
  status: SupportTriageStatus;
  message: string;
  nextFile: string;
  nextAction: string;
}

export interface SupportTriageSummary {
  schemaVersion: 1;
  privacy: {
    anonymize: boolean;
    rawDocumentContentIncluded: false;
    rawChunkTextIncluded: false;
    fullQueryPayloadIncluded: false;
  };
  counts: {
    documents: number;
    chunks: number;
    healthIssues: number;
    missingSources: number;
    reindexNeeded: number;
    ocrRecommendedDocuments: number;
    recentTaskFailures: number;
    recentIpcErrors: number;
  };
  checks: SupportTriageCheck[];
}

export function buildSupportTriageSummary(input: {
  anonymize: boolean;
  systemStatus: Pick<SystemStatus, "documentCount" | "chunkCount" | "embeddingAvailable" | "embeddingReason" | "vectorIndexAvailable" | "vectorIndexReason">;
  health: LibraryHealthReport;
  migration: DatabaseMigrationReport;
  recentTasks: LibraryTaskProgress[];
  recentIpcErrorCount: number;
  ocrRecommendedDocumentCount: number;
}): SupportTriageSummary {
  const recentTaskFailures = input.recentTasks.filter((progress) =>
    progress.failed > 0 ||
    progress.phase === "failed" ||
    progress.issue?.disposition === "failed"
  ).length;

  return {
    schemaVersion: 1,
    privacy: {
      anonymize: input.anonymize,
      rawDocumentContentIncluded: false,
      rawChunkTextIncluded: false,
      fullQueryPayloadIncluded: false
    },
    counts: {
      documents: input.systemStatus.documentCount,
      chunks: input.systemStatus.chunkCount,
      healthIssues: input.health.summary.issueCount,
      missingSources: input.health.summary.missingSourceCount,
      reindexNeeded: input.health.summary.reindexNeededCount,
      ocrRecommendedDocuments: input.ocrRecommendedDocumentCount,
      recentTaskFailures,
      recentIpcErrors: input.recentIpcErrorCount
    },
    checks: [
      buildMigrationCheck(input.migration),
      buildEmbeddingCheck(input.systemStatus),
      buildVectorIndexCheck(input.systemStatus),
      buildLibraryHealthCheck(input.health),
      buildRecentTaskCheck(recentTaskFailures),
      buildOcrCheck(input.ocrRecommendedDocumentCount),
      buildIpcCheck(input.recentIpcErrorCount)
    ]
  };
}

function buildMigrationCheck(migration: DatabaseMigrationReport): SupportTriageCheck {
  if (migration.error) {
    return {
      id: "migration",
      status: "error",
      message: migration.error,
      nextFile: "migration.json",
      nextAction: "Confirm the app supports this database schema before opening or modifying the library."
    };
  }

  if (migration.migrationNeeded && !migration.migrationApplied) {
    return {
      id: "migration",
      status: "warning",
      message: "Migration was needed but has not been marked as applied.",
      nextFile: "migration.json",
      nextAction: "Check migration timestamps and backup status before retrying the app launch."
    };
  }

  return {
    id: "migration",
    status: "ok",
    message: migration.backupCreated ? "Migration completed with a pre-migration backup." : "Database schema is supported.",
    nextFile: "migration.json",
    nextAction: "No migration action needed unless the user reports startup failures."
  };
}

function buildEmbeddingCheck(status: Pick<SystemStatus, "embeddingAvailable" | "embeddingReason">): SupportTriageCheck {
  if (!status.embeddingAvailable) {
    return {
      id: "embedding",
      status: "warning",
      message: status.embeddingReason ?? "Embedding model is unavailable.",
      nextFile: "embedding.json",
      nextAction: "Verify the local embedding model files and dependency installation."
    };
  }

  return {
    id: "embedding",
    status: "ok",
    message: "Embedding model is available.",
    nextFile: "embedding.json",
    nextAction: "No embedding action needed."
  };
}

function buildVectorIndexCheck(status: Pick<SystemStatus, "vectorIndexAvailable" | "vectorIndexReason">): SupportTriageCheck {
  if (!status.vectorIndexAvailable) {
    return {
      id: "vector_index",
      status: "warning",
      message: status.vectorIndexReason ?? "Vector index is unavailable; lexical fallback may still work.",
      nextFile: "vector_index.json",
      nextAction: "Review recent vector-index events and consider reindexing after storage issues are resolved."
    };
  }

  return {
    id: "vector_index",
    status: "ok",
    message: "Vector index is available.",
    nextFile: "vector_index.json",
    nextAction: "No vector-index action needed."
  };
}

function buildLibraryHealthCheck(health: LibraryHealthReport): SupportTriageCheck {
  if (health.summary.missingSourceCount > 0) {
    return {
      id: "library_health",
      status: "error",
      message: `${health.summary.missingSourceCount} document(s) reference missing source files.`,
      nextFile: "library_health.json",
      nextAction: "Ask the user whether to restore the source files or remove missing-source records."
    };
  }

  if (health.summary.issueCount > 0) {
    return {
      id: "library_health",
      status: "warning",
      message: `${health.summary.issueCount} health issue(s); ${health.summary.reindexNeededCount} document(s) need reindex.`,
      nextFile: "library_health.json",
      nextAction: "Use the in-app health repair flow for reindexable documents."
    };
  }

  return {
    id: "library_health",
    status: "ok",
    message: "No library health issues reported.",
    nextFile: "library_health.json",
    nextAction: "No library-health action needed."
  };
}

function buildRecentTaskCheck(recentTaskFailures: number): SupportTriageCheck {
  if (recentTaskFailures > 0) {
    return {
      id: "recent_tasks",
      status: "error",
      message: `${recentTaskFailures} recent import/reindex task event(s) include failures.`,
      nextFile: "library_tasks_recent.json",
      nextAction: "Review structured issue codes, stages, suggestions, and repairAction hints."
    };
  }

  return {
    id: "recent_tasks",
    status: "ok",
    message: "No recent import/reindex failures captured.",
    nextFile: "library_tasks_recent.json",
    nextAction: "No recent-task action needed unless the user reports an uncaptured failure."
  };
}

function buildOcrCheck(ocrRecommendedDocumentCount: number): SupportTriageCheck {
  if (ocrRecommendedDocumentCount > 0) {
    return {
      id: "ocr",
      status: "warning",
      message: `${ocrRecommendedDocumentCount} document(s) are likely scanned or low-text-density PDFs.`,
      nextFile: "documents_summary.json",
      nextAction: "Ask the user to OCR affected documents externally, then reimport or reindex."
    };
  }

  return {
    id: "ocr",
    status: "ok",
    message: "No OCR recommendation in document summaries.",
    nextFile: "documents_summary.json",
    nextAction: "No OCR action needed."
  };
}

function buildIpcCheck(recentIpcErrorCount: number): SupportTriageCheck {
  if (recentIpcErrorCount > 0) {
    return {
      id: "ipc",
      status: "warning",
      message: `${recentIpcErrorCount} recent structured IPC error(s) captured.`,
      nextFile: "ipc_errors_recent.json",
      nextAction: "Review channel, code, stage, suggestion, and retryable fields."
    };
  }

  return {
    id: "ipc",
    status: "ok",
    message: "No recent IPC errors captured.",
    nextFile: "ipc_errors_recent.json",
    nextAction: "No IPC action needed."
  };
}
