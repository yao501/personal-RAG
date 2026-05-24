import fs from "node:fs";
import path from "node:path";

export interface BenchmarkJsonCaseSummary {
  id: string;
  passed: boolean;
  failureCategory: string | null;
  failureReasons: string[];
  retrieval: {
    recallAtK: number;
    docHit: boolean;
  };
  answerMetrics: {
    refusalDetected: boolean;
    cautiousProcedural: boolean;
  };
}

export interface BenchmarkJsonReportSummary {
  reportSchemaVersion: number;
  generatedAt: string;
  benchmark: {
    id: string;
    path: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    meanRecallAtK: number;
    docHitRate: number;
    mustRefuseCases: number;
    mustRefuseCorrect: number;
  };
  failureBuckets: Record<string, number>;
  cases: BenchmarkJsonCaseSummary[];
}

export interface BenchmarkReportComparison {
  before: BenchmarkJsonReportSummary;
  after: BenchmarkJsonReportSummary;
  fixedCases: BenchmarkJsonCaseSummary[];
  regressedCases: BenchmarkJsonCaseSummary[];
  changedCases: Array<{
    id: string;
    beforePassed: boolean;
    afterPassed: boolean;
    beforeFailureCategory: string | null;
    afterFailureCategory: string | null;
    recallDelta: number;
    refusalChanged: boolean;
    cautiousChanged: boolean;
  }>;
}

