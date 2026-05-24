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
    evidenceDecision: {
      schemaVersion: 1,
      mode: "refusal",
      reasonCode: "no_results",
      reason: "检索没有找到可用于回答的候选片段。",
      suggestions: ["导入更多相关文档"],
      signals: {
        resultCount: 0,
        usableResultCount: 0,
        citedChunkCount: 0,
        sourceDocumentCount: 0,
        intentWantsSteps: false,
        topScore: null,
        topLexicalScore: null,
        topSemanticScore: null,
        topRerankScore: null,
        topQualityScore: null
      }
    },
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
  it("includes queryRetrievalType, evidence decision, and selection reasons in payload for logs (schema v10)", () => {
    const payload = buildRetrievalDebugPayload(
      "编译和下装的顺序？",
      ["x"],
      1,
      [
        minimalResult({
          chunkId: "x",
          evidenceText: "先编译，后下装。",
          scoreBreakdown: {
            lexicalContribution: 0.42,
            semanticContribution: 0.31,
            rerankContribution: 0.22,
            freshnessContribution: 0.1,
            qualityContribution: 0.34,
            penaltyContribution: 0,
            sectionRootBoost: 0,
            finalScore: 1.39
          },
          contextMetadata: {
            manualFamilyId: "engineering",
            manualFamilyLabel: "工程总控",
            sectionDepth: 2,
            sectionRoot: "工程总控",
            contentKind: "procedure",
            technicalTerms: ["DPU"]
          }
        })
      ],
      emptyAnswer(),
      {
        searchLimit: 6,
        vectorRecallBackend: "memory",
        runtime: "eval",
        queryRetrievalType: "compile_order",
        candidateChunkIds: ["x"],
        searchDiagnostics: {
          evaluatedCandidateCount: 2,
          primaryCandidateCount: 1,
          rejectedCandidateCount: 1,
          sampledRejected: [
            {
              chunkId: "y",
              fileName: "noise.md",
              sectionTitle: "Noise",
              score: -0.2,
              lexicalScore: 0,
              semanticScore: 0,
              rerankScore: 0,
              qualityScore: -0.1,
              penalty: 0.5,
              coverage: 0,
              evidenceCoverage: 0,
              matchedAnchorCount: 0,
              reasons: ["very_low_score"]
            }
          ]
        }
      }
    );
    expect(payload.schemaVersion).toBe(10);
    expect(payload.queryRetrievalType).toBe("compile_order");
    expect(payload.candidateSelection).toMatchObject({
      mode: "hybrid_vector_only_or_unknown",
      vectorRecallCount: 1,
      candidateChunkCount: 1,
      lexicalFallbackCount: 0
    });
    expect(payload.topResults[0]).toMatchObject({
      vectorHit: true,
      citationStatus: "not_cited",
      notCitedReason: "answer_refused_or_no_citations",
      selectionReasons: expect.arrayContaining(["vector_shortlist_hit", "sentence_evidence_selected"]),
      scoreBreakdown: expect.objectContaining({
        lexicalContribution: 0.42,
        finalScore: 1.39
      }),
      contextMetadata: expect.objectContaining({
        manualFamilyLabel: "工程总控",
        contentKind: "procedure",
        technicalTerms: ["DPU"]
      })
    });
    expect(payload.evidenceDecision).toMatchObject({
      mode: "refusal",
      reasonCode: "no_results",
      citedChunkCount: 0
    });
    expect(payload.rejectionDiagnostics).toMatchObject({
      evaluatedCandidateCount: 2,
      primaryCandidateCount: 1,
      rejectedCandidateCount: 1,
      sampledRejected: [expect.objectContaining({ chunkId: "y", reasons: ["very_low_score"] })]
    });
  });
});
