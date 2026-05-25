import fs from "node:fs";
import path from "node:path";

export type RealRegressionVerdict = "pass" | "partial" | "fail";

export interface RealRegressionResultRow {
  id: string;
  verdict: RealRegressionVerdict;
  fail_stage: string;
  missed?: string[];
  primary_citation?: string | null;
  citation_file_names?: string[];
}

export interface RealRegressionReport {
  generated_at: string;
  rows: RealRegressionResultRow[];
}

export interface RealRegressionComparison {
  before: RealRegressionReport;
  after: RealRegressionReport;
  summary: {
    before: VerdictCounts;
    after: VerdictCounts;
    sharedCases: number;
    newCases: number;
    missingCases: number;
  };
  regressedCases: RealRegressionCaseChange[];
  improvedCases: RealRegressionCaseChange[];
  changedCases: RealRegressionCaseChange[];
  newCases: RealRegressionResultRow[];
  missingCases: RealRegressionResultRow[];
}

export interface RealRegressionCaseChange {
  id: string;
  beforeVerdict: RealRegressionVerdict;
  afterVerdict: RealRegressionVerdict;
  beforeFailStage: string;
  afterFailStage: string;
  beforePrimaryCitation: string | null;
  afterPrimaryCitation: string | null;
  afterMissed: string[];
}

interface VerdictCounts {
  pass: number;
  partial: number;
  fail: number;
  total: number;
}

const VERDICT_RANK: Record<RealRegressionVerdict, number> = {
  fail: 0,
  partial: 1,
  pass: 2
};

function assertReport(value: unknown, filePath: string): asserts value is RealRegressionReport {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid real-regression JSON report: ${filePath}`);
  }
  const record = value as Partial<RealRegressionReport>;
  if (!record.generated_at || !Array.isArray(record.rows)) {
    throw new Error(`Unsupported real-regression JSON report schema: ${filePath}`);
  }
  for (const row of record.rows) {
    if (!row || typeof row !== "object") {
      throw new Error(`Invalid real-regression row in ${filePath}`);
    }
    const candidate = row as Partial<RealRegressionResultRow>;
    if (!candidate.id || !candidate.verdict || !(candidate.verdict in VERDICT_RANK)) {
      throw new Error(`Invalid real-regression row verdict in ${filePath}`);
    }
  }
}

export function loadRealRegressionReport(filePath: string): RealRegressionReport {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assertReport(parsed, filePath);
  return parsed;
}

export function compareRealRegressionReports(
  before: RealRegressionReport,
  after: RealRegressionReport
): RealRegressionComparison {
  const beforeMap = new Map(before.rows.map((row) => [row.id, row]));
  const afterMap = new Map(after.rows.map((row) => [row.id, row]));
  const changedCases: RealRegressionCaseChange[] = [];
  const regressedCases: RealRegressionCaseChange[] = [];
  const improvedCases: RealRegressionCaseChange[] = [];

  for (const afterRow of after.rows) {
    const beforeRow = beforeMap.get(afterRow.id);
    if (!beforeRow) {
      continue;
    }

    const change = buildCaseChange(beforeRow, afterRow);
    const verdictDelta = VERDICT_RANK[afterRow.verdict] - VERDICT_RANK[beforeRow.verdict];
    const changed =
      verdictDelta !== 0 ||
      beforeRow.fail_stage !== afterRow.fail_stage ||
      normalizeCitation(beforeRow.primary_citation) !== normalizeCitation(afterRow.primary_citation);

    if (changed) {
      changedCases.push(change);
    }
    if (verdictDelta < 0) {
      regressedCases.push(change);
    }
    if (verdictDelta > 0) {
      improvedCases.push(change);
    }
  }

  const newCases = after.rows.filter((row) => !beforeMap.has(row.id));
  const missingCases = before.rows.filter((row) => !afterMap.has(row.id));

  return {
    before,
    after,
    summary: {
      before: countVerdicts(before.rows),
      after: countVerdicts(after.rows),
      sharedCases: after.rows.length - newCases.length,
      newCases: newCases.length,
      missingCases: missingCases.length
    },
    regressedCases,
    improvedCases,
    changedCases,
    newCases,
    missingCases
  };
}

function buildCaseChange(beforeRow: RealRegressionResultRow, afterRow: RealRegressionResultRow): RealRegressionCaseChange {
  return {
    id: afterRow.id,
    beforeVerdict: beforeRow.verdict,
    afterVerdict: afterRow.verdict,
    beforeFailStage: beforeRow.fail_stage,
    afterFailStage: afterRow.fail_stage,
    beforePrimaryCitation: normalizeCitation(beforeRow.primary_citation),
    afterPrimaryCitation: normalizeCitation(afterRow.primary_citation),
    afterMissed: afterRow.missed ?? []
  };
}

function countVerdicts(rows: RealRegressionResultRow[]): VerdictCounts {
  return {
    pass: rows.filter((row) => row.verdict === "pass").length,
    partial: rows.filter((row) => row.verdict === "partial").length,
    fail: rows.filter((row) => row.verdict === "fail").length,
    total: rows.length
  };
}

function normalizeCitation(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function renderCounts(counts: VerdictCounts): string {
  return `P:${counts.pass} Pa:${counts.partial} F:${counts.fail} / ${counts.total}`;
}

function formatCaseIds(rows: Array<{ id: string }>): string {
  return rows.length > 0 ? rows.map((row) => `\`${row.id}\``).join(", ") : "-";
}

