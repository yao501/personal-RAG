import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  redactAbsolutePath,
  summarizeDocumentForBundle,
  summarizeQueryDebugSnapshotForExport,
  summarizeQueryLogsForBundle,
  summarizeTaskProgressForBundle,
  summarizeVectorIndexEventsForBundle
} from "./bundlePrivacy";
import type { DocumentRecord, QueryLogRecord } from "../../shared/types";

describe("bundlePrivacy", () => {
  it("redacts home prefix when anonymize is true", () => {
    const p = path.join(os.homedir(), "Documents", "foo", "bar.txt");
    expect(redactAbsolutePath(p, true)).toBe(`~/Documents/foo/bar.txt`);
  });

  it("redacts arbitrary macOS user folder segment when anonymize is true", () => {
    const p = "/Users/not-the-current-user/project/file.txt";
    expect(redactAbsolutePath(p, true)).toBe("/Users/[USER]/project/file.txt");
  });

  it("leaves path unchanged when anonymize is false", () => {
    const p = "/Users/alice/Documents/foo.txt";
    expect(redactAbsolutePath(p, false)).toBe(p);
  });

  it("summarizes documents without content fields", () => {
    const document: DocumentRecord = {
      id: "d1",
      filePath: "/Users/me/doc.pdf",
      fileName: "doc.pdf",
      title: "T",
      fileType: "pdf",
      content: "SECRET BODY",
      importedAt: "2020-01-01",
      updatedAt: "2020-01-02",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      indexConfigSignature: "{}",
      chunkCount: 3,
      ingestionQuality: {
        schemaVersion: 2,
        generatedAt: "2026-05-25T00:00:00.000Z",
        fileType: "pdf",
        characterCount: 10,
        nonWhitespaceCharacterCount: 8,
        lineCount: 1,
        pageCount: 4,
        textDensityPerPage: 2,
        ocrRecommended: true,
        ocrConfidence: "strong",
        chunkCount: 1,
        averageChunkTokens: 8,
        minChunkTokens: 8,
        maxChunkTokens: 8,
        warnings: [
          {
            code: "low_text_density_pdf",
            severity: "error",
            message: "PDF 每页可提取文本极少，很可能是扫描版或图片型 PDF。",
            suggestion: "OCR"
          }
        ]
      }
    };
    const summary = summarizeDocumentForBundle(document, true);
    expect(summary).not.toHaveProperty("content");
    expect(String(summary.filePath)).toContain("[USER]");
    expect(summary.ingestionQuality).toMatchObject({
      textDensityPerPage: 2,
      ocrRecommended: true,
      ocrConfidence: "strong",
      warningCount: 1
    });
  });

  it("redacts query log previews when anonymize is true", () => {
    const log: QueryLogRecord = {
      id: "q1",
      sessionId: "s1",
      question: "secret question",
      answer: {
        answer: "",
        directAnswer: "",
        supportingPoints: [],
        sourceDocumentCount: 0,
        basedOnSingleDocument: true,
        citations: []
      },
      citations: [],
      topResults: [],
      retrievalDebug: null,
      createdAt: "2020-01-01",
      feedbackStatus: "pending",
      feedbackNote: null
    };
    const rows = summarizeQueryLogsForBundle([log], true) as Array<{ questionPreview: string; sessionId: string }>;
    expect(rows[0].questionPreview).toBe("[REDACTED]");
    expect(rows[0].sessionId).toBe("[REDACTED]");
  });

  it("redacts task progress current file and issue file path", () => {
    const progress = summarizeTaskProgressForBundle({
      taskId: "t1",
      kind: "reindex",
      phase: "failed",
      message: "重建失败",
      current: 1,
      total: 1,
      currentFile: "/Users/alice/Documents/source.pdf",
      processed: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      done: false,
      issue: {
        filePath: "/Users/alice/Documents/source.pdf",
        disposition: "failed",
        reason: "missing",
        code: "file_not_found",
        stage: "preflight",
        message: "missing",
        suggestion: "choose again",
        retryable: false
      },
      preflightSummary: {
        schemaVersion: 1,
        generatedAt: "2026-05-25T00:00:00.000Z",
        totalFiles: 1,
        candidateFiles: 0,
        skippedFiles: 0,
        failedFiles: 1,
        unchangedFiles: 0,
        duplicateSelections: 0,
        unsupportedFiles: 0,
        missingFiles: 1,
        permissionDeniedFiles: 0,
        pdfFiles: 0,
        docxFiles: 0,
        markdownFiles: 0,
        textFiles: 0,
        issues: [
          {
            filePath: "/Users/alice/Documents/source.pdf",
            disposition: "failed",
            reason: "missing",
            code: "file_not_found",
            stage: "preflight",
            message: "missing",
            suggestion: "choose again",
            retryable: false
          }
        ]
      }
    }, true);

    expect(progress.currentFile).toBe("/Users/[USER]/Documents/source.pdf");
    expect(progress.issue?.filePath).toBe("/Users/[USER]/Documents/source.pdf");
    expect(progress.preflightSummary?.issues[0]?.filePath).toBe("/Users/[USER]/Documents/source.pdf");
  });

  it("omits vector index event details when anonymize is true", () => {
    const [redacted] = summarizeVectorIndexEventsForBundle(
      [
        {
          recordedAt: "2026-05-14T00:00:00.000Z",
          operation: "rebuild",
          ok: false,
          message: "simulated failure",
          details: {
            databasePath: "/Users/alice/Library/Application Support/app/lancedb",
            rowCount: 12
          }
        }
      ],
      true
    );
    const [full] = summarizeVectorIndexEventsForBundle(
      [
        {
          recordedAt: "2026-05-14T00:00:00.000Z",
          operation: "rebuild",
          ok: false,
          message: "simulated failure",
          details: {
            databasePath: "/Users/alice/Library/Application Support/app/lancedb",
            rowCount: 12
          }
        }
      ],
      false
    );

    expect(redacted.details).toBeNull();
    expect(full.details).toMatchObject({ rowCount: 12 });
  });

  it("exports a single query debug snapshot without raw chunk text when anonymized", () => {
    const log: QueryLogRecord = {
      id: "q1",
      sessionId: "s1",
      question: "secret question about process",
      answer: {
        answer: "SECRET ANSWER BODY",
        directAnswer: "SECRET DIRECT ANSWER",
        supportingPoints: ["SECRET POINT"],
        sourceDocumentCount: 1,
        basedOnSingleDocument: true,
        citations: [],
        evidenceDecision: {
          schemaVersion: 1,
          mode: "grounded",
          reasonCode: "reliable_evidence",
          reason: "enough evidence",
          suggestions: [],
          signals: {
            resultCount: 1,
            usableResultCount: 1,
            citedChunkCount: 1,
            sourceDocumentCount: 1,
            intentWantsSteps: false,
            topScore: 1,
            topLexicalScore: 1,
            topSemanticScore: 1,
            topRerankScore: 1,
            topQualityScore: 1
          }
        }
      },
      citations: [],
      topResults: [
        {
          documentId: "d1",
          fileName: "manual.pdf",
          documentTitle: "Manual",
          chunkId: "c1",
          chunkIndex: 0,
          text: "SECRET CHUNK TEXT",
          snippet: "SECRET SNIPPET",
          evidenceText: "SECRET EVIDENCE",
          fullText: "SECRET FULL TEXT",
          highlightText: "SECRET HIGHLIGHT",
          highlightStart: 0,
          highlightEnd: 6,
          score: 1,
          lexicalScore: 1,
          semanticScore: 1,
          freshnessScore: 0,
          rerankScore: 1,
          qualityScore: 1,
          sectionTitle: "Section",
          sectionPath: "Manual > Section",
          sectionRootLabel: "Manual",
          pageStart: 1,
          pageEnd: 1,
          paragraphStart: null,
          paragraphEnd: null,
          locatorLabel: "p. 1",
          anchorLabel: "p. 1 sentence 1",
          sourceUpdatedAt: null,
          importedAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      retrievalDebug: {
        schemaVersion: 6,
        kind: "pkrag.retrieval",
        question: "secret question about process",
        vectorRecallBackend: "memory",
        runtime: "eval",
        effectiveQueryTokens: ["process"],
        expandedTokens: [],
        intentPrimary: "general",
        intentWantsSteps: false,
        queryRetrievalType: "default",
        vectorShortlistCount: 0,
        candidateChunkCount: 1,
        searchTopK: 6,
        topResults: [],
        answerCitationChunkIds: [],
        answerFlags: { refusal: false, cautiousProcedural: false }
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      feedbackStatus: "pending",
      feedbackNote: "SECRET NOTE"
    };

    const snapshot = summarizeQueryDebugSnapshotForExport(log, true);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("SECRET CHUNK TEXT");
    expect(serialized).not.toContain("SECRET SNIPPET");
    expect(serialized).not.toContain("SECRET EVIDENCE");
    expect(serialized).not.toContain("SECRET ANSWER BODY");
    expect(serialized).not.toContain("secret question");
    expect(snapshot).toMatchObject({
      privacy: {
        anonymize: true,
        rawDocumentContentIncluded: false,
        rawChunkTextIncluded: false
      },
      queryLog: {
        id: "q1",
        questionPreview: "[REDACTED]"
      },
      retrievalDebug: {
        question: "[REDACTED]"
      }
    });
  });
});
