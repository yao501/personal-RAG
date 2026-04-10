import type { SearchResult } from "../shared/types";

export interface EvalExpectation {
  topK?: number;
  fileNameIncludes?: string;
  sectionPathIncludes?: string[];
  sectionTitleIncludes?: string[];
  evidenceIncludes?: string[];
  snippetIncludes?: string[];
}

export interface EvalCase {
  id: string;
  category: "definition" | "procedure" | "troubleshooting" | "navigational" | "role" | "general";
  question: string;
  expectations: EvalExpectation[];
}

export interface EvalCaseResult {
  evalCase: EvalCase;
  passed: boolean;
  matchedRank: number | null;
  matchedChunkId: string | null;
  results: SearchResult[];
}

function includesAll(haystack: string | null | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) {
    return true;
  }

  const normalizedHaystack = (haystack ?? "").toLowerCase();
  return needles.every((needle) => normalizedHaystack.includes(needle.toLowerCase()));
}

function expectationMatches(result: SearchResult, expectation: EvalExpectation): boolean {
  if (expectation.fileNameIncludes && !result.fileName.toLowerCase().includes(expectation.fileNameIncludes.toLowerCase())) {
    return false;
  }

  if (!includesAll(result.sectionPath, expectation.sectionPathIncludes)) {
    return false;
  }

  if (!includesAll(result.sectionTitle, expectation.sectionTitleIncludes)) {
    return false;
  }

  if (!includesAll(result.evidenceText ?? "", expectation.evidenceIncludes)) {
    return false;
  }

  if (!includesAll(result.snippet, expectation.snippetIncludes)) {
    return false;
  }

  return true;
}

export function evaluateCase(evalCase: EvalCase, results: SearchResult[]): EvalCaseResult {
  for (const expectation of evalCase.expectations) {
    const topK = expectation.topK ?? 3;
    const matchedIndex = results.slice(0, topK).findIndex((result) => expectationMatches(result, expectation));
    if (matchedIndex >= 0) {
      const matched = results[matchedIndex];
      return {
        evalCase,
        passed: true,
        matchedRank: matchedIndex + 1,
        matchedChunkId: matched?.chunkId ?? null,
        results
      };
    }
  }

  return {
    evalCase,
    passed: false,
    matchedRank: null,
    matchedChunkId: null,
    results
  };
}

export function summarizeCaseResults(caseResults: EvalCaseResult[]): {
  total: number;
  passed: number;
  failed: number;
  byCategory: Array<{ category: EvalCase["category"]; total: number; passed: number }>;
} {
  const summaryMap = new Map<EvalCase["category"], { total: number; passed: number }>();

  for (const caseResult of caseResults) {
    const current = summaryMap.get(caseResult.evalCase.category) ?? { total: 0, passed: 0 };
    current.total += 1;
    current.passed += caseResult.passed ? 1 : 0;
    summaryMap.set(caseResult.evalCase.category, current);
  }

  const total = caseResults.length;
  const passed = caseResults.filter((item) => item.passed).length;

  return {
    total,
    passed,
    failed: total - passed,
    byCategory: [...summaryMap.entries()].map(([category, stats]) => ({ category, ...stats }))
  };
}
