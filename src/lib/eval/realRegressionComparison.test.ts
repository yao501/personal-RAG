import { describe, expect, it } from "vitest";
import {
  compareRealRegressionReports,
  hasBlockingRealRegressionChange,
  renderRealRegressionComparisonMarkdown,
  type RealRegressionReport
} from "./realRegressionComparison";

function report(rows: RealRegressionReport["rows"]): RealRegressionReport {
  return {
    generated_at: "2026-05-25T00:00:00.000Z",
    rows
  };
}

describe("realRegressionComparison", () => {
  it("detects verdict regressions and missing cases as blocking", () => {
    const before = report([
      {
        id: "case-a",
        verdict: "pass",
        fail_stage: "rule_check",
        primary_citation: "manual-a.pdf"
      },
      {
        id: "case-b",
        verdict: "partial",
        fail_stage: "answer",
        primary_citation: "manual-b.pdf"
      }
    ]);
    const after = report([
      {
        id: "case-a",
        verdict: "fail",
        fail_stage: "retrieval",
        missed: ["must_contain_all:safety warning"],
        primary_citation: null
      }
    ]);

    const comparison = compareRealRegressionReports(before, after);
    expect(comparison.regressedCases.map((item) => item.id)).toEqual(["case-a"]);
    expect(comparison.missingCases.map((item) => item.id)).toEqual(["case-b"]);
    expect(hasBlockingRealRegressionChange(comparison)).toBe(true);

    const markdown = renderRealRegressionComparisonMarkdown(comparison);
    expect(markdown).toContain("Real regression before/after comparison");
    expect(markdown).toContain("Verdict regressions");
    expect(markdown).toContain("Missing after-report cases");
  });

  it("tracks improvements without blocking the comparison", () => {
    const before = report([
      {
        id: "case-a",
        verdict: "partial",
        fail_stage: "answer"
      }
    ]);
    const after = report([
      {
        id: "case-a",
        verdict: "pass",
        fail_stage: "rule_check",
        primary_citation: "manual-a.pdf"
      },
      {
        id: "case-new",
        verdict: "pass",
        fail_stage: "rule_check"
      }
    ]);

    const comparison = compareRealRegressionReports(before, after);
    expect(comparison.improvedCases.map((item) => item.id)).toEqual(["case-a"]);
    expect(comparison.newCases.map((item) => item.id)).toEqual(["case-new"]);
    expect(hasBlockingRealRegressionChange(comparison)).toBe(false);
  });
});
