import { describe, expect, it } from "vitest";
import type { BenchmarkCaseEvalResult } from "./benchmarkMetrics";
import { renderBenchmarkJsonReport } from "./benchmarkRunner";
import type { BenchmarkFileV1 } from "./benchmarkSchema";

describe("benchmarkRunner JSON report", () => {
  it("renders a machine-readable summary without raw retrieval text", () => {
    const config: BenchmarkFileV1 = {
      schemaVersion: 1,
      id: "smoke",
      description: "Smoke benchmark",
      documents: [{ id: "doc-1", path: "benchmarks/fixtures/alpha_rag_basics.md" }],
      cases: [
        {
          id: "case-1",
          question: "What is indexed?",
          expectedDocs: ["alpha"],
          mustRefuse: false,
          intentGroup: "basics"
        }
      ]
    };
    const result: BenchmarkCaseEvalResult = {
      case: config.cases[0],
      results: [
        {
          documentId: "doc-1",
          fileName: "alpha_rag_basics.md",
          documentTitle: "Alpha",
          chunkId: "chunk-1",
          snippet: "RAW SNIPPET",
          evidenceText: "RAW EVIDENCE",
          fullText: "RAW FULL TEXT",
          score: 1,
          chunkIndex: 0,
          sectionTitle: null,
          sectionPath: null,
          sourceUpdatedAt: null,
          importedAt: "2026-01-01T00:00:00.000Z",
          text: "RAW CHUNK TEXT",
          lexicalScore: 1,
          semanticScore: 0,
          freshnessScore: 0,
          rerankScore: 1,
          qualityScore: 1
        }
      ],
      answer: {
        answer: "Grounded",
        directAnswer: "Grounded",
        supportingPoints: [],
        sourceDocumentCount: 1,
        basedOnSingleDocument: true,
        citations: []
      },
      retrieval: {
        topK: 6,
        docHit: true,
        recallAtK: 1,
        matchedExpectedIndices: [0]
      },
      answerMetrics: {
        refusalDetected: false,
        mustRefuseCorrect: null,
        cautiousProcedural: false,
        factsMatched: [],
        factsMissing: [],
        citationHit: null
      },
      passed: true,
      failureReasons: [],
      failureCategory: null
    };

    const report = JSON.parse(renderBenchmarkJsonReport({
      benchmarkId: config.id,
      benchmarkPath: "/repo/benchmarks/benchmark.v1.json",
      config,
      caseResults: [result],
      generatedAt: "2026-05-14T00:00:00.000Z"
    }));

    expect(report.summary.passed).toBe(1);
    expect(report.cases[0]).toMatchObject({
      id: "case-1",
      passed: true,
      topResultCount: 1
    });
    expect(JSON.stringify(report)).not.toContain("RAW CHUNK TEXT");
    expect(JSON.stringify(report)).not.toContain("RAW EVIDENCE");
  });
});
