import os from "node:os";
import type { Citation, DocumentRecord, LibraryTaskProgress, QueryLogRecord, SearchResult } from "../../shared/types";

export interface VectorIndexEventForBundle {
  recordedAt: string;
  operation: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown> | null;
}

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
    ingestionQuality: document.ingestionQuality
      ? {
          schemaVersion: document.ingestionQuality.schemaVersion,
          generatedAt: document.ingestionQuality.generatedAt,
          characterCount: document.ingestionQuality.characterCount,
          nonWhitespaceCharacterCount: document.ingestionQuality.nonWhitespaceCharacterCount,
          lineCount: document.ingestionQuality.lineCount,
          pageCount: document.ingestionQuality.pageCount,
          textDensityPerPage: document.ingestionQuality.textDensityPerPage ?? null,
          ocrRecommended: document.ingestionQuality.ocrRecommended ?? false,
          ocrConfidence: document.ingestionQuality.ocrConfidence ?? "none",
          averageChunkTokens: document.ingestionQuality.averageChunkTokens,
          minChunkTokens: document.ingestionQuality.minChunkTokens,
          maxChunkTokens: document.ingestionQuality.maxChunkTokens,
          warningCount: document.ingestionQuality.warnings.length,
          warnings: document.ingestionQuality.warnings
        }
      : null,
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

function summarizeCitationForDebugExport(citation: Citation): Record<string, unknown> {
  return {
    documentId: citation.documentId,
    fileName: citation.fileName,
    documentTitle: citation.documentTitle,
    chunkId: citation.chunkId,
    chunkIndex: citation.chunkIndex,
    score: citation.score,
    sectionTitle: citation.sectionTitle ?? null,
    sectionPath: citation.sectionPath ?? null,
    sectionRootLabel: citation.sectionRootLabel ?? null,
    pageStart: citation.pageStart ?? null,
    pageEnd: citation.pageEnd ?? null,
    paragraphStart: citation.paragraphStart ?? null,
    paragraphEnd: citation.paragraphEnd ?? null,
    locatorLabel: citation.locatorLabel ?? null,
    anchorLabel: citation.anchorLabel ?? null,
    sourceUpdatedAt: citation.sourceUpdatedAt ?? null,
    importedAt: citation.importedAt ?? null
  };
}

function summarizeTopResultForDebugExport(result: SearchResult): Record<string, unknown> {
  return {
    ...summarizeCitationForDebugExport(result),
    lexicalScore: result.lexicalScore,
    semanticScore: result.semanticScore,
    freshnessScore: result.freshnessScore,
    rerankScore: result.rerankScore,
    qualityScore: result.qualityScore,
    scoreBreakdown: result.scoreBreakdown ?? null,
    hasEvidenceText: Boolean(result.evidenceText?.trim()),
    hasHighlight: result.highlightStart !== null && result.highlightStart !== undefined && result.highlightEnd !== null && result.highlightEnd !== undefined
  };
}

export function summarizeQueryDebugSnapshotForExport(
  log: QueryLogRecord,
  anonymize: boolean
): Record<string, unknown> {
  const retrievalDebug = log.retrievalDebug
    ? {
        ...log.retrievalDebug,
        question: anonymize ? "[REDACTED]" : log.retrievalDebug.question
      }
    : null;

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    privacy: {
      anonymize,
      rawDocumentContentIncluded: false,
      rawChunkTextIncluded: false,
      answerTextIncluded: !anonymize,
      questionTextIncluded: !anonymize
    },
    queryLog: {
      id: log.id,
      sessionId: anonymize ? "[REDACTED]" : log.sessionId,
      createdAt: log.createdAt,
      feedbackStatus: log.feedbackStatus,
      feedbackNote: anonymize ? null : log.feedbackNote,
      questionCharCount: log.question.length,
      questionPreview: anonymize ? "[REDACTED]" : log.question.slice(0, 500)
    },
    answer: {
      mode: log.answer.evidenceDecision?.mode ?? null,
      reasonCode: log.answer.evidenceDecision?.reasonCode ?? null,
      directAnswer: anonymize ? null : log.answer.directAnswer,
      answerCharCount: log.answer.answer.length,
      supportingPointCount: log.answer.supportingPoints.length,
      sourceDocumentCount: log.answer.sourceDocumentCount,
      basedOnSingleDocument: log.answer.basedOnSingleDocument,
      citationCount: log.citations.length
    },
    citations: log.citations.map(summarizeCitationForDebugExport),
    topResults: log.topResults.map(summarizeTopResultForDebugExport),
    retrievalDebug
  };
}

export function summarizeTaskProgressForBundle(progress: LibraryTaskProgress, anonymize: boolean): LibraryTaskProgress {
  return {
    ...progress,
    currentFile: progress.currentFile ? redactAbsolutePath(progress.currentFile, anonymize) : null,
    issue: progress.issue
      ? {
          ...progress.issue,
          filePath: redactAbsolutePath(progress.issue.filePath, anonymize)
        }
      : progress.issue ?? null
  };
}

export function summarizeVectorIndexEventsForBundle(
  events: VectorIndexEventForBundle[],
  anonymize: boolean
): VectorIndexEventForBundle[] {
  return events.map((event) => ({
    recordedAt: event.recordedAt,
    operation: event.operation,
    ok: event.ok,
    message: event.message,
    details: anonymize ? null : event.details ?? null
  }));
}
