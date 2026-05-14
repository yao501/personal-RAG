import { describe, expect, it } from "vitest";
import { injectSprint53aCandidateChunks } from "./fullWorkflowBias";
import type { ChunkRecord, DocumentRecord, SearchResult } from "../../shared/types";

function documentRecord(id: string, fileName: string): DocumentRecord {
  return {
    id,
    filePath: `/tmp/${fileName}`,
    fileName,
    title: fileName.replace(/\.pdf$/i, ""),
    fileType: "pdf",
    content: "",
    importedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    sourceCreatedAt: "2026-04-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
    chunkCount: 1
  };
}

function searchResult(chunk: ChunkRecord, document: DocumentRecord): SearchResult {
  return {
    documentId: document.id,
    fileName: document.fileName,
    documentTitle: document.title,
    chunkId: chunk.id,
    snippet: chunk.text,
    evidenceText: chunk.text,
    fullText: chunk.text,
    text: chunk.text,
    chunkIndex: chunk.chunkIndex,
    sectionTitle: chunk.sectionTitle,
    sectionPath: chunk.sectionPath,
    score: 8,
    lexicalScore: 4,
    semanticScore: 1,
    freshnessScore: 0.5,
    rerankScore: 2,
    qualityScore: 1,
    sourceUpdatedAt: document.sourceUpdatedAt,
    importedAt: document.importedAt
  };
}

describe("injectSprint53aCandidateChunks", () => {
  it("adds controller-side download evidence for short compile/download order questions", () => {
    const manual3 = documentRecord("manual3", "HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf");
    const manual2 = documentRecord("manual2", "HOLLiAS_MACS_V6.5用户手册2_快速入门.pdf");
    const documents = [manual3, manual2];
    const faqChunk: ChunkRecord = {
      id: "faq-order",
      documentId: manual3.id,
      text: "13.2 Q：编译和下装的顺序是什么？先编译后下装。",
      chunkIndex: 20,
      startOffset: 0,
      endOffset: 28,
      tokenCount: 14,
      sectionTitle: "第13章 常见问题",
      sectionPath: "工程总控 > 第13章 常见问题",
      headingTrail: "工程总控 > 第13章 常见问题"
    };
    const controllerChunk: ChunkRecord = {
      id: "controller-download",
      documentId: manual2.id,
      text: "下装是将编译生成的下装文件，通过网络传输到历史站、操作员站和控制器的过程。下装分为下装控制器算法、下装操作站、下装历史站和下装报表打印站。",
      chunkIndex: 88,
      startOffset: 100,
      endOffset: 176,
      tokenCount: 34,
      sectionTitle: "2.9.1 下装",
      sectionPath: "快速入门 > 2.9 下装运行 > 2.9.1 下装",
      headingTrail: "快速入门 > 2.9 下装运行 > 2.9.1 下装"
    };

    const results = injectSprint53aCandidateChunks(
      "编译和下装的顺序是什么？",
      [searchResult(faqChunk, manual3)],
      [faqChunk],
      documents,
      6,
      [faqChunk, controllerChunk]
    );

    expect(results.map((result) => result.chunkId)).toContain("controller-download");
    expect(results.find((result) => result.chunkId === "controller-download")?.text).toContain("控制器");
  });
});
