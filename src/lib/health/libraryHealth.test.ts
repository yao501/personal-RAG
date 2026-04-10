import { describe, expect, it } from "vitest";
import { buildLibraryHealthReport } from "./libraryHealth";
import type { ChunkRecord, DocumentRecord } from "../shared/types";

describe("libraryHealth", () => {
  it("reports missing sources, stale files, config mismatch, and missing embeddings", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/a.pdf",
        fileName: "a.pdf",
        title: "A",
        fileType: "pdf",
        content: "A",
        importedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sourceCreatedAt: "2026-01-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
        indexConfigSignature: "sig-old",
        chunkCount: 1
      },
      {
        id: "doc-2",
        filePath: "/tmp/b.docx",
        fileName: "b.docx",
        title: "B",
        fileType: "docx",
        content: "B",
        importedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sourceCreatedAt: "2026-01-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
        indexConfigSignature: "sig-new",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "chunk-1",
        documentId: "doc-1",
        text: "内容",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 2,
        tokenCount: 1,
        sectionTitle: null,
        sectionPath: null,
        headingTrail: null,
        embedding: null
      }
    ];

    const report = buildLibraryHealthReport({
      documents,
      chunks,
      currentIndexConfigSignature: "sig-new",
      sourceStatusByDocumentId: {
        "doc-1": {
          exists: true,
          sourceUpdatedAt: "2026-01-02T00:00:00.000Z"
        },
        "doc-2": {
          exists: false,
          sourceUpdatedAt: null
        }
      },
      generatedAt: "2026-02-01T00:00:00.000Z"
    });

    expect(report.summary.issueCount).toBe(4);
    expect(report.summary.missingSourceCount).toBe(1);
    expect(report.summary.reindexNeededCount).toBe(1);
    expect(report.issues.some((issue) => issue.kind === "missing_source")).toBe(true);
    expect(report.issues.some((issue) => issue.kind === "source_updated")).toBe(true);
    expect(report.issues.some((issue) => issue.kind === "index_config_mismatch")).toBe(true);
    expect(report.issues.some((issue) => issue.kind === "missing_embeddings")).toBe(true);
  });
});
