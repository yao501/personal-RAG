import { describe, expect, it } from "vitest";
import {
  categorizeFailureReasons,
  computeRetrievalMetrics,
  detectRefusal,
  evaluateBenchmarkCase,
  summarizeBenchmarkResults
} from "./benchmarkMetrics";
import type { BenchmarkCaseV1 } from "./benchmarkSchema";
import type { ChatAnswer, Citation, SearchResult } from "../shared/types";

function makeSearchResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    documentId: "alpha-rag",
    fileName: "alpha_rag_basics.md",
    documentTitle: "Alpha",
    chunkId: "c1",
    snippet: "snippet",
    evidenceText: "evidence",
    fullText: "full",
    score: 1,
    chunkIndex: 0,
    sectionTitle: null,
    sectionPath: null,
    sourceUpdatedAt: null,
    importedAt: "2026-01-01",
    text: "text",
    lexicalScore: 1,
    semanticScore: 1,
    freshnessScore: 0,
    rerankScore: 1,
    qualityScore: 1,
    ...overrides
  };
}

describe("benchmarkMetrics", () => {
  it("categorizes failure reasons into coarse buckets", () => {
    expect(categorizeFailureReasons(["Expected document not found in top-k retrieval."])).toBe("retrieval");
    expect(categorizeFailureReasons(["Missing expected facts: x"])).toBe("facts");
    expect(categorizeFailureReasons(["Unexpected refusal-style answer for a non-mustRefuse case."])).toBe(
      "unexpected_refusal"
    );
  });

  it("computes recall when expected docs match fileName", () => {
    const benchmarkCase: BenchmarkCaseV1 = {
      id: "c1",
      question: "q",
      expectedDocs: ["alpha_rag_basics.md"],
      mustRefuse: false
    };
    const metrics = computeRetrievalMetrics(benchmarkCase, [makeSearchResult({ fileName: "alpha_rag_basics.md" })], 5);
    expect(metrics.docHit).toBe(true);
    expect(metrics.recallAtK).toBe(1);
  });

  it("detects refusal template from answerQuestion fallback", () => {
    const answer: ChatAnswer = {
      answer: "",
      directAnswer: "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.",
      supportingPoints: [],
      sourceDocumentCount: 0,
      basedOnSingleDocument: false,
      citations: []
    };
    expect(detectRefusal(answer)).toBe(true);
  });

  it("evaluates mustRefuse case", () => {
    const benchmarkCase: BenchmarkCaseV1 = {
      id: "r1",
      question: "nonsense",
      expectedDocs: [],
      mustRefuse: true
    };
    const refusalAnswer: ChatAnswer = {
      answer: "",
      directAnswer: "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.",
      supportingPoints: [],
      sourceDocumentCount: 0,
      basedOnSingleDocument: false,
      citations: []
    };
    const result = evaluateBenchmarkCase(benchmarkCase, [], refusalAnswer, 8);
    expect(result.passed).toBe(true);
  });

  it("summarizes aggregate stats", () => {
    const a: BenchmarkCaseV1 = { id: "a", question: "q", expectedDocs: ["x.md"], mustRefuse: false };
    const cit: Citation = {
      documentId: "d",
      fileName: "x.md",
      documentTitle: "X",
      chunkId: "c1",
      snippet: "s",
      fullText: "f",
      score: 1,
      chunkIndex: 0,
      sectionTitle: null,
      sectionPath: null,
      sourceUpdatedAt: null,
      importedAt: "2026-01-01"
    };
    const results = [
      evaluateBenchmarkCase(
        a,
        [makeSearchResult({ fileName: "x.md" })],
        {
          answer: "",
          directAnswer: "ok",
          supportingPoints: [],
          sourceDocumentCount: 1,
          basedOnSingleDocument: true,
          citations: [cit]
        },
        8
      )
    ];
    const summary = summarizeBenchmarkResults(results);
    expect(summary.total).toBe(1);
  });
});
