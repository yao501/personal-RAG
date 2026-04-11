import { describe, expect, it } from "vitest";
import { resolveQueryRetrievalType } from "./queryRetrievalType";
import { buildRetrievalDebugPayload } from "./retrievalDebug";
import type { ChatAnswer, SearchResult } from "../../shared/types";

function emptyAnswer(): ChatAnswer {
  return {
    answer: "",
    directAnswer: "没有找到足够可靠的依据。",
    supportingPoints: [],
    sourceDocumentCount: 0,
    basedOnSingleDocument: false,
    citations: []
  };
}

function minimalResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    documentId: "d",
    fileName: "f.md",
    documentTitle: "T",
    chunkId: "c",
    snippet: "",
    evidenceText: "",
    fullText: "",
    score: 1,
    chunkIndex: 0,
    sectionTitle: null,
    sectionPath: null,
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    importedAt: "2026-01-01T00:00:00.000Z",
    text: "",
    lexicalScore: 1,
    semanticScore: 1,
    freshnessScore: 0.5,
    rerankScore: 1,
    qualityScore: 1,
    ...overrides
  };
}

describe("resolveQueryRetrievalType", () => {
  it("maps fixed questions to expected buckets (conservative)", () => {
    expect(resolveQueryRetrievalType("从安装到投运的完整步骤是什么？")).toBe("procedural_full_flow");
    expect(resolveQueryRetrievalType("编译和下装的先后顺序？")).toBe("compile_order");
    expect(resolveQueryRetrievalType("服务启动失败怎么办？")).toBe("troubleshooting");
    expect(resolveQueryRetrievalType("RAG是什么？")).toBe("definition");
    expect(resolveQueryRetrievalType("随便聊聊")).toBe("default");
    expect(resolveQueryRetrievalType("   ")).toBe("default");
  });
});

describe("buildRetrievalDebugPayload queryRetrievalType", () => {
  it("includes queryRetrievalType in payload for logs (schema v3)", () => {
    const payload = buildRetrievalDebugPayload(
      "编译和下装的顺序？",
      [],
      0,
      [minimalResult({ chunkId: "x" })],
      emptyAnswer(),
      {
        searchLimit: 6,
        vectorRecallBackend: "memory",
        runtime: "eval",
        queryRetrievalType: "compile_order"
      }
    );
    expect(payload.schemaVersion).toBe(3);
    expect(payload.queryRetrievalType).toBe("compile_order");
  });
});
