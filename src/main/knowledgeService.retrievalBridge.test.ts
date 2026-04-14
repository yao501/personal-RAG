import { describe, expect, it, vi } from "vitest";
import { KnowledgeService } from "./knowledgeService";
import type { AppStore } from "./store";
import type { ChatAnswer, ChunkRecord, DocumentRecord, SearchResult } from "../lib/shared/types";

vi.mock("../lib/modules/embed/localEmbedder", () => {
  return {
    embedTexts: vi.fn(async () => {
      throw new Error("no embeddings in test");
    }),
    getEmbeddingStatus: vi.fn(() => ({ ok: true, detail: "mock" }))
  };
});

vi.mock("../lib/modules/retrieve/candidateChunks", () => {
  return {
    selectCandidateChunksFromVectors: vi.fn(() => {
      return [] as ChunkRecord[];
    })
  };
});

const searchChunksMock = vi.fn<
  (
    question: string,
    documents: DocumentRecord[],
    chunks: ChunkRecord[],
    limit: number,
    queryEmbedding?: number[] | null
  ) => SearchResult[]
>();

vi.mock("../lib/modules/retrieve/searchIndex", () => {
  return {
    searchChunks: (...args: any[]) => searchChunksMock(...args)
  };
});

let lastAnswerResults: SearchResult[] | null = null;
vi.mock("../lib/modules/answer/answerQuestion", () => {
  return {
    answerQuestion: (_question: string, results: SearchResult[]): ChatAnswer => {
      lastAnswerResults = results;
      return {
        answer: "",
        directAnswer: results[0]?.fileName ?? "",
        supportingPoints: [],
        sourceDocumentCount: 0,
        basedOnSingleDocument: false,
        citations: []
      };
    }
  };
});

function baseResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    documentId: "d",
    fileName: "x.pdf",
    documentTitle: "T",
    chunkId: "c",
    snippet: "",
    evidenceText: "",
    fullText: "",
    score: 1,
    chunkIndex: 0,
    sectionTitle: "S",
    sectionPath: "P > S",
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

describe("KnowledgeService.askQuestion retrieval bridge (P0-B B1/B2/B3)", () => {
  it("applies sprint53c bias in desktop path using queryRetrievalType + documentCount", async () => {
    const store: Pick<
      AppStore,
      "listDocuments" | "listChunks" | "getSettings" | "createChatSession" | "listChatTurns" | "saveChatTurn" | "saveQueryLog"
    > = {
      listDocuments: () =>
        [
          {
            id: "doc-1",
            filePath: "/tmp/a.pdf",
            fileName: "HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf",
            title: "安装",
            fileType: "pdf",
            content: "",
            importedAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            sourceCreatedAt: "2026-04-01T00:00:00.000Z",
            sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
            chunkCount: 0
          },
          {
            id: "doc-2",
            filePath: "/tmp/b.pdf",
            fileName: "HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf",
            title: "图形",
            fileType: "pdf",
            content: "",
            importedAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            sourceCreatedAt: "2026-04-01T00:00:00.000Z",
            sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
            chunkCount: 0
          }
        ] satisfies DocumentRecord[],
      listChunks: () => [] as ChunkRecord[],
      getSettings: () =>
        ({
          chunkSize: 900,
          chunkOverlap: 120,
          parserVersion: 2
        }) as any,
      createChatSession: (row: any) => row,
      listChatTurns: () => [],
      saveChatTurn: () => {},
      saveQueryLog: () => {}
    };

    const svc = new KnowledgeService(store as unknown as AppStore);
    // Ensure we never hit native LanceIndex in this unit test.
    (svc as any).lanceIndex = { search: async () => [], rebuild: async () => {}, clear: async () => {} };

    // Base results: graphics ranks first by score, install second.
    searchChunksMock.mockReturnValueOnce([
      baseResult({ chunkId: "g", fileName: "HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf", score: 100, text: "图层管理说明" }),
      baseResult({ chunkId: "i", fileName: "HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf", score: 82, text: "安装步骤说明" })
    ]);

    await svc.askQuestion("s1", "从安装到投运完整步骤是什么？");

    expect(lastAnswerResults?.[0]?.fileName).toContain("用户手册1_软件安装");
  });
});

