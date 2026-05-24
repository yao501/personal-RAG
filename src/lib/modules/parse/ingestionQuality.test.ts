import { describe, expect, it } from "vitest";
import { buildIngestionQualityReport } from "./ingestionQuality";
import type { ChunkRecord, ParsedDocumentContent } from "../../shared/types";

function chunk(partial: Partial<ChunkRecord>): ChunkRecord {
  return {
    id: partial.id ?? "chunk-1",
    documentId: "doc-1",
    text: partial.text ?? "正文",
    chunkIndex: partial.chunkIndex ?? 0,
    startOffset: 0,
    endOffset: partial.text?.length ?? 2,
    tokenCount: partial.tokenCount ?? 20,
    sectionTitle: null,
    sectionPath: null,
    headingTrail: null,
    ...partial
  };
}

describe("buildIngestionQualityReport", () => {
  it("flags low text-density PDFs as OCR candidates without including raw text", () => {
    const parsed: ParsedDocumentContent = {
      fileType: "pdf",
      content: "少量文本",
      pageSpans: [
        { pageNumber: 1, startOffset: 0, endOffset: 2 },
        { pageNumber: 2, startOffset: 2, endOffset: 4 },
        { pageNumber: 3, startOffset: 4, endOffset: 5 }
      ]
    };

    const report = buildIngestionQualityReport(parsed, [chunk({ tokenCount: 8 })], "2026-05-24T00:00:00.000Z");

    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-05-24T00:00:00.000Z",
      fileType: "pdf",
      pageCount: 3,
      chunkCount: 1
    });
    expect(report.warnings.map((warning) => warning.code)).toContain("low_text_density_pdf");
    expect(JSON.stringify(report)).not.toContain(parsed.content);
  });

  it("summarizes chunk token distribution", () => {
    const parsed: ParsedDocumentContent = {
      fileType: "md",
      content: "# 标题\n\n这是一段足够长的文本，用于验证导入质量报告不会依赖原文泄露。".repeat(20)
    };

    const report = buildIngestionQualityReport(parsed, [
      chunk({ id: "a", tokenCount: 10 }),
      chunk({ id: "b", tokenCount: 30 }),
      chunk({ id: "c", tokenCount: 50 })
    ]);

    expect(report.averageChunkTokens).toBe(30);
    expect(report.minChunkTokens).toBe(10);
    expect(report.maxChunkTokens).toBe(50);
  });
});