export function renderRealRegressionComparisonMarkdown(comparison: RealRegressionComparison): string {
  const lines: string[] = [];
  lines.push("# Real regression before/after comparison");
  lines.push("");
  lines.push(`- **Before:** ${comparison.before.generated_at}`);
  lines.push(`- **After:** ${comparison.after.generated_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Before | After |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| Verdicts | ${renderCounts(comparison.summary.before)} | ${renderCounts(comparison.summary.after)} |`);
  lines.push(`| Shared cases | ${comparison.summary.sharedCases} | ${comparison.summary.sharedCases} |`);
  lines.push(`| New cases | 0 | ${comparison.summary.newCases} |`);
  lines.push(`| Missing cases | ${comparison.summary.missingCases} | 0 |`);
  lines.push("");
  lines.push("## Case changes");
  lines.push("");
  if (comparison.changedCases.length === 0) {
    lines.push("_No shared case-level changes._");
  } else {
    lines.push("| Case | Before | After | Fail stage | Primary citation | Missed after |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const change of comparison.changedCases) {
      lines.push(
        `| \`${change.id}\` | ${change.beforeVerdict} | ${change.afterVerdict} | ${change.beforeFailStage} -> ${change.afterFailStage} | ${change.beforePrimaryCitation ?? "-"} -> ${change.afterPrimaryCitation ?? "-"} | ${change.afterMissed.join("; ") || "-"} |`
      );
    }
  }
  lines.push("");
  lines.push("## Blocking regressions");
  lines.push("");
  if (comparison.regressedCases.length === 0 && comparison.missingCases.length === 0) {
    lines.push("_No verdict regressions or missing cases._");
  } else {
    if (comparison.regressedCases.length > 0) {
      lines.push(`- Verdict regressions: ${formatCaseIds(comparison.regressedCases)}`);
    }
    if (comparison.missingCases.length > 0) {
      lines.push(`- Missing after-report cases: ${formatCaseIds(comparison.missingCases)}`);
    }
  }
  lines.push("");
  lines.push("## Improvements");
  lines.push("");
  lines.push(formatCaseIds(comparison.improvedCases));
  lines.push("");
  lines.push("## New cases");
  lines.push("");
  lines.push(formatCaseIds(comparison.newCases));
  lines.push("");
  return lines.join("\n");
}

export function hasBlockingRealRegressionChange(comparison: RealRegressionComparison): boolean {
  return comparison.regressedCases.length > 0 || comparison.missingCases.length > 0;
}

export function defaultRealRegressionComparisonOutputPath(repoRoot: string, generatedAt = new Date().toISOString()): string {
  return path.join(repoRoot, "evals", "results", `real-regression-compare-${generatedAt.replace(/[:.]/g, "-")}.md`);
}
