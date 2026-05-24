import { describe, expect, it } from "vitest";
import { compareBenchmarkJsonReports, renderBenchmarkComparisonMarkdown, type BenchmarkJsonReportSummary } from "./reportComparison";

function report(overrides: Partial<BenchmarkJsonReportSummary>): BenchmarkJsonReportSummary {
  return {
    reportSchemaVersion: 1,
    generatedAt: "2026-05-24T00:00:00.000Z",
    benchmark: { id: "bench", path: "benchmarks/benchmark.v1.json" },
    summary: {
      total: 2,
      passed: 2,
      failed: 0,
      meanRecallAtK: 1,
      docHitRate: 1,
      mustRefuseCases: 1,
      mustRefuseCorrect: 1
    },
    failureBuckets: {
      retrieval: 0,
      facts: 0
    },
    cases: [
      {
        id: "case-a",
        passed: true,
        failureCategory: null,
        failureReasons: [],
        retrieval: { recallAtK: 1, docHit: true },
        answerMetrics: { refusalDetected: false, cautiousProcedural: false }
      },
      {
        id: "case-b",
        passed: true,
        failureCategory: null,
        failureReasons: [],
        retrieval: { recallAtK: 1, docHit: true },
        answerMetrics: { refusalDetected: true, cautiousProcedural: false }
      }
    ],
    ...overrides
  };
}

describe("reportComparison", () => {
  it("detects pass-to-fail regressions and renders a markdown summary", () => {
    const before = report({});
    const after = report({
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        meanRecallAtK: 0.5,
        docHitRate: 0.5,
        mustRefuseCases: 1,
        mustRefuseCorrect: 1
      },
      failureBuckets: {
        retrieval: 1,
        facts: 0
      },
      cases: [
        before.cases[0],
        {
          ...before.cases[1],
          passed: false,
          failureCategory: "retrieval",
          failureReasons: ["Expected document not found in top-k retrieval."],
          retrieval: { recallAtK: 0, docHit: false }
        }
      ]
    });

    const comparison = compareBenchmarkJsonReports(before, after);
    expect(comparison.regressedCases.map((item) => item.id)).toEqual(["case-b"]);
    expect(comparison.changedCases).toHaveLength(1);

    const markdown = renderBenchmarkComparisonMarkdown(comparison);
    expect(markdown).toContain("RAG evaluation before/after comparison");
    expect(markdown).toContain("case-b");
    expect(markdown).toContain("No fail-to-pass fixes");
  });
});