function assertReport(value: unknown, filePath: string): asserts value is BenchmarkJsonReportSummary {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid benchmark JSON report: ${filePath}`);
  }
  const record = value as Partial<BenchmarkJsonReportSummary>;
  if (record.reportSchemaVersion !== 1 || !record.summary || !Array.isArray(record.cases)) {
    throw new Error(`Unsupported benchmark JSON report schema: ${filePath}`);
  }
}

export function loadBenchmarkJsonReport(filePath: string): BenchmarkJsonReportSummary {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assertReport(parsed, filePath);
  return parsed;
}

export function compareBenchmarkJsonReports(
  before: BenchmarkJsonReportSummary,
  after: BenchmarkJsonReportSummary
): BenchmarkReportComparison {
  const beforeMap = new Map(before.cases.map((item) => [item.id, item]));
  const fixedCases: BenchmarkJsonCaseSummary[] = [];
  const regressedCases: BenchmarkJsonCaseSummary[] = [];
  const changedCases: BenchmarkReportComparison["changedCases"] = [];

  for (const afterCase of after.cases) {
    const beforeCase = beforeMap.get(afterCase.id);
    if (!beforeCase) {
      continue;
    }
    const recallDelta = afterCase.retrieval.recallAtK - beforeCase.retrieval.recallAtK;
    const refusalChanged = afterCase.answerMetrics.refusalDetected !== beforeCase.answerMetrics.refusalDetected;
    const cautiousChanged = afterCase.answerMetrics.cautiousProcedural !== beforeCase.answerMetrics.cautiousProcedural;
    const changed =
      beforeCase.passed !== afterCase.passed ||
      beforeCase.failureCategory !== afterCase.failureCategory ||
      Math.abs(recallDelta) >= 0.001 ||
      refusalChanged ||
      cautiousChanged;

    if (beforeCase.passed && !afterCase.passed) {
      regressedCases.push(afterCase);
    }
    if (!beforeCase.passed && afterCase.passed) {
      fixedCases.push(afterCase);
    }
    if (changed) {
      changedCases.push({
        id: afterCase.id,
        beforePassed: beforeCase.passed,
        afterPassed: afterCase.passed,
        beforeFailureCategory: beforeCase.failureCategory,
        afterFailureCategory: afterCase.failureCategory,
        recallDelta,
        refusalChanged,
        cautiousChanged
      });
    }
  }

  return {
    before,
    after,
    fixedCases,
    regressedCases,
    changedCases
  };
}

function signed(value: number, digits = 3): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function renderBucketRows(before: BenchmarkJsonReportSummary, after: BenchmarkJsonReportSummary): string[] {
  const keys = [...new Set([...Object.keys(before.failureBuckets), ...Object.keys(after.failureBuckets)])].sort();
  return keys.map((key) => {
    const b = before.failureBuckets[key] ?? 0;
    const a = after.failureBuckets[key] ?? 0;
    return `| ${key} | ${b} | ${a} | ${a - b >= 0 ? "+" : ""}${a - b} |`;
  });
}

export function renderBenchmarkComparisonMarkdown(comparison: BenchmarkReportComparison): string {
  const { before, after } = comparison;
  const passDelta = after.summary.passed - before.summary.passed;
  const failedDelta = after.summary.failed - before.summary.failed;
  const lines: string[] = [];
  lines.push("# RAG evaluation before/after comparison");
  lines.push("");
  lines.push(`- **Before:** ${before.generatedAt} · \`${before.benchmark.id}\``);
  lines.push(`- **After:** ${after.generatedAt} · \`${after.benchmark.id}\``);
  lines.push("");
  lines.push("## Summary delta");
  lines.push("");
  lines.push("| Metric | Before | After | Delta |");
  lines.push("| --- | ---: | ---: | ---: |");
  lines.push(`| Passed cases | ${before.summary.passed}/${before.summary.total} | ${after.summary.passed}/${after.summary.total} | ${passDelta >= 0 ? "+" : ""}${passDelta} |`);
  lines.push(`| Failed cases | ${before.summary.failed} | ${after.summary.failed} | ${failedDelta >= 0 ? "+" : ""}${failedDelta} |`);
  lines.push(`| Mean recall@k | ${before.summary.meanRecallAtK.toFixed(3)} | ${after.summary.meanRecallAtK.toFixed(3)} | ${signed(after.summary.meanRecallAtK - before.summary.meanRecallAtK)} |`);
  lines.push(`| Doc hit rate | ${before.summary.docHitRate.toFixed(3)} | ${after.summary.docHitRate.toFixed(3)} | ${signed(after.summary.docHitRate - before.summary.docHitRate)} |`);
  lines.push(`| mustRefuse correct | ${before.summary.mustRefuseCorrect}/${before.summary.mustRefuseCases} | ${after.summary.mustRefuseCorrect}/${after.summary.mustRefuseCases} | ${after.summary.mustRefuseCorrect - before.summary.mustRefuseCorrect >= 0 ? "+" : ""}${after.summary.mustRefuseCorrect - before.summary.mustRefuseCorrect} |`);
  lines.push("");
  lines.push("## Failure buckets");
  lines.push("");
  lines.push("| Bucket | Before | After | Delta |");
  lines.push("| --- | ---: | ---: | ---: |");
  lines.push(...renderBucketRows(before, after));
  lines.push("");
  lines.push("## Case changes");
  lines.push("");
  if (comparison.changedCases.length === 0) {
    lines.push("_No case-level changes._");
  } else {
    lines.push("| Case | Before | After | Recall delta | Flags |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const row of comparison.changedCases) {
      const flags = [
        row.refusalChanged ? "refusal changed" : null,
        row.cautiousChanged ? "cautious changed" : null
      ].filter(Boolean).join("; ") || "-";
      lines.push(
        `| ${row.id} | ${row.beforePassed ? "pass" : `fail:${row.beforeFailureCategory ?? "unknown"}`} | ${row.afterPassed ? "pass" : `fail:${row.afterFailureCategory ?? "unknown"}`} | ${signed(row.recallDelta)} | ${flags} |`
      );
    }
  }
  lines.push("");
  lines.push("## Regressions");
  lines.push("");
  if (comparison.regressedCases.length === 0) {
    lines.push("_No pass-to-fail regressions._");
  } else {
    for (const row of comparison.regressedCases) {
      lines.push(`- ${row.id}: ${row.failureReasons.join("; ") || row.failureCategory || "failed"}`);
    }
  }
  lines.push("");
  lines.push("## Fixes");
  lines.push("");
  if (comparison.fixedCases.length === 0) {
    lines.push("_No fail-to-pass fixes._");
  } else {
    for (const row of comparison.fixedCases) {
      lines.push(`- ${row.id}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function defaultComparisonOutputPath(repoRoot: string, generatedAt = new Date().toISOString()): string {
  return path.join(repoRoot, "reports", "rag-eval", `compare-${generatedAt.replace(/[:.]/g, "-")}.md`);
}
